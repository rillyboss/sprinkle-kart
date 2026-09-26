import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/data/characters.js', async () => (await import('./raceHelpers.js')).characterMock());

import { makeRace, cpuParticipants, humanParticipants, skipCountdown, input, runRace } from './raceHelpers.js';
import { rulesForMode } from '../src/modes/rules.js';
import { createGhostRecorder, encodeGhost, decodeGhost, ghostPoseAt, ghostGap } from '../src/modes/ghost.js';
import { buildRaceSummary } from '../src/game/summary.js';
import { recordCandidates } from '../src/modes/timing.js';

const mixed = () => [...cpuParticipants(6), ...humanParticipants(2)];

describe('Race rule toggles', () => {
  it('defaults keep the Free Race exactly as before', async () => {
    const race = await makeRace({ participants: mixed() });
    expect(race.rules).toEqual({ items: true, cpus: true, startItem: null, startItemCharges: 0 });
    expect(race.karts).toHaveLength(8);
    expect(race.itemBoxes.boxes.length).toBeGreaterThan(0);
    expect(race.karts.every((k) => k.item === null)).toBe(true);
    expect(race.modeInfo).toEqual({});
  });

  it('cpus: false drops every CPU participant', async () => {
    const { Race } = await import('../src/race/Race.js');
    const base = await makeRace({ participants: mixed() });
    const race = new Race({ scene: base.__scene, trackDef: { laps: 1 }, path: base.path, participants: mixed(), rules: { cpus: false }, seed: 2 });
    expect(race.karts).toHaveLength(2);
    expect(race.karts.every((k) => !k.isCPU)).toBe(true);
    expect(race.brains.size).toBe(0);
  });

  it('items: false means no item boxes on the track', { timeout: 60000 }, async () => {
    const { Race } = await import('../src/race/Race.js');
    const base = await makeRace({ participants: mixed() });
    const on = new Race({ scene: base.__scene, trackDef: { laps: 1 }, path: base.path, participants: mixed(), seed: 3 });
    const off = new Race({ scene: base.__scene, trackDef: { laps: 1 }, path: base.path, participants: mixed(), rules: { items: false }, seed: 3 });
    expect(on.itemBoxes.boxes.length).toBeGreaterThan(0);
    expect(off.itemBoxes.boxes).toHaveLength(0);
    // driving the whole lap never rolls an item
    const { aiDriveInput } = await import('../src/race/Race.js');
    skipCountdown(off);
    runRace(off, { maxSeconds: 200, inputs: (r) => r.karts.filter((k) => !k.isCPU).reduce((a, k) => { a[k.playerIndex] = aiDriveInput(r, k, 1 / 60); return a; }, []) });
    expect(off.state).toBe('finished');
    expect(off.karts.every((k) => k.item === null || k.item === undefined)).toBe(true);
  });

  it('starting items go to humans only, with charges', async () => {
    const { Race } = await import('../src/race/Race.js');
    const base = await makeRace({ participants: mixed() });
    const race = new Race({ scene: base.__scene, trackDef: { laps: 1 }, path: base.path, participants: mixed(), rules: { startItem: 'triple-sprinkle', startItemCharges: 3 }, seed: 4 });
    for (const k of race.karts) {
      if (k.isCPU) expect(k.item).toBe(null);
      else expect([k.item, k.itemCharges]).toEqual(['triple-sprinkle', 3]);
    }
  });

  it('a Time Trial race: solo, no boxes, 3 boosts that count down as they are used', async () => {
    const { Race } = await import('../src/race/Race.js');
    const events = [];
    const base = await makeRace({ participants: mixed() });
    const race = new Race({
      scene: base.__scene, trackDef: { laps: 1 }, path: base.path, participants: mixed(),
      rules: rulesForMode('time-trial'), seed: 5, onEvent: (e) => events.push(e),
    });
    expect(race.karts).toHaveLength(2);
    const k = race.getPlayerKart(0);
    skipCountdown(race);
    for (let i = 0; i < 3; i++) {
      race.update(1 / 60, [input({ accel: 1, useItem: true }), input({ accel: 1 })]);
      for (let f = 0; f < 20; f++) race.update(1 / 60, [input({ accel: 1 }), input({ accel: 1 })]);
    }
    expect(k.item).toBe(null);
    expect(k.itemCharges).toBe(0);
    expect(events.filter((e) => e.type === 'item-use' && e.kart === k)).toHaveLength(3);
    expect(events.filter((e) => e.type === 'boost' && e.source === 'item' && e.kart === k)).toHaveLength(3);
    // P2 kept theirs
    expect(race.getPlayerKart(1).itemCharges).toBe(3);
  });

  it('a solo race completes when the human finishes (no CPU grace needed)', { timeout: 60000 }, async () => {
    const { Race } = await import('../src/race/Race.js');
    const base = await makeRace({ participants: mixed() });
    const race = new Race({
      scene: base.__scene, trackDef: { laps: 1 }, path: base.path, participants: humanParticipants(1), rules: rulesForMode('time-trial'), seed: 6, laps: 1,
    });
    const { aiDriveInput } = await import('../src/race/Race.js');
    runRace(race, { maxSeconds: 200, inputs: (r) => [aiDriveInput(r, r.karts[0], 1 / 60)] });
    expect(race.state).toBe('finished');
    const k = race.karts[0];
    expect(k.finished).toBe(true);
    expect(k.finishEstimated).toBeFalsy();
    expect(k.finishPlace).toBe(1);
    expect(k.lapTimes).toHaveLength(1);
    expect(k.finishTime).toBeCloseTo(k.lapTimes[0], 5);
  });
});

