/**
 * World-space driving effects (OWNER: driving-feel workstream):
 *   - pastel tyre skid marks while drifting (pooled ring buffer, fade out on the GPU)
 *   - dust / sprinkle puffs when a kart drives off-road (colours per track surface)
 *   - a little landing puff after a hop
 * plus the per-player speed-lines HUD widget (src/ui/widgets/driveSpeedLines.js).
 *
 * Performance: one InstancedMesh for all skid marks and two for all puffs,
 * shared by every kart, so 8 karts x 4 views cost 3 draw calls per view.
 * Nothing touches WebGL / the DOM at import time.
 */
import * as THREE from 'three';
import { surfaceFor } from './drivingSounds.js';
import speedLinesWidget from '../ui/widgets/driveSpeedLines.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Skid mark colour per drift level (soft pastels; level 3 = rainbow by time). */
export const SKID_COLORS = Object.freeze([0xf6e7ff, 0xbfe6ff, 0xffc6ea, 0xffffff]);
export const SKID = Object.freeze({ capacity: 1024, life: 3.2, spacing: 0.9, width: 0.34, opacity: 0.55, lift: 0.045, wheelX: 0.72, wheelZ: -0.85 });

/** Puff colours per off-road surface (two tints each) + candy sprinkle colours. */
export const PUFF_COLORS = Object.freeze({
  grass: Object.freeze([0xeefbe4, 0xfffbea]),
  sand: Object.freeze([0xfff6de, 0xffeccb]),
  snow: Object.freeze([0xffffff, 0xe6f4ff]),
  squish: Object.freeze([0xffd0ec, 0xe0d2ff]),
  space: Object.freeze([0xdcd6ff, 0xfff5cc]),
});
export const SPRINKLE_COLORS = Object.freeze([0xff6fb5, 0xffe066, 0x6fc3ff, 0x9be58a, 0xc59bff]);
export const PUFF = Object.freeze({ capacity: 160, sprinkles: 96, rate: 18, minSpeed: 6, life: 0.6 });

// ------------------------------------------------------------------ materials

