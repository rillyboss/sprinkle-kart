// Drift feel, quantified. Family feedback: "Drifting is hard to use. It is too
// harsh initially." These tests pin down a gentle, easing-in drift: no yaw
// kick, a smooth slide curve, forgiving steering range, no sudden slow-down,
// and a quick first mini-turbo.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/data/characters.js', async () => (await import('./raceHelpers.js')).characterMock());

import { TUNING as T } from '../src/race/tuning.js';
import {
  wrapAngle, driftBlend, driftTurnFactor, driftChargeRate, driftLevelFor, hopShape,
} from '../src/race/Kart.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { makeRace, humanParticipants, skipCountdown, placeKart, input, makeStadiumPath } from './raceHelpers.js';

const DT = 1 / 60;

/** A huge, wide circle: room to drift in any direction. */
const bigCircle = () => new TrackPath(Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2;
  return [Math.cos(a) * 300, 0, Math.sin(a) * 300];
}), 80);

/** Angle between where the kart points and where it is going (radians, >= 0). */
const slipOf = (k) => {
  const sp = Math.hypot(k.velocity.x, k.velocity.z);
  if (sp < 0.5) return 0;
  return Math.abs(wrapAngle(Math.atan2(k.velocity.x, k.velocity.z) - k.heading));
};

/**
 * Cruise at top speed, then run `plan(t)` -> DriveInput for `seconds`,
 * sampling yaw rate / slip / speed every frame.
 * @param {object} o { pre: DriveInput for the 0.6 s lead-in, plan(t), seconds, speedClass, easyDrive }
 */
async function driftRun({ pre = input({ accel: 1 }), plan, seconds = 1.5, speedClass = 'zippy' } = {}) {
  const race = await makeRace({ participants: humanParticipants(1), path: bigCircle(), builtTrack: null, speedClass });
  skipCountdown(race);
  const k = race.getPlayerKart(0);
  placeKart(race, k, 40, -20, k.stats.maxSpeed);
  for (let i = 0; i < 36; i++) race.update(DT, [pre]);
  const samples = [];
  let startAt = null;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const t = i * DT;
    const h0 = k.heading;
    race.update(DT, [plan(t)]);
    if (k.drifting && startAt === null) startAt = t;
    samples.push({
      t, yaw: Math.abs(wrapAngle(k.heading - h0)) / DT, slip: slipOf(k), speed: Math.hypot(k.velocity.x, k.velocity.z),
      drifting: k.drifting, level: k.driftLevel, sinceStart: startAt === null ? -1 : t - startAt,
    });
  }
  return { race, k, samples, startAt };
}

/** Yaw rate of plain full-lock steering at top speed (the reference). */
async function normalFullLockYaw(steer = 1) {
  const { samples } = await driftRun({ plan: () => input({ accel: 1, steer }), seconds: 0.8 });
  return Math.max(...samples.slice(-10).map((s) => s.yaw));
}

