import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toon, glow } from './toon.js';

/**
 * Procedural chibi kart + driver models for every Sprinkle Kart racer.
 *
 *   buildKartModel(charDef) -> { group, update(dt, state), dispose() }
 *
 * Model space: origin on the ground under the kart centre, forward = +Z,
 * up = +Y, the driver's right = -X. A kart is ~2.2 long and ~1.6 wide.
 *
 * Performance: every static piece is baked (merged) per animated sub-group and
 * per material, and cartoon outlines are merged into one mesh per sub-group,
 * so a whole kart is only a few dozen draw calls. update() allocates nothing.
 *
 * Hierarchy (animated nodes):
 *   group                    <- the Race moves/rotates this
 *   ├─ shadow                   soft blob shadow (never spins)
 *   └─ root                     happy-spin + drift-slide yaw
 *      ├─ chassis               bob / roll / boost pitch
 *      │  ├─ front wheel pivots (steer) → spin, rear axle (spin), steering wheel
 *      │  └─ driver             lean / bounce  → head (tilt, look) → eyes (blink)
 *      └─ effects               drift sparks, rainbow boost puff, shield bubble
 */

// ─────────────────────────────────────────────────────────────── constants ──

const OUTLINE_W = 0.022;
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x2a1633, side: THREE.BackSide });
const EYE_DARK = 0x22162e;
const WHITE = 0xffffff;
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

const DRIFT_COLORS = [0xfff4c2, 0x4fb8ff, 0xff5fc8]; // level 0 (dust), 1 blue, 2 pink; 3 = rainbow
const RAINBOW = [0xff6b9a, 0xffa64d, 0xffe45c, 0x7ee07a, 0x5ec8ff, 0xb68cff];

// ─────────────────────────────────────────────────────────────── geometry ──

function starShape(R, r, points = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 === 0 ? R : r;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function heartShape(size) {
  const k = size / 1.0;
  const s = new THREE.Shape();
  s.moveTo(0, -0.55 * k);
  s.bezierCurveTo(-0.15 * k, -0.35 * k, -0.62 * k, -0.18 * k, -0.6 * k, 0.15 * k);
  s.bezierCurveTo(-0.58 * k, 0.48 * k, -0.18 * k, 0.55 * k, 0, 0.28 * k);
  s.bezierCurveTo(0.18 * k, 0.55 * k, 0.58 * k, 0.48 * k, 0.6 * k, 0.15 * k);
  s.bezierCurveTo(0.62 * k, -0.18 * k, 0.15 * k, -0.35 * k, 0, -0.55 * k);
  return s;
}

function extrude(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 5,
  });
  g.center();
  return g;
}

/** Small geometry factory. Every call returns a fresh geometry (the Kit owns it). */
const G = {
  sph: (r, w = r >= 0.28 ? 14 : 10, h = r >= 0.28 ? 10 : 7) => new THREE.SphereGeometry(r, w, h),
  /** lower half sphere (bowl) */
  bowl: (r, w = 16, h = 6) => new THREE.SphereGeometry(r, w, h, 0, TAU, Math.PI / 2, Math.PI / 2),
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
  rbox: (x, y, z, rad = 0.08) =>
    new RoundedBoxGeometry(x, y, z, Math.min(x, y, z) >= 0.2 ? 2 : 1, Math.min(rad, x / 2.05, y / 2.05, z / 2.05)),
  cyl: (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg),
  cone: (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg),
  tor: (R, t, rs = 6, ts = 14, arc = TAU) => new THREE.TorusGeometry(R, t, rs, ts, arc),
  cap: (r, len, rs = 8) => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, rs),
  ico: (r, d = 1) => new THREE.IcosahedronGeometry(r, d),
  star: (R, depth = 0.06, inner = 0.45) => extrude(starShape(R, R * inner), depth, depth * 0.35),
  heart: (size, depth = 0.06) => extrude(heartShape(size), depth, depth * 0.3),
  tube: (pts, r, seg = 20, rs = 6) =>
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, rs, false),
};

// Shared effect geometries (never disposed per kart).
const FX = {
  spark: new THREE.OctahedronGeometry(0.09, 0),
  puff: new THREE.IcosahedronGeometry(0.2, 1),
  bubble: new THREE.SphereGeometry(1, 18, 12),
  star: G.star(0.09, 0.03),
  heart: G.heart(0.16, 0.03),
  shadow: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
  flame: new THREE.ConeGeometry(0.1, 0.45, 8).rotateX(-Math.PI / 2),
};
const SHADOW_MAT = new THREE.MeshBasicMaterial({
  color: 0x3a1f4a,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

// ──────────────────────────────────────────────────────────────── the Kit ──

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Matrix for a sub-frame (e.g. a hat, an eye) that parts can be placed in. */
function frame(p = [0, 0, 0], r = [0, 0, 0], parent = null) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], r[3] || 'XYZ'));
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), q, ONE);
  if (parent) m.premultiply(parent);
  return m;
}

/**
 * Collects primitive parts per target Object3D, then bakes them into one mesh
 * per material plus one merged outline mesh.
 */
class Kit {
  constructor() {
    this.buckets = new Map();
    this.geometries = [];
  }

  /**
   * @param {THREE.Object3D} target
   * @param {THREE.BufferGeometry} geo  fresh geometry (consumed)
   * @param {THREE.Material} mat
   * @param {{p?:number[], r?:any[], q?:THREE.Quaternion, s?:number|number[], f?:THREE.Matrix4,
   *          outline?:boolean, ow?:number}} [o]
   */
  add(target, geo, mat, o = {}) {
    const g = geo;
    if (o.s !== undefined) {
      if (typeof o.s === 'number') g.scale(o.s, o.s, o.s);
      else g.scale(o.s[0], o.s[1], o.s[2]);
    }
    let ol = null;
    if (o.outline !== false) {
      g.computeBoundingBox();
      g.boundingBox.getSize(_s);
    }
    // tiny bits (buttons, prongs…) read better without a heavy outline
    if (o.outline === true || (o.outline !== false && Math.max(_s.x, _s.y, _s.z) >= 0.09)) {
      const w = o.ow ?? OUTLINE_W;
      ol = g.clone();
      ol.computeBoundingBox();
      ol.boundingBox.getCenter(_c);
      ol.boundingBox.getSize(_s);
      ol.translate(-_c.x, -_c.y, -_c.z);
      ol.scale(1 + (2 * w) / Math.max(_s.x, 1e-3), 1 + (2 * w) / Math.max(_s.y, 1e-3), 1 + (2 * w) / Math.max(_s.z, 1e-3));
      ol.translate(_c.x, _c.y, _c.z);
    }
    if (o.q) _q.copy(o.q);
    else if (o.r) _q.setFromEuler(_e.set(o.r[0] || 0, o.r[1] || 0, o.r[2] || 0, o.r[3] || 'XYZ'));
    else _q.identity();
    const p = o.p || [0, 0, 0];
    _p.set(p[0], p[1], p[2]);
    _m.compose(_p, _q, ONE);
    if (o.f) _m.premultiply(o.f);
    g.applyMatrix4(_m);
    if (ol) ol.applyMatrix4(_m);
    if (!this.buckets.has(target)) this.buckets.set(target, []);
    this.buckets.get(target).push({ g, mat, ol });
    return this;
  }

  bake() {
    for (const [target, parts] of this.buckets) {
      const byMat = new Map();
      const outlines = [];
      for (const { g, mat, ol } of parts) {
        const key = batchKey(mat);
        const geo = clean(g);
        if (key !== mat) paint(geo, mat);
        if (!byMat.has(key)) byMat.set(key, []);
        byMat.get(key).push(geo);
        if (ol) outlines.push(clean(ol));
      }
      for (const [mat, geos] of byMat) {
        const merged = mergeGeometries(geos, false);
        geos.forEach((x) => x.dispose());
        merged.computeBoundingSphere();
        this.geometries.push(merged);
        const mesh = new THREE.Mesh(merged, mat);
        if (mat.transparent) mesh.renderOrder = 2;
        target.add(mesh);
      }
      if (outlines.length) {
        const merged = mergeGeometries(outlines, false);
        outlines.forEach((x) => x.dispose());
        merged.computeBoundingSphere();
        this.geometries.push(merged);
        const mesh = new THREE.Mesh(merged, OUTLINE_MAT);
        mesh.renderOrder = -1;
        target.add(mesh);
      }
    }
    this.buckets.clear();
  }
}

/*
 * Draw-call batching: every opaque front-sided toon() / glow() part is baked
 * with its colour in a vertex attribute and drawn with ONE shared vertex-colour
 * material, so each animated sub-group costs ~3 draw calls in total.
 * Transparent / double-sided materials keep their own material.
 */
const VC_TOON = toon(WHITE, { unique: true });
VC_TOON.vertexColors = true;
const VC_GLOW = new THREE.MeshBasicMaterial({ color: WHITE, vertexColors: true });

function batchKey(mat) {
  if (mat.transparent || mat.side !== THREE.FrontSide) return mat;
  if (mat.isMeshToonMaterial) return VC_TOON;
  if (mat.isMeshBasicMaterial) return VC_GLOW;
  return mat;
}

const _col = new THREE.Color();
function paint(geo, mat) {
  _col.copy(mat.color);
  if (mat.emissive && mat.emissiveIntensity) {
    // fold a little of the emissive glow into the baked colour
    _col.r = Math.min(1, _col.r + mat.emissive.r * mat.emissiveIntensity * 0.6);
    _col.g = Math.min(1, _col.g + mat.emissive.g * mat.emissiveIntensity * 0.6);
    _col.b = Math.min(1, _col.b + mat.emissive.b * mat.emissiveIntensity * 0.6);
  }
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _col.r;
    arr[i * 3 + 1] = _col.g;
    arr[i * 3 + 2] = _col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** Normalise a geometry for merging: non-indexed, position + normal only. */
function clean(g) {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') out.deleteAttribute(name);
  }
  out.morphAttributes = {};
  out.clearGroups();
  return out;
}

// ─────────────────────────────────────────────────────────── part helpers ──

/** A capsule from point a to point b. */
function limb(kit, target, a, b, r, mat, o = {}) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const dir = B.clone().sub(A);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  kit.add(target, G.cap(r, len, o.rs ?? 8), mat, { ...o, p: mid.toArray(), q });
}

/** A thin cylinder from a to b (sticks, stems, struts). */
function stick(kit, target, a, b, r, mat, o = {}) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const dir = B.clone().sub(A);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  kit.add(target, G.cyl(r, r, len, o.seg ?? 8), mat, { ...o, p: mid.toArray(), q });
}

/**
 * Frame sitting on the surface of a sphere of radius R (centred at `c`), at
 * normalised face coords (u right-ish, v up), facing outward along the normal.
 */
function surf(R, u, v, depth = 1, c = [0, 0, 0], roll = 0) {
  const x = u * R;
  const y = v * R;
  const z = Math.sqrt(Math.max(R * R - x * x - y * y, 0));
  const nx = x / R;
  const ny = y / R;
  const nz = z / R;
  return frame([c[0] + nx * R * depth, c[1] + ny * R * depth, c[2] + nz * R * depth], [-Math.asin(ny), Math.atan2(nx, nz), roll, 'YXZ']);
}

/** Deterministic little random generator so every kart looks the same each time. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ───────────────────────────────────────────────────────────────── faces ──

/**
 * Big shiny chibi eyes (with blink + happy "^ ^" versions), rosy cheeks, mouth.
 * The head sphere is assumed centred at `c` in head space with radius R.
 */
