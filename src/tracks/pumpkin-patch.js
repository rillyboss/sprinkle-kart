/**
 * Pumpkin Pie Patch — track module (data + scenery). Cup: cozy-cup.
 * OWNER: Tracks — Cozy Cup.
 *
 * A golden-hour harvest farm. Rolling farm road with hay-bale hops, a swoopy
 * S through the corn, a long downhill sweeper past a giant smiling pumpkin, a
 * red covered bridge over Apple Juice Creek and a hairpin round the spinning
 * pie windmills. Every pumpkin is a happy one.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, frames, ribbon, wall, mat4, extruded, pushedCopy } from './sceneryKit.js';
import { instanced, faceRoad, drifting } from './props/cozy-kit.js';

export const def = makeTrack(
  {
    id: 'pumpkin-patch',
    name: 'Pumpkin Pie Patch',
    subtitle: 'Smiley pumpkins and spinning pie windmills',
    laps: 3,
    width: 19,
    previewColor: 0xff9a3c,
    art: ['🎃', '🥧', '🌻'], // menu card emoji: big, bottom-left, top-right
    cup: 'cozy-cup',
    unlock: { type: 'distinct-tracks', result: 'top3', count: 2 },
    theme: {
      skyTop: 0x6fa9ff,
      skyBottom: 0xffe2b8,
      fogColor: 0xffe7c9,
      fogNear: 170,
      fogFar: 650,
      ground: 0xc6d36a,
      road: 0xd39a5f, // packed pie-crust dirt road
      roadAlt: 0xc28850,
      curbA: 0xff8a2a,
      curbB: 0xfff3d6,
      offRoad: 0xe9cb82, // straw
      music: 'pumpkin-patch',
      sunColor: 0xffdcaa,
      ambientColor: 0xffe8d2,
      // builder theme extras (see ARCHITECTURE.md -> theme fields)
      roadSprinkles: { style: 'dots', count: 150, palette: [0xff8a2a, 0xffc93d, 0xe0612f, 0xa8c85a, 0xfff1c9] },
      groundTints: [0xe6c65c, 0xa6c95a, 0xdca24e],
      groundTintMix: 0.65,
      skirt: { color: 0xe8b25a, trim: 0xff8a2a },
      pillar: { shape: 'box', color: 0xa8743f, ring: 0xffc93d },
    },
  },
  {
    start: [0, 0],
    heading: 0,
    startAt: 54,
    ops: [
      { s: 150, flex: true, mark: 'start-straight' },
      { turn: 100, r: 58, y: 2, mark: 'barn-bend' },
      { s: 70, y: 3, flex: true, hump: 2, mark: 'hay-hop' },
      { turn: 45, r: 70, y: 5, mark: 'sweep-a' },
      { turn: -55, r: 70, y: 7, mark: 'sweep-b' },
      { turn: 60, r: 55, y: 7, mark: 'corn-corner' },
      { turn: 40, r: 160, y: 3, mark: 'long-sweeper' },
      { turn: 80, r: 58, y: 1, mark: 'creek-bend' },
      { s: 50, y: 1.5, mark: 'covered-bridge' },
      { turn: 80, r: 36, y: 2, mark: 'lane-turn' },
      { s: 50, y: 4, mark: 'windmill-lane' },
      { turn: -180, r: 32, y: 5, mark: 'windmill-hairpin' },
      { s: 50, y: 3, mark: 'lane-back' },
      { turn: 90, r: 34, y: 1, mark: 'orchard-turn' },
      { s: 30, y: 0, mark: 'orchard' },
      { turn: 100, r: 44, y: 0, mark: 'home-bend' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [
      frac('hay-hop', 'start') + 0.004,
      frac('sweep-b', 'end'),
      frac('long-sweeper', 'end'),
      frac('windmill-lane', 'mid'),
      frac('orchard', 'mid'),
    ],
    boostPads: [
      { at: frac('start-straight', 'end') - 0.02, lateral: -4 },
      { at: frac('hay-hop', 'end') - 0.006, lateral: 3 },
      { at: frac('long-sweeper', 'start') + 0.01, lateral: -3.5 },
      { at: frac('windmill-hairpin', 'end') + 0.012, lateral: 3 },
    ],
    scenery: {
      kind: 'pumpkin-patch',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 7, scale: 0.012 },
      bridges: [[frac('covered-bridge', 'start') - 0.012, frac('covered-bridge', 'end') + 0.012]],
      river: { at: frac('covered-bridge', 'mid') },
      coveredBridge: [frac('covered-bridge', 'start') + 0.002, frac('covered-bridge', 'end') - 0.002],
      windmill: { at: frac('windmill-hairpin', 'mid'), lateral: 32 },
      hayHop: frac('hay-hop', 'mid'),
      barn: { at: frac('barn-bend', 'mid') },
      sweeper: frac('long-sweeper', 'mid'),
      orchard: frac('orchard', 'mid'),
      fence: { post: 0xa8743f, postAlt: 0xc98f5a, rail: 0xf6ddb0, topper: 'ball', topperColor: 0xff8a2a },
      arch: { a: 0xff8a2a, b: 0xfff3d6, banner: 0xa4552a, text: 'HAPPY HARVEST' },
    },
  }),
);

// ---------------------------------------------------------------------------
// Geometry builders (pure, reused per instance)
// ---------------------------------------------------------------------------

/** A plump ribbed pumpkin, radius ~1, sitting on y = 0 (top at ~1.48). */
export function pumpkinGeometry(ribs = 8, wSeg = 20, hSeg = 10) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rib = 1 + 0.085 * Math.cos(a * ribs);
    const pinch = 1 - 0.18 * Math.pow(Math.abs(y), 6); // dimples top and bottom
    p.setXYZ(i, x * rib * pinch, y * 0.74 + 0.74, z * rib * pinch);
  }
  g.computeVertexNormals();
  return g;
}

