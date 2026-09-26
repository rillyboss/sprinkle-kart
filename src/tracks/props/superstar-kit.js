/**
 * Superstar Cup prop kit — small, reusable scenery helpers shared by the four
 * Superstar Cup tracks (cupcake-carnival, aurora-palace, moonbounce-base,
 * ribbon-sky). OWNER: track builder (Superstar Cup). Pure functions of the
 * scenery ctx (src/tracks/core.js); every random number comes from ctx.rng,
 * so the worlds stay deterministic.
 *
 *   stripedGeometry(geo, colors, bands)          vertex-coloured copy, banded by angle around +Y
 *   instanced(ctx, geo, mat, items, opts)        InstancedMesh (+ optional outline) from [{ m, c? }]
 *   roadFrameAt(path, s)                         { p, h, right } on the centre line
 *   sideSpot(path, s, lat, y?)                   world point beside the road (THREE.Vector3)
 *   balloons(ctx, spots, palette, opts)          party balloons on strings, bobbing (2 draw calls)
 *   hotAirBalloons(ctx, list, opts)              striped hot-air balloons with baskets, drifting
 *   bunting(ctx, s, opts)                        a string of triangle flags across the road
 *   snowfall(ctx, n, opts)                       soft falling snow / glitter points
 *   spinner(ctx, group, rate, axis)              spin a group every frame
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../../render/toon.js';
import { mat4, pushedCopy, sparkleTexture, FENCE_OFFSET } from '../geometry.js';

/** Non-indexed copy of `geo` with a `color` attribute: `bands` slices around +Y. */
export function stripedGeometry(geo, colors, bands = colors.length * 4) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const a = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2);
    const band = Math.min(bands - 1, Math.floor(a * bands));
    c.set(colors[band % colors.length]);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * One InstancedMesh (plus an outline copy) from a list of { m: Matrix4, c?: hex }.
 * @returns {THREE.InstancedMesh|null}
 */
export function instanced(ctx, geo, mat, items, { outline = true, ow = 0.05 } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const col = new THREE.Color();
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    if (it.c !== undefined) mesh.setColorAt(i, col.set(it.c));
  });
  ctx.group.add(mesh);
  if (outline) {
    const o = new THREE.InstancedMesh(pushedCopy(geo, ow), ctx.outlineMat, items.length);
    items.forEach((it, i) => o.setMatrixAt(i, it.m));
    ctx.group.add(o);
    mesh.userData.outline = o;
  }
  return mesh;
}

/** Centre-line point, heading and right vector at arc length s. */
export function roadFrameAt(path, s) {
  const p = path.pointAt(s, new THREE.Vector3());
  const right = path.rightAt(s, new THREE.Vector3());
  return { p, h: path.headingAt(s), right };
}

/** A point `lat` metres to the right of the centre line at s (y = road height + y). */
export function sideSpot(path, s, lat, y = 0) {
  const v = path.positionAt(s, lat, new THREE.Vector3());
  v.y += y;
  return v;
}

/**
 * Party balloons on strings that bob gently. `spots` = [[x, z], ...].
 * opts: { yMin, yMax, scale: [a, b], base(x, z) -> ground y }
 */
export function balloons(ctx, spots, palette, { yMin = 6, yMax = 14, scale = [1, 1.5], base } = {}) {
  const { rng, group, animate, groundH } = ctx;
  if (!spots.length) return null;
  const items = spots.map(([x, z], i) => ({
    x, z, g: base ? base(x, z) : Math.max(groundH(x, z), 0),
    h: yMin + rng() * (yMax - yMin), s: scale[0] + rng() * (scale[1] - scale[0]),
    ph: rng() * Math.PI * 2, c: palette[i % palette.length],
  }));
  const geo = new THREE.SphereGeometry(1, 14, 10);
  geo.scale(1, 1.2, 1);
  const mat = toon(0xffffff, { emissive: 0x442233, emissiveIntensity: 0.35 });
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const strGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 3, 1, true);
  strGeo.translate(0, 0.5, 0);
  const strings = new THREE.InstancedMesh(strGeo, toon(0xffffff), items.length);
  const col = new THREE.Color();
  items.forEach((it, i) => mesh.setColorAt(i, col.set(it.c)));
  const update = (t) => {
    items.forEach((it, i) => {
      const bob = Math.sin(t * 1.4 + it.ph) * 0.5;
      const sway = Math.sin(t * 0.9 + it.ph) * 0.12;
      const top = it.g + it.h + bob;
      mesh.setMatrixAt(i, mat4(it.x + sway * 3, top, it.z, { s: it.s, rz: sway }));
      strings.setMatrixAt(i, mat4(it.x, it.g, it.z, { s: [1, top - it.g - it.s * 1.1, 1], rz: sway * 0.2 }));
    });
    mesh.instanceMatrix.needsUpdate = true;
    strings.instanceMatrix.needsUpdate = true;
  };
  update(0);
  group.add(mesh, strings);
  animate((dt, t) => update(t));
  return mesh;
}

