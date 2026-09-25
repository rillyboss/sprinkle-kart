import * as THREE from 'three';
import { toon, glow, addOutline } from '../render/toon.js';
import { TUNING as T } from './tuning.js';
import { sweptDistSq } from './Kart.js';

const FACE_COLORS = [0xff8fc8, 0xffc36b, 0xfff07a, 0x8ff0a4, 0x8fd3ff, 0xc9a2ff];

let _shared = null;
function shared() {
  if (_shared) return _shared;
  const box = new THREE.BoxGeometry(1.5, 1.5, 1.5, 1, 1, 1);
  const mats = FACE_COLORS.map((c) => toon(c, { emissive: c, emissiveIntensity: 0.25 }));
  // "?" glyph pieces
  const hook = new THREE.TorusGeometry(0.24, 0.085, 8, 18, Math.PI * 1.5);
  const stem = new THREE.CylinderGeometry(0.085, 0.085, 0.2, 8);
  const dot = new THREE.SphereGeometry(0.1, 10, 8);
  const sparkle = new THREE.OctahedronGeometry(0.12, 0);
  _shared = { box, mats, hook, stem, dot, sparkle };
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
  const sColors = [0xffffff, 0xfff07a, 0xff8fc8];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(sparkle, glow(sColors[i]));
    const a = (i / 3) * Math.PI * 2;
    s.position.set(Math.cos(a) * 1.35, Math.sin(a * 2) * 0.3, Math.sin(a) * 1.35);
    sparkles.add(s);
  }
  group.add(sparkles);
  return group;
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
        }
      }
      if (b.active) {
        for (const k of karts) {
          if (sweptDistSq(k, b.base.x, b.base.z) < r2 && Math.abs(k.position.y - b.base.y) < 3) {
            b.active = false;
            b.respawn = T.itemBoxRespawn;
            b.mesh.visible = false;
            onBreak?.(k, b);
            break;
          }
        }
      }
      this._animate(b, dt);
    }
  }

  _animate(b, dt) {
    if (!b.mesh.visible) return;
    const t = this._time + b.phase;
    if (b.popT < 1) b.popT = Math.min(1, b.popT + dt / 0.45);
    // springy pop-in
    const p = b.popT;
    const pop = p >= 1 ? 1 : 1 - Math.cos(p * Math.PI * 2.5) * Math.exp(-p * 5) * (1 - p);
    b.mesh.scale.setScalar(Math.max(0.01, pop));
    b.mesh.position.y = b.base.y + 1.25 + Math.sin(t * 2.2) * 0.22;
    const spinner = b.mesh.children[0];
    spinner.rotation.y = t * 1.4;
    spinner.rotation.x = 0.35 + Math.sin(t * 0.9) * 0.12;
    spinner.rotation.z = 0.35;
    const sparkles = b.mesh.children[1];
    sparkles.rotation.y = -t * 2.1;
    for (const s of sparkles.children) s.rotation.y = t * 4;
  }

  dispose() {
    this.scene.remove(this.root);
    this.boxes = [];
  }
}
