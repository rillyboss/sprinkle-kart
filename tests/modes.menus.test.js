import { describe, it, expect } from 'vitest';
import {
  MODE_CARDS, createModeSelectState, modeSelectReduce, createCupSelectState, cupSelectReduce, cupSpeed,
  createRecordsState, recordsReduce, createPhasedState, phasedTick, phasedReduce,
} from '../src/modes/menus.js';
import { applyModeChoice, finalizeSetup, restoreParty } from '../src/modes/flow.js';
import { parseDebugParams, quickSetup, wantsQuickStart, menuPrevious, modeParam } from '../src/game/setup.js';
import { rulesForMode, normalizeRules, modeId, TIME_TRIAL_BOOSTS } from '../src/modes/rules.js';
import { flowOrder } from '../src/ui/screenFlow.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { menuEntries } from '../src/ui/screenFlow.js';
import { CUPS } from '../src/data/cups.js';
import { CHARACTERS } from '../src/data/characters.js';
import { TRACKS } from '../src/data/tracks.js';
import { trialResultModel } from '../src/ui/screens/timeTrialResults.js';
import { cupRaceSetup } from '../src/ui/screens/cupSelect.js';

const ev = (action, extra = {}) => ({ deviceId: 'kb1', action, ...extra });

describe('mode select reducer', () => {
  it('three friendly cards in order', () => {
    expect(MODE_CARDS.map((m) => m.id)).toEqual(['free', 'grand-prix', 'time-trial']);
    for (const m of MODE_CARDS) expect(m.blurb).not.toMatch(/\b(hit|kill|crash|destroy)\b/i);
  });

  it('left/right wrap, confirm picks the mode', () => {
    let s = createModeSelectState({ controllerId: 'kb1' });
    expect(s.index).toBe(0);
    let r = modeSelectReduce(s, ev('left'));
    expect(r.state.index).toBe(2);
    expect(r.fx).toEqual(['move']);
    r = modeSelectReduce(r.state, ev('right'));
    r = modeSelectReduce(r.state, ev('right'));
    expect(r.state.index).toBe(1);
    r = modeSelectReduce(r.state, ev('confirm'));
    expect(r).toMatchObject({ go: 'mode', mode: 'grand-prix', fx: ['confirm'] });
    expect(modeSelectReduce(s, ev('start'))).toMatchObject({ go: 'mode', mode: 'free' });
    expect(modeSelectReduce(s, ev('back'))).toMatchObject({ go: 'back', fx: ['back'] });
  });

  it('remembers the previous mode', () => {
    expect(createModeSelectState({ mode: 'time-trial' }).index).toBe(2);
    expect(createModeSelectState({ mode: 'bogus' }).index).toBe(0);
  });

  it('down reaches the menu entries (Records), up comes back', () => {
    let s = createModeSelectState({ entryCount: 2 });
    let r = modeSelectReduce(s, ev('down'));
    expect(r.state.row).toBe('entries');
    r = modeSelectReduce(r.state, ev('right'));
    expect(r.state.entry).toBe(1);
    r = modeSelectReduce(r.state, ev('right'));
    expect(r.state.entry).toBe(0);
    expect(modeSelectReduce(r.state, ev('confirm'))).toMatchObject({ go: 'entry', entry: 0 });
    r = modeSelectReduce(r.state, ev('up'));
    expect(r.state.row).toBe('cards');
    // no entries: down does nothing
    expect(modeSelectReduce(createModeSelectState(), ev('down')).state.row).toBe('cards');
  });

  it('only P1 (and the mouse) drive it', () => {
    const s = createModeSelectState({ controllerId: 'kb1' });
    expect(modeSelectReduce(s, { deviceId: 'kb2', action: 'confirm' }).go).toBe(null);
    expect(modeSelectReduce(s, { deviceId: 'mouse', action: 'select', key: 'index', value: 2 })).toMatchObject({ go: 'mode', mode: 'time-trial' });
    expect(modeSelectReduce(s, { deviceId: 'mouse', action: 'set', key: 'index', value: 1 }).state.index).toBe(1);
    expect(modeSelectReduce(s, { deviceId: 'mouse', action: 'set', key: 'index', value: 9 }).state).toBe(s);
  });
});

