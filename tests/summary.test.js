import { describe, it, expect } from 'vitest';
import { createRaceStats, emptyPlayerStats } from '../src/game/raceStats.js';
import { raceStartInfo, buildRaceSummary, MODES } from '../src/game/summary.js';
import { createSessionHelpers } from '../src/game/session.js';

const human = (pi) => ({ playerIndex: pi, isCPU: false });
const cpu = () => ({ playerIndex: null, isCPU: true });

describe('race stats collector', () => {
  it('counts items, bonks, turbos, boosts, boxes and bumps per human', () => {
    const st = createRaceStats();
    const a = human(0);
    const b = human(1);
    const c = cpu();
    const evs = [
      { type: 'item-use', kart: a, item: 'gumdrop' },
      { type: 'item-use', kart: c, item: 'gumdrop' },
      { type: 'bonked', kart: c, by: a },
      { type: 'bonked', kart: b, by: a },
      { type: 'bonked', kart: a, by: a }, // own gumdrop: not a bonk given
      { type: 'drift-boost', kart: a, level: 1 },
      { type: 'drift-boost', kart: a, level: 3 },
      { type: 'drift-boost', kart: a, level: 0 },
      { type: 'boost', kart: a, source: 'pad' },
      { type: 'item-box', kart: b, rolling: true },
      { type: 'bump', kart: a, other: b, strength: 0.3 },
      null,
      { type: 'lap', kart: a, lap: 2 },
    ];
    evs.forEach((e) => st.onEvent(e));
    expect(st.forPlayer(0)).toEqual({ itemsUsed: 1, bonksGiven: 2, bonked: 1, miniTurbos: 2, driftBoosts: [1, 0, 1], boosts: 1, itemBoxes: 0, bumps: 1 });
    expect(st.forPlayer(1)).toMatchObject({ bonked: 1, itemBoxes: 1, bumps: 1, bonksGiven: 0 });
    expect(st.forPlayer(3)).toEqual(emptyPlayerStats());
    // returned objects are copies
    st.forPlayer(0).driftBoosts[0] = 99;
    expect(st.forPlayer(0).driftBoosts[0]).toBe(1);
  });
});

describe('race-start / race-end payloads', () => {
  const setup = {
    players: [], speedClass: 'cozy', trackId: 'gumdrop-meadow', laps: 3,
  };
  const trackDef = { id: 'gumdrop-meadow', cup: 'sprinkle-cup' };
  const humans = [
    { playerIndex: 0, deviceId: 'kb1', characterId: 'rocco', easyDrive: true },
    { playerIndex: 1, deviceId: 'gp0', characterId: 'bizzy', easyDrive: false },
  ];

  it('raceStartInfo describes mode, track, cup and humans (kidAssist from easyDrive)', () => {
    const info = raceStartInfo({ setup, trackDef, humans, cpuIds: ['lenny'], laps: 3 });
    expect(info).toEqual({
      mode: 'free', trackId: 'gumdrop-meadow', cupId: 'sprinkle-cup', speedClass: 'cozy', laps: 3,
      humans: [
        { playerIndex: 0, deviceId: 'kb1', characterId: 'rocco', kidAssist: true },
        { playerIndex: 1, deviceId: 'gp0', characterId: 'bizzy', kidAssist: false },
      ],
      cpuCharacterIds: ['lenny'],
    });
    expect(raceStartInfo({ setup: { ...setup, mode: 'grand-prix', cupId: 'bubble-cup' }, trackDef, humans, laps: 3 }))
      .toMatchObject({ mode: 'grand-prix', cupId: 'bubble-cup' });
    expect(raceStartInfo({ setup: { ...setup, mode: 'bogus' }, trackDef, humans, laps: 3 }).mode).toBe('free');
    expect(MODES).toEqual(['free', 'grand-prix', 'time-trial', 'team', 'battle', 'daily', 'tutorial']);
  });

  it('buildRaceSummary gives places, times, lap times, winner, stats and an unlock collector', () => {
    const stats = createRaceStats();
    const k0 = { characterId: 'rocco', playerIndex: 0, isCPU: false, finishPlace: 2, finished: true, finishTime: 71.5, lapTimes: [24, 23.5, 24] };
    const k1 = { characterId: 'bizzy', playerIndex: 1, isCPU: false, finishPlace: 5, finished: true, finishTime: 80, finishEstimated: true, lapTimes: [26] };
    const c0 = { characterId: 'lenny', playerIndex: null, isCPU: true, finishPlace: 1, finished: true, finishTime: 70 };
    stats.onEvent({ type: 'item-use', kart: k0 });
    stats.onEvent({ type: 'drift-boost', kart: k1, level: 2 });
    const s = buildRaceSummary({ setup, trackDef, humans, standings: [c0, k0, k1], stats, laps: 3, raceTime: 81 });
    expect(s).toMatchObject({ mode: 'free', trackId: 'gumdrop-meadow', cupId: 'sprinkle-cup', humanCount: 2, raceTime: 81, winner: null, unlocks: [] });
    expect(s.humans[0]).toMatchObject({ playerIndex: 0, characterId: 'rocco', kidAssist: true, place: 2, finished: true, estimated: false, finishTime: 71.5, lapTimes: [24, 23.5, 24] });
    expect(s.humans[1]).toMatchObject({ place: 5, estimated: true });
    expect(s.humans[0].stats.itemsUsed).toBe(1);
    expect(s.totals).toEqual({ itemsUsed: 1, bonksGiven: 0, miniTurbos: 1 });
    expect(s.standings.map((r) => [r.characterId, r.place, r.isCPU])).toEqual([['lenny', 1, true], ['rocco', 2, false], ['bizzy', 5, false]]);
  });

  it('only a real (not estimated) human 1st place is a winner', () => {
    const k0 = { characterId: 'rocco', playerIndex: 0, isCPU: false, finishPlace: 1, finished: true, finishTime: 50 };
    expect(buildRaceSummary({ setup, trackDef, humans, standings: [k0], laps: 3 }).winner).toEqual({ playerIndex: 0, characterId: 'rocco' });
    const est = { ...k0, finishEstimated: true };
    expect(buildRaceSummary({ setup, trackDef, humans, standings: [est], laps: 3 }).winner).toBe(null);
  });

  it('falls back to the lineup cup when the def has none', () => {
    const s = buildRaceSummary({ setup, trackDef: { id: 'bubblegum-bay' }, humans: [], standings: [], laps: 1 });
    expect(s.cupId).toBe('bubble-cup');
  });
});

describe('session helpers', () => {
  it('only reaches humans, never throws on broken audio/input/hud', () => {
    const boom = () => { throw new Error('x'); };
    const h = createSessionHelpers({
      humans: [{ playerIndex: 0, deviceId: 'kb1' }],
      audio: { sfx: boom, voice: boom }, input: { rumble: boom }, hud: { flash: boom },
      getCharacter: () => ({ id: 'rocco' }),
    });
    const k = { playerIndex: 0, isCPU: false, characterId: 'rocco' };
    expect(() => { h.sfx('go'); h.voice(k, 'yay'); h.rumble(k, 1, 10); h.flash(k, 'hi'); }).not.toThrow();
    expect(h.deviceFor(k)).toBe('kb1');
    expect(h.deviceFor({ isCPU: true, playerIndex: null })).toBe(null);
    expect(h.isHuman(null)).toBe(false);
    expect(h.panFor(k)).toBe(0);
  });
});
