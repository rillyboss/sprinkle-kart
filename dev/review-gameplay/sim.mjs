// Headless gameplay checks on the REAL tracks with the real Race.
import * as THREE from 'three';
import { Race } from '../../src/race/Race.js';
import { TRACKS } from '../../src/data/tracks.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { steerToward, aiDriveInput } from '../../src/race/AI.js';
import { SPEED_CLASSES } from '../../src/config.js';
import { TUNING as T } from '../../src/race/tuning.js';
import { pickCpuCharacters, buildParticipants } from '../../src/game/setup.js';
import { CHARACTERS } from '../../src/data/characters.js';

const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
const DT = 1 / 60;

function makeRace(track, { humans = 1, speed = 'zippy', laps = 3, easy = false, cpus = 7, seed = 1 } = {}) {
  const path = new TrackPath(track.controlPoints, track.width);
  const hs = Array.from({ length: humans }, (_, i) => ({ playerIndex: i, deviceId: `d${i}`, characterId: CHARACTERS[i].id, easyDrive: easy }));
  const cpuIds = pickCpuCharacters(hs.map((h) => h.characterId), CHARACTERS.filter((c) => !c.locked), cpus, Math.random);
  const participants = buildParticipants(hs, cpuIds);
  const events = [];
  const race = new Race({ scene: new THREE.Scene(), trackDef: track, path, participants, speedClass: speed, buildKartModel: stub, onEvent: (e) => events.push(e), laps, seed });
  race.__events = events;
  return { race, path };
}

// A "reasonable kid" driver: follows the centre line with a look-ahead, never drifts, holds gas.
function kidInput(race, k, { wobble = 0, t = 0 } = {}) {
  const path = race.path;
  const look = 8 + Math.max(0, k.speed) * 0.45;
  const tp = path.positionAt(k.s + look, Math.sin(t * 0.5) * wobble, new THREE.Vector3());
  return { steer: steerToward(k, tp.x, tp.z, 2.0), accel: 1, brake: 0, drift: false, useItem: !!k.item && Math.random() < 0.02, lookBack: false };
}

function run(race, inputFn, maxT = 400) {
  let t = 0;
  while (race.state !== 'finished' && t < maxT) {
    const inputs = [];
    for (const k of race.karts) if (!k.isCPU) inputs[k.playerIndex] = inputFn(race, k, t);
    race.update(DT, inputs);
    t += DT;
  }
  return t;
}

