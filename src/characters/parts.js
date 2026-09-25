import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toon, glow } from '../render/toon.js';

/**
 * Shared parts library for every racer (kart chassis, wheels, faces, limbs,
 * the Kit batcher, outlines and the drift / boost / shield / dizzy effects).
 *
 * A character module (src/characters/<id>.js) exports `build(kit, rig, def)`
 * and builds ONLY its own look with these helpers; the rig, animation loop and
 * effects are assembled by ./model.js (buildKartModel).
 *
 * Model space: origin on the ground under the kart centre, forward = +Z,
 * up = +Y, the driver's right = -X. A kart is ~2.2 long and ~1.6 wide.
 *
 * Performance: every static piece is baked (merged) per animated sub-group and
 * per material, and cartoon outlines are merged into one mesh per sub-group,
 * so a whole kart is only a few dozen draw calls.
 *
 * Rig (what `build` receives and may extend):
 *   rig.root        happy-spin + drift-slide yaw (effects live here)
 *   rig.chassis     bob / roll / boost pitch — put kart pieces here
 *   rig.driver      lean / bounce — put the body here (origin at seat level)
 *   rig.head        created by makeHead(rig, y) — tilt / look; addFace() adds eyes
 *   rig.anims       push (t, dt, st) => void callbacks for your own wiggles
 *   rig.bounce, rig.headLag   animation multipliers (default 1)
 *
 * Helpers (all exported):
 *   G.*             fresh primitive geometries (sph, bowl, box, rbox, cyl, cone, tor, cap, ico, star, heart, tube)
 *   kit.add(target, geo, material, { p, r, q, s, f, outline, ow })
 *   frame(p, r, parent) / surf(R, u, v, depth, c, roll)   placement frames
 *   limb / stick     capsule / cylinder between two points
 *   part(parent, p)  a sub-group you animate yourself via rig.anims
 *   buildKartBase(kit, rig, { body, trim, seat, tire, hub, bar, width, shell, lights,
 *                   wheels:'classic'|'donut', fr, rr, steer, steerHeart, hubStar, pipes, icing })
 *   addArms(kit, rig, sleeveColor, handColor, { shoulder, hand, r, handR })
 *   makeHead(rig, y) · addFace(kit, rig, R, faceOpts) · addMouth(kit, target, F, w, kind)
 *   toon(color, opts) / glow(color) materials (re-exported)
 */
export { THREE, toon, glow };
export { mergeGeometries, RoundedBoxGeometry };

// ─────────────────────────────────────────────────────────────── constants ──

export const OUTLINE_W = 0.022;
export const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x2a1633, side: THREE.BackSide });
export const EYE_DARK = 0x22162e;
export const WHITE = 0xffffff;
export const TAU = Math.PI * 2;
export const UP = new THREE.Vector3(0, 1, 0);
export const ONE = new THREE.Vector3(1, 1, 1);

export const DRIFT_COLORS = [0xfff4c2, 0x4fb8ff, 0xff5fc8]; // level 0 (dust), 1 blue, 2 pink; 3 = rainbow
export const RAINBOW = [0xff6b9a, 0xffa64d, 0xffe45c, 0x7ee07a, 0x5ec8ff, 0xb68cff];

// ─────────────────────────────────────────────────────────────── geometry ──

export function starShape(R, r, points = 5) {
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

export function heartShape(size) {
  const k = size / 1.0;
  const s = new THREE.Shape();
  s.moveTo(0, -0.55 * k);
  s.bezierCurveTo(-0.15 * k, -0.35 * k, -0.62 * k, -0.18 * k, -0.6 * k, 0.15 * k);
  s.bezierCurveTo(-0.58 * k, 0.48 * k, -0.18 * k, 0.55 * k, 0, 0.28 * k);
  s.bezierCurveTo(0.18 * k, 0.55 * k, 0.58 * k, 0.48 * k, 0.6 * k, 0.15 * k);
  s.bezierCurveTo(0.62 * k, -0.18 * k, 0.15 * k, -0.35 * k, 0, -0.55 * k);
  return s;
}

export function extrude(shape, depth, bevel) {
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
export const G = {
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
export const FX = {
  spark: new THREE.OctahedronGeometry(0.09, 0),
  puff: new THREE.IcosahedronGeometry(0.2, 1),
  bubble: new THREE.SphereGeometry(1, 18, 12),
  star: G.star(0.09, 0.03),
  heart: G.heart(0.16, 0.03),
  shadow: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
  flame: new THREE.ConeGeometry(0.1, 0.45, 8).rotateX(-Math.PI / 2),
};
export const SHADOW_MAT = new THREE.MeshBasicMaterial({
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
export function frame(p = [0, 0, 0], r = [0, 0, 0], parent = null) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], r[3] || 'XYZ'));
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), q, ONE);
  if (parent) m.premultiply(parent);
  return m;
}

/**
 * Collects primitive parts per target Object3D, then bakes them into one mesh
 * per material plus one merged outline mesh.
 */
export class Kit {
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

export function batchKey(mat) {
  if (mat.transparent || mat.side !== THREE.FrontSide) return mat;
  if (mat.isMeshToonMaterial) return VC_TOON;
  if (mat.isMeshBasicMaterial) return VC_GLOW;
  return mat;
}

const _col = new THREE.Color();
export function paint(geo, mat) {
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
export function clean(g) {
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
export function limb(kit, target, a, b, r, mat, o = {}) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const dir = B.clone().sub(A);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  kit.add(target, G.cap(r, len, o.rs ?? 8), mat, { ...o, p: mid.toArray(), q });
}

/** A thin cylinder from a to b (sticks, stems, struts). */
export function stick(kit, target, a, b, r, mat, o = {}) {
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
export function surf(R, u, v, depth = 1, c = [0, 0, 0], roll = 0) {
  const x = u * R;
  const y = v * R;
  const z = Math.sqrt(Math.max(R * R - x * x - y * y, 0));
  const nx = x / R;
  const ny = y / R;
  const nz = z / R;
  return frame([c[0] + nx * R * depth, c[1] + ny * R * depth, c[2] + nz * R * depth], [-Math.asin(ny), Math.atan2(nx, nz), roll, 'YXZ']);
}

/** Deterministic little random generator so every kart looks the same each time. */
export function rng(seed) {
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
export function addFace(kit, rig, R, f = {}) {
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
export function addMouth(kit, target, F, w, kind = 'smile') {
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
export function buildKartBase(kit, rig, k) {
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

export function addWheel(kit, target, p, r, side, k) {
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
export function addArms(kit, rig, sleeve, hand, o = {}) {
  const sh = o.shoulder ?? [0.31, 1.06, 0.02];
  const hd = o.hand ?? [0.14, 0.93, 0.6];
  const r = o.r ?? 0.085;
  for (const sd of [-1, 1]) {
    limb(kit, rig.driver, [sd * sh[0], sh[1], sh[2]], [sd * hd[0], hd[1], hd[2]], r, toon(sleeve));
    kit.add(rig.driver, G.sph(o.handR ?? 0.1, 10, 8), toon(hand), { p: [sd * hd[0], hd[1], hd[2]] });
  }
}

export function makeHead(rig, y) {
  const head = new THREE.Group();
  head.position.set(0, y, 0);
  rig.driver.add(head);
  rig.head = head;
  return head;
}

/** A sub-group that a character animates itself (added to rig.anims callbacks). */
export function part(parent, p = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(p[0], p[1], p[2]);
  parent.add(g);
  return g;
}


export const SKIN = 0xffd9bd;
// ─────────────────────────────────────────────────────────────── effects ──

export function buildEffects(rig, owned) {
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

