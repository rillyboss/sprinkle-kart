import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/data/characters.js', async () => (await import('./raceHelpers.js')).characterMock());

import { TUNING } from '../src/race/tuning.js';
import { wrapAngle } from '../src/race/Kart.js';
import { TrackPath } from '../src/track/TrackPath.js';
import {
  makeRace, makeStadiumPath, humanParticipants, cpuParticipants, skipCountdown, placeKart, input, runRace,
} from './raceHelpers.js';

/** A huge, wide circle: room to drift in circles. */
const bigCircle = () => new TrackPath(Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2;
  return [Math.cos(a) * 300, 0, Math.sin(a) * 300];
}), 80);

const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe('kart handling', () => {
  it('accelerates to (about) top speed and brakes to a stop', async () => {
    const race = await makeRace({ participants: humanParticipants(1), path: makeStadiumPath() });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 10, 0);
    for (let i = 0; i < 60 * 3; i++) race.update(1 / 60, [input({ accel: 1 })]);
    expect(k.speed).toBeGreaterThan(k.stats.maxSpeed * 0.9);
    expect(k.speed).toBeLessThanOrEqual(k.stats.maxSpeed + 1e-6);
    for (let i = 0; i < 60 * 2; i++) race.update(1 / 60, [input({ brake: 1 })]);
    expect(k.speed).toBeLessThan(0.5); // stopped (or just starting to reverse)
  });

  it('steer right (+1) turns the kart toward its right-hand side', async () => {
    const race = await makeRace({ participants: humanParticipants(1), path: makeStadiumPath() });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 20);
    const h0 = k.heading;
    for (let i = 0; i < 20; i++) race.update(1 / 60, [input({ accel: 1, steer: 1 })]);
    expect(wrapAngle(k.heading - h0)).toBeLessThan(-0.2); // heading decreases => right
    expect(k.lateral).toBeGreaterThan(0);
  });

  it('off-road slows you down', async () => {
    const race = await makeRace({ participants: humanParticipants(2), path: makeStadiumPath() });
    skipCountdown(race);
    const [a, b] = race.karts;
    const hw = race.path.halfWidth;
    placeKart(race, a, 20, -4, 0);
    placeKart(race, b, 20, hw + 2, 0);
    // straight section (no steering needed)
    for (let i = 0; i < 60 * 3; i++) race.update(1 / 60, [input({ accel: 1 }), input({ accel: 1 })]);
    expect(b.offRoad).toBe(true);
    expect(a.offRoad).toBe(false);
    expect(b.speed).toBeLessThan(a.speed * 0.7);
  });

  it('drift hop + mini-turbo: charges through blue/pink/rainbow and boosts on release', async () => {
    const race = await makeRace({ participants: humanParticipants(1), path: bigCircle(), builtTrack: null });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 10, -20, 28);
    race.update(1 / 60, [input({ accel: 1, drift: true, steer: 0.6 })]);
    expect(k.phys.hopTime).toBeGreaterThan(0);
    let maxLevel = 0;
    for (let i = 0; i < 60 * 2.8; i++) {
      race.update(1 / 60, [input({ accel: 1, drift: true, steer: 0.3 })]);
      maxLevel = Math.max(maxLevel, k.driftLevel);
    }
    expect(k.drifting).toBe(true);
    expect(maxLevel).toBe(3);
    const levels = race.__events.filter((e) => e.type === 'drift-level').map((e) => e.level);
    expect(levels).toEqual([1, 2, 3]);
    race.update(1 / 60, [input({ accel: 1, drift: false })]);
    expect(k.drifting).toBe(false);
    expect(k.boosting).toBe(true);
    const db = race.__events.find((e) => e.type === 'drift-boost');
    expect(db.level).toBe(3);
    expect(k.phys.boostTime).toBeGreaterThan(TUNING.miniTurbo[3] - 0.1);
  });

  it('tapping drift without steering is just a hop (no drift)', async () => {
    const race = await makeRace({ participants: humanParticipants(1), path: makeStadiumPath() });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 10, 0, 25);
    for (let i = 0; i < 40; i++) race.update(1 / 60, [input({ accel: 1, drift: true })]);
    expect(k.drifting).toBe(false);
    expect(race.__events.some((e) => e.type === 'hop')).toBe(true);
  });

  it('boost pads give a boost once per pass', async () => {
    const race = await makeRace({ participants: humanParticipants(1) });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    const pad = race.boostPads[0];
    placeKart(race, k, pad.s - 12, pad.lateral, 25);
    const path = race.path;
    for (let i = 0; i < 60; i++) {
      // hold the lane on the pad
      const t = path.positionAt(k.s + 10, pad.lateral);
      const diff = wrapAngle(Math.atan2(t.x - k.position.x, t.z - k.position.z) - k.heading);
      race.update(1 / 60, [input({ accel: 1, steer: -diff * 2 })]);
    }
    const pads = race.__events.filter((e) => e.type === 'boost' && e.source === 'pad');
    expect(pads).toHaveLength(1);
    expect(k.speed).toBeGreaterThan(k.stats.maxSpeed);
  });

  it('height follows the road (with smoothing) and pitches on slopes', async () => {
    const race = await makeRace({ participants: humanParticipants(1) });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 25);
    let maxErr = 0;
    let maxPitch = 0;
    for (let i = 0; i < 60 * 8; i++) {
      race.update(1 / 60, [input({ accel: 1 })]);
      const ground = race.path.project(k.position, k.s).height;
      maxErr = Math.max(maxErr, Math.abs(k.position.y - ground));
      maxPitch = Math.max(maxPitch, Math.abs(k.phys.pitch));
    }
    expect(maxErr).toBeLessThan(0.3);
    expect(maxPitch).toBeGreaterThan(0.01);
    expect(maxPitch).toBeLessThan(0.5);
  });
});

