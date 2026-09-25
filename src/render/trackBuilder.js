import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from './toon.js';

/**
 * Track builder — turns a TrackDef + TrackPath into a charming 3D world:
 * road ribbon (following elevation), candy-stripe curbs, shoulders, edge
 * fences, supports/skirts under elevated road, start/finish arch, glowing
 * boost pads, a gradient sky dome, lights and lots of themed scenery.
 *
 * Repeated props use InstancedMesh; one-off static props (castle, arch…)
 * are merged per material by a small batcher, with cartoon outlines made by
 * pushing a copy of the merged geometry out along its normals.
 *
 * Nothing here touches the scene: the caller adds `built.group` and applies
 * `trackDef.theme.fog*` to `scene.fog`. The sky dome re-centres itself on
 * whichever camera is rendering (works per split-screen viewport), so cameras
 * only need `far > SKY_RADIUS`; ~1200 keeps the far clouds/planets in view.
 */

/** Visual fence distance beyond path.halfWidth (physics soft wall is at +3; a kart is ~1.6 wide). */
export const FENCE_OFFSET = 3.8;
export const SKY_RADIUS = 700;

const SHOULDER_IN = 1.3; // curb width
/** Metres a cotton-candy canopy keeps beyond the fence (camera height + a bit). */
export const TREE_CAMERA_CLEARANCE = 3.5;
/** Max horizontal reach of a cotton-candy tree canopy per unit of tree scale. */
const CANOPY_REACH = 3.3;
const APRON_Y = -3; // far-away flat ground level on hilly tracks
const SHOULDER_OUT = FENCE_OFFSET + 1.4;

// ---------------------------------------------------------------------------
// Small pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Uniform-grid spatial index over the path samples, for fast
 * "how far is this point from the road?" queries.
 */
