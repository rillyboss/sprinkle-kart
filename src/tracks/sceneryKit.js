import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import {
  FENCE_OFFSET, TREE_CAMERA_CLEARANCE, CANOPY_REACH,
  heartShape, archShape, pushedCopy, mat4, swirlTexture, sparkleTexture,
} from './geometry.js';

/**
 * Scenery kit — reusable, themeable props for track modules.
 *
 * The track core calls createSceneryHelpers(ctx) and puts the returned
 * helpers on the scenery ctx, so a track module simply destructures them:
 *
 *   export function buildScenery(ctx) {
 *     const { scatter, cottonCandyTrees, clearOfRoad, FENCE_OFFSET } = ctx;
 *     cottonCandyTrees(scatter(80, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 4)), [0xffa6d8, 0xa8d8ff]);
 *   }
 *
 *   scatter(count, ok(x,z), { pad=110, tries=40, area })       -> [[x,z], ...] random spots passing ok()
 *   cottonCandyTrees(spots, palette, { stick, puffScale })      instanced fluffy trees (kept clear of cameras)
 *   floatingShapes(geo, spots, palette, { yMin, yMax, scale:[a,b], glowy })   bobbing, spinning shapes
 *   sparkles(n, cx, cz, radius, yMin, yMax, colors, size)       twinkling point sprites
 *   backgroundHills(n, rMin, rMax, palette, { hMin, hMax, widthMul })  soft hills ring far away
 *   lollipops(spots, [[c1, c2], ...], { height:[a,b], radius:[a,b] })  giant swirl lollipops
 *   tower(x, y, z, r, h, { wall, roof, trim, roofH, flag, windows })  cone-roofed tower (batched)
 *   heartFlag(x, y, z, color)                                  waving heart flag on a pole
 *   fallingSprinkles(n)                                        gently falling sprinkle snow
 *
 * Everything is deterministic: helpers draw from ctx.rng (seeded by track id).
 * Order matters — the same calls in the same order build the same world.
 */

export * from './geometry.js';
export { makeRng, seedFromString, smoothstep, distToPolyline } from './pathTools.js';

/**
 * @param {object} ctx the scenery context (see src/tracks/core.js)
 * @returns {object} bound helper functions (also assigned onto ctx by the core)
 */
export function createSceneryHelpers(ctx) {
  const { group, rng, batch, own, ownTex, outlineMat, toonTex, bounds, center, extent, hw, groundH, distToRoad, animators } = ctx;
  const flagGeo = ctx.flagGeo;
  const flags = [];
  animators.push((dt, t) => {
    for (const f of flags) {
      f.m.rotation.y = 0.9 + Math.sin(t * 1.3 + f.ph) * 0.6;
      f.m.scale.x = 1.6 * (0.85 + Math.sin(t * 5 + f.ph) * 0.15);
    }
  });

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

  return { scatter, cottonCandyTrees, floatingShapes, sparkles, backgroundHills, lollipops, tower, heartFlag, fallingSprinkles };
}