describe('cup select reducer', () => {
  const base = { playable: [true, false, false, true, false], cupIds: CUPS.map((c) => c.id), controllerId: 'kb1' };

  it('starts on a playable cup (the previous one when it still is)', () => {
    expect(createCupSelectState(base).index).toBe(0);
    expect(createCupSelectState({ ...base, cupId: 'adventure-cup' }).index).toBe(3);
    expect(createCupSelectState({ ...base, cupId: 'bubble-cup' }).index).toBe(0);
    expect(createCupSelectState({ ...base, playable: [false, false] }).index).toBe(0);
  });

  it('speed row + Kid-Assist starts on Cozy', () => {
    expect(cupSpeed(createCupSelectState(base))).toBe('zippy');
    expect(cupSpeed(createCupSelectState({ ...base, easyDrive: true }))).toBe('cozy');
    expect(cupSpeed(createCupSelectState({ ...base, speedClass: 'zoomy' }))).toBe('zoomy');
    let r = cupSelectReduce(createCupSelectState(base), ev('down'));
    expect(r.state.row).toBe(1);
    r = cupSelectReduce(r.state, ev('right'));
    expect(cupSpeed(r.state)).toBe('zoomy');
    r = cupSelectReduce(r.state, ev('right'));
    expect(r.fx).toEqual([]); // clamped
    r = cupSelectReduce(r.state, ev('toggle'));
    expect(cupSpeed(r.state)).toBe('cozy');
  });

  it('a locked cup gives a nope-wiggle, a playable one starts', () => {
    let s = createCupSelectState(base);
    s = cupSelectReduce(s, ev('right')).state;
    expect(s.index).toBe(1);
    const nope = cupSelectReduce(s, ev('confirm'));
    expect(nope).toMatchObject({ go: null, shake: 'cup', fx: ['back'] });
    s = cupSelectReduce(s, ev('left')).state;
    expect(cupSelectReduce(s, ev('confirm'))).toMatchObject({ go: 'next' });
    expect(cupSelectReduce(s, ev('back')).go).toBe('back');
    expect(cupSelectReduce(s, { deviceId: 'kb2', action: 'confirm' }).go).toBe(null);
    expect(cupSelectReduce(s, { deviceId: 'mouse', action: 'set', key: 'index', value: 4 }).state.index).toBe(4);
  });

  it('builds the first-race RaceSetup of the cup', () => {
    const draft = {
      joinState: { players: [{ playerIndex: 0, deviceId: 'kb1', easyDrive: true }, { playerIndex: 1, deviceId: 'kb2', easyDrive: false }] },
      charState: null,
      charPicks: [{ playerIndex: 0, characterId: 'luna' }, { playerIndex: 1, characterId: 'rocco' }],
    };
    const card = { cup: { id: 'sprinkle-cup' }, tracks: [{ def: { id: 'cotton-candy-castle' } }] };
    expect(cupRaceSetup(draft, card, 'cozy')).toEqual({
      players: [
        { playerIndex: 0, deviceId: 'kb1', characterId: 'luna', easyDrive: true },
        { playerIndex: 1, deviceId: 'kb2', characterId: 'rocco', easyDrive: false },
      ],
      trackId: 'cotton-candy-castle', speedClass: 'cozy', laps: null, mode: 'grand-prix', cupId: 'sprinkle-cup',
    });
  });
});

describe('records + phased screen reducers', () => {
  it('records pages wrap and B/A go back', () => {
    let s = createRecordsState(3);
    s = recordsReduce(s, ev('left')).state;
    expect(s.page).toBe(2);
    expect(recordsReduce(s, ev('right')).state.page).toBe(0);
    expect(recordsReduce(s, ev('back')).go).toBe('back');
    expect(recordsReduce(s, ev('confirm')).go).toBe('back');
    expect(recordsReduce(createRecordsState(1), ev('right')).fx).toEqual([]);
    expect(createRecordsState(2, 9).page).toBe(1);
  });

  it('intro plays, A skips it, then the options work', () => {
    let s = createPhasedState(['next', 'menu'], { introTime: 2 });
    expect(phasedReduce(s, ev('right')).state).toBe(s); // nothing during the intro
    s = phasedTick(s, 1);
    expect(s.phase).toBe('intro');
    const skip = phasedReduce(s, ev('confirm'));
    expect(skip).toMatchObject({ skipped: true, go: null });
    expect(skip.state.phase).toBe('choose');
    s = phasedTick(createPhasedState(['next', 'menu'], { introTime: 2 }), 2.1);
    expect(s.phase).toBe('choose');
    s = phasedReduce(s, ev('right')).state;
    expect(phasedReduce(s, ev('confirm')).go).toBe('menu');
    expect(phasedReduce(s, { deviceId: 'mouse', action: 'select', index: 0 }).go).toBe('next');
    expect(phasedReduce(s, ev('back')).go).toBe(null); // no accidental exit
  });
});