describe('drift helpers (pure)', () => {
  it('driftBlend eases in smoothly from 0 to 1 over driftEaseIn', () => {
    expect(driftBlend(0)).toBe(0);
    expect(driftBlend(T.driftEaseIn)).toBe(1);
    expect(driftBlend(99)).toBe(1);
    expect(driftBlend(-1)).toBe(0);
    let prev = 0;
    for (let t = 0; t <= T.driftEaseIn; t += 0.01) {
      const b = driftBlend(t);
      expect(b).toBeGreaterThanOrEqual(prev);
      expect(b - prev).toBeLessThan(0.05); // no jumps at 10 ms resolution
      prev = b;
    }
    expect(T.driftEaseIn).toBeGreaterThanOrEqual(0.3);
    expect(T.driftEaseIn).toBeLessThanOrEqual(0.4);
    expect(driftBlend(0.05)).toBeLessThan(0.1); // almost no slide the moment you press
  });

  it('drift steering range: counter-steer widens, steering in tightens, never turns against the drift', () => {
    const out = driftTurnFactor(0), mid = driftTurnFactor(0.5), inn = driftTurnFactor(1);
    expect(out).toBeGreaterThan(0.25); // still turning with the drift when pushing out
    expect(out).toBeLessThan(mid);
    expect(mid).toBeLessThan(inn);
    expect(inn / out).toBeGreaterThan(2.5); // a really wide, forgiving range
    expect(driftTurnFactor(-3)).toBe(out);
    expect(driftTurnFactor(5)).toBe(inn);
  });

  it('charge levels: three levels, blue arrives quickly at neutral steer', () => {
    expect(T.driftLevels).toHaveLength(3);
    expect(T.miniTurbo).toHaveLength(4);
    const toL1 = T.driftLevels[0] / driftChargeRate(0.5);
    expect(toL1).toBeGreaterThan(0.3);
    expect(toL1).toBeLessThan(0.6);
    expect(driftLevelFor(0)).toBe(0);
    expect(driftLevelFor(T.driftLevels[0])).toBe(1);
    expect(driftLevelFor(T.driftLevels[1])).toBe(2);
    expect(driftLevelFor(T.driftLevels[2] + 5)).toBe(3);
    expect(driftChargeRate(1)).toBeGreaterThan(driftChargeRate(0));
    for (let i = 1; i < 4; i++) expect(T.miniTurbo[i]).toBeGreaterThan(T.miniTurbo[i - 1]);
  });

  it('hop shape follows the track gameplay modifiers (low gravity = floatier, hopBoost = higher)', () => {
    const base = hopShape(undefined);
    expect(base).toEqual({ duration: T.hopDuration, height: T.hopHeight });
    const moon = hopShape({ gravity: 0.55, hopBoost: 1.4 });
    expect(moon.duration).toBeGreaterThan(base.duration * 1.2);
    expect(moon.height).toBeCloseTo(T.hopHeight * 1.4, 6);
    const silly = hopShape({ gravity: 0, hopBoost: 100 });
    expect(Number.isFinite(silly.duration) && silly.duration < 1).toBe(true);
    expect(silly.height).toBeLessThanOrEqual(T.hopHeight * 3);
    expect(T.hopHeight).toBeLessThanOrEqual(0.35); // a gentle little hop
  });
});