/** A leaf shape (autumn leaves drifting down). */
function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.quadraticCurveTo(0.55, -0.1, 0.35, 0.25);
  s.quadraticCurveTo(0.2, 0.55, 0, 0.6);
  s.quadraticCurveTo(-0.2, 0.55, -0.35, 0.25);
  s.quadraticCurveTo(-0.55, -0.1, 0, -0.5);
  return new THREE.ShapeGeometry(s, 4);
}

/** Flower outline with `n` round petals. */
function flowerShape(n, outer, inner, per = 8) {
  const s = new THREE.Shape();
  for (let i = 0; i <= n * per; i++) {
    const a = (i / (n * per)) * Math.PI * 2;
    const r = inner + (outer - inner) * Math.abs(Math.sin((a * n) / 2));
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  return s;
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md -> "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, outlineMat,
    hw, L, center, extent, groundH, distToRoad, clearOfRoad, animate,
    scatter, floatingShapes, sparkles, backgroundHills,
  } = ctx;
  const sc = def.scenery;
  const col = new THREE.Color();
  const pumpGeo = pumpkinGeometry();
  const pumpSmallGeo = pumpkinGeometry(6, 12, 6);
  const PUMPKIN_COLORS = [0xff8a2a, 0xff9f40, 0xffb347, 0xf57a1f, 0xffc15e];
  const faceItems = { eye: [], shine: [], cheek: [], smile: [] };

  buildCreek();
  buildPumpkinFields();
  buildHeroPumpkins();
  buildWindmills();
  buildBarn();
  buildHayBales();
  buildCorn();
  buildSunflowers();
  buildOrchard();
  buildCoveredBridge();
  buildPieStand();
  buildFaces();
  buildSky();

  // ----- creek under the covered bridge ------------------------------------
  function buildCreek() {
    const river = sc.riverLine || [];
    if (river.length < 2) return;
    const pos = [];
    const y = -1.5;
    for (let i = 0; i < river.length - 1; i++) {
      const [ax, az] = river[i], [bx, bz] = river[i + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const taper = (k) => 7 * Math.min(1, 0.35 + Math.min(k, river.length - 1 - k) * 0.22);
      const wa = taper(i), wb = taper(i + 1);
      const ux = -dz / len, uz = dx / len;
      pos.push(ax - ux * wa, y, az - uz * wa, bx - ux * wb, y, bz - uz * wb, ax + ux * wa, y, az + uz * wa);
      pos.push(ax + ux * wa, y, az + uz * wa, bx - ux * wb, y, bz - uz * wb, bx + ux * wb, y, bz + uz * wb);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const water = own(toon(0x8fd8ff, { unique: true, emissive: 0x2a6a9a, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(g, water);
    mesh.name = 'apple-juice-creek';
    group.add(mesh);
    animate((dt, t) => { water.emissiveIntensity = 0.22 + Math.sin(t * 1.7) * 0.06; });
    // apples bobbing on the water
    const bob = [];
    for (let i = 1; i < river.length - 1; i += 2) {
      const [x, z] = river[i];
      bob.push({ x: x + (rng() - 0.5) * 6, z: z + (rng() - 0.5) * 6, ph: rng() * 6 });
    }
    if (!bob.length) return;
    const apple = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 10, 8), toon(0xff4d5e, { emissive: 0x551010, emissiveIntensity: 0.3 }), bob.length);
    apple.name = 'creek-apples';
    group.add(apple);
    const write = (t) => {
      bob.forEach((b, i) => apple.setMatrixAt(i, mat4(b.x + Math.sin(t * 0.4 + b.ph) * 1.2, y + 0.2 + Math.sin(t * 1.6 + b.ph) * 0.12, b.z, { ry: t * 0.3 + b.ph })));
      apple.instanceMatrix.needsUpdate = true;
    };
    write(0);
    animate((dt, t) => write(t));
  }

  // ----- pumpkin patches -----------------------------------------------------
  function buildPumpkinFields() {
    const centers = scatter(14, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 10) && distToRoad(x, z, 120) < hw + 70, { pad: 60 });
    const items = [];
    const stems = [];
    const leaves = [];
    for (const [cx, cz] of centers) {
      const n = 8 + Math.floor(rng() * 10);
      for (let k = 0; k < n; k++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 13;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const s = 0.9 + rng() * 1.3;
        if (!clearOfRoad(x, z, FENCE_OFFSET + 1.5 + s)) continue;
        const y = groundH(x, z) - 0.15;
        const sy = s * (0.85 + rng() * 0.3);
        items.push({ m: mat4(x, y, z, { s: [s, sy, s], ry: rng() * 6 }), color: PUMPKIN_COLORS[items.length % PUMPKIN_COLORS.length] });
        stems.push(mat4(x, y + sy * 1.42, z, { s, rz: 0.2 }));
        leaves.push(mat4(x + s * 0.9, y + 0.05, z + s * 0.4, { ry: rng() * 6, s: s * 0.9 }));
      }
    }
    instanced(ctx, pumpSmallGeo, toon(0xffffff, { emissive: 0x3a1500, emissiveIntensity: 0.25 }), items, { name: 'field-pumpkins', ow: 0.07 });
    instanced(ctx, new THREE.CylinderGeometry(0.1, 0.16, 0.5, 5), toon(0x6d9a3a), stems, { outline: false, name: 'pumpkin-stems' });
    const leafGeo = new THREE.CircleGeometry(0.7, 6);
    leafGeo.rotateX(-Math.PI / 2);
    instanced(ctx, leafGeo, toon(0x7fb04a, { side: THREE.DoubleSide }), leaves, { outline: false, name: 'pumpkin-leaves' });
  }

  /** Big friendly pumpkins by the road, each with a painted-on smile facing the racers. */
  function buildHeroPumpkins() {
    const spots = [];
    for (const [x, z] of scatter(80, (x, z) => {
      const d = distToRoad(x, z, 60);
      return d > hw + FENCE_OFFSET + 7 && d < hw + 34;
    }, { pad: 40 })) {
      const R = 2.4 + rng() * 2.4;
      if (!clearOfRoad(x, z, FENCE_OFFSET + R + 3)) continue;
      if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 30)) continue;
      spots.push({ x, z, R });
      if (spots.length >= 18) break;
    }
    // the giant one by the long sweeper
    const s = sc.sweeper * L;
    const giant = [];
    for (const lat of [-(hw + 36), hw + 36]) {
      const p = path.positionAt(s, lat);
      if (clearOfRoad(p.x, p.z, FENCE_OFFSET + 20)) {
        // looks back up the road so racers see the smile as they arrive
        const q = path.pointAt(s - 70);
        giant.push({ x: p.x, z: p.z, R: 13, face: Math.atan2(q.x - p.x, q.z - p.z) });
        break;
      }
    }
    const all = [...spots, ...giant];
    const items = all.map((p, i) => {
      const y = groundH(p.x, p.z) - 0.3;
      const h = p.face ?? faceRoad(ctx, p.x, p.z);
      p.y = y; p.h = h;
      addFace(p.x, y, p.z, p.R, h, i);
      return { m: mat4(p.x, y, p.z, { s: [p.R, p.R * 0.95, p.R], ry: h }), color: PUMPKIN_COLORS[i % PUMPKIN_COLORS.length] };
    });
    instanced(ctx, pumpGeo, toon(0xffffff, { emissive: 0x3a1500, emissiveIntensity: 0.28 }), items, { name: 'smiley-pumpkins', ow: 0.035 });
    const stemGeo = new THREE.CylinderGeometry(0.12, 0.2, 0.7, 6);
    stemGeo.translate(0, 0.35, 0);
    instanced(ctx, stemGeo, toon(0x6d9a3a), all.map((p) => mat4(p.x, p.y + p.R * 1.36, p.z, { s: p.R, rz: 0.25, ry: p.h })), { name: 'smiley-stems' });
    // a little straw sun hat on the giant
    for (const g of giant) {
      const y = g.y + g.R * 1.38;
      batch.add(new THREE.CylinderGeometry(g.R * 0.75, g.R * 0.75, 0.5, 24), toon(0xf6d77a), mat4(g.x, y, g.z));
      batch.add(new THREE.CylinderGeometry(g.R * 0.38, g.R * 0.42, g.R * 0.35, 20), toon(0xf6d77a), mat4(g.x, y + g.R * 0.17, g.z));
      batch.add(new THREE.CylinderGeometry(g.R * 0.43, g.R * 0.43, g.R * 0.08, 20), toon(0xff6f9a), mat4(g.x, y + g.R * 0.07, g.z), false);
    }
  }

  /** Painted-on face: eyes with shines, rosy cheeks and a big smile (winks now and then). */
  function addFace(x, y, z, R, h, i) {
    const base = mat4(x, y, z, { ry: h, s: [R, R * 0.95, R] });
    const onSurf = (dx, dy, sx, sy, sz, rz = 0, push = 1) => {
      const d = new THREE.Vector3(dx, dy, 1).normalize();
      const local = mat4(d.x * push, 0.74 + d.y * 0.74 * push, d.z * push, { ry: Math.atan2(d.x, d.z), rx: -Math.asin(d.y), rz, s: [sx, sy, sz] });
      return new THREE.Matrix4().multiplyMatrices(base, local);
    };
    const wink = i % 5 === 3;
    for (const side of [-1, 1]) {
      if (wink && side > 0) {
        faceItems.smile.push(onSurf(0.3, 0.26, 0.32, 0.32, 0.32, 0, 1.01));
      } else {
        faceItems.eye.push(onSurf(side * 0.3, 0.2, 0.11, 0.16, 0.06));
        faceItems.shine.push(onSurf(side * 0.3 + 0.035, 0.26, 0.04, 0.04, 0.03, 0, 1.04));
      }
      faceItems.cheek.push(onSurf(side * 0.52, -0.08, 0.13, 0.08, 0.04));
    }
    faceItems.smile.push(onSurf(0, -0.1, 0.9, 0.9, 0.9, Math.PI, 1.01));
  }

  function buildFaces() {
    instanced(ctx, new THREE.SphereGeometry(1, 10, 8), toon(0x3a2046), faceItems.eye, { outline: false, name: 'pumpkin-eyes' });
    instanced(ctx, new THREE.SphereGeometry(1, 6, 4), glow(0xffffff), faceItems.shine, { outline: false, name: 'pumpkin-eye-shine' });
    instanced(ctx, new THREE.SphereGeometry(1, 10, 6), toon(0xff7a9a, { emissive: 0x551020, emissiveIntensity: 0.3 }), faceItems.cheek, { outline: false, name: 'pumpkin-cheeks' });
    const smileGeo = new THREE.TorusGeometry(0.3, 0.045, 5, 14, Math.PI);
    instanced(ctx, smileGeo, toon(0x3a2046), faceItems.smile, { outline: false, name: 'pumpkin-smiles' });
  }

  // ----- pie windmills ---------------------------------------------------------
  function buildWindmills() {
    const w = sc.windmill;
    const s = w.at * L;
    const p = path.positionAt(s, w.lateral);
    const mills = [{ x: p.x, z: p.z, size: 1, face: path.headingAt(s) }];
    // two more on far hills so they can be seen from all around the farm
    for (const [x, z] of scatter(30, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 30) && distToRoad(x, z, 200) < hw + 110, { pad: 90 })) {
      if (mills.some((m) => Math.hypot(m.x - x, m.z - z) < 140)) continue;
      mills.push({ x, z, size: 1.25, face: faceRoad(ctx, x, z) });
      if (mills.length >= 3) break;
    }
    const crust = toon(0xe8a64a);
    const cream = toon(0xfff1d6);
    const filling = toon(0xff8a2a, { emissive: 0x401800, emissiveIntensity: 0.3 });
    const bladeGeo = pieBladeGeometry();
    const bladeOut = pushedCopy(bladeGeo, 0.14);
    mills.forEach((m, k) => {
      const y = groundH(m.x, m.z) - 0.4;
      const S = m.size;
      const H = 17 * S;
      batch.add(new THREE.CylinderGeometry(3.2 * S, 4.6 * S, H, 10), cream, mat4(m.x, y + H / 2, m.z));
      // a pumpkin pie for a roof: crust, filling and a whipped-cream dollop
      batch.add(new THREE.CylinderGeometry(4.2 * S, 3.6 * S, 2.2 * S, 18), crust, mat4(m.x, y + H + 1.1 * S, m.z));
      batch.add(new THREE.CylinderGeometry(3.7 * S, 3.7 * S, 0.3, 18), filling, mat4(m.x, y + H + 2.25 * S, m.z), false);
      batch.add(new THREE.TorusGeometry(3.9 * S, 0.45 * S, 6, 22), crust, mat4(m.x, y + H + 2.25 * S, m.z, { rx: Math.PI / 2 }), false);
      batch.add(new THREE.SphereGeometry(1.1 * S, 12, 8), toon(0xffffff), mat4(m.x, y + H + 2.8 * S, m.z, { s: [1, 0.8, 1] }));
      // door and round windows on the front
      const fx = Math.sin(m.face), fz = Math.cos(m.face);
      batch.add(new THREE.CircleGeometry(1.4 * S, 14), toon(0x9a5a2e), mat4(m.x + fx * 4.45 * S, y + 1.6 * S, m.z + fz * 4.45 * S, { ry: m.face, rx: -0.08 }), false);
      for (const hh of [0.45, 0.72]) {
        const rr = (4.6 - 1.4 * hh) * S + 0.06;
        batch.add(new THREE.CircleGeometry(0.9 * S, 12), glow(0xfff1a8), mat4(m.x + fx * rr, y + H * hh, m.z + fz * rr, { ry: m.face, rx: -0.08 }), false);
      }
      // spinning pie-slice sails
      const hub = new THREE.Group();
      const hr = 3.7 * S;
      hub.position.set(m.x + fx * hr, y + H * 0.82, m.z + fz * hr);
      hub.rotation.y = m.face;
      hub.scale.setScalar(S);
      const rotor = new THREE.Group();
      rotor.add(new THREE.Mesh(bladeGeo, crust), new THREE.Mesh(bladeOut, outlineMat));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), filling);
      cap.position.z = 0.8;
      rotor.add(cap);
      hub.add(rotor);
      hub.name = 'pie-windmill';
      group.add(hub);
      const speed = 0.7 + k * 0.15;
      animate((dt, t) => { rotor.rotation.z = -t * speed; });
    });
  }

  /** Four pie-slice sails (merged) around the origin in the XY plane. */
  function pieBladeGeometry() {
    const parts = [];
    for (let k = 0; k < 4; k++) {
      const wedge = new THREE.CylinderGeometry(9, 9, 0.6, 6, 1, false, -0.26, 0.52);
      wedge.rotateX(Math.PI / 2);
      wedge.rotateZ((k * Math.PI) / 2);
      wedge.translate(0, 0, 0.6);
      parts.push(wedge);
      const arm = new THREE.BoxGeometry(0.5, 9.2, 0.5);
      arm.translate(0, 4.6, 0.2);
      arm.rotateZ((k * Math.PI) / 2 - Math.PI / 2);
      parts.push(arm);
    }
    const clean = parts.map((g) => {
      const n = g.toNonIndexed();
      for (const a of Object.keys(n.attributes)) if (a !== 'position' && a !== 'normal') n.deleteAttribute(a);
      return n;
    });
    const g = mergeGeometries(clean);
    g.computeVertexNormals();
    return g;
  }

  // ----- a red barn and silo -------------------------------------------------------
  function buildBarn() {
    const s = sc.barn.at * L;
    let spot = null;
    for (const lat of [-(hw + 32), hw + 32, -(hw + 46), hw + 46]) {
      const p = path.positionAt(s, lat);
      if (clearOfRoad(p.x, p.z, FENCE_OFFSET + 17)) { spot = p; break; }
    }
    if (!spot) return;
    const x = spot.x, z = spot.z, y = groundH(x, z) - 0.3;
    const h = faceRoad(ctx, x, z);
    const red = toon(0xe0584a), white = toon(0xfff6ea), roof = toon(0x8a3a3a);
    const c = Math.cos(h), sn = Math.sin(h);
    const at = (dx, dy, dz, o = {}) => mat4(x + dx * c + dz * sn, y + dy, z - dx * sn + dz * c, { ...o, ry: h + (o.ry || 0) });
    batch.add(new THREE.BoxGeometry(18, 11, 14), red, at(0, 5.5, 0));
    const prism = new THREE.CylinderGeometry(1, 1, 1, 3);
    prism.rotateX(-Math.PI / 2); // ridge along local z, apex up
    batch.add(prism, roof, at(0, 13.4, 0, { s: [10.4, 5.2, 15] }));
    batch.add(new THREE.BoxGeometry(7, 8, 0.4), white, at(0, 4, 7.05), false);
    batch.add(new THREE.BoxGeometry(6, 7, 0.5), red, at(0, 3.9, 7.1), false);
    for (const d of [1, -1]) batch.add(new THREE.BoxGeometry(0.6, 9, 0.3), white, at(0, 3.9, 7.4, { rz: d * 0.72 }), false);
    batch.add(new THREE.CircleGeometry(1.4, 16), glow(0xfff1a8), at(0, 11, 7.06), false);
    // silo with a round cap
    const sx = 13;
    batch.add(new THREE.CylinderGeometry(4, 4, 18, 16), toon(0xdcdce8), at(sx, 9, -2));
    batch.add(new THREE.SphereGeometry(4.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xff8a2a), at(sx, 18, -2));
    for (const hh of [5, 11]) batch.add(new THREE.TorusGeometry(4.05, 0.25, 5, 20), white, at(sx, hh, -2, { rx: Math.PI / 2 }), false);
  }

  // ----- hay bales for the hay-bale hop ---------------------------------------------
  function buildHayBales() {
    const round = [], square = [];
    const hopS = sc.hayHop * L;
    for (let k = -3; k <= 3; k++) {
      for (const side of [-1, 1]) {
        const s = hopS + k * 12;
        const p = path.positionAt(s, side * (hw + FENCE_OFFSET + 3.5 + (k & 1) * 2));
        const y = groundH(p.x, p.z);
        const hh = path.headingAt(s);
        square.push(mat4(p.x, y + 0.7, p.z, { ry: hh + (rng() - 0.5) * 0.3 }));
        if (k % 2 === 0) square.push(mat4(p.x + (rng() - 0.5), y + 2.1, p.z + (rng() - 0.5), { ry: hh + 0.2 }));
      }
    }
    for (const [x, z] of scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 3.5), { pad: 90 })) {
      const y = groundH(x, z);
      round.push(mat4(x, y + 1.2, z, { rz: Math.PI / 2, ry: rng() * 6 }));
    }
    const bale = new THREE.CylinderGeometry(1.25, 1.25, 1.7, 16);
    instanced(ctx, bale, toon(0xf2cf6a), round, { name: 'round-bales' });
    const disc = new THREE.CircleGeometry(0.9, 12);
    const swirls = [];
    round.forEach((m) => {
      for (const d of [-1, 1]) swirls.push(new THREE.Matrix4().multiplyMatrices(m, mat4(0, d * 0.86, 0, { rx: -d * Math.PI / 2 })));
    });
    instanced(ctx, disc, toon(0xdcae4a, { side: THREE.DoubleSide }), swirls, { outline: false, name: 'bale-ends' });
    instanced(ctx, new THREE.BoxGeometry(1.4, 1.4, 2.6), toon(0xebc75c), square, { name: 'square-bales' });
  }

  // ----- corn rows -------------------------------------------------------------------
  function buildCorn() {
    const stalks = [], cobs = [];
    const fields = scatter(10, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 14) && distToRoad(x, z, 140) < hw + 80, { pad: 50 });
    for (const [cx, cz] of fields) {
      const a = rng() * Math.PI;
      const ux = Math.cos(a), uz = Math.sin(a);
      for (let r = -3; r <= 3; r++) {
        for (let c = -5; c <= 5; c++) {
          const x = cx + ux * c * 2.2 - uz * r * 3, z = cz + uz * c * 2.2 + ux * r * 3;
          if (!clearOfRoad(x, z, FENCE_OFFSET + 3)) continue;
          const y = groundH(x, z);
          const h = 3.6 + rng() * 1.6;
          stalks.push(mat4(x, y + h / 2, z, { s: [1, h, 1], ry: rng() * 6 }));
          if (rng() < 0.6) cobs.push(mat4(x + 0.3, y + h * 0.62, z, { rz: -0.5, ry: rng() * 6 }));
        }
      }
    }
    const stalkGeo = new THREE.ConeGeometry(0.45, 1, 5, 1);
    instanced(ctx, stalkGeo, toon(0x8cc04a), stalks, { name: 'corn-stalks', ow: 0.05 });
    instanced(ctx, new THREE.CylinderGeometry(0.2, 0.26, 0.9, 6), toon(0xffd93d), cobs, { outline: false, name: 'corn-cobs' });
  }

  // ----- sunflowers along the road ---------------------------------------------------
  function buildSunflowers() {
    const stems = [], heads = [], centers = [];
    const spots = scatter(90, (x, z) => {
      const d = distToRoad(x, z, 30);
      return d > hw + FENCE_OFFSET + 1.8 && d < hw + FENCE_OFFSET + 9;
    }, { pad: 30 });
    for (const [x, z] of spots) {
      const y = groundH(x, z);
      const h = 3 + rng() * 2.2;
      const face = faceRoad(ctx, x, z);
      stems.push(mat4(x, y + h / 2, z, { s: [1, h, 1] }));
      const hm = mat4(x, y + h + 0.2, z, { ry: face, rx: -0.3 });
      heads.push(hm);
      centers.push(new THREE.Matrix4().multiplyMatrices(hm, mat4(0, 0, 0.12)));
    }
    instanced(ctx, new THREE.CylinderGeometry(0.1, 0.13, 1, 5), toon(0x5f9a3a), stems, { outline: false, name: 'sunflower-stems' });
    const petals = extruded(flowerShape(10, 1.3, 0.75, 4), 0.12, 0, 1);
    instanced(ctx, petals, toon(0xffd23a, { emissive: 0x402a00, emissiveIntensity: 0.25 }), heads, { name: 'sunflower-petals', ow: 0.05 });
    const disc = new THREE.CylinderGeometry(0.62, 0.62, 0.2, 12);
    disc.rotateX(Math.PI / 2);
    instanced(ctx, disc, toon(0x7a4a2a), centers, { outline: false, name: 'sunflower-centres' });
  }

  // ----- apple orchard -----------------------------------------------------------------
  function buildOrchard() {
    const trunks = [], crowns = [], apples = [];
    const near = path.pointAt(sc.orchard * L);
    const spots = scatter(120, (x, z) => Math.hypot(x - near.x, z - near.z) < 170 && clearOfRoad(x, z, FENCE_OFFSET + 9), { pad: 60 });
    for (const [x, z] of spots) {
      if (crowns.length >= 34) break;
      const y = groundH(x, z);
      const R = 2.6 + rng() * 1.4;
      if (!clearOfRoad(x, z, FENCE_OFFSET + R + 4)) continue;
      const th = 3 + rng();
      trunks.push(mat4(x, y + th / 2, z, { s: [1, th, 1] }));
      crowns.push(mat4(x, y + th + R * 0.7, z, { s: [R, R * 0.85, R], ry: rng() * 6 }));
      for (let k = 0; k < 6; k++) {
        const a = rng() * Math.PI * 2, e = rng() * 0.9 - 0.2;
        apples.push(mat4(x + Math.cos(a) * Math.cos(e) * R * 0.98, y + th + R * 0.7 + Math.sin(e) * R * 0.85, z + Math.sin(a) * Math.cos(e) * R * 0.98, { s: 0.38 }));
      }
    }
    instanced(ctx, new THREE.CylinderGeometry(0.35, 0.5, 1, 6), toon(0x8a5a36), trunks, { outline: false, name: 'apple-trunks' });
    instanced(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0x6fbf4a, { emissive: 0x0a2a00, emissiveIntensity: 0.3 }), crowns, { name: 'apple-crowns' });
    instanced(ctx, new THREE.IcosahedronGeometry(1, 0), toon(0xff4d5e, { emissive: 0x551010, emissiveIntensity: 0.35 }), apples, { outline: false, name: 'apples' });
  }

  // ----- the red covered bridge ---------------------------------------------------------
  function buildCoveredBridge() {
    const [a, b] = sc.coveredBridge;
    const fr = frames(path, a * L, b * L, 1.5);
    const span = hw + FENCE_OFFSET + 1.2;
    const wallMat = own(toon(0xd9534a, { unique: true, side: THREE.DoubleSide }));
    const roofMat = own(toon(0x8a3a34, { unique: true, side: THREE.DoubleSide }));
    const trimMat = toon(0xfff3d6);
    const top = (f) => f.y + 7.2;
    const low = (f) => f.y + 2.2; // a window band so racers can still peek at the creek
    const walls = mergeGeometries([
      wall(fr, span, top, (f) => f.y + 4.8), wall(fr, -span, top, (f) => f.y + 4.8),
      wall(fr, span, low, (f) => f.y - 0.6), wall(fr, -span, low, (f) => f.y - 0.6),
    ]);
    const wm = new THREE.Mesh(walls, wallMat);
    wm.name = 'covered-bridge';
    group.add(wm);
    const lift = (f, lat) => (span + 1.5 - Math.abs(lat)) * 0.42;
    const roof = mergeGeometries([ribbon(fr, -span - 1.5, 0, 7.2, { lift }), ribbon(fr, 0, span + 1.5, 7.2, { lift })]);
    group.add(new THREE.Mesh(roof, roofMat));
    // posts and portal beams (cream trim)
    for (let k = 0; k < fr.length; k += 3) {
      const f = fr[k];
      for (const side of [-1, 1]) {
        batch.add(new THREE.BoxGeometry(0.6, 8, 0.6), trimMat, mat4(f.x + f.rx * side * span, f.y + 3.4, f.z + f.rz * side * span, { ry: Math.atan2(f.tx, f.tz) }), false);
      }
    }
    for (const f of [fr[0], fr[fr.length - 1]]) {
      const ry = Math.atan2(f.tx, f.tz);
      batch.add(new THREE.BoxGeometry(span * 2 + 1, 1.1, 0.8), trimMat, mat4(f.x, f.y + 7.4, f.z, { ry }));
      // a little pie sign over each portal
      const sign = new THREE.CylinderGeometry(2.1, 2.1, 0.5, 18);
      sign.rotateX(Math.PI / 2);
      batch.add(sign, toon(0xe8a64a), mat4(f.x, f.y + 10.6, f.z, { ry }));
      const fill = new THREE.CylinderGeometry(1.7, 1.7, 0.6, 18);
      fill.rotateX(Math.PI / 2);
      batch.add(fill, toon(0xff8a2a), mat4(f.x, f.y + 10.6, f.z, { ry }), false);
    }
  }

  // ----- pie stand by the start line ------------------------------------------------------
  function buildPieStand() {
    const s = L - 34;
    for (const side of [1, -1]) {
      const p = path.positionAt(s, side * (hw + FENCE_OFFSET + 9));
      if (!clearOfRoad(p.x, p.z, FENCE_OFFSET + 5)) continue;
      const y = groundH(p.x, p.z);
      const h = path.headingAt(s) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      const c = Math.cos(h), sn = Math.sin(h);
      const at = (dx, dy, dz, o = {}) => mat4(p.x + dx * c + dz * sn, y + dy, p.z - dx * sn + dz * c, { ...o, ry: h + (o.ry || 0) });
      batch.add(new THREE.BoxGeometry(8, 2.4, 3), toon(0xb87a48), at(0, 1.2, 0));
      for (const dx of [-3.7, 3.7]) batch.add(new THREE.BoxGeometry(0.4, 5, 0.4), toon(0xfff3d6), at(dx, 3.6, -1.2), false);
      batch.add(new THREE.BoxGeometry(9, 0.3, 4), toon(0xff8a2a), at(0, 6.1, -0.2, { rx: 0.25 }));
      for (let k = -1; k <= 1; k++) {
        batch.add(new THREE.CylinderGeometry(1.1, 0.9, 0.5, 14), toon(0xe8a64a), at(k * 2.5, 2.65, 0.2));
        batch.add(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 14), toon(0xff8a2a), at(k * 2.5, 2.92, 0.2), false);
        batch.add(new THREE.SphereGeometry(0.35, 8, 6), toon(0xffffff), at(k * 2.5, 3.05, 0.2), false);
      }
      break;
    }
  }

  // ----- sky: pumpkin hot-air balloons, drifting leaves, sparkles, far hills -------------
  function buildSky() {
    backgroundHills(22, extent + 250, extent + 420, [0xe0a040, 0xc8d06a, 0xd9803a, 0xa8c05a, 0xf2c060], { hMin: 28, hMax: 70 });
    const balloons = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng() * 0.5;
      const r = extent * (0.35 + rng() * 0.5);
      balloons.push({ x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, y: 42 + rng() * 26, ph: rng() * 6, s: 3.2 + rng() * 1.5 });
    }
    const bMesh = new THREE.InstancedMesh(pumpkinGeometry(8, 16, 10), toon(0xffffff, { emissive: 0x3a1500, emissiveIntensity: 0.3 }), balloons.length);
    const basket = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 0.7, 1.1, 8), toon(0xb87a48), balloons.length);
    balloons.forEach((b, i) => bMesh.setColorAt(i, col.set(PUMPKIN_COLORS[i % PUMPKIN_COLORS.length])));
    bMesh.name = 'pumpkin-balloons';
    group.add(bMesh, basket);
    const writeBalloons = (t) => {
      balloons.forEach((b, i) => {
        const y = b.y + Math.sin(t * 0.5 + b.ph) * 2.5;
        const x = b.x + Math.sin(t * 0.05 + b.ph) * 20;
        bMesh.setMatrixAt(i, mat4(x, y, b.z, { s: [b.s, b.s * 1.2, b.s], ry: t * 0.1 + b.ph }));
        basket.setMatrixAt(i, mat4(x, y - b.s * 0.9, b.z));
      });
      bMesh.instanceMatrix.needsUpdate = true;
      basket.instanceMatrix.needsUpdate = true;
    };
    writeBalloons(0);
    animate((dt, t) => writeBalloons(t));
    const leafMat = toon(0xffffff, { side: THREE.DoubleSide, emissive: 0x3a1a00, emissiveIntensity: 0.3 });
    drifting(ctx, leafGeometry(), leafMat, 170, { top: 34, bottom: -1, fall: [1.2, 2.6], sway: 2.2, spin: 1.3, scale: [0.6, 1.1], colors: [0xff8a2a, 0xe0612f, 0xffc93d, 0xd9803a, 0xb5472a] });
    floatingShapes(new THREE.OctahedronGeometry(0.5, 0), scatter(14, () => true, { pad: 10 }), [0xfff1a8, 0xffffff], { yMin: 10, yMax: 22, scale: [0.8, 1.4], glowy: true });
    sparkles(180, center.x, center.z, extent + 40, 3, 24, [0xffffff, 0xfff1b0], 1.2);
  }
}

