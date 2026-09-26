/**
 * Jellybean Jungle — track module (data + scenery). Cup: adventure-cup.
 * OWNER: Tracks — Adventure Cup.
 *
 * A FIGURE-EIGHT through a steamy candy jungle: the road climbs round the big
 * loop, swings over its own start straight on a wobbly VINE BRIDGE, then
 * dives back down past the gummy-frog pond and under that same bridge.
 *
 * The layout DSL wants turns that add up to ±360, but a figure-eight turns
 * 0° in total (one loop left, one loop right). A zero-length full twirl
 * (`{ turn: 360, r: 1e-6 }`) keeps the DSL happy without moving the road.
 *
 * Terrain is 'void' on purpose: the core puts skirt walls and pillars under
 * any raised road on flat/hilly ground, which would land on the road passing
 * under the bridge. Here the deck gets the void-style underside (a proper
 * bridge deck) and this module draws the jungle floor and its own tree-trunk
 * supports, keeping them clear of the lower road.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, SHOULDER_OUT, mat4, heartShape, smoothstep } from './sceneryKit.js';
import {
  instanced, animatedInstances, isClearOfCamera, farRing, lathe, capsule, floorDisc, minDistToOtherLevel,
} from './props/adventure-kit.js';

/** Zero-length full twirl: lets a figure-eight (0° total turn) through the ±360 check. */
export const FIGURE_EIGHT_TWIRL = Object.freeze({ turn: 360, r: 1e-6 });

/** Jellybean colours (used for fruit, road dots, frogs' snacks...). */
export const JELLYBEAN_COLORS = Object.freeze([0xff4f7a, 0xff9f40, 0xffe14f, 0x7ddc4f, 0x4fc3ff, 0xb57bff, 0xff7ac8, 0xffffff]);

export const def = makeTrack(
  {
    id: 'jellybean-jungle',
    name: 'Jellybean Jungle',
    subtitle: 'Wiggle over the wobbly vine bridge!',
    laps: 3,
    width: 18,
    previewColor: 0x5fd18a,
    art: ['🐸', '🌴', '🍬'], // menu card emoji: big, bottom-left, top-right
    cup: 'adventure-cup',
    unlock: { type: 'cup-track', cupId: 'bubble-cup', result: 'win' },
    theme: {
      skyTop: 0x3fbfe6,
      skyBottom: 0xeaffd6,
      fogColor: 0xd4f5c9,
      fogNear: 150,
      fogFar: 580,
      ground: 0x5cc25a,
      road: 0xe8a765, // warm toffee dirt road
      roadAlt: 0xd99653,
      curbA: 0xff5f9e,
      curbB: 0xfff3a6,
      offRoad: 0x86d66a,
      music: 'jellybean-jungle',
      sunColor: 0xfff2c4,
      ambientColor: 0xd6ffe0,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      roadSprinkles: { style: 'dots', count: 110, palette: JELLYBEAN_COLORS },
      skirt: { color: 0x9b6a3c, trim: 0x7fdc5a },
      underside: 0x8a5a33, // bridge deck underside (void terrain)
      undersideGlow: 0x2a1508,
      undersideEdge: 0xffe27a, // a string of golden fairy lights under the deck
    },
  },
  {
    start: [0, 0],
    heading: 45,
    startAt: 72,
    ops: [
      // big climbing loop (turns left)
      { s: 90, y: 0, flex: true, mark: 'under-bridge' },
      { turn: 100, r: 80, y: 2, mark: 'canopy-bend' },
      { s: 50, y: 4, mark: 'canopy-run' },
      { turn: 80, r: 70, y: 6, mark: 'big-tree-turn' },
      { s: 40, y: 8, mark: 'climb' },
      { turn: 90, r: 85, y: 10, mark: 'treetop-turn' },
      { s: 90, y: 10, mark: 'bridge-in' },
      FIGURE_EIGHT_TWIRL,
      // over the vine bridge and round the little pond loop (turns right)
      { s: 70, y: 10, flex: true, mark: 'bridge-out' },
      { turn: -90, r: 55, y: 8, mark: 'drop-turn' },
      { s: 60, y: 5, mark: 'frog-hill' },
      { turn: -90, r: 40, y: 3, mark: 'pond-turn' },
      { s: 40, y: 1, mark: 'pond-run' },
      { turn: -90, r: 60, y: 0, mark: 'fern-turn' },
      { s: 80, y: 0, mark: 'home' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('canopy-run', 'mid'), frac('climb', 'mid'), frac('bridge-out', 'end'), frac('pond-run', 'mid')],
    boostPads: [
      { at: frac('canopy-bend', 'end') - 0.012, lateral: 3 },
      { at: frac('bridge-in', 'mid'), lateral: -3 },
      { at: frac('frog-hill', 'mid'), lateral: 3.5 },
      { at: frac('home', 'mid'), lateral: -3 },
    ],
    scenery: {
      kind: 'jungle',
      terrain: 'void', // this module draws the jungle floor (see header)
      center: centroid(),
      bigLoop: centroid('canopy-bend', 'treetop-turn'),
      pondLoop: centroid('drop-turn', 'fern-turn'),
      canopy: [frac('canopy-bend', 'start'), frac('canopy-run', 'end')],
      fence: { post: 0x9b6a3c, postAlt: 0x7fdc5a, rail: 0x6fcf4f, topper: 'ball', topperColor: 0xff7ac8 },
      arch: { a: 0x49b85a, b: 0xfff3a6, banner: 0xff6fae, text: 'SPRINKLE KART' },
    },
  }),
);

