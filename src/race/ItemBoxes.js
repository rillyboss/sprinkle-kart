import * as THREE from 'three';
import { toon, glow, addOutline } from '../render/toon.js';
import { TUNING as T } from './tuning.js';
import { sweptDistSq } from './Kart.js';
import { BurstField } from './itemBursts.js';

/** Item-box effects drawn here (see cueFor() in ./itemCatalog.js). */
export const FX_PROVIDES = Object.freeze(['box-pop', 'box-respawn', 'box-shimmer']);

const FACE_COLORS = [0xff8fc8, 0xffc36b, 0xfff07a, 0x8ff0a4, 0x8fd3ff, 0xc9a2ff];

let _shared = null;
function shared() {
  if (_shared) return _shared;
  const box = new THREE.BoxGeometry(1.5, 1.5, 1.5, 1, 1, 1);
  const mats = FACE_COLORS.map((c) => toon(c, { emissive: c, emissiveIntensity: 0.3, unique: true }));
  // "?" glyph pieces
  const hook = new THREE.TorusGeometry(0.24, 0.085, 8, 18, Math.PI * 1.5);
  const stem = new THREE.CylinderGeometry(0.085, 0.085, 0.2, 8);
  const dot = new THREE.SphereGeometry(0.1, 10, 8);
  const sparkle = new THREE.OctahedronGeometry(0.16, 0);
  const halo = new THREE.TorusGeometry(1.45, 0.07, 6, 40).rotateX(Math.PI / 2);
  const glowBall = new THREE.SphereGeometry(1.55, 16, 12);
  _shared = { box, mats, hook, stem, dot, sparkle, halo, glowBall };
  return _shared;
}

function buildQuestionMark() {
  const { hook, stem, dot } = shared();
  const mat = glow(0xffffff);
  const g = new THREE.Group();
  const h = new THREE.Mesh(hook, mat);
  h.rotation.z = -Math.PI / 2;
  h.position.y = 0.2;
  g.add(h);
  const st = new THREE.Mesh(stem, mat);
  st.position.y = -0.14;
  g.add(st);
  const d = new THREE.Mesh(dot, mat);
  d.position.y = -0.4;
  g.add(d);
  return g;
}

/** A rainbow "?" cube with orbiting sparkles. */
export function buildItemBoxMesh() {
  const { box, mats, sparkle } = shared();
  const group = new THREE.Group();
  const spinner = new THREE.Group();
  spinner.name = 'spinner';
  group.add(spinner);
  const cube = new THREE.Mesh(box, mats);
  addOutline(cube, 0.05);
  spinner.add(cube);
  for (let i = 0; i < 4; i++) {
    const q = buildQuestionMark();
    const a = (i * Math.PI) / 2;
    q.position.set(Math.sin(a) * 0.78, 0, Math.cos(a) * 0.78);
    q.rotation.y = a;
    spinner.add(q);
  }
  const sparkles = new THREE.Group();
  sparkles.name = 'sparkles';
  const sColors = [0xffffff, 0xfff07a, 0xff8fc8, 0x8fd3ff, 0xffffff];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(sparkle, glow(sColors[i]));
    const a = (i / 5) * Math.PI * 2;
    s.position.set(Math.cos(a) * 1.35, Math.sin(a * 2) * 0.3, Math.sin(a) * 1.35);
    sparkles.add(s);
  }
  group.add(sparkles);
  // rainbow halo ring + soft glow: "drive through me!"
  const halo = new THREE.Mesh(shared().halo, haloMat());
  halo.name = 'halo';
  halo.renderOrder = 3;
  group.add(halo);
  const glowBall = new THREE.Mesh(shared().glowBall, glowMat());
  glowBall.name = 'glow';
  glowBall.renderOrder = 2;
  group.add(glowBall);
  return group;
}

let _haloMat = null;
let _glowMat = null;
/** Shared, colour-cycling materials (every box shimmers in sync, cheap). */
function haloMat() {
  if (!_haloMat) _haloMat = new THREE.MeshBasicMaterial({ color: 0xff8fc8, transparent: true, opacity: 0.85, depthWrite: false });
  return _haloMat;
}
function glowMat() {
  if (!_glowMat) _glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false });
  return _glowMat;
}
const _hsl = new THREE.Color();
/** Advance the rainbow shimmer of all item boxes to time t (seconds). */
export function shimmerBoxes(t) {
  const { mats } = shared();
  haloMat().color.setHSL((t * 0.25) % 1, 0.95, 0.68);
  glowMat().color.copy(_hsl.setHSL((t * 0.25 + 0.5) % 1, 1, 0.85));
  glowMat().opacity = 0.16 + Math.sin(t * 4) * 0.06;
  const k = 0.3 + (Math.sin(t * 3) * 0.5 + 0.5) * 0.35;
  for (const m of mats) m.emissiveIntensity = k;
}

