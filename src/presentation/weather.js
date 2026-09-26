/**
 * Ambient track life: gentle per-track "weather" around every camera —
 * sprinkle-snow, soap bubbles, blossom petals, autumn leaves, fireflies,
 * pollen, confetti, lemonade fizz, cocoa dust, stardust.
 * OWNER: showcase presentation (installed by src/systems/ambientWeather.js).
 *
 * One THREE.Points per race (never one per player): the particles live in a
 * box that WRAPS around whichever camera is drawing (a uniform set in
 * onBeforeRender), so each split-screen view sees weather all around it for
 * the cost of a few hundred points. Deterministic (seeded) and headless-safe:
 * nothing here touches the DOM or WebGL until the renderer draws it.
 *
 *   const kind = weatherFor(trackDef);                 // 'bubbles' | ... | null
 *   const spec = weatherSpec(kind, { particleScale }); // counts, colours, motion
 *   const w = buildWeather(spec, { seed: trackDef.id }); scene.add(w.object);
 *   w.update(dt);  ...  w.dispose();
 */
import * as THREE from 'three';

/** Particle shapes drawn by the fragment shader. */
export const SHAPES = Object.freeze({ soft: 0, bubble: 1, petal: 2, sparkle: 3, sprinkle: 4 });

const CANDY = [0xff6fb5, 0x7cc8ff, 0xffd95e, 0x6fe3bf, 0xb48cff, 0xff9f80];

/**
 * Every weather kind. count = particles at full sparkle, box = side of the
 * wrapping cube around the camera (m), size = world size (m), vel = drift
 * (m/s), sway = wobble amplitude (m), spin = shape rotation speed, twinkle 0..1.
 */
export const WEATHER_KINDS = Object.freeze({
  snow: { count: 700, box: 38, size: 0.36, vel: [0.3, -2.1, 0.2], sway: 0.9, shape: SHAPES.soft, colors: [0xffffff, 0xf2f8ff, 0xe6f2ff], opacity: 0.95, twinkle: 0, spin: 0, additive: false },
  'sprinkle-snow': { count: 700, box: 38, size: 0.45, vel: [0.2, -2.4, 0.1], sway: 0.7, shape: SHAPES.sprinkle, colors: CANDY, opacity: 1, twinkle: 0, spin: 1.4, additive: false },
  bubbles: { count: 240, box: 38, size: 1.1, vel: [0.25, 1.0, 0.1], sway: 1.3, shape: SHAPES.bubble, colors: [0xffffff, 0xffd6f0, 0xd6f0ff, 0xe8ffe0], opacity: 0.85, twinkle: 0.15, spin: 0, additive: false },
  fizz: { count: 380, box: 38, size: 0.4, vel: [0.1, 2.3, 0.05], sway: 0.5, shape: SHAPES.bubble, colors: [0xffffff, 0xfff6b0, 0xfff0d0], opacity: 0.8, twinkle: 0.2, spin: 0, additive: false },
  petals: { count: 380, box: 38, size: 0.66, vel: [0.9, -1.1, 0.4], sway: 1.7, shape: SHAPES.petal, colors: [0xffc2e0, 0xffe0ef, 0xffffff, 0xffa8d2], opacity: 0.95, twinkle: 0, spin: 1.2, additive: false },
  leaves: { count: 320, box: 38, size: 0.78, vel: [1.1, -1.5, 0.5], sway: 2.0, shape: SHAPES.petal, colors: [0xff9a3c, 0xffc23d, 0xe8643a, 0xffd98a], opacity: 1, twinkle: 0, spin: 1.8, additive: false },
  confetti: { count: 380, box: 38, size: 0.55, vel: [0.3, -1.3, 0.2], sway: 1.2, shape: SHAPES.petal, colors: CANDY, opacity: 1, twinkle: 0, spin: 2.6, additive: false },
  pollen: { count: 380, box: 38, size: 0.2, vel: [0.35, 0.15, 0.2], sway: 1.4, shape: SHAPES.soft, colors: [0xffe27a, 0xfff2b0, 0xffffff], opacity: 0.9, twinkle: 0.5, spin: 0, additive: true },
  dust: { count: 320, box: 38, size: 0.24, vel: [0.6, 0.05, 0.3], sway: 1.0, shape: SHAPES.soft, colors: [0xffe2c0, 0xf5c79a, 0xfff0dd], opacity: 0.55, twinkle: 0.3, spin: 0, additive: false },
  fireflies: { count: 300, box: 38, size: 0.36, vel: [0.1, 0.12, 0.1], sway: 1.6, shape: SHAPES.soft, colors: [0xfff27a, 0xd8ff8a, 0xffd36e, 0xffffff], opacity: 1, twinkle: 0.85, spin: 0, additive: true },
  stardust: { count: 420, box: 38, size: 0.42, vel: [0.05, -0.15, 0.05], sway: 0.8, shape: SHAPES.sparkle, colors: [0xffffff, 0xfff3b0, 0xe6d6ff, 0xffd6f0], opacity: 1, twinkle: 0.9, spin: 0.4, additive: true },
});