describe('soft walls', () => {
  for (const [name, heading] of [['straight into the right wall', -Math.PI / 2], ['straight into the left wall', Math.PI / 2], ['at a shallow angle', -0.5]]) {
    it(`push back and redirect — never stuck, never off track (${name})`, async () => {
      const race = await makeRace({ participants: humanParticipants(1), speedClass: 'zoomy' });
      skipCountdown(race);
      const k = race.getPlayerKart(0);
      const hw = race.path.halfWidth;
      placeKart(race, k, 100, 0, 35, heading);
      const d0 = k.distance;
      let maxLat = 0;
      for (let i = 0; i < 60 * 5; i++) {
        race.update(1 / 60, [input({ accel: 1 })]);
        maxLat = Math.max(maxLat, Math.abs(k.lateral));
      }
      expect(maxLat).toBeLessThanOrEqual(hw + 4);
      expect(maxLat).toBeGreaterThan(hw + 1); // it did reach the wall
      expect(k.speed).toBeGreaterThan(10); // not stuck
      expect(k.distance - d0).toBeGreaterThan(40); // and moving along the track
      expect(race.__events.some((e) => e.type === 'bump' && e.wall)).toBe(true);
    });
  }

  it('holding full steer for ages keeps everyone within halfWidth + 4', async () => {
    const race = await makeRace({ participants: humanParticipants(4), speedClass: 'zoomy', path: makeStadiumPath() });
    skipCountdown(race);
    const hw = race.path.halfWidth;
    let maxLat = 0;
    for (let i = 0; i < 60 * 20; i++) {
      const t = i / 60;
      race.update(1 / 60, [
        input({ accel: 1, steer: 1 }),
        input({ accel: 1, steer: -1, drift: t % 3 < 2 }),
        input({ accel: 1, steer: Math.sin(t * 3) }),
        input({ brake: 1, steer: 1 }),
      ]);
      for (const k of race.karts) maxLat = Math.max(maxLat, Math.abs(k.lateral));
    }
    expect(maxLat).toBeLessThanOrEqual(hw + 4);
  });

  it('easyDrive loses no speed on wall touches', async () => {
    const race = await makeRace({ participants: humanParticipants(2, { easyDrive: true }) });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 100, race.path.halfWidth + 1.5, 30, -0.6);
    const before = Math.hypot(k.velocity.x, k.velocity.z);
    race.update(1 / 60, [input({ accel: 1, steer: 1 }), input()]);
    const along = Math.hypot(k.velocity.x, k.velocity.z);
    // outward component is removed, but no extra scrub on top
    expect(along).toBeGreaterThan(before * Math.cos(0.6) * 0.95);
  });
});