describe('mode flow glue (menu draft -> RaceSetup)', () => {
  const draft = (n = 3) => ({
    joinState: { players: Array.from({ length: n }, (_, i) => ({ playerIndex: i, deviceId: `d${i}`, easyDrive: i === 1 })) },
    skip: new Set(),
    mode: null,
    charPicks: Array.from({ length: n }, (_, i) => ({ playerIndex: i, deviceId: `d${i}`, characterId: ['rocco', 'luna', 'dino'][i] })),
  });

  it('Grand Prix swaps track select for cup select', () => {
    const d = applyModeChoice(draft(), 'grand-prix');
    expect(d.mode).toBe('grand-prix');
    expect(d.skip.has('track-select')).toBe(true);
    expect(flowOrder(SCREENS, { draft: d })).toEqual(['title', 'join', 'mode-select', 'character-select', 'cup-select']);
    applyModeChoice(d, 'free');
    expect(d.skip.has('track-select')).toBe(false);
    expect(flowOrder(SCREENS, { draft: d })).toEqual(['title', 'join', 'mode-select', 'character-select', 'track-select']);
  });

  it('Time Trial is P1 only; the family comes back afterwards', () => {
    const d = applyModeChoice(draft(3), 'time-trial');
    expect(d.joinState.players.map((p) => p.deviceId)).toEqual(['d0']);
    expect(d.partyJoin.players).toHaveLength(3);
    // picking another mode (or going back) restores everyone
    applyModeChoice(d, 'free');
    expect(d.joinState.players).toHaveLength(3);
    expect(d.partyJoin).toBe(null);
    applyModeChoice(d, 'time-trial');
    restoreParty(d);
    expect(d.joinState.players).toHaveLength(3);
  });

  it('a solo Time Trial keeps no party', () => {
    const d = applyModeChoice(draft(1), 'time-trial');
    expect(d.partyJoin ?? null).toBe(null);
    expect(d.joinState.players).toHaveLength(1);
  });

  it('finalizeSetup adds the mode and the party players', () => {
    const d = applyModeChoice(draft(3), 'time-trial');
    const setup = { players: [{ playerIndex: 0, deviceId: 'd0', characterId: 'stella', easyDrive: false }], trackId: 't', speedClass: 'zippy', laps: 3 };
    const out = finalizeSetup(setup, d);
    expect(out.mode).toBe('time-trial');
    expect(out.players).toHaveLength(1);
    expect(out.partyPlayers.map((p) => [p.deviceId, p.characterId, p.easyDrive])).toEqual([['d0', 'stella', false], ['d1', 'luna', true], ['d2', 'dino', false]]);
    // back at the menus everyone is still joined
    expect(menuPrevious(out).players).toHaveLength(3);
    expect(finalizeSetup({ players: [] }, { mode: 'grand-prix' }).mode).toBe('grand-prix');
    expect(finalizeSetup({ players: [], mode: 'weird' }, null).mode).toBe('free');
    expect(finalizeSetup(null, d)).toBe(null);
    expect(menuPrevious(null)).toBe(null);
    expect(menuPrevious({ players: [1] })).toEqual({ players: [1] });
  });
});

describe('debug params for modes', () => {
  it('parses ?mode and ?cup', () => {
    expect(parseDebugParams('?mode=gp&cup=sprinkle-cup')).toMatchObject({ mode: 'grand-prix', cup: 'sprinkle-cup' });
    expect(parseDebugParams('?mode=tt&quick=gumdrop-meadow')).toMatchObject({ mode: 'time-trial', quick: 'gumdrop-meadow' });
    expect(parseDebugParams('').mode).toBe(null);
    expect(parseDebugParams('?mode=zoom').mode).toBe(null);
    expect(modeParam('Grand-Prix')).toBe('grand-prix');
    expect(modeParam('free')).toBe('free');
    expect(wantsQuickStart(parseDebugParams('?mode=gp&cup=sprinkle-cup'))).toBe(true);
    expect(wantsQuickStart(parseDebugParams('?mode=gp'))).toBe(false);
    expect(wantsQuickStart(parseDebugParams('?quick=gumdrop-meadow'))).toBe(true);
  });

  it('?mode=gp&cup= builds a Grand Prix setup on the cup\'s first track', () => {
    const s = quickSetup(parseDebugParams('?mode=gp&cup=sprinkle-cup&players=2&speed=zoomy'), null, CHARACTERS, TRACKS, { cups: CUPS });
    expect(s).toMatchObject({ mode: 'grand-prix', cupId: 'sprinkle-cup', trackId: 'cotton-candy-castle', speedClass: 'zoomy', laps: null });
    expect(s.players).toHaveLength(2);
    // an unknown / unbuilt cup falls back to the first complete cup
    expect(quickSetup(parseDebugParams('?mode=gp&cup=nope'), null, CHARACTERS, TRACKS, { cups: CUPS }).cupId).toBe('sprinkle-cup');
    expect(quickSetup(parseDebugParams('?mode=gp&cup=sprinkle-cup&laps=1'), null, CHARACTERS, TRACKS, { cups: CUPS }).laps).toBe(1);
  });

  it('?mode=tt&quick= is always a solo run', () => {
    const s = quickSetup(parseDebugParams('?mode=tt&quick=sundae-slopes&players=4'), null, CHARACTERS, TRACKS, { cups: CUPS });
    expect(s).toMatchObject({ mode: 'time-trial', trackId: 'sundae-slopes' });
    expect(s.players).toHaveLength(1);
  });

  it('plain ?quick= stays a Free Race exactly like before', () => {
    const s = quickSetup(parseDebugParams('?quick=sundae-slopes&players=2'), null, CHARACTERS, TRACKS);
    expect(s.mode).toBeUndefined();
    expect(s.cupId).toBeUndefined();
    expect(Object.keys(s).sort()).toEqual(['laps', 'players', 'speedClass', 'trackId']);
  });
});

