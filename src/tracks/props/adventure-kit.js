/**
 * Adventure Cup prop kit — small, pure helpers shared by the four Adventure Cup
 * tracks (jellybean-jungle, cocoa-canyon, lemonade-volcano, donut-downtown).
 * OWNER: Tracks — Adventure Cup.
 *
 * Everything takes the scenery `ctx` (src/tracks/core.js) and draws randomness
 * only from `ctx.rng`, so worlds stay deterministic. Anything repeated is an
 * InstancedMesh (one draw call per geometry + material, plus one for its
 * cartoon outline when asked).
 *
 *   instanced(ctx, geo, mat, items, { outline })        static instances: items = [{ m: Matrix4, c?: hex }]
 *   animatedInstances(ctx, geo, mat, items, pose, opts)  per-frame instances: pose(item, t, out) fills out {x,y,z,rx,ry,rz,sx,sy,sz}
 *   spotsAlong(ctx, { from, to, every, side, gap, jitter })  roadside spots between two lap fractions
 *   roadGap(ctx, s, lat)                                  world XZ of a lateral offset at arc length s
 *   isClearOfCamera(ctx, x, z, reach)                     keep tall props off the chase-camera corridor
 *   farRing(ctx, n, rMin, rMax)                           evenly spread spots on a ring around the track
 *   lathe(profile, segments)                              LatheGeometry from [[r, y], ...]
 *   capsule(r, len, capSeg, radSeg)                       small CapsuleGeometry wrapper (jellybeans, cacti)
 *   floorDisc(ctx, radius, y, colorAt)                    vertex-coloured flat ground (for 'void' terrain tracks)
 *   minDistToOtherLevel(path, x, z, y, dy)                XZ distance to road samples whose height differs by > dy
 */
import * as THREE from 'three';
import { toon } from '../../render/toon.js';
import { mat4, pushedCopy, FENCE_OFFSET, TREE_CAMERA_CLEARANCE } from '../geometry.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Static instanced props.
 * @param {object} ctx scenery ctx
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Material} material  use a white-ish colour when items carry `c`
 * @param {{m: THREE.Matrix4, c?: number}[]} items
 * @param {{outline?: number}} [opts] outline thickness (0 = none)
 * @returns {THREE.InstancedMesh|null}
 */
export function instanced(ctx, geo, material, items, { outline = 0 } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    if (it.c !== undefined) mesh.setColorAt(i, _c.set(it.c));
  });
  ctx.group.add(mesh);
  if (outline > 0) {
    const out = new THREE.InstancedMesh(pushedCopy(geo, outline), ctx.outlineMat, items.length);
    items.forEach((it, i) => out.setMatrixAt(i, it.m));
    ctx.group.add(out);
  }
  return mesh;
}

/**
 * Animated instanced props. `pose(item, t, out)` fills `out` (position,
 * Euler YXZ rotation, scale) for time t; it is called once at build time
 * (t = 0) and then every frame.
 * @returns {THREE.InstancedMesh|null}
 */
