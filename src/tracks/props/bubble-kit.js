/**
 * Bubble Cup prop kit — small, pure helpers shared by the four Bubble Cup
 * tracks (bubblegum-bay, mermaid-lagoon, teddy-toyland, honeycomb-hive).
 * OWNER: Tracks — Bubble Cup. Everything takes the scenery `ctx` from
 * src/tracks/core.js and draws randomness only from `ctx.rng`.
 *
 *   instanced(ctx, geo, mat, matrices, { colors, outline, ow })   static instanced mesh (+ outline hull)
 *   animatedInstances(ctx, geo, mat, items, place, opts)          instanced mesh re-posed every frame
 *   patternTexture(ctx, size, fn(u, v) -> [r,g,b])                repeating DataTexture (owned)
 *   retextureRoad(ctx, tex)                                       swap the road surface texture
 *   waterGrid(ctx, { area, cell, y, wet, color, foam, deep, ... }) water sheet with a smooth shoreline
 *   frameAt(ctx, s)                                               road frame {x,y,z,tx,tz,rx,rz} at lap distance s
 *   turnCentre(ctx, frac, r, side)                                centre of a layout arc (side +1 = left turn)
 *   stripedSphere(radius, colors, segs)                           beach-ball style vertex-coloured sphere
 *   hexagonPrism(r, h)                                            flat-topped hexagon prism geometry
 */
import * as THREE from 'three';
import { frames, pushedCopy, dataTexture, smoothstep } from '../sceneryKit.js';

/** Static instanced mesh with an optional cartoon outline hull. */
export function instanced(ctx, geo, material, matrices, { colors = null, outline = true, ow = 0.06 } = {}) {
  if (!matrices.length) return null;
  const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  if (colors) {
    const c = new THREE.Color();
    matrices.forEach((m, i) => mesh.setColorAt(i, c.set(colors[i % colors.length])));
  }
  ctx.group.add(mesh);
  let out = null;
  if (outline) {
    out = new THREE.InstancedMesh(pushedCopy(geo, ow), ctx.outlineMat, matrices.length);
    matrices.forEach((m, i) => out.setMatrixAt(i, m));
    ctx.group.add(out);
  }
  return { mesh, out };
}

/**
 * Instanced mesh whose instances are re-posed every frame.
 * `place(item, t, o)` sets o.position / o.rotation / o.scale (o is a scratch Object3D).
 */
