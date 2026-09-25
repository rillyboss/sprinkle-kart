// Can a child who never drifts still win (and unlock Cotton Candy Girl)?
// A simple "kid" driver follows the centre line with a small wobble, holds the
// gas and uses items about a second after getting them — no drifting at all.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race, makeRng } from '../src/race/Race.js';
import { TRACKS } from '../src/data/tracks.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { steerToward, rubberBandMult, cpuDriftChance } from '../src/race/AI.js';
import { pickCpuCharacters, buildParticipants } from '../src/game/setup.js';
import { CHARACTERS } from '../src/data/characters.js';
import { buildTrack } from '../src/render/trackBuilder.js';

const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
const DT = 1 / 60;

function kidRace(trackDef, path, built, seed, speedClass) {
  const rng = makeRng(seed * 7919);
  const human = { playerIndex: 0, deviceId: 'd0', characterId: CHARACTERS[seed % 8].id, easyDrive: false };
  const cpus = pickCpuCharacters([human.characterId], CHARACTERS.filter((c) => !c.locked), 7, rng);
  const race = new Race({
    scene: new THREE.Scene(), trackDef, path, builtTrack: built,
    participants: buildParticipants([human], cpus), speedClass, buildKartModel: stub, laps: 3, seed,
  });
  const h = race.karts.find((k) => !k.isCPU);
  const tp = new THREE.Vector3();
  let held = 0;
  let t = 0;
  while (race.state !== 'finished' && t < 400) {
    path.positionAt(h.s + 8 + Math.max(0, h.speed) * 0.45, Math.sin(t * 0.4) * 2, tp);
    held = h.item && h.itemRoulette <= 0 ? held + DT : 0;
    race.update(DT, [{ steer: steerToward(h, tp.x, tp.z, 2), accel: 1, useItem: held > 1 && held < 1 + DT * 1.5 }]);
    t += DT;
  }
  return h.finishPlace === 1 && !h.finishEstimated;
}

describe('race fairness for non-drifting kids', () => {
  it('rubber band never lets CPUs outrun the human speed class', () => {
    for (const gap of [-400, -100, -31, -10, 0, 10, 80, 300]) {
      expect(rubberBandMult(0.95, gap)).toBeLessThanOrEqual(1.0);
    }
    expect(rubberBandMult(0.95, -10)).toBeLessThan(0.98); // on the kid's tail: a touch slower
    expect(rubberBandMult(0.92, 80)).toBeCloseTo(0.92 - 0.22, 5); // eased back firmly when ahead
    expect(rubberBandMult(0.95, -10, 1, true)).toBeLessThanOrEqual(0.9); // polite on the final lap
    expect(rubberBandMult(0.92, 40)).toBeLessThan(0.82);
  });

  it('CPUs drift less at Cozy/Zippy than at Zoomy', () => {
    expect(cpuDriftChance(0.75, false)).toBeLessThan(0.45);
    expect(cpuDriftChance(0.92, true)).toBeGreaterThan(0.7);
  });

  for (const trackDef of TRACKS) {
    it(`a centre-line driver wins at least 3 of 8 Zippy races on ${trackDef.id}`, () => {
      const path = new TrackPath(trackDef.controlPoints, trackDef.width);
      const built = buildTrack(trackDef, path);
      let wins = 0;
      for (let seed = 1; seed <= 8; seed++) if (kidRace(trackDef, path, built, seed, 'zippy')) wins++;
      built.dispose?.();
      expect(wins).toBeGreaterThanOrEqual(3);
    }, 120000);
  }
});
