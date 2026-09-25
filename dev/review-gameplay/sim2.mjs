import * as THREE from 'three';
import { Race } from '../../src/race/Race.js';
import { TRACKS } from '../../src/data/tracks.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { steerToward, aiDriveInput } from '../../src/race/AI.js';
import { pickCpuCharacters, buildParticipants } from '../../src/game/setup.js';
import { CHARACTERS } from '../../src/data/characters.js';

const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
const DT = 1 / 60;
function makeRace(track, { humans = 1, speed = 'zippy', laps = 3, easy = false, cpus = 7, seed = 1 } = {}) {
  const path = new TrackPath(track.controlPoints, track.width);
  const hs = Array.from({ length: humans }, (_, i) => ({ playerIndex: i, deviceId: `d${i}`, characterId: CHARACTERS[i].id, easyDrive: easy }));
  const cpuIds = pickCpuCharacters(hs.map((h) => h.characterId), CHARACTERS.filter((c) => !c.locked), cpus, Math.random);
  const events = [];
  const race = new Race({ scene: new THREE.Scene(), trackDef: track, path, participants: buildParticipants(hs, cpuIds), speedClass: speed, buildKartModel: stub, onEvent: (e) => events.push(e), laps, seed });
  race.__events = events;
  return { race, path };
}
function kidInput(race, k, t, wobble = 0) {
  const look = 8 + Math.max(0, k.speed) * 0.45;
  const tp = race.path.positionAt(k.s + look, Math.sin(t * 0.5) * wobble, new THREE.Vector3());
  return { steer: steerToward(k, tp.x, tp.z, 2.0), accel: 1, brake: 0, drift: false, useItem: false, lookBack: false };
}

// drift trace
{
  const { race } = makeRace(TRACKS[1], { cpus: 0 });
  const k = race.karts[0];
  let t = 0;
  for (let i = 0; i < 60 * 6; i++) { race.update(DT, [kidInput(race, k, t)]); t += DT; }
  const rows = [];
  for (let i = 0; i < 60 * 2.5; i++) {
    race.update(DT, [{ steer: -0.6, accel: 1, drift: true }]);
    if (i % 6 === 0) rows.push(`${(i / 60).toFixed(1)} sp=${k.speed.toFixed(1)} lat=${k.lateral.toFixed(1)} drifting=${k.drifting} lvl=${k.driftLevel}`);
  }
  race.update(DT, [{ steer: 0, accel: 1, drift: false }]);
  rows.push(`release: boosting=${k.boosting} events=${race.__events.filter((e) => e.type === 'drift-boost').map((e) => e.level)}`);
  console.log(rows.join('\n'));
}

// per-race detail: kid vs cpus at zippy on castle
for (const seed of [1, 2, 3, 4]) {
  const { race } = makeRace(TRACKS[0], { speed: 'zippy', seed });
  let t = 0;
  while (race.state !== 'finished' && t < 400) { race.update(DT, [kidInput(race, race.karts.find((k) => !k.isCPU), t, 3)]); t += DT; }
  const h = race.karts.find((k) => !k.isCPU);
  const bonks = race.__events.filter((e) => e.type === 'bonked' && e.kart === h).length;
  const walls = race.__events.filter((e) => e.type === 'bump' && e.wall && e.kart === h).length;
  const bumps = race.__events.filter((e) => e.type === 'bump' && !e.wall && (e.kart === h || e.other === h)).length;
  const st = race.getStandings().map((k) => `${k.isCPU ? '' : '*'}${k.characterId}:${k.finishTime.toFixed(1)}`).join(' ');
  console.log(`seed ${seed}: place ${h.finishPlace} bonks=${bonks} walls=${walls} bumps=${bumps}\n   ${st}`);
}

// autodrive human (the robot the smoke test uses) vs CPUs at zippy, 3 laps
for (const tr of TRACKS) {
  const places = [];
  for (const seed of [1, 2, 3]) {
    const { race } = makeRace(tr, { speed: 'zippy', seed });
    let t = 0;
    while (race.state !== 'finished' && t < 400) { const h = race.karts.find((k) => !k.isCPU); race.update(DT, [aiDriveInput(race, h, DT)]); t += DT; }
    places.push(race.karts.find((k) => !k.isCPU).finishPlace);
  }
  console.log('autodrive', tr.id, places.join(','));
}
// kid holding gas + perfect line, NO wobble, zippy
for (const tr of TRACKS) {
  const places = [];
  for (const seed of [1, 2, 3]) {
    const { race } = makeRace(tr, { speed: 'zippy', seed });
    let t = 0;
    while (race.state !== 'finished' && t < 400) { race.update(DT, [kidInput(race, race.karts.find((k) => !k.isCPU), t, 0)]); t += DT; }
    places.push(race.karts.find((k) => !k.isCPU).finishPlace);
  }
  console.log('perfect-line no-drift', tr.id, places.join(','));
}
