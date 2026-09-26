// Property / fuzz tests: TrackPath.project and kart physics under random (and silly)
// inputs, dt spikes and odd starting states. Every case is seeded, so a failure
// prints a seed you can replay. Runs over every registered track automatically.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TRACKS } from '../src/tracks/index.js';
import { makeRng } from '../src/race/Race.js';
import { createKart, stepKart } from '../src/race/Kart.js';
import { TUNING } from '../src/race/tuning.js';
import { SPEED_CLASSES } from '../src/config.js';
import { runCpuRace, trackFixture, kartProblems, wallLimit } from './helpers/raceHarness.js';
import { makeTestPath, makeStadiumPath } from './raceHelpers.js';

const PATHS = [
  ...TRACKS.map((def) => ({ id: def.id, path: trackFixture(def.id).path })),
  { id: 'test-ellipse', path: makeTestPath() },
  { id: 'test-stadium', path: makeStadiumPath() },
];

const within = (v, lo, hi) => v >= lo && v <= hi;

describe('TrackPath properties (fuzz)', () => {
  for (const { id, path } of PATHS) {
    describe(id, () => {
      const L = path.length;
      const hw = path.halfWidth;

      it('wrap() and delta() agree for random arc lengths', () => {
        const rng = makeRng(101);
        for (let i = 0; i < 400; i++) {
          const a = (rng() - 0.5) * L * 10;
          const b = (rng() - 0.5) * L * 10;
          const w = path.wrap(a);
          expect(within(w, 0, L), `wrap(${a})`).toBe(true);
          expect(w).toBeLessThan(L);
          const d = path.delta(a, b);
          expect(within(d, -L / 2 - 1e-6, L / 2 + 1e-6), `delta(${a}, ${b})`).toBe(true);
          const back = path.wrap(a + d);
          const err = Math.min(Math.abs(back - path.wrap(b)), L - Math.abs(back - path.wrap(b)));
          expect(err, `wrap(a + delta(a, b)) ≈ wrap(b) for a=${a} b=${b}`).toBeLessThan(1e-6 * L);
        }
      });

      it('project(positionAt(s, lat), hint) round-trips on the road', () => {
        const rng = makeRng(202);
        let worstS = 0;
        let worstLat = 0;
        for (let i = 0; i < 600; i++) {
          const s = rng() * L;
          const lat = (rng() * 2 - 1) * hw;
          const p = path.positionAt(s, lat);
          const hint = s + (rng() - 0.5) * 20; // karts pass their previous s (within a few metres)
          const pr = path.project(p, hint);
          worstS = Math.max(worstS, Math.abs(path.delta(s, pr.s)));
          worstLat = Math.max(worstLat, Math.abs(pr.lateral - lat));
          expect(pr.offRoad).toBe(Math.abs(pr.lateral) > hw);
          expect(Number.isFinite(pr.height)).toBe(true);
        }
        // tolerances scale with the sample spacing (piecewise-linear centre line)
        expect(worstS, `worst s error on ${id}`).toBeLessThan(Math.max(1, path.step * 1.5));
        expect(worstLat, `worst lateral error on ${id}`).toBeLessThan(0.35);
      });

      it('project() without a hint finds a centre point at least as close as the true one', () => {
        const rng = makeRng(303);
        const c = new THREE.Vector3();
        for (let i = 0; i < 150; i++) {
          const s = rng() * L;
          const lat = (rng() * 2 - 1) * (hw + TUNING.wallMargin);
          const p = path.positionAt(s, lat);
          const pr = path.project(p);
          path.pointAt(pr.s, c);
          const d = Math.hypot(p.x - c.x, p.z - c.z);
          expect(d, `seed 303 #${i}: s=${s.toFixed(2)} lat=${lat.toFixed(2)}`).toBeLessThanOrEqual(Math.abs(lat) + 0.35);
          expect(within(pr.s, 0, L)).toBe(true);
        }
      });

      it('project() is finite for any point and any (even broken) hint', () => {
        const rng = makeRng(404);
        const b = path.getBounds();
        const hints = [undefined, null, NaN, -1e7, 1e9, 0, L, -0.001, Infinity];
        for (let i = 0; i < 300; i++) {
          const far = i % 10 === 0 ? 1e6 : 1;
          const p = {
            x: (b.minX + rng() * (b.maxX - b.minX) + (rng() - 0.5) * 400) * far,
            y: 0,
            z: (b.minZ + rng() * (b.maxZ - b.minZ) + (rng() - 0.5) * 400) * far,
          };
          const hint = i % 3 === 0 ? hints[i % hints.length] : rng() * L;
          const pr = path.project(p, hint === Infinity ? undefined : hint);
          for (const k of ['s', 'lateral', 'height']) expect(Number.isFinite(pr[k]), `${k} for (${p.x}, ${p.z}) hint ${hint}`).toBe(true);
          expect(within(pr.s, 0, L)).toBe(true);
          expect(pr.s).toBeLessThan(L);
        }
      });

      it('tangents and right vectors are unit length and perpendicular everywhere', () => {
        const t = new THREE.Vector3();
        const r = new THREE.Vector3();
        for (let s = 0; s < L; s += L / 257) {
          path.tangentAt(s, t);
          path.rightAt(s, r);
          expect(t.length()).toBeCloseTo(1, 6);
          expect(r.length()).toBeCloseTo(1, 6);
          expect(Math.abs(t.dot(r))).toBeLessThan(1e-9);
          expect(Number.isFinite(path.headingAt(s))).toBe(true);
        }
      });
    });
  }
});

