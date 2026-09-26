import { describe, it, expect } from 'vitest';
import {
  MY_CUP_ID, MY_CUP_SIZE, MY_CUP_KEY, myCupDef, createMyCupState, myCupReduce, myCupReady, myCupStore, myCupSetup,
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

  it('on the Go button: A starts, arrows go back to the grid, Y undoes', () => {
    const full = createMyCupState({ trackIds: IDS, picks: ['a', 'b', 'c', 'd'] });
    expect(myCupReduce(full, ev('confirm'))).toMatchObject({ go: 'go', fx: ['confirm'] });
    expect(myCupReduce(full, ev('start')).go).toBe('go');
    expect(myCupReduce(full, ev('down')).state.focus).toBe('grid');
    const undo = myCupReduce(full, ev('toggle')).state;
    expect(undo).toMatchObject({ focus: 'grid', picks: ['a', 'b', 'c'] });
    expect(myCupReduce(full, ev('back')).go).toBe('back');
    expect(myCupReduce(full, { deviceId: 'mouse', action: 'pick', index: 0 }).state.picks).toEqual(['b', 'c', 'd']);
    expect(myCupReduce(full, ev('noise')).state).toBe(full);
    // a not-full cup on 'go' (should not happen) just returns to the grid
    expect(myCupReduce({ ...full, picks: ['a'] }, ev('confirm')).state.focus).toBe('grid');
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
    expect(myCupDef(['a', 'b', 'c', 'd', 'e'])).toEqual({ id: MY_CUP_ID, name: 'My Cup', emoji: '✨', trackIds: ['a', 'b', 'c', 'd'] });
    expect(getCup(MY_CUP_ID)).toBeFalsy();
  });

  it('myCupSetup is a Grand Prix RaceSetup carrying the custom tracks', () => {
    const players = [{ playerIndex: 0, deviceId: 'kb1', characterId: 'rocco', easyDrive: false }];
    expect(myCupSetup(players, ['b', 'a', 'c', 'd'], 'cozy')).toEqual({
      players, trackId: 'b', speedClass: 'cozy', laps: null, mode: 'grand-prix', cupId: MY_CUP_ID, customTrackIds: ['b', 'a', 'c', 'd'],
    });
  });

  it('remembers the last custom cup', () => {
    const backend = memoryBackend();
    expect(myCupStore(backend).load()).toEqual([]);
    myCupStore(backend).save(['a', 'b', 'c', 'd', 'e']);
    expect(JSON.parse(backend.getItem(MY_CUP_KEY))).toEqual({ trackIds: ['a', 'b', 'c', 'd'] });
    expect(myCupStore(backend).load()).toEqual(['a', 'b', 'c', 'd']);
    backend.setItem(MY_CUP_KEY, JSON.stringify({ trackIds: [1, 'x'] }));
    expect(myCupStore(backend).load()).toEqual(['x']);
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
    expect(p.stats.cupsWon).toBe(1);
    expect(p.cups[MY_CUP_ID].wins).toBe(1);
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
