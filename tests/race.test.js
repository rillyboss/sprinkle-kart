import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/data/characters.js', async () => (await import('./raceHelpers.js')).characterMock());

import { SPEED_CLASSES } from '../src/config.js';
import {
  makeRace, makeStadiumPath, cpuParticipants, humanParticipants, skipCountdown, placeKart, input, runRace,
} from './raceHelpers.js';

const types = (race) => race.__events.map((e) => e.type);

describe('Race: countdown', () => {
  it('counts 3-2-1-GO with events, and nobody moves before GO', async () => {
    const race = await makeRace({ participants: humanParticipants(2) });
    const start = race.karts.map((k) => k.position.clone());
    expect(race.state).toBe('countdown');
    expect(race.countdown).toBe(3);
    for (let i = 0; i < 170; i++) race.update(1 / 60, [input({ accel: 1 }), input({ accel: 1, steer: 1 })]);
    expect(race.state).toBe('countdown');
    race.karts.forEach((k, i) => expect(k.position.distanceTo(start[i])).toBeLessThan(1e-6));
    skipCountdown(race);
    expect(race.state).toBe('racing');
    const cd = race.__events.filter((e) => e.type === 'countdown').map((e) => e.n);
    expect(cd).toEqual([3, 2, 1]);
    expect(types(race).filter((t) => t === 'go')).toHaveLength(1);
    expect(race.time).toBe(0);
  });

  it('gives a sparkly rocket start for pressing accelerate near the end, not for holding from the start', async () => {
    const race = await makeRace({ participants: humanParticipants(2) });
    for (let f = 0; f < 200 && race.state === 'countdown'; f++) {
      const late = race.countdown < 0.8;
      race.update(1 / 60, [input({ accel: late ? 1 : 0 }), input({ accel: 1 })]);
    }
    expect(race.state).toBe('racing');
    const boosts = race.__events.filter((e) => e.type === 'boost' && e.source === 'start');
    expect(boosts.map((e) => e.kart.playerIndex)).toEqual([0]);
  });
});

describe('Race: a full CPU race', () => {
  for (const [label, speedClass, mk] of [['zippy ellipse', 'zippy', undefined], ['zoomy stadium', 'zoomy', makeStadiumPath]]) {
    it(`completes all laps with every kart finishing (${label})`, async () => {
      const path = mk ? mk() : undefined;
      const race = await makeRace({ participants: cpuParticipants(8), speedClass, laps: 3, path });
      runRace(race, { maxSeconds: 300 });
      expect(race.state).toBe('finished');
      const L = race.path.length;
      const vmax = SPEED_CLASSES[speedClass].maxSpeed;
      // reasonable: slower than flat-out but not dawdling
      expect(race.time).toBeGreaterThan((3 * L) / (vmax * 1.4));
      expect(race.time).toBeLessThan((3 * L) / (vmax * 0.6));
      for (const k of race.karts) {
        expect(k.finished).toBe(true);
        expect(k.finishEstimated).toBeFalsy(); // everyone genuinely crossed the line
        expect(k.lapTimes).toHaveLength(3);
        expect(k.lap).toBe(3);
      }
      const places = race.getStandings().map((k) => k.finishPlace);
      expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      const times = race.getStandings().map((k) => k.finishTime);
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      // events for lap / final lap / finish / race-complete
      expect(race.__events.filter((e) => e.type === 'lap')).toHaveLength(16);
      expect(race.__events.filter((e) => e.type === 'final-lap')).toHaveLength(8);
      expect(race.__events.filter((e) => e.type === 'finish')).toHaveLength(8);
      expect(race.__events.filter((e) => e.type === 'race-complete')).toHaveLength(1);
      // CPU drivers actually use the fun stuff
      expect(race.__events.some((e) => e.type === 'item-use')).toBe(true);
      expect(race.__events.some((e) => e.type === 'drift-boost')).toBe(true);
    }, 30000);
  }
});

