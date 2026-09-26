/**
 * 3D confetti bursts (finish line, podium). One Points object holds every
 * piece of a scene (a ring buffer), so bursts never allocate per frame.
 * OWNER: showcase presentation.
 *
 *   const c = createConfetti({ max: 600, seed: 'finish' });
 *   scene.add(c.object);
 *   c.burst({ x, y, z }, { count: 140, power: 1 });
 *   c.update(dt);   // gravity, air drag, flutter; fades out at the end of life
 *   c.dispose();
 *
 * The simulation (createConfettiSim) is pure and unit-tested.
 */
import * as THREE from 'three';
import { seededRandom } from './weather.js';

export const CONFETTI_COLORS = Object.freeze([0xff5fb4, 0xb48cff, 0x4fd6a8, 0x4fa8ff, 0xffc933, 0xff8a65, 0xffffff]);

/**
 * Pure particle simulation.
 * @param {{ max?: number, seed?: string|number, gravity?: number, drag?: number, life?: number }} [opts]
 */
export function createConfettiSim({ max = 600, seed = 'confetti', gravity = 7.5, drag = 1.6, life = 3.4 } = {}) {
  const rnd = seededRandom(seed);
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const age = new Float32Array(max).fill(Infinity);
  const ttl = new Float32Array(max).fill(1);
  const spin = new Float32Array(max);
  const color = new Float32Array(max * 3);
  let head = 0;
  let alive = 0;
  const tmp = new THREE.Color();

  return {
    max, pos, vel, age, ttl, spin, color,
    get alive() { return alive; },
    /**
     * Throw `count` pieces up and outwards from `origin`.
     * @param {{x:number,y:number,z:number}} origin
     * @param {{ count?: number, power?: number, colors?: number[], spread?: number, up?: number,
     *          inherit?: {x:number, z:number} }} [o] inherit = a moving kart's velocity (the burst travels with it)
     */
    burst(origin, { count = 120, power = 1, colors = CONFETTI_COLORS, spread = 1, up = 1, inherit = null } = {}) {
      const ivx = Number.isFinite(inherit?.x) ? inherit.x : 0;
      const ivz = Number.isFinite(inherit?.z) ? inherit.z : 0;
      if (!origin || ![origin.x, origin.y, origin.z].every(Number.isFinite)) return 0;
      const n = Math.max(0, Math.min(max, Math.round(count)));
      for (let k = 0; k < n; k++) {
        const i = head;
        head = (head + 1) % max;
        const a = rnd() * Math.PI * 2;
        const out = (2.2 + rnd() * 4.2) * power * spread;
        pos[i * 3] = origin.x + (rnd() - 0.5) * 0.6;
        pos[i * 3 + 1] = origin.y + rnd() * 0.4;
        pos[i * 3 + 2] = origin.z + (rnd() - 0.5) * 0.6;
        vel[i * 3] = Math.cos(a) * out + ivx;
        vel[i * 3 + 1] = (6 + rnd() * 5.5) * power * up;
        vel[i * 3 + 2] = Math.sin(a) * out + ivz;
        if (Number.isFinite(age[i])) alive--; // recycling a live piece
        age[i] = 0;
        ttl[i] = life * (0.75 + rnd() * 0.5);
        spin[i] = rnd() * Math.PI * 2;
        tmp.setHex(colors[Math.floor(rnd() * colors.length) % colors.length]);
        color[i * 3] = tmp.r;
        color[i * 3 + 1] = tmp.g;
        color[i * 3 + 2] = tmp.b;
        alive++;
      }
      return n;
    },
    /** Advance every live piece. */
    step(dt) {
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      if (!dt || !alive) return alive;
      const k = Math.exp(-drag * dt);
      for (let i = 0; i < max; i++) {
        if (!Number.isFinite(age[i])) continue;
        age[i] += dt;
        if (age[i] >= ttl[i]) { age[i] = Infinity; alive--; pos[i * 3 + 1] = -1e5; continue; }
        const j = i * 3;
        vel[j] *= k;
        vel[j + 2] *= k;
        vel[j + 1] = vel[j + 1] * k - gravity * dt;
        if (vel[j + 1] < -2.2) vel[j + 1] = -2.2; // terminal flutter speed
        const f = Math.sin(age[i] * 6 + spin[i]) * 0.9; // side-to-side flutter
        pos[j] += (vel[j] + f) * dt;
        pos[j + 1] += vel[j + 1] * dt;
        pos[j + 2] += (vel[j + 2] + Math.cos(age[i] * 5 + spin[i]) * 0.9) * dt;
        spin[i] += dt * 7;
      }
      return alive;
    },
    /** 0..1 opacity of piece i (fades over the last 30% of its life). */
    alpha(i) {
      if (!Number.isFinite(age[i])) return 0;
      return Math.max(0, Math.min(1, (ttl[i] - age[i]) / (ttl[i] * 0.3)));
    },
    clear() { age.fill(Infinity); alive = 0; for (let i = 0; i < max; i++) pos[i * 3 + 1] = -1e5; },
  };
}

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec2 aLife;
uniform float uScale;
uniform float uSize;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale / max(0.2, -mv.z), 0.0, 96.0);
  vColor = aColor;
  vAlpha = aLife.x;
  vSpin = aLife.y;
}
`;
const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vSpin);
  float co = cos(vSpin);
  vec2 r = vec2(co * c.x - s * c.y, s * c.x + co * c.y);
  float flip = 0.25 + 0.75 * abs(cos(vSpin * 1.7));
  vec2 q = abs(r) - vec2(0.42, 0.2 * flip);
  float a = 1.0 - smoothstep(0.0, 0.05, max(q.x, q.y));
  a *= vAlpha;
  if (a < 0.03) discard;
  gl_FragColor = vec4(vColor * (0.8 + 0.2 * flip), a);
}
`;

const _vp = new THREE.Vector4();

/**
 * Confetti for a scene.
 * @param {{ max?: number, seed?: string|number, size?: number }} [opts]
 */
export function createConfetti({ max = 600, seed = 'confetti', size = 0.3, ...simOpts } = {}) {
  const sim = createConfettiSim({ max, seed, ...simOpts });
  sim.clear();
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(sim.pos, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(sim.color, 3);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  const life = new Float32Array(max * 2);
  const lifeAttr = new THREE.BufferAttribute(life, 2);
  lifeAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aColor', colAttr);
  geometry.setAttribute('aLife', lifeAttr);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: { uScale: { value: 400 }, uSize: { value: size } },
  });
  const object = new THREE.Points(geometry, material);
  object.name = 'confetti';
  object.frustumCulled = false;
  object.renderOrder = 6;
  object.userData.presentation = 'confetti';
  object.visible = false;
  object.onBeforeRender = (renderer, scene, camera) => {
    let h = 720;
    try { if (renderer?.getCurrentViewport) h = renderer.getCurrentViewport(_vp).w || h; } catch { /* default */ }
    const fov = Number.isFinite(camera?.fov) ? camera.fov : 60;
    material.uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
  };

  let disposed = false;
  const sync = () => {
    for (let i = 0; i < max; i++) {
      life[i * 2] = sim.alpha(i);
      life[i * 2 + 1] = sim.spin[i];
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
  };
  return {
    object,
    sim,
    get alive() { return sim.alive; },
    burst(origin, opts) {
      if (disposed) return 0;
      const n = sim.burst(origin, opts);
      if (n) { object.visible = true; sync(); }
      return n;
    },
    update(dt) {
      if (disposed || !sim.alive) { object.visible = false; return; }
      sim.step(dt);
      sync();
      object.visible = sim.alive > 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
