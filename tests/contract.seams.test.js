/**
 * Cross-workstream seams from ARCHITECTURE.md: the extension points that let
 * two workstreams meet without editing each other's files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/data/characters.js', async () => (await import('./raceHelpers.js')).characterMock());

import { makeRace, humanParticipants } from './raceHelpers.js';
import { DEFAULT_GAMEPLAY, normalizeGameplay } from '../src/race/gameplay.js';
import { createEventBus, EVENTS } from '../src/game/events.js';
import { scoreGrandPrix, GP_POINTS } from '../src/data/cups.js';
import * as progress from '../src/progress/progress.js';
import { mergeProgress, emptyStats, STAT_KEYS } from '../src/progress/schema.js';
import { mergeSfxPacks, SFX_OWNERS, SFX } from '../src/audio/sfx.js';
import { createWidgetHost, HUD_ANCHORS } from '../src/ui/hudWidgets.js';
import { menuEntries, titleFocusReduce } from '../src/ui/screenFlow.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { describeUnlockShort } from '../src/progress/describeUnlock.js';
import { lockHint } from '../src/ui/screens/_shared.js';
import { LINEUP_CHARACTERS, LINEUP_TRACKS } from '../src/content/lineup.js';
import { createSessionHelpers } from '../src/game/session.js';
import drivingReactions from '../src/systems/drivingReactions.js';
import itemReactions from '../src/systems/itemReactions.js';

/* ------------------------------------------------------------ gameplay -- */

describe('track gameplay modifiers (Moonbounce low gravity seam)', () => {
  it('defaults to normal physics and clamps known multipliers', () => {
    expect(normalizeGameplay(undefined)).toEqual(DEFAULT_GAMEPLAY);
    expect(normalizeGameplay({ gravity: 0.55, hopBoost: 1.4 })).toEqual({ gravity: 0.55, hopBoost: 1.4 });
    expect(normalizeGameplay({ gravity: 0, hopBoost: 99 })).toEqual({ gravity: 0.2, hopBoost: 3 });
    expect(normalizeGameplay({ gravity: 'lots' }).gravity).toBe(1);
    expect(normalizeGameplay({ gravity: 0.5, bounciness: 2 }).bounciness).toBe(2); // extras pass through
    expect(Object.isFrozen(normalizeGameplay({}))).toBe(true);
  });

  it('the Race hands the track gameplay to stepKart through env.gameplay', async () => {
    const plain = await makeRace({ participants: humanParticipants(1) });
    expect(plain.gameplay).toEqual(DEFAULT_GAMEPLAY);
    expect(plain._env.gameplay).toBe(plain.gameplay);
    const moon = await makeRace({ participants: humanParticipants(1), trackDef: { gameplay: { gravity: 0.55, hopBoost: 1.4 } } });
    expect(moon._env.gameplay).toEqual({ gravity: 0.55, hopBoost: 1.4 });
  });
});

/* ---------------------------------------------------------- grand prix -- */

const race = (order) => ({
  standings: order.map((who, i) => (typeof who === 'number'
    ? { characterId: `hero${who}`, playerIndex: who, isCPU: false, place: i + 1 }
    : { characterId: who, playerIndex: null, isCPU: true, place: i + 1 })),
});