describe('Race: lap counting', () => {
  it('cannot be cheated by reversing back and forth over the line', async () => {
    const race = await makeRace({ participants: humanParticipants(1), laps: 3 });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 0);
    // back up over the line
    for (let i = 0; i < 60 * 6; i++) race.update(1 / 60, [input({ brake: 1 })]);
    expect(k.distance).toBeLessThan(0);
    expect(k.lap).toBe(1);
    // forward over the line again, back again, forward again
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 60 * 3; i++) race.update(1 / 60, [input({ accel: 1 })]);
      expect(k.lap).toBe(1);
      for (let i = 0; i < 60 * 5; i++) race.update(1 / 60, [input({ brake: 1 })]);
      expect(k.lap).toBe(1);
    }
    expect(race.__events.filter((e) => e.type === 'lap')).toHaveLength(0);
  });

  it('driving the wrong way round a whole loop gives no laps', async () => {
    const race = await makeRace({ participants: humanParticipants(1), laps: 2 });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 30, 0, 0, Math.PI); // facing backwards
    const path = race.path;
    let prevS = k.s;
    let travelled = 0;
    for (let i = 0; i < 60 * 60 && travelled < path.length * 1.3; i++) {
      // simple backwards driver: aim at a point behind us on the track
      const t = path.positionAt(k.s - 15, 0);
      const desired = Math.atan2(t.x - k.position.x, t.z - k.position.z);
      let diff = desired - k.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      race.update(1 / 60, [input({ accel: 1, steer: Math.max(-1, Math.min(1, -diff * 2.5)) })]);
      travelled += -path.delta(prevS, k.s);
      prevS = k.s;
    }
    expect(travelled).toBeGreaterThan(path.length * 1.2);
    expect(k.lap).toBe(1);
    expect(k.finished).toBe(false);
    expect(k.distance).toBeLessThan(-path.length);
    expect(k.wrongWay).toBe(true);
  });

  it('counts laps going forward and finishes after lapsTotal', async () => {
    const race = await makeRace({ participants: humanParticipants(1), laps: 2 });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    const L = race.path.length;
    placeKart(race, k, L - 5, 0, 20);
    race.update(1 / 60, [input({ accel: 1 })]);
    for (let i = 0; i < 60; i++) race.update(1 / 60, [input({ accel: 1 })]);
    expect(k.lap).toBe(2);
    expect(race.__events.filter((e) => e.type === 'lap').map((e) => e.lap)).toEqual([2]);
    expect(race.__events.some((e) => e.type === 'final-lap')).toBe(true);
    // reversing back over the line after a real lap does not award it twice
    for (let i = 0; i < 60 * 4; i++) race.update(1 / 60, [input({ brake: 1 })]);
    for (let i = 0; i < 60 * 3; i++) race.update(1 / 60, [input({ accel: 1 })]);
    expect(race.__events.filter((e) => e.type === 'lap')).toHaveLength(1);
    // jump to the end of lap 2
    k.lap = 2;
    placeKart(race, k, L - 5, 0, 20);
    for (let i = 0; i < 60; i++) race.update(1 / 60, [input({ accel: 1 })]);
    expect(k.finished).toBe(true);
    expect(k.finishPlace).toBe(1);
    expect(race.__events.find((e) => e.type === 'finish').place).toBe(1);
    expect(race.state).toBe('finished'); // only human finished => race complete
  });
});

describe('Race: standings', () => {
  it('orders by progress, with finishers first by finish place', async () => {
    const race = await makeRace({ participants: humanParticipants(4) });
    skipCountdown(race);
    const [a, b, c, d] = race.karts;
    placeKart(race, a, 50, -4);
    placeKart(race, b, 200, 0);
    placeKart(race, c, 120, 4);
    d.lap = 2;
    placeKart(race, d, 10, 0);
    race.update(1 / 60, []);
    expect(race.getStandings().map((k) => k.id)).toEqual([d.id, b.id, c.id, a.id]);
    expect([d.place, b.place, c.place, a.place]).toEqual([1, 2, 3, 4]);
    // a finisher outranks anyone still racing, even with less distance
    a.finished = true; a.finishPlace = 1; race.finishCount = 1;
    race.update(1 / 60, []);
    expect(race.getStandings()[0]).toBe(a);
    expect(race.getPlayerKart(2)).toBe(c);
    expect(race.getPlayerKart(3)).toBe(d);
    expect(race.getPlayerKart(7)).toBeNull();
  });
});

