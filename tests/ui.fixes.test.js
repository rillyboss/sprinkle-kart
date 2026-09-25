import { describe, it, expect } from 'vitest';
import {
  createCharSelectState, charSelectReduce, readyExceptDisconnected, allReady,
  createTrackSelectState, SPEED_ORDER, pauseLeadText,
} from '../src/ui/menuState.js';

const ev = (deviceId, action, extra = {}) => ({ deviceId, action, ...extra });
const CHARS = ['rocco', 'lenny', 'stella', 'peachy', 'cotton-candy-girl']
  .map((id) => ({ id, locked: id === 'cotton-candy-girl' }));
const TRACKS = [{ id: 'a', laps: 3 }, { id: 'b', laps: 3 }];

describe('character select with an unplugged controller', () => {
  const players = [{ playerIndex: 0, deviceId: 'gp0' }, { playerIndex: 1, deviceId: 'gp1' }];
  const make = () => createCharSelectState({ players, characters: CHARS, isLocked: (c) => c.locked });

  it('P1 start moves on, treating the unplugged player as ready with their highlight', () => {
    let s = charSelectReduce(make(), ev('gp0', 'confirm')).state;
    expect(readyExceptDisconnected(s, ['gp1'])).toBe(true);
    const r = charSelectReduce(s, ev('gp0', 'start'), { disconnected: ['gp1'] });
    expect(r.go).toBe('next');
    expect(allReady(r.state)).toBe(true);
    expect(r.state.cursors[1].index).toBe(1);
    // without the disconnect info nothing changes (old behaviour)
    s = charSelectReduce(s, ev('gp0', 'start')).state;
    expect(allReady(s)).toBe(false);
  });

  it('an unplugged player parked on a locked tile gets a real racer', () => {
    let s = make();
    s = { ...s, cursors: s.cursors.map((c, i) => (i === 1 ? { ...c, index: 4 } : c)) };
    s = charSelectReduce(s, ev('gp0', 'confirm')).state;
    const r = charSelectReduce(s, ev('gp0', 'start'), { disconnected: ['gp1'] });
    expect(r.go).toBe('next');
    expect(r.state.items[r.state.cursors[1].index].locked).toBe(false);
  });

  it('only P1 can skip for the unplugged player, and only once P1 is ready', () => {
    const s = make();
    expect(charSelectReduce(s, ev('gp0', 'start'), { disconnected: ['gp1'] }).go).toBeNull();
    const players3 = [...players, { playerIndex: 2, deviceId: 'kb1' }];
    let t = createCharSelectState({ players: players3, characters: CHARS, isLocked: (c) => c.locked });
    t = charSelectReduce(t, ev('kb1', 'confirm')).state;
    expect(charSelectReduce(t, ev('kb1', 'start'), { disconnected: ['gp1'] }).go).toBeNull();
  });
});

describe('track select speed default', () => {
  it('starts on Zippy, or Cozy when someone uses Magic Steering', () => {
    expect(SPEED_ORDER[createTrackSelectState({ tracks: TRACKS }).speedIndex]).toBe('zippy');
    expect(SPEED_ORDER[createTrackSelectState({ tracks: TRACKS, easyDrive: true }).speedIndex]).toBe('cozy');
    const prev = { trackId: 'b', speedClass: 'zoomy', laps: 3 };
    expect(SPEED_ORDER[createTrackSelectState({ tracks: TRACKS, previous: prev, easyDrive: true }).speedIndex]).toBe('zoomy');
  });
});

describe('pause message', () => {
  it('reads naturally for a player label or a full sentence', () => {
    expect(pauseLeadText('P2')).toBe('P2 paused the race');
    expect(pauseLeadText("P2's controller took a nap 💤 Plug it back in!")).toBe("P2's controller took a nap 💤 Plug it back in!");
    expect(pauseLeadText('')).toBe('The race is paused');
  });
});