const out = {};
// 1) Acceleration + top speed on straight
{
  const tr = TRACKS[0];
  const { race } = makeRace(tr, { cpus: 0 });
  const k = race.karts[0];
  let t = 0; const samples = [];
  while (t < 8) { race.update(DT, [kidInput(race, k)]); t += DT; if (race.state === 'racing') samples.push([+race.time.toFixed(2), +k.speed.toFixed(1)]); }
  out.accel = { max: k.stats.maxSpeed, at1s: samples.find((s) => s[0] >= 1)?.[1], at2s: samples.find((s) => s[0] >= 2)?.[1], at3s: samples.find((s) => s[0] >= 3)?.[1], at4s: samples.find((s) => s[0] >= 4)?.[1] };
}
// 2) Turning circle at speed (full lock)
{
  const { race } = makeRace(TRACKS[1], { cpus: 0 });
  const k = race.karts[0];
  for (let i = 0; i < 60 * 6; i++) race.update(DT, [{ steer: 0, accel: 1 }]);
  const h0 = k.heading; let yaw = 0; let prev = h0;
  for (let i = 0; i < 30; i++) { race.update(DT, [{ steer: 1, accel: 1 }]); const d = Math.atan2(Math.sin(k.heading - prev), Math.cos(k.heading - prev)); yaw += d; prev = k.heading; }
  out.turn = { speed: +k.speed.toFixed(1), yawIn0_5s_deg: +(yaw * 180 / Math.PI).toFixed(1) };
}
// 3) Drift levels + boosts
{
  const { race } = makeRace(TRACKS[1], { cpus: 0 });
  const k = race.karts[0];
  for (let i = 0; i < 60 * 6; i++) race.update(DT, [kidInput(race, k)]);
  const ev0 = race.__events.length;
  const lvls = [];
  for (let i = 0; i < 60 * 3; i++) { race.update(DT, [{ steer: -1, accel: 1, drift: true }]); if (k.driftLevel !== lvls.at(-1)?.[1]) lvls.push([+(i / 60).toFixed(2), k.driftLevel, k.drifting]); }
  race.update(DT, [{ steer: 0, accel: 1, drift: false }]);
  out.drift = { lvls, events: race.__events.slice(ev0).filter((e) => /drift|hop/.test(e.type)).map((e) => `${e.type}${e.level ?? ''}`).filter((v, i, a) => a.indexOf(v) === i), boosting: k.boosting, lat: +k.lateral.toFixed(1) };
}
// 4) Walls: full right forever at top speed
{
  for (const tr of TRACKS) {
    const { race, path } = makeRace(tr, { cpus: 0 });
    const k = race.karts[0];
    let maxLat = 0; let minSpeedAfter = 99;
    for (let i = 0; i < 60 * 25; i++) { race.update(DT, [{ steer: i % 600 < 300 ? 1 : -1, accel: 1 }]); if (race.state === 'racing') maxLat = Math.max(maxLat, Math.abs(k.lateral)); }
    (out.walls ||= {})[tr.id] = { halfWidth: path.halfWidth, maxLat: +maxLat.toFixed(2), wall: path.halfWidth + T.wallMargin, progress: +k.progress.toFixed(0) };
  }
}
// 5) Kid (no drift) vs 7 CPUs on each track + speed, 3 laps: human place
for (const speed of ['cozy', 'zippy', 'zoomy']) {
  for (const tr of TRACKS) {
    const places = [];
    for (let seed = 1; seed <= 4; seed++) {
      const { race } = makeRace(tr, { speed, seed });
      const t = run(race, (r, k, t) => kidInput(r, k, { t, wobble: 3 }));
      const h = race.karts.find((k) => !k.isCPU);
      places.push(h.finishPlace + (h.finishEstimated ? '*' : ''));
      if (seed === 1) (out.lapTimes ||= {})[`${tr.id}/${speed}`] = { total: +t.toFixed(1), laps: h.lapTimes.map((x) => +x.toFixed(1)), len: +race.path.length.toFixed(0) };
    }
    (out.kidPlaces ||= {})[`${tr.id}/${speed}`] = places.join(',');
  }
}
// 6) Easy-drive with NO steering at all (a toddler just holding nothing)
for (const tr of TRACKS) {
  const { race } = makeRace(tr, { easy: true, speed: 'cozy', laps: 1, seed: 3 });
  run(race, () => ({ steer: 0, accel: 0, brake: 0 }), 300);
  const h = race.karts.find((k) => !k.isCPU);
  (out.easyNoInput ||= {})[tr.id] = `place ${h.finishPlace}${h.finishEstimated ? ' (est)' : ''} t=${h.finishTime?.toFixed(1)}`;
}
// 7) Easy drive with a toddler holding full RIGHT the whole race
for (const tr of TRACKS) {
  const { race } = makeRace(tr, { easy: true, speed: 'cozy', laps: 1, seed: 3 });
  run(race, () => ({ steer: 1, accel: 1, brake: 0 }), 300);
  const h = race.karts.find((k) => !k.isCPU);
  (out.easyFullRight ||= {})[tr.id] = `place ${h.finishPlace}${h.finishEstimated ? ' (est)' : ''} t=${h.finishTime?.toFixed(1)} prog=${h.progress.toFixed(0)}`;
}
console.log(JSON.stringify(out, null, 1));