export function createPathIndex(path, cell = 12) {
  const grid = new Map();
  const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
  for (let i = 0; i < path.count; i++) {
    const k = key(Math.floor(path.px[i] / cell), Math.floor(path.pz[i] / cell));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  return {
    /** @returns {{dist:number, i:number, s:number, y:number}} dist = Infinity if nothing within maxR */
    nearest(x, z, maxR = 60) {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      const rings = Math.ceil(maxR / cell) + 1;
      let best = -1;
      let bestD2 = Infinity;
      for (let r = 0; r <= rings; r++) {
        for (let ix = cx - r; ix <= cx + r; ix++) {
          for (let iz = cz - r; iz <= cz + r; iz++) {
            if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
            const arr = grid.get(key(ix, iz));
            if (!arr) continue;
            for (const i of arr) {
              const dx = x - path.px[i];
              const dz = z - path.pz[i];
              const d2 = dx * dx + dz * dz;
              if (d2 < bestD2) { bestD2 = d2; best = i; }
            }
          }
        }
        if (best >= 0 && Math.sqrt(bestD2) <= r * cell) break;
      }
      const dist = Math.sqrt(bestD2);
      if (best < 0 || dist > maxR) return { dist: Infinity, i: -1, s: 0, y: 0 };
      return { dist, i: best, s: best * path.step, y: path.py[best] };
    },
  };
}

/** Per-sample weight: 0 on bridges, easing to 1 away from them. */
function bridgeWeights(def, path) {
  const w = new Float32Array(path.count).fill(1);
  const ranges = def.scenery?.bridges || [];
  const L = path.length;
  for (let i = 0; i < path.count; i++) {
    const s = i * path.step;
    for (const [a, b] of ranges) {
      const sa = a * L, sb = b * L;
      let d = 0;
      if (s < sa) d = Math.min(sa - s, s + L - sb);
      else if (s > sb) d = Math.min(s - sb, sa + L - s);
      w[i] = Math.min(w[i], smoothstep(2, 14, d));
    }
  }
  return w;
}

/**
 * Terrain height model for a track. `height(x,z)` returns null over the void.
 * - flat: y = 0 (castle: the moat is a basin)
 * - hills: rolling noise that blends into the road so it never floats
 * - void: nothing (space)
 */
export function createTerrain(def, path, index) {
  const kind = def.scenery?.terrain || 'flat';
  const hw = path.halfWidth;
  if (kind === 'void') return { kind, height: () => null, base: () => null };
  if (kind === 'flat') {
    const c = def.scenery?.castle;
    return {
      kind,
      height(x, z) {
        if (c) {
          const r = Math.hypot(x - c.center[0], z - c.center[1]);
          if (r > c.moatInner && r < c.moatOuter) return -1.6;
        }
        return 0;
      },
      base: () => 0,
    };
  }
  const amp = def.scenery?.hills?.amp ?? 6;
  const sc = def.scenery?.hills?.scale ?? 0.012;
  const rng = makeRng(seedFromString(def.id + ':hills'));
  const ph = Array.from({ length: 6 }, () => rng() * Math.PI * 2);
  const b = path.getBounds();
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const reach = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 150;
  const bw = bridgeWeights(def, path);
  const river = def.scenery?.riverLine; // filled in by the builder for sundae
  const base = (x, z) => {
    let n = 0.5 + 0.28 * Math.sin(x * sc + ph[0]) * Math.cos(z * sc * 1.3 + ph[1])
      + 0.18 * Math.sin((x + z) * sc * 2.1 + ph[2])
      + 0.1 * Math.cos((x - z) * sc * 3.7 + ph[3]);
    // fade to flat at the far edge so the terrain meets the outer plane
    const edge = 1 - smoothstep(reach - 120, reach, Math.hypot(x - cx, z - cz));
    let h = amp * n * edge + APRON_Y * (1 - edge);
    if (river && river.length) {
      const d = distToPolyline(x, z, river);
      h = THREE.MathUtils.lerp(-2.4, h, smoothstep(8, 22, d));
    }
    return h;
  };
  return {
    kind,
    base,
    height(x, z) {
      const bh = base(x, z);
      const n = index.nearest(x, z, hw + 46);
      if (n.i < 0) return bh;
      const conform = (1 - smoothstep(hw + 6, hw + 40, n.dist)) * bw[n.i];
      let h = THREE.MathUtils.lerp(bh, n.y - 0.3, conform);
      // under / beside bridges keep the ground well below the deck
      if (bw[n.i] < 1) {
        const k = (1 - bw[n.i]) * (1 - smoothstep(hw + 6, hw + 30, n.dist));
        h = THREE.MathUtils.lerp(h, Math.min(h, n.y - 3.2), k);
      }
      return h;
    },
  };
}

function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Item box slots from `itemBoxRows`: a row of boxes across the road.
 * position = road surface point (the race lifts boxes above it).
 */
export function computeItemBoxSlots(def, path) {
  const count = path.width >= 18 ? 5 : 4;
  const span = path.halfWidth * 0.72;
  const slots = [];
  for (const f of def.itemBoxRows || []) {
    const s = path.wrap(f * path.length);
    for (let k = 0; k < count; k++) {
      const lateral = -span + (2 * span * k) / (count - 1);
      slots.push({ s, lateral, position: path.positionAt(s, lateral) });
    }
  }
  return slots;
}

/** Boost pads from `boostPads` defs (length 6, halfWidth 2.5), clamped inside the road. */
export function computeBoostPads(def, path) {
  return (def.boostPads || []).map((b) => {
    const s = path.wrap(b.at * path.length);
    const max = path.halfWidth - 2.5 - 0.3;
    const lateral = Math.max(-max, Math.min(max, b.lateral ?? 0));
    return { s, lateral, length: 6, halfWidth: 2.5, position: path.positionAt(s, lateral) };
  });
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Sample frames along the path from s0 to s1 (inclusive). */
function frames(path, s0, s1, step) {
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
function ribbon(fr, lat0, lat1, yOff, opts = {}) {
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
function wall(fr, lat, top, bottom, opts = {}) {
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
function pushedCopy(geo, t) {
  const g = geo.clone();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
  }
  return g;
}

const OUTLINE_COLOR = 0x3a2046;

function heartShape() {
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

function starShape(points = 5, outer = 1, inner = 0.45) {
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

function archShape(w, h) {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(-r, 0);
  s.lineTo(-r, h - r);
  s.absarc(0, h - r, r, Math.PI, 0, true);
  s.lineTo(r, 0);
  s.lineTo(-r, 0);
  return s;
}

function extruded(shape, depth, bevel = 0.08, curveSegments = 10) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments,
  });
  g.center();
  return g;
}

function mat4(x, y, z, o = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
  const s = o.s === undefined ? new THREE.Vector3(1, 1, 1)
    : typeof o.s === 'number' ? new THREE.Vector3(o.s, o.s, o.s) : new THREE.Vector3(...o.s);
  return m.compose(new THREE.Vector3(x, y, z), q, s);
}

/** Collects static meshes and merges them per material, with optional outlines. */
class Batch {
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
function rgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function dataTexture(size, fn, { repeat = true } = {}) {
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

/** Road surface: base colour, a soft darker band, and theme sprinkles. */
function roadTexture(def) {
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
  const kind = def.scenery?.kind;
  const palettes = {
    castle: [0xff4f9a, 0x4fb3ff, 0xffe14f, 0x8be08b, 0xb57bff, 0xffffff, 0xff8a3d],
    meadow: [0xff9fb0, 0xffe39a, 0xa8e6a3, 0xa8d8ff, 0xffffff, 0xd9a86a],
    galaxy: [0xffffff, 0x9ff7ff, 0xffe27a, 0xff9ce8],
    sundae: [0xff8fc4, 0x8fd8ff, 0xfff1a8, 0xa8ecb0, 0xffffff, 0xd2b8ff],
  };
  const pal = (palettes[kind] || palettes.castle).map(rgb);
  const count = kind === 'meadow' ? 200 : kind === 'galaxy' ? 220 : 95;
  for (let n = 0; n < count; n++) {
    const col = pal[Math.floor(rng() * pal.length)];
    const cx = rng() * size, cy = rng() * size;
    if (kind === 'galaxy' || kind === 'meadow') {
      // dots / tiny stars
      const r = kind === 'galaxy' ? 1 + rng() * 1.6 : 1.5 + rng() * 2.5;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const px = ((Math.floor(cx + dx) % size) + size) % size;
        const py = ((Math.floor(cy + dy) % size) + size) % size;
        const i = (py * size + px) * 3;
        const a = kind === 'galaxy' ? 1 - d / (r + 0.5) : 0.8;
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

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function swirlTexture(c1, c2) {
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

function stripeTexture(c1, c2, stripes = 8) {
  const a = rgb(c1), b = rgb(c2);
  return dataTexture(64, (x, y) => {
    const v = ((x + y) / 64) * stripes;
    const c = Math.floor(v) % 2 === 0 ? a : b;
    return [c[0], c[1], c[2], 255];
  });
}

function waffleTexture() {
  const a = rgb(0xe8b068), b = rgb(0xb97a3c);
  return dataTexture(64, (x, y) => {
    const u = (x + y) % 16, v = (x - y + 64) % 16;
    const line = u < 2 || v < 2;
    const c = line ? b : a;
    return [c[0], c[1], c[2], 255];
  });
}

function sparkleTexture() {
  return dataTexture(64, (x, y) => {
    const dx = (x - 31.5) / 32, dy = (y - 31.5) / 32;
    const r = Math.hypot(dx, dy);
    const cross = Math.max(0, 1 - Math.abs(dx) * 9) * Math.max(0, 1 - Math.abs(dy) * 1.2)
      + Math.max(0, 1 - Math.abs(dy) * 9) * Math.max(0, 1 - Math.abs(dx) * 1.2);
    const a = Math.min(1, Math.max(0, 1 - r * 2.2) + cross * 0.9);
    return [255, 255, 255, Math.round(a * 255)];
  }, { repeat: false });
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * @param {object} def TrackDef
 * @param {import('../track/TrackPath.js').TrackPath} path
 */
export function buildTrack(def, path) {
  const group = new THREE.Group();
  group.name = `track:${def.id}`;
  const theme = def.theme;
  const kind = def.scenery?.kind || 'castle';
  const rng = makeRng(seedFromString(def.id));
  const index = createPathIndex(path);
  const ownedMaterials = [];
  const ownedTextures = [];
  const animators = [];
  const own = (m) => { ownedMaterials.push(m); return m; };
  const ownTex = (t) => { ownedTextures.push(t); return t; };
  const outlineMat = own(new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide }));
  const batch = new Batch();
  const flagGeo = new THREE.ShapeGeometry(heartShape(), 8);
  flagGeo.rotateZ(-Math.PI / 2);
  flagGeo.translate(0.55, 0, 0);
  const flags = [];
  animators.push((dt, t) => {
    for (const f of flags) {
      f.m.rotation.y = 0.9 + Math.sin(t * 1.3 + f.ph) * 0.6;
      f.m.scale.x = 1.6 * (0.85 + Math.sin(t * 5 + f.ph) * 0.15);
    }
  });
  const hw = path.halfWidth;
  const L = path.length;
  const bounds = path.getBounds();
  const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;

  const toonTex = (tex, color = 0xffffff, extra = {}) => {
    const m = own(toon(color, { unique: true, ...extra }));
    m.map = tex;
    m.needsUpdate = true;
    return m;
  };
  const toonVC = (extra = {}) => {
    const m = own(toon(0xffffff, { unique: true, ...extra }));
    m.vertexColors = true;
    m.needsUpdate = true;
    return m;
  };

  // Sundae river line must exist before terrain is created.
  if (kind === 'sundae' && def.scenery?.river) {
    def = { ...def, scenery: { ...def.scenery, riverLine: riverPolyline(def, path, index) } };
  }
  const terrain = createTerrain(def, path, index);
  const groundH = (x, z) => terrain.height(x, z) ?? -1000;
  const bw = bridgeWeights(def, path);

  // Road-side helpers ------------------------------------------------------
  const loopFrames = frames(path, 0, L, path.step);
  const distToRoad = (x, z, maxR = 80) => index.nearest(x, z, maxR).dist;
  const clearOfRoad = (x, z, margin) => distToRoad(x, z, hw + margin + 2) > hw + margin;

  // ===== Sky ===============================================================
  const sky = buildSky(theme, kind, own, ownTex, rng, animators);
  group.add(sky);

  // ===== Lights ============================================================
  const lights = [];
  const night = kind === 'galaxy';
  const hemi = new THREE.HemisphereLight(theme.skyBottom, theme.ground, night ? 0.9 : 1.05);
  const sun = new THREE.DirectionalLight(theme.sunColor, night ? 1.25 : 1.6);
  sun.position.set(center.x + 160, 260, center.z + 120);
  sun.target.position.copy(center);
  const amb = new THREE.AmbientLight(theme.ambientColor, night ? 0.55 : 0.35);
  group.add(hemi, sun, sun.target, amb);
  lights.push(hemi, sun, amb);

  // ===== Ground ============================================================
  buildGround();

  // ===== Road ==============================================================
  const roadTex = ownTex(roadTexture(def));
  const roadMat = toonTex(roadTex);
  const road = new THREE.Mesh(ribbon(loopFrames, -hw, hw, 0.03, { uv: { across: 9, along: 9 } }), roadMat);
  road.name = 'road';
  group.add(road);

  // Curbs: candy stripes, gently raised
  const curbA = new THREE.Color(theme.curbA);
  const curbB = new THREE.Color(theme.curbB);
  const stripeLen = 2.6;
  const curbColor = (k, f) => (Math.floor(f.s / stripeLen) % 2 === 0 ? curbA : curbB);
  const curbLift = (f, lat) => (Math.abs(lat) > hw + 0.1 ? 0.12 : 0.02);
  const curbMat = night
    ? own(new THREE.MeshBasicMaterial({ vertexColors: true }))
    : toonVC();
  const curbGeo = mergeGeometries([
    ribbon(loopFrames, hw, hw + SHOULDER_IN, 0.04, { color: curbColor, lift: curbLift }),
    ribbon(loopFrames, -hw - SHOULDER_IN, -hw, 0.04, { color: curbColor, lift: curbLift }),
  ]);
  group.add(new THREE.Mesh(curbGeo, curbMat));

  // Shoulders (off-road band) under the fences
  const shoulderMat = own(toon(theme.offRoad, { unique: true }));
  const shoulderGeo = mergeGeometries([
    ribbon(loopFrames, hw + SHOULDER_IN, hw + SHOULDER_OUT, 0.015),
    ribbon(loopFrames, -hw - SHOULDER_OUT, -hw - SHOULDER_IN, 0.015),
  ]);
  group.add(new THREE.Mesh(shoulderGeo, shoulderMat));

  if (kind === 'sundae') buildChocolateRoadDetails();

  buildSkirtsAndSupports();
  buildFences();
  buildStartArch();
  const boostPads = computeBoostPads(def, path);
  buildBoostPads(boostPads);
  const itemBoxSlots = computeItemBoxSlots(def, path);

  // ===== Theme scenery =====================================================
  if (kind === 'castle') buildCastleWorld();
  else if (kind === 'meadow') buildMeadowWorld();
  else if (kind === 'galaxy') buildGalaxyWorld();
  else if (kind === 'sundae') buildSundaeWorld();

  if (!night) buildClouds();

  batch.build(group, outlineMat);

  // =========================================================================
  // Section builders (closures share the context above)
  // =========================================================================

  function buildGround() {
    const g = groundColorFn();
    if (terrain.kind === 'void') return;
    if (terrain.kind === 'flat') {
      const c = def.scenery?.castle;
      const size = extent + 900;
      const shape = new THREE.Shape();
      shape.moveTo(center.x - size, -(center.z - size));
      shape.lineTo(center.x + size, -(center.z - size));
      shape.lineTo(center.x + size, -(center.z + size));
      shape.lineTo(center.x - size, -(center.z + size));
      shape.closePath();
      if (c) {
        const hole = new THREE.Path();
        hole.absarc(c.center[0], -c.center[1], c.moatOuter, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
      const geo = new THREE.ShapeGeometry(shape, 48);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -0.05, 0);
      const ground = new THREE.Mesh(geo, own(toon(theme.ground, { unique: true })));
      ground.name = 'ground';
      group.add(ground);
      return;
    }
    // hills: a detailed heightfield around the track + a big flat apron
    const pad = 150;
    const w = bounds.maxX - bounds.minX + pad * 2;
    const d = bounds.maxZ - bounds.minZ + pad * 2;
    const cell = 3.5;
    const nx = Math.ceil(w / cell), nz = Math.ceil(d / cell);
    const geo = new THREE.PlaneGeometry(w, d, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate(center.x, 0, center.z);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrain.height(x, z);
      pos.setY(i, y);
      g(x, z, y, col);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, toonVC());
    ground.name = 'ground';
    group.add(ground);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), own(toon(theme.ground, { unique: true })));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(center.x, APRON_Y - 0.05, center.z);
    group.add(apron);
  }

  function groundColorFn() {
    const base = new THREE.Color(theme.ground);
    const noiseRng = makeRng(seedFromString(def.id + ':gc'));
    const p = [noiseRng() * 10, noiseRng() * 10, noiseRng() * 10];
    const tints = kind === 'sundae'
      ? [new THREE.Color(0xffd1e6), new THREE.Color(0xd4f7e4), new THREE.Color(0xfff0c2)]
      : kind === 'castle'
        ? [new THREE.Color(0xf3c6ff), new THREE.Color(0xffc2e0), new THREE.Color(0xfff0f8)]
        : [new THREE.Color(0xa8ec8a), new THREE.Color(0x7fd67a), new THREE.Color(0xc6f59a)];
    return (x, z, y, out) => {
      out.copy(base);
      const n1 = Math.sin(x * 0.031 + p[0]) * Math.cos(z * 0.027 + p[1]);
      const n2 = Math.sin((x + z) * 0.05 + p[2]);
      out.lerp(tints[0], smoothstep(0.35, 0.75, n1) * (kind === 'sundae' ? 0.75 : 0.5));
      out.lerp(tints[1], smoothstep(-0.4, -0.8, n1) * 0.6);
      out.lerp(tints[2], smoothstep(0.6, 0.95, n2) * 0.5);
      // slightly lighter up high
      out.offsetHSL(0, 0, Math.max(-0.05, Math.min(0.06, (y - 3) * 0.008)));
    };
  }

  function buildSkirtsAndSupports() {
    const outer = hw + SHOULDER_OUT;
    const skirtColor = new THREE.Color(kind === 'galaxy' ? 0x3b2a86 : kind === 'sundae' ? 0xd9a15c : 0xfff0f7);
    const trim = new THREE.Color(kind === 'galaxy' ? 0x7ff5ff : kind === 'sundae' ? 0xff9ec4 : 0xff9ccc);
    const isRainbow = kind === 'castle';
    const rainbow = [0xff6f91, 0xffa94d, 0xffe066, 0x8ce99a, 0x74c0fc, 0x9775fa, 0xf783ac].map((h) => new THREE.Color(h));
    const top = (f) => f.y + 0.015;
    let bottom;
    if (terrain.kind === 'void') bottom = (f) => f.y - 2.4;
    else bottom = (f) => Math.min(f.y - 0.2, groundH(f.x, f.z));
    const geos = [];
    for (const side of [-1, 1]) {
      const lat = side * outer;
      const skip = terrain.kind === 'void' ? null : (a, b, ga, gb) => ga < 0.25 && gb < 0.25;
      const bFn = terrain.kind === 'void' ? bottom
        : (f) => Math.min(f.y - 0.2, groundH(f.x + f.rx * lat, f.z + f.rz * lat));
      geos.push(wall(loopFrames, lat, top, bFn, {
        skip,
        color: (k, f) => {
          if (isRainbow) {
            const band = Math.floor(((f.s / 3) % 7 + 7) % 7);
            return rainbow[band];
          }
          return Math.floor(f.s / 6) % 2 ? skirtColor : trim;
        },
      }));
    }
    const skirtMat = terrain.kind === 'void'
      ? own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
      : toonVC({ side: THREE.DoubleSide });
    const skirt = new THREE.Mesh(mergeGeometries(geos), skirtMat);
    group.add(skirt);

    if (terrain.kind === 'void') {
      // underside of the floating road
      const under = ribbon(loopFrames, -outer, outer, -2.4);
      const um = own(toon(0x2a1d66, { unique: true, side: THREE.DoubleSide, emissive: 0x1a0f44 }));
      group.add(new THREE.Mesh(under, um));
      // glowing edge line along the underside
      const lineGeo = mergeGeometries([
        ribbon(loopFrames, outer - 0.35, outer, -2.35),
        ribbon(loopFrames, -outer, -outer + 0.35, -2.35),
      ]);
      group.add(new THREE.Mesh(lineGeo, glow(0x7ff5ff)));
      return;
    }

    // Pillars where the road is well above the ground
    const pillars = [];
    for (let s = 0; s < L; s += 9) {
      const f = frames(path, s, s + 0.01, 1)[0];
      for (const side of [-1, 1]) {
        const lat = side * (hw - 1.5);
        const x = f.x + f.rx * lat, z = f.z + f.rz * lat;
        const gy = groundH(x, z);
        const gap = f.y - gy;
        if (gap > 2.4) pillars.push({ x, z, y0: gy, y1: f.y - 0.2 });
      }
    }
    if (pillars.length) {
      const colGeo = kind === 'sundae'
        ? new THREE.BoxGeometry(1.6, 1, 1.6)
        : new THREE.CylinderGeometry(0.9, 1.1, 1, 12);
      const colMat = toon(kind === 'sundae' ? 0xe0a860 : 0xffffff);
      const ringGeo = new THREE.TorusGeometry(1.05, 0.3, 8, 16);
      const ringMat = toon(kind === 'sundae' ? 0xff9ec4 : 0xff8cc6);
      const cols = new THREE.InstancedMesh(colGeo, colMat, pillars.length);
      const rings = new THREE.InstancedMesh(ringGeo, ringMat, pillars.length * 2);
      const m = new THREE.Matrix4();
      pillars.forEach((p, i) => {
        const h = p.y1 - p.y0;
        cols.setMatrixAt(i, mat4(p.x, p.y0 + h / 2, p.z, { s: [1, h, 1] }));
        rings.setMatrixAt(i * 2, mat4(p.x, p.y1 - 0.3, p.z, { rx: Math.PI / 2 }));
        rings.setMatrixAt(i * 2 + 1, mat4(p.x, p.y0 + 0.3, p.z, { rx: Math.PI / 2 }));
      });
      void m;
      group.add(cols, rings);
    }
  }

  function buildFences() {
    const f = def.scenery?.fence || {};
    const glowy = !!f.glow;
    const spacing = 4;
    const lat = hw + FENCE_OFFSET;
    const posts = [];
    for (let s = 0; s < L - spacing * 0.5; s += spacing) {
      const fr = frames(path, s, s + 0.01, 1)[0];
      for (const side of [-1, 1]) {
        posts.push({ x: fr.x + fr.rx * lat * side, y: fr.y, z: fr.z + fr.rz * lat * side, h: Math.atan2(fr.tx, fr.tz), k: posts.length });
      }
    }
    const postH = 1.35;
    const postGeo = new THREE.CylinderGeometry(0.2, 0.24, postH, 6, 1, true);
    const postMat = glowy ? glow(0xffffff) : toon(0xffffff);
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    const cA = new THREE.Color(f.post ?? 0xffffff);
    const cB = new THREE.Color(f.postAlt ?? 0xff7fbf);
    posts.forEach((p, i) => {
      postMesh.setMatrixAt(i, mat4(p.x, p.y + postH / 2, p.z));
      postMesh.setColorAt(i, Math.floor(i / 2) % 2 ? cB : cA);
    });
    group.add(postMesh);

    // toppers
    let topGeo;
    const topper = f.topper || 'ball';
    if (topper === 'heart') topGeo = extruded(heartShape(), 0.3, 0, 3).scale(0.7, 0.7, 0.7);
    else if (topper === 'star') topGeo = extruded(starShape(5, 0.5, 0.22), 0.2, 0, 1);
    else if (topper === 'cane') {
      topGeo = new THREE.TorusGeometry(0.28, 0.12, 5, 8, Math.PI);
      topGeo.translate(0.28, 0, 0);
    } else if (topper === 'cherry') topGeo = new THREE.SphereGeometry(0.34, 8, 6);
    else topGeo = new THREE.SphereGeometry(0.3, 8, 6);
    const topMat = glowy ? own(new THREE.MeshBasicMaterial({ color: f.topperColor ?? 0xff4f9a })) : toon(f.topperColor ?? 0xff4f9a);
    const topMesh = new THREE.InstancedMesh(topGeo, topMat, posts.length);
    posts.forEach((p, i) => {
      topMesh.setMatrixAt(i, mat4(p.x, p.y + postH + 0.3, p.z, { ry: p.h + (i % 2 ? Math.PI / 2 : -Math.PI / 2) }));
    });
    group.add(topMesh);
    if (glowy) {
      animators.push((dt, t) => {
        topMat.color.setHSL(0.14 + Math.sin(t * 2) * 0.03, 1, 0.7 + Math.sin(t * 3) * 0.08);
      });
    }

    // rails: two soft bands
    const railGeos = [];
    for (const side of [-1, 1]) {
      for (const [y0, y1] of [[0.45, 0.7], [0.95, 1.2]]) {
        railGeos.push(wall(loopFrames, side * lat, (fr) => fr.y + y1, (fr) => fr.y + y0));
      }
    }
    const railMat = glowy
      ? own(new THREE.MeshBasicMaterial({ color: f.rail ?? 0x9ff7ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }))
      : own(toon(f.rail ?? 0xffa6d8, { unique: true, side: THREE.DoubleSide }));
    group.add(new THREE.Mesh(mergeGeometries(railGeos), railMat));
  }

  function buildStartArch() {
    const a = def.scenery?.arch || {};
    // checkered line
    const cells = Math.round(path.width / 1.5);
    const light = new THREE.Color(0xffffff);
    const dark = new THREE.Color(kind === 'galaxy' ? 0x1b1450 : 0x5b2d6e);
    const rows = [];
    for (let r = 0; r < 2; r++) {
      const s0 = -1.5 + r * 1.5;
      const fr = frames(path, s0, s0 + 1.5, 1.5);
      for (let c = 0; c < cells; c++) {
        const l0 = -hw + (c * path.width) / cells;
        const l1 = -hw + ((c + 1) * path.width) / cells;
        const col = (r + c) % 2 ? light : dark;
        rows.push(ribbon(fr, l0, l1, 0.05, { color: () => col }));
      }
    }
    const lineMat = night ? own(new THREE.MeshBasicMaterial({ vertexColors: true })) : toonVC();
    group.add(new THREE.Mesh(mergeGeometries(rows), lineMat));

    // the arch
    const p = path.pointAt(0);
    const h = path.headingAt(0);
    const arch = new THREE.Group();
    arch.position.copy(p);
    arch.rotation.y = h;
    group.add(arch);
    const span = hw + FENCE_OFFSET + 1.8;
    const pillarH = 11;
    const stripeTex = ownTex(stripeTexture(a.a ?? 0xff7fbf, a.b ?? 0xffffff, 6));
    stripeTex.repeat.set(1, 4);
    const pillarMat = night ? own(new THREE.MeshBasicMaterial({ map: stripeTex })) : toonTex(stripeTex);
    const pillarGeo = new THREE.CylinderGeometry(0.9, 1.05, pillarH, 16);
    for (const side of [-1, 1]) {
      const pm = new THREE.Mesh(pillarGeo, pillarMat);
      pm.position.set(side * span, pillarH / 2, 0);
      arch.add(pm);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), night ? glow(a.b ?? 0xfff27a) : toon(a.b ?? 0xffffff));
      ball.position.set(side * span, pillarH + 0.9, 0);
      arch.add(ball);
    }
    // curved top
    const bowGeo = new THREE.TorusGeometry(span, 0.7, 10, 40, Math.PI);
    const bow = new THREE.Mesh(bowGeo, night ? glow(a.a ?? 0x9f8cff) : toon(a.a ?? 0xff7fbf));
    bow.position.y = pillarH;
    bow.scale.y = 0.35;
    arch.add(bow);
    // banner
    const bannerW = span * 1.5, bannerH = 2.8;
    const bannerMat = bannerMaterial(a.text ?? 'SPRINKLE KART', a.banner ?? 0xff5fa8, night);
    const bannerGeo = new THREE.PlaneGeometry(bannerW, bannerH);
    for (const flip of [0, Math.PI]) {
      const b = new THREE.Mesh(bannerGeo, bannerMat);
      b.position.set(0, pillarH + 1.2, flip ? -0.05 : 0.05);
      b.rotation.y = flip;
      arch.add(b);
    }
    // balloons bobbing on the pillars
    const balloonColors = [0xff5fa8, 0x4fb3ff, 0xffd23f, 0x8be08b, 0xb57bff];
    const balloonGeo = new THREE.SphereGeometry(0.85, 14, 10);
    balloonGeo.scale(1, 1.2, 1);
    const balloons = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const bm = new THREE.Mesh(balloonGeo, night ? glow(balloonColors[(i + (side > 0 ? 2 : 0)) % 5]) : toon(balloonColors[(i + (side > 0 ? 2 : 0)) % 5]));
        const ang = (i / 4) * Math.PI * 2;
        const base = new THREE.Vector3(side * span + Math.cos(ang) * 1.1, pillarH + 3 + (i % 2) * 0.8, Math.sin(ang) * 1.1);
        bm.position.copy(base);
        arch.add(bm);
        balloons.push({ m: bm, base, ph: i + side * 3 });
      }
    }
    animators.push((dt, t) => {
      for (const b of balloons) {
        b.m.position.y = b.base.y + Math.sin(t * 1.6 + b.ph) * 0.25;
        b.m.rotation.z = Math.sin(t * 1.2 + b.ph) * 0.15;
      }
    });
  }

  function bannerMaterial(text, color, night) {
    const hex = '#' + new THREE.Color(color).getHexString();
    if (typeof document === 'undefined') {
      return own(night ? new THREE.MeshBasicMaterial({ color }) : toon(color, { unique: true }));
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 192;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = hex;
    roundRect(ctx, 6, 6, 1012, 180, 80);
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.font = 'bold 112px "Fredoka", "Baloo 2", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#3a2046';
    ctx.strokeText(text, 512, 102);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 512, 102);
    // little hearts at the ends
    ctx.fillStyle = '#ffe3f1';
    for (const x of [70, 954]) drawHeart(ctx, x, 96, 34);
    const tex = ownTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return own(new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  }

  function buildBoostPads(pads) {
    if (!pads.length) return;
    const plates = [];
    const chevrons = [[], [], []];
    const mapPt = (sc, lc, a, b, yOff, out) => {
      const s = sc + a;
      const fr = frames(path, s, s + 0.01, 1)[0];
      out.push(fr.x + fr.rx * (lc + b), fr.y + yOff, fr.z + fr.rz * (lc + b));
    };
    for (const pad of pads) {
      const fr = frames(path, pad.s - 3, pad.s + 3, 0.75);
      plates.push(ribbon(fr, pad.lateral - 2.5, pad.lateral + 2.5, 0.06));
      for (let k = 0; k < 3; k++) {
        const a0 = -1.9 + k * 1.7;
        const poly = [
          [a0, -2.1], [a0 + 1.2, 0], [a0 + 0.5, 0], [a0 - 0.7, -2.1],
          [a0 + 1.2, 0], [a0, 2.1], [a0 - 0.7, 2.1], [a0 + 0.5, 0],
        ];
        const arr = chevrons[k];
        for (let q = 0; q < 2; q++) {
          const [p0, p1, p2, p3] = poly.slice(q * 4, q * 4 + 4);
          for (const [a, b] of [p0, p1, p2, p0, p2, p3]) mapPt(pad.s, pad.lateral, a, b, 0.09, arr);
        }
      }
    }
    const plateMat = own(new THREE.MeshBasicMaterial({ color: 0xff9a3c }));
    group.add(new THREE.Mesh(mergeGeometries(plates), plateMat));
    const chevMats = [0, 1, 2].map(() => own(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })));
    chevrons.forEach((arr, k) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, chevMats[k]));
    });
    const cHot = new THREE.Color(0xffffff);
    const cWarm = new THREE.Color(0xffe066);
    const cPink = new THREE.Color(0xff6fb0);
    animators.push((dt, t) => {
      for (let k = 0; k < 3; k++) {
        const phase = (t * 3 - k * 0.33) % 1;
        const v = phase < 0 ? phase + 1 : phase;
        chevMats[k].color.copy(cPink).lerp(v < 0.5 ? cHot : cWarm, v < 0.5 ? 1 - v * 2 : (v - 0.5) * 2);
      }
      plateMat.color.setHSL(0.07 + Math.sin(t * 4) * 0.015, 1, 0.6);
    });
  }

  function buildClouds() {
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const mat = own(toon(0xffffff, { unique: true, emissive: 0xfff0fa, emissiveIntensity: 0.35 }));
    mat.fog = false;
    const count = 26;
    const perCloud = 6;
    const mesh = new THREE.InstancedMesh(puff, mat, count * perCloud);
    let k = 0;
    for (let c = 0; c < count; c++) {
      const ang = rng() * Math.PI * 2;
      const dist = 480 + rng() * 260;
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
      const cy = 110 + rng() * 150;
      const size = 14 + rng() * 14;
      for (let p = 0; p < perCloud; p++) {
        const ox = (p - perCloud / 2) * size * 0.55 + (rng() - 0.5) * size * 0.3;
        const oy = (rng() - 0.3) * size * 0.35;
        const r = size * (0.45 + rng() * 0.35) * (p === 2 || p === 3 ? 1.3 : 1);
        mesh.setMatrixAt(k++, mat4(cx + ox * Math.cos(ang + 1.57), cy + oy, cz + ox * Math.sin(ang + 1.57), { s: [r, r * 0.8, r] }));
      }
    }
    const cg = new THREE.Group();
    cg.position.set(center.x, 0, center.z);
    cg.add(mesh);
    group.add(cg);
    animators.push((dt) => { cg.rotation.y += dt * 0.004; });
  }

  // ----- shared scenery helpers ------------------------------------------

  /** Random points in the area that pass `ok(x,z)`. */
  function scatter(count, ok, { pad = 110, tries = 40, area } = {}) {
    const out = [];
    const minX = area ? area.minX : bounds.minX - pad, maxX = area ? area.maxX : bounds.maxX + pad;
    const minZ = area ? area.minZ : bounds.minZ - pad, maxZ = area ? area.maxZ : bounds.maxZ + pad;
    for (let n = 0; n < count * tries && out.length < count; n++) {
      const x = minX + rng() * (maxX - minX);
      const z = minZ + rng() * (maxZ - minZ);
      if (ok(x, z)) out.push([x, z]);
    }
    return out;
  }

  /** Candy-floss trees: stick + fluffy puffs, instanced. */
  function cottonCandyTrees(spots, palette, { stick = 0xfff2e0, puffScale = 1 } = {}) {
    if (!spots.length) return;
    const stickGeo = new THREE.CylinderGeometry(0.22, 0.3, 1, 6, 1, true);
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    const trees = [];
    for (const [x, z] of spots) {
      const h = 4 + rng() * 3.5;
      let sc = (1.2 + rng() * 0.9) * puffScale;
      const c = palette[Math.floor(rng() * palette.length)];
      const n = 3 + Math.floor(rng() * 3);
      // Keep canopies well clear of the chase cameras: shrink trees whose puffs
      // would reach within TREE_CAMERA_CLEARANCE of the fence, skip tiny ones.
      const room = distToRoad(x, z, hw + FENCE_OFFSET + 40) - (hw + FENCE_OFFSET + TREE_CAMERA_CLEARANCE);
      sc = Math.min(sc, room / CANOPY_REACH);
      if (sc < 0.7) continue;
      trees.push({ x, z, y: groundH(x, z), h, s: sc, c, n });
    }
    if (!trees.length) return;
    const sticks = new THREE.InstancedMesh(stickGeo, toon(stick), trees.length);
    const nPuffs = trees.reduce((a, t) => a + t.n, 0);
    // a soft pink glow keeps the undersides pastel instead of muddy grey-blue
    const puffs = new THREE.InstancedMesh(puffGeo, toon(0xffffff, { emissive: 0x6a3a66, emissiveIntensity: 0.45 }), nPuffs);
    const puffOut = new THREE.InstancedMesh(pushedCopy(puffGeo, 0.06), outlineMat, nPuffs);
    const col = new THREE.Color();
    let k = 0;
    trees.forEach((t, i) => {
      sticks.setMatrixAt(i, mat4(t.x, t.y + t.h / 2, t.z, { s: [t.s, t.h, t.s] }));
      for (let p = 0; p < t.n; p++) {
        const a = (p / t.n) * Math.PI * 2 + rng();
        const rr = p === 0 ? 0 : 1.1 * t.s;
        const r = (p === 0 ? 2.1 : 1.5 + rng() * 0.5) * t.s;
        const m = mat4(t.x + Math.cos(a) * rr, t.y + t.h + (p === 0 ? 0.9 * t.s : rng() * 0.8 * t.s), t.z + Math.sin(a) * rr, { s: [r, r * 0.9, r] });
        puffs.setMatrixAt(k, m);
        puffOut.setMatrixAt(k, m);
        col.set(t.c).offsetHSL(0, 0, (rng() - 0.5) * 0.06);
        puffs.setColorAt(k, col);
        k++;
      }
    });
    group.add(sticks, puffs, puffOut);
  }

  /** Floating hearts (or stars) that bob and spin. */
  function floatingShapes(geo, spots, palette, { yMin = 7, yMax = 20, scale = [1.2, 2.4], glowy = false } = {}) {
    const items = spots.map(([x, z]) => ({
      x, z, y: Math.max(groundH(x, z), 0) + yMin + rng() * (yMax - yMin),
      s: scale[0] + rng() * (scale[1] - scale[0]),
      ph: rng() * Math.PI * 2, spin: 0.4 + rng() * 0.8,
    }));
    const mat = glowy ? own(new THREE.MeshBasicMaterial({ color: 0xffffff })) : toon(0xffffff, { emissive: 0x552244, emissiveIntensity: 0.4 });
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const col = new THREE.Color();
    items.forEach((it, i) => mesh.setColorAt(i, col.set(palette[i % palette.length])));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sv = new THREE.Vector3();
    const update = (t) => {
      items.forEach((it, i) => {
        e.set(Math.sin(t + it.ph) * 0.15, t * it.spin + it.ph, 0);
        q.setFromEuler(e);
        v.set(it.x, it.y + Math.sin(t * 1.3 + it.ph) * 0.8, it.z);
        sv.setScalar(it.s);
        m.compose(v, q, sv);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    update(0);
    group.add(mesh);
    animators.push((dt, t) => update(t));
    return mesh;
  }

  /** Twinkling sparkle points around a centre. */
  function sparkles(n, cx, cz, radius, yMin, yMax, colors, size = 1.6) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius;
      pos[i * 3] = cx + Math.cos(a) * r;
      pos[i * 3 + 1] = yMin + rng() * (yMax - yMin);
      pos[i * 3 + 2] = cz + Math.sin(a) * r;
      c.set(colors[i % colors.length]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const tex = ownTex(sparkleTexture());
    const mat = own(new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
    const pts = new THREE.Points(g, mat);
    group.add(pts);
    animators.push((dt, t) => {
      mat.size = size * (0.8 + Math.sin(t * 3) * 0.25);
      mat.opacity = 0.75 + Math.sin(t * 5.3) * 0.25;
      pts.rotation.y = Math.sin(t * 0.05) * 0.05;
    });
    return pts;
  }

  /** Big soft background hills in a ring (instanced flattened spheres). */
  function backgroundHills(n, rMin, rMax, palette, { hMin = 30, hMax = 80, widthMul = 2.2 } = {}) {
    const geo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, toon(0xffffff), n);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.3;
      const r = rMin + rng() * (rMax - rMin);
      const h = hMin + rng() * (hMax - hMin);
      const w = h * (widthMul + rng());
      mesh.setMatrixAt(i, mat4(center.x + Math.cos(a) * r, -1, center.z + Math.sin(a) * r, { s: [w, h, w * 0.8], ry: a }));
      mesh.setColorAt(i, col.set(palette[i % palette.length]));
    }
    group.add(mesh);
    return mesh;
  }

  /** Giant swirl lollipops. */
  function lollipops(spots, pairs, { height = [5, 8], radius = [1.6, 2.6] } = {}) {
    if (!spots.length) return;
    const stickGeo = new THREE.CylinderGeometry(0.2, 0.2, 1, 8);
    const discGeo = new THREE.CylinderGeometry(1, 1, 0.5, 28);
    discGeo.rotateX(Math.PI / 2);
    const sticks = new THREE.InstancedMesh(stickGeo, toon(0xffffff), spots.length);
    const byColor = pairs.map(() => []);
    spots.forEach(([x, z], i) => {
      const y = groundH(x, z);
      const h = height[0] + rng() * (height[1] - height[0]);
      const r = radius[0] + rng() * (radius[1] - radius[0]);
      sticks.setMatrixAt(i, mat4(x, y + h / 2, z, { s: [1, h, 1] }));
      byColor[i % pairs.length].push(mat4(x, y + h + r * 0.8, z, { s: r, ry: rng() * Math.PI }));
    });
    group.add(sticks);
    pairs.forEach(([c1, c2], k) => {
      if (!byColor[k].length) return;
      const tex = ownTex(swirlTexture(c1, c2));
      const m = new THREE.InstancedMesh(discGeo, toonTex(tex), byColor[k].length);
      const o = new THREE.InstancedMesh(pushedCopy(discGeo, 0.07), outlineMat, byColor[k].length);
      byColor[k].forEach((mm, i) => { m.setMatrixAt(i, mm); o.setMatrixAt(i, mm); });
      group.add(m, o);
    });
  }

  /** A pink cone-roofed tower (added to the batch). */
  function tower(x, y, z, r, h, { wall = 0xfff6fb, roof = 0xff8fc4, trim = 0xff5fa8, roofH = r * 2.2, flag = true, windows = true } = {}) {
    batch.add(new THREE.CylinderGeometry(r, r * 1.06, h, 20), toon(wall), mat4(x, y + h / 2, z));
    batch.add(new THREE.TorusGeometry(r * 1.02, 0.28, 8, 24), toon(trim), mat4(x, y + h, z, { rx: Math.PI / 2 }), false);
    batch.add(new THREE.ConeGeometry(r * 1.3, roofH, 20), toon(roof), mat4(x, y + h + roofH / 2, z));
    if (windows) {
      const win = new THREE.ShapeGeometry(archShape(r * 0.45, r * 0.8));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.4;
        batch.add(win, glow(0xbfe6ff), mat4(x + Math.sin(a) * (r + 0.05), y + h * 0.62, z + Math.cos(a) * (r + 0.05), { ry: a }), false);
      }
    }
    if (flag) heartFlag(x, y + h + roofH, z);
  }

  function heartFlag(x, y, z, color = 0xff4f9a) {
    batch.add(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), toon(0xffe08a), mat4(x, y + 1.3, z), false);
    const m = new THREE.Mesh(flagGeo, toon(color, { side: THREE.DoubleSide }));
    m.position.set(x, y + 2.3, z);
    m.scale.setScalar(1.6);
    group.add(m);
    flags.push({ m, ph: rng() * 6 });
  }

  // =========================================================================
  // Cotton Candy Castle
  // =========================================================================
  function buildCastleWorld() {
    const c = def.scenery.castle;
    const [cx, cz] = c.center;
    // island courtyard + moat of strawberry milk
    const island = new THREE.Mesh(new THREE.CircleGeometry(c.moatInner, 64), own(toon(0xfff6e6, { unique: true })));
    island.rotation.x = -Math.PI / 2;
    island.position.set(cx, -0.04, cz);
    group.add(island);
    // checker plaza in front of the doors
    const plazaTiles = [];
    for (let i = -3; i <= 3; i++) for (let j = 0; j < 4; j++) {
      const g = new THREE.PlaneGeometry(2.4, 2.4);
      g.rotateX(-Math.PI / 2);
      g.translate(cx + i * 2.4, -0.02, cz + 11.2 + j * 2.4);
      plazaTiles.push({ g, dark: (i + j) % 2 === 0 });
    }
    batch.add(mergeGeometries(plazaTiles.filter((p) => p.dark).map((p) => p.g)), toon(0xffc2df), new THREE.Matrix4(), false);
    batch.add(mergeGeometries(plazaTiles.filter((p) => !p.dark).map((p) => p.g)), toon(0xffffff), new THREE.Matrix4(), false);

    const water = new THREE.Mesh(new THREE.RingGeometry(c.moatInner - 0.5, c.moatOuter + 0.5, 96, 1), own(toon(0xff9cc8, { unique: true, emissive: 0xff7fb6, emissiveIntensity: 0.3 })));
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, -0.75, cz);
    group.add(water);
    const shimmerMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    const shimmer = new THREE.Mesh(new THREE.RingGeometry((c.moatInner + c.moatOuter) / 2 - 1.2, (c.moatInner + c.moatOuter) / 2 + 1.2, 96, 1), shimmerMat);
    shimmer.rotation.x = -Math.PI / 2;
    shimmer.position.set(cx, -0.72, cz);
    group.add(shimmer);
    animators.push((dt, t) => {
      shimmerMat.opacity = 0.18 + Math.sin(t * 1.7) * 0.12;
      shimmer.scale.setScalar(1 + Math.sin(t * 0.9) * 0.02);
    });
    const bankMat = own(toon(0xffe3ef, { unique: true, side: THREE.DoubleSide }));
    for (const r of [c.moatInner, c.moatOuter]) {
      const bank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.7, 96, 1, true), bankMat);
      bank.position.set(cx, -0.8, cz);
      group.add(bank);
      const icing = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 8, 120), toon(0xffffff));
      icing.rotation.x = Math.PI / 2;
      icing.position.set(cx, 0.02, cz);
      group.add(icing);
    }
    // marshmallow hearts floating in the moat
    const heartGeo = extruded(heartShape(), 0.35, 0.1, 5);
    const moatSpots = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
      const r = (c.moatInner + c.moatOuter) / 2 + (rng() - 0.5) * 4;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (clearOfRoad(x, z, 1)) moatSpots.push({ x, z, a, ph: rng() * 6 });
    }
    const floaters = new THREE.InstancedMesh(heartGeo, toon(0xffffff), moatSpots.length);
    const fcol = new THREE.Color();
    moatSpots.forEach((s, i) => floaters.setColorAt(i, fcol.set([0xffffff, 0xffd1e8, 0xff9ccc][i % 3])));
    group.add(floaters);
    animators.push((dt, t) => {
      moatSpots.forEach((s, i) => {
        floaters.setMatrixAt(i, mat4(s.x, -0.55 + Math.sin(t * 1.5 + s.ph) * 0.12, s.z, { rx: -Math.PI / 2 + 0.25, ry: s.a + t * 0.2, s: 1.3 }));
      });
      floaters.instanceMatrix.needsUpdate = true;
    });

    buildKeep(cx, cz);
    buildGatehouses();
    buildRainbowBridges();

    // small towers around the island edge (where there's room)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = cx + Math.cos(a) * (c.moatInner - 7), z = cz + Math.sin(a) * (c.moatInner - 7);
      if (!clearOfRoad(x, z, FENCE_OFFSET + 6)) continue;
      tower(x, 0, z, 2.8, 10 + (i % 3) * 2, { roofH: 6.5 });
    }
    // heart hedges around the keep
    const hedgeSpots = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = cx + Math.cos(a) * 30, z = cz + Math.sin(a) * 26;
      if (clearOfRoad(x, z, FENCE_OFFSET + 3)) hedgeSpots.push([x, z]);
    }
    const hedgeGeo = new THREE.SphereGeometry(1.6, 12, 10);
    hedgeSpots.forEach(([x, z], i) => batch.add(hedgeGeo, toon(i % 2 ? 0x9fe3b0 : 0xffb3d9), mat4(x, 0.9, z, { s: [1.3, 1, 1.3] })));

    // cotton-candy forest
    const castleClear = (x, z) => {
      const r = Math.hypot(x - cx, z - cz);
      if (r < 24) return false;
      if (r > c.moatInner - 5 && r < c.moatOuter + 6) return false;
      return clearOfRoad(x, z, FENCE_OFFSET + 4);
    };
    const treeSpots = scatter(190, (x, z) => {
      if (!castleClear(x, z)) return false;
      // clumpy: prefer places where a soft noise is high
      const n = Math.sin(x * 0.045) * Math.cos(z * 0.05) + Math.sin((x + z) * 0.02);
      return n > -0.2 || rng() < 0.25;
    }, { pad: 140 });
    cottonCandyTrees(treeSpots, [0xffa6d8, 0xa8d8ff, 0xd6b8ff, 0xffc7e6, 0xbfe9ff]);
    // low cotton-candy fluff clouds sitting on the ground along the course
    const fluffGeo = new THREE.IcosahedronGeometry(1, 1);
    const fluffCols = [0xffb3dc, 0xbfe3ff, 0xffd1ec, 0xd9c8ff, 0xffffff];
    for (const [x, z] of scatter(90, (x, z) => castleClear(x, z) && distToRoad(x, z, hw + 50) < hw + 40, { pad: 40 })) {
      const n = 3 + Math.floor(rng() * 3);
      const base = groundH(x, z);
      const col = fluffCols[Math.floor(rng() * fluffCols.length)];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rng();
        const rr = k === 0 ? 0 : 1.2 + rng() * 0.8;
        const r = k === 0 ? 1.8 + rng() * 0.6 : 1.1 + rng() * 0.6;
        batch.add(fluffGeo, toon(k % 2 && col !== 0xffffff ? 0xffffff : col),
          mat4(x + Math.cos(a) * rr, base + r * 0.45, z + Math.sin(a) * rr, { s: [r, r * 0.8, r] }));
      }
    }
    // pink turret gazebos near the far end of the lap, so the castle look carries on
    let far = 0;
    let farD = -1;
    for (let i = 0; i < 200; i++) {
      const p = path.positionAt((i / 200) * path.length, 0);
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d > farD) { farD = d; far = (i / 200) * path.length; }
    }
    let turrets = 0;
    for (const [ds, side, off] of [[-40, 1, 13], [-10, -1, 15], [18, 1, 14], [40, -1, 12], [0, 1, 26], [-25, -1, 24]]) {
      if (turrets >= 4) break;
      const p = path.positionAt(path.wrap(far + ds), side * (hw + FENCE_OFFSET + off));
      if (!clearOfRoad(p.x, p.z, FENCE_OFFSET + 7)) continue;
      const g = groundH(p.x, p.z);
      tower(p.x, g, p.z, 2.4 + (turrets % 2) * 0.6, 8 + (turrets % 3) * 2.5, { roofH: 5.5, roof: turrets % 2 ? 0xc9a6ff : 0xff8fc4 });
      turrets++;
    }
    lollipops(scatter(18, (x, z) => castleClear(x, z) && distToRoad(x, z) < hw + 22, { pad: 40 }),
      [[0xff4f9a, 0xffffff], [0x4fb3ff, 0xffffff], [0xb57bff, 0xfff0a8]]);
    floatingShapes(extruded(heartShape(), 0.35, 0.1, 5), scatter(42, (x, z) => Math.hypot(x - cx, z - cz) < 190, { pad: 20 }),
      [0xff5fa8, 0xff9ccc, 0xffffff, 0xff3b7f, 0xffc2e0], { yMin: 9, yMax: 26 });
    sparkles(520, cx, cz, 120, 2, 40, [0xffffff, 0xffe3f1, 0xfff7b0, 0xd6f0ff], 1.8);
    backgroundHills(20, extent + 280, extent + 420, [0xffc9e6, 0xd8c8ff, 0xc6f2dc, 0xffe0f0], { hMin: 30, hMax: 70 });
  }

  function buildKeep(cx, cz) {
    const W = 0xfff6fb, ROOF = 0xff7fbf, TRIM = 0xff5fa8, GOLD = 0xffd35c;
    const bx = cx, bz = cz - 2;
    // main hall
    batch.add(new THREE.BoxGeometry(26, 14, 18), toon(W), mat4(bx, 7, bz));
    batch.add(new THREE.BoxGeometry(27, 1, 19), toon(TRIM), mat4(bx, 14.2, bz), false);
    batch.add(new THREE.BoxGeometry(27.4, 1.2, 19.4), toon(0xffd1e8), mat4(bx, 0.6, bz), false);
    const roof = new THREE.ConeGeometry(1, 1, 4);
    roof.rotateY(Math.PI / 4);
    batch.add(roof, toon(ROOF), mat4(bx, 18.8, bz, { s: [19.5, 8.5, 13.8] }));
    // crenellations
    const cren = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    for (let i = -6; i <= 6; i += 2) {
      batch.add(cren, toon(W), mat4(bx + i * 2, 15.3, bz + 9.2), false);
    }
    // central tower
    batch.add(new THREE.CylinderGeometry(5.6, 6, 20, 28), toon(W), mat4(bx, 22, bz));
    batch.add(new THREE.TorusGeometry(5.7, 0.4, 8, 32), toon(TRIM), mat4(bx, 32, bz, { rx: Math.PI / 2 }), false);
    batch.add(new THREE.ConeGeometry(7.4, 14, 28), toon(ROOF), mat4(bx, 39, bz));
    // gold heart spire
    const heartGeo = extruded(heartShape(), 0.4, 0.08);
    batch.add(new THREE.CylinderGeometry(0.2, 0.2, 3, 8), toon(GOLD), mat4(bx, 47, bz), false);
    batch.add(heartGeo, toon(GOLD), mat4(bx, 49.4, bz, { s: 2.6 }));
    // stained-glass heart window on the central tower
    const hz = bz + 6.05;
    const hs = heartShape();
    const flat = new THREE.ShapeGeometry(hs, 16);
    batch.add(flat, toon(GOLD), mat4(bx, 24, hz, { s: 7.6 }), false);
    batch.add(flat, glow(0xff5fa8), mat4(bx, 24, hz + 0.05, { s: 6.6 }), false);
    batch.add(flat, glow(0x9fd8ff), mat4(bx, 24.2, hz + 0.1, { s: 4.8 }), false);
    batch.add(flat, glow(0xffe066), mat4(bx, 24.3, hz + 0.13, { s: 3.2 }), false);
    batch.add(flat, glow(0xff3b7f), mat4(bx, 24.4, hz + 0.16, { s: 1.8 }), false);
    batch.add(new THREE.CircleGeometry(0.45, 12), glow(0xffffff), mat4(bx - 0.9, 25.3, hz + 0.2), false);
    // glass "lead" lines
    for (const a of [-0.9, 0, 0.9]) {
      batch.add(new THREE.PlaneGeometry(0.2, 6.6), toon(GOLD), mat4(bx, 24.1, hz + 0.19, { rz: a }), false);
    }
    // big front doors
    const doorShape = archShape(6, 8.5);
    batch.add(new THREE.ShapeGeometry(archShape(7.6, 9.8)), toon(GOLD), mat4(bx, 1.2, bz + 9.03), false);
    batch.add(new THREE.ShapeGeometry(doorShape), toon(0x9a5a44), mat4(bx, 1.2, bz + 9.06), false);
    batch.add(new THREE.PlaneGeometry(0.16, 8.3), toon(0x6e3b2c), mat4(bx, 5.3, bz + 9.09), false);
    batch.add(new THREE.SphereGeometry(0.3, 10, 8), toon(GOLD), mat4(bx - 0.6, 4.6, bz + 9.2), false);
    batch.add(new THREE.SphereGeometry(0.3, 10, 8), toon(GOLD), mat4(bx + 0.6, 4.6, bz + 9.2), false);
    batch.add(flat, toon(0xff5fa8), mat4(bx, 8.2, bz + 9.1, { s: 1.4 }), false);
    // steps and pink carpet to the road
    for (let i = 0; i < 3; i++) {
      batch.add(new THREE.BoxGeometry(10 - i * 1.2, 0.4, 1.2), toon(0xffe3ef), mat4(bx, 0.2 + i * 0.4, bz + 10.2 - i * 0.9 + 0.6));
    }
    // round windows on the hall
    const win = new THREE.ShapeGeometry(archShape(1.8, 3.2));
    for (const x of [-9, -5, 5, 9]) {
      batch.add(win, glow(0xbfe6ff), mat4(bx + x, 8.5, bz + 9.03), false);
      batch.add(flat, glow(0xff9ccc), mat4(bx + x, 12, bz + 9.03, { s: 0.9 }), false);
    }
    // corner towers
    for (const [dx, dz, h] of [[-13.5, 9, 20], [13.5, 9, 20], [-13.5, -9, 17], [13.5, -9, 17]]) {
      tower(bx + dx, 0, bz + dz, 3.8, h, { roof: ROOF, trim: TRIM, roofH: 9 });
    }
    // little balcony + flags on the central tower
    heartFlag(bx, 46, bz, 0xff4f9a);
  }

  function buildGatehouses() {
    const gates = def.scenery.gates || [];
    for (const f of gates) {
      const s = f * L;
      const p = path.pointAt(s);
      const h = path.headingAt(s);
      const r = path.rightAt(s);
      const t = path.tangentAt(s);
      const off = hw + FENCE_OFFSET + 3.8;
      for (const side of [-1, 1]) {
        tower(p.x + r.x * off * side, p.y, p.z + r.z * off * side, 3.5, 15, { roofH: 8 });
        // open doors swung against the walls
        const dx = p.x + r.x * (hw + FENCE_OFFSET - 0.6) * side - t.x * 4.2;
        const dz = p.z + r.z * (hw + FENCE_OFFSET - 0.6) * side - t.z * 4.2;
        batch.add(new THREE.BoxGeometry(0.5, 9, 5.6), toon(0x9a5a44), mat4(dx, p.y + 4.5, dz, { ry: h }));
        batch.add(new THREE.BoxGeometry(0.6, 0.5, 5.8), toon(0xffd35c), mat4(dx, p.y + 2.5, dz, { ry: h }), false);
        batch.add(new THREE.BoxGeometry(0.6, 0.5, 5.8), toon(0xffd35c), mat4(dx, p.y + 6.8, dz, { ry: h }), false);
      }
      // the arch beam across the road
      const span = off * 2;
      batch.add(new THREE.BoxGeometry(span, 3, 3.4), toon(0xfff6fb), mat4(p.x, p.y + 13.6, p.z, { ry: h }));
      batch.add(new THREE.BoxGeometry(span + 0.4, 0.6, 3.8), toon(0xff5fa8), mat4(p.x, p.y + 12, p.z, { ry: h }), false);
      const cren = new THREE.BoxGeometry(1.3, 1.3, 3.4);
      for (let k = -6; k <= 6; k++) {
        if (k % 2) continue;
        const lx = (k / 13) * span;
        batch.add(cren, toon(0xfff6fb), mat4(p.x - r.x * lx, p.y + 15.7, p.z - r.z * lx, { ry: h }), false);
      }
      const heart = extruded(heartShape(), 0.3, 0.06);
      for (const flip of [1, -1]) {
        batch.add(heart, glow(0xff4f9a), mat4(p.x + t.x * 1.85 * flip, p.y + 13.7, p.z + t.z * 1.85 * flip, { ry: h + (flip < 0 ? Math.PI : 0), s: 2.4 }), false);
      }
      // bunting under the beam
      const bunt = new THREE.ConeGeometry(0.6, 1.4, 3);
      bunt.rotateZ(Math.PI);
      const colors = [0xff5fa8, 0xffffff, 0x9fd8ff, 0xffe066];
      for (let k = 0; k < 14; k++) {
        const lx = -span / 2 + 2 + (k / 13) * (span - 4);
        const sag = Math.sin((k / 13) * Math.PI) * 1.4;
        batch.add(bunt, toon(colors[k % 4]), mat4(p.x - r.x * lx, p.y + 11 - sag, p.z - r.z * lx, { ry: h }), false);
      }
    }
  }

  function buildRainbowBridges() {
    const bridges = def.scenery.bridges || [];
    const rainbow = [0xff6f91, 0xffa94d, 0xffe066, 0x8ce99a, 0x74c0fc, 0x9775fa, 0xf783ac];
    for (const [a, b] of bridges) {
      const s0 = a * L, s1 = b * L;
      const fr = frames(path, s0, s1, 1);
      // rainbow deck stripes
      const band = path.width / rainbow.length;
      const deck = rainbow.map((col, k) => ribbon(fr, -hw + k * band, -hw + (k + 1) * band, 0.045, { color: () => new THREE.Color(col) }));
      const deckMat = toonVC();
      const deckMesh = new THREE.Mesh(mergeGeometries(deck), deckMat);
      // blend the rainbow onto the road a little translucently
      deckMat.transparent = true;
      deckMat.opacity = 0.62;
      deckMat.depthWrite = false;
      deckMesh.renderOrder = 1;
      group.add(deckMesh);
      // a rainbow arching over the road at the bridge centre
      const sm = (s0 + s1) / 2;
      const p = path.pointAt(sm);
      const h = path.headingAt(sm);
      const rg = new THREE.Group();
      rg.position.copy(p);
      rg.rotation.y = h;
      rainbow.forEach((col, k) => {
        const radius = hw + FENCE_OFFSET + 6.5 - k * 0.9;
        const m = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.48, 8, 48, Math.PI), glow(col));
        rg.add(m);
      });
      // fluffy clouds at the rainbow's feet
      const puff = new THREE.IcosahedronGeometry(1, 2);
      for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const m = new THREE.Mesh(puff, toon(0xffffff));
          m.position.set(side * (hw + FENCE_OFFSET + 3.4) + (k - 1.5) * 1.2, 0.8 + (k % 2) * 0.8, (k - 1.5) * 1.1);
          m.scale.setScalar(1.6 + (k % 2) * 0.5);
          rg.add(m);
        }
      }
      group.add(rg);
      // heart lamp posts at both ends of the bridge
      for (const s of [s0, s1]) {
        const q = path.pointAt(s);
        const r = path.rightAt(s);
        for (const side of [-1, 1]) {
          const off = hw + FENCE_OFFSET + 1.2;
          const x = q.x + r.x * off * side, z = q.z + r.z * off * side;
          const gy = Math.max(groundH(x, z), 0);
          batch.add(new THREE.CylinderGeometry(0.25, 0.35, 5 + q.y - gy, 8), toon(0xffffff), mat4(x, gy + (5 + q.y - gy) / 2, z));
          batch.add(new THREE.SphereGeometry(0.8, 12, 10), glow(0xffd1e8), mat4(x, q.y + 5.4, z), false);
        }
      }
    }
  }

  // =========================================================================
  // Gumdrop Meadow
  // =========================================================================
  function buildMeadowWorld() {
    const gumColors = [0xff4d5e, 0xff9f40, 0xffd93d, 0x6bd968, 0xb06bff, 0xff7ac8, 0x4fc3ff];
    const domeGeo = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const place = (spots, rMin, rMax) => spots.map(([x, z]) => ({ x, z, y: groundH(x, z) - 0.3, r: rMin + rng() * (rMax - rMin) }));
    const small = place(scatter(170, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 3), { pad: 150 }), 1.2, 3.2);
    const big = [];
    for (const [x, z] of scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 18), { pad: 100 })) {
      const r = 7 + rng() * 9;
      if (clearOfRoad(x, z, FENCE_OFFSET + r + 2)) big.push({ x, z, y: groundH(x, z) - 0.6, r });
      if (big.length >= 14) break;
    }
    const all = [...small, ...big];
    const gums = new THREE.InstancedMesh(domeGeo, toon(0xffffff, { emissive: 0x222222, emissiveIntensity: 0.3 }), all.length);
    const gOut = new THREE.InstancedMesh(pushedCopy(domeGeo, 0.05), outlineMat, all.length);
    const col = new THREE.Color();
    all.forEach((g, i) => {
      const m = mat4(g.x, g.y, g.z, { s: [g.r, g.r * 1.15, g.r] });
      gums.setMatrixAt(i, m);
      gOut.setMatrixAt(i, m);
      gums.setColorAt(i, col.set(gumColors[i % gumColors.length]));
    });
    group.add(gums, gOut);
    // sugar sparkle dots on gumdrops
    const sugar = [];
    all.forEach((g) => {
      const n = Math.min(10, Math.round(g.r * 2));
      for (let k = 0; k < n; k++) {
        const a = rng() * Math.PI * 2, el = rng() * 1.2 + 0.1;
        sugar.push(mat4(g.x + Math.cos(a) * Math.cos(el) * g.r, g.y + Math.sin(el) * g.r * 1.15, g.z + Math.sin(a) * Math.cos(el) * g.r, { s: 0.12 * Math.max(1, g.r * 0.4) }));
      }
    });
    const sugarMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), glow(0xffffff), sugar.length);
    sugar.forEach((m, i) => sugarMesh.setMatrixAt(i, m));
    group.add(sugarMesh);

    lollipops(scatter(46, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 3), { pad: 120 }),
      [[0xff4d5e, 0xffffff], [0x4fc3ff, 0xfff3a8], [0xb06bff, 0xffc2f0], [0x6bd968, 0xffffff]],
      { height: [5, 9], radius: [1.8, 3] });

    // giant candy canes
    const caneTex = ownTex(stripeTexture(0xff3b4f, 0xffffff, 6));
    caneTex.repeat.set(10, 1);
    const caneMat = toonTex(caneTex);
    const caneSpots = scatter(22, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5), { pad: 90 });
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 6, 0), new THREE.Vector3(0, 8, 0),
      new THREE.Vector3(0.9, 9.3, 0), new THREE.Vector3(2, 8.8, 0), new THREE.Vector3(2.4, 7.6, 0),
    ]);
    const caneGeo = new THREE.TubeGeometry(curve, 24, 0.45, 7, false);
    const canes = new THREE.InstancedMesh(caneGeo, caneMat, caneSpots.length);
    const caneOut = new THREE.InstancedMesh(pushedCopy(caneGeo, 0.06), outlineMat, caneSpots.length);
    caneSpots.forEach(([x, z], i) => {
      const m = mat4(x, groundH(x, z) - 0.2, z, { ry: rng() * Math.PI * 2, s: 0.8 + rng() * 0.6 });
      canes.setMatrixAt(i, m);
      caneOut.setMatrixAt(i, m);
    });
    group.add(canes, caneOut);

    // flowers near the road
    const flowerSpots = scatter(420, (x, z) => {
      const d = distToRoad(x, z, 60);
      return d > hw + FENCE_OFFSET + 1.5 && d < hw + 45;
    }, { pad: 60 });
    const stem = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 5);
    const head = new THREE.IcosahedronGeometry(0.32, 0);
    const stems = new THREE.InstancedMesh(stem, toon(0x4caf50), flowerSpots.length);
    const heads = new THREE.InstancedMesh(head, toon(0xffffff), flowerSpots.length);
    const fc = [0xff7ac8, 0xffffff, 0xffe14f, 0xb06bff, 0x4fc3ff, 0xff9f40];
    flowerSpots.forEach(([x, z], i) => {
      const y = groundH(x, z);
      stems.setMatrixAt(i, mat4(x, y + 0.4, z));
      heads.setMatrixAt(i, mat4(x, y + 0.85, z, { s: [1, 0.6, 1] }));
      heads.setColorAt(i, col.set(fc[i % fc.length]));
    });
    group.add(stems, heads);

    // gumdrop "cottage" and bunnies of the meadow: a gingerbread hut in the heart
    const [hx, hz] = def.scenery.center || [center.x, center.z];
    if (clearOfRoad(hx, hz, 30)) buildGingerHouse(hx, hz, groundH(hx, hz));

    // a big rainbow in the sky and soft green background hills
    const rb = new THREE.Group();
    const rainbow = [0xff6f91, 0xffa94d, 0xffe066, 0x8ce99a, 0x74c0fc, 0x9775fa];
    rainbow.forEach((c2, k) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(260 - k * 9, 4.4, 8, 64, Math.PI), own(new THREE.MeshBasicMaterial({ color: c2, transparent: true, opacity: 0.55, fog: false, depthWrite: false })));
      rb.add(m);
    });
    rb.position.set(center.x - 120, -20, center.z - extent - 330);
    rb.rotation.y = 0.35;
    group.add(rb);
    backgroundHills(22, extent + 260, extent + 420, [0x7fd67a, 0xa8ec8a, 0x6cc56a, 0xc6f59a], { hMin: 30, hMax: 70 });
    floatingShapes(extruded(heartShape(), 0.3, 0.08, 5), scatter(18, () => true, { pad: 10 }), [0xff7ac8, 0xffffff, 0xffe14f], { yMin: 12, yMax: 26, scale: [1, 1.8] });
    sparkles(260, center.x, center.z, extent + 40, 3, 25, [0xffffff, 0xfff7b0], 1.3);
  }

  function buildGingerHouse(x, z, y) {
    const G = 0xc98a4b, ICING = 0xffffff;
    batch.add(new THREE.BoxGeometry(12, 8, 10), toon(G), mat4(x, y + 4, z));
    const roof = new THREE.CylinderGeometry(1, 1, 1, 3);
    roof.rotateX(-Math.PI / 2); // triangular prism, ridge along z, apex up
    batch.add(roof, toon(0xff7ac8), mat4(x, y + 10.4, z, { s: [8, 5, 11.4] }));
    batch.add(new THREE.BoxGeometry(12.4, 0.6, 10.4), toon(ICING), mat4(x, y + 8.1, z), false);
    batch.add(new THREE.ShapeGeometry(archShape(3, 5)), toon(0x7a4a33), mat4(x, y, z + 5.03), false);
    for (const dx of [-3.8, 3.8]) {
      batch.add(new THREE.PlaneGeometry(2.2, 2.2), glow(0xfff1a8), mat4(x + dx, y + 4.5, z + 5.03), false);
    }
    const drops = new THREE.SphereGeometry(0.45, 8, 6);
    for (let i = -5; i <= 5; i++) batch.add(drops, toon([0xff4d5e, 0x6bd968, 0xffd93d, 0x4fc3ff][(i + 5) % 4]), mat4(x + i * 1.1, y + 8.6, z + 5.2), false);
    batch.add(new THREE.BoxGeometry(1.6, 4, 1.6), toon(0xff4d5e), mat4(x + 3.5, y + 12, z - 1.5));
    heartFlag(x + 3.5, y + 14, z - 1.5, 0xff4d5e);
  }

  // =========================================================================
  // Starlight Galaxy
  // =========================================================================
  function buildGalaxyWorld() {
    const [gx, gz] = def.scenery.center || [center.x, center.z];
    // a sea of purple clouds far below
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const cloudCount = 200;
    const cloudMat = toon(0xffffff, { emissive: 0x2a1060, emissiveIntensity: 0.6 });
    const clouds = new THREE.InstancedMesh(puff, cloudMat, cloudCount);
    const col = new THREE.Color();
    const cc = [0x8a5cff, 0xb57bff, 0xff8ce6, 0x6a4cff, 0x9f8cff];
    for (let i = 0; i < cloudCount; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (extent + 420);
      const s = 18 + rng() * 30;
      clouds.setMatrixAt(i, mat4(center.x + Math.cos(a) * r, -70 - rng() * 25, center.z + Math.sin(a) * r, { s: [s * 1.6, s * 0.7, s * 1.6] }));
      clouds.setColorAt(i, col.set(cc[i % cc.length]));
    }
    group.add(clouds);

    // floating star-crystal islands under the road
    const rock = new THREE.ConeGeometry(1, 1, 6);
    rock.rotateX(Math.PI);
    const islands = [];
    for (let s = 20; s < L; s += 70) {
      const p = path.pointAt(s);
      islands.push({ x: p.x, y: p.y - 3.4, z: p.z, r: 6 + rng() * 3 });
    }
    const isl = new THREE.InstancedMesh(rock, toon(0x5a3aa8), islands.length);
    islands.forEach((it, i) => isl.setMatrixAt(i, mat4(it.x, it.y - it.r * 0.6, it.z, { s: [it.r, it.r * 1.3, it.r], ry: rng() })));
    group.add(isl);
    const crystalGeo = new THREE.OctahedronGeometry(1, 0);
    const crystals = [];
    islands.forEach((it) => {
      for (let k = 0; k < 3; k++) {
        const a = rng() * Math.PI * 2;
        crystals.push({ x: it.x + Math.cos(a) * it.r * 0.8, y: it.y - it.r * 0.3 - rng() * 3, z: it.z + Math.sin(a) * it.r * 0.8, s: 0.8 + rng() * 1.2, c: [0x7ff5ff, 0xff9ce8, 0xfff27a][k] });
      }
    });
    const cr = new THREE.InstancedMesh(crystalGeo, own(new THREE.MeshBasicMaterial({ color: 0xffffff })), crystals.length);
    crystals.forEach((c2, i) => {
      cr.setMatrixAt(i, mat4(c2.x, c2.y, c2.z, { s: [c2.s * 0.6, c2.s * 1.4, c2.s * 0.6] }));
      cr.setColorAt(i, col.set(c2.c));
    });
    group.add(cr);

    // planets
    const planets = [
      { d: [260, 90, -180], r: 45, c: 0xff9ce8, ring: 0xfff27a, face: true },
      { d: [-300, 140, 120], r: 60, c: 0x7fd3ff, ring: 0xb57bff },
      { d: [120, 200, 380], r: 34, c: 0xffc46b, ring: null },
      { d: [-160, 60, -360], r: 26, c: 0x9ff7a8, ring: 0xffffff },
      { d: [420, 170, 220], r: 22, c: 0xd8b8ff, ring: null },
    ];
    for (const pl of planets) {
      const x = center.x + pl.d[0] * 1.45, y = pl.d[1] * 1.3, z = center.z + pl.d[2] * 1.45;
      const pm = own(toon(pl.c, { unique: true, emissive: pl.c, emissiveIntensity: 0.25 }));
      pm.fog = false;
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(pl.r, 36, 24), pm);
      sphere.position.set(x, y, z);
      group.add(sphere);
      if (pl.ring) {
        const rmat = own(new THREE.MeshBasicMaterial({ color: pl.ring, transparent: true, opacity: 0.7, side: THREE.DoubleSide, fog: false }));
        const ring = new THREE.Mesh(new THREE.RingGeometry(pl.r * 1.35, pl.r * 1.9, 64), rmat);
        ring.position.copy(sphere.position);
        ring.rotation.set(-Math.PI / 2 + 0.4, 0.3, 0);
        group.add(ring);
      }
      if (pl.face) {
        // a sleepy smiling planet face, turned toward the track
        const face = new THREE.Group();
        face.position.copy(sphere.position);
        face.lookAt(center.x, 10, center.z);
        const fm = own(new THREE.MeshBasicMaterial({ color: 0x3a2046, fog: false }));
        for (const ex of [-0.33, 0.33]) {
          const eye = new THREE.Mesh(new THREE.TorusGeometry(pl.r * 0.1, pl.r * 0.025, 6, 16, Math.PI), fm);
          eye.position.set(ex * pl.r, pl.r * 0.15, pl.r * 0.96);
          eye.rotation.z = Math.PI;
          face.add(eye);
        }
        const smile = new THREE.Mesh(new THREE.TorusGeometry(pl.r * 0.22, pl.r * 0.03, 6, 20, Math.PI), fm);
        smile.position.set(0, -pl.r * 0.12, pl.r * 0.93);
        smile.rotation.z = Math.PI;
        face.add(smile);
        const cm = own(new THREE.MeshBasicMaterial({ color: 0xff6fae, fog: false }));
        for (const ex of [-0.5, 0.5]) {
          const cheek = new THREE.Mesh(new THREE.CircleGeometry(pl.r * 0.09, 16), cm);
          cheek.position.set(ex * pl.r, -pl.r * 0.02, pl.r * 0.88);
          cheek.rotation.y = ex * 0.5;
          face.add(cheek);
        }
        group.add(face);
      }
    }

    // soft glowing lane dashes on the star road
    const dashGeos = [];
    for (let s0 = 0; s0 < L - 6; s0 += 8) {
      const fr = frames(path, s0, s0 + 3.5, 0.7);
      for (const lat of [-hw * 0.34, hw * 0.34]) dashGeos.push(ribbon(fr, lat - 0.22, lat + 0.22, 0.05));
    }
    const dashMat = own(new THREE.MeshBasicMaterial({ color: 0x9ff7ff, transparent: true, opacity: 0.55, depthWrite: false }));
    const dashes = new THREE.Mesh(mergeGeometries(dashGeos), dashMat);
    dashes.renderOrder = 1;
    group.add(dashes);
    animators.push((dt, t) => { dashMat.opacity = 0.4 + Math.sin(t * 2.5) * 0.15; });

    // the observatory on its own floating island in the big loop
    buildObservatory(gx, gz);

    // glowing star rings over the road
    const ringMats = [];
    for (let k = 0; k < 6; k++) {
      const s = ((k + 0.5) / 6) * L;
      if (Math.abs(path.delta(s, 0)) < 30) continue;
      const p = path.pointAt(s);
      const h = path.headingAt(s);
      const m = own(new THREE.MeshBasicMaterial({ color: 0x9ff7ff, transparent: true, opacity: 0.8 }));
      ringMats.push(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(hw + FENCE_OFFSET + 1.5, 0.45, 8, 48, Math.PI), m);
      ring.position.copy(p);
      ring.rotation.y = h;
      group.add(ring);
    }
    animators.push((dt, t) => ringMats.forEach((m, i) => m.color.setHSL((0.5 + t * 0.05 + i * 0.12) % 1, 0.9, 0.72)));

    // twinkly stars floating around
    const starGeo = extruded(starShape(5, 1, 0.45), 0.35, 0.08, 1);
    floatingShapes(starGeo, scatter(60, (x, z) => clearOfRoad(x, z, 8), { pad: 90 }), [0xfff27a, 0xffffff, 0x9ff7ff, 0xff9ce8], { yMin: -6, yMax: 30, scale: [1.2, 3], glowy: true });
    sparkles(700, center.x, center.z, extent + 120, -40, 80, [0xffffff, 0x9ff7ff, 0xfff27a, 0xff9ce8], 2.4);
    shootingStars();
  }

  function buildObservatory(x, z) {
    // built at 1x then scaled up via a helper that scales around (x, y, z)
    const S = 1.5;
    const y = -2;
    const add = batch.add.bind(batch);
    const scaled = (geo, mat, m, outline) => add(geo, mat, new THREE.Matrix4().makeTranslation(x, y, z)
      .multiply(new THREE.Matrix4().makeScale(S, S, S)).multiply(new THREE.Matrix4().makeTranslation(-x, -y, -z)).multiply(m), outline);
    scaled(new THREE.ConeGeometry(26, 34, 8).rotateX(Math.PI), toon(0x5a3aa8), mat4(x, y - 17, z));
    scaled(new THREE.CylinderGeometry(26, 26, 2, 8), toon(0x9f7bff), mat4(x, y, z));
    scaled(new THREE.CylinderGeometry(9, 10, 10, 24), toon(0xf4eeff), mat4(x, y + 6, z));
    scaled(new THREE.SphereGeometry(9.4, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xbfd4ff), mat4(x, y + 11, z));
    scaled(new THREE.BoxGeometry(2.4, 9, 0.6), toon(0x3a2a7a), mat4(x, y + 15, z + 8.4, { rx: -0.35 }), false);
    scaled(new THREE.CylinderGeometry(1.1, 1.5, 12, 14), toon(0xfff27a), mat4(x, y + 20, z + 5, { rx: 0.9 }));
    scaled(new THREE.TorusGeometry(9.2, 0.4, 8, 32), toon(0x9ff7ff), mat4(x, y + 11, z, { rx: Math.PI / 2 }), false);
    const star = extruded(starShape(5, 1, 0.45), 0.4, 0.08);
    scaled(star, glow(0xfff27a), mat4(x, y + 24, z, { s: 3 }), false);
    // lamp posts around the island
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      scaled(new THREE.CylinderGeometry(0.25, 0.3, 4, 6), toon(0xffffff), mat4(x + Math.cos(a) * 20, y + 3, z + Math.sin(a) * 20), false);
      scaled(new THREE.SphereGeometry(0.9, 10, 8), glow([0x9ff7ff, 0xff9ce8, 0xfff27a][k % 3]), mat4(x + Math.cos(a) * 20, y + 5.4, z + Math.sin(a) * 20), false);
    }
  }

  function shootingStars() {
    const n = 5;
    const geo = new THREE.CylinderGeometry(0.0, 1.2, 40, 6);
    geo.rotateZ(Math.PI / 2);
    const mats = [];
    const items = [];
    for (let i = 0; i < n; i++) {
      const m = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, depthWrite: false }));
      mats.push(m);
      const mesh = new THREE.Mesh(geo, m);
      group.add(mesh);
      items.push({ mesh, m, t: rng() * 6, dur: 1.4, from: new THREE.Vector3(), dir: new THREE.Vector3() });
    }
    const reset = (it) => {
      const a = rng() * Math.PI * 2;
      it.from.set(center.x + Math.cos(a) * 500, 220 + rng() * 160, center.z + Math.sin(a) * 500);
      it.dir.set(-Math.cos(a + 0.6), -0.25, -Math.sin(a + 0.6)).normalize();
      it.mesh.rotation.set(0, -Math.atan2(it.dir.z, it.dir.x), Math.asin(it.dir.y));
      it.t = -(1 + rng() * 5);
    };
    items.forEach(reset);
    animators.push((dt) => {
      for (const it of items) {
        it.t += dt;
        if (it.t < 0) { it.m.opacity = 0; continue; }
        if (it.t > it.dur) { reset(it); continue; }
        it.mesh.position.copy(it.from).addScaledVector(it.dir, it.t * 380);
        it.m.opacity = Math.sin((it.t / it.dur) * Math.PI) * 0.9;
      }
    });
  }

  // =========================================================================
  // Sundae Slopes
  // =========================================================================
  function buildSundaeWorld() {
    const river = def.scenery.riverLine || [];
    if (river.length) {
      // chocolate river ribbon + little pools at its ends
      const pos = [];
      const hasPool = [river[0], river[river.length - 1]].map((e) => clearOfRoad(e[0], e[1], FENCE_OFFSET + 26));
      // taper the river into a little trickle at an end without a pool
      const widthAt = (i) => {
        const fromStart = i, fromEnd = river.length - 1 - i;
        let k = 1;
        if (!hasPool[0]) k = Math.min(k, 0.25 + fromStart * 0.25);
        if (!hasPool[1]) k = Math.min(k, 0.25 + fromEnd * 0.25);
        return 9 * Math.min(1, k);
      };
      for (let i = 0; i < river.length - 1; i++) {
        const [ax, az] = river[i], [bx, bz] = river[i + 1];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
        const wa = widthAt(i), wb = widthAt(i + 1);
        const ux = -dz / len, uz = dx / len;
        const y = -1.2;
        pos.push(ax - ux * wa, y, az - uz * wa, bx - ux * wb, y, bz - uz * wb, ax + ux * wa, y, az + uz * wa);
        pos.push(ax + ux * wa, y, az + uz * wa, bx - ux * wb, y, bz - uz * wb, bx + ux * wb, y, bz + uz * wb);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const chocoMat = own(toon(0x7a4127, { unique: true, emissive: 0x2a1208, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
      group.add(new THREE.Mesh(g, chocoMat));
      for (const [k, end] of [river[0], river[river.length - 1]].entries()) {
        if (!hasPool[k]) continue;
        const pool = new THREE.Mesh(new THREE.CircleGeometry(15, 32), chocoMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(end[0], -1.19, end[1]);
        group.add(pool);
      }
      // marshmallows bobbing in the chocolate
      const mm = [];
      for (let i = 0; i < river.length; i += 3) mm.push({ x: river[i][0] + (rng() - 0.5) * 8, z: river[i][1] + (rng() - 0.5) * 8, ph: rng() * 6 });
      const mGeo = new THREE.CylinderGeometry(1, 1, 1.4, 14);
      const mMesh = new THREE.InstancedMesh(mGeo, toon(0xffffff), mm.length);
      const mc = new THREE.Color();
      mm.forEach((m, i) => mMesh.setColorAt(i, mc.set([0xffffff, 0xffd1e6, 0xd4f7e4][i % 3])));
      group.add(mMesh);
      animators.push((dt, t) => {
        mm.forEach((m, i) => mMesh.setMatrixAt(i, mat4(m.x, -1 + Math.sin(t * 1.4 + m.ph) * 0.15, m.z, { rz: 1.4, ry: m.ph + t * 0.1 })));
        mMesh.instanceMatrix.needsUpdate = true;
      });
    }

    // ice-cream scoop mountains
    const flavours = [0xffb3d1, 0xb8f2d6, 0xf2c28a, 0xfff1d6, 0xc7b8ff, 0xffe28a];
    const scoopGeo = new THREE.SphereGeometry(1, 28, 16);
    const drip = new THREE.CapsuleGeometry(0.5, 1, 2, 6);
    const scoops = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng() * 0.2;
      const r = extent + 160 + rng() * 150;
      scoops.push({ x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, y: -8, r: 45 + rng() * 40, c: flavours[i % flavours.length], cherry: i % 3 === 0 });
    }
    for (const [x, z] of scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 26), { pad: 60 })) {
      const r = 10 + rng() * 10;
      if (!clearOfRoad(x, z, FENCE_OFFSET + r + 3)) continue;
      scoops.push({ x, z, y: groundH(x, z) - r * 0.35, r, c: flavours[scoops.length % flavours.length], cherry: rng() < 0.6 });
      if (scoops.length > 26) break;
    }
    const scoopMesh = new THREE.InstancedMesh(scoopGeo, toon(0xffffff), scoops.length);
    const scoopOut = new THREE.InstancedMesh(pushedCopy(scoopGeo, 0.02), outlineMat, scoops.length);
    const col = new THREE.Color();
    const drips = [];
    const cherries = [];
    scoops.forEach((s, i) => {
      const m = mat4(s.x, s.y, s.z, { s: [s.r, s.r * 0.8, s.r] });
      scoopMesh.setMatrixAt(i, m);
      scoopOut.setMatrixAt(i, m);
      scoopMesh.setColorAt(i, col.set(s.c));
      const nd = 10;
      for (let k = 0; k < nd; k++) {
        const a = (k / nd) * Math.PI * 2 + rng() * 0.3;
        const len = 0.8 + rng() * 1.2;
        drips.push({ m: mat4(s.x + Math.cos(a) * s.r * 0.93, s.y - s.r * 0.12 - len * s.r * 0.08, s.z + Math.sin(a) * s.r * 0.93, { s: [s.r * 0.09, s.r * 0.09 * len * 2, s.r * 0.09] }), c: s.c });
      }
      if (s.cherry) cherries.push(mat4(s.x, s.y + s.r * 0.8 + s.r * 0.08, s.z, { s: s.r * 0.14 }));
    });
    group.add(scoopMesh, scoopOut);
    const dripMesh = new THREE.InstancedMesh(drip, toon(0xffffff), drips.length);
    drips.forEach((d, i) => { dripMesh.setMatrixAt(i, d.m); dripMesh.setColorAt(i, col.set(d.c)); });
    group.add(dripMesh);
    const cherryMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), toon(0xe8203a, { emissive: 0x550010, emissiveIntensity: 0.4 }), cherries.length);
    cherries.forEach((m, i) => cherryMesh.setMatrixAt(i, m));
    group.add(cherryMesh);

    // waffle-cone towers with scoops on top
    const waffleTex = ownTex(waffleTexture());
    waffleTex.repeat.set(3, 2);
    const coneGeo = new THREE.ConeGeometry(1, 2.4, 20, 1, true);
    coneGeo.rotateX(Math.PI);
    const coneSpots = scatter(16, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 8) && distToRoad(x, z) < hw + 60, { pad: 60 });
    const cones = new THREE.InstancedMesh(coneGeo, toonTex(waffleTex, 0xffffff, { side: THREE.DoubleSide }), coneSpots.length);
    const tops = new THREE.InstancedMesh(scoopGeo, toon(0xffffff), coneSpots.length);
    const topsOut = new THREE.InstancedMesh(pushedCopy(scoopGeo, 0.05), outlineMat, coneSpots.length);
    coneSpots.forEach(([x, z], i) => {
      const s = 2.6 + rng() * 2;
      const y = groundH(x, z);
      cones.setMatrixAt(i, mat4(x, y + 1.2 * s, z, { s }));
      const tm = mat4(x, y + 2.4 * s + s * 0.35, z, { s: [s * 1.05, s * 0.95, s * 1.05] });
      tops.setMatrixAt(i, tm);
      topsOut.setMatrixAt(i, tm);
      tops.setColorAt(i, col.set(flavours[i % flavours.length]));
    });
    group.add(cones, tops, topsOut);

    // wafer sticks poking out of the snow
    const waferSpots = scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 3), { pad: 90 });
    const wafer = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 6, 1), toon(0xe0a860), waferSpots.length);
    waferSpots.forEach(([x, z], i) => wafer.setMatrixAt(i, mat4(x, groundH(x, z) + 2, z, { rz: (rng() - 0.5) * 0.6, rx: (rng() - 0.5) * 0.6, ry: rng() * 3 })));
    group.add(wafer);

    // sprinkles scattered over the snow
    const sprSpots = scatter(2200, (x, z) => {
      const d = distToRoad(x, z, 70);
      return d > hw + FENCE_OFFSET + 1 && d < hw + 60;
    }, { pad: 70, tries: 6 });
    const spr = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.22, 0.75), toon(0xffffff), sprSpots.length);
    const sc = [0xff4f9a, 0x4fb3ff, 0xffe14f, 0x6bd968, 0xb57bff, 0xff9f40];
    sprSpots.forEach(([x, z], i) => {
      spr.setMatrixAt(i, mat4(x, groundH(x, z) + 0.1, z, { ry: rng() * Math.PI }));
      spr.setColorAt(i, col.set(sc[i % sc.length]));
    });
    group.add(spr);

    // candy-floss trees in minty/pink tones
    cottonCandyTrees(scatter(70, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 4) && (!river.length || distToPolyline(x, z, river) > 16), { pad: 120 }),
      [0xffffff, 0xd4f7e4, 0xffd1e6, 0xcfe8ff], { stick: 0x8a5237 });

    // gently falling sprinkle-snow
    fallingSprinkles(700);
    sparkles(200, center.x, center.z, extent, 4, 30, [0xffffff, 0xffe3f1], 1.2);
  }

  /** Glossy milk-chocolate centre stripe + whipped-cream scallops along both kerbs. */
  function buildChocolateRoadDetails() {
    // (sits just above the road but below the start line at 0.05)
    const gloss = new THREE.Mesh(ribbon(loopFrames, -1.6, 1.6, 0.036), own(toon(0xc98760, { unique: true, emissive: 0x2a1208, emissiveIntensity: 0.2 })));
    const shine = new THREE.Mesh(ribbon(loopFrames, -0.3, 0.3, 0.042), own(toon(0xe6ae84, { unique: true, emissive: 0x442211, emissiveIntensity: 0.25 })));
    group.add(gloss, shine);
    // low-poly dollops: this runs ~1000 times round the lap, keep it cheap
    const puffGeo = new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    const step = 2.3;
    const n = Math.floor(path.length / step);
    const cream = new THREE.InstancedMesh(puffGeo, toon(0xffffff, { emissive: 0x554444, emissiveIntensity: 0.25 }), n * 2);
    let k = 0;
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 1]) {
        const sP = i * step + (side > 0 ? step / 2 : 0);
        const p = path.positionAt(sP, side * (hw + SHOULDER_IN * 0.5));
        const m = mat4(p.x, p.y + 0.05, p.z, { s: [1.05, 0.34, 1.05] });
        cream.setMatrixAt(k, m);
        k++;
      }
    }
    group.add(cream);
  }

  function fallingSprinkles(n) {
    const pos = new Float32Array(n * 3);
    const colr = new Float32Array(n * 3);
    const c = new THREE.Color();
    const sc = [0xff4f9a, 0x4fb3ff, 0xffe14f, 0x6bd968, 0xb57bff, 0xffffff];
    const R = extent + 60;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = center.x + (rng() - 0.5) * R * 2;
      pos[i * 3 + 1] = rng() * 60;
      pos[i * 3 + 2] = center.z + (rng() - 0.5) * R * 2;
      c.set(sc[i % sc.length]);
      colr[i * 3] = c.r; colr[i * 3 + 1] = c.g; colr[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    const mat = own(new THREE.PointsMaterial({ size: 0.7, vertexColors: true, map: ownTex(sparkleTexture()), transparent: true, depthWrite: false }));
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    group.add(pts);
    animators.push((dt, t) => {
      const a = g.attributes.position.array;
      for (let i = 0; i < n; i++) {
        a[i * 3 + 1] -= dt * (3 + (i % 5));
        a[i * 3] += Math.sin(t + i) * dt * 0.8;
        if (a[i * 3 + 1] < -2) a[i * 3 + 1] = 60;
      }
      g.attributes.position.needsUpdate = true;
    });
  }

  // =========================================================================

  return {
    group,
    sky,
    itemBoxSlots,
    boostPads,
    lights,
    terrainHeight: (x, z) => terrain.height(x, z),
    update(dt, time) {
      for (const fn of animators) fn(dt, time);
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose?.();
      });
      for (const m of ownedMaterials) m.dispose();
      for (const t of ownedTextures) t.dispose();
      flagGeo.dispose();
      group.removeFromParent();
    },
  };
}

