/**
 * Cotton Candy Castle — track module (data + scenery). Cup: sprinkle-cup.
 * OWNER: done (original track; changes need a golden refresh, see tests/visual.golden.test.js).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import {
  FENCE_OFFSET, SHOULDER_IN, frames, ribbon, mat4, extruded, heartShape, starShape, archShape,
  pushedCopy, stripeTexture, waffleTexture, distToPolyline,
} from './sceneryKit.js';

// ---------------------------------------------------------------------------
// 1. Cotton Candy Castle — the star track.
// The castle keep sits at the world origin inside a ring-shaped moat of
// strawberry milk. The road sweeps in over a rainbow hump bridge, through
// the front gatehouse, past the big front doors, out the far gatehouse and
// over a second bridge, then loops around the cotton-candy forest.
// ---------------------------------------------------------------------------
const CASTLE = {
  center: [0, 0],
  moatInner: 60,
  moatOuter: 68,
  chordZ: 32, // the road inside the castle grounds runs along z = 32
};

export const def = makeTrack(
  {
    id: 'cotton-candy-castle',
    name: 'Cotton Candy Castle',
    subtitle: "Princess Peachy Pie's sugary palace",
    laps: 3,
    width: 18,
    previewColor: 0xffa6d8,
    art: ['🏰', '🍭', '💗'], // menu card emoji: big, bottom-left, top-right
    cup: 'sprinkle-cup',
    unlock: null,
    theme: {
      skyTop: 0x8ec9ff,
      skyBottom: 0xffd9f0,
      fogColor: 0xffe0f2,
      fogNear: 160,
      fogFar: 620,
      ground: 0xffd9ef,
      road: 0xffc6e0,
      roadAlt: 0xffb8d8,
      curbA: 0xff5fa8,
      curbB: 0xffffff,
      offRoad: 0xffe7f3,
      music: 'castle',
      sunColor: 0xfff1e0,
      ambientColor: 0xffd6f0,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      roadSprinkles: { style: 'dashes', count: 95, palette: [0xff4f9a, 0x4fb3ff, 0xffe14f, 0x8be08b, 0xb57bff, 0xffffff, 0xff8a3d] },
      groundTints: [0xf3c6ff, 0xffc2e0, 0xfff0f8],
      skirt: { color: 0xfff0f7, trim: 0xff9ccc, rainbow: true },
    },
  },
  {
    start: [-115, -40],
    heading: 0,
    ops: [
      { s: 42, mark: 'start-straight' },
      { turn: 90, r: 30, mark: 'turn-in' },
      { s: 14 },
      { s: 32, hump: 2.2, mark: 'bridge-in' },
      { s: 78, mark: 'courtyard' },
      { s: 32, hump: 2.2, mark: 'bridge-out' },
      { s: 14 },
      { turn: 90, r: 40, mark: 'east-turn' },
      { turn: -35, r: 50 },
      { turn: 35, r: 50, mark: 'east-s' },
      { s: 20 },
      { turn: 90, r: 55, mark: 'south-east' },
      { s: 60, flex: true, mark: 'back-straight' },
      { turn: -18, r: 90 },
      { turn: 36, r: 90, mark: 'forest-wiggle' },
      { turn: -18, r: 90 },
      { turn: -90, r: 26, mark: 'tongue-in' },
      { s: 70, mark: 'tongue-leg' },
      { turn: 180, r: 25, mark: 'hairpin' },
      { s: 150, flex: true, mark: 'return-leg' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('courtyard', 'start') + 0.012, frac('back-straight', 'mid'), frac('return-leg', 'mid')],
    boostPads: [
      { at: frac('courtyard', 'mid') + 0.012, lateral: -4 },
      { at: frac('east-s', 'end'), lateral: 3 },
      { at: frac('tongue-leg', 'mid'), lateral: -3 },
      { at: frac('hairpin', 'end') + 0.01, lateral: 3.5 },
    ],
    scenery: {
      kind: 'castle',
      castle: CASTLE,
      // s-fraction ranges that are bridges (rainbow deck + rainbow arches)
      bridges: [
        [frac('bridge-in', 'start'), frac('bridge-in', 'end')],
        [frac('bridge-out', 'start'), frac('bridge-out', 'end')],
      ],
      gates: [frac('courtyard', 'start') + 0.004, frac('courtyard', 'end') - 0.004],
      terrain: 'flat',
      fence: { post: 0xffffff, postAlt: 0xff7fbf, rail: 0xffa6d8, topper: 'heart', topperColor: 0xff4f9a },
      arch: { a: 0xff7fbf, b: 0xffffff, banner: 0xff5fa8, text: 'SPRINKLE KART' },
      startGridSide: 'straight',
    },
  }),
);

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, ownTex, outlineMat, toonTex, toonVC,
    hw, L, bounds, center, extent, groundH, distToRoad, clearOfRoad, animators, loopFrames,
    scatter, cottonCandyTrees, floatingShapes, sparkles, backgroundHills, lollipops, tower, heartFlag, fallingSprinkles,
  } = ctx;

  buildCastleWorld();

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
}

export default { def, buildScenery };