/** Height of the jungle floor (flat; the road never dips below it). */
export const FLOOR_Y = -0.08;

/**
 * Where the figure-eight crosses itself: the sample pair (upper, lower) with
 * the smallest XZ distance among samples more than 6 units apart in height.
 * @returns {{upper:number, lower:number, dist:number, dy:number, x:number, z:number}} s values
 */
export function findCrossing(path) {
  let best = { upper: 0, lower: 0, dist: Infinity, dy: 0, x: 0, z: 0 };
  for (let i = 0; i < path.count; i += 2) {
    for (let j = 0; j < path.count; j += 2) {
      const dy = path.py[i] - path.py[j];
      if (dy < 6) continue;
      const d = Math.hypot(path.px[i] - path.px[j], path.pz[i] - path.pz[j]);
      if (d < best.dist) best = { upper: i * path.step, lower: j * path.step, dist: d, dy, x: path.px[j], z: path.pz[j] };
    }
  }
  return best;
}

/**
 * Tree-trunk supports under raised road: every 9 units where the deck is more
 * than 2.4 above the floor, never on (or beside) road on another level.
 * @returns {{x:number, z:number, y0:number, y1:number, s:number}[]}
 */
export function supportSpots(path, { spacing = 9, clearance = 6 } = {}) {
  const hw = path.halfWidth;
  const out = [];
  for (let s = 0; s < path.length; s += spacing) {
    const p = path.pointAt(s);
    if (p.y - FLOOR_Y < 2.6) continue;
    for (const side of [-1, 1]) {
      const q = path.positionAt(s, side * (hw - 1.5));
      if (minDistToOtherLevel(path, q.x, q.z, p.y, 4) < hw + FENCE_OFFSET + clearance) continue;
      out.push({ x: q.x, z: q.z, y0: FLOOR_Y, y1: p.y - 2.4, s });
    }
  }
  return out;
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, own, hw, center, extent, distToRoad, clearOfRoad, animators,
    scatter, sparkles, backgroundHills,
  } = ctx;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const crossing = findCrossing(path);

  buildFloor();
  buildSupports();
  buildVineBridgeDressing();
  buildCanopyArches();
  buildGreatJellybeanTree(...def.scenery.bigLoop);
  buildPond(...def.scenery.pondLoop);
  buildJungleBelt();
  buildJellybeanTrees();
  buildUndergrowth();
  buildGiantFlowers();
  buildButterflies();
  backgroundHills(20, extent + 240, extent + 420, [0x3fa85a, 0x5cc25a, 0x2f9a58, 0x7ddc6a], { hMin: 40, hMax: 90, widthMul: 1.6 });
  buildDistantPalms();
  sparkles(320, center.x, center.z, extent + 40, 1, 14, [0xfff27a, 0xd8ff8a, 0xffffff], 1.1); // fireflies

  // --------------------------------------------------------------------------

  function buildFloor() {
    const base = new THREE.Color(0x5cc25a);
    const moss = new THREE.Color(0x3fa85a);
    const lime = new THREE.Color(0x9be26a);
    const dirt = new THREE.Color(0xc9a16a);
    const p = [rng() * 9, rng() * 9, rng() * 9];
    floorDisc(ctx, extent + 700, FLOOR_Y, (x, z, out) => {
      out.copy(base);
      const n1 = Math.sin(x * 0.029 + p[0]) * Math.cos(z * 0.033 + p[1]);
      const n2 = Math.sin(x * 0.061 + p[2]) * Math.sin(z * 0.057 + p[0]);
      out.lerp(moss, smoothstep(0.2, 0.8, n1) * 0.7);
      out.lerp(lime, smoothstep(0.5, 0.95, n2) * 0.5);
      // a dusty toffee verge right beside the road
      const d = distToRoad(x, z, hw + 30);
      out.lerp(dirt, (1 - smoothstep(hw + 3, hw + 16, d)) * 0.55);
    }, { apronColor: 0x4fb558, cell: 7 });
  }

  function buildSupports() {
    const spots = supportSpots(path);
    if (!spots.length) return;
    const trunk = new THREE.CylinderGeometry(0.95, 1.25, 1, 9, 1, true);
    const ring = new THREE.TorusGeometry(1.2, 0.28, 5, 10);
    instanced(ctx, trunk, toon(0x9b6a3c), spots.map((p) => ({ m: mat4(p.x, (p.y0 + p.y1) / 2, p.z, { s: [1, p.y1 - p.y0, 1] }) })), { outline: 0.08 });
    const rings = [];
    for (const p of spots) {
      for (let y = p.y0 + 1.8; y < p.y1 - 0.4; y += 5.5) rings.push({ m: mat4(p.x, y, p.z, { rx: Math.PI / 2 + (rng() - 0.5) * 0.5, rz: rng() }) });
    }
    instanced(ctx, ring, toon(0x5fcf4a), rings);
  }

  /** Planks are road details; here: dangling vines + leafy tufts along the bridge and around the crossing. */
  function buildVineBridgeDressing() {
    const upper = [];
    for (let s = 0; s < path.length; s += 3.2) {
      const p = path.pointAt(s);
      if (p.y < 7.5) continue;
      upper.push(s);
    }
    // vines hanging off both deck edges, swaying in the breeze
    const vineGeo = new THREE.CylinderGeometry(0.09, 0.05, 1, 4, 1, true);
    vineGeo.translate(0, -0.5, 0);
    const vines = [];
    const leaves = [];
    for (const s of upper) {
      for (const side of [-1, 1]) {
        if (rng() < 0.35) continue;
        const q = path.positionAt(s + rng() * 2, side * (hw + SHOULDER_OUT - 0.2));
        const len = 2.5 + rng() * 4.5;
        vines.push({ x: q.x, y: q.y - 0.3, z: q.z, len, ph: rng() * 6, h: path.headingAt(s) });
        leaves.push({ m: mat4(q.x, q.y - 0.2, q.z, { s: [1.1, 0.5, 1.1], ry: rng() * 3 }), c: pick([0x5fcf4a, 0x7ddc4f, 0x3fa85a]) });
      }
    }
    animatedInstances(ctx, vineGeo, toon(0x4caf50), vines, (v, t, o) => {
      o.x = v.x; o.y = v.y; o.z = v.z;
      o.ry = v.h;
      o.rx = Math.sin(t * 1.3 + v.ph) * 0.12;
      o.rz = Math.cos(t * 1.1 + v.ph) * 0.1;
      o.sy = v.len;
    });
    instanced(ctx, new THREE.IcosahedronGeometry(1, 0), toon(0xffffff), leaves, { outline: 0.06 });
    // four giant jungle trees frame the crossing, one in each quadrant between the roads
    const u = path.tangentAt(crossing.upper), v = path.tangentAt(crossing.lower);
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const dx = u.x * a + v.x * b, dz = u.z * a + v.z * b;
      const n = Math.hypot(dx, dz) || 1;
      for (let d = hw + FENCE_OFFSET + 12; d < 60; d += 3) {
        const x = crossing.x + (dx / n) * d, z = crossing.z + (dz / n) * d;
        if (distToRoad(x, z, 60) > hw + FENCE_OFFSET + 9) { buildBigTree(x, z, 18 + rng() * 5, 1.3); break; }
      }
    }
  }

  /** Leafy arches over the road on the canopy run: a green tunnel moment. */
  function buildCanopyArches() {
    const [f0, f1] = def.scenery.canopy;
    const span = hw + FENCE_OFFSET + 2.2;
    const archGeo = new THREE.TorusGeometry(span, 0.8, 7, 28, Math.PI);
    const tuftGeo = new THREE.IcosahedronGeometry(1, 1);
    const arches = [];
    const tufts = [];
    const beans = [];
    let k = 0;
    for (let s = f0 * path.length + 10; s < f1 * path.length - 4; s += 16, k++) {
      const p = path.pointAt(s);
      const h = path.headingAt(s);
      arches.push({ m: mat4(p.x, p.y, p.z, { ry: h, s: [1, 0.95, 1] }) });
      for (let a = 0.12; a < Math.PI - 0.1; a += 0.3) {
        const lx = Math.cos(a) * span, ly = Math.sin(a) * span * 0.95;
        const x = p.x + Math.cos(h) * lx, z = p.z - Math.sin(h) * lx;
        tufts.push({ m: mat4(x, p.y + ly + 0.6, z, { s: 1.4 + rng() * 0.9, ry: rng() * 3 }), c: pick([0x49b85a, 0x6fd45a, 0x3fa85a, 0x8fe36a]) });
        if (rng() < 0.4) beans.push({ x, y: p.y + ly - 0.6, z, ph: rng() * 6, c: pick(JELLYBEAN_COLORS) });
      }
    }
    instanced(ctx, archGeo, toon(0x7a5230), arches, { outline: 0.1 });
    instanced(ctx, tuftGeo, toon(0xffffff, { emissive: 0x0f3a14, emissiveIntensity: 0.35 }), tufts, { outline: 0.07 });
    animatedInstances(ctx, capsule(0.35, 0.5, 1, 6), toon(0xffffff, { emissive: 0x331122, emissiveIntensity: 0.25 }), beans, (b, t, o) => {
      o.x = b.x; o.y = b.y + Math.sin(t * 2 + b.ph) * 0.15; o.z = b.z;
      o.rz = 0.9 + Math.sin(t * 1.6 + b.ph) * 0.25;
    });
  }

  /** A tall curvy tree with a leafy crown; `S` scales the whole thing. */
  function buildBigTree(x, z, h, S = 1) {
    const trunk = lathe([[0, 0], [2.4, 0], [1.9, 0.2], [1.3, 0.55], [1.05, 0.8], [1.2, 1]].map(([r, y]) => [r * S, y * h]), 12);
    ctx.batch.add(trunk, toon(0x9b6a3c), mat4(x, FLOOR_Y, z));
    const crown = new THREE.IcosahedronGeometry(1, 1);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rng();
      const r = (k === 0 ? 0 : 4.5) * S;
      const sz = (k === 0 ? 7 : 5 + rng() * 1.5) * S;
      ctx.batch.add(crown, toon(pick([0x49b85a, 0x3fa85a, 0x6fd45a])), mat4(x + Math.cos(a) * r, FLOOR_Y + h + (k === 0 ? 2.5 : rng() * 2) * S, z + Math.sin(a) * r, { s: [sz, sz * 0.7, sz] }));
    }
  }

  /** The Great Jellybean Tree: the hero of the big loop, hung with rainbow beans. */
  function buildGreatJellybeanTree(x, z) {
    const reach = 26;
    const room = distToRoad(x, z, 200) - (hw + FENCE_OFFSET + 6);
    const S = Math.max(0.55, Math.min(1, room / reach));
    const H = 44 * S;
    const trunk = lathe([[0, 0], [7, 0], [5.2, 0.08], [3.6, 0.3], [3, 0.6], [3.4, 0.85], [4.2, 1]].map(([r, y]) => [r * S, y * H]), 16);
    ctx.batch.add(trunk, toon(0x8c5a32), mat4(x, FLOOR_Y, z));
    // roots
    const root = capsule(1.1 * S, 7 * S, 2, 6);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      ctx.batch.add(root, toon(0x8c5a32), mat4(x + Math.cos(a) * 6 * S, FLOOR_Y + 0.6, z + Math.sin(a) * 6 * S, { ry: -a + Math.PI / 2, rz: Math.PI / 2 - 0.25 }));
    }
    // big leafy crown
    const crown = new THREE.IcosahedronGeometry(1, 2);
    const blobs = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 8) * Math.PI * 2;
      const r = k === 0 ? 0 : 13 * S;
      const sz = (k === 0 ? 16 : 10 + rng() * 3) * S;
      blobs.push({ x: x + Math.cos(a) * r, y: FLOOR_Y + H + (k === 0 ? 8 : 1 + rng() * 4) * S, z: z + Math.sin(a) * r, sz });
    }
    instanced(ctx, crown, toon(0xffffff, { emissive: 0x0f3a14, emissiveIntensity: 0.3 }), blobs.map((b, i) => ({ m: mat4(b.x, b.y, b.z, { s: [b.sz, b.sz * 0.72, b.sz] }), c: [0x49b85a, 0x3fa85a, 0x6fd45a][i % 3] })), { outline: 0.03 });
    // jellybean fruit dangling under the crown, gently swinging
    const beans = [];
    for (const b of blobs) {
      for (let k = 0; k < 14; k++) {
        const a = rng() * Math.PI * 2, r = b.sz * (0.55 + rng() * 0.4);
        beans.push({ x: b.x + Math.cos(a) * r, y: b.y - b.sz * 0.45 - rng() * 2, z: b.z + Math.sin(a) * r, ph: rng() * 6, c: pick(JELLYBEAN_COLORS), s: (1.3 + rng() * 0.5) * S });
      }
    }
    animatedInstances(ctx, capsule(0.5, 0.7, 2, 8), toon(0xffffff, { emissive: 0x331122, emissiveIntensity: 0.3 }), beans, (b, t, o) => {
      o.x = b.x; o.y = b.y + Math.sin(t * 1.5 + b.ph) * 0.3; o.z = b.z;
      o.rz = 1.2 + Math.sin(t * 1.2 + b.ph) * 0.3; o.ry = b.ph;
      o.sx = o.sy = o.sz = b.s;
    });
    // a friendly treehouse on the trunk
    const hy = FLOOR_Y + H * 0.55;
    const hx = x + 3.8 * S, hz = z;
    ctx.batch.add(new THREE.CylinderGeometry(5 * S, 5 * S, 0.6, 12), toon(0xc98a4b), mat4(hx, hy, hz));
    ctx.batch.add(new THREE.BoxGeometry(5 * S, 4 * S, 5 * S), toon(0xffd29a), mat4(hx + 1, hy + 2 * S, hz));
    ctx.batch.add(new THREE.ConeGeometry(4.6 * S, 3.4 * S, 4), toon(0xff6fae), mat4(hx + 1, hy + 5.6 * S, hz, { ry: Math.PI / 4 }));
    ctx.batch.add(new THREE.PlaneGeometry(1.6 * S, 1.6 * S), glow(0xfff1a8), mat4(hx + 1, hy + 2.2 * S, hz + 2.52 * S), false);
    ctx.batch.add(new THREE.PlaneGeometry(1.6 * S, 1.6 * S), glow(0xfff1a8), mat4(hx + 3.52 * S, hy + 2.2 * S, hz, { ry: Math.PI / 2 }), false);
  }

  /** Lily-pad pond inside the little loop, with hopping gummy frogs. */
  function buildPond(x, z) {
    const room = distToRoad(x, z, 200) - (hw + FENCE_OFFSET + 4);
    const R = Math.max(8, Math.min(34, room));
    const water = own(toon(0x5fd3c8, { unique: true, emissive: 0x0a4a55, emissiveIntensity: 0.35 }));
    const pond = new THREE.Mesh(new THREE.CircleGeometry(R, 40), water);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(x, FLOOR_Y + 0.04, z);
    group.add(pond);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.8, 6, 40), toon(0xc9a16a));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, FLOOR_Y + 0.1, z);
    group.add(rim);
    animators.push((dt, t) => { water.emissiveIntensity = 0.3 + Math.sin(t * 1.7) * 0.08; });
    // lily pads (a disc with a notch) + pink lotus flowers
    const padShape = new THREE.Shape();
    padShape.absarc(0, 0, 1, 0.35, Math.PI * 2 - 0.35, false);
    padShape.lineTo(0, 0);
    const padGeo = new THREE.ShapeGeometry(padShape, 14);
    padGeo.rotateX(-Math.PI / 2);
    const pads = [];
    for (let k = 0; k < 14; k++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (R - 3);
      pads.push({ x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, s: 1.6 + rng() * 1.4, ph: rng() * 6, c: pick([0x5fcf4a, 0x7ddc4f, 0x49b85a]) });
    }
    animatedInstances(ctx, padGeo, toon(0xffffff, { side: THREE.DoubleSide }), pads, (p, t, o) => {
      o.x = p.x; o.y = FLOOR_Y + 0.12 + Math.sin(t * 1.4 + p.ph) * 0.04; o.z = p.z;
      o.ry = p.ph + Math.sin(t * 0.4 + p.ph) * 0.2;
      o.sx = o.sy = o.sz = p.s;
    });
    const lotus = pads.filter((_, i) => i % 3 === 0);
    instanced(ctx, new THREE.ConeGeometry(0.6, 0.9, 6, 1, true), toon(0xff9ed2, { side: THREE.DoubleSide }), lotus.map((p) => ({ m: mat4(p.x + p.s * 0.3, FLOOR_Y + 0.55, p.z, { rx: Math.PI }) })));

    // gummy frogs: body + two googly eyes + a big smile, hopping pad to pad
    const frogs = pads.filter((_, i) => i % 2 === 1).map((p) => ({ p, ph: rng() * 4, c: pick([0x6bd968, 0xa8ec4f, 0xff7ac8, 0xffb13d]) }));
    const frogBody = new THREE.SphereGeometry(1, 14, 10);
    frogBody.scale(1.1, 0.75, 1);
    const hop = (f, t) => {
      const cyc = ((t * 0.7 + f.ph) % 3) / 3; // hop, then rest
      return cyc < 0.25 ? Math.sin((cyc / 0.25) * Math.PI) * 2.4 : 0;
    };
    const frogPose = (f, t, o, dx, dy, dz, s) => {
      const y = FLOOR_Y + 0.9 + hop(f, t);
      const h = f.ph * 2 + Math.floor(t * 0.7 / 3 + f.ph) * 0.9;
      o.x = f.p.x + Math.sin(h) * dz + Math.cos(h) * dx;
      o.z = f.p.z + Math.cos(h) * dz - Math.sin(h) * dx;
      o.y = y + dy;
      o.ry = h;
      const squash = hop(f, t) > 0 ? 1.12 : 1 - Math.max(0, Math.sin(t * 6 + f.ph)) * 0.05;
      o.sx = o.sz = s / Math.sqrt(squash); o.sy = s * squash;
    };
    animatedInstances(ctx, frogBody, toon(0xffffff, { emissive: 0x114411, emissiveIntensity: 0.25 }), frogs, (f, t, o) => frogPose(f, t, o, 0, 0, 0, 1), { outline: 0.06 });
    const eyeWhite = new THREE.SphereGeometry(0.34, 10, 8);
    const eyes = frogs.flatMap((f) => [{ f, dx: -0.42 }, { f, dx: 0.42 }]);
    animatedInstances(ctx, eyeWhite, toon(0xffffff), eyes, (e, t, o) => frogPose(e.f, t, o, e.dx, 0.72, 0.35, 1), { outline: 0.05 });
    const pupil = new THREE.SphereGeometry(0.16, 8, 6);
    animatedInstances(ctx, pupil, glow(0x2a1633), eyes, (e, t, o) => frogPose(e.f, t, o, e.dx, 0.78, 0.62, 1));
    const smileGeo = new THREE.TorusGeometry(0.36, 0.06, 5, 12, Math.PI);
    smileGeo.rotateZ(Math.PI);
    animatedInstances(ctx, smileGeo, glow(0x2a1633), frogs, (f, t, o) => frogPose(f, t, o, 0, 0.2, 0.98, 1));
  }

  /** A lush wall of broadleaf trees hugging the road (canopies kept clear of the cameras). */
  function buildJungleBelt() {
    const reach = 6.5;
    const spots = scatter(150, (x, z) => {
      const d = distToRoad(x, z, hw + 90);
      return d < hw + 60 && isClearOfCamera(ctx, x, z, reach);
    }, { pad: 100, tries: 60 });
    const trunkGeo = new THREE.CylinderGeometry(0.55, 0.9, 1, 7, 1, true);
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const trunks = [], crowns = [], beans = [];
    const greens = [0x2f9a58, 0x3fa85a, 0x49b85a, 0x5cc25a, 0x6fd45a, 0x238a4f];
    for (const [x, z] of spots) {
      const h = 8 + rng() * 8;
      trunks.push({ m: mat4(x, FLOOR_Y + h / 2, z, { s: [1, h, 1], rz: (rng() - 0.5) * 0.12 }) });
      const c = rng() < 0.22 ? pick([0xff9ed2, 0xffb8e0, 0xc9a8ff, 0xffd27a]) : pick(greens); // a few candy-blossom trees
      const n = 3;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rng();
        const rr = k === 0 ? 0 : 2.6;
        const r = k === 0 ? 4.6 : 3.3 + rng();
        crowns.push({ m: mat4(x + Math.cos(a) * rr, FLOOR_Y + h + (k === 0 ? 1.2 : rng() * 1.2), z + Math.sin(a) * rr, { s: [r, r * 0.8, r] }), c });
        if (rng() < 0.7) beans.push({ m: mat4(x + Math.cos(a) * (rr + r * 0.7), FLOOR_Y + h - 0.8, z + Math.sin(a) * (rr + r * 0.7), { rz: 1.2, ry: a, s: 1.2 }), c: pick(JELLYBEAN_COLORS) });
      }
    }
    instanced(ctx, trunkGeo, toon(0x8c5a32), trunks);
    instanced(ctx, crownGeo, toon(0xffffff, { emissive: 0x0f3a14, emissiveIntensity: 0.3 }), crowns, { outline: 0.05 });
    instanced(ctx, capsule(0.45, 0.6, 1, 6), toon(0xffffff, { emissive: 0x331122, emissiveIntensity: 0.3 }), beans);
  }

  /** Jellybean palms: curvy trunk, drooping fronds, a cluster of beans. */
  function buildJellybeanTrees() {
    const reach = 3; // fronds sit well above the chase cameras
    const spots = scatter(90, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5) && isClearOfCamera(ctx, x, z, reach) && distToRoad(x, z, 120) < hw + 110, { pad: 130 });
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.6, 1, 7, 3, true);
    const frondGeo = new THREE.SphereGeometry(1, 8, 4);
    frondGeo.scale(0.8, 0.12, 3.2);
    frondGeo.translate(0, 0, 2.6);
    const trunks = [], fronds = [], beans = [];
    for (const [x, z] of spots) {
      const h = 7 + rng() * 5;
      const lean = (rng() - 0.5) * 0.25;
      const ry = rng() * Math.PI * 2;
      trunks.push({ m: mat4(x, FLOOR_Y + h / 2, z, { s: [1, h, 1], rz: lean, ry }) });
      const tx = x - Math.sin(lean) * h * Math.cos(ry), tz = z + Math.sin(lean) * h * Math.sin(ry);
      const nf = 5;
      const c = pick([0x49b85a, 0x6fd45a, 0x3fa85a, 0x8fe36a]);
      for (let k = 0; k < nf; k++) {
        fronds.push({ m: mat4(tx, FLOOR_Y + h, tz, { ry: (k / nf) * Math.PI * 2 + ry, rx: 0.35 + rng() * 0.25 }), c });
      }
      for (let k = 0; k < 4; k++) {
        const a = rng() * Math.PI * 2;
        beans.push({ m: mat4(tx + Math.cos(a) * 0.8, FLOOR_Y + h - 0.6 - rng() * 0.5, tz + Math.sin(a) * 0.8, { rz: 1 + rng(), ry: a, s: 0.9 }), c: pick(JELLYBEAN_COLORS) });
      }
    }
    instanced(ctx, trunkGeo, toon(0xa87444), trunks, { outline: 0.08 });
    instanced(ctx, frondGeo, toon(0xffffff, { emissive: 0x0f3a14, emissiveIntensity: 0.3 }), fronds);
    instanced(ctx, capsule(0.4, 0.55, 1, 6), toon(0xffffff, { emissive: 0x331122, emissiveIntensity: 0.3 }), beans);
  }

  /** Leafy bushes and fern tufts near the fence (low: never block the camera). */
  function buildUndergrowth() {
    const spots = scatter(170, (x, z) => {
      const d = distToRoad(x, z, 60);
      return d > hw + FENCE_OFFSET + 1.8 && d < hw + 50;
    }, { pad: 60 });
    const bushGeo = new THREE.IcosahedronGeometry(1, 1);
    const items = spots.map(([x, z]) => {
      const s = 1 + rng() * 1.6;
      return { m: mat4(x, FLOOR_Y + s * 0.35, z, { s: [s * 1.3, s * 0.8, s * 1.3], ry: rng() * 3 }), c: pick([0x49b85a, 0x6fd45a, 0x3fa85a, 0x8fe36a, 0x2f9a58]) };
    });
    instanced(ctx, bushGeo, toon(0xffffff, { emissive: 0x0f3a14, emissiveIntensity: 0.25 }), items, { outline: 0.05 });
  }

  /** Giant jungle flowers that sway and slowly turn their faces. */
  function buildGiantFlowers() {
    const spots = scatter(34, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5) && isClearOfCamera(ctx, x, z, 3), { pad: 90 });
    const stems = spots.map(([x, z]) => ({ x, z, h: 3.5 + rng() * 3, ph: rng() * 6, c: pick([0xff7ac8, 0xffb13d, 0xb57bff, 0xff4f7a, 0x4fc3ff]) }));
    const stemGeo = new THREE.CylinderGeometry(0.15, 0.22, 1, 5);
    stemGeo.translate(0, 0.5, 0);
    instanced(ctx, stemGeo, toon(0x3fa85a), stems.map((f) => ({ m: mat4(f.x, FLOOR_Y, f.z, { s: [1, f.h, 1] }) })));
    const petalGeo = new THREE.SphereGeometry(1, 8, 4);
    petalGeo.scale(0.7, 0.18, 1.3);
    petalGeo.translate(0, 0, 1.2);
    const petals = stems.flatMap((f) => [0, 1, 2, 3, 4].map((k) => ({ f, a: (k / 5) * Math.PI * 2, c: f.c })));
    const head = (f, t) => ({ tilt: 0.5 + Math.sin(t * 0.9 + f.ph) * 0.15, spin: t * 0.3 + f.ph });
    animatedInstances(ctx, petalGeo, toon(0xffffff), petals, (p, t, o) => {
      const hd = head(p.f, t);
      o.x = p.f.x; o.y = FLOOR_Y + p.f.h; o.z = p.f.z;
      o.ry = hd.spin + p.a; o.rx = -hd.tilt * Math.cos(p.a) * 0.5 - 0.15;
    }, { outline: 0.05 });
    animatedInstances(ctx, new THREE.SphereGeometry(0.6, 10, 8), toon(0xffe14f), stems, (f, t, o) => {
      o.x = f.x; o.y = FLOOR_Y + f.h + 0.1; o.z = f.z;
      o.ry = t * 0.3 + f.ph;
    });
  }

  /** Candy butterflies fluttering in lazy loops above the jungle floor. */
  function buildButterflies() {
    const wing = new THREE.ShapeGeometry(heartShape(), 6);
    wing.rotateX(-Math.PI / 2);
    wing.translate(0.55, 0, 0);
    const wingR = wing.clone();
    wingR.scale(-1, 1, 1);
    const both = mergeGeometries([wing, wingR]);
    const flies = scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 2), { pad: 80 }).map(([x, z]) => ({ x, z, y: 3 + rng() * 6, r: 3 + rng() * 5, ph: rng() * 6, sp: 0.4 + rng() * 0.5, c: pick([0xff7ac8, 0xffe14f, 0x4fc3ff, 0xb57bff, 0xff9f40]) }));
    animatedInstances(ctx, both, toon(0xffffff, { side: THREE.DoubleSide, emissive: 0x442244, emissiveIntensity: 0.4 }), flies, (f, t, o) => {
      const a = t * f.sp + f.ph;
      o.x = f.x + Math.cos(a) * f.r; o.z = f.z + Math.sin(a) * f.r; o.y = f.y + Math.sin(t * 2.3 + f.ph) * 0.8;
      o.ry = -a; o.rz = 0;
      o.sx = 0.9 * (0.25 + Math.abs(Math.sin(t * 9 + f.ph))); o.sy = 0.9; o.sz = 0.9;
    });
  }

  /** Tall palm silhouettes on the horizon so the jungle feels endless. */
  function buildDistantPalms() {
    const ring = farRing(ctx, 26, extent + 150, extent + 260);
    const trunkGeo = new THREE.CylinderGeometry(1.2, 2, 1, 6, 1, true);
    const frondGeo = new THREE.SphereGeometry(1, 8, 4);
    frondGeo.scale(2.4, 0.4, 10);
    frondGeo.translate(0, 0, 8);
    const trunks = [], fronds = [];
    for (const [x, z] of ring) {
      const h = 30 + rng() * 25;
      trunks.push({ m: mat4(x, FLOOR_Y + h / 2, z, { s: [1, h, 1], rz: (rng() - 0.5) * 0.2 }) });
      for (let k = 0; k < 7; k++) fronds.push({ m: mat4(x, FLOOR_Y + h, z, { ry: (k / 7) * Math.PI * 2 + rng(), rx: 0.4 + rng() * 0.2 }), c: pick([0x2f9a58, 0x3fa85a, 0x49b85a]) });
    }
    instanced(ctx, trunkGeo, toon(0x8c5a32), trunks);
    instanced(ctx, frondGeo, toon(0xffffff), fronds);
  }
}

