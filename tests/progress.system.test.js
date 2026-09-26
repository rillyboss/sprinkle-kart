import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEventBus } from '../src/game/events.js';
import { createRaceStats } from '../src/game/raceStats.js';
import progressUnlocks, { registeredEntries, TALLY_EVENTS } from '../src/systems/progressUnlocks.js';
import progressSettings, { applyKidAssistDefault } from '../src/systems/progressSettings.js';
import { listSystems } from '../src/systems/index.js';
import { lineupEntries } from '../src/progress/engine.js';
import { CHARACTERS } from '../src/characters/index.js';
import { TRACKS } from '../src/tracks/index.js';
import * as progress from '../src/progress/progress.js';
import { makeSummary, humanKart, cpuKart, useFakeStorage } from './progressFixtures.js';

const ids = (list) => list.map((u) => u.id);

/** A bus with the progress system installed; `all` = evaluate the whole lineup (not only registered content). */
function rig({ all = true, app = {} } = {}) {
  const bus = createEventBus({ onError: (err) => { throw err; } });
  const off = progressUnlocks.install(bus, { progress, ...(all ? { unlockEntries: lineupEntries } : {}), ...app });
  const fire = (type, e) => bus.emit(`race:${type}`, { type, ...e }, {});
  const race = (summary) => { bus.emit('race-end', summary, {}); return summary.unlocks; };
  return { bus, off, fire, race };
}

