// Kid-Assist (internal field: easyDrive). Family feedback: "The auto-steer
// didn't seem to fully press the gas. It should be called Kid-Assist and help
// always press the gas and help steer."
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race } from '../src/race/Race.js';
import { TUNING as T } from '../src/race/tuning.js';
import { applyEasyDrive, kidAssistPedals, kidAssistState, KID_ASSIST } from '../src/race/AI.js';
import { TRACKS } from '../src/data/tracks.js';
import { CHARACTERS } from '../src/data/characters.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack } from '../src/render/trackBuilder.js';
import { pickCpuCharacters, buildParticipants } from '../src/game/setup.js';
import { ASSIST_LABEL } from '../src/ui/screens/join.js';
import { makeStadiumPath, makeBuiltTrack, placeKart, input } from './raceHelpers.js';

const DT = 1 / 60;
const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
const ZERO = Object.freeze({ steer: 0, accel: 0, brake: 0, drift: false, useItem: false, lookBack: false });

function soloRace({ trackDef = { laps: 3 }, path = makeStadiumPath(), built = makeBuiltTrack(path), speedClass = 'zippy', laps = 3, easyDrive = true } = {}) {
  const events = [];
  const race = new Race({
    scene: new THREE.Scene(), trackDef, path, builtTrack: built,
    participants: [{ characterId: 'rocco', playerIndex: 0, easyDrive }], speedClass, buildKartModel: stub, laps, seed: 1,
    onEvent: (e) => events.push(e),
  });
  race.__events = events;
  return race;
}

describe('Kid-Assist pedals', () => {
  const racing = { state: 'racing', countdown: 0 };
  it('always full gas with no input', () => {
    expect(kidAssistPedals(racing, ZERO)).toEqual({ accel: 1, brake: 0 });
    expect(kidAssistPedals(racing, {})).toEqual({ accel: 1, brake: 0 });
    expect(kidAssistPedals(racing, null)).toEqual({ accel: 1, brake: 0 });
    expect(kidAssistPedals(racing, { accel: 0.3 })).toEqual({ accel: 1, brake: 0 });
  });

  it('regression: a resting / lightly touched brake trigger no longer cancels the gas', () => {
    for (const brake of [0.07, 0.1, 0.2, 0.35, 0.49]) {
      expect(kidAssistPedals(racing, { brake })).toEqual({ accel: 1, brake: 0 });
    }
  });

  it('a real brake press still brakes (and reverses)', () => {
    expect(kidAssistPedals(racing, { brake: T.kidAssistBrake })).toEqual({ accel: 0, brake: T.kidAssistBrake });
    expect(kidAssistPedals(racing, { brake: 1, accel: 1 })).toEqual({ accel: 0, brake: 1 });
  });

  it('presses the gas at the right moment of the countdown for a Rocket Start', () => {
    expect(kidAssistPedals({ state: 'countdown', countdown: 2.5 }, ZERO).accel).toBe(0);
    expect(kidAssistPedals({ state: 'countdown', countdown: 2.5 }, { accel: 1 }).accel).toBe(0); // early mash ignored
    expect(kidAssistPedals({ state: 'countdown', countdown: T.kidAssistStartAt }, ZERO).accel).toBe(1);
    expect(T.kidAssistStartAt).toBeLessThanOrEqual(T.startBoostWindow);
  });

  it('applyEasyDrive keeps the kid\'s drift / item / look-back buttons and never drifts by itself', () => {
    const race = soloRace();
    while (race.state === 'countdown') race.update(DT, [ZERO]);
    const k = race.karts[0];
    expect(applyEasyDrive(race, k, ZERO).drift).toBe(false);
    const o = applyEasyDrive(race, k, { ...ZERO, drift: true, useItem: true, lookBack: true });
    expect(o).toMatchObject({ drift: true, useItem: true, lookBack: true, accel: 1, brake: 0 });
  });
});