/** A random DriveInput; with `garbage` also NaN / Infinity / out-of-range values. */
function randomInput(rng, garbage = false) {
  const pick = (vals) => vals[Math.floor(rng() * vals.length)];
  if (garbage && rng() < 0.3) {
    return {
      steer: pick([NaN, Infinity, -Infinity, 7, -7, undefined, 0.3]),
      accel: pick([NaN, Infinity, -3, 2, undefined, 1]),
      brake: pick([NaN, -Infinity, 5, undefined, 0]),
      drift: pick([true, false, 1, 0, undefined]),
      useItem: rng() < 0.1,
      lookBack: rng() < 0.05,
    };
  }
  return {
    steer: rng() * 2 - 1,
    accel: rng() < 0.85 ? 1 : rng(),
    brake: rng() < 0.08 ? 1 : 0,
    drift: rng() < 0.25,
    useItem: rng() < 0.03,
    lookBack: rng() < 0.02,
  };
}

/** Frame times a real browser can hand the loop: tiny, normal, hitches, tab switches, and junk. */
const DT_SPIKES = [0, 1e-5, 1 / 240, 1 / 144, 1 / 60, 1 / 60, 1 / 60, 1 / 30, 0.1, 0.35, 2, 30, NaN, -1, Infinity];

describe('kart physics stability (fuzz)', () => {
  const reachedWallOn = new Map(); // track id -> did the random drivers get past the road edge?
  for (const def of TRACKS) {
    it(`4 random drivers + 4 CPUs on ${def.id}: never NaN, never through the soft walls`, () => {
      let reachedWall = false;
      for (const seed of [1, 2]) {
        const rng = makeRng(seed * 131 + def.id.length);
        const held = [];
        const r = runCpuRace(def.id, {
          laps: 2, seed, humans: 4, maxSeconds: 25,
          inputs: () => {
            // hold an input for a few frames like a (very excited) kid would
            for (let pi = 0; pi < 4; pi++) if (!held[pi] || rng() < 0.15) held[pi] = randomInput(rng);
            return held;
          },
          dtJitter: [1 / 240, 0.12],
        });
        expect(r.problems, `seed ${seed} on ${def.id}`).toEqual([]);
        expect(r.race.time).toBeGreaterThan(0);
        reachedWall ||= r.worstLateral > r.path.halfWidth;
      }
      reachedWallOn.set(def.id, reachedWall);
    });
  }

  it('the random drivers really test the walls (reach the road edge on most tracks)', () => {
    const hits = [...reachedWallOn.values()].filter(Boolean).length;
    expect(reachedWallOn.size).toBe(TRACKS.length);
    expect(hits, `reached the edge on ${hits}/${TRACKS.length} tracks — the fuzz is too tame`).toBeGreaterThanOrEqual(Math.ceil(TRACKS.length / 2));
  });

  it('dt spikes (0, negative, NaN, Infinity, 30 s) never break a race', () => {
    const def = TRACKS[0];
    const { path } = trackFixture(def.id);
    const rng = makeRng(778);
    const spikes = [];
    const r = runCpuRace(def.id, {
      laps: 1, seed: 8, humans: 2, maxSeconds: 400,
      inputs: () => [randomInput(rng), randomInput(rng)],
      onFrame: (race) => {
        // between normal frames, hand Race.update the frame times a browser can produce
        const dt = DT_SPIKES[Math.floor(rng() * DT_SPIKES.length)];
        spikes.push(dt);
        race.update(dt, [randomInput(rng), randomInput(rng)]);
        for (const k of race.karts) {
          const p = kartProblems(k, path);
          if (p.length) throw new Error(`seed 778, after dt=${dt}: ${p[0]}`);
        }
        if (!Number.isFinite(race.time) || !Number.isFinite(race.clock)) throw new Error(`race clock broke after dt=${dt}`);
      },
    });
    expect(spikes.length).toBeGreaterThan(50);
    for (const bad of [NaN, -1, Infinity, 30]) expect(spikes.some((d) => Object.is(d, bad))).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.finished).toBe(true);
  });

  it('garbage inputs (NaN / Infinity / out of range) are treated as sane values', () => {
    const def = TRACKS[1 % TRACKS.length];
    const rng = makeRng(999);
    const r = runCpuRace(def.id, {
      laps: 1, seed: 9, humans: 3, maxSeconds: 30,
      inputs: () => [randomInput(rng, true), randomInput(rng, true), randomInput(rng, true)],
    });
    expect(r.problems).toEqual([]);
  });

  it('a kart dropped far outside the walls, spinning at silly speed, is pulled back in one step', () => {
    for (const { id, path } of PATHS) {
      const rng = makeRng(id.length * 17);
      for (let i = 0; i < 40; i++) {
        const s = rng() * path.length;
        const side = rng() < 0.5 ? -1 : 1;
        const kart = createKart({
          id: 0, participant: { characterId: 'rocco', playerIndex: 0 }, charDef: { stats: { speed: 3, accel: 3, handling: 3, weight: 3 } },
          speedClass: SPEED_CLASSES.zippy, lapsTotal: 3, path, gridS: s, gridLat: 0,
        });
        // teleport way outside, heading and velocity pointing further out
        path.positionAt(s, side * (path.halfWidth + 3 + rng() * 25), kart.position);
        const r = path.rightAt(s);
        const v = 20 + rng() * 150;
        kart.velocity.set(r.x * side * v, 0, r.z * side * v);
        kart.heading = Math.atan2(r.x * side, r.z * side);
        kart.speed = v;
        const env = { path, boostPads: [], emit: () => {}, gameplay: { gravity: 1, hopBoost: 1 } };
        for (let k = 0; k < 3; k++) stepKart(kart, randomInput(rng), env, TUNING.subStep);
        expect(Math.abs(kart.lateral), `${id} #${i}`).toBeLessThanOrEqual(wallLimit(path) + 1e-6);
        expect(kartProblems(kart, path).filter((p) => !/silly fast/.test(p))).toEqual([]);
      }
    }
  });
});