describe('progress-unlocks system', () => {
  let ls;
  beforeEach(() => { ls = useFakeStorage(); progress.resetProgress(); });
  afterEach(() => { progress.resetProgress(); vi.unstubAllGlobals(); });

  it('is discovered with the other systems and listens to every tally event', () => {
    expect(listSystems().map((s) => s.id)).toEqual(expect.arrayContaining(['progress-unlocks', 'progress-settings']));
    const { bus, off } = rig();
    for (const t of TALLY_EVENTS) expect(bus.count(`race:${t}`)).toBe(1);
    expect(bus.count('race-end')).toBe(1);
    expect(bus.count('gp-end')).toBe(1);
    off();
    expect(bus.count('race-end')).toBe(0);
  });

  it('a simulated event stream accumulates stats and unlocks from them', () => {
    const { bus, fire, race } = rig();
    bus.emit('race-start', {}, {});
    for (let i = 0; i < 10; i++) fire('item-use', { kart: humanKart(0), item: 'gumdrop' });
    fire('item-use', { kart: cpuKart(), item: 'gumdrop' });
    for (let i = 0; i < 3; i++) fire('bonked', { kart: cpuKart(), by: humanKart(0), cause: 'rocket' });
    fire('drift-boost', { kart: humanKart(0), level: 3 });
    fire('drift-boost', { kart: humanKart(0), level: 1 });
    const unlocks = race(makeSummary({ humans: [{ place: 5 }] })); // no summary stats -> the tally is used
    const p = progress.loadProgress();
    expect(p.stats).toMatchObject({ itemsUsed: 10, bonksGiven: 3, miniTurbos: 2, miniTurbos1: 1, miniTurbos3: 1, racesFinished: 1 });
    expect(ids(unlocks)).toEqual(['bubblegum-bay', 'honeycomb-hive']);
  });

  it('the tally resets on race-start, so a restarted race never counts twice', () => {
    const { bus, fire, race } = rig();
    bus.emit('race-start', {}, {});
    for (let i = 0; i < 6; i++) fire('item-use', { kart: humanKart(0) });
    bus.emit('race-start', {}, {}); // restart
    fire('item-use', { kart: humanKart(0) });
    race(makeSummary({ humans: [{ place: 3 }] }));
    expect(progress.loadProgress().stats.itemsUsed).toBe(1);
  });

  it('summary stats win over the tally (no double counting)', () => {
    const { bus, fire, race } = rig();
    bus.emit('race-start', {}, {});
    const stats = createRaceStats();
    for (let i = 0; i < 4; i++) {
      const e = { type: 'item-use', kart: humanKart(0) };
      stats.onEvent(e);
      fire('item-use', e);
    }
    race(makeSummary({ humans: [{ place: 3 }], stats }));
    expect(progress.loadProgress().stats.itemsUsed).toBe(4);
  });

  it('MULTIPLE unlocks in one race are all pushed, in order, once', () => {
    const { race } = rig();
    const u1 = race(makeSummary({ trackId: 'cotton-candy-castle', humans: [{ place: 1 }] }));
    expect(u1).toEqual([
      { kind: 'character', id: 'cotton-candy-girl' },
      { kind: 'character', id: 'luna' },
      { kind: 'track', id: 'bubblegum-bay' },
      { kind: 'track', id: 'mermaid-lagoon' },
    ]);
    const u2 = race(makeSummary({ trackId: 'cotton-candy-castle', humans: [{ place: 1 }] }));
    expect(ids(u2)).toEqual(['bruno', 'teacup-garden']); // 2 races, 2 wins; nothing celebrated twice
    for (const id of [...ids(u1), ...ids(u2)]) expect(progress.isUnlocked(id)).toBe(true);
  });

  it('re-emitting the same summary is idempotent', () => {
    const { race } = rig();
    const s = makeSummary({ humans: [{ place: 1 }] });
    race(s);
    const before = JSON.stringify(progress.loadProgress());
    const n = s.unlocks.length;
    race(s);
    expect(JSON.stringify(progress.loadProgress())).toBe(before);
    expect(s.unlocks.length).toBe(n);
  });

  it('ANY human reaching the goal unlocks it (P2 wins, P1 is 7th)', () => {
    const { race } = rig();
    const u = race(makeSummary({ trackId: 'gumdrop-meadow', humans: [{ place: 7 }, { place: 1 }] }));
    expect(ids(u)).toEqual(expect.arrayContaining(['cotton-candy-girl', 'shelly', 'mermaid-lagoon']));
  });

  it('Kid-Assist, multiplayer and Time Trial rules', () => {
    const { race } = rig();
    expect(ids(race(makeSummary({ humans: [{ place: 6, kidAssist: true }] })))).toContain('baby-bonbon');
    race(makeSummary({ humans: [{ place: 4 }, { place: 5 }] }));
    race(makeSummary({ humans: [{ place: 4 }, { place: 5 }] }));
    expect(ids(race(makeSummary({ humans: [{ place: 4 }, { place: 5 }] })))).toContain('donut-downtown');
    const tt = race(makeSummary({ mode: 'time-trial', trackId: 'sundae-slopes', humans: [{ place: 1 }] }));
    expect(ids(tt)).toEqual(['bleep', 'cocoa-canyon']);
  });

  it('track, cup-track and distinct-tracks rules unlock from real races', () => {
    const { race } = rig();
    expect(ids(race(makeSummary({ trackId: 'starlight-galaxy', humans: [{ place: 3 }] })))).toContain('peekaberry');
    expect(ids(race(makeSummary({ trackId: 'gumdrop-meadow', humans: [{ place: 2 }] })))).toContain('pumpkin-patch'); // top 3 on 2 tracks
    expect(ids(race(makeSummary({ trackId: 'pillow-fort', humans: [{ place: 8 }] })))).toContain('lulu');
    expect(ids(race(makeSummary({ trackId: 'teddy-toyland', humans: [{ place: 1 }] })))).toContain('jellybean-jungle'); // any Bubble Cup win
    expect(ids(race(makeSummary({ trackId: 'teacup-garden', humans: [{ place: 1 }] })))).toContain('aurora-palace'); // any Cozy Cup win
    const tracks = ['cotton-candy-castle', 'sundae-slopes', 'bubblegum-bay', 'mermaid-lagoon'];
    let got = [];
    for (const t of tracks) got = got.concat(ids(race(makeSummary({ trackId: t, humans: [{ place: 1 }] }))));
    expect(got).toContain('ribbon-sky'); // wins on 6 different tracks
    expect(got.filter((x) => x === 'ribbon-sky')).toHaveLength(1);
  });

  it('gp-end records the cup and pushes into gp.unlocks (created if missing)', () => {
    const { bus } = rig();
    const gp = { cupId: 'sprinkle-cup', finished: true, humanWinner: { playerIndex: 0, characterId: 'rocco' }, bestHumanPlace: 1 };
    bus.emit('gp-end', gp, {});
    expect(gp.unlocks).toEqual([{ kind: 'track', id: 'cupcake-carnival' }]);
    expect(progress.loadProgress().stats).toMatchObject({ grandPrixFinished: 1, cupsWon: 1 });
    bus.emit('gp-end', gp, {}); // same result again: ignored
    expect(progress.loadProgress().stats.grandPrixFinished).toBe(1);
  });

  it('with unlock-everything on, earned ids are saved but not celebrated', () => {
    const { race } = rig();
    progress.setUnlockAll(true);
    const u = race(makeSummary({ humans: [{ place: 1 }] }));
    expect(u).toEqual([]);
    expect(progress.isEarned('cotton-candy-girl')).toBe(true);
    progress.setUnlockAll(false);
    expect(progress.isUnlocked('cotton-candy-girl')).toBe(true);
    expect(progress.isUnlocked('twiggy')).toBe(false);
  });

  it('by default only REGISTERED content is evaluated (nothing unbuilt is unlocked silently)', () => {
    const { race } = rig({ all: false });
    const u = race(makeSummary({ trackId: 'cotton-candy-castle', humans: [{ place: 1 }] }));
    const registered = new Set([...CHARACTERS.map((c) => c.id), ...TRACKS.map((t) => t.id)]);
    expect(u.length).toBeGreaterThan(0);
    for (const x of u) expect(registered.has(x.id), x.id).toBe(true);
    expect(ids(u)).toContain('cotton-candy-girl');
    for (const id of progress.loadProgress().unlocked) expect(registered.has(id), id).toBe(true);
    expect(registeredEntries({}).length).toBe(CHARACTERS.length + TRACKS.length);
  });

  it('saves to localStorage', () => {
    const { race } = rig();
    race(makeSummary({ humans: [{ place: 1 }] }));
    const saved = JSON.parse(ls.getItem(progress.PROGRESS_KEY));
    expect(saved.unlocked).toContain('cotton-candy-girl');
    expect(saved.stats.wins).toBe(1);
  });

  it('falls back to the legacy behaviour with a minimal progress API', () => {
    const calls = [];
    const mini = { recordWin: (t) => calls.push(['win', t]), unlock: (id) => { calls.push(['unlock', id]); return true; } };
    const bus = createEventBus({ onError: (err) => { throw err; } });
    progressUnlocks.install(bus, { progress: mini });
    const s = makeSummary({ humans: [{ place: 1 }] });
    bus.emit('race-end', s, {});
    expect(s.unlocks).toEqual([{ kind: 'character', id: 'cotton-candy-girl' }]);
    expect(calls).toEqual([['win', 'gumdrop-meadow'], ['unlock', 'cotton-candy-girl']]);
    const lost = makeSummary({ humans: [{ place: 4 }] });
    bus.emit('race-end', lost, {});
    expect(lost.unlocks).toEqual([]);
  });

  it('never throws without progress or with junk payloads', () => {
    const bus = createEventBus({ onError: (err) => { throw err; } });
    progressUnlocks.install(bus, {});
    expect(() => bus.emit('race-end', makeSummary(), {})).not.toThrow();
    const b2 = rig().bus;
    expect(() => b2.emit('race-end', null, {})).not.toThrow();
    expect(() => b2.emit('gp-end', 'nope', {})).not.toThrow();
  });
});

