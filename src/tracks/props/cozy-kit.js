/**
 * Cozy Cup prop kit — small, pure helpers shared by the four Cozy Cup tracks
 * (pumpkin-patch, teacup-garden, peppermint-village, pillow-fort).
 * OWNER: Tracks — Cozy Cup. Everything takes the scenery `ctx` (src/tracks/core.js)
 * and draws randomness only from `ctx.rng`, so worlds stay deterministic.
 *
 *   instanced(ctx, geo, material, items, { outline, ow, colors, name })   one InstancedMesh (+ outline hull)
 *   placeAlong(ctx, s, lateral, y?)            -> { x, y, z, h } a road-relative spot (h = road heading)
 *   faceRoad(ctx, x, z)                        -> heading that looks at the nearest road point
 *   bulbString(ctx, a, b, sag, n)              -> [[x,y,z], ...] a hanging garland between two points
 *   twinkleLights(ctx, spots, palette, opts)    glowing bulbs that twinkle in colour groups
 *   drifting(ctx, geo, material, n, opts)       falling / drifting flakes or leaves (instanced, looping)
 *   roadStitches(ctx, { color, lateral, dash, gap, width })   dashed seams along both road edges
 *   ringOfSpots(ctx, cx, cz, r, n, jitter)      -> [[x,z], ...]
 */
import * as THREE from 'three';
import { mat4, pushedCopy } from '../geometry.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Build one InstancedMesh from `items` (each a THREE.Matrix4, or { m, color }).
 * Adds an inverted-hull outline InstancedMesh unless `outline === false`.
 * @returns {{ mesh: THREE.InstancedMesh, outline: THREE.InstancedMesh|null }}
 */
export function instanced(ctx, geo, material, items, { outline = true, ow = 0.06, colors = null, name = '' } = {}) {
  if (!items.length) return { mesh: null, outline: null };
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  if (name) mesh.name = name;
  let out = null;
  if (outline) {
    out = new THREE.InstancedMesh(pushedCopy(geo, ow), ctx.outlineMat, items.length);
    if (name) out.name = `${name}:outline`;
  }
  items.forEach((it, i) => {
    const m = it.isMatrix4 ? it : it.m;
    mesh.setMatrixAt(i, m);
    if (out) out.setMatrixAt(i, m);
    const col = it.isMatrix4 ? (colors ? colors[i % colors.length] : null) : it.color ?? (colors ? colors[i % colors.length] : null);
    if (col != null) mesh.setColorAt(i, _c.set(col));
  });
  ctx.group.add(mesh);
  if (out) ctx.group.add(out);
  return { mesh, outline: out };
}

/** A road-relative spot: centre-line s, signed lateral (+ = racer's right). */
export function placeAlong(ctx, s, lateral, y) {
  const p = ctx.path.positionAt(s, lateral);
  const h = ctx.path.headingAt(s);
  return { x: p.x, y: y ?? p.y, z: p.z, h };
}

/** Heading (rotation.y) that makes a prop's +Z face the nearest point of the road. */
export function faceRoad(ctx, x, z) {
  const n = ctx.index.nearest(x, z, 400);
  if (n.i < 0) return 0;
  const px = ctx.path.px[n.i], pz = ctx.path.pz[n.i];
  return Math.atan2(px - x, pz - z);
}

/** Points of a gently sagging garland between a and b ([x,y,z]). */
export function bulbString(a, b, sag, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
      a[2] + (b[2] - a[2]) * t,
    ]);
  }
  return out;
}

/**
 * Glowing bulbs split into `palette.length` groups whose brightness pulses out
 * of phase (one draw call per colour, no per-instance updates per frame).
 * @returns {THREE.Material[]} the (owned) group materials
 */