describe('ghost of a real race run (record -> pack -> replay)', () => {
  it('replays the recorded kart along its real path and time', { timeout: 60000 }, async () => {
    const { Race, aiDriveInput } = await import('../src/race/Race.js');
    const base = await makeRace({ participants: mixed() });
    const race = new Race({ scene: base.__scene, trackDef: { laps: 1 }, path: base.path, participants: humanParticipants(1), rules: rulesForMode('time-trial'), seed: 7, laps: 1 });
    const rec = createGhostRecorder();
    const truth = [];
    runRace(race, {
      maxSeconds: 200,
      inputs: (r) => [aiDriveInput(r, r.karts[0], 1 / 60)],
      onFrame: (r) => {
        const k = r.karts[0];
        if (r.state === 'countdown' || k.finished) return;
        rec.record(r.time, k);
        truth.push({ t: r.time, x: k.position.x, z: k.position.z, d: k.distance });
      },
    });
    const k = race.karts[0];
    rec.finish(k.finishTime, k);
    const g = decodeGhost(JSON.parse(JSON.stringify(encodeGhost(rec.samples, { trackId: 'test', laps: 1, time: k.finishTime, characterId: k.characterId }))));
    expect(g.duration).toBeGreaterThanOrEqual(k.finishTime - 0.05);
    for (const s of truth.filter((_, i) => i % 97 === 0)) {
      const p = ghostPoseAt(g, s.t);
      expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThan(0.8);
      // racing the same line at the same pace = no gap
      const gap = ghostGap(g, s.t, s.d);
      if (gap !== null) expect(Math.abs(gap)).toBeLessThan(0.1);
    }
  });
});

describe('race summaries feed the records', () => {
  it('a finished Time Trial gives a race time and best lap', { timeout: 60000 }, async () => {
    const { Race, aiDriveInput } = await import('../src/race/Race.js');
    const base = await makeRace({ participants: mixed() });
    const race = new Race({ scene: base.__scene, trackDef: { laps: 2 }, path: base.path, participants: humanParticipants(1), rules: rulesForMode('time-trial'), seed: 8, laps: 2 });
    runRace(race, { maxSeconds: 300, inputs: (r) => [aiDriveInput(r, r.karts[0], 1 / 60)] });
    const humans = [{ playerIndex: 0, deviceId: 'kb1', characterId: race.karts[0].characterId, easyDrive: false }];
    const summary = buildRaceSummary({ setup: { mode: 'time-trial', speedClass: 'zippy' }, trackDef: { id: 'test', laps: 2 }, humans, standings: race.getStandings(), laps: 2, raceTime: race.time });
    expect(summary.mode).toBe('time-trial');
    expect(summary.standings).toHaveLength(1);
    const c = recordCandidates(summary, { id: 'test', laps: 2 });
    expect(c.raceTime).toBeCloseTo(race.karts[0].finishTime, 6);
    expect(c.bestLap).toBe(Math.min(...race.karts[0].lapTimes));
  });
});