function fadeMaterial({ gpuFade }) {
  // Instanced colour + alpha. Skids fade on the GPU from their birth time;
  // puffs get their alpha from the CPU each frame.
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: gpuFade,
    polygonOffsetFactor: gpuFade ? -2 : 0,
    polygonOffsetUnits: gpuFade ? -2 : 0,
    uniforms: { uTime: { value: 0 }, uLife: { value: SKID.life }, uOpacity: { value: gpuFade ? SKID.opacity : 1 } },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aValue; // skids: birth time; puffs: alpha
      uniform float uTime;
      uniform float uLife;
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        vColor = aColor;
        vUv = uv;
        ${gpuFade
    ? 'float age = uTime - aValue; vAlpha = uOpacity * clamp(1.0 - age / uLife, 0.0, 1.0) * step(0.0, age);'
    : 'vAlpha = uOpacity * aValue;'}
        vShade = 0.86 + 0.14 * normal.y;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        float a = vAlpha;
        ${gpuFade ? 'a *= smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);' : ''}
        if (a <= 0.004) discard;
        gl_FragColor = vec4(vColor * ${gpuFade ? '1.0' : 'vShade'}, a);
        #include <colorspace_fragment>
      }`,
  });
}

function instanced(geo, mat, count) {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const color = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const value = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  color.setUsage(THREE.DynamicDrawUsage);
  value.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aColor', color);
  geo.setAttribute('aValue', value);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, zero);
  return { mesh, color, value };
}

// ------------------------------------------------------------------ skid marks

/**
 * Pooled skid marks: a ring buffer of flat quads. add() overwrites the oldest
 * mark once the pool is full; marks fade out over SKID.life seconds.
 */
export class SkidMarks {
  constructor({ capacity = SKID.capacity, life = SKID.life } = {}) {
    this.capacity = capacity;
    this.life = life;
    this.time = 0;
    this.next = 0;
    this.total = 0;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.material = fadeMaterial({ gpuFade: true });
    this.material.uniforms.uLife.value = life;
    const { mesh, color, value } = instanced(geo, this.material, capacity);
    for (let i = 0; i < capacity; i++) value.array[i] = -1e6; // long dead
    this.mesh = mesh;
    this.mesh.name = 'skid-marks';
    this._color = color;
    this._birth = value;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Marks still visible (born within `life`). */
  get alive() {
    let n = 0;
    const b = this._birth.array;
    for (let i = 0; i < this.capacity; i++) if (this.time - b[i] < this.life) n++;
    return n;
  }

  /** Alpha (0..1, before opacity) of slot i right now — mirrors the shader. */
  alphaOf(i) {
    const age = this.time - this._birth.array[i];
    return age < 0 ? 0 : clamp(1 - age / this.life, 0, 1);
  }

  /** Add one segment from (ax, az) to (bx, bz) at height y. Returns the slot used. */
  add(ax, az, bx, bz, y, color, width = SKID.width) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (!(len > 1e-4) || !Number.isFinite(y)) return -1;
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.total++;
    this._q.setFromAxisAngle(this._up, Math.atan2(dx, dz));
    this._p.set((ax + bx) / 2, y, (az + bz) / 2);
    this._s.set(width, 1, len + width * 0.5);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    this._c.set(color);
    this._color.setXYZ(i, this._c.r, this._c.g, this._c.b);
    this._birth.array[i] = this.time;
    this.mesh.instanceMatrix.needsUpdate = true;
    this._color.needsUpdate = true;
    this._birth.needsUpdate = true;
    return i;
  }

  update(dt) {
    this.time += clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
    this.material.uniforms.uTime.value = this.time;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose?.();
  }
}

/**
 * Per-kart skid tracker: remembers each rear wheel's last mark point and
 * lays a new segment every SKID.spacing metres while the kart drifts on the
 * road. Returns the number of segments added.
 */
export function trackSkids(state, kart, marks, time = 0) {
  const p = kart.phys || {};
  const onGround = !(p.hopY > 0.02);
  const active = kart.drifting && onGround && !kart.offRoad && Math.abs(kart.speed) > 4;
  if (!active) { state.wheels = null; return 0; }
  const h = kart.heading;
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = -fz, rz = fx;
  const y = (Number.isFinite(p.groundY) ? p.groundY : kart.position.y) + SKID.lift;
  const lvl = clamp(kart.driftLevel | 0, 0, 3);
  let color = SKID_COLORS[lvl];
  if (lvl === 3) color = new THREE.Color().setHSL((time * 0.4) % 1, 0.8, 0.86).getHex();
  const pts = [-1, 1].map((side) => [
    kart.position.x + rx * SKID.wheelX * side + fx * SKID.wheelZ,
    kart.position.z + rz * SKID.wheelX * side + fz * SKID.wheelZ,
  ]);
  if (!state.wheels) { state.wheels = pts; return 0; }
  let added = 0;
  for (let w = 0; w < 2; w++) {
    const [ax, az] = state.wheels[w];
    const [bx, bz] = pts[w];
    const d = Math.hypot(bx - ax, bz - az);
    if (d > 6) { state.wheels[w] = pts[w]; continue; } // teleported / wrapped: start fresh
    if (d >= SKID.spacing) {
      if (marks.add(ax, az, bx, bz, y, color) >= 0) added++;
      state.wheels[w] = pts[w];
    }
  }
  return added;
}

// ------------------------------------------------------------------ puffs

/** CPU-simulated pooled puffs (dust blobs or candy sprinkles). */
export class PuffPool {
  constructor({ capacity = PUFF.capacity, geometry = null, name = 'drive-puffs' } = {}) {
    this.capacity = capacity;
    const geo = geometry || new THREE.IcosahedronGeometry(0.34, 1);
    this.material = fadeMaterial({ gpuFade: false });
    const { mesh, color, value } = instanced(geo, this.material, capacity);
    this.mesh = mesh;
    this.mesh.name = name;
    this._color = color;
    this._alpha = value;
    this.items = Array.from({ length: capacity }, () => ({ age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 1, spin: 0 }));
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  get alive() {
    let n = 0;
    for (const it of this.items) if (it.age < it.life) n++;
    return n;
  }

  spawn({ x, y, z, vx = 0, vy = 1, vz = 0, size = 1, grow = 1.6, life = PUFF.life, color = 0xffffff }) {
    if (![x, y, z].every(Number.isFinite)) return -1;
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    Object.assign(this.items[i], { age: 0, life, x, y, z, vx, vy, vz, size, grow, spin: (i * 1.37) % 6.28 });
    this._c.set(color);
    this._color.setXYZ(i, this._c.r, this._c.g, this._c.b);
    this._color.needsUpdate = true;
    return i;
  }

  update(dt) {
    const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const a = this._alpha.array;
    for (let i = 0; i < this.capacity; i++) {
      const it = this.items[i];
      if (it.age >= it.life) {
        if (a[i] !== 0) { a[i] = 0; this._s.set(0, 0, 0); this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); }
        continue;
      }
      it.age += d;
      const k = clamp(it.age / it.life, 0, 1);
      it.x += it.vx * d; it.y += it.vy * d; it.z += it.vz * d;
      const drag = Math.exp(-3 * d);
      it.vx *= drag; it.vz *= drag; it.vy = it.vy * drag - 0.6 * d;
      a[i] = k >= 1 ? 0 : 0.85 * (1 - k) * Math.min(1, it.age / 0.06);
      const s = it.size * (0.5 + it.grow * k) * (k >= 1 ? 0 : 1);
      this._e.set(it.spin + it.age * 2, it.spin * 0.5, it.age * 3);
      this._q.setFromEuler(this._e);
      this._p.set(it.x, it.y, it.z);
      this._s.set(s, s, s);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this._alpha.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose?.();
  }
}

/** Off-road puffs per second for a kart (0 on the road, in the air or crawling). */
export function offRoadPuffRate(kart) {
  if (!kart?.offRoad || kart.phys?.hopY > 0.02 || kart.starPower > 0) return 0;
  const sp = Math.abs(kart.speed || 0);
  if (sp < PUFF.minSpeed) return 0;
  return PUFF.rate * clamp(sp / Math.max(10, kart.stats?.maxSpeed ?? 30), 0.3, 1.2);
}

// ------------------------------------------------------------------ the whole set

/** All world driving FX for one race (created at race-start, disposed at race-exit). */
export function createDrivingFx(scene, { surface = 'grass' } = {}) {
  const skids = new SkidMarks();
  const dust = new PuffPool({ name: 'drive-dust' });
  const sprinkles = new PuffPool({ capacity: PUFF.sprinkles, geometry: new THREE.CapsuleGeometry(0.07, 0.26, 2, 6), name: 'drive-sprinkles' });
  const group = new THREE.Group();
  group.name = 'driving-fx';
  group.add(skids.mesh, dust.mesh, sprinkles.mesh);
  scene?.add?.(group);
  const tints = PUFF_COLORS[surface] || PUFF_COLORS.grass;
  const perKart = new Map(); // kart -> { wheels, puffAcc }
  let time = 0;
  let n = 0;

  const stateOf = (k) => {
    let st = perKart.get(k);
    if (!st) { st = { wheels: null, puffAcc: 0 }; perKart.set(k, st); }
    return st;
  };

  function puffBehind(k, { color, sprinkle = false } = {}) {
    // Puffs pop out sideways from the rear wheels and stay low, so they never
    // bloom right in front of the chase camera.
    const h = k.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = -fz, rz = fx; // kart's right
    const side = n++ % 2 ? 1 : -1;
    const x = k.position.x - fx * 0.9 + rx * 0.75 * side;
    const z = k.position.z - fz * 0.9 + rz * 0.75 * side;
    const y = (k.phys?.groundY ?? k.position.y) + 0.2;
    const jitter = ((n * 0.618) % 1) - 0.5;
    const out = 2.2 + jitter;
    const carry = Math.max(0, k.speed || 0) * 0.6; // mostly travel along with the kart
    const pool = sprinkle ? sprinkles : dust;
    pool.spawn({
      x, y, z,
      vx: rx * out * side + fx * carry, vy: sprinkle ? 2.6 : 0.9, vz: rz * out * side + fz * carry,
      size: sprinkle ? 1 : 0.6 + (n % 3) * 0.15, grow: sprinkle ? 0.2 : 1.4, life: sprinkle ? 0.8 : PUFF.life,
      color: color ?? tints[n % 2],
    });
  }

  return {
    group, skids, dust, sprinkles,
    /** Called every race frame (not while paused). */
    update(dt, karts) {
      const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      time += d;
      for (const k of karts || []) {
        if (!k?.position) continue;
        const st = stateOf(k);
        trackSkids(st, k, skids, time);
        const rate = offRoadPuffRate(k);
        if (rate > 0) {
          st.puffAcc += rate * d;
          while (st.puffAcc >= 1) {
            st.puffAcc -= 1;
            const sprinkle = n % 3 === 0;
            puffBehind(k, { sprinkle, color: sprinkle ? SPRINKLE_COLORS[n % SPRINKLE_COLORS.length] : undefined });
          }
        } else st.puffAcc = 0;
      }
      skids.update(d);
      dust.update(d);
      sprinkles.update(d);
    },
    /** A soft ring of puffs when a kart lands a hop. */
    landPuff(k, strength = 0.5) {
      if (!k?.position) return;
      const count = 6;
      const y = (k.phys?.groundY ?? k.position.y) + 0.15;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + k.heading;
        dust.spawn({
          x: k.position.x + Math.sin(a) * 0.9, y, z: k.position.z + Math.cos(a) * 0.9,
          vx: Math.sin(a) * 2.2, vy: 0.5, vz: Math.cos(a) * 2.2,
          size: 0.55 + 0.4 * clamp(strength, 0, 1), grow: 1.2, life: 0.45, color: i % 2 ? 0xffffff : tints[0],
        });
      }
    },
    dispose() {
      group.removeFromParent();
      skids.dispose();
      dust.dispose();
      sprinkles.dispose();
      perKart.clear();
    },
  };
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'driving-fx',
  order: 55,
  install(bus, app) {
    let fx = null;
    const stop = () => { fx?.dispose(); fx = null; };
    let removeWidget = null;
    try { removeWidget = app?.hud?.addWidget?.(speedLinesWidget) ?? null; } catch { removeWidget = null; }
    const offs = [
      bus.on('race-start', (info, s) => {
        stop();
        if (!s?.scene) return;
        fx = createDrivingFx(s.scene, { surface: surfaceFor(s.trackDef ?? { id: info?.trackId }) });
      }),
      bus.on('race-frame', (dt, s) => {
        if (!fx || s?.paused) return;
        try { fx.update(dt, s.race?.karts); } catch { /* effects never break the race */ }
      }),
      bus.on('race:land', (e) => { try { fx?.landPuff(e.kart, e.strength); } catch { /* ignore */ } }),
      bus.on('race-exit', stop),
    ];
    return () => {
      offs.forEach((off) => off());
      stop();
      try { removeWidget?.(); } catch { /* ignore */ }
    };
  },
};