describe('Race: completion rules', () => {
  it('when all humans finish, CPU karts get placed by progress', async () => {
    const participants = [...humanParticipants(1), ...cpuParticipants(4).slice(1)];
    const race = await makeRace({ participants, laps: 1 });
    skipCountdown(race);
    const human = race.getPlayerKart(0);
    const L = race.path.length;
    race.karts.filter((k) => k.isCPU).forEach((k, i) => placeKart(race, k, 100 + i * 50, 0, 0));
    placeKart(race, human, L - 3, 0, 25);
    for (let i = 0; i < 30 && race.state !== 'finished'; i++) race.update(1 / 60, [input({ accel: 1 })]);
    expect(race.state).toBe('finished');
    const st = race.getStandings();
    expect(st[0]).toBe(human);
    expect(st.map((k) => k.finishPlace)).toEqual([1, 2, 3, 4]);
    // CPU order follows progress: the one placed furthest ahead is 2nd
    expect(st[1].distance).toBeGreaterThan(st[2].distance);
    expect(st[2].distance).toBeGreaterThan(st[3].distance);
    for (const k of st.slice(1)) {
      expect(k.finished).toBe(true);
      expect(k.finishEstimated).toBe(true);
      expect(k.finishTime).toBeGreaterThan(human.finishTime);
    }
    const complete = race.__events.filter((e) => e.type === 'race-complete');
    expect(complete).toHaveLength(1);
    expect(complete[0].standings[0]).toBe(human);
    // the scene keeps living after the race (victory lap)
    const before = human.position.clone();
    for (let i = 0; i < 60; i++) race.update(1 / 60, []);
    expect(human.position.distanceTo(before)).toBeGreaterThan(1);
  });

  it('wraps up 30 s after the first human finishes', async () => {
    const race = await makeRace({ participants: humanParticipants(2), laps: 1 });
    skipCountdown(race);
    const [p1, p2] = [race.getPlayerKart(0), race.getPlayerKart(1)];
    placeKart(race, p1, race.path.length - 3, -3, 25);
    for (let i = 0; i < 30; i++) race.update(1 / 60, [input({ accel: 1 }), input()]);
    expect(p1.finished).toBe(true);
    expect(race.state).toBe('racing');
    for (let i = 0; i < 60 * 29; i++) race.update(1 / 60, [input({ accel: 1 }), input()]);
    expect(race.state).toBe('racing');
    for (let i = 0; i < 60 * 2; i++) race.update(1 / 60, [input({ accel: 1 }), input()]);
    expect(race.state).toBe('finished');
    expect(p2.finished).toBe(true);
    expect(p2.finishPlace).toBe(2);
  });
});

describe('Race: models and cleanup', () => {
  it('syncs model groups, feeds model.update the state and cleans up on dispose', async () => {
    const race = await makeRace({ participants: humanParticipants(2) });
    const scene = race.__scene;
    skipCountdown(race);
    for (let i = 0; i < 90; i++) race.update(1 / 60, [input({ accel: 1, steer: 0.4 }), input({ accel: 1 })]);
    for (const k of race.karts) {
      expect(k.model.group.parent).toBe(scene);
      expect(k.model.group.position.distanceTo(k.position)).toBeLessThan(1e-9);
      expect(k.model.group.rotation.y).toBeCloseTo(k.heading, 6);
    }
    const st = race.__buildKartModel.calls.at(-1);
    for (const key of ['speed', 'steer', 'drifting', 'driftLevel', 'spinning', 'boosting', 'shielded', 'time']) {
      expect(st).toHaveProperty(key);
    }
    expect(st.speed).toBeGreaterThan(5);
    const childCount = scene.children.length;
    expect(childCount).toBeGreaterThan(2);
    race.dispose();
    expect(scene.children.length).toBe(0);
    for (const k of race.karts) expect(k.model.disposed).toBe(true);
  });

  it('exposes the KartState contract fields', async () => {
    const race = await makeRace({ participants: [...humanParticipants(1), ...cpuParticipants(2).slice(1)] });
    const k = race.karts[0];
    for (const key of ['id', 'characterId', 'playerIndex', 'isCPU', 'name', 'position', 'heading', 'speed', 'velocity',
      's', 'lateral', 'lap', 'lapsTotal', 'progress', 'place', 'finished', 'finishTime', 'finishPlace', 'item',
      'itemRoulette', 'boosting', 'spinning', 'shielded', 'drifting', 'driftLevel', 'starPower', 'model']) {
      expect(k).toHaveProperty(key);
    }
    expect(k.isCPU).toBe(false);
    expect(race.karts[1].isCPU).toBe(true);
    expect(race.karts[1].playerIndex).toBeNull();
    expect(k.name).toBe('Rocco Test');
    expect(k.lap).toBe(1);
    expect(k.lapsTotal).toBe(3);
  });
});