describe('dt spikes', () => {
  it('stays finite and on track with wild frame times', async () => {
    const race = await makeRace({ participants: [...humanParticipants(2), ...cpuParticipants(8).slice(2)], seed: 3 });
    const hw = race.path.halfWidth;
    const dts = [1 / 60, 0.5, 1e-6, 3, NaN, -1, 0, 1 / 30, 0.2, Infinity, 1 / 144];
    let maxLat = 0;
    for (let i = 0; i < 4000; i++) {
      const dt = dts[i % dts.length];
      race.update(dt, [input({ accel: 1, steer: Math.sin(i * 0.05) }), input({ accel: 1, drift: i % 200 < 100, steer: -0.7 })]);
      for (const k of race.karts) {
        expect(finite(k.position)).toBe(true);
        expect(finite(k.velocity)).toBe(true);
        expect(Number.isFinite(k.heading)).toBe(true);
        maxLat = Math.max(maxLat, Math.abs(k.lateral));
      }
    }
    expect(maxLat).toBeLessThanOrEqual(hw + 4);
    expect(Number.isFinite(race.time)).toBe(true);
  });

  it('gives similar results at 30, 60 and 144 fps', async () => {
    const results = [];
    for (const fps of [30, 60, 144]) {
      const race = await makeRace({ participants: humanParticipants(1) });
      skipCountdown(race);
      const k = race.getPlayerKart(0);
      placeKart(race, k, 20, 0, 0);
      for (let i = 0; i < fps * 4; i++) race.update(1 / fps, [input({ accel: 1, steer: 0.2 })]);
      results.push(k.distance);
    }
    const min = Math.min(...results), max = Math.max(...results);
    expect(max - min).toBeLessThan(3);
  });
});

describe('kart-kart bumping', () => {
  it('karts never overlap and heavy karts shove light ones more', async () => {
    const participants = [
      { characterId: 'gumbo', playerIndex: 0 }, // weight 5 in the mock
      { characterId: 'muffin', playerIndex: 1 }, // weight 1
    ];
    const race = await makeRace({ participants, path: makeStadiumPath() });
    skipCountdown(race);
    const [heavy, light] = race.karts;
    placeKart(race, heavy, 30, -3, 20);
    placeKart(race, light, 30, 3, 20);
    const hl0 = heavy.lateral, ll0 = light.lateral;
    for (let i = 0; i < 40; i++) {
      race.update(1 / 60, [input({ accel: 1, steer: 1 }), input({ accel: 1, steer: -1 })]);
      const d = Math.hypot(heavy.position.x - light.position.x, heavy.position.z - light.position.z);
      expect(d).toBeGreaterThan(TUNING.kartRadius * 2 - 0.35);
    }
    expect(race.__events.some((e) => e.type === 'bump' && !e.wall)).toBe(true);
    // the light kart was pushed back past where it started more than the heavy one
    const heavyGain = heavy.lateral - hl0; // heavy steered right (+)
    const lightGain = ll0 - light.lateral; // light steered left (-)
    expect(heavyGain).toBeGreaterThan(lightGain);
  });

  it('a full 8-kart race keeps everyone apart most of the time and nobody is stuck', async () => {
    const race = await makeRace({ participants: cpuParticipants(8), laps: 1, seed: 11 });
    let overlaps = 0;
    runRace(race, {
      maxSeconds: 120,
      onFrame: (r) => {
        const ks = r.karts;
        for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
          if (ks[i].position.distanceTo(ks[j].position) < 1.2) overlaps++;
        }
      },
    });
    expect(race.state).toBe('finished');
    expect(overlaps).toBe(0);
  });
});
