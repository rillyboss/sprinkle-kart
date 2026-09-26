import * as THREE from 'three';
import { TRACKS, getTrack } from '../../src/data/tracks.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { buildTrack } from '../../src/render/trackBuilder.js';

const q = new URLSearchParams(location.search);
const def = getTrack(q.get('track') || TRACKS[0].id);
const view = q.get('view') || 'chase';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const path = new TrackPath(def.controlPoints, def.width);
const t0 = performance.now();
const built = buildTrack(def, path);
const buildMs = performance.now() - t0;
scene.add(built.group);
const fogMul = view === 'top' || view === 'high' ? 3 : 1;
scene.fog = new THREE.Fog(def.theme.fogColor, def.theme.fogNear * fogMul, def.theme.fogFar * fogMul);
const cam = new THREE.PerspectiveCamera(q.get('fov') ? +q.get('fov') : 62, innerWidth / innerHeight, 0.5, 2000);
const b = path.getBounds();
const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
const ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
function place(time) {
  if (view === 'high') {
    const a = +(q.get('a') || 0.6);
    cam.position.set(cx + Math.cos(a) * ext * 0.75, ext * 0.42, cz + Math.sin(a) * ext * 0.75);
    cam.lookAt(cx, 0, cz);
  } else if (view === 'top') {
    cam.position.set(cx + ext * 0.15, ext * 0.85, cz + ext * 0.75);
    cam.lookAt(cx, 0, cz);
  } else if (view === 'at') {
    const s = +q.get('s') * path.length;
    const p = path.positionAt(s - 14, +(q.get('lat') || 0));
    cam.position.set(p.x, p.y + (+(q.get('h') || 5)), p.z);
    const t = path.positionAt(s + 20, 0);
    cam.lookAt(t.x, t.y + 2, t.z);
  } else if (view === 'free') {
    const [x, y, z, lx, ly, lz] = q.get('cam').split(',').map(Number);
    cam.position.set(x, y, z); cam.lookAt(lx, ly, lz);
  } else {
    const p = path.positionAt(-12, 0);
    cam.position.set(p.x, p.y + 4.2, p.z);
    const t = path.positionAt(22, 0);
    cam.lookAt(t.x, t.y + 1.5, t.z);
  }
}
let last = performance.now();
let frames = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  built.update(dt, now / 1000);
  place(now / 1000);
  renderer.render(scene, cam);
  frames++;
  if (frames === 5) console.log('info', JSON.stringify({ buildMs: Math.round(buildMs), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, len: Math.round(path.length) }));
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__built = built;