describe('Grand Prix events + scoring', () => {
  it('gp-race-end and gp-end are declared built-ins (subscribable before modes loads)', () => {
    const bus = createEventBus();
    expect(typeof EVENTS['gp-race-end']).toBe('string');
    expect(typeof EVENTS['gp-end']).toBe('string');
    const seen = [];
    bus.on('gp-end', (gp) => seen.push(gp.cupId));
    bus.emit('gp-end', { cupId: 'sprinkle-cup' });
    expect(seen).toEqual(['sprinkle-cup']);
  });

  it('scores points per race and ranks humans and CPUs together', () => {
    const races = [race([0, 'lenny', 'stella']), race(['lenny', 0, 'stella']), race([0, 'stella', 'lenny']), race([0, 'lenny', 'stella'])];
    const gp = scoreGrandPrix('sprinkle-cup', races);
    expect(gp.finished).toBe(true);
    expect(gp.raceCount).toBe(4);
    expect(gp.raceIndex).toBe(3);
    expect(gp.standings.map((r) => r.characterId)).toEqual(['hero0', 'lenny', 'stella']);
    expect(gp.standings[0]).toMatchObject({ playerIndex: 0, isCPU: false, place: 1, points: GP_POINTS[0] * 3 + GP_POINTS[1] });
    expect(gp.standings[0].racePoints).toEqual([15, 12, 15, 15]);
    expect(gp.humanWinner).toEqual({ playerIndex: 0, characterId: 'hero0' });
    expect(gp.bestHumanPlace).toBe(1);
    expect(gp.unlocks).toEqual([]);
  });

  it('is unfinished part-way, breaks ties by wins, and has no human winner when a CPU leads', () => {
    const gp = scoreGrandPrix('sprinkle-cup', [race(['lenny', 0]), race([0, 'lenny'])]);
    expect(gp.finished).toBe(false);
    // 27 points each, one win each -> better place in the latest race wins the tie
    expect(gp.standings.map((r) => r.characterId)).toEqual(['hero0', 'lenny']);
    const cpuWins = scoreGrandPrix('sprinkle-cup', [race(['lenny', 1, 0])]);
    expect(cpuWins.humanWinner).toBe(null);
    expect(cpuWins.bestHumanPlace).toBe(2);
    expect(scoreGrandPrix('sprinkle-cup', []).standings).toEqual([]);
  });
});

/* ------------------------------------------------------- saved progress -- */

function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

describe('saved progress: deep merge + best-time records', () => {
  let ls;
  beforeEach(() => {
    ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    progress.resetProgress();
  });
  afterEach(() => {
    progress.resetProgress();
    vi.unstubAllGlobals();
  });

  it('mergeProgress fills every missing stat key and repairs wrong types', () => {
    const m = mergeProgress({ stats: { wins: 3, junk: 'x' }, tracks: [], unlocked: ['luna', 7], unlockAll: 'yes', extra: 1 });
    for (const k of STAT_KEYS) expect(Number.isFinite(m.stats[k]), k).toBe(true);
    expect(m.stats.wins).toBe(3);
    expect(m.stats.junk).toBeUndefined();
    expect(m.tracks).toEqual({});
    expect(m.unlocked).toEqual(['luna']);
    expect(m.unlockAll).toBe(false);
    expect(m.extra).toBe(1);
    expect(mergeProgress(null).stats).toEqual(emptyStats());
    expect(mergeProgress('nope').unlocked).toEqual([]);
  });

  it('an older save with a partial stats object loads with every counter at a number', () => {
    ls.setItem(progress.PROGRESS_KEY, JSON.stringify({ unlocked: ['cotton-candy-girl'], wins: 2, trophies: {}, stats: { wins: 2 } }));
    const p = progress.loadProgress();
    expect(p.stats.wins).toBe(2);
    expect(p.stats.cupsWon).toBe(0);
    expect(p.stats.cupsWon + 1).toBe(1); // not NaN
    expect(progress.isUnlocked('cotton-candy-girl')).toBe(true);
  });

  it('getRecord / submitRecord keep the best race and lap times', () => {
    expect(progress.getRecord('gumdrop-meadow')).toEqual({ bestRace: null, bestLap: null });
    let r = progress.submitRecord('gumdrop-meadow', { raceTime: 95.2, bestLap: 30.1 });
    expect(r).toMatchObject({ newBestRace: true, newBestLap: true, record: { bestRace: 95.2, bestLap: 30.1 } });
    r = progress.submitRecord('gumdrop-meadow', { raceTime: 99, bestLap: 29.5 });
    expect(r).toMatchObject({ newBestRace: false, newBestLap: true, previous: { bestRace: 95.2, bestLap: 30.1 }, record: { bestRace: 95.2, bestLap: 29.5 } });
    r = progress.submitRecord('gumdrop-meadow', { raceTime: null, bestLap: -1 });
    expect(r.newBestRace || r.newBestLap).toBe(false);
    expect(progress.getRecord('gumdrop-meadow')).toEqual({ bestRace: 95.2, bestLap: 29.5 });
    expect(JSON.parse(ls.getItem(progress.PROGRESS_KEY)).records['gumdrop-meadow']).toEqual({ bestRace: 95.2, bestLap: 29.5 });
    expect(progress.getRecord('sundae-slopes')).toEqual({ bestRace: null, bestLap: null });
  });
});