/**
 * Striped hot-air balloons with little baskets, drifting up and down.
 * list = [{ x, y, z, s, a, b }] (a = envelope colour, b = stripe colour)
 * opts: { bob = 1.2, spin = true }
 */
export function hotAirBalloons(ctx, list, { bob = 1.2, spin = true } = {}) {
  const { group, animate, rng, outlineMat } = ctx;
  if (!list.length) return [];
  const env = new THREE.SphereGeometry(1, 20, 14);
  // teardrop: squeeze the lower half into a point
  const p = env.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0) {
      const k = 1 - Math.pow(-y, 1.6) * 0.72;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    p.setY(i, y * 1.15);
  }
  env.computeVertexNormals();
  // stripes: every other longitudinal slice, pushed out a hair
  const stripe = pushedCopy(stripedMask(env, 16), 0.012);
  const basket = new THREE.CylinderGeometry(0.24, 0.2, 0.3, 8);
  basket.translate(0, -1.62, 0);
  const ropes = new THREE.CylinderGeometry(0.018, 0.018, 0.62, 3);
  const ropeGeos = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.78;
    const g = ropes.clone();
    g.rotateZ(Math.cos(a) * 0.35);
    g.rotateX(-Math.sin(a) * 0.35);
    g.translate(Math.cos(a) * 0.3, -1.2, Math.sin(a) * 0.3);
    ropeGeos.push(g);
  }
  const envMat = toon(0xffffff, { emissive: 0x331122, emissiveIntensity: 0.25 });
  const envMesh = new THREE.InstancedMesh(env, envMat, list.length);
  const envOut = new THREE.InstancedMesh(pushedCopy(env, 0.03), outlineMat, list.length);
  const stripeMesh = new THREE.InstancedMesh(stripe, toon(0xffffff, { emissive: 0x331122, emissiveIntensity: 0.25 }), list.length);
  const basketMesh = new THREE.InstancedMesh(basket, toon(0xc98a4b), list.length);
  const ropeMesh = new THREE.InstancedMesh(mergeGeometries(ropeGeos), toon(0x7a4a33), list.length);
  const col = new THREE.Color();
  const items = list.map((b) => ({ ...b, ph: rng() * Math.PI * 2, rs: (rng() - 0.5) * 0.3 }));
  items.forEach((b, i) => {
    envMesh.setColorAt(i, col.set(b.a));
    stripeMesh.setColorAt(i, col.set(b.b));
  });
  const meshes = [envMesh, envOut, stripeMesh, basketMesh, ropeMesh];
  const update = (t) => {
    items.forEach((b, i) => {
      const m = mat4(b.x, b.y + Math.sin(t * 0.6 + b.ph) * bob, b.z, { s: b.s, ry: spin ? t * b.rs + b.ph : b.ph });
      for (const mesh of meshes) mesh.setMatrixAt(i, m);
    });
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  group.add(...meshes);
  animate((dt, t) => update(t));
  return items;
}

/** Keep only every other longitudinal slice of a (non-indexed copy of a) sphere-ish geometry. */
function stripedMask(geo, slices) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.attributes.position;
  const keep = [];
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const a = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2);
    if (Math.floor(a * slices) % 2 === 0) for (let k = 0; k < 3; k++) keep.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  out.computeVertexNormals();
  return out;
}

/**
 * Bunting: a sagging string of little triangle flags across the road at arc length s.
 * Poles stand just outside the fences. opts: { height = 8.5, palette, flags = 16, sag = 1.2 }
 * Returns the flag matrices so a caller can batch several strings (pass `collect`).
 */
