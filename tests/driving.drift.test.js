/// Drift feel, quantified. Family feedback (v3.1): "Drift is still too harsh, it makes you almost
// immediately do a 90 degree turn. It would be nice to have more usable drift with countersteering."
// The drift is now an ARC the stick steers (counter-steer = nearly straight, neutral = a bit tighter
// than a normal bend, steer in = tight) with the nose at a slip angle that eases in. These tests pin
// the numbers at Zippy speed: entry, arc rates, counter-steer, slip, speed, turbo charge, release.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/data/characters.js', async () => (await import('./raceHelpers.js')).characterMock());

import { TUNING as T } from '../src/race/tuning.js';
import {
  wrapAngle, driftBlend, driftArcRate, driftSlipAngle, quad3, driftChargeRate, driftLevelFor, hopShape,
} from '../src/race/Kart.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { makeRace, humanParticipants, skipCountdown, placeKart, input, makeStadiumPath } from './raceHelpers.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;

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
 * sampling yaw rate / slip / speed / heading every frame.
 * @param {object} o { pre: DriveInput for the 0.6 s lead-in, plan(t), seconds, speedClass }
 */
async function driftRun({ pre = input({ accel: 1 }), plan, seconds = 1.5, speedClass = 'zippy' } = {}) {
  const race = await makeRace({ participants: humanParticipants(1), path: bigCircle(), builtTrack: null, speedClass });
  skipCountdown(race);
  const k = race.getPlayerKart(0);
  placeKart(race, k, 40, -20, k.stats.maxSpeed);
  for (let i = 0; i < 36; i++) race.update(DT, [pre]);
  const samples = [];
  let startAt = null;
  const h00 = k.heading;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const t = i * DT;
    const h0 = k.heading;
    race.update(DT, [plan(t)]);
    if (k.drifting && startAt === null) startAt = t;
    samples.push({
      t: t + DT, yaw: Math.abs(wrapAngle(k.heading - h0)) / DT, slip: slipOf(k), speed: Math.hypot(k.velocity.x, k.velocity.z),
      turned: Math.abs(wrapAngle(k.heading - h00)), heading: k.heading,
      drifting: k.drifting, level: k.driftLevel, sinceStart: startAt === null ? -1 : t - startAt,
    });
  }
  return { race, k, samples, startAt, h00 };
}

/** Heading change (rad) between two sample times. */
const turnedBetween = (samples, a, b) => {
  const at = (t) => samples.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best));
  return Math.abs(wrapAngle(at(b).heading - at(a).heading));
};

/** Steady heading rate (rad/s) of a 2.2 s drift with `steer` (picked right first), averaged over 1.0-2.0 s. */
async function steadyDriftRate(steer, speedClass = 'zippy') {
  const r = await driftRun({ plan: (t) => input({ accel: 1, steer: t < 0.05 ? 1 : steer, drift: true }), seconds: 2.2, speedClass });
  expect(r.samples.filter((s) => s.t > 0.2).every((s) => s.drifting), `drift held with steer ${steer}`).toBe(true);
  return { rate: turnedBetween(r.samples, 1.0, 2.0), ...r };
}

/** Yaw rate of plain full-lock steering at top speed (the reference). */
async function normalFullLockYaw(steer = 1, speedClass = 'zippy') {
  const { samples } = await driftRun({ plan: () => input({ accel: 1, steer }), seconds: 1.2, speedClass });
  return turnedBetween(samples, 0.8, 1.2) / 0.4;
}

