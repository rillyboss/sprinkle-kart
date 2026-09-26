import { describe, it, expect } from 'vitest';
import {
  MY_CUP_ID, MY_CUP_SIZE, MY_CUP_KEY, MY_CUP_EMOJIS, MY_CUP_NAMES, MY_CUP_BAR, OWNER_NAME,
  myCupDef, createMyCupState, myCupReduce, myCupReady, myCupStore, myCupSetup,
  myCupName, myCupEmoji, myCupSaved, myCupNameChoices, resolveCupName, myCupCard,
} from '../src/modes/myCup.js';
import { memoryBackend } from '../src/modes/storage.js';
import { createGrandPrix, gpRaceSetup, gpRecordRace, gpNextRace } from '../src/modes/grandPrix.js';
import { applyGrandPrix, applyRaceSummary } from '../src/progress/engine.js';
import { emptyProgress, mergeProgress } from '../src/progress/schema.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { getCup } from '../src/data/cups.js';

const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const ev = (action, extra = {}) => ({ deviceId: 'kb1', action, ...extra });
const run = (s, ...events) => events.reduce((st, e) => myCupReduce(st, typeof e === 'string' ? ev(e) : e).state, s);

describe('My Cup builder reducer', () => {
  it('starts empty on the first track; remembered picks come back (known ids only, max 4)', () => {
    const s = createMyCupState({ trackIds: IDS, cols: 3, controllerId: 'kb1' });
    expect(s).toMatchObject({ picks: [], cursor: 0, focus: 'grid', cols: 3 });
    const r = createMyCupState({ trackIds: IDS, picks: ['c', 'zzz', 'c', 'a', 'b', 'd', 'e'] });
    expect(r.picks).toEqual(['c', 'a', 'b', 'd']);
    expect(r.focus).toBe('go'); // a full remembered cup is ready to start
    expect(createMyCupState().trackIds).toEqual([]);
  });

  it('arrows walk the grid (wrapping left/right, rows by cols)', () => {
    let s = createMyCupState({ trackIds: IDS, cols: 3 });
    s = run(s, 'left');
    expect(s.cursor).toBe(6);
    s = run(s, 'right');
    expect(s.cursor).toBe(0);
    s = run(s, 'down', 'down');
    expect(s.cursor).toBe(6);
    expect(run(s, 'down').cursor).toBe(6); // no row below
    expect(run(s, 'up').cursor).toBe(3);
    expect(run(createMyCupState({ trackIds: IDS, cols: 3 }), 'up').cursor).toBe(0);
  });

  it('A adds a track in order, A again takes it out; the 4th pick jumps to the Go button', () => {
    let s = createMyCupState({ trackIds: IDS, cols: 3 });
    let r = myCupReduce(s, ev('confirm'));
    expect(r.state.picks).toEqual(['a']);
    expect(r.fx).toEqual(['confirm']);
    s = run(r.state, 'right', 'right', 'confirm');
    expect(s.picks).toEqual(['a', 'c']);
    s = run(s, 'left', 'left', 'confirm'); // take 'a' out again
    expect(s.picks).toEqual(['c']);
    s = run(s, { deviceId: 'mouse', action: 'pick', index: 4 }, { deviceId: 'mouse', action: 'pick', index: 5 });
    expect(s.picks).toEqual(['c', 'e', 'f']);
    r = myCupReduce(s, { deviceId: 'mouse', action: 'pick', index: 6 });
    expect(r.state.picks).toEqual(['c', 'e', 'f', 'g']);
    expect(r.fx).toEqual(['unlock']);
    expect(r.state.focus).toBe('go');
    expect(myCupReady(r.state)).toBe(true);
  });

  it('on the Go button: A starts, Down goes back to the grid, Left walks the bar, Y undoes', () => {
    const full = createMyCupState({ trackIds: IDS, picks: ['a', 'b', 'c', 'd'] });
    expect(myCupReduce(full, ev('confirm'))).toMatchObject({ go: 'go', fx: ['confirm'] });
    expect(myCupReduce(full, ev('start')).go).toBe('go');
    expect(myCupReduce(full, ev('down')).state.focus).toBe('grid');
    expect(myCupReduce(full, ev('left')).state.focus).toBe('name');
    expect(myCupReduce(full, ev('right')).state).toBe(full); // end of the bar
    expect(myCupReduce(full, ev('up')).state).toBe(full);
    const undo = myCupReduce(full, ev('toggle')).state;
    expect(undo).toMatchObject({ focus: 'grid', picks: ['a', 'b', 'c'] });
    expect(myCupReduce(full, ev('back')).go).toBe('back');
    expect(myCupReduce(full, { deviceId: 'mouse', action: 'pick', index: 0 }).state.picks).toEqual(['b', 'c', 'd']);
    expect(myCupReduce(full, ev('noise')).state).toBe(full);
    // a not-full cup on 'go' wiggles the button instead of starting
    expect(myCupReduce({ ...full, picks: ['a'] }, ev('confirm'))).toMatchObject({ go: null, shake: 'go' });
  });

  it('a full cup refuses a 5th track (wiggle), Start needs 4, Y undoes the last pick', () => {
    let s = createMyCupState({ trackIds: IDS, picks: ['a', 'b', 'c', 'd'] });
    s = { ...s, focus: 'grid', cursor: 5 };
    const r = myCupReduce(s, ev('confirm'));
    expect(r.shake).toBe('slots');
    expect(r.state.picks).toHaveLength(MY_CUP_SIZE);
    const half = createMyCupState({ trackIds: IDS, picks: ['a', 'b'] });
    expect(myCupReduce(half, ev('start'))).toMatchObject({ go: null, shake: 'go' });
    expect(run(half, 'toggle').picks).toEqual(['a']);
    expect(run(createMyCupState({ trackIds: IDS }), 'toggle').picks).toEqual([]);
    expect(myCupReduce(half, ev('back')).go).toBe('back');
  });

  it('ignores other controllers; pointer set/pick bounds', () => {
    const s = createMyCupState({ trackIds: IDS, controllerId: 'kb1' });
    expect(myCupReduce(s, { deviceId: 'gp3', action: 'confirm' }).state).toBe(s);
    expect(myCupReduce(s, { deviceId: 'mouse', action: 'set', key: 'cursor', value: 4 }).state.cursor).toBe(4);
    expect(myCupReduce(s, { deviceId: 'mouse', action: 'set', key: 'cursor', value: 99 }).state).toBe(s);
    expect(myCupReduce(s, { deviceId: 'mouse', action: 'pick', index: -1 }).state).toBe(s);
    const empty = createMyCupState({ trackIds: [] });
    expect(run(empty, 'left', 'down', 'confirm')).toEqual(empty);
  });
});

