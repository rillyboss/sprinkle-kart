/**
 * Pooled, instanced particle bursts + expanding rings for item events
 * (box pop, bonk star burst, bubble pop, dodge sparkle, rocket trail ...).
 * OWNER: power-up clarity workstream.
 *
 * One BurstField = 2 InstancedMeshes (confetti blobs + little stars) and a
 * small pool of flat rings, so a busy 8-kart race never allocates per burst.
 * Particles fade by shrinking (instanced basic materials have no per-instance
 * opacity); rings fade with their own pooled material.
 */
import * as THREE from 'three';

export const BURST_KINDS = Object.freeze({
  'box-pop': { count: 24, shape: 'mix', speed: 4.2, up: 3.6, gravity: 8, life: 0.7, size: 0.19, colors: [0xff6fb5, 0xffa94d, 0xffe066, 0x7ee07e, 0x6fc3ff, 0xb48cff], ring: { color: 0xffffff, to: 3, life: 0.4 } },
  'respawn': { count: 12, shape: 'star', speed: -3.2, up: 0.6, gravity: 0, life: 0.45, size: 0.22, colors: [0xffffff, 0xfff07a, 0xff8fc8], spawnRadius: 1.8 },
  'star-burst': { count: 16, shape: 'star', speed: 4.2, up: 3.2, gravity: 6, life: 0.75, size: 0.26, colors: [0xffe45c, 0xfff6b0, 0xffb347, 0xffffff], ring: { color: 0xfff07a, to: 4.2, life: 0.45 } },
  'bubble-pop': { count: 20, shape: 'blob', speed: 3.8, up: 2.6, gravity: 4, life: 0.65, size: 0.16, colors: [0xa8ecff, 0xffffff, 0xff9fdc, 0x7fd8ff], ring: { color: 0xa8ecff, to: 3.8, life: 0.5 } },
  'dodge-sparkle': { count: 10, shape: 'star', speed: 3.5, up: 3, gravity: 3, life: 0.6, size: 0.24, colors: [0xffffff, 0x9bf29b, 0xfff07a] },
  'gumdrop-plop': { count: 10, shape: 'blob', speed: 3, up: 2.5, gravity: 8, life: 0.4, size: 0.2, colors: [0xffffff, 0x9bf29b, 0xff9ecf] },
  'gumdrop-poof': { count: 14, shape: 'blob', speed: 5, up: 3, gravity: 9, life: 0.6, size: 0.25, colors: [0x9bf29b, 0xffffff, 0xffe066, 0xff9ecf] },
  'rocket-launch': { count: 12, shape: 'blob', speed: 3.5, up: 1.5, gravity: 1, life: 0.5, size: 0.3, colors: [0xfff3a8, 0xffffff, 0xff9ecf] },
  'rocket-fizzle': { count: 16, shape: 'mix', speed: 5, up: 3, gravity: 7, life: 0.65, size: 0.25, colors: [0xff9ecf, 0xffe066, 0x8fb8ff, 0xffffff] },
  'rocket-trail': { count: 2, shape: 'mix', speed: 0.8, up: 0.6, gravity: 2.5, life: 0.7, size: 0.2, colors: [0xff6fb5, 0xffe066, 0x7ee07e, 0x6fc3ff, 0xffffff] },
  'star-fade': { count: 16, shape: 'star', speed: 4, up: 3.5, gravity: 3, life: 0.8, size: 0.26, colors: [0xff6fb5, 0xffa94d, 0xffe066, 0x7ee07e, 0x6fc3ff, 0xb48cff] },
});

const MAX_PARTS = 420;
const MAX_RINGS = 10;

let _geo = null;
function geos() {
  if (_geo) return _geo;
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.45 : 1;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i) starShape.lineTo(x, y); else starShape.moveTo(x, y);
  }
  const star = new THREE.ExtrudeGeometry(starShape, { depth: 0.35, bevelEnabled: false });
  star.center();
  _geo = {
    blob: new THREE.IcosahedronGeometry(1, 1),
    star,
    ring: new THREE.RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2),
  };
  return _geo;
}