export function twinkleLights(ctx, spots, palette, { size = 0.32, speed = 2.2, geo = null } = {}) {
  const g = geo ?? new THREE.SphereGeometry(1, 8, 6);
  const mats = palette.map((c) => ctx.own(new THREE.MeshBasicMaterial({ color: c })));
  const base = palette.map((c) => new THREE.Color(c));
  const groups = palette.map(() => []);
  spots.forEach((p, i) => groups[i % palette.length].push(mat4(p[0], p[1], p[2], { s: size })));
  groups.forEach((arr, k) => {
    if (!arr.length) return;
    const m = new THREE.InstancedMesh(g, mats[k], arr.length);
    arr.forEach((mm, i) => m.setMatrixAt(i, mm));
    m.name = 'twinkle-lights';
    ctx.group.add(m);
  });
  ctx.animate((dt, t) => {
    mats.forEach((mt, k) => {
      const v = 0.62 + 0.38 * Math.max(0, Math.sin(t * speed + k * 2.1));
      mt.color.copy(base[k]).multiplyScalar(v);
    });
  });
  return mats;
}

/**
 * Things that drift down (snowflakes, autumn leaves) around the track and loop
 * back to the top. Instanced; each flake tumbles.
 * opts: { radius, top, bottom, fall:[a,b], sway, spin, scale:[a,b], colors }
 */
export function drifting(ctx, geo, material, n, opts = {}) {
  const { rng, center, extent } = ctx;
  const radius = opts.radius ?? extent + 60;
  const top = opts.top ?? 40, bottom = opts.bottom ?? -2;
  const fall = opts.fall ?? [1.5, 3.5];
  const sway = opts.sway ?? 1.2, spin = opts.spin ?? 1.5;
  const scale = opts.scale ?? [0.3, 0.6];
  const items = [];
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius;
    items.push({
      x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r,
      y: bottom + rng() * (top - bottom), v: fall[0] + rng() * (fall[1] - fall[0]),
      ph: rng() * Math.PI * 2, s: scale[0] + rng() * (scale[1] - scale[0]),
    });
  }
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.frustumCulled = false;
  mesh.name = 'drifting';
  if (opts.colors) items.forEach((it, i) => mesh.setColorAt(i, _c.set(opts.colors[i % opts.colors.length])));
  const write = (t) => {
    items.forEach((it, i) => {
      _e.set(t * spin + it.ph, t * spin * 0.7 + it.ph * 2, 0);
      _q.setFromEuler(_e);
      _v.set(it.x + Math.sin(t * 0.8 + it.ph) * sway, it.y, it.z + Math.cos(t * 0.6 + it.ph) * sway);
      _s.setScalar(it.s);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(i, _m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  write(0);
  ctx.group.add(mesh);
  ctx.animate((dt, t) => {
    const d = Math.min(dt, 0.1);
    for (const it of items) {
      it.y -= it.v * d;
      if (it.y < bottom) it.y = top;
    }
    write(t);
  });
  return mesh;
}

/** Dashed "stitches" along both road edges (a quilted / sewn road). */
export function roadStitches(ctx, { color = 0xffffff, lateral = null, dash = 1.6, gap = 1.4, width = 0.28, lift = 0.045 } = {}) {
  const { path, hw } = ctx;
  const lat = lateral ?? hw - 1.1;
  const geo = new THREE.PlaneGeometry(width, dash);
  geo.rotateX(-Math.PI / 2);
  const step = dash + gap;
  const n = Math.floor(path.length / step);
  const items = [];
  for (let i = 0; i < n; i++) {
    const s = i * step;
    for (const side of [-1, 1]) {
      const p = path.positionAt(s, side * lat);
      items.push(mat4(p.x, p.y + lift, p.z, { ry: path.headingAt(s) }));
    }
  }
  const mat = ctx.own(new THREE.MeshBasicMaterial({ color }));
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.name = 'road-stitches';
  ctx.group.add(mesh);
  return mesh;
}

/** n spots on a jittered ring. */
export function ringOfSpots(ctx, cx, cz, r, n, jitter = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (ctx.rng() - 0.5) * jitter;
    const rr = r * (1 + (ctx.rng() - 0.5) * jitter * 0.5);
    out.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  return out;
}

/** Road-length-distance helper: is lap distance s inside [a, b] (fractions, wrapping)? */
export function inRange(s, L, a, b) {
  const f = ((s / L) % 1 + 1) % 1;
  return a <= b ? f >= a && f <= b : f >= a || f <= b;
}
