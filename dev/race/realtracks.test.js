import { it } from 'vitest';
import * as THREE from 'three';
import { TRACKS } from '../../src/data/tracks.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { Race } from '../../src/race/Race.js';
const log = (...a) => process.stderr.write(a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\n');
for (const td of TRACKS) for (const sc of ['cozy','zoomy']) it(td.id + sc, () => {
  const path = new TrackPath(td.controlPoints, td.width);
  const ev = {}; let maxLat = 0, off = 0, wall = 0, frames = 0;
  const parts = CHARACTERS.filter(c => !c.locked).slice(0, 8).map(c => ({ characterId: c.id, playerIndex: null }));
  const race = new Race({ scene: new THREE.Scene(), trackDef: td, path, builtTrack: null, participants: parts, speedClass: sc,
    buildKartModel: () => ({ group: new THREE.Group(), update() {}, dispose() {} }), onEvent: (e) => { ev[e.type] = (ev[e.type]||0)+1; if (e.type==='bump'&&e.wall) wall++; }, seed: 3 });
  while (race.state !== 'finished' && frames < 60*400) { race.update(1/60, []); frames++; for (const k of race.karts) { maxLat = Math.max(maxLat, Math.abs(k.lateral)); if (k.offRoad) off++; } }
  const st = race.getStandings();
  log(td.id, sc, 'L', path.length.toFixed(0), 'hw', path.halfWidth, 'time', race.time.toFixed(1), 'maxLat', maxLat.toFixed(1), 'off%', (100*off/frames/8).toFixed(1), 'wall', wall, 'est', st.filter(k=>k.finishEstimated).length, 'spread', (st[7].finishTime-st[0].finishTime).toFixed(1), 'drift', ev['drift-boost'], 'bonk', ev.bonked, 'names', st[0].name);
});
