// Can a non-drifting child win? kid = good centre-line steering, holds gas, uses items ~1s after getting them.
import * as THREE from 'three';
import { Race } from '../../src/race/Race.js';
import { TRACKS } from '../../src/data/tracks.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { steerToward } from '../../src/race/AI.js';
import { pickCpuCharacters, buildParticipants } from '../../src/game/setup.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildTrack } from '../../src/render/trackBuilder.js';

const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
const DT = 1 / 60;
const res = {};
for (const speed of ['cozy', 'zippy']) {
  for (const tr of TRACKS) {
    const path = new TrackPath(tr.controlPoints, tr.width);
    const built = buildTrack(tr, path);
    let wins = 0; const places = []; const gaps = [];
    for (let seed = 1; seed <= 8; seed++) {
      const hs = [{ playerIndex: 0, deviceId: 'd0', characterId: CHARACTERS[seed % 8].id, easyDrive: false }];
      const race = new Race({ scene: new THREE.Scene(), trackDef: tr, path, builtTrack: built, participants: buildParticipants(hs, pickCpuCharacters([hs[0].characterId], CHARACTERS.filter((c) => !c.locked), 7, Math.random)), speedClass: speed, buildKartModel: stub, laps: 3, seed });
      const h = race.karts.find((k) => !k.isCPU);
      let held = 0; let t = 0;
      while (race.state !== 'finished' && t < 500) {
        const tp = path.positionAt(h.s + 8 + Math.max(0, h.speed) * 0.45, Math.sin(t * 0.4) * 2, new THREE.Vector3());
        held = h.item && h.itemRoulette <= 0 ? held + DT : 0;
        race.update(DT, [{ steer: steerToward(h, tp.x, tp.z, 2), accel: 1, useItem: held > 1 && held < 1 + DT * 1.5 }]);
        t += DT;
      }
      places.push(h.finishPlace);
      if (h.finishPlace === 1 && !h.finishEstimated) wins++;
      const winner = race.getStandings()[0];
      gaps.push(+(h.finishTime - winner.finishTime).toFixed(1));
    }
    res[`${speed}/${tr.id}`] = `wins ${wins}/8 places ${places.join(',')} gapToWinner ${gaps.join(',')}`;
  }
}
console.log(JSON.stringify(res, null, 1));