describe('drift entry feel (simulated)', () => {
  const drift = (steer) => (t) => input({ accel: 1, steer, drift: true });

  it('no yaw kick: the first 0.2 s of a drift turn at most ~15% harder than normal full lock', async () => {
    const ref = await normalFullLockYaw(1);
    const { samples, startAt } = await driftRun({ plan: drift(1) });
    expect(startAt).not.toBeNull();
    const early = samples.filter((s) => s.sinceStart >= 0 && s.sinceStart <= 0.2);
    expect(early.length).toBeGreaterThan(8);
    const maxEarly = Math.max(...early.map((s) => s.yaw));
    expect(maxEarly).toBeLessThan(ref * 1.15);
  });

  it('the yaw rate changes no more abruptly than plain steering does (no frame-to-frame snap)', async () => {
    const jerk = (samples) => Math.max(...samples.slice(1).map((s, i) => Math.abs(s.yaw - samples[i].yaw)));
    const plain = await driftRun({ plan: () => input({ accel: 1, steer: 1 }), seconds: 0.8 });
    const { samples } = await driftRun({ plan: drift(1), seconds: 0.8 });
    expect(jerk(samples)).toBeLessThanOrEqual(jerk(plain.samples) * 1.05);
    // and once the steering itself has settled, the drift blend adds only gentle changes
    const ref = await normalFullLockYaw(1);
    const late = samples.filter((s) => s.t > 0.12);
    expect(jerk(late)).toBeLessThan(ref * 0.06);
  });

  it('the slide angle builds up smoothly over ~0.3-0.4 s instead of snapping', async () => {
    const { samples } = await driftRun({ plan: drift(1), seconds: 1.6 });
    const d = samples.filter((s) => s.sinceStart >= 0);
    const at = (t) => d.reduce((best, s) => (Math.abs(s.sinceStart - t) < Math.abs(best.sinceStart - t) ? s : best)).slip;
    const full = Math.max(...d.map((s) => s.slip));
    expect(full).toBeGreaterThan(0.08); // it IS a slide
    expect(full).toBeLessThan(0.6); // but never a spin-out
    expect(at(0.1)).toBeLessThan(full * 0.4);
    expect(at(0.5)).toBeGreaterThan(full * 0.5);
    for (let i = 1; i < d.length; i++) expect(Math.abs(d[i].slip - d[i - 1].slip)).toBeLessThan(0.03);
  });

  it('no sudden speed loss: speed never drops more than 6% during the first second of a drift', async () => {
    for (const steer of [1, 0.5, -1]) {
      const { samples } = await driftRun({ plan: (t) => input({ accel: 1, steer: t < 0.05 ? 1 : steer, drift: true }) });
      const v0 = samples[0].speed;
      const d = samples.filter((s) => s.sinceStart >= 0 && s.sinceStart <= 1);
      expect(Math.min(...d.map((s) => s.speed))).toBeGreaterThan(v0 * 0.94);
    }
  });

  it('forgiving range while drifting: counter-steer widens the arc, steering in tightens it', async () => {
    const yawAfter = async (steer) => {
      const { samples } = await driftRun({ plan: (t) => input({ accel: 1, steer: t < 0.05 ? 1 : steer, drift: true }), seconds: 1.6 });
      const late = samples.filter((s) => s.sinceStart > 1.0);
      expect(late.every((s) => s.drifting)).toBe(true);
      return late.reduce((a, s) => a + s.yaw, 0) / late.length;
    };
    const out = await yawAfter(-1);
    const mid = await yawAfter(0);
    const inn = await yawAfter(1);
    expect(out).toBeLessThan(mid * 0.8);
    expect(inn).toBeGreaterThan(mid * 1.2);
    expect(out).toBeGreaterThan(0.3); // pushing out still keeps the drift going
  });

  it('starting a drift while already turning hard does not snap', async () => {
    const { samples, startAt } = await driftRun({
      pre: input({ accel: 1, steer: 1 }),
      plan: () => input({ accel: 1, steer: 1, drift: true }),
    });
    expect(startAt).toBe(0); // drift picks up immediately from the turn
    const before = samples[0].yaw;
    const early = samples.filter((s) => s.sinceStart <= 0.2);
    expect(Math.max(...early.map((s) => s.yaw))).toBeLessThan(before * 1.2);
  });

  it('a drift may still start a little after landing the hop (forgiving timing)', async () => {
    const hopLen = T.hopDuration;
    const { startAt } = await driftRun({
      plan: (t) => input({ accel: 1, drift: true, steer: t < hopLen + 0.2 ? 0 : 0.8 }),
    });
    expect(startAt).not.toBeNull();
    expect(startAt).toBeGreaterThan(hopLen);
  });

  it('time to the first (blue) mini-turbo is quick at neutral steer; rainbow is reachable', async () => {
    const { samples } = await driftRun({ plan: (t) => input({ accel: 1, steer: t < 0.05 ? 1 : 0, drift: true }), seconds: 3.2 });
    const firstAt = (lvl) => samples.find((s) => s.level >= lvl)?.sinceStart ?? Infinity;
    expect(firstAt(1)).toBeGreaterThan(0.3);
    expect(firstAt(1)).toBeLessThan(0.65);
    expect(firstAt(2)).toBeLessThan(1.6);
    expect(firstAt(3)).toBeLessThan(2.6);
    const steerIn = await driftRun({ plan: () => input({ accel: 1, steer: 1, drift: true }), seconds: 2.4 });
    expect(steerIn.samples.find((s) => s.level >= 3)?.sinceStart ?? Infinity).toBeLessThan(2.1);
  });

  it('releasing gives the turbo for the level reached and grip comes back smoothly', async () => {
    const { race, k, samples } = await driftRun({ plan: (t) => input({ accel: 1, steer: 1, drift: t < 1.2 }), seconds: 1.6 });
    const boost = race.__events.find((e) => e.type === 'drift-boost');
    expect(boost).toBeTruthy();
    expect(boost.level).toBeGreaterThanOrEqual(2);
    expect(k.drifting).toBe(false);
    const after = samples.filter((s) => s.t > 1.18);
    for (let i = 1; i < after.length; i++) {
      expect(Math.abs(after[i].slip - after[i - 1].slip)).toBeLessThan(0.04);
      expect(Math.abs(after[i].yaw - after[i - 1].yaw)).toBeLessThan(0.2); // no yaw snap on release
    }
    expect(k.phys.slide).toBe(0);
  });

  it('emits drift-start and land events for sounds / effects', async () => {
    const { race } = await driftRun({ plan: () => input({ accel: 1, steer: 1, drift: true }), seconds: 0.6 });
    const types = race.__events.map((e) => e.type);
    expect(types).toContain('hop');
    expect(types).toContain('drift-start');
    expect(types).toContain('land');
    expect(types.indexOf('hop')).toBeLessThan(types.indexOf('land'));
    const ds = race.__events.find((e) => e.type === 'drift-start');
    expect(ds.dir).toBe(1);
  });

  it('works the same way on every speed class (no harsh kick at Zoomy either)', async () => {
    for (const speedClass of ['cozy', 'zoomy']) {
      const ref = (await driftRun({ plan: () => input({ accel: 1, steer: 1 }), seconds: 0.8, speedClass })).samples.slice(-10);
      const refYaw = Math.max(...ref.map((s) => s.yaw));
      const { samples } = await driftRun({ plan: drift(1), speedClass });
      const early = samples.filter((s) => s.sinceStart >= 0 && s.sinceStart <= 0.2);
      expect(Math.max(...early.map((s) => s.yaw))).toBeLessThan(refYaw * 1.15);
    }
  });
});