describe('My Cup def, setup and storage', () => {
  it('myCupDef is a cup-shaped object (4 tracks max) that is not a real cup', () => {
    expect(myCupDef(['a', 'b', 'c', 'd', 'e'])).toEqual({ id: MY_CUP_ID, name: 'My Cup', emoji: '✨', trackIds: ['a', 'b', 'c', 'd'], custom: true });
    expect(myCupDef(['a', 'a', 'b'], { name: 'Rainbow Cup', emoji: '🦄' })).toMatchObject({ name: 'Rainbow Cup', emoji: '🦄', trackIds: ['a', 'b'] });
    // junk name / emoji fall back safely; long names are trimmed
    expect(myCupDef([], { name: '   ', emoji: 'X' })).toMatchObject({ name: 'My Cup', emoji: '✨' });
    expect(myCupDef([], { name: 'x'.repeat(80) }).name).toHaveLength(24);
    expect(myCupDef()).toMatchObject({ trackIds: [] });
    expect(getCup(MY_CUP_ID)).toBeFalsy();
  });

  it('myCupSetup is a Grand Prix RaceSetup carrying the custom tracks', () => {
    const players = [{ playerIndex: 0, deviceId: 'kb1', characterId: 'rocco', easyDrive: false }];
    expect(myCupSetup(players, ['b', 'a', 'c', 'd', 'e'], 'cozy')).toEqual({
      players, trackId: 'b', speedClass: 'cozy', laps: null, mode: 'grand-prix', cupId: MY_CUP_ID,
      customTrackIds: ['b', 'a', 'c', 'd'], customCup: { name: 'My Cup', emoji: '✨' },
    });
    expect(myCupSetup(players, ['a', 'b', 'c', 'd'], 'zippy', { name: "Rocco's Cup", emoji: '🚀' }).customCup)
      .toEqual({ name: "Rocco's Cup", emoji: '🚀' });
  });

  it('remembers the last custom cup', () => {
    const backend = memoryBackend();
    expect(myCupStore(backend).load()).toEqual({ trackIds: [], name: null, emoji: null });
    myCupStore(backend).save({ trackIds: ['a', 'b', 'c', 'd', 'e'], name: 'Giggle Cup', emoji: '🐰' });
    expect(JSON.parse(backend.getItem(MY_CUP_KEY))).toEqual({ trackIds: ['a', 'b', 'c', 'd'], name: 'Giggle Cup', emoji: '🐰' });
    expect(myCupStore(backend).load()).toEqual({ trackIds: ['a', 'b', 'c', 'd'], name: 'Giggle Cup', emoji: '🐰' });
    // the owner token is kept as a token (the racer can change next time)
    myCupStore(backend).save({ trackIds: ['a'], name: OWNER_NAME, emoji: '✨' });
    expect(myCupStore(backend).load().name).toBe(OWNER_NAME);
    // hand-edited / old / broken saves are cleaned
    backend.setItem(MY_CUP_KEY, JSON.stringify({ trackIds: [1, 'x'], name: '<b>hi</b>', emoji: 42 }));
    expect(myCupStore(backend).load()).toEqual({ trackIds: ['x'], name: null, emoji: null });
    backend.setItem(MY_CUP_KEY, '{nope');
    expect(myCupStore(backend).load()).toEqual({ trackIds: [], name: null, emoji: null });
    myCupStore(backend).save();
    expect(myCupStore(backend).load()).toEqual({ trackIds: [], name: null, emoji: null });
  });

  it('a custom cup runs through the Grand Prix reducer and progression like any cup', () => {
    const trackIds = ['gumdrop-meadow', 'sundae-slopes', 'bubblegum-bay', 'cotton-candy-castle'];
    let gp = createGrandPrix({ cupId: MY_CUP_ID, trackIds, cpuIds: ['lenny'] });
    const standings = [
      { characterId: 'rocco', playerIndex: 0, isCPU: false, place: 1 },
      { characterId: 'lenny', playerIndex: null, isCPU: true, place: 2 },
    ];
    for (let i = 0; i < 4; i++) {
      const s = gpRaceSetup(gp, { players: [], mode: 'grand-prix', cupId: MY_CUP_ID, customTrackIds: trackIds });
      expect(s.trackId).toBe(trackIds[i]);
      expect(s.customTrackIds).toEqual(trackIds);
      gp = gpRecordRace(gp, { standings });
      if (i < 3) gp = gpNextRace(gp);
    }
    expect(gp.phase).toBe('done');
    expect(gp.result.raceCount).toBe(4);
    expect(gp.result.humanWinner).toEqual({ playerIndex: 0, characterId: 'rocco' });
    const p = mergeProgress(emptyProgress());
    applyGrandPrix(p, gp.result);
    // a family-built cup is a finished Grand Prix, but never a cup trophy / "win a cup" unlock
    expect(p.stats.grandPrixFinished).toBe(1);
    expect(p.stats.cupsWon).toBe(0);
    expect(p.cups[MY_CUP_ID]).toBeUndefined();
    applyRaceSummary(p, { mode: 'grand-prix', cupId: MY_CUP_ID, trackId: 'gumdrop-meadow', humanCount: 1, humans: [{ playerIndex: 0, characterId: 'rocco', place: 1, finished: true, estimated: false }] });
    expect(p.tracks['gumdrop-meadow'].wins).toBe(1);
  });

  it('the builder screen is registered (not part of the flow)', () => {
    const s = SCREENS.get('my-cup');
    expect(typeof s?.mount).toBe('function');
    expect(s.flow).toBeUndefined();
    expect(s.menuEntry).toBeUndefined();
  });
});

