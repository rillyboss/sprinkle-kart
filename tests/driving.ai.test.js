// CPUs keep up with the eased-in drift: drift-happy CPUs still earn turbos,
// stay on the road on every registered track and are not slower for it.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race } from '../src/race/Race.js';
import { CpuBrain, AI_DRIFT_EXIT_LOOK } from '../src/race/AI.js';
import { TRACKS } from '../src/data/tracks.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack } from '../src/render/trackBuilder.js';

const DT = 1 / 60;
const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });

function cpuSolo(trackDef, path, built, speedClass, driftChance) {
  const events = [];
  const race = new Race({
    scene: new THREE.Scene(), trackDef, path, builtTrack: built,
    participants: [{ characterId: 'rocco', playerIndex: null }], speedClass, buildKartModel: stub, laps: 2, seed: 3,
    onEvent: (e) => events.push(e),
  });
  const k = race.karts[0];
  race.brains.set(k, new CpuBrain(k, { skill: 0.9, rng: race.rng, driftChance }));
  let n = 0, off = 0;
  while (race.state !== 'finished' && n < 60 * 300) {
    race.update(DT, []);
    n++;
    if (k.offRoad) off++;
  }
  return {
    k, time: k.finishTime, off: off / n,
    turbos: events.filter((e) => e.type === 'drift-boost').length,
    walls: events.filter((e) => e.type === 'bump' && e.wall).length,
  };
}

describe('CPU drivers with the eased-in drift', () => {
  it('look a little ahead of the nose before letting go of a drift', () => {
    expect(AI_DRIFT_EXIT_LOOK).toBeGreaterThan(0);
    expect(AI_DRIFT_EXIT_LOOK).toBeLessThan(0.3); // any more and they let go before the first turbo
  });

  for (const trackDef of TRACKS) {
    it(`${trackDef.id}: drift-happy CPUs earn turbos, stay on the road and are not slower`, () => {
      const path = new TrackPath(trackDef.controlPoints, trackDef.width);
      const built = buildTrack(trackDef, path);
      for (const speedClass of ['zippy', 'zoomy']) {
        const clean = cpuSolo(trackDef, path, built, speedClass, 0);
        const drifty = cpuSolo(trackDef, path, built, speedClass, 1);
        expect(drifty.k.finished && !drifty.k.finishEstimated, speedClass).toBe(true);
        expect(drifty.turbos, `${speedClass} turbos`).toBeGreaterThanOrEqual(2);
        expect(drifty.off, `${speedClass} off-road`).toBeLessThan(0.03);
        expect(drifty.walls, `${speedClass} wall scrapes`).toBeLessThanOrEqual(3);
        expect(drifty.time, `${speedClass} time`).toBeLessThan(clean.time * 1.02);
      }
      built.dispose?.();
    }, 120000);
  }
});
