// Dev-only preview for pack B racers (not shipped). ?mode=portraits|grid|lineup
import * as THREE from 'three';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildKartModel } from '../../src/render/characterModels.js';
import { renderPortraits } from '../../src/render/portraits.js';
const q = new URLSearchParams(location.search);
const mode = q.get('mode') || 'lineup';
const pick = () => {
  const ids = q.get('ids');
  const pack = q.get('pack');
  if (ids) return ids.split(',').map((id) => CHARACTERS.find((c) => c.id === id)).filter(Boolean);
  if (pack) return CHARACTERS.filter((c) => pack.split(',').includes(c.pack));
  return CHARACTERS;
};
const STATES = {
  idle: { speed: 0, steer: 0 },
  drive: { speed: 22, steer: 0.3 },
  drift: { speed: 25, steer: -1, drifting: true, driftLevel: 2 },
  boost: { speed: 30, steer: 0, boosting: true },
  happy: { speed: 0, steer: 0, happy: true },
  spin: { speed: 10, steer: 0, spinning: true },
};
window.__ready = false;
const list = pick();
if (mode === 'portraits') {
  const framing = q.get('framing') || 'bust';
  const map = await renderPortraits(list, 256, { framing });
  const p = document.getElementById('p');
  for (const c of list) { const d = document.createElement('div'); d.innerHTML = `<img src="${map.get(c.id)}"><br>${c.name}`; p.appendChild(d); }
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
  const stName = q.get('state') || 'idle';
  const secs = +(q.get('secs') || 0.05);
  const models = list.map((c, i) => { const m = buildKartModel(c); m.group.position.x = (i - (list.length - 1) / 2) * 2.4; m.group.rotation.y = +(q.get('yaw') || 0.5); scene.add(m.group); return m; });
  const steps = Math.max(1, Math.round(secs * 60));
  let t = +(q.get('t') || 1.0);
  for (let f = 0; f < steps; f++) {
    models.forEach((m) => m.update(1 / 60, { ...STATES[stName], time: t }));
    t += 1 / 60;
  }
  const n = list.length;
  const view = q.get('view') || 'front';
  const yaw = +(q.get('yaw') || 0.55);
  if (mode === 'grid') {
    const cols = +(q.get('cols') || 3), rows = Math.ceil(n / cols), cw = W / cols, ch = H / rows;
    renderer.setScissorTest(true);
    const gcam = new THREE.PerspectiveCamera(30, cw / ch, 0.1, 100);
    models.forEach((m) => { m.group.position.x = 0; m.group.rotation.y = yaw; });
    models.forEach((m, i) => {
      models.forEach((o) => (o.group.visible = o === m));
      const x = (i % cols) * cw, y = H - (Math.floor(i / cols) + 1) * ch;
      renderer.setViewport(x, y, cw, ch); renderer.setScissor(x, y, cw, ch);
      if (view === 'back') gcam.position.set(0, 2.6, -5.2);
      else if (view === 'chase') gcam.position.set(0, 2.4, -6.5);
      else if (view === 'side') gcam.position.set(5.4, 1.6, 0);
      else gcam.position.set(0, 2.1, 5.4);
      gcam.lookAt(0, 1.05, 0);
      renderer.render(scene, gcam);
    });
  } else {
    const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 200);
    if (view === 'back') { cam.position.set(0, 3.2, n > 1 ? -13 : -5.5); cam.lookAt(0, 1.0, 0); }
    else if (view === 'chase') { cam.position.set(0, 2.7, -6); cam.lookAt(0, 1.2, 3); }
    else { cam.position.set(0, 2.2, n > 1 ? Math.max(8, n * 1.35) : 5); cam.lookAt(0, 1.0, 0); }
    renderer.render(scene, cam);
  }
  window.__ready = true;
}