function addFace(kit, rig, R, f = {}) {
  const {
    eyeColor = 0x6b4226,
    eyeU = 0.34,
    eyeV = 0.0,
    eyeW = 0.2,
    eyeH = 0.27,
    cheek = 0xff8fb0,
    cheekU = 0.58,
    cheekV = -0.27,
    mouth = 'smile',
    mouthV = -0.36,
    mouthW = 0.13,
    brows = null, // { color, angle, v, w }
    lashes = false,
    c = [0, 0, 0],
  } = f;

  const eyes = new THREE.Group();
  eyes.position.set(0, c[1] + eyeV * R, 0);
  rig.head.add(eyes);
  const happy = new THREE.Group();
  happy.position.copy(eyes.position);
  happy.visible = false;
  rig.head.add(happy);
  rig.eyes = eyes;
  rig.happyEyes = happy;
  const lift = frame([0, -(c[1] + eyeV * R), 0]);

  const dark = toon(EYE_DARK);
  const iris = toon(eyeColor, { emissive: eyeColor, emissiveIntensity: 0.25 });
  const shine = glow(WHITE);
  for (const side of [-1, 1]) {
    const F = surf(R, eyeU * side, eyeV, 0.9, c).premultiply(lift);
    kit.add(eyes, G.sph(1, 12, 9), dark, { f: F, s: [eyeW * R, eyeH * R, 0.13 * R], outline: false });
    kit.add(eyes, G.sph(1, 10, 6), iris, { f: F, p: [0, -0.08 * R, 0.07 * R], s: [eyeW * R * 0.74, eyeH * R * 0.55, 0.07 * R], outline: false });
    kit.add(eyes, G.sph(0.075 * R, 8, 6), shine, { f: F, p: [-0.06 * R, 0.1 * R, 0.13 * R], outline: false });
    kit.add(eyes, G.sph(0.038 * R, 6, 5), shine, { f: F, p: [0.07 * R, -0.1 * R, 0.13 * R], outline: false });
    if (lashes) {
      kit.add(eyes, G.cap(0.022 * R, 0.1 * R, 5), dark, {
        f: F,
        p: [side * eyeW * R * 0.95, eyeH * R * 0.72, 0.04 * R],
        r: [0, 0, -side * 0.9],
        outline: false,
      });
      kit.add(eyes, G.cap(0.02 * R, 0.07 * R, 5), dark, {
        f: F,
        p: [side * eyeW * R * 0.55, eyeH * R * 0.98, 0.05 * R],
        r: [0, 0, -side * 0.45],
        outline: false,
      });
    }
    // happy closed eyes: ∩
    kit.add(happy, G.tor(0.12 * R, 0.035 * R, 5, 10, Math.PI), dark, { f: F, p: [0, -0.06 * R, 0.1 * R], outline: false });
    // rosy cheeks
    kit.add(rig.head, G.sph(1, 10, 6), toon(cheek), {
      f: surf(R, cheekU * side, cheekV, 0.975, c),
      s: [0.15 * R, 0.085 * R, 0.05 * R],
      outline: false,
    });
    if (brows) {
      kit.add(rig.head, G.cap((brows.w ?? 0.035) * R, 0.16 * R, 5), toon(brows.color), {
        f: surf(R, (brows.u ?? 0.34) * side, brows.v ?? eyeV + 0.36, 1.0, c, 0),
        r: [0, 0, Math.PI / 2 - side * (brows.angle ?? 0.15)],
        outline: false,
      });
    }
  }
  if (mouth !== 'none') addMouth(kit, rig.head, surf(R, 0, mouthV, 0.985, c), R * mouthW, mouth);
}

/** Mouth placed in frame F. `w` = half width. kinds: smile | grin | tiny */
function addMouth(kit, target, F, w, kind = 'smile') {
  const dark = toon(0x5a1f33);
  if (kind === 'grin') {
    kit.add(target, G.bowl(1, 12, 5), dark, { f: F, p: [0, w * 0.35, 0], s: [w * 1.05, w * 0.95, w * 0.3], outline: false });
    kit.add(target, G.sph(1, 8, 6), toon(0xff7a9c), { f: F, p: [0, -w * 0.38, w * 0.12], s: [w * 0.55, w * 0.3, w * 0.2], outline: false });
  } else {
    const t = kind === 'tiny' ? 0.16 : 0.2;
    kit.add(target, G.tor(w, w * t, 5, 12, Math.PI), dark, { f: F, r: [0, 0, Math.PI], outline: false });
  }
}

// ────────────────────────────────────────────────────────────── the kart ──

/**
 * Shared kart chassis: shell, seat, steering wheel, exhausts, wheels.
 * k = { body, trim, seat, tire, hub, bar, width, shell:boolean, wheels:'classic'|'donut'|'cloud', fr, rr }
 */
function buildKartBase(kit, rig, k) {
  const W = k.width ?? 1.3;
  const body = toon(k.body);
  const trim = toon(k.trim);
  const seat = toon(k.seat);
  const C = rig.chassis;

  if (k.shell !== false) {
    kit.add(C, G.rbox(W, 0.3, 2.0, 0.13), body, { p: [0, 0.4, 0] });
    kit.add(C, G.rbox(W * 0.78, 0.26, 0.85, 0.11), body, { p: [0, 0.6, 0.48], r: [-0.2, 0, 0] });
    kit.add(C, G.cap(0.13, W * 0.78), trim, { p: [0, 0.34, 1.03], r: [0, 0, Math.PI / 2] });
    kit.add(C, G.cap(0.12, W * 0.72), trim, { p: [0, 0.36, -1.02], r: [0, 0, Math.PI / 2] });
    for (const sd of [-1, 1]) kit.add(C, G.rbox(0.24, 0.26, 0.62, 0.1), trim, { p: [sd * (W / 2 + 0.04), 0.44, 0.02] });
  }
  if (k.lights !== false) {
    for (const sd of [-1, 1]) {
      kit.add(C, G.sph(0.085, 10, 8), glow(0xfff6c9), { p: [sd * W * 0.3, 0.47, 1.0], s: [1, 1, 0.5] });
      kit.add(C, G.sph(0.03, 6, 5), glow(WHITE), { p: [sd * W * 0.3 - 0.025, 0.5, 1.04], outline: false });
    }
  }
  // seat + seat back
  kit.add(C, G.rbox(0.72, 0.14, 0.6, 0.06), seat, { p: [0, 0.62, -0.35] });
  kit.add(C, G.rbox(0.8, 0.5, 0.16, 0.07), seat, { p: [0, 0.9, -0.72], r: [-0.2, 0, 0] });
  // steering column + wheel
  stick(kit, C, [0, 0.66, 0.62], [0, 0.88, 0.36], 0.035, toon(0x6d6484));
  const sw = new THREE.Group();
  sw.position.set(0, 0.9, 0.34);
  sw.rotation.x = -0.95;
  C.add(sw);
  const swSpin = new THREE.Group();
  sw.add(swSpin);
  const swMat = toon(k.steer ?? k.trim);
  kit.add(swSpin, G.tor(0.15, 0.032, 6, 16), swMat);
  if (k.steerHeart) kit.add(swSpin, G.heart(0.15, 0.04), toon(k.steerHeart), { outline: false });
  else kit.add(swSpin, G.cyl(0.055, 0.055, 0.05, 10), toon(k.hub ?? WHITE), { r: [Math.PI / 2, 0, 0] });
  kit.add(swSpin, G.box(0.27, 0.035, 0.03), swMat, { outline: false });
  rig.steeringWheel = swSpin;

  // exhausts
  const chrome = toon(0xd8d2ea);
  const pipes = k.pipes ?? [[-0.32, 0.5, -1.06], [0.32, 0.5, -1.06]];
  for (const p of pipes) {
    kit.add(C, G.cyl(0.075, 0.095, 0.3, 10), chrome, { p, r: [Math.PI / 2, 0, 0] });
    kit.add(C, G.cyl(0.05, 0.05, 0.02, 8), toon(0x3a2f4a), { p: [p[0], p[1], p[2] - 0.155], r: [Math.PI / 2, 0, 0], outline: false });
  }
  rig.exhausts = pipes.map((p) => new THREE.Vector3(p[0], p[1], p[2] - 0.2));

  // wheels
  const fr = k.fr ?? 0.28;
  const rr = k.rr ?? 0.33;
  rig.wheelR = [fr, rr];
  const wx = W / 2 + 0.1;
  for (const sd of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sd * wx, fr, 0.7);
    C.add(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    addWheel(kit, spin, [0, 0, 0], fr, sd, k);
    rig.frontPivots.push(pivot);
    rig.frontSpins.push(spin);
  }
  const axle = new THREE.Group();
  axle.position.set(0, rr, -0.66);
  C.add(axle);
  for (const sd of [-1, 1]) addWheel(kit, axle, [sd * (wx + 0.02), 0, 0], rr, sd, k);
  rig.rearAxle = axle;
}

function addWheel(kit, target, p, r, side, k) {
  const style = k.wheels ?? 'classic';
  const wWidth = 0.27;
  if (style === 'donut') {
    const dough = toon(0xe7a867);
    const icing = toon(k.icing ?? 0xff9ecf);
    kit.add(target, G.tor(r * 0.66, r * 0.34, 8, 16), dough, { p, r: [0, Math.PI / 2, 0] });
    kit.add(target, G.tor(r * 0.66, r * 0.3, 8, 16), icing, { p: [p[0] + side * 0.05, p[1], p[2]], r: [0, Math.PI / 2, 0], s: [1, 1, 0.9], outline: false });
    const cols = [0xffe45c, 0x5ec8ff, 0x7ee07a, 0xffffff, 0xb68cff, 0xff6b9a];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      kit.add(target, G.cap(0.02, 0.05, 4), toon(cols[i]), {
        p: [p[0] + side * 0.15, p[1] + Math.cos(a) * r * 0.66, p[2] + Math.sin(a) * r * 0.66],
        r: [a, 0, 0.6],
        outline: false,
      });
    }
    return;
  }
  const tire = toon(k.tire ?? 0x3d3150);
  kit.add(target, G.cyl(r, r, wWidth, 16), tire, { p, r: [0, 0, Math.PI / 2] });
  kit.add(target, G.cyl(r * 0.8, r * 0.8, wWidth + 0.02, 14), tire, { p, r: [0, 0, Math.PI / 2], outline: false });
  const hub = toon(k.hub ?? 0xffd23f);
  kit.add(target, G.cyl(r * 0.56, r * 0.56, wWidth + 0.04, 12), hub, { p, r: [0, 0, Math.PI / 2], outline: false });
  const bar = toon(k.bar ?? WHITE);
  if (k.hubStar) {
    for (const sd of [-1, 1]) {
      kit.add(target, G.star(r * 0.48, 0.03), glow(k.hubStar), { p: [p[0] + sd * (wWidth / 2 + 0.035), p[1], p[2]], r: [0, Math.PI / 2, 0], outline: false });
    }
  } else {
    kit.add(target, G.box(wWidth + 0.06, r * 0.95, 0.07), bar, { p, outline: false });
    kit.add(target, G.box(wWidth + 0.06, 0.07, r * 0.95), bar, { p, outline: false });
    kit.add(target, G.cyl(r * 0.18, r * 0.18, wWidth + 0.08, 8), hub, { p, r: [0, 0, Math.PI / 2], outline: false });
  }
}

// ─────────────────────────────────────────────────────── driver helpers ──

/** Arms from shoulders to the steering wheel, with round hands. */
function addArms(kit, rig, sleeve, hand, o = {}) {
  const sh = o.shoulder ?? [0.31, 1.06, 0.02];
  const hd = o.hand ?? [0.14, 0.93, 0.6];
  const r = o.r ?? 0.085;
  for (const sd of [-1, 1]) {
    limb(kit, rig.driver, [sd * sh[0], sh[1], sh[2]], [sd * hd[0], hd[1], hd[2]], r, toon(sleeve));
    kit.add(rig.driver, G.sph(o.handR ?? 0.1, 10, 8), toon(hand), { p: [sd * hd[0], hd[1], hd[2]] });
  }
}

function makeHead(rig, y) {
  const head = new THREE.Group();
  head.position.set(0, y, 0);
  rig.driver.add(head);
  rig.head = head;
  return head;
}

/** A sub-group that a character animates itself (added to rig.anims callbacks). */
function part(parent, p = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(p[0], p[1], p[2]);
  parent.add(g);
  return g;
}