/** Hand-picked weather for every track in the lineup (anything else falls back by theme). */
export const TRACK_WEATHER = Object.freeze({
  'cotton-candy-castle': 'confetti',
  'gumdrop-meadow': 'petals',
  'starlight-galaxy': 'stardust',
  'sundae-slopes': 'snow',
  'bubblegum-bay': 'bubbles',
  'mermaid-lagoon': 'bubbles',
  'teddy-toyland': 'confetti',
  'honeycomb-hive': 'pollen',
  'pumpkin-patch': 'leaves',
  'teacup-garden': 'petals',
  'peppermint-village': 'snow',
  'pillow-fort': 'fireflies',
  'jellybean-jungle': 'pollen',
  'cocoa-canyon': 'dust',
  'lemonade-volcano': 'fizz',
  'donut-downtown': 'fireflies',
  'cupcake-carnival': 'confetti',
  'aurora-palace': 'snow',
  'moonbounce-base': 'stardust',
  'ribbon-sky': 'confetti',
});

/**
 * Which weather a track gets: `theme.weather` (a kind, or 'none'), else the
 * table above, else fireflies at night and stardust by day.
 * @param {object} trackDef
 * @returns {string|null}
 */
export function weatherFor(trackDef) {
  if (!trackDef) return null;
  const own = trackDef.theme?.weather;
  if (own === 'none' || own === null || own === false) return null;
  if (typeof own === 'string' && WEATHER_KINDS[own]) return own;
  if (TRACK_WEATHER[trackDef.id]) return TRACK_WEATHER[trackDef.id];
  return trackDef.theme?.night ? 'fireflies' : 'stardust';
}

/**
 * The spec for a kind at a given particle scale (0.5 in gentle motion:
 * half as many, calmer drift).
 * @returns {null | (typeof WEATHER_KINDS.snow & { kind: string })}
 */
export function weatherSpec(kind, { particleScale = 1 } = {}) {
  const base = WEATHER_KINDS[kind];
  if (!base) return null;
  const scale = Math.max(0, Math.min(1, Number.isFinite(particleScale) ? particleScale : 1));
  const calm = scale < 1 ? 0.6 : 1;
  return {
    ...base,
    kind,
    count: Math.max(0, Math.round(base.count * scale)),
    vel: base.vel.map((v) => v * calm),
    sway: base.sway * calm,
    spin: base.spin * calm,
  };
}