export function bunting(ctx, s, { height = 8.5, palette = [0xff5fa8, 0xffd23f, 0x4fb3ff, 0x8be08b, 0xb57bff], flags = 16, sag = 1.2, collect } = {}) {
  const { path, hw } = ctx;
  const span = hw + FENCE_OFFSET + 1.2;
  const a = sideSpot(path, s, -span, 0);
  const b = sideSpot(path, s, span, 0);
  const out = collect || { flags: [], poles: [], cords: [] };
  out.poles.push({ m: mat4(a.x, a.y + height / 2, a.z, { s: [1, height, 1] }) }, { m: mat4(b.x, b.y + height / 2, b.z, { s: [1, height, 1] }) });
  const h = path.headingAt(s);
  for (let k = 0; k < flags; k++) {
    const t = (k + 0.5) / flags;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const y = a.y + (b.y - a.y) * t + height - 0.3 - Math.sin(Math.PI * t) * sag;
    out.flags.push({ m: mat4(x, y, z, { ry: h }), c: palette[k % palette.length] });
  }
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (a.y + b.y) / 2 + height - 0.3 - sag * 0.6;
  out.cords.push({ m: mat4(mx, my, mz, { ry: h + Math.PI / 2, s: [1, 1, span * 2] }) });
  return out;
}

/** Build the meshes for everything collected by bunting(..., { collect }). */
export function buildBunting(ctx, col, { pole = 0xffffff } = {}) {
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.55, 0, 0, 0.55, 0, 0, 0, -1.1, 0], 3));
  flagGeo.computeVertexNormals();
  instanced(ctx, flagGeo, toon(0xffffff, { side: THREE.DoubleSide, emissive: 0x331122, emissiveIntensity: 0.3 }), col.flags, { outline: false });
  instanced(ctx, new THREE.CylinderGeometry(0.16, 0.2, 1, 6), toon(pole), col.poles, { outline: false });
  instanced(ctx, new THREE.BoxGeometry(0.06, 0.06, 1), toon(0xffffff), col.cords, { outline: false });
}

/**
 * Soft falling snow (or glitter) points over the track area.
 * opts: { color = 0xffffff, size = 0.9, top = 45, speed = [1.5, 3.5], drift = 0.8 }
 */
export function snowfall(ctx, n, { colors = [0xffffff], size = 0.9, top = 45, bottom = -2, speed = [1.5, 3.5], drift = 0.8 } = {}) {
  const { rng, center, extent, group, own, ownTex, animate } = ctx;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const spd = new Float32Array(n);
  const c = new THREE.Color();
  const R = extent + 60;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = center.x + (rng() - 0.5) * R * 2;
    pos[i * 3 + 1] = bottom + rng() * (top - bottom);
    pos[i * 3 + 2] = center.z + (rng() - 0.5) * R * 2;
    spd[i] = speed[0] + rng() * (speed[1] - speed[0]);
    c.set(colors[i % colors.length]);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = own(new THREE.PointsMaterial({ size, vertexColors: true, map: ownTex(sparkleTexture()), transparent: true, depthWrite: false }));
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  group.add(pts);
  animate((dt, t) => {
    const a = g.attributes.position.array;
    for (let i = 0; i < n; i++) {
      a[i * 3 + 1] -= dt * spd[i];
      a[i * 3] += Math.sin(t * 0.7 + i) * dt * drift;
      if (a[i * 3 + 1] < bottom) a[i * 3 + 1] = top;
    }
    g.attributes.position.needsUpdate = true;
  });
  return pts;
}

/**
 * Merge geometries into one non-indexed position(+normal, +colour) geometry.
 * Unlike mergeGeometries this accepts mixed attribute sets (uv etc. are dropped).
 * opts.color: keep the `color` attribute (every input must have one).
 */
export function mergeAll(geos, { color = false } = {}) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const col = color ? new Float32Array(n * 3) : null;
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o);
    if (col) col.set(g.attributes.color.array, o);
    o += g.attributes.position.count * 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

/** The spot nearest to `pref` ([x, z]) that is at least `margin` beyond the fences. */
export function findSpot(ctx, pref, margin) {
  const { center, clearOfRoad, scatter } = ctx;
  const [px, pz] = pref || [center.x, center.z];
  if (clearOfRoad(px, pz, FENCE_OFFSET + margin)) return [px, pz];
  let best = null, bestD = Infinity;
  for (const [x, z] of scatter(60, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + margin), { pad: 0 })) {
    const d = Math.hypot(x - px, z - pz);
    if (d < bestD) { bestD = d; best = [x, z]; }
  }
  return best || [px, pz];
}

/** Spin `obj` around `axis` ('x'|'y'|'z') at `rate` rad/s. */
export function spinner(ctx, obj, rate, axis = 'y') {
  ctx.animate((dt) => { obj.rotation[axis] += dt * rate; });
  return obj;
}

export { toon, glow };