/* ------------------------------------------------------------------ sfx -- */

describe('SFX pack overrides', () => {
  it('an owner pack with override: true may replace only its own built-ins', () => {
    const target = { bonk: () => 'old-bonk', boost: () => 'old-boost', go: () => 'old-go' };
    const throttle = { bonk: 0.2 };
    const owners = { items: ['bonk'], driving: ['boost'] };
    const added = mergeSfxPacks([
      ['items', { override: true, recipes: { bonk: () => 'new-bonk', boost: () => 'hijack', 'item-zing': () => 'zing' }, throttle: { bonk: 0.3 } }],
      ['driving', { recipes: { boost: () => 'no-flag' } }],
      ['rogue', { override: true, recipes: { go: () => 'hijack' } }],
    ], target, throttle, owners);
    expect(added).toEqual(['bonk', 'item-zing']);
    expect(target.bonk()).toBe('new-bonk');
    expect(target.boost()).toBe('old-boost');
    expect(target.go()).toBe('old-go');
    expect(throttle.bonk).toBe(0.3);
  });

  it('every owned name is a real built-in and has exactly one owner', () => {
    const all = Object.values(SFX_OWNERS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const name of all) expect(typeof SFX[name], name).toBe('function');
  });

  it('item boosts are voiced by itemReactions, never twice', () => {
    const log = [];
    const audio = { sfx: (name) => log.push(name), voice() {} };
    const bus = createEventBus({ onError: (e) => { throw e; } });
    const humans = [{ playerIndex: 0, deviceId: 'gp0', characterId: 'rocco' }];
    const session = createSessionHelpers({ humans, audio, input: { rumble() {} }, hud: { flash() {} } });
    drivingReactions.install(bus, {});
    itemReactions.install(bus, {});
    const kart = { playerIndex: 0, isCPU: false, characterId: 'rocco', charDef: { id: 'rocco' } };
    bus.emit('race:boost', { type: 'boost', kart, source: 'item' }, session);
    expect(log).toEqual(['boost']);
    log.length = 0;
    bus.emit('race:boost', { type: 'boost', kart, source: 'pad' }, session);
    expect(log).toEqual(['boost']);
  });
});

/* ---------------------------------------------------------- hud anchors -- */

/** Just enough DOM for the widget host. */
function fakeDocument() {
  const make = (tag) => {
    const n = {
      tag, className: '', dataset: {}, style: {}, children: [], parentNode: null,
      appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
      remove() { if (n.parentNode) n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1); n.parentNode = null; },
    };
    return n;
  };
  return { createElement: make };
}

describe('HUD widget anchors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stacks anchored widgets in one shared zone per viewport, ordered, and cleans up', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    const host = createWidgetHost();
    const vp = doc.createElement('div');
    const got = [];
    const mk = (id, anchor, order) => ({ id, anchor, order, create(node, pi, vpNode) { got.push([id, node, vpNode]); return {}; } });
    const removeA = host.add(mk('timer', 'top-center', 10));
    host.add(mk('split', 'top-center', 5));
    host.add(mk('legacy'));
    host.attach(0, vp);
    const zones = vp.children.filter((c) => c.className.startsWith('sk-wzone'));
    expect(zones.map((z) => z.className)).toEqual(['sk-wzone sk-wzone-top-center']);
    expect(zones[0].children.map((b) => [b.dataset.widget, b.style.order])).toEqual([['timer', '10'], ['split', '5']]);
    expect(got.find((g) => g[0] === 'timer')[1]).toBe(zones[0].children[0]);
    expect(got.find((g) => g[0] === 'legacy')[1]).toBe(vp);
    for (const g of got) expect(g[2]).toBe(vp);
    removeA();
    expect(zones[0].children.map((b) => b.dataset.widget)).toEqual(['split']);
    host.detach(0);
    expect(vp.children.filter((c) => c.className.startsWith('sk-wzone'))).toEqual([]);
  });

  it('rejects unknown anchors and works without a DOM', () => {
    const host = createWidgetHost();
    expect(() => host.add({ id: 'x', anchor: 'middle-ish', create() { return {}; } })).toThrow(/anchor/);
    const seen = [];
    host.add({ id: 'y', anchor: 'callout', create(node) { seen.push(node); return {}; } });
    host.attach(0, 'vp');
    expect(seen).toEqual(['vp']);
    expect(HUD_ANCHORS).toEqual(['top-center', 'under-cluster', 'callout', 'bottom-center']);
  });
});

