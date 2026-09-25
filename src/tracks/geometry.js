import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, seedFromString } from './pathTools.js';

/**
 * Geometry, batching and procedural-texture helpers for tracks (shared by the
 * track core, the scenery kit and every track module).
 *
 *   frames(path, s0, s1, step)          sample frames {s,x,y,z,tx,tz,rx,rz} along the road
 *   ribbon(frames, lat0, lat1, yOff, { color(k,f), uv:{across,along}, lift(f,lat) })
 *   wall(frames, lat, top(f), bottom(f), { skip, color })
 *   pushedCopy(geo, t)                   inverted-hull outline copy
 *   heartShape() / starShape(points, outer, inner) / archShape(w, h) / extruded(shape, depth, bevel, segs)
 *   mat4(x, y, z, { rx, ry, rz, s })      compose a matrix (Euler order YXZ)
 *   new Batch().add(geo, material, matrix, outline=true) ... .build(group, outlineMat)
 *   stripeTexture / swirlTexture / waffleTexture / sparkleTexture / roadTexture / dataTexture
 */

export * from './constants.js';

/** Sample frames along the path from s0 to s1 (inclusive). */
export function frames(path, s0, s1, step) {
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  const out = [];
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let k = 0; k <= n; k++) {
    const s = s0 + ((s1 - s0) * k) / n;
    path.pointAt(s, p);
    path.tangentAt(s, t);
    out.push({ s, x: p.x, y: p.y, z: p.z, tx: t.x, tz: t.z, rx: -t.z, rz: t.x });
  }
  return out;
}

/**
 * Flat ribbon between two lateral offsets.
 * opts.color(k, f) -> THREE.Color for segment k (hard stripes, non-indexed);
 * opts.uv: {across, along} tile sizes for texture mapping.
 * opts.lift(f, lat) extra y offset.
 */