describe('drift helpers (pure)', () => {
  it('driftBlend eases in smoothly from 0 to 1 over driftEaseIn (~0.4 s)', () => {
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
    expect(T.driftEaseIn).toBeGreaterThanOrEqual(0.35);
    expect(T.driftEaseIn).toBeLessThanOrEqual(0.45);
    expect(driftBlend(0.05)).toBeLessThan(0.1); // almost no slide the moment you press
  });

  it('quad3 passes through its three samples and clamps outside 0..1', () => {
    expect(quad3([1, 2, 4], 0)).toBeCloseTo(1, 12);
    expect(quad3([1, 2, 4], 0.5)).toBeCloseTo(2, 12);
    expect(quad3([1, 2, 4], 1)).toBeCloseTo(4, 12);
    expect(quad3([1, 2, 4], -3)).toBeCloseTo(1, 12);
    expect(quad3([1, 2, 4], 9)).toBeCloseTo(4, 12);
  });

  it('drift arc: counter-steer is nearly straight, neutral is moderate, steering in is tight', () => {
    const out = driftArcRate(0), mid = driftArcRate(0.5), inn = driftArcRate(1);
    expect(out).toBeGreaterThan(0); // never turns against the drift
    expect(out / DEG).toBeLessThan(15);
    expect(mid / DEG).toBeGreaterThan(40);
    expect(mid / DEG).toBeLessThan(58);
    expect(inn / DEG).toBeLessThan(90);
    expect(inn / mid).toBeGreaterThan(1.4);
    expect(driftArcRate(-3)).toBeCloseTo(out, 12);
    expect(driftArcRate(5)).toBeCloseTo(inn, 12);
  });

  it('slip angle: ~20-30 deg into the bend, a little less when counter-steering', () => {
    const out = driftSlipAngle(0), mid = driftSlipAngle(0.5), inn = driftSlipAngle(1);
    expect(mid / DEG).toBeGreaterThanOrEqual(19);
    expect(inn / DEG).toBeLessThanOrEqual(30);
    expect(out / DEG).toBeGreaterThan(10);
    expect(out).toBeLessThan(mid);
    expect(mid).toBeLessThan(inn);
  });

  it('analog stick values map smoothly and monotonically onto the arc and the slip', () => {
    let prevArc = -Infinity, prevSlip = -Infinity, prevDArc = null;
    for (let i = 0; i <= 100; i++) {
      const into = i / 100;
      const arc = driftArcRate(into), slip = driftSlipAngle(into);
      expect(arc).toBeGreaterThan(prevArc);
      expect(slip).toBeGreaterThan(prevSlip);
      if (i > 0) {
        const dArc = arc - prevArc;
        expect(dArc).toBeLessThan(0.03); // no jumps between 1% stick steps
        if (prevDArc !== null) expect(Math.abs(dArc - prevDArc)).toBeLessThan(0.002); // no kinks either
        prevDArc = dArc;
      }
      prevArc = arc;
      prevSlip = slip;
    }
  });

  it('charge levels: three levels, blue arrives quickly, steering in charges faster', () => {
    expect(T.driftLevels).toHaveLength(3);
    expect(T.miniTurbo).toHaveLength(4);
    const toL1 = T.driftLevels[0] / driftChargeRate(0.5);
    expect(toL1).toBeGreaterThan(0.3);
    expect(toL1).toBeLessThan(0.6);
    expect(driftLevelFor(0)).toBe(0);
    expect(driftLevelFor(T.driftLevels[0])).toBe(1);
    expect(driftLevelFor(T.driftLevels[1])).toBe(2);
    expect(driftLevelFor(T.driftLevels[2] + 5)).toBe(3);
    expect(driftChargeRate(1)).toBeGreaterThan(driftChargeRate(0) * 1.8);
    expect(T.driftLevels[2] / driftChargeRate(0)).toBeLessThan(3.6); // rainbow even while counter-steering
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

describe('drift feel at Zippy speed (simulated)', () => {
  const drift = (steer) => () => input({ accel: 1, steer, drift: true });

  it('no snap: the first 0.3 s of a drift turn the kart at most 25 deg, even at full lock', async () => {
    for (const steer of [1, 0.6, 0.35]) {
      const { samples, startAt } = await driftRun({ plan: drift(steer), seconds: 0.6 });
      expect(startAt).toBe(0);
      expect(turnedBetween(samples, 0, 0.3) / DEG, `steer ${steer}`).toBeLessThanOrEqual(25);
    }
    // never harder than plain full-lock steering over the same 0.3 s
    const plain = await driftRun({ plan: () => input({ accel: 1, steer: 1 }), seconds: 0.6 });
    const drifted = await driftRun({ plan: drift(1), seconds: 0.6 });
    expect(turnedBetween(drifted.samples, 0, 0.3)).toBeLessThanOrEqual(turnedBetween(plain.samples, 0, 0.3) * 1.02);
  });

  it('neutral stick: the drift arc is only moderately tighter than a normal bend (<= 60 deg/s)', async () => {
    const { rate } = await steadyDriftRate(0);
    expect(rate / DEG).toBeLessThanOrEqual(60);
    expect(rate / DEG).toBeGreaterThan(35); // but it IS a drift through the bend
    const lock = await normalFullLockYaw(1);
    expect(rate).toBeLessThan(lock * 0.65);
  });

  it('steering INTO the drift tightens it (<= 95 deg/s), never tighter than normal full lock', async () => {
    const inn = (await steadyDriftRate(1)).rate;
    const mid = (await steadyDriftRate(0)).rate;
    expect(inn / DEG).toBeLessThanOrEqual(95);
    expect(inn).toBeGreaterThan(mid * 1.35);
    expect(inn).toBeLessThanOrEqual(await normalFullLockYaw(1));
  });

  it('COUNTER-steering widens the drift to nearly straight (<= 20 deg/s) and keeps it going', async () => {
    const { rate, k } = await steadyDriftRate(-1);
    expect(rate / DEG).toBeLessThanOrEqual(20);
    expect(rate).toBeGreaterThan(0);
    expect(k.drifting).toBe(true);
  });

  it('a drift can be held down a straight by counter-steering (heading stays within ~45 deg for 2 s)', async () => {
    const r = await driftRun({ plan: (t) => input({ accel: 1, steer: t < 0.05 ? 1 : -1, drift: true }), seconds: 2.0 });
    expect(r.k.drifting).toBe(true);
    expect(r.samples.at(-1).turned / DEG).toBeLessThan(45);
    expect(r.k.driftLevel).toBeGreaterThanOrEqual(2); // and it still charges a turbo
  });

  it('analog stick positions give a smooth, monotonic range of drift arcs', async () => {
    const rates = [];
    for (const steer of [-1, -0.5, 0, 0.5, 1]) rates.push((await steadyDriftRate(steer)).rate);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1]);
      expect(rates[i] - rates[i - 1]).toBeLessThan(25 * DEG); // no big steps between stick positions
    }
  });

  it('the slip angle eases in over ~0.4 s to 20-30 deg and never spins out', async () => {
    for (const steer of [1, 0]) {
      const { samples } = await driftRun({ plan: (t) => input({ accel: 1, steer: t < 0.05 ? 1 : steer, drift: true }), seconds: 1.6 });
      const d = samples.filter((s) => s.sinceStart >= 0);
      const at = (t) => d.reduce((best, s) => (Math.abs(s.sinceStart - t) < Math.abs(best.sinceStart - t) ? s : best)).slip;
      const settled = at(1.4);
      expect(settled / DEG, `steer ${steer}`).toBeGreaterThanOrEqual(steer > 0 ? 20 : 18);
      expect(settled / DEG).toBeLessThanOrEqual(30);
      expect(at(0.1)).toBeLessThan(settled * 0.4);
      expect(at(0.6)).toBeGreaterThan(settled * 0.8);
      for (let i = 1; i < d.length; i++) expect(Math.abs(d[i].slip - d[i - 1].slip)).toBeLessThan(0.03);
    }
  });

  it('keeps its speed: no more than 8% speed loss over a 2 s drift (any stick position)', async () => {
    for (const steer of [1, 0, -1]) {
      const { samples } = await driftRun({ plan: (t) => input({ accel: 1, steer: t < 0.05 ? 1 : steer, drift: true }), seconds: 2.0 });
      const v0 = samples[0].speed;
      expect(Math.min(...samples.map((s) => s.speed)), `steer ${steer}`).toBeGreaterThan(v0 * 0.92);
    }
  });

  it('the yaw rate never changes abruptly (no frame-to-frame snap, entry or steady)', async () => {
    const jerk = (samples) => Math.max(...samples.slice(1).map((s, i) => Math.abs(s.yaw - samples[i].yaw)));
    const plain = await driftRun({ plan: () => input({ accel: 1, steer: 1 }), seconds: 0.8 });
    const { samples } = await driftRun({ plan: drift(1), seconds: 1.2 });
    expect(jerk(samples)).toBeLessThanOrEqual(jerk(plain.samples) * 1.05);
    const late = samples.filter((s) => s.t > 0.25);
    expect(jerk(late)).toBeLessThan(0.06); // rad/s per frame once the stick has settled
  });

  it('starting a drift while already turning hard continues that turn (no snap, no un-turn)', async () => {
    const { samples, startAt } = await driftRun({
      pre: input({ accel: 1, steer: 1 }),
      plan: () => input({ accel: 1, steer: 1, drift: true }),
    });
    expect(startAt).toBe(0);
    const before = samples[0].yaw;
    const early = samples.filter((s) => s.sinceStart <= 0.3);
    expect(Math.max(...early.map((s) => s.yaw))).toBeLessThan(before * 1.2);
    expect(Math.min(...early.map((s) => s.yaw))).toBeGreaterThan(before * 0.6);
  });

  it('a drift may still start a little after landing the hop (forgiving timing)', async () => {
    const hopLen = T.hopDuration;
    const { startAt } = await driftRun({
      plan: (t) => input({ accel: 1, drift: true, steer: t < hopLen + 0.2 ? 0 : 0.8 }),
    });
    expect(startAt).not.toBeNull();
    expect(startAt).toBeGreaterThan(hopLen);
  });

  it('mini-turbo charges faster steering in; blue is quick and rainbow is reachable at every stick position', async () => {
    const firstAt = (samples, lvl) => samples.find((s) => s.level >= lvl)?.sinceStart ?? Infinity;
    const inn = await driftRun({ plan: drift(1), seconds: 2.6 });
    const mid = await driftRun({ plan: (t) => input({ accel: 1, steer: t < 0.05 ? 1 : 0, drift: true }), seconds: 3.2 });
    const out = await driftRun({ plan: (t) => input({ accel: 1, steer: t < 0.05 ? 1 : -1, drift: true }), seconds: 4 });
    expect(firstAt(mid.samples, 1)).toBeGreaterThan(0.3);
    expect(firstAt(mid.samples, 1)).toBeLessThan(0.65);
    expect(firstAt(inn.samples, 1)).toBeLessThan(firstAt(mid.samples, 1));
    expect(firstAt(inn.samples, 3)).toBeLessThan(firstAt(mid.samples, 3));
    expect(firstAt(mid.samples, 3)).toBeLessThan(firstAt(out.samples, 3));
    expect(firstAt(inn.samples, 3)).toBeLessThan(2.0);
    expect(firstAt(mid.samples, 3)).toBeLessThan(2.6);
    expect(firstAt(out.samples, 3)).toBeLessThan(3.8);
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
    expect(k.phys.driftSlip).toBe(0);
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