describe('mode rules', () => {
  it('Free Race and Grand Prix keep items and CPUs', () => {
    for (const m of ['free', 'grand-prix', undefined, 'nonsense']) {
      expect(rulesForMode(m)).toEqual({ items: true, cpus: true, startItem: null, startItemCharges: 0 });
    }
  });
  it('Time Trial: no item boxes, no CPUs, 3 sprinkle boosts', () => {
    expect(rulesForMode('time-trial')).toEqual({ items: false, cpus: false, startItem: 'triple-sprinkle', startItemCharges: TIME_TRIAL_BOOSTS });
    expect(TIME_TRIAL_BOOSTS).toBe(3);
  });
  it('normalizes odd rules', () => {
    expect(normalizeRules()).toEqual({ items: true, cpus: true, startItem: null, startItemCharges: 0 });
    expect(normalizeRules(null).items).toBe(true);
    expect(normalizeRules({ startItem: 'banana' }).startItem).toBe(null);
    expect(normalizeRules({ startItem: 'gumdrop' }).startItemCharges).toBe(1);
    expect(normalizeRules({ startItem: 'triple-sprinkle', startItemCharges: 99 }).startItemCharges).toBe(9);
    expect(normalizeRules({ items: 0 }).items).toBe(true); // only an explicit false turns items off
    expect(Object.isFrozen(normalizeRules())).toBe(true);
    expect(modeId('time-trial')).toBe('time-trial');
    expect(modeId('x')).toBe('free');
  });
});

describe('modes screens are registered', () => {
  it('mode select (25), cup select (40, GP only) and the one-off screens exist', () => {
    expect(SCREENS.get('mode-select').flow.order).toBe(25);
    expect(SCREENS.get('cup-select').flow.order).toBe(40);
    expect(SCREENS.get('cup-select').flow.when({ draft: { mode: 'grand-prix' } })).toBe(true);
    expect(SCREENS.get('cup-select').flow.when({ draft: { mode: 'free' } })).toBe(false);
    for (const id of ['gp-standings', 'time-trial-results', 'records']) expect(typeof SCREENS.get(id)?.mount).toBe('function');
    expect(menuEntries(SCREENS, 'mode-select').map((e) => e.id)).toContain('records');
    expect(menuEntries(SCREENS, 'title').map((e) => e.id)).not.toContain('records');
  });
});

describe('time trial results model', () => {
  const summary = (h, records) => ({ humans: [h], records });
  const human = { characterId: 'luna', finished: true, estimated: false, finishTime: 58, lapTimes: [20, 19, 19.5] };

  it('new record vs the time to beat, with splits', () => {
    const m = trialResultModel({ summary: summary(human, { previous: { bestRace: 60 }, record: { bestRace: 58, bestLap: 19 }, newBestLap: true }), ghostSaved: true, hadGhost: true });
    expect(m).toMatchObject({ timeText: '0:58.00', newRecord: true, recordText: '0:58.00', beforeText: '1:00.00', lapRecord: true, bestLapText: '0:19.00' });
    expect(m.verdict.kind).toBe('record');
    expect(m.splits.map((s) => s.best)).toEqual([false, true, false]);
    expect(m.ghostLine).toMatch(/ghost/i);
  });

  it('bestBefore (the ghost for these laps) wins over the saved record', () => {
    const m = trialResultModel({ summary: summary(human, { previous: { bestRace: null }, record: { bestRace: null } }), bestBefore: 57 });
    expect(m.verdict.kind).toBe('close');
    expect(m.recordText).toBe('0:57.00');
    expect(m.newRecord).toBe(false);
  });

  it('first run and unfinished runs', () => {
    expect(trialResultModel({ summary: summary(human, null) }).verdict.kind).toBe('first');
    const dnf = trialResultModel({ summary: summary({ ...human, estimated: true }, null) });
    expect(dnf).toMatchObject({ time: null, timeText: '--:--.--', newRecord: false });
    expect(trialResultModel({}).verdict.kind).toBe('dnf');
    expect(trialResultModel({ summary: summary(human, null), hadGhost: true }).ghostLine).toMatch(/still/);
  });
});