/* --------------------------------------------------------- menu entries -- */

describe('menu entries (Settings / Collection seam)', () => {
  const screens = new Map([
    ['title', { id: 'title', flow: { order: 10 } }],
    ['settings', { id: 'settings', menuEntry: { label: 'Grown-ups', emoji: '⚙️', order: 90 } }],
    ['collection', { id: 'collection', menuEntry: { label: 'Collection', emoji: '📖', order: 20 } }],
    ['gp-help', { id: 'gp-help', menuEntry: { label: 'How to GP', where: 'mode-select' } }],
    ['broken', { id: 'broken', menuEntry: { emoji: '?' } }],
  ]);

  it('collects entries per place, sorted by order', () => {
    expect(menuEntries(screens).map((e) => e.id)).toEqual(['collection', 'settings']);
    expect(menuEntries(screens, 'mode-select')).toEqual([{ id: 'gp-help', label: 'How to GP', emoji: '', order: 100 }]);
    expect(menuEntries(SCREENS).every((e) => SCREENS.has(e.id))).toBe(true);
  });

  it('title focus: A plays by default, Down reaches the entries, A opens one, Up returns', () => {
    expect(titleFocusReduce(-1, 'confirm', 2)).toEqual({ focus: -1, play: true, open: null });
    expect(titleFocusReduce(-1, 'down', 2).focus).toBe(0);
    expect(titleFocusReduce(-1, 'down', 0).focus).toBe(-1);
    expect(titleFocusReduce(0, 'right', 2).focus).toBe(1);
    expect(titleFocusReduce(1, 'right', 2).focus).toBe(0);
    expect(titleFocusReduce(0, 'left', 2).focus).toBe(1);
    expect(titleFocusReduce(1, 'confirm', 2)).toEqual({ focus: 1, play: false, open: 1 });
    expect(titleFocusReduce(1, 'up', 2).focus).toBe(-1);
    expect(titleFocusReduce(1, 'back', 2).focus).toBe(-1);
    expect(titleFocusReduce(1, 'start', 2).play).toBe(true);
  });
});

/* --------------------------------------------------------- short hints -- */

describe('compact unlock hints for the big grid', () => {
  it('every lineup rule has a short, friendly hint', () => {
    for (const item of [...LINEUP_CHARACTERS, ...LINEUP_TRACKS]) {
      if (!item.unlock) continue;
      const h = describeUnlockShort(item.unlock);
      expect(h.length, `${item.id}: ${h}`).toBeGreaterThan(3);
      expect(h.length, `${item.id}: ${h}`).toBeLessThanOrEqual(30);
      expect(h).not.toMatch(/undefined|null|secret/);
    }
    expect(describeUnlockShort({ type: 'track', trackId: 'starlight-galaxy', result: 'top3' })).toBe('Top 3: Starlight Galaxy');
    expect(describeUnlockShort(null)).toBe('');
  });

  it('lockHint picks the short form only when asked', () => {
    const def = { unlock: { type: 'stat', stat: 'wins', count: 3 } };
    expect(lockHint(def)).toBe('Win 3 races to unlock!');
    expect(lockHint(def, { short: true })).toBe('Win 3 races');
    expect(lockHint({ ...def, unlockHintShort: 'Psst!' }, { short: true })).toBe('Psst!');
  });
});
