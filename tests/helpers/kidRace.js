/**
 * The "can a child who never drifts still win?" fairness check, shared by the
 * per-cup files tests/race.fairness.<cup-id>.test.js (one file per cup so vitest
 * runs them on parallel workers — together they used to be the suite's critical path).
 *
 * A simple "kid" driver follows the centre line with a small wobble, holds the gas and
 * uses items about a second after getting them — no drifting at all.
 *
 *   import { fairnessSuite } from './helpers/kidRace.js';
 *   fairnessSuite('bubble-cup');           // every registered track of that cup
 *
 *   kidRace(trackDef, path, built, seed, 'zippy') -> { place, won, estimated, finished }
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race, makeRng } from '../../src/race/Race.js';
import { TRACKS } from '../../src/data/tracks.js';
import { CUPS } from '../../src/data/cups.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { steerToward } from '../../src/race/AI.js';
import { pickCpuCharacters, buildParticipants } from '../../src/game/setup.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildTrack } from '../../src/render/trackBuilder.js';

const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
const DT = 1 / 60;

/** Seeds every track is raced with (8 races). */
export const FAIRNESS_SEEDS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
/** A centre-line kid must win at least this many of the 8 Zippy races. */
export const MIN_WINS = 3;
/** ...finish near the front on average (measured 1.0-2.25 across the 20 v2 tracks)... */
export const MAX_MEAN_PLACE = 3;
/** ...and finish outside the top 4 in at most one of the 8 races (never stuck at the back). */
export const MAX_BACK_OF_PACK = 1;

/**
 * One 3-lap race with the kid driver as the only human.
 * @returns {{ place: number, won: boolean, estimated: boolean, finished: boolean }}
 */
export function kidRace(trackDef, path, built, seed, speedClass) {
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
  const place = h.finishPlace ?? race.getStandings().findIndex((k) => k === h) + 1;
  const result = { place, won: h.finishPlace === 1 && !h.finishEstimated, estimated: !!h.finishEstimated, finished: race.state === 'finished' };
  race.dispose?.();
  return result;
}

/** Race every seed on one track; returns the places (1..8) per seed. */
export function kidPlaces(trackDef, speedClass = 'zippy', seeds = FAIRNESS_SEEDS) {
  const path = new TrackPath(trackDef.controlPoints, trackDef.width);
  const built = buildTrack(trackDef, path);
  try {
    return seeds.map((seed) => kidRace(trackDef, path, built, seed, speedClass));
  } finally {
    built.dispose?.();
  }
}

/** Registered tracks that belong to no cup in CUPS (covered by tests/race.fairness.test.js). */
export function tracksOutsideCups() {
  const inCup = new Set(CUPS.flatMap((c) => c.trackIds));
  return TRACKS.filter((t) => !inCup.has(t.id));
}

/** The fairness `it` for one track (8 Zippy races). */
export function fairnessCase(trackDef) {
  it(`a centre-line driver wins at least ${MIN_WINS} of 8 Zippy races on ${trackDef.id}`, () => {
    const results = kidPlaces(trackDef, 'zippy');
    const wins = results.filter((r) => r.won).length;
    const places = results.map((r) => r.place);
    const mean = places.reduce((a, p) => a + p, 0) / places.length;
    expect(results.every((r) => r.finished), `race did not finish (places ${places})`).toBe(true);
    expect(wins, `wins ${wins}/8, places by seed ${places}`).toBeGreaterThanOrEqual(MIN_WINS);
    expect(mean, `mean place ${mean.toFixed(2)}, places by seed ${places}`).toBeLessThanOrEqual(MAX_MEAN_PLACE);
    expect(places.filter((p) => p > 4).length, `races outside the top 4, places by seed ${places}`).toBeLessThanOrEqual(MAX_BACK_OF_PACK);
  }, 120000);
}

/** Every registered track of `cupId`, one `it` each. Fails loudly when the cup is gone. */
export function fairnessSuite(cupId) {
  describe(`race fairness for non-drifting kids — ${cupId}`, () => {
    const cup = CUPS.find((c) => c.id === cupId);
    it('the cup exists and has registered tracks', () => {
      expect(cup, `no cup "${cupId}" (rename tests/race.fairness.${cupId}.test.js)`).toBeTruthy();
      expect(TRACKS.some((t) => cup.trackIds.includes(t.id))).toBe(true);
    });
    for (const trackDef of TRACKS.filter((t) => cup?.trackIds.includes(t.id))) fairnessCase(trackDef);
  });
}