describe('My Cup name + badge', () => {
  it('the top bar is emoji → name → Start', () => {
    expect(MY_CUP_BAR).toEqual(['emoji', 'name', 'go']);
    expect(MY_CUP_EMOJIS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(MY_CUP_EMOJIS).size).toBe(MY_CUP_EMOJIS.length);
    expect(new Set(MY_CUP_NAMES).size).toBe(MY_CUP_NAMES.length);
    for (const n of MY_CUP_NAMES) if (n !== OWNER_NAME) expect(n).toMatch(/Cup$/);
  });

  it("names: the owner name only appears when we know P1's racer", () => {
    expect(myCupNameChoices('')).not.toContain(OWNER_NAME);
    expect(myCupNameChoices('Rocco')).toContain(OWNER_NAME);
    expect(resolveCupName(OWNER_NAME, 'Rocco')).toBe("Rocco's Cup");
    expect(resolveCupName(OWNER_NAME, '')).toBe('My Cup');
    expect(resolveCupName('Dream Cup', 'Rocco')).toBe('Dream Cup');
    expect(resolveCupName('', 'Rocco')).toBe('My Cup');
  });

  it('starts as "My Cup" ✨; remembered name / badge come back', () => {
    const s = createMyCupState({ trackIds: IDS, owner: 'Rocco' });
    expect(myCupName(s)).toBe('My Cup');
    expect(myCupEmoji(s)).toBe('✨');
    const r = createMyCupState({ trackIds: IDS, owner: 'Rocco', name: OWNER_NAME, emoji: '🍓' });
    expect(myCupName(r)).toBe("Rocco's Cup");
    expect(myCupEmoji(r)).toBe('🍓');
    // the owner token without a racer falls back to the first name
    expect(myCupName(createMyCupState({ trackIds: IDS, name: OWNER_NAME }))).toBe('My Cup');
    expect(myCupEmoji(createMyCupState({ trackIds: IDS, emoji: 'nope' }))).toBe('✨');
  });

  it('Up from the top row goes to the bar (name chip, or Start when full); Down comes back', () => {
    let s = createMyCupState({ trackIds: IDS, cols: 3 });
    s = run(s, 'right', 'up');
    expect(s).toMatchObject({ focus: 'name', cursor: 1 });
    expect(run(s, 'down')).toMatchObject({ focus: 'grid', cursor: 1 });
    const full = { ...createMyCupState({ trackIds: IDS, cols: 3, picks: ['a', 'b', 'c', 'd'] }), focus: 'grid' };
    expect(run(full, 'up').focus).toBe('go');
    // from a lower row Up is just a row up
    expect(run({ ...s, focus: 'grid', cursor: 4 }, 'up')).toMatchObject({ focus: 'grid', cursor: 1 });
  });

  it('A on the chips cycles the badge / name (wrapping); Left/Right walk the bar', () => {
    let s = { ...createMyCupState({ trackIds: IDS, owner: 'Rocco' }), focus: 'name' };
    let r = myCupReduce(s, ev('confirm'));
    expect(myCupName(r.state)).toBe("Rocco's Cup");
    expect(r.fx).toEqual(['move']);
    s = run(r.state, 'left');
    expect(s.focus).toBe('emoji');
    expect(myCupReduce(s, ev('left')).state).toBe(s); // start of the bar: nothing happens
    s = run(s, 'confirm', 'confirm');
    expect(myCupEmoji(s)).toBe(MY_CUP_EMOJIS[2]);
    for (let i = 0; i < MY_CUP_EMOJIS.length - 2; i++) s = run(s, 'confirm');
    expect(myCupEmoji(s)).toBe(MY_CUP_EMOJIS[0]);
    s = run(s, 'right', 'right');
    expect(s.focus).toBe('go');
    // Start button on a half cup wiggles
    r = myCupReduce(s, ev('confirm'));
    expect(r).toMatchObject({ go: null, shake: 'go' });
  });

  it('pointer: cycle a chip from anywhere; set focus; pick jumps back to the grid', () => {
    const s = createMyCupState({ trackIds: IDS });
    let r = myCupReduce(s, { deviceId: 'mouse', action: 'cycle', key: 'emoji' });
    expect(r.state).toMatchObject({ focus: 'emoji', emojiIndex: 1 });
    r = myCupReduce(r.state, { deviceId: 'mouse', action: 'cycle', key: 'name' });
    expect(r.state).toMatchObject({ focus: 'name', nameIndex: 1 });
    expect(myCupReduce(s, { deviceId: 'mouse', action: 'cycle', key: 'nope' }).state).toBe(s);
    expect(myCupReduce(s, { deviceId: 'mouse', action: 'set', key: 'focus', value: 'go' }).state.focus).toBe('go');
    expect(myCupReduce(s, { deviceId: 'mouse', action: 'set', key: 'focus', value: 'moon' }).state).toBe(s);
    r = myCupReduce(r.state, { deviceId: 'mouse', action: 'pick', index: 2 });
    expect(r.state).toMatchObject({ focus: 'grid', picks: ['c'] });
    expect(myCupReduce(r.state, { deviceId: 'mouse', action: 'set', key: 'cursor', value: 3 }).state.focus).toBe('grid');
  });

  it('Y on a chip undoes the last pick but keeps the focus there', () => {
    const s = { ...createMyCupState({ trackIds: IDS, picks: ['a', 'b'] }), focus: 'emoji' };
    expect(run(s, 'toggle')).toMatchObject({ focus: 'emoji', picks: ['a'] });
    expect(run({ ...s, picks: [] }, 'toggle').picks).toEqual([]);
  });

  it('Start / B work from the bar too', () => {
    const full = { ...createMyCupState({ trackIds: IDS, picks: ['a', 'b', 'c', 'd'] }), focus: 'emoji' };
    expect(myCupReduce(full, ev('start')).go).toBe('go');
    expect(myCupReduce(full, ev('back')).go).toBe('back');
    expect(myCupReduce({ ...full, trackIds: [] }, ev('down')).state.focus).toBe('emoji'); // no grid to go to
  });

  it('myCupSaved captures tracks + name key + badge (round-trips through the store)', () => {
    let s = createMyCupState({ trackIds: IDS, owner: 'Rocco', picks: ['d', 'a'] });
    s = run(s, { deviceId: 'mouse', action: 'cycle', key: 'name' }, { deviceId: 'mouse', action: 'cycle', key: 'emoji' });
    const saved = myCupSaved(s);
    expect(saved).toEqual({ trackIds: ['d', 'a'], name: OWNER_NAME, emoji: MY_CUP_EMOJIS[1] });
    const backend = memoryBackend();
    myCupStore(backend).save(saved);
    const loaded = myCupStore(backend).load();
    const back = createMyCupState({ trackIds: IDS, owner: 'Stella', picks: loaded.trackIds, name: loaded.name, emoji: loaded.emoji });
    expect(myCupName(back)).toBe("Stella's Cup");
    expect(back.picks).toEqual(['d', 'a']);
  });

  it('myCupCard shows the remembered cup on cup select (unlocked tracks only)', () => {
    const names = { a: 'Apple Lane', b: 'Berry Bay', c: 'Cocoa Cove' };
    const tn = (id) => names[id] ?? null;
    expect(myCupCard(null, tn)).toEqual({ name: 'My Cup', emoji: '✨', rows: [null, null, null, null], remembered: false });
    expect(myCupCard({ trackIds: ['b', 'zz', 'a'], name: 'Dream Cup', emoji: '🌸' }, tn))
      .toEqual({ name: 'Dream Cup', emoji: '🌸', rows: ['Berry Bay', 'Apple Lane', null, null], remembered: true });
    expect(myCupCard({ trackIds: ['a'], name: OWNER_NAME, emoji: 'bad' }, tn, 'Peachy'))
      .toMatchObject({ name: "Peachy's Cup", emoji: '✨' });
    expect(myCupCard({ trackIds: [3, 'zz'] }, tn).remembered).toBe(false);
  });
});

