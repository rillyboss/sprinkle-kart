// What does drifting COST a young player? Family feedback was "drifting is too harsh".
// driving.drift.test.js pins the feel (yaw kick, slide build-up, speed loss in the first
// second); this file pins the outcome on real tracks:
//   - a centre-line kid who taps drift at random moments (holding it ~1 s) or holds it
//     through every corner finishes a lap no more than a few % slower than the same kid
//     never drifting, on 3 very different tracks and at every speed class;
//   - a drift that ends against the fence never spins the kart and never leaves it crawling.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race, makeRng } from '../src/race/Race.js';
import { steerToward } from '../src/race/AI.js';
import { SPEED_CLASSES } from '../src/config.js';
import { trackFixture, stubKartModel } from './helpers/raceHarness.js';

const DT = 1 / 60;
/** Three very different layouts: the original castle loop, the snowy village, the finale. */
const TRACK_IDS = ['cotton-candy-castle', 'peppermint-village', 'ribbon-sky'];
const CLASSES = ['cozy', 'zippy', 'zoomy'];
/** A drifting kid may lose at most this much lap time vs never drifting (today: -6% .. +0.7%). */
const MAX_DRIFT_COST = 0.03;

function soloRace(trackId, speedClass) {
  const { def, path } = trackFixture(trackId);
  const race = new Race({
    scene: new THREE.Scene(), trackDef: def, path, builtTrack: null, speedClass, laps: 1, seed: 1,
    participants: [{ characterId: 'rocco', playerIndex: 0, easyDrive: false }],
    buildKartModel: stubKartModel(), rules: { items: false, cpus: false },
  });
  return { race, path, k: race.getPlayerKart(0) };
}

/**
 * One lap with a centre-line driver. `drift(t, k, steer)` says whether drift is held this frame.
 * @returns {{ time: number, driftSeconds: number, spins: number }} time = Infinity if it never finished
 */
function lapTime(trackId, speedClass, drift) {
  const { race, path, k } = soloRace(trackId, speedClass);
  const tp = new THREE.Vector3();
  let t = 0;
  let driftSeconds = 0;
  let spins = 0;
  while (race.state === 'countdown') race.update(DT, [{ accel: 1 }]);
  while (!k.finished && t < 240) {
    path.positionAt(k.s + 8 + Math.max(0, k.speed) * 0.45, 0, tp);
    const steer = steerToward(k, tp.x, tp.z, 2);
    const wasSpinning = k.spinning;
    race.update(DT, [{ steer, accel: 1, drift: drift(t, k, steer) }]);
    if (k.drifting) driftSeconds += DT;
    if (k.spinning && !wasSpinning) spins++;
    t += DT;
  }
  race.dispose();
  return { time: k.finished && !k.finishEstimated ? k.finishTime : Infinity, driftSeconds, spins };
}

/** Random taps: every 2-5 s, hold drift for 0.8-1.2 s (seeded). */
function randomTaps(seed) {
  const rng = makeRng(seed);
  let next = 1 + rng() * 3;
  let until = -1;
  return (t) => {
    if (t >= next) { until = t + 0.8 + rng() * 0.4; next = until + 2 + rng() * 3; }
    return t < until;
  };
}

/** Holds drift through every corner (whenever it is steering noticeably). */
const holdInCorners = () => (t, k, steer) => Math.abs(steer) > 0.35;

describe('drifting never costs a kid much lap time', () => {
  for (const trackId of TRACK_IDS) {
    for (const speedClass of CLASSES) {
      it(`${trackId} @ ${speedClass}`, () => {
        const plain = lapTime(trackId, speedClass, () => false);
        expect(Number.isFinite(plain.time)).toBe(true);
        expect(plain.time).toBeGreaterThan(20); // a real lap, not a shortcut
        expect(plain.driftSeconds).toBe(0);
        const taps = [1, 2].map((seed) => lapTime(trackId, speedClass, randomTaps(seed)));
        const corners = lapTime(trackId, speedClass, holdInCorners());
        const cost = (x) => x.time / plain.time - 1;
        const detail = `plain ${plain.time.toFixed(2)}s, taps ${taps.map((x) => `${x.time.toFixed(2)} (${x.driftSeconds.toFixed(1)}s drifting)`)}, corners ${corners.time.toFixed(2)} (${corners.driftSeconds.toFixed(1)}s drifting)`;
        for (const x of [...taps, corners]) {
          expect(x.driftSeconds, `the driver never really drifted: ${detail}`).toBeGreaterThan(0.5); // measured 0.9-8.6 s
          expect(x.spins, detail).toBe(0);
          expect(cost(x), detail).toBeLessThanOrEqual(MAX_DRIFT_COST);
        }
      }, 60000);
    }
  }
});

describe('a drift into the fence', () => {
  for (const speedClass of CLASSES) {
    it(`never spins the kart or leaves it crawling (${speedClass})`, () => {
      const { race, path, k } = soloRace('cotton-candy-castle', speedClass);
      while (race.state === 'countdown') race.update(DT, [{ accel: 1 }]);
      // get up to speed on the centre line
      const tp = new THREE.Vector3();
      for (let i = 0; i < 180; i++) {
        path.positionAt(k.s + 10 + k.speed * 0.45, 0, tp);
        race.update(DT, [{ steer: steerToward(k, tp.x, tp.z, 2), accel: 1 }]);
      }
      const top = SPEED_CLASSES[speedClass].maxSpeed;
      expect(k.speed).toBeGreaterThan(0.7 * top);
      // a drift that runs wide: slide at a shallow angle into the outside fence, keep
      // holding drift against it for a moment, then let go and drive on
      let minSpeed = Infinity;
      let spun = false;
      let touchAt = -1;
      let driftingAtTouch = false;
      let maxLat = 0;
      let afterRelease = null;
      const HOLD = 30; // frames of drift held against the fence
      for (let i = 0; i < 400; i++) {
        const onWall = touchAt >= 0;
        const released = onWall && i - touchAt > HOLD;
        path.positionAt(k.s + 60 + k.speed * 0.45, released ? 0 : path.halfWidth + 6, tp);
        race.update(DT, [{ steer: steerToward(k, tp.x, tp.z, 2), accel: 1, drift: !released }]);
        spun ||= k.spinning;
        maxLat = Math.max(maxLat, Math.abs(k.lateral));
        if (!onWall && Math.abs(k.lateral) > path.halfWidth) { touchAt = i; driftingAtTouch = k.drifting; }
        if (onWall && !released) minSpeed = Math.min(minSpeed, k.speed);
        if (onWall && i - touchAt === HOLD + 60) afterRelease = k.speed; // 1 s after letting go
      }
      race.dispose();
      expect(touchAt, `never reached the fence (max lateral ${maxLat.toFixed(1)}, half width ${path.halfWidth})`).toBeGreaterThanOrEqual(0);
      expect(driftingAtTouch, 'was not drifting when it met the fence').toBe(true);
      expect(spun, 'a fence bump during a drift spun the kart').toBe(false);
      // a real bump costs speed (the outward part of the slide is taken away: this ~50 degree
      // slide keeps 21-53% of top speed today), but the kart never stops or rolls backwards ...
      expect(minSpeed, `speed fell to ${minSpeed.toFixed(1)} of ${top}`).toBeGreaterThan(0.15 * top);
      // ... and is back near full speed a second after letting go
      expect(afterRelease, `1 s after the drift: ${afterRelease?.toFixed(1)} of ${top}`).toBeGreaterThan(0.75 * top);
    });
  }
});