// ──────────────────────────────────────────────────────────── characters ──

const SKIN = 0xffd9bd;

function buildRocco(kit, rig, def) {
  const c = def.colors;
  // Italian-flag kart: tomato red body, cream trim, basil-green seat.
  buildKartBase(kit, rig, { body: c.kart, trim: c.secondary, seat: c.accent, hub: c.accent, bar: c.secondary });
  const C = rig.chassis;
  // hood ornament: a happy wedge of cheese
  const cheese = toon(0xffd35c);
  kit.add(C, G.cyl(0.15, 0.15, 0.12, 3), cheese, { p: [0, 0.82, 0.74], r: [Math.PI / 2, 0, 0] });
  for (const [x, y] of [[-0.03, 0.84], [0.04, 0.79]]) kit.add(C, G.sph(0.025, 6, 5), toon(0xf0b53a), { p: [x, y, 0.8], outline: false });
  // tomato stickers on side pods
  for (const sd of [-1, 1]) {
    kit.add(C, G.sph(0.09, 10, 8), toon(0xff4a3d), { p: [sd * 0.72, 0.47, 0.05], s: [0.4, 1, 1] });
    kit.add(C, G.star(0.05, 0.02), toon(0x4caf50), { p: [sd * 0.755, 0.55, 0.05], r: [0, sd * Math.PI / 2, 0], outline: false });
  }
  // rolling-pin spoiler
  const wood = toon(0xe8b979);
  kit.add(C, G.cyl(0.1, 0.1, 1.0, 12), wood, { p: [0, 1.2, -1.0], r: [0, 0, Math.PI / 2] });
  for (const sd of [-1, 1]) {
    kit.add(C, G.cyl(0.04, 0.04, 0.24, 8), toon(0xb8834a), { p: [sd * 0.62, 1.2, -1.0], r: [0, 0, Math.PI / 2] });
    stick(kit, C, [sd * 0.3, 0.55, -0.95], [sd * 0.3, 1.12, -1.0], 0.03, toon(c.primary));
  }

  const D = rig.driver;
  // cream double-breasted chef jacket
  const cream = toon(c.secondary);
  kit.add(D, G.sph(0.36), cream, { p: [0, 0.94, 0], s: [1.02, 0.92, 0.9] });
  kit.add(D, G.sph(0.37, 14, 8), cream, { p: [0, 0.78, 0.02], s: [1.04, 0.62, 0.94] });
  kit.add(D, G.tor(0.16, 0.05, 6, 14), cream, { p: [0, 1.2, 0.02], r: [Math.PI / 2, 0, 0] });
  // red neckerchief
  kit.add(D, G.cone(0.11, 0.17, 4), toon(c.primary), { p: [0, 1.12, 0.24], r: [Math.PI + 0.35, 0, 0], s: [1, 1, 0.35] });
  // two rows of little red buttons
  const btn = toon(c.primary);
  for (const sd of [-1, 1]) for (const y of [1.06, 0.98]) kit.add(D, G.sph(0.03, 8, 6), btn, { p: [sd * 0.1, y, 0.29], outline: false });
  // red-and-white checkered apron hugging the tummy
  const redM = toon(0xe8413c);
  const whiteM = toon(WHITE);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = (col - 1.5) * 0.115;
      const y = 0.9 - row * 0.105;
      const z = 0.35 - x * x * 1.6 - row * 0.012;
      kit.add(D, G.box(0.118, 0.108, 0.03), (row + col) % 2 ? redM : whiteM, {
        p: [x, y, z], r: [0.12, Math.atan2(x * 3.2, 1), 0], outline: false,
      });
    }
  }
  kit.add(D, G.box(0.5, 0.035, 0.03), whiteM, { p: [0, 0.955, 0.335], r: [0.12, 0, 0], outline: false }); // apron hem
  // arms: right hand on the wheel, left hand waves a fork with a meatball
  const skin = toon(SKIN);
  limb(kit, D, [0.31, 1.06, 0.02], [0.14, 0.93, 0.6], 0.085, cream);
  kit.add(D, G.sph(0.1, 10, 8), skin, { p: [0.14, 0.93, 0.6] });
  const forkArm = part(D, [-0.31, 1.06, 0.02]);
  limb(kit, forkArm, [0, 0, 0], [-0.36, 0.34, 0.1], 0.08, cream);
  kit.add(forkArm, G.sph(0.1, 10, 8), skin, { p: [-0.36, 0.34, 0.1] });
  const fork = toon(0xdcd6ec);
  stick(kit, forkArm, [-0.35, 0.24, 0.1], [-0.42, 0.86, 0.12], 0.022, fork);
  kit.add(forkArm, G.box(0.13, 0.03, 0.03), fork, { p: [-0.42, 0.86, 0.12], outline: false });
  for (const dx of [-0.05, 0, 0.05]) stick(kit, forkArm, [-0.42 + dx, 0.86, 0.12], [-0.42 + dx, 1.02, 0.12], 0.013, fork, { outline: false });
  kit.add(forkArm, G.sph(0.1, 12, 8), toon(0x9a5a34), { p: [-0.42, 0.7, 0.12] });
  kit.add(forkArm, G.sph(0.032, 6, 5), toon(0xe8413c), { p: [-0.39, 0.78, 0.2], outline: false }); // sauce dab
  rig.anims.push((t, dt, st) => {
    forkArm.rotation.z = -0.08 + Math.sin(t * 5) * (0.1 + 0.08 * st.speedF);
    forkArm.rotation.x = Math.sin(t * 2.5) * 0.06;
  });

  const R = 0.45;
  const H = makeHead(rig, 1.55);
  kit.add(H, G.sph(R, 18, 12), skin);
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.1, 8, 6), skin, { p: [sd * 0.44, -0.02, -0.02], s: [0.6, 1, 1] });
  const hair = toon(0x6b3f25);
  kit.add(H, G.sph(0.42), hair, { p: [0, 0.0, -0.1], outline: false });
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.14, 8, 6), hair, { p: [sd * 0.38, 0.1, -0.16], s: [0.8, 1, 1] });
  addFace(kit, rig, R, {
    eyeColor: 0x7a4a2a,
    eyeV: 0.06,
    mouth: 'grin',
    mouthV: -0.6,
    mouthW: 0.11,
    cheekV: -0.3,
    cheekU: 0.62,
    brows: { color: 0x4a2a1a, v: 0.42, w: 0.05, angle: -0.12 },
  });
  // little button nose
  kit.add(H, G.sph(0.085, 10, 8), toon(0xffb3a0), { p: [0, -0.08, 0.46] });
  // curly spaghetti mustache (wiggles when he laughs)
  const stache = part(H, [0, -0.19, 0.42]);
  const pasta = toon(0xf5c24c);
  for (const sd of [-1, 1]) {
    const pts = [[0, 0, 0.02], [0.1, -0.03, 0.0], [0.2, -0.02, -0.04], [0.27, 0.04, -0.08], [0.26, 0.12, -0.09], [0.19, 0.12, -0.07], [0.17, 0.06, -0.05], [0.22, 0.04, -0.06]]
      .map(([x, y, z]) => [x * sd, y, z]);
    kit.add(stache, G.tube(pts, 0.042, 24, 6), pasta);
  }
  kit.add(stache, G.sph(0.06, 8, 6), pasta, { p: [0, -0.01, 0.03] });
  rig.anims.push((t, dt, st) => {
    const w = Math.sin(t * 9) * (0.04 + 0.05 * st.speedF);
    stache.scale.set(1 + w, 1 - w * 0.5, 1);
    stache.rotation.z = Math.sin(t * 4.5) * 0.05;
  });
  // short, puffy white chef toque with a red band and a basil-leaf badge
  const HF = frame([0, 0.3, -0.04], [-0.2, 0, 0.05]);
  kit.add(H, G.cyl(0.37, 0.39, 0.14, 18), toon(c.primary), { f: HF, p: [0, 0.05, 0] });
  const toque = toon(WHITE);
  kit.add(H, G.cyl(0.33, 0.36, 0.22, 16), toque, { f: HF, p: [0, 0.22, 0] });
  kit.add(H, G.sph(0.47, 16, 10), toque, { f: HF, p: [0, 0.42, 0], s: [1, 0.52, 1] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    kit.add(H, G.sph(0.17, 10, 8), toque, { f: HF, p: [Math.cos(a) * 0.3, 0.45, Math.sin(a) * 0.3] });
  }
  kit.add(H, G.sph(0.2, 12, 8), toque, { f: HF, p: [0, 0.6, 0] });
  kit.add(H, G.sph(0.08, 8, 6), toon(0x4caf50), { f: HF, p: [-0.05, 0.06, 0.38], r: [0, 0, 0.7], s: [0.55, 1, 0.3] });
  kit.add(H, G.sph(0.08, 8, 6), toon(0x5cc85a), { f: HF, p: [0.06, 0.06, 0.38], r: [0, 0, -0.7], s: [0.55, 1, 0.3] });
}

