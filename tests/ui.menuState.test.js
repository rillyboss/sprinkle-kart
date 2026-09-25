import { describe, it, expect } from 'vitest';
import {
  createJoinState, joinReduce,
  createCharSelectState, charSelectReduce, moveGridIndex, gridColumns, allReady, charSelections,
  createTrackSelectState, trackSelectReduce, trackSelection, LAP_OPTIONS, SPEED_ORDER,
  createListState, listReduce, buildRaceSetup,
} from '../src/ui/menuState.js';

const ev = (deviceId, action, extra = {}) => ({ deviceId, action, ...extra });
const run = (reduce, state, events) => events.reduce((s, e) => reduce(s, e).state, state);

const CHARS = ['rocco', 'lenny', 'stella', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy', 'cotton-candy-girl']
  .map((id) => ({ id, locked: id === 'cotton-candy-girl' }));
const TRACKS = [
  { id: 'cotton-candy-castle', laps: 3 },
  { id: 'gumdrop-meadow', laps: 3 },
  { id: 'starlight-galaxy', laps: 2 },
  { id: 'sundae-slopes', laps: 3 },
];

describe('join screen reducer', () => {
  it('joins devices in order as P1..P4', () => {
    const s = run(joinReduce, createJoinState(), [ev('gp0', 'confirm'), ev('kb1', 'confirm'), ev('gp1', 'start')]);
    expect(s.players.map((p) => p.deviceId)).toEqual(['gp0', 'kb1', 'gp1']);
    expect(s.players.map((p) => p.playerIndex)).toEqual([0, 1, 2]);
  });

  it('reports the joined slot and plays the join sound', () => {
    const r = joinReduce(createJoinState(), ev('gp2', 'confirm'));
    expect(r.joined).toBe(0);
    expect(r.fx).toContain('join');
    expect(r.go).toBe(null);
  });

  it('caps at 4 players', () => {
    const s = run(joinReduce, createJoinState(), ['a', 'b', 'c', 'd'].map((d) => ev(d, 'confirm')));
    const r = joinReduce(s, ev('e', 'confirm'));
    expect(r.state.players).toHaveLength(4);
    expect(r.state).toBe(s);
  });

  it('P1 confirm continues; other players confirming just wiggle', () => {
    const s = run(joinReduce, createJoinState(), [ev('gp0', 'confirm'), ev('kb1', 'confirm')]);
    expect(joinReduce(s, ev('kb1', 'confirm')).go).toBe(null);
    expect(joinReduce(s, ev('kb1', 'confirm')).shake).toBe(1);
    expect(joinReduce(s, ev('gp0', 'confirm')).go).toBe('next');
  });

  it('start from any joined player continues', () => {
    const s = run(joinReduce, createJoinState(), [ev('gp0', 'confirm'), ev('kb1', 'confirm')]);
    expect(joinReduce(s, ev('kb1', 'start')).go).toBe('next');
  });

  it('toggle flips Easy Drive only for that player', () => {
    let s = run(joinReduce, createJoinState(), [ev('gp0', 'confirm'), ev('kb1', 'confirm')]);
    s = joinReduce(s, ev('kb1', 'toggle')).state;
    expect(s.players[1].easyDrive).toBe(true);
    expect(s.players[0].easyDrive).toBe(false);
    s = joinReduce(s, ev('kb1', 'toggle')).state;
    expect(s.players[1].easyDrive).toBe(false);
    // toggle from an unjoined device does nothing
    expect(joinReduce(s, ev('gp3', 'toggle')).state).toBe(s);
  });

  it('back leaves and later players slide up', () => {
    let s = run(joinReduce, createJoinState(), [ev('a', 'confirm'), ev('b', 'confirm'), ev('c', 'confirm')]);
    s = joinReduce(s, ev('a', 'back')).state;
    expect(s.players.map((p) => [p.deviceId, p.playerIndex])).toEqual([['b', 0], ['c', 1]]);
  });

  it('back with nobody joined goes back to the title', () => {
    expect(joinReduce(createJoinState(), ev('kb1', 'back')).go).toBe('back');
    const s = run(joinReduce, createJoinState(), [ev('a', 'confirm')]);
    expect(joinReduce(s, ev('kb1', 'back')).go).toBe(null);
  });

  it('keeps previous players and their Easy Drive', () => {
    const s = createJoinState([{ deviceId: 'gp0', easyDrive: true }, { deviceId: 'kb1' }]);
    expect(s.players).toEqual([
      { playerIndex: 0, deviceId: 'gp0', easyDrive: true },
      { playerIndex: 1, deviceId: 'kb1', easyDrive: false },
    ]);
  });

  it('never mutates the previous state', () => {
    const s = createJoinState();
    const frozen = JSON.stringify(s);
    joinReduce(s, ev('a', 'confirm'));
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe('character select reducer', () => {
  const players = [{ playerIndex: 0, deviceId: 'gp0' }, { playerIndex: 1, deviceId: 'kb1' }];
  const make = (extra = {}) => createCharSelectState({ players, characters: CHARS, isLocked: (c) => c.locked, ...extra });

  it('uses a nice grid width', () => {
    expect(gridColumns(9)).toBe(5);
    expect(gridColumns(8)).toBe(4);
    expect(gridColumns(3)).toBe(3);
    expect(make().cols).toBe(5);
  });

  it('staggers starting cursors', () => {
    expect(make().cursors.map((c) => c.index)).toEqual([0, 1]);
  });

  it('restores previous picks by device', () => {
    const s = make({ previous: [{ playerIndex: 5, deviceId: 'kb1', characterId: 'dino' }] });
    expect(s.items[s.cursors[1].index].id).toBe('dino');
  });

  it('does not restore a locked previous pick', () => {
    const s = make({ previous: [{ playerIndex: 0, deviceId: 'gp0', characterId: 'cotton-candy-girl' }] });
    expect(s.items[s.cursors[0].index].locked).toBe(false);
  });

  it('grid navigation wraps', () => {
    expect(moveGridIndex(0, 'left', 9, 5)).toBe(8);
    expect(moveGridIndex(8, 'right', 9, 5)).toBe(0);
    expect(moveGridIndex(1, 'down', 9, 5)).toBe(6);
    expect(moveGridIndex(6, 'down', 9, 5)).toBe(1);
    expect(moveGridIndex(4, 'down', 9, 5)).toBe(8); // short last row clamps
    expect(moveGridIndex(2, 'up', 9, 5)).toBe(7);
    expect(moveGridIndex(2, 'up', 4, 4)).toBe(2); // single row: no-op
  });

  it('each player moves only their own cursor', () => {
    const s = run(charSelectReduce, make(), [ev('kb1', 'right'), ev('kb1', 'right')]);
    expect(s.cursors.map((c) => c.index)).toEqual([0, 3]);
    expect(charSelectReduce(s, ev('nobody', 'right')).state).toBe(s);
  });

  it('confirm locks in with a voice line and blocks movement', () => {
    const r = charSelectReduce(make(), ev('gp0', 'confirm'));
    expect(r.state.cursors[0].ready).toBe(true);
    expect(r.voice).toBe('rocco');
    expect(charSelectReduce(r.state, ev('gp0', 'right')).state.cursors[0].index).toBe(0);
  });

  it('players may pick the same character', () => {
    const s = run(charSelectReduce, make(), [ev('kb1', 'left'), ev('gp0', 'confirm'), ev('kb1', 'confirm')]);
    expect(allReady(s)).toBe(true);
    expect(charSelections(s).map((p) => p.characterId)).toEqual(['rocco', 'rocco']);
  });

  it('locked character cannot be picked (shake instead)', () => {
    const s = run(charSelectReduce, make(), [ev('gp0', 'left')]); // index 8 = cotton candy girl
    const r = charSelectReduce(s, ev('gp0', 'confirm'));
    expect(r.state.cursors[0].ready).toBe(false);
    expect(r.shake).toBe(0);
  });

  it('unlocked Cotton Candy Girl can be picked', () => {
    const s = createCharSelectState({ players, characters: CHARS, isLocked: () => false });
    const r = charSelectReduce(run(charSelectReduce, s, [ev('gp0', 'left')]), ev('gp0', 'confirm'));
    expect(r.state.cursors[0].ready).toBe(true);
    expect(r.voice).toBe('cotton-candy-girl');
  });

  it('back undoes a pick, then P1 back leaves the screen', () => {
    let s = run(charSelectReduce, make(), [ev('gp0', 'confirm')]);
    let r = charSelectReduce(s, ev('gp0', 'back'));
    expect(r.state.cursors[0].ready).toBe(false);
    expect(r.go).toBe(null);
    r = charSelectReduce(r.state, ev('gp0', 'back'));
    expect(r.go).toBe('back');
    // P2 back does not leave
    expect(charSelectReduce(make(), ev('kb1', 'back')).go).toBe(null);
  });

  it('P1 confirm or anyone start continues once everyone is ready', () => {
    const s = run(charSelectReduce, make(), [ev('gp0', 'confirm'), ev('kb1', 'confirm')]);
    expect(charSelectReduce(s, ev('gp0', 'confirm')).go).toBe('next');
    expect(charSelectReduce(s, ev('kb1', 'start')).go).toBe('next');
    expect(charSelectReduce(s, ev('kb1', 'confirm')).go).toBe(null);
  });

  it('start before everyone is ready just locks in', () => {
    const r = charSelectReduce(make(), ev('kb1', 'start'));
    expect(r.go).toBe(null);
    expect(r.state.cursors[1].ready).toBe(true);
  });

  it('mouse pick moves the first not-ready player and confirms', () => {
    let r = charSelectReduce(make(), { deviceId: 'mouse', action: 'pick', index: 3 });
    expect(r.state.cursors[0]).toMatchObject({ index: 3, ready: true });
    r = charSelectReduce(r.state, { deviceId: 'mouse', action: 'pick', index: 6 });
    expect(r.state.cursors[1]).toMatchObject({ index: 6, ready: true });
    expect(charSelectReduce(r.state, { deviceId: 'mouse', action: 'pick', index: 1 }).state).toBe(r.state);
  });
});

describe('track select reducer', () => {
  const make = (extra = {}) => createTrackSelectState({ tracks: TRACKS, controllerId: 'gp0', ...extra });

  it('defaults: first track, zippy, track laps', () => {
    const s = make();
    expect(trackSelection(s, TRACKS)).toEqual({ trackId: 'cotton-candy-castle', speedClass: 'zippy', laps: 3 });
  });

  it('restores previous choices', () => {
    const s = make({ previous: { trackId: 'sundae-slopes', speedClass: 'cozy', laps: 5 } });
    expect(trackSelection(s, TRACKS)).toEqual({ trackId: 'sundae-slopes', speedClass: 'cozy', laps: 5 });
  });

  it('snaps odd lap counts to the nearest option', () => {
    const s = make({ previous: { laps: 4 } });
    expect(LAP_OPTIONS).toContain(trackSelection(s, TRACKS).laps);
  });

  it('only P1 (controller) drives it; mouse is allowed', () => {
    const s = make();
    expect(trackSelectReduce(s, ev('kb1', 'right')).state).toBe(s);
    expect(trackSelectReduce(s, ev('gp0', 'right')).state.trackIndex).toBe(1);
    expect(trackSelectReduce(s, ev('mouse', 'confirm')).go).toBe('next');
  });

  it('rows: track wraps, speed & laps clamp', () => {
    let s = run(trackSelectReduce, make(), [ev('gp0', 'left')]);
    expect(s.trackIndex).toBe(3);
    s = run(trackSelectReduce, s, [ev('gp0', 'down'), ev('gp0', 'right'), ev('gp0', 'right'), ev('gp0', 'right')]);
    expect(SPEED_ORDER[s.speedIndex]).toBe('zoomy');
    s = run(trackSelectReduce, s, [ev('gp0', 'down'), ev('gp0', 'left'), ev('gp0', 'left'), ev('gp0', 'left'), ev('gp0', 'left')]);
    expect(LAP_OPTIONS[s.lapsIndex]).toBe(1);
    s = run(trackSelectReduce, s, [ev('gp0', 'down'), ev('gp0', 'down'), ev('gp0', 'down')]);
    expect(s.row).toBe(3);
    s = run(trackSelectReduce, s, Array(6).fill(ev('gp0', 'up')));
    expect(s.row).toBe(0);
  });

  it('toggle cycles speed class', () => {
    const s = run(trackSelectReduce, make(), [ev('gp0', 'toggle'), ev('gp0', 'toggle')]);
    expect(SPEED_ORDER[s.speedIndex]).toBe('cozy');
  });

  it('pointer set validates and jumps to the row', () => {
    const s = make();
    const r = trackSelectReduce(s, { deviceId: 'mouse', action: 'set', key: 'lapsIndex', value: 3 });
    expect(r.state.lapsIndex).toBe(3);
    expect(r.state.row).toBe(2);
    expect(trackSelectReduce(s, { deviceId: 'mouse', action: 'set', key: 'trackIndex', value: 9 }).state).toBe(s);
    expect(trackSelectReduce(s, { deviceId: 'mouse', action: 'set', key: 'bogus', value: 0 }).state).toBe(s);
  });

  it('confirm races, back goes back', () => {
    expect(trackSelectReduce(make(), ev('gp0', 'confirm')).go).toBe('next');
    expect(trackSelectReduce(make(), ev('gp0', 'start')).go).toBe('next');
    expect(trackSelectReduce(make(), ev('gp0', 'back')).go).toBe('back');
  });
});

describe('list reducer (pause / results)', () => {
  it('moves with wrap and confirms the option id', () => {
    let s = createListState(['resume', 'restart', 'quit']);
    s = listReduce(s, ev('a', 'up')).state;
    expect(s.index).toBe(2);
    s = listReduce(s, ev('a', 'right')).state;
    expect(s.index).toBe(0);
    expect(listReduce(s, ev('a', 'confirm')).go).toBe('resume');
  });

  it('back cancels; start cancels only when asked', () => {
    const s = createListState(['again', 'menu'], 1);
    expect(listReduce(s, ev('a', 'back')).go).toBe('cancel');
    expect(listReduce(s, ev('a', 'start')).go).toBe('menu');
    expect(listReduce(s, ev('a', 'start'), { startCancels: true }).go).toBe('cancel');
  });

  it('pointer select picks directly', () => {
    const s = createListState(['again', 'next-track', 'menu']);
    expect(listReduce(s, { deviceId: 'mouse', action: 'select', index: 1 }).go).toBe('next-track');
    expect(listReduce(s, { deviceId: 'mouse', action: 'select', index: 7 }).go).toBe(null);
  });
});

describe('buildRaceSetup', () => {
  it('assembles a full RaceSetup', () => {
    let join = run(joinReduce, createJoinState(), [ev('gp0', 'confirm'), ev('kb1', 'confirm'), ev('kb1', 'toggle')]);
    let chars = createCharSelectState({ players: join.players, characters: CHARS, isLocked: (c) => c.locked });
    chars = run(charSelectReduce, chars, [ev('gp0', 'right'), ev('gp0', 'right'), ev('gp0', 'confirm'), ev('kb1', 'confirm')]);
    let tracks = createTrackSelectState({ tracks: TRACKS, controllerId: 'gp0' });
    tracks = run(trackSelectReduce, tracks, [ev('gp0', 'right'), ev('gp0', 'toggle')]);
    expect(buildRaceSetup(join, chars, tracks, TRACKS)).toEqual({
      players: [
        { playerIndex: 0, deviceId: 'gp0', characterId: 'stella', easyDrive: false },
        { playerIndex: 1, deviceId: 'kb1', characterId: 'lenny', easyDrive: true },
      ],
      trackId: 'gumdrop-meadow',
      speedClass: 'zoomy',
      laps: 3,
    });
  });
});