export function animatedInstances(ctx, geo, material, items, place, { colors = null, outline = false, ow = 0.06 } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  const out = outline ? new THREE.InstancedMesh(pushedCopy(geo, ow), ctx.outlineMat, items.length) : null;
  if (colors) {
    const c = new THREE.Color();
    items.forEach((it, i) => mesh.setColorAt(i, c.set(it.color ?? colors[i % colors.length])));
  }
  const o = new THREE.Object3D();
  const update = (t) => {
    for (let i = 0; i < items.length; i++) {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      place(items[i], t, o);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      if (out) out.setMatrixAt(i, o.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (out) out.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.group.add(mesh);
  if (out) ctx.group.add(out);
  ctx.animators.push((dt, t) => update(t));
  return { mesh, out, update };
}

/** Repeating procedural texture: fn(u, v) with u, v in [0, 1) returns [r, g, b]. */
export function patternTexture(ctx, size, fn) {
  return ctx.ownTex(dataTexture(size, (x, y) => {
    const [r, g, b] = fn((x + 0.5) / size, (y + 0.5) / size);
    return [clampByte(r), clampByte(g), clampByte(b), 255];
  }));
}

/**
 * Replace the road surface texture (the core maps it with one tile per 9 x 9
 * units: u = lateral / 9, v = s / 9). Use `tex.repeat` for other tile sizes.
 */
export function retextureRoad(ctx, tex) {
  const road = ctx.group.getObjectByName('road');
  if (!road) return false;
  road.material.map = tex;
  road.material.needsUpdate = true;
  return true;
}

/** Road frame at lap distance s. */
export function frameAt(ctx, s) {
  return frames(ctx.path, s, s + 0.01, 1)[0];
}

/** Centre of a layout arc: `frac` = the arc's mid lap fraction, `side` +1 for left turns, -1 for right. */
export function turnCentre(ctx, frac, r, side = 1) {
  const f = frameAt(ctx, frac * ctx.L);
  // right = (rx, rz); the centre of a left turn is on the left (-right)
  return { x: f.x - f.rx * r * side, z: f.z - f.rz * r * side, y: f.y };
}

/**
 * A water sheet with a smooth shoreline. `wet(x, z)` is a signed distance:
 * positive over water, negative on land. The sheet sinks below the ground
 * where it is dry, so the shoreline is the smooth contour where it crosses
 * the ground (no stair steps). Foam colours the first few units of water.
 */
export function waterGrid(ctx, {
  area, cell = 7, y = 0.12, sink = -0.9, wet, color = 0x7fd8ff, foam = 0xffffff, deep = null,
  foamWidth = 4, deepAt = 60, opacity = 1, emissive = 0x000000, emissiveIntensity = 0.25,
  ripples = 0, rippleTile = 22, flow = [0.004, 0.0025], side = THREE.FrontSide, skip = null,
}) {
  const w = area.maxX - area.minX, d = area.maxZ - area.minZ;
  const nx = Math.max(1, Math.ceil(w / cell)), nz = Math.max(1, Math.ceil(d / cell));
  const geo = new THREE.PlaneGeometry(w, d, nx, nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((area.minX + area.maxX) / 2, 0, (area.minZ + area.maxZ) / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const cBase = new THREE.Color(color), cFoam = new THREE.Color(foam), cDeep = new THREE.Color(deep ?? color);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const s = wet(x, z);
    pos.setY(i, THREE.MathUtils.lerp(sink, y, smoothstep(-cell * 0.6, cell * 0.6, s)));
    c.copy(cBase).lerp(cDeep, smoothstep(foamWidth, deepAt, s)).lerp(cFoam, 1 - smoothstep(0, foamWidth, s));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (skip) {
    // drop every triangle touching a skipped spot (e.g. over a lagoon cut into the ground)
    const idx = geo.index.array;
    const keep = [];
    const skipV = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) skipV[i] = skip(pos.getX(i), pos.getZ(i)) ? 1 : 0;
    for (let t = 0; t < idx.length; t += 3) {
      if (!skipV[idx[t]] && !skipV[idx[t + 1]] && !skipV[idx[t + 2]]) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    geo.setIndex(keep);
  }
  geo.computeVertexNormals();
  const mat = ctx.own(new THREE.MeshToonMaterial({
    color: 0xffffff, vertexColors: true, transparent: opacity < 1, opacity, side,
    emissive: new THREE.Color(emissive), emissiveIntensity,
  }));
  if (ripples > 0) {
    mat.map = rippleTexture(ctx, ripples);
    mat.map.repeat.set(w / rippleTile, d / rippleTile);
    ctx.animators.push((dt) => {
      mat.map.offset.x = (mat.map.offset.x + dt * flow[0]) % 1;
      mat.map.offset.y = (mat.map.offset.y + dt * flow[1]) % 1;
    });
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  ctx.group.add(mesh);
  return mesh;
}

/** Soft, seamless wavy ripple lines (white-ish on white; multiply with vertex colours). */
export function rippleTexture(ctx, strength = 0.18) {
  return patternTexture(ctx, 128, (u, v) => {
    const a = Math.sin((v + Math.sin(u * Math.PI * 4) * 0.05) * Math.PI * 12);
    const b = Math.sin((u + Math.sin(v * Math.PI * 2) * 0.08) * Math.PI * 6 + 1.3);
    const line = smoothstep(0.82, 0.98, a) * 0.8 + smoothstep(0.9, 1, b) * 0.4;
    const k = 1 - strength + line * strength * 2.2;
    return [255 * Math.min(1.25, k), 255 * Math.min(1.25, k), 255 * Math.min(1.25, k)];
  });
}

/** Beach-ball style sphere: vertex colours in longitude segments (use with ctx.toonVC()). */
export function stripedSphere(radius, colors, segs = 12) {
  const g = new THREE.SphereGeometry(radius, segs, Math.max(6, segs / 2 + 2)).toNonIndexed();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += pos.getX(i + k); y += pos.getY(i + k); z += pos.getZ(i + k); }
    const a = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1;
    const cap = Math.abs(y / 3) > radius * 0.86;
    c.set(cap ? 0xffffff : colors[Math.floor(a * colors.length) % colors.length]);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Hexagon prism (pointy side along x), centred, height along y. */
export function hexagonPrism(r = 1, h = 1) {
  return new THREE.CylinderGeometry(r, r, h, 6, 1);
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