describe('progress-settings system', () => {
  beforeEach(() => { useFakeStorage(); progress.resetProgress(); });
  afterEach(() => { progress.resetProgress(); vi.unstubAllGlobals(); });

  it('applies the saved volumes at install', () => {
    progress.setSettings({ music: 0.3, sfx: 0.5 });
    const calls = [];
    const bus = createEventBus();
    progressSettings.install(bus, { progress, audio: { setVolume: (v) => calls.push(v) } });
    expect(calls).toEqual([{ music: 0.3, sfx: 0.5 }]);
  });

  it('applyKidAssistDefault only touches NEW players, and only when the default is on', () => {
    const seen = new Set(['kb1']);
    const st = { players: [{ deviceId: 'kb1', easyDrive: false }, { deviceId: 'gp0', easyDrive: false }] };
    expect(applyKidAssistDefault(st, new Set(), false)).toBe(st);
    const next = applyKidAssistDefault(st, seen, true);
    expect(next.players.map((p) => p.easyDrive)).toEqual([false, true]);
    expect(seen.has('gp0')).toBe(true);
    // already handled: switching it off again sticks
    const off = { players: [next.players[0], { ...next.players[1], easyDrive: false }] };
    expect(applyKidAssistDefault(off, seen, true)).toBe(off);
    expect(applyKidAssistDefault(null, seen, true)).toBe(null);
  });

  it('turns Kid-Assist on for players who join on the title / join screens', () => {
    progress.setSettings({ kidAssistDefault: true });
    const bus = createEventBus();
    let refreshed = 0;
    const menus = { screenId: 'title', screen: { refresh: () => { refreshed++; } }, draft: { joinState: { players: [{ deviceId: 'kb1', easyDrive: false }] } } };
    progressSettings.install(bus, { progress, menus });
    bus.emit('frame', 0.016, {}); // first frame of a run: carried-over players keep their choice
    expect(menus.draft.joinState.players[0].easyDrive).toBe(false);
    menus.draft.joinState = { players: [...menus.draft.joinState.players, { deviceId: 'gp0', easyDrive: false }] };
    menus.screenId = 'join';
    bus.emit('frame', 0.016, {});
    expect(menus.draft.joinState.players.map((p) => p.easyDrive)).toEqual([false, true]);
    expect(refreshed).toBe(1);
    // not on other screens
    menus.screenId = 'character-select';
    menus.draft.joinState = { players: [...menus.draft.joinState.players, { deviceId: 'gp1', easyDrive: false }] };
    bus.emit('frame', 0.016, {});
    expect(menus.draft.joinState.players[2].easyDrive).toBe(false);
  });

  it('does nothing with the default off', () => {
    const bus = createEventBus();
    const menus = { screenId: 'join', draft: { joinState: { players: [] } } };
    progressSettings.install(bus, { progress, menus });
    bus.emit('frame', 0.016, {});
    const js = { players: [{ deviceId: 'kb1', easyDrive: false }] };
    menus.draft.joinState = js;
    bus.emit('frame', 0.016, {});
    expect(menus.draft.joinState).toBe(js);
  });
});