/** Deterministic little hash so bursts look varied without Math.random. */
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class BurstField {
  /** @param {THREE.Object3D} parent */
  constructor(parent) {
    const g = geos();
    this.parent = parent;
    this.group = new THREE.Group();
    this.group.name = 'item-bursts';
    parent.add(this.group);
    this._mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.meshes = {
      blob: new THREE.InstancedMesh(g.blob, this._mat, MAX_PARTS),
      star: new THREE.InstancedMesh(g.star, this._mat, MAX_PARTS),
    };
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(0xffffff);
    for (const m of Object.values(this.meshes)) {
      m.frustumCulled = false;
      m.count = MAX_PARTS;
      for (let i = 0; i < MAX_PARTS; i++) { m.setMatrixAt(i, zero); m.setColorAt(i, white); }
      m.instanceMatrix.needsUpdate = true;
      this.group.add(m);
    }
    this.parts = { blob: [], star: [] }; // live particles
    this.free = { blob: [], star: [] };
    for (let i = MAX_PARTS - 1; i >= 0; i--) { this.free.blob.push(i); this.free.star.push(i); }
    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g.ring, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, t: 0, life: 0, to: 1, busy: false });
    }
    this._seq = 0;
    this._dummy = new THREE.Object3D();
    this._m = new THREE.Matrix4();
    this._color = new THREE.Color();
    this.emitted = {}; // kind -> count (tests / debugging)
  }

  /** Number of live particles (both shapes). */
  get live() { return this.parts.blob.length + this.parts.star.length; }

  /**
   * Spawn a burst.
   * @param {keyof BURST_KINDS} kind
   * @param {{x:number,y:number,z:number}} pos
   * @param {{scale?:number, count?:number, dir?:{x:number,z:number}}} [opts]
   * @returns {number} particles spawned
   */
  emit(kind, pos, opts = {}) {
    const k = BURST_KINDS[kind];
    if (!k || !pos) return 0;
    this.emitted[kind] = (this.emitted[kind] || 0) + 1;
    const scale = opts.scale ?? 1;
    const n = opts.count ?? k.count;
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const seq = ++this._seq;
      const shape = k.shape === 'mix' ? (i % 2 ? 'star' : 'blob') : k.shape;
      const idx = this.free[shape].pop();
      if (idx === undefined) break;
      const a = (i / n) * Math.PI * 2 + hash(seq) * 0.8;
      const sp = k.speed * (0.6 + hash(seq + 1) * 0.6) * scale;
      const r0 = (k.spawnRadius ?? 0.2) * scale;
      const p = {
        idx, shape,
        x: pos.x + Math.cos(a) * r0, y: pos.y + (hash(seq + 2) - 0.3) * 0.6 * scale, z: pos.z + Math.sin(a) * r0,
        vx: Math.cos(a) * sp + (opts.dir?.x ?? 0), vy: k.up * (0.5 + hash(seq + 3)) * scale, vz: Math.sin(a) * sp + (opts.dir?.z ?? 0),
        g: k.gravity, t: 0, life: k.life * (0.75 + hash(seq + 4) * 0.5), size: k.size * scale * (0.7 + hash(seq + 5) * 0.6),
        spin: (hash(seq + 6) - 0.5) * 14,
      };
      this.meshes[shape].setColorAt(idx, this._color.set(k.colors[i % k.colors.length]));
      this.meshes[shape].instanceColor.needsUpdate = true;
      this.parts[shape].push(p);
      spawned++;
    }
    if (k.ring) this.ring(pos, k.ring.color, k.ring.to * scale, k.ring.life);
    return spawned;
  }

  /** An expanding, fading flat ring on the ground plane at `pos`. */
  ring(pos, color, to = 3, life = 0.4) {
    const r = this.rings.find((q) => !q.busy) ?? this.rings.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    r.busy = true;
    r.t = 0;
    r.life = life;
    r.to = to;
    r.mat.color.set(color);
    r.mesh.position.set(pos.x, pos.y + 0.15, pos.z);
    r.mesh.visible = true;
    r.mesh.scale.setScalar(0.2);
    return r;
  }

  update(dt) {
    const d = this._dummy;
    for (const shape of ['blob', 'star']) {
      const list = this.parts[shape];
      const mesh = this.meshes[shape];
      if (!list.length && !mesh.userData.dirty) continue;
      mesh.userData.dirty = list.length > 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.t += dt;
        if (p.t >= p.life) {
          d.position.set(0, -1000, 0); d.scale.setScalar(0); d.updateMatrix();
          mesh.setMatrixAt(p.idx, d.matrix);
          this.free[shape].push(p.idx);
          list.splice(i, 1);
          continue;
        }
        p.vy -= p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const k = p.t / p.life;
        const s = p.size * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85 * 0.9);
        const sc = Math.max(0.0001, s);
        if (shape === 'blob') {
          // round blobs need no rotation: a plain scale + translate is much cheaper
          this._m.makeScale(sc, sc, sc).setPosition(p.x, p.y, p.z);
          mesh.setMatrixAt(p.idx, this._m);
        } else {
          // stars spin around Y only: one cheap rotation instead of a full Euler compose
          const a = p.t * p.spin;
          const c = Math.cos(a) * sc, s2 = Math.sin(a) * sc;
          this._m.set(c, 0, s2, p.x, 0, sc, 0, p.y, -s2, 0, c, p.z, 0, 0, 0, 1);
          mesh.setMatrixAt(p.idx, this._m);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const r of this.rings) {
      if (!r.busy) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.busy = false; r.mesh.visible = false; r.mat.opacity = 0; continue; }
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(0.2 + (r.to - 0.2) * e);
      r.mat.opacity = 0.85 * (1 - k);
    }
  }

  dispose() {
    this.parent.remove(this.group);
    for (const m of Object.values(this.meshes)) m.dispose();
    this._mat.dispose();
    for (const r of this.rings) r.mat.dispose();
  }
}