function buildLenny(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: c.secondary, seat: 0x1f8f86, hub: c.accent });
  const C = rig.chassis;
  // wobbly noodle antenna with a meatball on top
  const ant = part(C, [-0.45, 0.62, -0.95]);
  kit.add(ant, G.tube([[0, 0, 0], [0.08, 0.35, 0], [-0.08, 0.7, 0], [0.08, 1.05, 0], [-0.04, 1.4, 0], [0.02, 1.62, 0]], 0.04, 24, 6), toon(c.accent));
  kit.add(ant, G.sph(0.1, 10, 8), toon(0x9a5a34), { p: [0.02, 1.7, 0] });
  // noodle swirl stickers
  for (const sd of [-1, 1]) kit.add(C, G.tor(0.08, 0.025, 5, 14), toon(c.accent), { p: [sd * 0.74, 0.46, 0.04], r: [0, Math.PI / 2, 0], outline: false });

  const D = rig.driver;
  const teal = toon(c.primary);
  const lime = toon(c.secondary);
  kit.add(D, G.cap(0.22, 0.34, 10), teal, { p: [0, 1.0, 0], s: [1, 1, 0.85] });
  kit.add(D, G.sph(0.27, 12, 8), lime, { p: [0, 0.78, 0.02], s: [1, 0.7, 0.92] });
  // mint-and-cream striped apron
  const mint = toon(0x9ff0d8);
  const cream = toon(0xfff3dc);
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.066;
    kit.add(D, G.box(0.068, 0.34, 0.03), i % 2 ? cream : mint, {
      p: [x, 0.95, 0.2 - x * x * 2.2], r: [-0.06, Math.atan2(x * 4.4, 1), 0], outline: false,
    });
  }
  kit.add(D, G.box(0.36, 0.03, 0.035), cream, { p: [0, 1.12, 0.19], outline: false });
  addArms(kit, rig, c.primary, SKIN, { shoulder: [0.24, 1.2, 0.0], r: 0.065, handR: 0.095 });
  // noodly neck
  kit.add(D, G.cyl(0.08, 0.09, 0.42, 10), toon(SKIN), { p: [0, 1.46, 0] });
  // cosy noodle scarf with dangly ends
  const noodle = toon(c.accent);
  kit.add(D, G.tor(0.12, 0.055, 6, 16), noodle, { p: [0, 1.32, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(D, G.tor(0.11, 0.045, 6, 16), noodle, { p: [0, 1.4, 0], r: [Math.PI / 2 + 0.15, 0, 0], outline: false });
  const tails = part(D, [0.07, 1.3, 0.1]);
  kit.add(tails, G.tube([[0, 0, 0], [0.04, -0.08, 0.04], [0.0, -0.16, 0.07], [0.05, -0.25, 0.09]], 0.032, 12, 5), noodle);
  kit.add(tails, G.tube([[0.03, 0, 0], [0.1, -0.07, 0.03], [0.08, -0.15, 0.05], [0.13, -0.22, 0.06]], 0.028, 12, 5), noodle, { outline: false });
  rig.anims.push((t, dt, st) => { tails.rotation.x = -0.2 * st.speedF + Math.sin(t * 11) * 0.12 * (0.3 + st.speedF); });
  // wobbly knees poking up beside the steering wheel
  const knees = part(D, [0, 0, 0]);
  for (const sd of [-1, 1]) {
    const hip = [sd * 0.15, 0.68, 0.1];
    const knee = [sd * 0.3, 0.94, 0.46];
    const foot = [sd * 0.27, 0.62, 0.8];
    limb(kit, knees, hip, knee, 0.07, lime);
    limb(kit, knees, knee, foot, 0.065, lime);
    kit.add(knees, G.sph(0.095, 10, 8), lime, { p: knee });
  }
  rig.anims.push((t, dt, st) => {
    const j = 0.025 + 0.02 * (1 - st.speedF);
    knees.position.y = Math.abs(Math.sin(t * 17)) * j;
    knees.rotation.z = Math.sin(t * 23) * j * 0.8;
  });

  const R = 0.42;
  const H = makeHead(rig, 1.9);
  rig.headLag = 1.6; // noodly neck sways more
  kit.add(H, G.sph(R, 18, 12), toon(SKIN));
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.09, 8, 6), toon(SKIN), { p: [sd * 0.41, -0.02, -0.02], s: [0.6, 1, 1] });
  const hair = toon(0xc9793a);
  kit.add(H, G.sph(0.39), hair, { p: [0, 0.0, -0.1], outline: false });
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.12, 8, 6), hair, { p: [sd * 0.33, 0.12, 0.12], s: [0.7, 1, 0.8] });
  addFace(kit, rig, R, {
    eyeColor: 0x2e9c8f,
    eyeV: 0.04,
    eyeH: 0.3,
    mouth: 'tiny',
    mouthV: -0.45,
    mouthW: 0.1,
    brows: { color: 0x8a4a22, v: 0.43, angle: 0.4, w: 0.035 },
  });
  // small nose + freckles
  kit.add(H, G.sph(0.07, 10, 8), toon(0xffbf9c), { p: [0, -0.16, 0.42] });
  const freckle = toon(0xd48a5a);
  for (const sd of [-1, 1]) {
    for (const [u, v] of [[0.44, -0.2], [0.52, -0.14], [0.5, -0.26]]) {
      kit.add(H, G.sph(0.018, 5, 4), freckle, { f: surf(R, u * sd, v, 0.99), outline: false });
    }
  }
  // nervous sweat drop
  const drop = part(H, [0.4, 0.22, 0.12]);
  const water = glow(0x9fe0ff);
  kit.add(drop, G.sph(0.055, 8, 6), water, { outline: false });
  kit.add(drop, G.cone(0.05, 0.09, 8), water, { p: [0, 0.06, 0], outline: false });
  rig.anims.push((t) => {
    const k = (t * 0.8) % 1;
    drop.position.y = 0.22 - k * 0.12;
    drop.scale.setScalar(k < 0.85 ? 1 : (1 - k) / 0.15);
  });
  // puffy cream chef hat with a teal band and a curly spaghetti cowlick
  const HF = frame([0, 0.28, -0.03], [-0.15, 0, -0.06]);
  kit.add(H, G.cyl(0.33, 0.35, 0.14, 18), teal, { f: HF, p: [0, 0.05, 0] });
  const toque = toon(0xfffaf0);
  kit.add(H, G.cyl(0.29, 0.32, 0.3, 16), toque, { f: HF, p: [0, 0.26, 0] });
  kit.add(H, G.sph(0.41, 16, 10), toque, { f: HF, p: [0, 0.5, 0], s: [1, 0.55, 1] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    kit.add(H, G.sph(0.16, 10, 8), toque, { f: HF, p: [Math.cos(a) * 0.26, 0.53, Math.sin(a) * 0.26] });
  }
  kit.add(H, G.sph(0.18, 12, 8), toque, { f: HF, p: [0, 0.66, 0] });
  const curl = part(H, [0, 0, 0]);
  kit.add(curl, G.tube([[0, 0.78, 0], [0.06, 0.9, 0.02], [0.0, 1.0, 0.06], [-0.07, 0.94, 0.04], [-0.03, 0.87, 0.02]], 0.03, 16, 5), noodle, { f: HF });
  rig.anims.push((t) => { curl.rotation.z = Math.sin(t * 7) * 0.04; });
}