/** Chocolate river: perpendicular to the road at the bridge, wiggling off both ways, stopping before other road. */
function riverPolyline(def, path, index) {
  const s = def.scenery.river.at * path.length;
  const p = path.pointAt(s);
  const r = path.rightAt(s);
  const hw = path.halfWidth;
  const bridgeRange = (def.scenery.bridges || [])[0];
  const inBridge = (i) => {
    if (!bridgeRange) return false;
    const si = i * path.step;
    return si >= bridgeRange[0] * path.length - 30 && si <= bridgeRange[1] * path.length + 30;
  };
  const sides = [];
  for (const dir of [-1, 1]) {
    const pts = [];
    for (let d = 0; d <= 260; d += 6) {
      const wig = Math.sin(d * 0.03) * 10 * Math.min(1, d / 40);
      const x = p.x + r.x * d * dir + -r.z * wig;
      const z = p.z + r.z * d * dir + r.x * wig;
      const n = index.nearest(x, z, hw + 40);
      if (d > 34 && n.i >= 0 && !inBridge(n.i) && n.dist < hw + 30) break;
      pts.push([x, z]);
    }
    sides.push(pts);
  }
  return [...sides[0].reverse(), ...sides[1].slice(1)];
}

// ---------------------------------------------------------------------------

function buildSky(theme, kind, own, ownTex, rng, animators) {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const mat = own(new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      bottom: { value: new THREE.Color(theme.skyBottom) },
      horizon: { value: new THREE.Color(theme.fogColor) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(bottom, top, smoothstep(0.02, 0.65, h));
        c = mix(horizon, c, smoothstep(-0.06, 0.12, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }));
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky';
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  followCamera(sky);
  if (kind === 'galaxy') {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.02;
      const rr = Math.sqrt(1 - y * y);
      const R = SKY_RADIUS * 0.9;
      pos[i * 3] = Math.cos(a) * rr * R;
      pos[i * 3 + 1] = (u < 0 && rng() < 0.3 ? -y : y) * R;
      pos[i * 3 + 2] = Math.sin(a) * rr * R;
      c.set([0xffffff, 0xfff2b0, 0xbfe9ff, 0xffc2f0][i % 4]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pm = own(new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false }));
    const stars = new THREE.Points(g, pm);
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    followCamera(stars);
    sky.add(stars);
    animators.push((dt, t) => { pm.opacity = 0.8 + Math.sin(t * 2.3) * 0.2; });
  }
  return sky;
}

/** Keep an object centred on the camera that is drawing it (sky dome, star field). */
function followCamera(obj) {
  obj.onBeforeRender = (renderer, scene, camera) => {
    obj.matrixWorld.makeTranslation(camera.matrixWorld.elements[12], camera.matrixWorld.elements[13], camera.matrixWorld.elements[14]);
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHeart(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.4, y - s, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.3, x, y + s * 0.35);
  ctx.fill();
}
