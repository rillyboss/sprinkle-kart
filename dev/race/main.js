import * as THREE from 'three';
import { TRACKS } from '../../src/data/tracks.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildKartModel } from '../../src/render/characterModels.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { toon } from '../../src/render/toon.js';
import { Race } from '../../src/race/Race.js';

const q = new URLSearchParams(location.search);
const td = TRACKS.find((t) => t.id === (q.get('track') || 'cotton-candy-castle'));
const path = new TrackPath(td.controlPoints, td.width);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(td.theme.skyBottom ?? 0xffd6f0);
scene.add(new THREE.HemisphereLight(0xffffff, 0xffc0e0, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(50, 100, 30); scene.add(sun);

// quick road ribbon
const N = 600, pos = [], idx = [];
for (let i = 0; i <= N; i++) {
  const s = (i / N) * path.length;
  for (const lat of [-path.halfWidth, path.halfWidth]) { const p = path.positionAt(s, lat); pos.push(p.x, p.y + 0.02, p.z); }
  if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
}
const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
scene.add(new THREE.Mesh(g, toon(td.theme.road ?? 0xffe0f0, { side: THREE.DoubleSide })));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), toon(td.theme.ground ?? 0xb8f0c0)); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; scene.add(ground);

const parts = CHARACTERS.filter((c) => !c.locked).slice(0, 8).map((c) => ({ characterId: c.id, playerIndex: null }));
const race = new Race({ scene, trackDef: td, path, builtTrack: null, participants: parts, speedClass: q.get('speed') || 'zippy', buildKartModel, onEvent: () => {}, seed: 4 });
window.__race = race;
const cam = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
const follow = Number(q.get('follow') || 0);
const camPos = new THREE.Vector3();
let simT = 0;
function frame(dt, draw = true) {
  race.update(dt, []);
  simT += dt;
  const k = race.karts[follow];
  const back = new THREE.Vector3(-Math.sin(k.heading) * 7, 3.2, -Math.cos(k.heading) * 7).add(k.position);
  camPos.lerp(back, simT < 0.1 ? 1 : 0.15);
  cam.position.copy(camPos);
  cam.lookAt(k.position.x + Math.sin(k.heading) * 4, k.position.y + 1, k.position.z + Math.cos(k.heading) * 4);
  if (draw) renderer.render(scene, cam);
  document.getElementById('hud').textContent = `${race.state} t=${race.time.toFixed(1)} lap ${k.lap} place ${k.place} item ${k.item} spd ${k.speed.toFixed(1)} drift ${k.driftLevel}`;
}
// deterministic stepping for screenshots
window.__advance = (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) frame(1 / 60, i === n - 1); };
window.__setup = (fn) => fn(race, THREE);
if (!q.has('manual')) { let last = performance.now(); const loop = (t) => { frame(Math.min(0.1, (t - last) / 1000)); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
else frame(1 / 60);