function buildStella(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: 0xf4f2ff, seat: 0xb9a8ff, hub: 0x3a2f6a, hubStar: c.accent, bar: c.accent });
  const C = rig.chassis;
  const gold = toon(c.accent, { emissive: c.accent, emissiveIntensity: 0.4 });
  for (const sd of [-1, 1]) {
    kit.add(C, G.star(0.13, 0.05), glow(c.accent), { p: [sd * 0.77, 0.46, 0.02], r: [0, Math.PI / 2, 0], outline: false });
    // little rocket fins
    kit.add(C, G.rbox(0.06, 0.4, 0.34, 0.03), toon(0xf4f2ff), { p: [sd * 0.4, 0.72, -0.98], r: [0.5, 0, sd * 0.35] });
  }
  kit.add(C, G.star(0.16, 0.06), gold, { p: [0, 0.8, 0.8], r: [-0.3, 0, 0] });
  // crescent moon spoiler
  kit.add(C, G.tor(0.28, 0.075, 8, 18, Math.PI * 1.25), gold, { p: [0, 1.0, -1.04], r: [0, 0, -Math.PI * 0.125] });
  stick(kit, C, [0, 0.55, -0.97], [0, 0.72, -1.04], 0.035, toon(0xf4f2ff));

  const D = rig.driver;
  const gown = toon(c.primary);
  kit.add(D, G.sph(0.31), gown, { p: [0, 0.96, 0], s: [1, 1, 0.85] });
  kit.add(D, G.cyl(0.28, 0.48, 0.34, 16), gown, { p: [0, 0.74, 0.02] });
  kit.add(D, G.tor(0.2, 0.04, 6, 16), toon(0xf4f2ff), { p: [0, 1.2, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(D, G.star(0.08, 0.03), glow(c.accent), { p: [0, 1.0, 0.27], outline: false });
  addArms(kit, rig, c.primary, 0xffe9e0, { r: 0.075, handR: 0.09 });

  const R = 0.44;
  const H = makeHead(rig, 1.58);
  const skin = toon(0xffe9e0);
  kit.add(H, G.sph(R, 18, 12), skin);
  const hair = toon(0xe8e2ff);
  kit.add(H, G.sph(0.49), hair, { p: [0, 0.03, -0.1], s: [1.04, 1.06, 0.95] });
  kit.add(H, G.cap(0.3, 0.45, 10), hair, { p: [0, -0.45, -0.24], s: [1.25, 1, 0.6] });
  for (const sd of [-1, 1]) {
    kit.add(H, G.sph(0.24, 12, 8), hair, { p: [sd * 0.2, 0.3, 0.26], s: [1.0, 0.55, 0.55], r: [0, 0, sd * 0.35] });
    kit.add(H, G.cap(0.12, 0.35, 8), hair, { p: [sd * 0.4, -0.25, 0.08], r: [0, 0, sd * 0.12] });
  }
  addFace(kit, rig, R, { eyeColor: 0x1f9eab, eyeV: -0.02, lashes: true, mouth: 'smile', mouthW: 0.11 });
  // tiara with a star
  kit.add(H, G.tor(0.3, 0.03, 5, 18, Math.PI), toon(0xdcd6ec), { p: [0, 0.3, 0.06], r: [-0.5, 0, 0] });
  kit.add(H, G.star(0.1, 0.04), glow(c.accent), { p: [0, 0.6, 0.12], r: [-0.3, 0, 0], outline: false });
  for (const sd of [-1, 1]) kit.add(H, G.star(0.05, 0.02), glow(c.accent), { p: [sd * 0.44, -0.16, 0.03], outline: false });

  // glowing star wand, held up in her left hand
  const wand = part(D, [0.14, 0.93, 0.6]);
  stick(kit, wand, [0, 0, 0], [0.34, 0.52, -0.06], 0.022, toon(0xf4f2ff));
  const wandStar = part(wand, [0.38, 0.6, -0.07]);
  kit.add(wandStar, G.star(0.13, 0.05), glow(c.accent), { outline: false });
  kit.add(wandStar, G.star(0.17, 0.02), glow(0xfff6c9, { transparent: true, opacity: 0.45 }), { outline: false });

  // Twinkle, the tiny floating star buddy
  const twinkle = part(D, [0.7, 1.9, 0]);
  kit.add(twinkle, G.star(0.15, 0.08), toon(c.accent, { emissive: 0xffc400, emissiveIntensity: 0.45 }));
  for (const sd of [-1, 1]) {
    kit.add(twinkle, G.sph(0.022, 6, 5), toon(EYE_DARK), { p: [sd * 0.04, 0.01, 0.06], s: [1, 1.4, 0.6], outline: false });
    kit.add(twinkle, G.sph(0.025, 6, 5), toon(0xff8fb0), { p: [sd * 0.075, -0.035, 0.055], s: [1, 0.6, 0.4], outline: false });
  }
  rig.anims.push((t, dt, st) => {
    const a = t * 1.3;
    twinkle.position.set(Math.cos(a) * 0.72, 1.95 + Math.sin(t * 2.6) * 0.1, Math.sin(a) * 0.5 - 0.05);
    twinkle.rotation.z = Math.sin(t * 3) * 0.3;
    wandStar.rotation.y = t * 2.5;
    wandStar.scale.setScalar(1 + Math.sin(t * 6) * 0.1);
    wand.rotation.z = Math.sin(t * 2) * 0.08;
  });
}

function buildPeachy(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: WHITE, seat: 0xffd6ea, hub: 0xffffff, bar: c.kart, tire: 0x7a3a66 });
  const C = rig.chassis;
  const heart = toon(0xff4f9a);
  kit.add(C, G.heart(0.3, 0.06), heart, { p: [0, 0.79, 0.62], r: [-0.95, 0, 0] });
  for (const sd of [-1, 1]) kit.add(C, G.heart(0.2, 0.04), heart, { p: [sd * 0.755, 0.46, 0.03], r: [0, sd * Math.PI / 2, 0] });
  // pie-crust trim around the front bumper
  for (let i = 0; i < 7; i++) {
    kit.add(C, G.sph(0.06, 8, 6), toon(0xe9b066), { p: [-0.48 + i * 0.16, 0.47, 1.05], outline: false });
  }
  // big bow on the back
  const bow = toon(0xff5fa8);
  for (const sd of [-1, 1]) kit.add(C, G.cone(0.2, 0.42, 10), bow, { p: [sd * 0.22, 1.18, -0.86], r: [0, 0, sd * Math.PI / 2], s: [1, 1, 0.45] });
  kit.add(C, G.sph(0.1, 10, 8), bow, { p: [0, 1.18, -0.86] });
  for (const sd of [-1, 1]) limb(kit, C, [sd * 0.05, 1.12, -0.86], [sd * 0.18, 0.86, -0.92], 0.045, bow);

  const D = rig.driver;
  const dress = toon(c.primary);
  kit.add(D, G.sph(0.3), dress, { p: [0, 0.96, 0], s: [1, 1, 0.85] });
  kit.add(D, G.cyl(0.28, 0.5, 0.34, 16), toon(0xffb3d9), { p: [0, 0.74, 0.02] });
  kit.add(D, G.tor(0.48, 0.05, 6, 22), toon(WHITE), { p: [0, 0.59, 0.02], r: [Math.PI / 2, 0, 0], outline: false });
  for (const sd of [-1, 1]) kit.add(D, G.sph(0.13, 10, 8), toon(0xffb3d9), { p: [sd * 0.29, 1.1, 0] });
  kit.add(D, G.heart(0.14, 0.04), glow(0x7fd0ff), { p: [0, 1.02, 0.26], outline: false });
  addArms(kit, rig, SKIN, WHITE, { shoulder: [0.3, 1.08, 0.02], r: 0.065, handR: 0.095 });

  const R = 0.45;
  const H = makeHead(rig, 1.57);
  kit.add(H, G.sph(R, 18, 12), toon(0xffe2cc));
  const gold = toon(c.secondary);
  kit.add(H, G.sph(0.49), gold, { p: [0, 0.03, -0.09] });
  for (const [x, y, z] of [[-0.22, 0.33, 0.27], [0, 0.38, 0.3], [0.22, 0.33, 0.27]]) {
    kit.add(H, G.sph(0.15, 10, 8), gold, { p: [x, y, z], s: [1.1, 0.75, 0.7] });
  }
  // bouncy curls
  const curls = part(H, [0, 0, 0]);
  for (const sd of [-1, 1]) {
    kit.add(curls, G.sph(0.13, 10, 8), gold, { p: [sd * 0.44, -0.06, -0.04] });
    kit.add(curls, G.sph(0.12, 10, 8), gold, { p: [sd * 0.47, -0.26, -0.08] });
    kit.add(curls, G.sph(0.105, 10, 8), gold, { p: [sd * 0.43, -0.45, -0.1] });
    kit.add(curls, G.sph(0.12, 10, 8), gold, { p: [sd * 0.25, -0.38, -0.34] });
  }
  kit.add(curls, G.sph(0.14, 10, 8), gold, { p: [0, -0.42, -0.4] });
  rig.anims.push((t, dt, st) => {
    const b = Math.sin(t * 7) * (0.02 + 0.03 * st.speedF);
    curls.position.y = b;
    curls.scale.set(1, 1 + b, 1);
  });
  addFace(kit, rig, R, { eyeColor: 0x4a7de0, lashes: true, mouth: 'grin', mouthV: -0.38, mouthW: 0.1, cheek: 0xff7aa8 });
  // crown made of a tiny peach pie
  const CF = frame([0, 0.4, 0.0], [-0.15, 0, 0.08]).multiply(new THREE.Matrix4().makeScale(1.4, 1.4, 1.4));
  const crust = toon(0xe0a25a);
  kit.add(H, G.cyl(0.22, 0.17, 0.13, 16), crust, { f: CF, p: [0, 0.06, 0] });
  kit.add(H, G.cyl(0.195, 0.195, 0.03, 16), toon(0xffa860), { f: CF, p: [0, 0.13, 0], outline: false });
  const lattice = toon(0xf6cd8a);
  for (const o of [-0.08, 0.08]) {
    kit.add(H, G.box(0.36, 0.025, 0.04), lattice, { f: CF, p: [0, 0.15, o], outline: false });
    kit.add(H, G.box(0.04, 0.03, 0.36), lattice, { f: CF, p: [o, 0.155, 0], outline: false });
  }
  kit.add(H, G.tor(0.2, 0.04, 6, 16), toon(0xf0b56a), { f: CF, p: [0, 0.13, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(H, G.sph(0.075, 10, 8), toon(0xffa860), { f: CF, p: [0, 0.23, 0] });
  kit.add(H, G.sph(0.05, 6, 5), toon(0x5fc44f), { f: CF, p: [0.05, 0.3, 0], s: [1.3, 0.5, 0.8], r: [0, 0, 0.5] });
}

function buildGumbo(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, {
    body: c.kart,
    trim: c.secondary,
    seat: 0x2f9a4a,
    hub: c.primary,
    width: 1.42,
    rr: 0.37,
    pipes: [[-0.36, 0.56, -1.08], [0.36, 0.56, -1.08]],
  });
  const C = rig.chassis;
  const candyCorn = (target, F, s = 1) => {
    kit.add(target, G.cyl(0.07 * s, 0.095 * s, 0.1 * s, 10), toon(0xffd23a), { f: F, p: [0, 0.05 * s, 0] });
    kit.add(target, G.cyl(0.042 * s, 0.07 * s, 0.1 * s, 10), toon(0xff8c1a), { f: F, p: [0, 0.15 * s, 0] });
    kit.add(target, G.cone(0.042 * s, 0.09 * s, 10), toon(0xfff8e8), { f: F, p: [0, 0.245 * s, 0] });
  };
  for (const x of [-0.4, 0, 0.4]) candyCorn(C, frame([x, 0.36, 1.12], [Math.PI / 2, 0, 0]), 1.0);
  for (const sd of [-1, 1]) candyCorn(C, frame([sd * 0.8, 0.5, 0.02], [0, 0, -sd * Math.PI / 2]), 0.8);
  // gummy shine stripes on the hood
  kit.add(C, G.sph(0.1, 8, 6), glow(0xffe0c8), { p: [-0.25, 0.75, 0.5], s: [1.2, 0.3, 1.8], r: [-0.2, 0, 0], outline: false });

  const gummy = toon(c.primary, { emissive: 0xff5a00, emissiveIntensity: 0.18 });
  const light = toon(0xffc27a, { emissive: 0xff8a00, emissiveIntensity: 0.12 });
  const shine = glow(0xfff1e0);
  const D = rig.driver;
  rig.driver.scale.setScalar(1.1);
  rig.driver.position.z -= 0.04;
  kit.add(D, G.sph(0.4), gummy, { p: [0, 0.94, 0], s: [1.05, 0.98, 0.95] });
  kit.add(D, G.sph(0.28, 12, 8), light, { p: [0, 0.9, 0.22], s: [1, 1.05, 0.55], outline: false });
  kit.add(D, G.sph(0.06, 6, 5), shine, { p: [-0.13, 1.05, 0.36], s: [1, 1.6, 0.4], outline: false });
  // green gummy shell with sugar bumps
  const shell = toon(c.secondary, { emissive: 0x1f8a30, emissiveIntensity: 0.18 });
  kit.add(D, G.sph(0.4), shell, { p: [0, 1.0, -0.3], s: [1.0, 1.0, 0.6] });
  kit.add(D, G.tor(0.36, 0.05, 6, 18), toon(0xfff8e8), { p: [0, 1.0, -0.24], outline: false });
  for (const [x, y] of [[0, 1.2], [-0.2, 0.95], [0.2, 0.95], [0, 0.78], [-0.18, 1.15], [0.18, 1.15]]) {
    kit.add(D, G.cone(0.055, 0.12, 8), toon(0xfff8e8), { p: [x, y, -0.53], r: [-Math.PI / 2, 0, 0] });
  }
  addArms(kit, rig, c.primary, c.primary, { shoulder: [0.36, 1.05, 0.02], r: 0.11, handR: 0.13 });

  const R = 0.47;
  const H = makeHead(rig, 1.58);
  kit.add(H, G.sph(R, 18, 12), gummy);
  for (const sd of [-1, 1]) {
    kit.add(H, G.sph(0.15, 10, 8), gummy, { p: [sd * 0.33, 0.33, -0.06], s: [1, 1, 0.6] });
    kit.add(H, G.sph(0.08, 8, 6), light, { p: [sd * 0.33, 0.33, 0.01], s: [1, 1, 0.4], outline: false });
    candyCorn(H, frame([sd * 0.17, 0.4, 0.06], [0.1, 0, -sd * 0.45]), 1.1);
  }
  // muzzle
  kit.add(H, G.sph(0.21), light, { p: [0, -0.15, 0.34], s: [1.25, 0.85, 0.8] });
  kit.add(H, G.sph(0.075, 10, 8), toon(0x5a2a1a), { p: [0, -0.06, 0.5], s: [1.35, 0.9, 0.9] });
  kit.add(H, G.sph(0.02, 5, 4), shine, { p: [-0.03, -0.035, 0.56], outline: false });
  addFace(kit, rig, R, {
    eyeColor: 0x9a4a12,
    eyeU: 0.32,
    eyeV: 0.12,
    eyeW: 0.17,
    eyeH: 0.22,
    cheekU: 0.6,
    cheekV: -0.12,
    mouth: 'none',
    brows: { color: 0x5a2a1a, v: 0.4, u: 0.3, angle: -0.35, w: 0.05 },
  });
  // grumpy-but-cute grin with two little fangs
  addMouth(kit, H, frame([0, -0.24, 0.49], [0.3, 0, 0]), 0.1, 'smile');
  for (const sd of [-1, 1]) kit.add(H, G.cone(0.022, 0.055, 6), toon(WHITE), { p: [sd * 0.06, -0.3, 0.48], r: [Math.PI, 0, 0], outline: false });
  kit.add(H, G.sph(0.07, 6, 5), shine, { f: surf(R, -0.35, 0.4, 1.0), s: [1.1, 0.55, 0.3], outline: false });
  rig.anims.push((t) => {
    // big grumpy huffs
    const h = Math.sin(t * 2.2);
    H.scale.set(1 + h * 0.015, 1 - h * 0.015, 1);
  });
}

function buildMuffin(kit, rig, def) {
  const c = def.colors;
  // pink steering wheel with a heart hub (reads as a cute heart, not a frowny face, at card size)
  buildKartBase(kit, rig, { body: c.kart, trim: WHITE, seat: c.secondary, wheels: 'donut', icing: c.secondary, steer: 0xff7ab8, steerHeart: 0xff4f9a });
  const C = rig.chassis;
  const r = rng(7);
  const cols = [0xffe45c, 0xff6b9a, 0x7ee07a, 0xffffff, 0xb68cff, 0xffa64d];
  for (let i = 0; i < 14; i++) {
    kit.add(C, G.cap(0.022, 0.06, 4), toon(cols[i % cols.length]), {
      p: [(r() - 0.5) * 0.8, 0.745 + r() * 0.02, 0.28 + r() * 0.45],
      r: [-0.2, r() * TAU, Math.PI / 2],
      outline: false,
    });
  }
  // birthday candle spoiler
  kit.add(C, G.cyl(0.08, 0.08, 0.5, 10), toon(WHITE), { p: [0, 1.15, -0.95] });
  for (const y of [1.0, 1.15, 1.3]) kit.add(C, G.cyl(0.085, 0.085, 0.04, 10), toon(c.secondary), { p: [0, y, -0.95], outline: false });
  const flame = part(C, [0, 1.5, -0.95]);
  kit.add(flame, G.sph(0.07, 8, 6), glow(0xffd23f), { s: [1, 1.6, 1], outline: false });
  kit.add(flame, G.sph(0.04, 6, 5), glow(0xfff6c9), { p: [0, -0.02, 0.02], s: [1, 1.4, 1], outline: false });
  stick(kit, C, [0, 0.55, -0.95], [0, 0.9, -0.95], 0.04, toon(WHITE));
  rig.anims.push((t) => {
    flame.scale.set(1 + Math.sin(t * 13) * 0.1, 1 + Math.sin(t * 17) * 0.15, 1);
  });

  const D = rig.driver;
  rig.driver.scale.setScalar(0.92);
  rig.bounce = 2.2; // she's SO excited
  // cupcake wrapper body
  kit.add(D, G.cyl(0.37, 0.27, 0.44, 18), toon(c.primary), { p: [0, 0.82, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const p0 = [Math.cos(a) * 0.28, 0.61, Math.sin(a) * 0.28];
    const p1 = [Math.cos(a) * 0.375, 1.03, Math.sin(a) * 0.375];
    limb(kit, D, p0, p1, 0.022, toon(WHITE), { outline: false, rs: 4 });
  }
  kit.add(D, G.sph(0.37, 16, 8), toon(0xc8864a), { p: [0, 1.06, 0], s: [1.02, 0.35, 1.02] });
  addArms(kit, rig, SKIN, SKIN, { shoulder: [0.3, 1.02, 0.04], r: 0.065, handR: 0.09 });

  const R = 0.44;
  const H = makeHead(rig, 1.46);
  kit.add(H, G.sph(R, 18, 12), toon(0xffe4cc));
  addFace(kit, rig, R, { eyeColor: 0x7a4a2a, eyeH: 0.31, eyeW: 0.22, eyeV: -0.06, mouth: 'grin', mouthV: -0.42, mouthW: 0.12, cheekV: -0.3 });
  // swirly frosting hat with sprinkles
  const icing = toon(c.secondary);
  const FF = frame([0, 0.24, -0.02], [-0.1, 0, 0]);
  kit.add(H, G.tor(0.33, 0.14, 8, 20), icing, { f: FF, p: [0, 0.02, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(H, G.tor(0.21, 0.12, 8, 18), icing, { f: FF, p: [0, 0.18, 0], r: [Math.PI / 2, 0, 0.6] });
  kit.add(H, G.sph(0.16, 12, 8), icing, { f: FF, p: [0, 0.3, 0] });
  kit.add(H, G.cone(0.09, 0.18, 10), icing, { f: FF, p: [0, 0.44, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.3;
    const top = i % 2 === 0;
    const rad = top ? 0.33 : 0.21;
    const y = top ? 0.13 : 0.28;
    kit.add(H, G.cap(0.02, 0.055, 4), toon(cols[i % cols.length]), {
      f: FF,
      p: [Math.cos(a) * rad, y, Math.sin(a) * rad],
      r: [r() * 3, a, r() * 3],
      outline: false,
    });
  }
  // wobbly cherry on top
  const cherry = part(H, [0, 0.78, -0.02]);
  kit.add(cherry, G.sph(0.12, 12, 10), toon(c.accent, { emissive: 0xa0001a, emissiveIntensity: 0.25 }));
  kit.add(cherry, G.sph(0.035, 6, 5), glow(WHITE), { p: [-0.05, 0.05, 0.09], outline: false });
  kit.add(cherry, G.tube([[0, 0.09, 0], [0.02, 0.2, 0], [0.09, 0.28, 0]], 0.016, 8, 5), toon(0x5a8a2a));
  rig.anims.push((t, dt, st) => {
    cherry.rotation.z = Math.sin(t * 6.5) * (0.12 + 0.18 * st.speedF);
    cherry.rotation.x = Math.cos(t * 5.1) * 0.08;
  });
}

function buildDino(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: c.primary, seat: c.secondary, hub: WHITE, bar: c.primary, tire: 0x5b4a8a, shell: false });
  const C = rig.chassis;
  // cracked eggshell kart
  const shell = toon(c.kart);
  kit.add(C, G.bowl(1, 18, 7), shell, { p: [0, 0.62, 0], s: [0.7, 0.5, 1.1] });
  kit.add(C, G.cyl(1, 1, 0.04, 20), toon(0xf3e2c4), { p: [0, 0.6, 0], s: [0.68, 1, 1.07], outline: false });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    kit.add(C, G.cone(0.1, 0.12, 4), shell, { p: [Math.sin(a) * 0.68, 0.64, Math.cos(a) * 1.07], r: [0, a + Math.PI / 4, 0], s: [1, 1, 0.3], outline: false });
  }
  const spot = toon(c.accent);
  for (const [x, y, z, s] of [[0.66, 0.38, 0.4, 0.14], [-0.66, 0.4, -0.2, 0.16], [0.6, 0.33, -0.55, 0.11], [-0.6, 0.32, 0.55, 0.12], [0, 0.4, 1.02, 0.13]]) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(x, 0, z * 0.6).normalize());
    kit.add(C, G.sph(s, 10, 8), spot, { p: [x, y, z], q, s: [1, 1, 0.3], outline: false });
  }
  kit.add(C, G.cap(0.12, 0.9, 8), toon(c.primary), { p: [0, 0.32, 1.05], r: [0, 0, Math.PI / 2] });

  const D = rig.driver;
  const lav = toon(c.primary);
  const belly = toon(0xfff2c2);
  const mintSpot = toon(c.accent);
  kit.add(D, G.sph(0.34), lav, { p: [0, 0.93, 0], s: [1, 1, 0.9] });
  kit.add(D, G.sph(0.26, 12, 8), belly, { p: [0, 0.9, 0.2], s: [1, 1.05, 0.5], outline: false });
  for (const [x, y, z] of [[0.27, 1.02, -0.1], [-0.25, 0.86, -0.14], [0.2, 0.8, -0.22]]) {
    kit.add(D, G.sph(0.06, 8, 6), mintSpot, { p: [x, y, z], s: [1, 1, 0.5], outline: false });
  }
  // snack bib with a cookie on it
  kit.add(D, G.rbox(0.34, 0.22, 0.03, 0.05), toon(WHITE), { p: [0, 1.05, 0.29], r: [-0.3, 0, 0] });
  kit.add(D, G.cyl(0.065, 0.065, 0.02, 12), toon(0xd9a066), { p: [0, 1.04, 0.31], r: [Math.PI / 2 - 0.3, 0, 0], outline: false });
  for (const [x, y] of [[-0.02, 1.06], [0.025, 1.03], [0.0, 1.01]]) {
    kit.add(D, G.sph(0.012, 5, 4), toon(0x5a3420), { p: [x, y, 0.325], outline: false });
  }
  // sprinkle-donut inner-tube saddle on his back
  const tilt = -Math.PI / 2 - 0.55;
  kit.add(D, G.tor(0.17, 0.085, 8, 18), toon(0xe7a867), { p: [0, 1.1, -0.26], r: [tilt, 0, 0] });
  kit.add(D, G.tor(0.17, 0.07, 8, 18), toon(c.secondary), { p: [0, 1.13, -0.24], r: [tilt, 0, 0], outline: false });
  const sprCols = [0xffe45c, 0x5ec8ff, 0x7ee07a, 0xffffff, 0xb68cff, 0xff6b9a];
  const sprinkleFrame = frame([0, 1.13, -0.24], [tilt, 0, 0]);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    kit.add(D, G.cap(0.015, 0.04, 4), toon(sprCols[i % sprCols.length]), {
      f: sprinkleFrame, p: [Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.07], r: [0, 0, a + 0.8], outline: false,
    });
  }
  // curly tail over the side
  limb(kit, D, [0.2, 0.8, -0.25], [0.55, 0.78, -0.55], 0.12, lav);
  limb(kit, D, [0.55, 0.78, -0.55], [0.68, 0.98, -0.72], 0.08, lav);
  kit.add(D, G.sph(0.05, 8, 6), mintSpot, { p: [0.5, 0.86, -0.5], outline: false });
  addArms(kit, rig, c.primary, c.primary, { r: 0.075, handR: 0.095 });

  const R = 0.42;
  const H = makeHead(rig, 1.56);
  kit.add(H, G.sph(R, 18, 12), lav);
  // small round snout
  kit.add(H, G.sph(0.22), lav, { p: [0, -0.16, 0.28], s: [1.1, 0.8, 0.95] });
  for (const sd of [-1, 1]) {
    kit.add(H, G.sph(0.026, 6, 5), toon(0x4a2d6a), { p: [sd * 0.07, -0.08, 0.49], outline: false });
  }
  // pastel mint spots on the head
  for (const [u, v, s] of [[0.55, 0.45, 0.07], [-0.4, 0.62, 0.06], [0.15, 0.8, 0.05], [-0.7, 0.2, 0.05]]) {
    kit.add(H, G.sph(s, 8, 6), mintSpot, { f: surf(R, u, v, 0.98), s: [1, 1, 0.35], outline: false });
  }
  // soft mint back plates
  const plate = toon(c.accent);
  for (const [y, z, rx, s] of [[0.42, -0.02, -0.2, 1], [0.34, -0.26, -0.8, 0.9], [0.12, -0.42, -1.4, 0.8]]) {
    kit.add(H, G.cone(0.1 * s, 0.2 * s, 4), plate, { p: [0, y, z], r: [rx, 0, 0], s: [0.45, 1, 1] });
  }
  addFace(kit, rig, R, { eyeColor: 0x5b3a8a, eyeU: 0.3, eyeV: 0.16, eyeH: 0.3, eyeW: 0.21, mouth: 'none', cheekU: 0.62, cheekV: -0.12, cheek: 0xffa6c9 });
  addMouth(kit, H, frame([0, -0.27, 0.47], [0.35, 0, 0]), 0.12, 'smile');
  // hungry tongue that pops out now and then
  const tongue = part(H, [0.07, -0.31, 0.45]);
  kit.add(tongue, G.cap(0.045, 0.08, 6), toon(0xff7a9c), { p: [0, -0.02, 0.04], r: [1.2, 0, 0] });
  rig.anims.push((t) => {
    const k = (t % 3.2) / 3.2;
    const out = k > 0.8 ? Math.sin(((k - 0.8) / 0.2) * Math.PI) : 0;
    tongue.scale.setScalar(0.001 + out);
  });
}

function buildBizzy(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: c.secondary, seat: 0xff9ecf, hub: c.kart, bar: c.secondary });
  const C = rig.chassis;
  const black = toon(c.secondary);
  kit.add(C, G.box(1.33, 0.08, 0.14), black, { p: [0, 0.56, 0.15], outline: false });
  kit.add(C, G.box(1.33, 0.08, 0.14), black, { p: [0, 0.56, -0.2], outline: false });
  kit.add(C, G.rbox(0.8, 0.07, 0.14, 0.03), black, { p: [0, 0.72, 0.62], r: [-0.2, 0, 0], outline: false });
  const honey = toon(0xffa51f);
  kit.add(C, G.cyl(0.14, 0.14, 0.05, 6), honey, { p: [0, 0.77, 0.36], r: [-0.2, 0, 0] });
  for (const sd of [-1, 1]) {
    kit.add(C, G.cyl(0.09, 0.09, 0.05, 6), honey, { p: [sd * 0.76, 0.46, 0.05], r: [0, 0, Math.PI / 2] });
  }
  // stinger tail-light
  kit.add(C, G.cone(0.12, 0.34, 10), black, { p: [0, 0.48, -1.2], r: [-Math.PI / 2, 0, 0] });

  const D = rig.driver;
  rig.driver.scale.setScalar(0.96);
  const yellow = toon(c.primary);
  kit.add(D, G.sph(0.35), yellow, { p: [0, 0.93, 0] });
  for (const [y, rad] of [[0.84, 0.335], [1.04, 0.31]]) kit.add(D, G.tor(rad, 0.05, 6, 20), black, { p: [0, y, 0], r: [Math.PI / 2, 0, 0], outline: false });
  addArms(kit, rig, c.secondary, c.secondary, { r: 0.06, handR: 0.085 });
  // buzzy wings
  const wingMat = toon(0xeaf8ff, { transparent: true, opacity: 0.72, emissive: 0xbfe9ff, emissiveIntensity: 0.5 });
  const wings = [];
  for (const sd of [-1, 1]) {
    const w = part(D, [sd * 0.12, 1.2, -0.3]);
    w.rotation.y = sd * 0.35;
    kit.add(w, G.sph(0.36, 12, 8), wingMat, { p: [sd * 0.26, 0.3, -0.04], s: [0.85, 0.5, 0.06], r: [0, 0, sd * -0.75], outline: false });
    kit.add(w, G.sph(0.24, 10, 6), wingMat, { p: [sd * 0.28, 0.0, -0.04], s: [0.85, 0.5, 0.06], r: [0, 0, sd * -0.2], outline: false });
    wings.push([w, sd]);
  }

  const R = 0.43;
  const H = makeHead(rig, 1.55);
  kit.add(H, G.sph(R, 18, 12), yellow);
  for (const [x, z] of [[-0.08, 0.1], [0.06, 0.12], [0, -0.02]]) kit.add(H, G.sph(0.1, 8, 6), black, { p: [x, 0.4, z] });
  // goggles on her forehead
  const band = toon(0x8b5a2b);
  kit.add(H, G.tor(0.43, 0.035, 5, 22), band, { p: [0, 0.2, 0], r: [Math.PI / 2 - 0.35, 0, 0], outline: false });
  for (const sd of [-1, 1]) {
    const F = surf(R, sd * 0.22, 0.5, 1.02);
    kit.add(H, G.tor(0.1, 0.035, 6, 14), toon(0xd9a441), { f: F });
    kit.add(H, G.sph(0.09, 10, 6), glow(0xbfe9ff), { f: F, s: [1, 1, 0.3], outline: false });
  }
  addFace(kit, rig, R, { eyeColor: 0x7a4a1a, eyeV: -0.05, mouth: 'grin', mouthV: -0.42, mouthW: 0.11, lashes: true });
  // wobbly antennae
  const antennae = [];
  for (const sd of [-1, 1]) {
    const a = part(H, [sd * 0.12, 0.36, 0.05]);
    stick(kit, a, [0, 0, 0], [sd * 0.16, 0.36, 0.06], 0.02, black);
    kit.add(a, G.sph(0.07, 10, 8), toon(c.accent), { p: [sd * 0.17, 0.4, 0.07] });
    antennae.push([a, sd]);
  }
  rig.anims.push((t, dt, st) => {
    const buzz = Math.sin(t * 55);
    for (const [w, sd] of wings) w.rotation.z = sd * buzz * 0.35;
    for (const [a, sd] of antennae) a.rotation.z = Math.sin(t * 5 + sd) * 0.12 - st.steer * 0.15;
  });
}

function buildCottonCandyGirl(kit, rig, def) {
  const c = def.colors;
  const pink = c.primary;
  const blue = c.secondary;
  buildKartBase(kit, rig, { body: WHITE, trim: pink, seat: 0xffc8ea, hub: WHITE, hubStar: 0xffe45c, tire: 0xd98ac0, shell: false });
  const C = rig.chassis;
  // fluffy cloud kart
  const puffCols = [toon(WHITE), toon(0xffd3ee), toon(0xcdeeff)];
  kit.add(C, G.rbox(1.15, 0.3, 1.8, 0.14), puffCols[0], { p: [0, 0.4, 0] });
  const puffs = [
    [0, 0.55, 0.85, 0.34, 0], [-0.4, 0.5, 0.75, 0.28, 1], [0.4, 0.5, 0.75, 0.28, 2],
    [-0.6, 0.48, 0.25, 0.28, 2], [0.6, 0.48, 0.25, 0.28, 1], [-0.62, 0.5, -0.25, 0.28, 0], [0.62, 0.5, -0.25, 0.28, 0],
    [-0.45, 0.52, -0.85, 0.3, 1], [0.45, 0.52, -0.85, 0.3, 2], [0, 0.5, -0.95, 0.3, 0], [0, 0.72, 0.5, 0.26, 0],
  ];
  for (const [x, y, z, r, ci] of puffs) kit.add(C, G.ico(r, 1), puffCols[ci], { p: [x, y, z] });
  // pastel rainbow spoiler
  const rb = [0xff8fb8, 0xffc36b, 0xfff07a, 0x8ee8a0, 0x8fd0ff];
  rb.forEach((col, i) => kit.add(C, G.tor(0.62 - i * 0.07, 0.036, 5, 18, Math.PI), toon(col), { p: [0, 0.78, -1.02], outline: i === 0 || i === rb.length - 1 }));
  for (const sd of [-1, 1]) kit.add(C, G.ico(0.16, 1), puffCols[0], { p: [sd * 0.52, 0.78, -1.02] });

  const D = rig.driver;
  kit.add(D, G.sph(0.3), toon(c.accent), { p: [0, 0.96, 0], s: [1, 1, 0.85] });
  kit.add(D, G.cyl(0.28, 0.5, 0.3, 16), toon(pink), { p: [0, 0.74, 0.02] });
  kit.add(D, G.star(0.1, 0.04), glow(0xffe45c), { p: [0, 1.02, 0.26], outline: false });
  // sparkly cape
  const cape = new THREE.ConeGeometry(0.55, 0.85, 14, 1, true, Math.PI / 2, Math.PI);
  kit.add(D, cape, toon(0xb48cff, { side: THREE.DoubleSide }), { p: [0, 0.85, -0.1], outline: false });
  for (const [x, y] of [[-0.2, 0.7], [0.25, 0.62], [0.05, 0.9], [-0.35, 0.52], [0.38, 0.48]]) {
    kit.add(D, G.star(0.04, 0.02), glow(WHITE), { p: [x, y, -0.1 - Math.sqrt(Math.max(0.3 - x * x, 0.01)) * 0.72], r: [0, Math.PI, 0], outline: false });
  }
  addArms(kit, rig, 0xffe4d6, WHITE, { r: 0.065, handR: 0.095 });

  const R = 0.44;
  const H = makeHead(rig, 1.56);
  kit.add(H, G.sph(R, 18, 12), toon(0xffe4d6));
  // the HUGE fluffy cotton candy cloud hair
  const hair = part(H, [0, 0, 0]);
  const hp = toon(0xffa6dc);
  const hb = toon(0xa6dcff);
  const hairPuffs = [
    [0, 0.48, -0.05, 0.36, hp], [-0.32, 0.42, 0.02, 0.28, hb], [0.32, 0.42, 0.02, 0.28, hb],
    [0, 0.62, -0.32, 0.32, hb], [-0.22, 0.74, 0.02, 0.24, hp], [0.22, 0.74, 0.02, 0.24, hp], [0, 0.9, -0.12, 0.25, hb],
    [-0.47, 0.14, -0.1, 0.26, hp], [0.47, 0.14, -0.1, 0.26, hp], [-0.52, -0.16, -0.16, 0.23, hb], [0.52, -0.16, -0.16, 0.23, hb],
    [-0.42, -0.4, -0.22, 0.19, hp], [0.42, -0.4, -0.22, 0.19, hp], [0, 0.12, -0.4, 0.4, hp], [0, -0.28, -0.36, 0.3, hb],
    [-0.4, 0.55, -0.3, 0.24, hp], [0.4, 0.55, -0.3, 0.24, hp],
  ];
  for (const [x, y, z, r, m] of hairPuffs) kit.add(hair, G.ico(r, 1), m, { p: [x, y, z] });
  for (const [x, y, z, r, m] of [[-0.2, 0.33, 0.29, 0.14, hp], [0.04, 0.37, 0.32, 0.13, hb], [0.26, 0.31, 0.28, 0.13, hp]]) {
    kit.add(H, G.ico(r, 1), m, { p: [x, y, z] });
  }
  kit.add(hair, G.star(0.1, 0.04), glow(0xffe45c), { p: [0.34, 0.38, 0.27], r: [0, 0.5, 0.2], outline: false });
  addFace(kit, rig, R, { eyeColor: 0xd9438f, lashes: true, mouth: 'grin', mouthV: -0.4, mouthW: 0.1, cheek: 0xff7aa8 });

  // cotton-candy cone wand
  const wand = part(D, [0.14, 0.93, 0.6]);
  wand.rotation.z = -0.62;
  kit.add(wand, G.cone(0.075, 0.34, 10), toon(0xe8b36a), { p: [0, 0.2, 0], r: [Math.PI, 0, 0] });
  kit.add(wand, G.ico(0.14, 1), hp, { p: [0, 0.42, 0] });
  kit.add(wand, G.ico(0.09, 1), hb, { p: [0.07, 0.5, 0.04] });
  const wandStar = part(wand, [0, 0.62, 0]);
  kit.add(wandStar, G.star(0.08, 0.03), glow(0xffe45c), { outline: false });

  // twinkly sparkles that float around her
  const sparkles = part(D, [0, 1.5, 0]);
  const sparkleCols = [0xffffff, 0xffe45c, 0xff9ed8, 0x9fd8ff];
  const bits = [];
  sparkleCols.forEach((col, i) => {
    const g = part(sparkles, [0, 0, 0]);
    kit.add(g, G.star(0.06, 0.02), glow(col), { outline: false });
    bits.push(g);
  });
  rig.anims.push((t, dt, st) => {
    const b = Math.sin(t * 3) * 0.025;
    hair.scale.set(1 + b, 1 - b * 0.6, 1 + b);
    wandStar.rotation.z = t * 3;
    wand.rotation.x = Math.sin(t * 2.4) * 0.12;
    wand.rotation.z = -0.62 + Math.sin(t * 1.7) * 0.08;
    for (let i = 0; i < bits.length; i++) {
      const a = t * 0.9 + (i / bits.length) * TAU;
      bits[i].position.set(Math.cos(a) * 0.95, Math.sin(t * 2 + i * 1.7) * 0.35, Math.sin(a) * 0.75);
      bits[i].scale.setScalar(0.6 + 0.5 * Math.abs(Math.sin(t * 4 + i)));
      bits[i].rotation.z = t * 2 + i;
    }
  });
}

/** Fallback for unknown ids: a friendly generic racer painted in the def's colours. */
function buildGeneric(kit, rig, def) {
  const c = def.colors || { primary: 0xff8fc8, secondary: 0x8fd3ff, accent: 0xffe45c, kart: 0xff8fc8 };
  buildKartBase(kit, rig, { body: c.kart ?? c.primary, trim: c.secondary, seat: c.secondary, hub: c.accent });
  const D = rig.driver;
  kit.add(D, G.sph(0.33), toon(c.primary), { p: [0, 0.94, 0], s: [1, 1, 0.9] });
  addArms(kit, rig, c.primary, WHITE);
  const R = 0.44;
  const H = makeHead(rig, 1.56);
  kit.add(H, G.sph(R, 18, 12), toon(SKIN));
  kit.add(H, G.sph(0.47), toon(c.secondary), { p: [0, 0.06, -0.1] });
  addFace(kit, rig, R, { mouth: 'grin', mouthV: -0.4, mouthW: 0.1 });
}

const BUILDERS = {
  rocco: buildRocco,
  lenny: buildLenny,
  stella: buildStella,
  peachy: buildPeachy,
  gumbo: buildGumbo,
  muffin: buildMuffin,
  dino: buildDino,
  bizzy: buildBizzy,
  'cotton-candy-girl': buildCottonCandyGirl,
};

// ─────────────────────────────────────────────────────────────── effects ──

function buildEffects(rig, owned) {
  const fx = {};
  const dummy = new THREE.Object3D();

  // drift sparks (both rear wheels)
  const sparkMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.95, depthWrite: false });
  owned.materials.push(sparkMat);
  const sparks = new THREE.InstancedMesh(FX.spark, sparkMat, 24);
  sparks.frustumCulled = false;
  sparks.visible = false;
  sparks.renderOrder = 3;
  for (let i = 0; i < sparks.count; i++) sparks.setColorAt(i, new THREE.Color(WHITE));
  rig.root.add(sparks);
  fx.sparks = sparks;
  fx.sparkLevel = -1;

  // sparkly rainbow boost puff + little flames
  const boost = new THREE.Group();
  boost.visible = false;
  rig.chassis.add(boost);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd9f0, transparent: true, opacity: 0.9, depthWrite: false });
  const flameCore = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
  owned.materials.push(flameMat, flameCore);
  fx.flames = rig.exhausts.map((p) => {
    const f = new THREE.Mesh(FX.flame, flameMat);
    f.position.copy(p);
    const core = new THREE.Mesh(FX.flame, flameCore);
    core.scale.setScalar(0.55);
    f.add(core);
    boost.add(f);
    return f;
  });
  const puffMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.9, depthWrite: false });
  owned.materials.push(puffMat);
  const puff = new THREE.InstancedMesh(FX.puff, puffMat, 16);
  puff.frustumCulled = false;
  const col = new THREE.Color();
  for (let i = 0; i < puff.count; i++) puff.setColorAt(i, col.set(RAINBOW[i % RAINBOW.length]));
  boost.add(puff);
  fx.boost = boost;
  fx.puff = puff;

  // shield bubble with floating hearts
  const shield = new THREE.Group();
  shield.position.set(0, 0.95, -0.05);
  shield.visible = false;
  rig.root.add(shield);
  const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xa8ecff, transparent: true, opacity: 0.3, depthWrite: false });
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xff9fdc, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.BackSide });
  const shineMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.75, depthWrite: false });
  const heartMat = new THREE.MeshBasicMaterial({ color: 0xff7ac2, transparent: true, opacity: 0.9, depthWrite: false });
  owned.materials.push(bubbleMat, rimMat, shineMat, heartMat);
  const bubble = new THREE.Mesh(FX.bubble, bubbleMat);
  bubble.scale.set(1.45, 1.25, 1.6);
  bubble.renderOrder = 4;
  const rim = new THREE.Mesh(FX.bubble, rimMat);
  rim.scale.set(1.5, 1.3, 1.65);
  rim.renderOrder = 4;
  const shine = new THREE.Mesh(FX.bubble, shineMat);
  shine.scale.set(0.28, 0.16, 0.05);
  shine.position.set(0.55, 0.65, 1.1);
  shine.rotation.set(-0.5, 0.45, 0.5);
  shine.renderOrder = 5;
  shield.add(bubble, rim, shine);
  const hearts = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const h = new THREE.Mesh(FX.heart, heartMat);
    const a = (i / 3) * TAU;
    h.position.set(Math.cos(a) * 1.25, 0.2 * i - 0.1, Math.sin(a) * 1.35);
    hearts.add(h);
  }
  shield.add(hearts);
  fx.shield = shield;
  fx.hearts = hearts;
  fx.bubbleMat = bubbleMat;

  // dizzy stars circling the head during a happy spin
  const dizzy = new THREE.Group();
  dizzy.position.set(0, 0.62, 0);
  dizzy.visible = false;
  rig.head.add(dizzy);
  const dizzyMat = glow(0xffe45c);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(FX.star, dizzyMat);
    const a = (i / 3) * TAU;
    s.position.set(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
    s.scale.setScalar(1.3);
    dizzy.add(s);
  }
  fx.dizzy = dizzy;
  fx.dummy = dummy;
  fx.color = col;
  return fx;
}

