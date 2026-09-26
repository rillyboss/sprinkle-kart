// Fairness diagnostics (same kid driver as tests/race.fairness.test.js):
//   node dev/tracks-cozy/fair.mjs <trackId> [seeds=8]
// Prints wins, finishing places and where (by 60-unit bucket) the kid is slower than the CPU winner.
import * as THREE from 'three';
import { Race, makeRng } from '../../src/race/Race.js';
import { TRACKS } from '../../src/data/tracks.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { steerToward } from '../../src/race/AI.js';
import { pickCpuCharacters, buildParticipants } from '../../src/game/setup.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildTrack } from '../../src/render/trackBuilder.js';

const [,, id = 'pumpkin-patch', seedsArg = '8'] = process.argv;
const def = TRACKS.find((t) => t.id === id);
const path = new TrackPath(def.controlPoints, def.width);
const built = buildTrack(def, path);
const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
const DT = 1 / 60;
const B = 60;
const nb = Math.ceil(path.length / B);
const kidT = new Array(nb).fill(0), cpuT = new Array(nb).fill(0), off = new Array(nb).fill(0), slow = new Array(nb).fill(0);
let wins = 0;
const places = [];
for (let seed = 1; seed <= +seedsArg; seed++) {
  const rng = makeRng(seed * 7919);
  const human = { playerIndex: 0, deviceId: 'd0', characterId: CHARACTERS[seed % 8].id, easyDrive: false };
  const cpus = pickCpuCharacters([human.characterId], CHARACTERS.filter((c) => !c.locked), 7, rng);
  const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, builtTrack: built, participants: buildParticipants([human], cpus), speedClass: 'zippy', buildKartModel: stub, laps: 3, seed });
  const h = race.karts.find((k) => !k.isCPU);
  const tp = new THREE.Vector3();
  let held = 0, t = 0, lastGap = null;
  while (race.state !== 'finished' && t < 400) {
    path.positionAt(h.s + 8 + Math.max(0, h.speed) * 0.45, Math.sin(t * 0.4) * 2, tp);
    held = h.item && h.itemRoulette <= 0 ? held + DT : 0;
    race.update(DT, [{ steer: steerToward(h, tp.x, tp.z, 2), accel: 1, useItem: held > 1 && held < 1 + DT * 1.5 }]);
    t += DT;
    if (race.state === 'racing' && h.lap >= 1) {
      const b = Math.floor(path.wrap(h.s) / B) % nb;
      kidT[b] += DT;
      if (h.offRoad) off[b] += DT;
      if (h.spinning) slow[b] += DT;
      const leader = race.karts.filter((k) => k.isCPU).sort((a, c) => c.distance - a.distance)[0];
      const gap = h.distance - leader.distance;
      if (lastGap !== null && Math.abs(gap - lastGap) < 5) cpuT[b] += gap - lastGap; // + = kid gains here
      lastGap = gap;
    }
  }
  places.push(h.finishPlace + (h.finishEstimated ? '?' : ''));
  if (h.finishPlace === 1 && !h.finishEstimated) wins++;
}
console.log(id, 'wins', wins, 'places', places.join(' '));
for (let b = 0; b < nb; b++) {
  console.log(`s ${String(b * B).padStart(5)}  kid ${kidT[b].toFixed(1).padStart(6)}  kidGain ${cpuT[b].toFixed(1).padStart(6)}  offroad ${off[b].toFixed(1)}  spin ${slow[b].toFixed(1)}`);
}