/** Road details: wooden planks across the vine bridge + rope rails. */
export function buildRoadDetails(ctx) {
  const { path, hw } = ctx;
  const planks = [];
  for (let s = 0; s < path.length; s += 1.7) {
    const p = path.pointAt(s);
    if (p.y < 7) continue;
    planks.push({ m: mat4(p.x, p.y + 0.045, p.z, { ry: path.headingAt(s) }) });
  }
  if (!planks.length) return;
  const gapGeo = new THREE.BoxGeometry(hw * 2 - 0.2, 0.02, 0.22);
  instanced(ctx, gapGeo, toon(0x9b6a3c), planks);
  // chunky rope rails with knots, just outside the fence line
  const knots = [];
  for (let s = 0; s < path.length; s += 2.2) {
    const p = path.pointAt(s);
    if (p.y < 7) continue;
    for (const side of [-1, 1]) {
      const q = path.positionAt(s, side * (hw + FENCE_OFFSET + 0.35));
      knots.push({ m: mat4(q.x, q.y + 1.55 + Math.sin(s * 0.7) * 0.12, q.z, { s: [0.32, 0.32, 0.32] }) });
    }
  }
  instanced(ctx, new THREE.IcosahedronGeometry(1, 0), toon(0xe0b070), knots);
}

export default { def, buildScenery, buildRoadDetails };