export function ribbon(fr, lat0, lat1, yOff, opts = {}) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const col = [];
  const c = new THREE.Color();
  const lift = opts.lift || (() => 0);
  const vtx = (f, lat, u, v) => {
    pos.push(f.x + f.rx * lat, f.y + yOff + lift(f, lat), f.z + f.rz * lat);
    nrm.push(0, 1, 0);
    uv.push(u, v);
    if (opts.color) col.push(c.r, c.g, c.b);
  };
  const ua = opts.uv ? lat0 / opts.uv.across : 0;
  const ub = opts.uv ? lat1 / opts.uv.across : 1;
  for (let k = 0; k < fr.length - 1; k++) {
    const a = fr[k], b = fr[k + 1];
    if (opts.color) c.copy(opts.color(k, a));
    const va = opts.uv ? a.s / opts.uv.along : 0;
    const vb = opts.uv ? b.s / opts.uv.along : 1;
    // (A0, A1, B0) (A1, B1, B0) — faces up
    vtx(a, lat0, ua, va); vtx(a, lat1, ub, va); vtx(b, lat0, ua, vb);
    vtx(a, lat1, ub, va); vtx(b, lat1, ub, vb); vtx(b, lat0, ua, vb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (opts.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Vertical wall along the path at a lateral offset, from top(f) down to bottom(f). */
export function wall(fr, lat, top, bottom, opts = {}) {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  for (let k = 0; k < fr.length - 1; k++) {
    const a = fr[k], b = fr[k + 1];
    const ta = top(a), tb = top(b), ba = bottom(a), bb = bottom(b);
    if (opts.skip && opts.skip(a, b, ta - ba, tb - bb)) continue;
    const ax = a.x + a.rx * lat, az = a.z + a.rz * lat;
    const bx = b.x + b.rx * lat, bz = b.z + b.rz * lat;
    pos.push(ax, ta, az, ax, ba, az, bx, tb, bz);
    pos.push(ax, ba, az, bx, bb, bz, bx, tb, bz);
    if (opts.color) {
      c.copy(opts.color(k, a));
      for (let q = 0; q < 6; q++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (opts.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Copy of a geometry pushed out along its normals (for inverted-hull outlines). */
export function pushedCopy(geo, t) {
  const g = geo.clone();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
  }
  return g;
}

export function heartShape() {
  // classic bezier heart, point at the bottom, ~1.1 wide, centred
  const s = new THREE.Shape();
  const P = (x, y) => [(x - 25) / 100, (50 - y) / 100];
  const m = P(25, 25);
  s.moveTo(m[0], m[1]);
  const bz = (a, b, c, d, e, f) => {
    const p1 = P(a, b), p2 = P(c, d), p3 = P(e, f);
    s.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
  };
  bz(25, 25, 20, 0, 0, 0);
  bz(-30, 0, -30, 35, -30, 35);
  bz(-30, 55, -10, 77, 25, 95);
  bz(60, 77, 80, 55, 80, 35);
  bz(80, 35, 80, 0, 50, 0);
  bz(35, 0, 25, 25, 25, 25);
  return s;
}

export function starShape(points = 5, outer = 1, inner = 0.45) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export function archShape(w, h) {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(-r, 0);
  s.lineTo(-r, h - r);
  s.absarc(0, h - r, r, Math.PI, 0, true);
  s.lineTo(r, 0);
  s.lineTo(-r, 0);
  return s;
}

export function extruded(shape, depth, bevel = 0.08, curveSegments = 10) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments,
  });
  g.center();
  return g;
}

export function mat4(x, y, z, o = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
  const s = o.s === undefined ? new THREE.Vector3(1, 1, 1)
    : typeof o.s === 'number' ? new THREE.Vector3(o.s, o.s, o.s) : new THREE.Vector3(...o.s);
  return m.compose(new THREE.Vector3(x, y, z), q, s);
}

/** Collects static meshes and merges them per material, with optional outlines. */
export class Batch {
  constructor() {
    this.byMat = new Map();
  }
  add(geo, material, matrix, outline = true) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(matrix);
    let entry = this.byMat.get(material);
    if (!entry) this.byMat.set(material, (entry = { geos: [], outline: false, outlineGeos: [] }));
    entry.geos.push(g);
    if (outline) entry.outlineGeos.push(g);
  }
  build(group, outlineMat, thickness = 0.11) {
    const outs = [];
    for (const [material, entry] of this.byMat) {
      if (!entry.geos.length) continue;
      const merged = mergeGeometries(entry.geos);
      const mesh = new THREE.Mesh(merged, material);
      group.add(mesh);
      if (entry.outlineGeos.length) outs.push(...entry.outlineGeos);
    }
    if (outs.length) {
      const og = pushedCopy(mergeGeometries(outs), thickness);
      const om = new THREE.Mesh(og, outlineMat);
      group.add(om);
    }
    for (const entry of this.byMat.values()) entry.geos.forEach((g) => g.dispose());
    this.byMat.clear();
  }
}

// ---------------------------------------------------------------------------
// Procedural textures (DataTexture — works without a DOM)
// ---------------------------------------------------------------------------

/** 0xRRGGBB -> [r, g, b] bytes (sRGB, for DataTexture authoring). */
export function rgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function dataTexture(size, fn, { repeat = true } = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Default road sprinkles (the castle's candy dashes). */
export const DEFAULT_ROAD_SPRINKLES = Object.freeze({
  style: 'dashes',
  count: 95,
  palette: [0xff4f9a, 0x4fb3ff, 0xffe14f, 0x8be08b, 0xb57bff, 0xffffff, 0xff8a3d],
});

/**
 * Road surface: base colour, a soft darker band, and theme sprinkles.
 * theme.roadSprinkles = { style: 'dashes'|'dots'|'stars', count, palette: [hex...] }
 */
export function roadTexture(def) {
  const size = 256;
  const rng = makeRng(seedFromString(def.id + ':road'));
  const base = rgb(def.theme.road);
  const alt = rgb(def.theme.roadAlt);
  const buf = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    const band = y < 26 ? 1 : y < 34 ? 1 - (y - 26) / 8 : 0;
    for (let x = 0; x < size; x++) {
      const n = (rng() - 0.5) * 6;
      const i = (y * size + x) * 3;
      for (let k = 0; k < 3; k++) buf[i + k] = base[k] + (alt[k] - base[k]) * band + n;
    }
  }
  const spr = def.theme.roadSprinkles || DEFAULT_ROAD_SPRINKLES;
  const style = spr.style || 'dashes';
  const pal = (spr.palette || DEFAULT_ROAD_SPRINKLES.palette).map(rgb);
  const count = spr.count ?? DEFAULT_ROAD_SPRINKLES.count;
  for (let n = 0; n < count; n++) {
    const col = pal[Math.floor(rng() * pal.length)];
    const cx = rng() * size, cy = rng() * size;
    if (style === 'stars' || style === 'dots') {
      // dots / tiny stars
      const r = style === 'stars' ? 1 + rng() * 1.6 : 1.5 + rng() * 2.5;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const px = ((Math.floor(cx + dx) % size) + size) % size;
        const py = ((Math.floor(cy + dy) % size) + size) % size;
        const i = (py * size + px) * 3;
        const a = style === 'stars' ? 1 - d / (r + 0.5) : 0.8;
        for (let k = 0; k < 3; k++) buf[i + k] += (col[k] - buf[i + k]) * a;
      }
    } else {
      // sprinkles: little rounded dashes at random angles
      const ang = rng() * Math.PI;
      const len = 3.5 + rng() * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let t = -len; t <= len; t += 0.5) for (let w = -1; w <= 1; w += 0.5) {
        const px = ((Math.floor(cx + ca * t - sa * w) % size) + size) % size;
        const py = ((Math.floor(cy + sa * t + ca * w) % size) + size) % size;
        const i = (py * size + px) * 3;
        for (let k = 0; k < 3; k++) buf[i + k] = col[k];
      }
    }
  }
  return dataTexture(size, (x, y) => {
    const i = (y * size + x) * 3;
    return [clamp255(buf[i]), clamp255(buf[i + 1]), clamp255(buf[i + 2]), 255];
  });
}

export function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function swirlTexture(c1, c2) {
  const a = rgb(c1), b = rgb(c2);
  return dataTexture(128, (x, y) => {
    const dx = x - 64, dy = y - 64;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const v = Math.sin(ang * 2 + r * 0.22);
    const c = v > 0 ? a : b;
    return [c[0], c[1], c[2], 255];
  }, { repeat: false });
}

export function stripeTexture(c1, c2, stripes = 8) {
  const a = rgb(c1), b = rgb(c2);
  return dataTexture(64, (x, y) => {
    const v = ((x + y) / 64) * stripes;
    const c = Math.floor(v) % 2 === 0 ? a : b;
    return [c[0], c[1], c[2], 255];
  });
}

export function waffleTexture() {
  const a = rgb(0xe8b068), b = rgb(0xb97a3c);
  return dataTexture(64, (x, y) => {
    const u = (x + y) % 16, v = (x - y + 64) % 16;
    const line = u < 2 || v < 2;
    const c = line ? b : a;
    return [c[0], c[1], c[2], 255];
  });
}

export function sparkleTexture() {
  return dataTexture(64, (x, y) => {
    const dx = (x - 31.5) / 32, dy = (y - 31.5) / 32;
    const r = Math.hypot(dx, dy);
    const cross = Math.max(0, 1 - Math.abs(dx) * 9) * Math.max(0, 1 - Math.abs(dy) * 1.2)
      + Math.max(0, 1 - Math.abs(dy) * 9) * Math.max(0, 1 - Math.abs(dx) * 1.2);
    const a = Math.min(1, Math.max(0, 1 - r * 2.2) + cross * 0.9);
    return [255, 255, 255, Math.round(a * 255)];
  }, { repeat: false });
}
