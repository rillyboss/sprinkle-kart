import * as THREE from 'three';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildKartModel } from '../../src/render/characterModels.js';
import { renderPortraits } from '../../src/render/portraits.js';
const q = new URLSearchParams(location.search);
const mode = q.get('mode') || 'lineup';
window.__ready = false;
if (mode === 'portraits') {
  const framing = q.get('framing') || 'bust';
  const map = await renderPortraits(CHARACTERS, 256, { framing });
  const p = document.getElementById('p');
  for (const c of CHARACTERS) { const d = document.createElement('div'); d.innerHTML = `<img src="${map.get(c.id)}"><br>${c.name}`; p.appendChild(d); }
  window.__ready = true;
} else {
  const W = +(q.get('w') || 1600), H = +(q.get('h') || 700);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H); renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffd6ee);
  scene.add(new THREE.HemisphereLight(0xfff4fb, 0xc9a6ff, 1.5));
  const dl = new THREE.DirectionalLight(0xffffff, 2.0); dl.position.set(5, 10, 7); scene.add(dl);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshToonMaterial({ color: 0xfff0f8 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 200);
  const only = q.get('id');
  const list = only ? CHARACTERS.filter(c => c.id === only) : CHARACTERS;
  const models = list.map((c, i) => { const m = buildKartModel(c); m.group.position.x = (i - (list.length - 1) / 2) * 2.4; m.group.rotation.y = +(q.get('yaw') || 0.5); scene.add(m.group); return m; });
  const n = list.length;
  const view = q.get('view') || 'front';
  if (view === 'front') { cam.position.set(0, 2.2, n > 1 ? 16 : 5); cam.lookAt(0, 1.0, 0); }
  if (view === 'back') { cam.position.set(0, 3.2, n > 1 ? -13 : -5.5); cam.lookAt(0, 1.0, 0); }
  if (view === 'chase') { cam.position.set(0, 2.7, -6); cam.lookAt(0, 1.2, 3); }
  const fx = mode === 'fx';
  let t = +(q.get('t') || 1.0);
  for (let f = 0; f < 3; f++) {
    models.forEach((m, i) => m.update(1 / 60, fx ? { speed: 25, steer: [-1, -0.5, 0.6, 1, 0.3, -0.8, 1, 0, 0.5][i], drifting: i < 4, driftLevel: i, boosting: i === 4 || i === 8, shielded: i === 5, spinning: i === 6, happy: i === 7, time: t } : { speed: 0, steer: 0, time: t }));
    t += 1 / 60;
  }
  if (mode === 'grid' || (fx && q.get('grid'))) {
    const cols = 3, rows = Math.ceil(n / 3), cw = W / cols, ch = H / rows;
    renderer.setScissorTest(true);
    const gcam = new THREE.PerspectiveCamera(30, cw / ch, 0.1, 100);
    const yaw = +(q.get('yaw') || 0.55);
    models.forEach((m) => { m.group.visible = false; m.group.position.x = 0; m.group.rotation.y = yaw; });
    models.forEach((m, i) => {
      models.forEach((o) => (o.group.visible = o === m));
      const x = (i % cols) * cw, y = H - (Math.floor(i / cols) + 1) * ch;
      renderer.setViewport(x, y, cw, ch); renderer.setScissor(x, y, cw, ch);
      if (view === 'back') { gcam.position.set(0, 2.6, -5.2); } else if (view === 'chase') { gcam.position.set(0, 2.4, -6.5); } else { gcam.position.set(0, 2.1, 5.4); }
      gcam.lookAt(0, 1.05, 0);
      renderer.render(scene, gcam);
    });
  } else renderer.render(scene, cam);
  window.__ready = true;
}