export function animatedInstances(ctx, geo, material, items, pose, { outline = 0 } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  const out = outline > 0 ? new THREE.InstancedMesh(pushedCopy(geo, outline), ctx.outlineMat, items.length) : null;
  items.forEach((it, i) => { if (it.c !== undefined) mesh.setColorAt(i, _c.set(it.c)); });
  const o = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
  const update = (t) => {
    for (let i = 0; i < items.length; i++) {
      o.x = o.y = o.z = o.rx = o.ry = o.rz = 0;
      o.sx = o.sy = o.sz = 1;
      pose(items[i], t, o);
      _e.set(o.rx, o.ry, o.rz, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(o.x, o.y, o.z), _q, _s.set(o.sx, o.sy, o.sz));
      mesh.setMatrixAt(i, _m);
      if (out) out.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (out) out.instanceMatrix.needsUpdate = true;
  };
  update(0);
  // Moving instances leave their build-time bounds: never cull them away.
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
  if (out) { out.frustumCulled = false; ctx.group.add(out); }
  ctx.animators.push((dt, t) => update(t));
  return mesh;
}

/** World XZ (and road height) of lateral offset `lat` at arc length `s`. */
export function roadGap(ctx, s, lat) {
  const p = ctx.path.positionAt(s, lat);
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * Evenly spaced roadside spots between two lap fractions, on one or both sides.
 * @returns {{x:number, z:number, y:number, s:number, side:number, heading:number}[]}
 */
export function spotsAlong(ctx, { from, to, every = 12, side = 0, gap = FENCE_OFFSET + 4, jitter = 0 }) {
  const { path, hw, rng } = ctx;
  const L = path.length;
  let s0 = from * L, s1 = to * L;
  if (s1 < s0) s1 += L;
  const out = [];
  for (let s = s0; s <= s1; s += every) {
    for (const sd of side === 0 ? [-1, 1] : [side]) {
      const lat = sd * (hw + gap + (jitter ? rng() * jitter : 0));
      const p = path.positionAt(s, lat);
      out.push({ x: p.x, y: p.y, z: p.z, s: path.wrap(s), side: sd, heading: path.headingAt(s) });
    }
  }
  return out;
}

/**
 * True when a prop of horizontal `reach` at (x, z) stays out of the chase
 * cameras' corridor (the fence + TREE_CAMERA_CLEARANCE) of every road piece.
 */
export function isClearOfCamera(ctx, x, z, reach = 0) {
  return ctx.distToRoad(x, z, ctx.hw + FENCE_OFFSET + TREE_CAMERA_CLEARANCE + reach + 4) > ctx.hw + FENCE_OFFSET + TREE_CAMERA_CLEARANCE + reach;
}

/** `n` spots spread around a ring (rMin..rMax) about the track centre. */
export function farRing(ctx, n, rMin, rMax) {
  const { rng, center } = ctx;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rng() - 0.5) * (Math.PI / n);
    const r = rMin + rng() * (rMax - rMin);
    out.push([center.x + Math.cos(a) * r, center.z + Math.sin(a) * r, a]);
  }
  return out;
}

/** LatheGeometry from a [[radius, y], ...] profile. */
export function lathe(profile, segments = 24) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** CapsuleGeometry (radius, straight length) with modest tessellation. */
export function capsule(r, len, capSeg = 3, radSeg = 8) {
  return new THREE.CapsuleGeometry(r, len, capSeg, radSeg);
}

/**
 * Flat vertex-coloured ground for tracks on 'void' terrain (they draw their
 * own floor so raised road can cross over lower road without the core's
 * skirts/pillars landing on it): a detailed grid around the track plus a
 * plain apron disc of radius `radius` beyond it.
 * @param {(x:number, z:number, out:THREE.Color)=>void} colorAt
 */
export function floorDisc(ctx, radius, y, colorAt, { pad = 160, cell = 5, apronColor } = {}) {
  const { bounds, center } = ctx;
  const w = bounds.maxX - bounds.minX + pad * 2;
  const d = bounds.maxZ - bounds.minZ + pad * 2;
  const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / cell), Math.ceil(d / cell));
  geo.rotateX(-Math.PI / 2);
  geo.translate(center.x, y, center.z);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  if (apronColor === undefined) { colorAt(center.x + w, center.z + d, _c); apronColor = _c.getHex(); }
  const edge = new THREE.Color(apronColor);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    colorAt(x, z, _c);
    // fade into the apron colour towards the grid edge so there is no seam
    const edgeDist = Math.min(w / 2 - Math.abs(x - center.x), d / 2 - Math.abs(z - center.z));
    if (edgeDist < pad * 0.6) _c.lerp(edge, 1 - edgeDist / (pad * 0.6));
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, ctx.toonVC());
  mesh.name = 'ground';
  ctx.group.add(mesh);
  // well below the grid: a hair's gap z-fights into stripes far from the camera
  const apron = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), ctx.own(toon(apronColor, { unique: true })));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(center.x, y - 0.8, center.z);
  ctx.group.add(apron);
  return mesh;
}

/**
 * Smallest XZ distance from (x, z) to any road sample whose height differs
 * from `y` by more than `dy` (i.e. road on another level: a bridge above or
 * a road passing underneath). Infinity when there is none.
 */
export function minDistToOtherLevel(path, x, z, y, dy = 4) {
  let best = Infinity;
  for (let i = 0; i < path.count; i++) {
    if (Math.abs(path.py[i] - y) <= dy) continue;
    const d = Math.hypot(path.px[i] - x, path.pz[i] - z);
    if (d < best) best = d;
  }
  return best;
}

/** Convenience: a cached toon material tinted per instance (white base). */
export const tintable = (opts) => toon(0xffffff, opts);

export { mat4 };