/** Road details: two soft wheel ruts in the farm road. */
export function buildRoadDetails(ctx) {
  const { group, own, loopFrames } = ctx;
  const rutMat = own(toon(0xc98f55, { unique: true }));
  const ruts = mergeGeometries([ribbon(loopFrames, -5, -4.1, 0.036), ribbon(loopFrames, 4.1, 5, 0.036)]);
  const mesh = new THREE.Mesh(ruts, rutMat);
  mesh.name = 'wheel-ruts';
  group.add(mesh);
}

/** Apple Juice Creek: runs under the covered bridge, wiggling off both ways, stopping short of other road. */
export function prepare({ def: d, path, index }) {
  if (!d.scenery?.river) return d;
  const s = d.scenery.river.at * path.length;
  const p = path.pointAt(s);
  const r = path.rightAt(s);
  const hw = path.halfWidth;
  const range = d.scenery.bridges[0];
  const inBridge = (i) => {
    const si = i * path.step;
    return si >= range[0] * path.length - 30 && si <= range[1] * path.length + 30;
  };
  const sides = [];
  for (const dir of [-1, 1]) {
    const pts = [];
    for (let dd = 0; dd <= 240; dd += 6) {
      const wig = Math.sin(dd * 0.035) * 9 * Math.min(1, dd / 40);
      const x = p.x + r.x * dd * dir - r.z * wig;
      const z = p.z + r.z * dd * dir + r.x * wig;
      const n = index.nearest(x, z, hw + 40);
      if (dd > 30 && n.i >= 0 && !inBridge(n.i) && n.dist < hw + 30) break;
      pts.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
    }
    sides.push(pts);
  }
  return { ...d, scenery: { ...d.scenery, riverLine: [...sides[0].reverse(), ...sides[1].slice(1)] } };
}

export default { def, buildScenery, prepare, buildRoadDetails };
