// Pack A look-dev page: ?mode=portraits|grid|lineup&ids=a,b&framing=bust|full&view=front|back|chase&state=idle|boost|spin|happy|drift
import * as THREE from 'three';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildKartModel } from '../../src/render/characterModels.js';
import { renderPortraits } from '../../src/render/portraits.js';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') || 'grid';
const PACK_A = CHARACTERS.filter((c) => c.pack === 'a').map((c) => c.id);
const ids = (q.get('ids') || '').split(',').filter(Boolean);
const list = ids.length ? ids.map((id) => CHARACTERS.find((c) => c.id === id)).filter(Boolean)
  : q.get('all') ? CHARACTERS : CHARACTERS.filter((c) => PACK_A.includes(c.id));
window.__ready = false;

const STATES = {
  idle: { speed: 0, steer: 0 },
  drive: { speed: 24, steer: 0.4 },
  drift: { speed: 26, steer: -1, drifting: true, driftLevel: 2 },
  boost: { speed: 32, steer: 0, boosting: true },
  spin: { speed: 10, steer: 0, spinning: true },
  happy: { speed: 0, steer: 0, happy: true },
};

if (mode === 'portraits') {
  const framing = q.get('framing') || 'bust';
  const map = await renderPortraits(list, 256, { framing });
  const p = document.getElementById('p');
  for (const c of list) { const d = document.createElement('div'); d.innerHTML = `<img src="${map.get(c.id)}"><br>${c.name}`; p.appendChild(d); }
  window.__ready = true;
} else {
  const W = +(q.get('w') || 1500), H = +(q.get('h') || 900);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H); renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xcfe9ff);
  scene.add(new THREE.HemisphereLight(0xfff4fb, 0xc9a6ff, 1.5));
  const dl = new THREE.DirectionalLight(0xffffff, 2.0); dl.position.set(5, 10, 7); scene.add(dl);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshToonMaterial({ color: 0xfff0f8 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const models = list.map((c, i) => { const m = buildKartModel(c); m.group.position.x = (i - (list.length - 1) / 2) * 2.5; scene.add(m.group); return m; });
  const n = list.length;
  const view = q.get('view') || 'front';
  const stateName = q.get('state') || 'idle';
  let t = +(q.get('t') || 1.0);
  const frames = +(q.get('frames') || 40);
  for (let f = 0; f < frames; f++) {
    models.forEach((m) => m.update(1 / 60, { ...STATES[stateName], time: t }));
    t += 1 / 60;
  }
  if (mode === 'grid') {
    const cols = +(q.get('cols') || 3), rows = Math.ceil(n / cols), cw = W / cols, ch = H / rows;
    renderer.setScissorTest(true);
    const gcam = new THREE.PerspectiveCamera(30, cw / ch, 0.1, 100);
    const yaw = +(q.get('yaw') || 0.55);
    models.forEach((m) => { m.group.position.x = 0; m.group.rotation.y = yaw; });
    models.forEach((m, i) => {
      models.forEach((o) => (o.group.visible = o === m));
      const x = (i % cols) * cw, y = H - (Math.floor(i / cols) + 1) * ch;
      renderer.setViewport(x, y, cw, ch); renderer.setScissor(x, y, cw, ch);
      const zoom = +(q.get('zoom') || 1);
      if (view === 'back') gcam.position.set(0, 2.6, -5.6 * zoom);
      else if (view === 'chase') gcam.position.set(0, 2.9, -6.5 * zoom);
      else if (view === 'side') gcam.position.set(-6 * zoom, 1.6, 0);
      else gcam.position.set(0, 2.1, 5.6 * zoom);
      gcam.lookAt(0, 1.1, view === 'chase' ? 2 : 0);
      renderer.render(scene, gcam);
    });
  } else {
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 300);
    models.forEach((m) => { m.group.rotation.y = +(q.get('yaw') || 0.35); });
    const d = n * 2.5 * 1.9;
    if (view === 'back') { cam.position.set(0, 3.2, -d); } else { cam.position.set(0, 2.6, d); }
    cam.lookAt(0, 1.1, 0);
    renderer.render(scene, cam);
  }
  window.__ready = true;
}