// ───────────────────────────────────────────────────────────── the model ──

const IDLE = Object.freeze({});
let seedCounter = 0;

/**
 * Build a kart + driver model for a character.
 * @param {import('../data/characters.js').CharacterDef} charDef
 * @returns {{group: THREE.Group, update: (dt:number, state?:object)=>void, dispose: ()=>void,
 *            characterId: string, triangles: number, head: THREE.Object3D}}
 *   `head` is the driver's head node (handy for framing cameras / name tags).
 */
export function buildKartModel(charDef) {
  const def = charDef || { id: 'unknown', colors: undefined };
  const group = new THREE.Group();
  group.name = `kart:${def.id}`;

  const shadow = new THREE.Mesh(FX.shadow, SHADOW_MAT);
  shadow.scale.set(0.95, 1, 1.35);
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  group.add(shadow);

  const root = new THREE.Group();
  group.add(root);
  const chassis = new THREE.Group();
  root.add(chassis);
  const driver = new THREE.Group();
  driver.position.set(0, 0, -0.3);
  chassis.add(driver);

  const rig = {
    root,
    chassis,
    driver,
    head: null,
    eyes: null,
    happyEyes: null,
    steeringWheel: null,
    frontPivots: [],
    frontSpins: [],
    rearAxle: null,
    exhausts: [],
    wheelR: [0.28, 0.33],
    anims: [],
    bounce: 1,
    headLag: 1,
  };

  const kit = new Kit();
  (BUILDERS[def.id] || buildGeneric)(kit, rig, def);
  kit.bake();

  // Count the baked model's triangles (effects excluded — they are hidden most of the time).
  let triangles = 0;
  for (const g of kit.geometries) triangles += g.attributes.position.count / 3;

  const owned = { geometries: kit.geometries, materials: [] };
  const fx = buildEffects(rig, owned);

  // Per-kart animation state (never reallocated).
  const seed = rng(0x9e3779b1 ^ (++seedCounter * 7919));
  const st = {
    t: seed() * 10,
    steer: 0,
    speedF: 0,
    driftYaw: 0,
    spinA: 0,
    boostPitch: 0,
    shieldS: 0,
    wheelF: 0,
    wheelR: 0,
    blinkT: 1 + seed() * 3,
    blinkLeft: 0,
    phase: seed() * TAU,
    rootYaw: 0,
    drifting: false,
    boosting: false,
    spinning: false,
    happy: false,
  };

  function updateSparks(t, s) {
    const sp = fx.sparks;
    const on = !!s.drifting && (s.speed ?? 1) !== 0;
    sp.visible = on;
    if (!on) {
      fx.sparkLevel = -1;
      return;
    }
    const level = Math.max(0, Math.min(3, s.driftLevel | 0));
    const d = fx.dummy;
    const col = fx.color;
    if (level !== fx.sparkLevel && level < 3) {
      col.set(DRIFT_COLORS[level]);
      for (let i = 0; i < sp.count; i++) sp.setColorAt(i, col);
      sp.instanceColor.needsUpdate = true;
    }
    fx.sparkLevel = level;
    const size = level === 0 ? 0.9 : 1.3 + level * 0.35;
    const x0 = 0.8;
    for (let i = 0; i < sp.count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const ph = (t * (2.6 + level * 0.5) + i * 0.618) % 1;
      const spread = ((i * 0.37) % 1) - 0.5;
      d.position.set(side * (x0 + ph * (0.25 + spread * 0.4)), 0.1 + Math.sin(ph * Math.PI) * (0.35 + level * 0.12), -0.85 - ph * (0.9 + spread * 0.4));
      d.rotation.set(t * 7 + i, t * 5 + i * 2, 0);
      d.scale.setScalar(size * (1 - ph) * (0.7 + ((i * 0.53) % 1) * 0.6));
      d.updateMatrix();
      sp.setMatrixAt(i, d.matrix);
      if (level === 3) {
        col.setHSL((t * 1.8 + i * 0.13) % 1, 0.95, 0.65);
        sp.setColorAt(i, col);
      }
    }
    sp.instanceMatrix.needsUpdate = true;
    if (level === 3) sp.instanceColor.needsUpdate = true;
  }

  function updateBoost(t, on) {
    fx.boost.visible = on;
    if (!on) return;
    for (let i = 0; i < fx.flames.length; i++) {
      const f = fx.flames[i];
      const fl = 0.85 + Math.sin(t * 40 + i * 2) * 0.2;
      f.scale.set(fl, fl, 0.9 + Math.sin(t * 33 + i) * 0.35);
      f.position.z = rig.exhausts[i].z - 0.15;
    }
    const p = fx.puff;
    const d = fx.dummy;
    const ex = rig.exhausts;
    for (let i = 0; i < p.count; i++) {
      const e = ex[i % ex.length];
      const ph = (t * 2.4 + i / p.count) % 1;
      const j = ((i * 0.61) % 1) - 0.5;
      d.position.set(e.x + j * 0.6 * ph, e.y + 0.05 + ph * 0.7 + j * 0.12, e.z - 0.2 - ph * 1.8);
      d.rotation.set(t * 3 + i, t * 2, 0);
      d.scale.setScalar((0.45 + ph * 1.2) * (1 - ph * ph));
      d.updateMatrix();
      p.setMatrixAt(i, d.matrix);
    }
    p.instanceMatrix.needsUpdate = true;
  }

  function update(dt, state) {
    const s = state || IDLE;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    st.t += dt;
    const t = Number.isFinite(s.time) ? s.time + st.phase : st.t;
    const speed = Number.isFinite(s.speed) ? s.speed : 0;
    st.speedF = Math.min(1, Math.abs(speed) / 30);
    const k10 = 1 - Math.exp(-dt * 10);
    const k6 = 1 - Math.exp(-dt * 6);
    const steerIn = Math.max(-1, Math.min(1, s.steer || 0));
    st.steer += (steerIn - st.steer) * k10;
    st.drifting = !!s.drifting;
    st.boosting = !!s.boosting;
    st.spinning = !!s.spinning;
    st.happy = !!s.happy;

    // wheels + steering
    st.wheelF = (st.wheelF + (speed * dt) / rig.wheelR[0]) % TAU;
    st.wheelR = (st.wheelR + (speed * dt) / rig.wheelR[1]) % TAU;
    for (let i = 0; i < rig.frontPivots.length; i++) {
      rig.frontPivots[i].rotation.y = -st.steer * 0.45;
      rig.frontSpins[i].rotation.x = st.wheelF;
    }
    if (rig.rearAxle) rig.rearAxle.rotation.x = st.wheelR;
    if (rig.steeringWheel) rig.steeringWheel.rotation.z = st.steer * 1.3;

    // drift slide + happy spin
    const driftTarget = st.drifting ? -st.steer * 0.35 : 0;
    st.driftYaw += (driftTarget - st.driftYaw) * k6;
    if (st.spinning) {
      st.spinA += dt * 14;
    } else if (st.spinA !== 0) {
      const target = Math.ceil(st.spinA / TAU - 1e-6) * TAU;
      st.spinA = Math.min(target, st.spinA + dt * 11);
      if (target - st.spinA < 1e-3) st.spinA = 0;
    }
    st.rootYaw = st.driftYaw + st.spinA;
    rig.root.rotation.y = st.rootYaw;

    // chassis bob, roll, boost pitch
    st.boostPitch += ((st.boosting ? -0.06 : 0) - st.boostPitch) * k6;
    const vib = Math.sin(t * 41) * 0.007 * st.speedF;
    rig.chassis.position.y = Math.sin(t * 3.1) * 0.012 + vib + (st.happy ? Math.abs(Math.sin(t * 7)) * 0.12 : 0);
    rig.chassis.rotation.z = -st.steer * 0.05 * st.speedF;
    rig.chassis.rotation.x = st.boostPitch + (st.drifting ? Math.sin(t * 20) * 0.01 : 0);

    // driver lean + bounce
    const D = rig.driver;
    D.rotation.z = st.steer * (0.1 + 0.14 * st.speedF);
    D.rotation.x = st.boosting ? -0.1 : 0;
    const bounce = Math.abs(Math.sin(t * 5.2)) * 0.03 * (0.4 + st.speedF) * rig.bounce;
    D.position.y = bounce;
    const H = rig.head;
    if (H) {
      H.rotation.z = st.steer * 0.12 * rig.headLag + Math.sin(t * 1.7) * 0.03;
      H.rotation.y = -st.steer * 0.28;
      H.rotation.x = Math.sin(t * 2.3) * 0.025 + (st.boosting ? 0.08 : 0);
    }

    // eyes: blink, or happy ^ ^ while spinning / celebrating
    const happyEyes = st.spinning || st.happy;
    if (rig.eyes) {
      st.blinkT -= dt;
      if (st.blinkT <= 0) {
        st.blinkLeft = 0.13;
        st.blinkT = 2.2 + seed() * 3.5;
      }
      st.blinkLeft = Math.max(0, st.blinkLeft - dt);
      rig.eyes.visible = !happyEyes;
      rig.eyes.scale.y = st.blinkLeft > 0 ? 0.12 : 1;
      if (rig.happyEyes) rig.happyEyes.visible = happyEyes;
    }

    // effects
    updateSparks(t, s);
    updateBoost(t, st.boosting);
    st.shieldS += ((s.shielded ? 1 : 0) - st.shieldS) * (1 - Math.exp(-dt * 12));
    const sh = fx.shield;
    sh.visible = st.shieldS > 0.02;
    if (sh.visible) {
      const w = Math.sin(t * 5) * 0.03;
      sh.scale.set(st.shieldS * (1 + w), st.shieldS * (1 - w), st.shieldS * (1 + w * 0.5));
      fx.hearts.rotation.y = t * 1.2;
      fx.bubbleMat.opacity = 0.26 + Math.sin(t * 3) * 0.06;
    }
    fx.dizzy.visible = st.spinning;
    if (st.spinning) fx.dizzy.rotation.y = -st.spinA * 1.3 + t * 3;

    for (let i = 0; i < rig.anims.length; i++) rig.anims[i](t, dt, st);
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    for (const g of owned.geometries) g.dispose();
    for (const m of owned.materials) m.dispose();
    fx.sparks.dispose();
    fx.puff.dispose();
  }

  update(0, IDLE);
  return { group, update, dispose, characterId: def.id, triangles: Math.round(triangles), head: rig.head };
}

/** Ids that have a hand-built model (anything else gets the generic racer). */
export const MODELLED_CHARACTER_IDS = Object.freeze(Object.keys(BUILDERS));