describe('My Cup quick start (?mode=gp&cup=my-cup&mycup=...)', () => {
  it('parses the track list and builds a custom Grand Prix setup (known tracks only, 4 max, no repeats)', async () => {
    const { parseDebugParams, quickSetup, wantsQuickStart } = await import('../src/game/setup.js');
    const { CHARACTERS } = await import('../src/data/characters.js');
    const { TRACKS } = await import('../src/data/tracks.js');
    const { CUPS } = await import('../src/data/cups.js');
    const [t1, t2, t3, t4, t5] = TRACKS.map((t) => t.id);
    const q = `?mode=gp&cup=my-cup&mycup=${t3}, ${t1},nope,${t3},${t4},${t2},${t5}`;
    const params = parseDebugParams(q);
    expect(params.myCup).toEqual([t3, t1, 'nope', t3, t4, t2, t5]);
    expect(wantsQuickStart(params)).toBe(true);
    const setup = quickSetup(params, null, CHARACTERS, TRACKS, { cups: CUPS });
    expect(setup).toMatchObject({ mode: 'grand-prix', cupId: MY_CUP_ID, trackId: t3, laps: null, customTrackIds: [t3, t1, t4, t2] });
    expect(parseDebugParams('').myCup).toBeNull();
    // my-cup with no usable tracks falls back to the first real cup
    const fallback = quickSetup(parseDebugParams('?mode=gp&cup=my-cup&mycup=nope'), null, CHARACTERS, TRACKS, { cups: CUPS });
    expect(fallback.cupId).not.toBe(MY_CUP_ID);
    expect(fallback.customTrackIds).toBeUndefined();
    // a real cup never carries custom tracks
    expect(quickSetup(parseDebugParams(`?mode=gp&cup=${CUPS[0].id}&mycup=${t1}`), null, CHARACTERS, TRACKS, { cups: CUPS }).customTrackIds).toBeUndefined();
  });
});