describe('drift regressions', () => {
  it('a bonk mid-drift cancels it cleanly (no leftover slide timer)', async () => {
    const { bonkKart } = await import('../src/race/Kart.js');
    const { race, k } = await driftRun({ plan: () => input({ accel: 1, steer: 1, drift: true }), seconds: 0.8 });
    expect(k.drifting).toBe(true);
    bonkKart(k);
    expect(k.drifting).toBe(false);
    expect(k.phys.driftTime).toBe(0);
    for (let i = 0; i < 60; i++) race.update(DT, [input({ accel: 1, steer: 1, drift: true })]);
    expect(Number.isFinite(k.phys.slide)).toBe(true);
  });

  it('low-gravity tracks give a floatier hop that still lands', async () => {
    const race = await makeRace({ participants: humanParticipants(1), path: makeStadiumPath(), trackDef: { gameplay: { gravity: 0.55, hopBoost: 1.4 } } });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 10, 0, 25);
    let maxHop = 0, frames = 0;
    race.update(DT, [input({ accel: 1, drift: true })]);
    while (k.phys.hopTime > 0 && frames < 120) {
      race.update(DT, [input({ accel: 1, drift: true })]);
      maxHop = Math.max(maxHop, k.phys.hopY);
      frames++;
    }
    expect(frames * DT).toBeGreaterThan(T.hopDuration * 1.2);
    expect(maxHop).toBeGreaterThan(T.hopHeight * 1.2);
    expect(k.phys.hopY).toBe(0);
    expect(race.__events.some((e) => e.type === 'land')).toBe(true);
  });
});