describe('Kid-Assist in a race', () => {
  it('regression: holding the brake trigger lightly still reaches top speed', () => {
    const race = soloRace();
    while (race.state === 'countdown') race.update(DT, [ZERO]);
    const k = race.karts[0];
    placeKart(race, k, 10, 0, 0);
    for (let i = 0; i < 60 * 3; i++) race.update(DT, [{ ...ZERO, brake: 0.3 }]);
    expect(k.speed).toBeGreaterThan(k.stats.maxSpeed * 0.9);
    expect(k.phys.throttle).toBe(1);
  });

  it('gets a free Rocket Start with no input', () => {
    const race = soloRace();
    while (race.state === 'countdown') race.update(DT, [ZERO]);
    const start = race.__events.find((e) => e.type === 'boost' && e.source === 'start');
    expect(start?.kart).toBe(race.karts[0]);
  });

  it('a kart without Kid-Assist and no input does not move (control)', () => {
    const race = soloRace({ easyDrive: false });
    while (race.state === 'countdown') race.update(DT, [ZERO]);
    for (let i = 0; i < 60; i++) race.update(DT, [ZERO]);
    expect(race.karts[0].speed).toBe(0);
  });

  it('the kid chooses a lane with the stick and it drifts back to the racing line afterwards', () => {
    const race = soloRace();
    while (race.state === 'countdown') race.update(DT, [ZERO]);
    const k = race.karts[0];
    const hw = race.path.halfWidth;
    placeKart(race, k, 20, 0, 25);
    for (let i = 0; i < 45; i++) race.update(DT, [{ ...ZERO, steer: 1 }]);
    expect(k.lateral).toBeGreaterThan(3);
    expect(k.lateral).toBeLessThan(hw); // but never off the road
    for (let i = 0; i < 100; i++) race.update(DT, [{ ...ZERO, steer: -1 }]);
    expect(k.lateral).toBeLessThan(0);
    for (let i = 0; i < 60 * 5; i++) race.update(DT, [ZERO]);
    expect(Math.abs(kidAssistState(k).lane)).toBeLessThan(2);
  });

  it('auto-avoids walls: pointed at the fence it turns away without scraping', () => {
    const race = soloRace();
    while (race.state === 'countdown') race.update(DT, [ZERO]);
    const k = race.karts[0];
    const hw = race.path.halfWidth;
    placeKart(race, k, 20, hw - 3, 28, -0.45); // right side, nose toward the right wall
    let maxLat = 0;
    for (let i = 0; i < 90; i++) {
      race.update(DT, [ZERO]);
      maxLat = Math.max(maxLat, k.lateral);
    }
    expect(maxLat).toBeLessThan(hw + 1); // at most a wheel on the grass edge
    expect(race.__events.some((e) => e.type === 'bump' && e.wall)).toBe(false);
  });

  it('even with the kid holding the stick into the wall, it stays on the road', () => {
    const race = soloRace();
    while (race.state === 'countdown') race.update(DT, [ZERO]);
    const k = race.karts[0];
    const hw = race.path.halfWidth;
    let off = 0, frames = 0;
    for (let i = 0; i < 60 * 8; i++) {
      race.update(DT, [{ ...ZERO, steer: 1 }]);
      if (Math.abs(k.lateral) > hw + 0.4) off++;
      frames++;
    }
    expect(off / frames).toBeLessThan(0.2);
    expect(k.speed).toBeGreaterThan(k.stats.maxSpeed * 0.6);
  });

  it('backs up briefly when stalled, then goes back to full gas', () => {
    const race = soloRace();
    while (race.state === 'countdown') race.update(DT, [ZERO]);
    const k = race.karts[0];
    const seen = [];
    for (let i = 0; i < 60 * 3; i++) {
      k.speed = 0; // pretend we are wedged in a pile-up
      seen.push(applyEasyDrive(race, k, ZERO));
    }
    const firstBack = seen.findIndex((o) => o.brake === 1);
    expect(firstBack * DT).toBeGreaterThan(KID_ASSIST.stuckAfter - 0.05);
    expect(firstBack * DT).toBeLessThan(KID_ASSIST.stuckAfter + 0.1);
    const backFrames = seen.filter((o) => o.brake === 1).length;
    expect(backFrames * DT).toBeLessThan(KID_ASSIST.backUpFor * 2 + 0.1);
    expect(seen[firstBack + Math.ceil(KID_ASSIST.backUpFor / DT) + 2].accel).toBe(1);
  });

  it('the join-screen label says Kid-Assist', () => {
    expect(ASSIST_LABEL.name).toBe('Kid-Assist');
    expect(typeof ASSIST_LABEL.emoji).toBe('string');
  });
});

describe('Kid-Assist with zero input completes laps on EVERY registered track', () => {
  for (const trackDef of TRACKS) {
    it(`${trackDef.id}: full gas, on the road, competitive speed (cozy / zippy / zoomy)`, () => {
      const path = new TrackPath(trackDef.controlPoints, trackDef.width);
      const built = buildTrack(trackDef, path);
      for (const speedClass of ['cozy', 'zippy', 'zoomy']) {
        const race = soloRace({ trackDef, path, built, speedClass, laps: 2 });
        const k = race.karts[0];
        let frames = 0, off = 0, full = 0, progress = 0;
        while (race.state !== 'finished' && frames < 60 * 300) {
          race.update(DT, [ZERO]);
          if (race.state === 'racing' && race.time > 0 && !k.finished) {
            frames++;
            if (k.offRoad) off++;
            if (k.phys.throttle === 1) full++;
          }
        }
        expect(k.finished, `${speedClass}: finished`).toBe(true);
        expect(k.finishEstimated ?? false).toBe(false);
        expect(full / frames, `${speedClass}: throttle`).toBe(1);
        expect(off / frames, `${speedClass}: off-road share`).toBeLessThan(0.04);
        progress = (2 * path.length) / k.finishTime;
        expect(progress / k.stats.maxSpeed, `${speedClass}: avg speed vs top speed`).toBeGreaterThan(0.85);
      }
      built.dispose?.();
    }, 120000);
  }

  it('against a full CPU field on Zippy, a hands-off Kid-Assist kart is right in the race', () => {
    const places = [];
    for (const trackDef of TRACKS.slice(0, 4)) {
      const path = new TrackPath(trackDef.controlPoints, trackDef.width);
      const built = buildTrack(trackDef, path);
      for (const seed of [1, 2]) {
        let r = seed * 7919;
        const rng = () => ((r = (r * 16807) % 2147483647) / 2147483647);
        const human = { playerIndex: 0, deviceId: 'd0', characterId: CHARACTERS[seed].id, easyDrive: true };
        const cpus = pickCpuCharacters([human.characterId], CHARACTERS.filter((c) => !c.locked), 7, rng);
        const race = new Race({
          scene: new THREE.Scene(), trackDef, path, builtTrack: built,
          participants: buildParticipants([human], cpus), speedClass: 'zippy', buildKartModel: stub, laps: 3, seed,
        });
        const k = race.karts.find((x) => !x.isCPU);
        let t = 0;
        while (race.state !== 'finished' && t < 400) { race.update(DT, [ZERO]); t += DT; }
        places.push(k.finishPlace);
      }
      built.dispose?.();
    }
    const avg = places.reduce((a, b) => a + b, 0) / places.length;
    expect(avg).toBeLessThanOrEqual(3.5);
    expect(Math.max(...places)).toBeLessThanOrEqual(6);
  }, 120000);
});