/** 85% of a kart's velocity (x/z), for bursts that should move along with it. */
export function carry(kart, k = 0.85) {
  const v = kart?.velocity;
  return v && Number.isFinite(v.x) && Number.isFinite(v.z) ? { x: v.x * k, z: v.z * k } : { x: 0, z: 0 };
}

/**
 * The rows of item boxes on the track. Boxes break when any kart drives
 * through and pop back after a short while.
 */
export class ItemBoxes {
  /**
   * @param {{scene: THREE.Object3D, slots: Array<{s:number, lateral:number, position: THREE.Vector3}>}} opts
   */
  constructor({ scene, slots }) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'item-boxes';
    scene.add(this.root);
    this.bursts = new BurstField(this.root);
    this.boxes = (slots || []).map((slot, i) => {
      const mesh = buildItemBoxMesh();
      mesh.position.copy(slot.position);
      mesh.position.y += 1.2;
      this.root.add(mesh);
      return {
        slot,
        mesh,
        base: new THREE.Vector3().copy(slot.position),
        active: true,
        respawn: 0,
        popT: 1, // 0..1 pop-in animation progress
        phase: i * 0.7,
      };
    });
    this._time = 0;
  }

  /**
   * @param {number} dt
   * @param {Array} karts
   * @param {(kart, box) => void} onBreak called when a kart breaks a box
   */
  update(dt, karts, onBreak) {
    this._time += dt;
    const r2 = T.itemBoxRadius * T.itemBoxRadius;
    for (const b of this.boxes) {
      if (!b.active) {
        b.respawn -= dt;
        if (b.respawn <= 0) {
          b.active = true;
          b.popT = 0;
          b.mesh.visible = true;
          this.bursts.emit('respawn', { x: b.base.x, y: b.base.y + 1.25, z: b.base.z });
        }
      }
      if (b.active) {
        for (const k of karts) {
          if (sweptDistSq(k, b.base.x, b.base.z) < r2 && Math.abs(k.position.y - b.base.y) < 3) {
            b.active = false;
            b.respawn = T.itemBoxRespawn;
            b.mesh.visible = false;
            // the confetti travels with the kart, so it pops around it instead of into the camera
            this.bursts.emit('box-pop', { x: b.base.x, y: b.base.y + 1.25, z: b.base.z }, { dir: carry(k) });
            onBreak?.(k, b);
            break;
          }
        }
      }
      this._animate(b, dt);
    }
    shimmerBoxes(this._time);
    this.bursts.update(dt);
  }

  _animate(b, dt) {
    if (!b.mesh.visible) return;
    const t = this._time + b.phase;
    if (b.popT < 1) b.popT = Math.min(1, b.popT + dt / 0.45);
    // springy pop-in
    const p = b.popT;
    const pop = p >= 1 ? 1 : 1 - Math.cos(p * Math.PI * 2.5) * Math.exp(-p * 5) * (1 - p);
    b.mesh.scale.setScalar(Math.max(0.01, pop));
    b.mesh.position.y = b.base.y + 1.3 + Math.sin(t * 2.2) * 0.35;
    const spinner = b.mesh.children[0];
    spinner.rotation.y = t * 1.4;
    spinner.rotation.x = 0.35 + Math.sin(t * 0.9) * 0.12;
    spinner.rotation.z = 0.35;
    const sparkles = b.mesh.children[1];
    sparkles.rotation.y = -t * 2.1;
    sparkles.scale.setScalar(0.9 + Math.sin(t * 6) * 0.2); // twinkle as a group (cheap)
    const halo = b.mesh.children[2];
    if (halo) {
      halo.rotation.x = Math.sin(t * 1.3) * 0.35;
      halo.rotation.z = Math.cos(t * 1.1) * 0.35;
      halo.scale.setScalar(1 + Math.sin(t * 5) * 0.05);
    }
  }

  dispose() {
    this.bursts.dispose();
    this.scene.remove(this.root);
    this.boxes = [];
  }
}