/** Small seeded RNG (mulberry32) so the same track always gets the same flakes. */
export function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aRand;
uniform float uTime;
uniform float uBox;
uniform float uSway;
uniform float uSize;
uniform float uScale;
uniform float uTwinkle;
uniform float uSpin;
uniform vec3 uCam;
uniform vec3 uVel;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
void main() {
  float t = uTime * aRand.y;
  vec3 p = position + uVel * t;
  float ph = aRand.x * 6.2831;
  p.x += sin(t * 0.9 + ph) * uSway;
  p.z += cos(t * 0.7 + ph * 1.3) * uSway;
  p.y += sin(t * 1.3 + ph * 0.7) * uSway * 0.3;
  vec3 rel = mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = length(rel);
  float depth = -mv.z;
  vAlpha = (1.0 - smoothstep(uBox * 0.32, uBox * 0.5, dist)) * smoothstep(0.6, 3.0, depth);
  vAlpha *= mix(1.0, 0.25 + 0.75 * abs(sin(uTime * (1.2 + 2.0 * aRand.w) + ph * 3.0)), uTwinkle);
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * aRand.z) * uScale / max(0.2, depth), 0.0, 72.0);
  vColor = aColor;
  vSpin = ph + uTime * uSpin * (aRand.w - 0.5) * 2.0;
}
`;

const FRAG = /* glsl */ `
uniform int uShape;
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vSpin);
  float co = cos(vSpin);
  vec2 r = vec2(co * c.x - s * c.y, s * c.x + co * c.y);
  float d = length(c);
  float a;
  vec3 col = vColor;
  if (uShape == 1) {
    float ring = smoothstep(0.5, 0.44, d) * (0.18 + 0.82 * smoothstep(0.3, 0.46, d));
    float shine = smoothstep(0.13, 0.02, length(c - vec2(-0.16, -0.16)));
    a = max(ring, shine);
    col = mix(col, vec3(1.0), shine);
  } else if (uShape == 2) {
    a = smoothstep(0.5, 0.38, length(r * vec2(1.0, 2.1)));
    col *= 0.85 + 0.3 * smoothstep(-0.3, 0.3, r.x);
  } else if (uShape == 3) {
    vec2 ac = abs(r);
    float cross = max(smoothstep(0.07, 0.0, ac.x) * smoothstep(0.5, 0.0, ac.y), smoothstep(0.07, 0.0, ac.y) * smoothstep(0.5, 0.0, ac.x));
    a = max(cross, smoothstep(0.2, 0.0, d));
  } else if (uShape == 4) {
    float cap = length(vec2(r.x, max(abs(r.y) - 0.26, 0.0)));
    a = smoothstep(0.15, 0.1, cap);
  } else {
    a = smoothstep(0.5, 0.12, d);
  }
  a *= vAlpha * uOpacity;
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

const _vp = new THREE.Vector4();

/**
 * Build the particle object for a spec.
 * @param {ReturnType<typeof weatherSpec>} spec
 * @param {{ seed?: string|number }} [opts]
 * @returns {{ object: THREE.Points, material: THREE.ShaderMaterial, geometry: THREE.BufferGeometry,
 *             kind: string, count: number, update(dt:number): void, dispose(): void, time: number }}
 */
export function buildWeather(spec, { seed = 'weather' } = {}) {
  if (!spec) throw new Error('[weather] no spec');
  const n = spec.count;
  const rnd = seededRandom(`${seed}:${spec.kind}`);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const rand = new Float32Array(n * 4);
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rnd() * spec.box;
    pos[i * 3 + 1] = rnd() * spec.box;
    pos[i * 3 + 2] = rnd() * spec.box;
    tmp.setHex(spec.colors[Math.floor(rnd() * spec.colors.length) % spec.colors.length]);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
    rand[i * 4] = rnd();
    rand[i * 4 + 1] = 0.7 + rnd() * 0.6;
    rand[i * 4 + 2] = rnd();
    rand[i * 4 + 3] = rnd();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // never culled

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uBox: { value: spec.box },
      uSway: { value: spec.sway },
      uSize: { value: spec.size },
      uScale: { value: 400 },
      uTwinkle: { value: spec.twinkle },
      uSpin: { value: spec.spin },
      uCam: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3(...spec.vel) },
      uShape: { value: spec.shape },
      uOpacity: { value: spec.opacity },
    },
  });
  const object = new THREE.Points(geometry, material);
  object.name = `weather:${spec.kind}`;
  object.frustumCulled = false;
  object.renderOrder = 5;
  object.userData.presentation = 'weather';
  // Per camera (so every split-screen view gets its own wrap box and pixel scale).
  object.onBeforeRender = (renderer, scene, camera) => {
    const u = material.uniforms;
    if (camera?.getWorldPosition) camera.getWorldPosition(u.uCam.value);
    let h = 720;
    try { if (renderer?.getCurrentViewport) h = renderer.getCurrentViewport(_vp).w || h; } catch { /* keep default */ }
    const fov = Number.isFinite(camera?.fov) ? camera.fov : 60;
    u.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
  };

  let disposed = false;
  const w = {
    object,
    material,
    geometry,
    kind: spec.kind,
    count: n,
    time: 0,
    update(dt) {
      if (disposed || !(dt > 0)) return;
      w.time = (w.time + Math.min(dt, 0.1)) % 10000;
      material.uniforms.uTime.value = w.time;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
  return w;
}
