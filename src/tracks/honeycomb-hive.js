/**
 * Honeycomb Hive — track module (data + scenery). Cup: bubble-cup (race 4).
 * OWNER: Tracks — Bubble Cup.
 *
 * Bizzy's home meadow. The golden hexagon honey road loops round three
 * flower-petal lobes (the lap is shaped like a big clover) over gentle
 * hills, climbing to a hilltop honey pot, then races straight THROUGH the
 * giant skep beehive — a ribbed golden tunnel full of glowing honey drips
 * and busy, friendly bees. Giant daisies and sunflowers nod, honeycomb
 * towers drip, and bees zip about everywhere.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, SHOULDER_OUT, mat4, frames, smoothstep } from './sceneryKit.js';
import { instanced, animatedInstances, patternTexture, retextureRoad, hexagonPrism } from './props/bubble-kit.js';

/** The skep hive over the meadow-run straight: ring radii (ends -> middle) and spacing. */
export const HIVE = { rEnd: 20, rMid: 24, tube: 3, drop: 3, spacing: 5.2, margin: 10 };

const LAYOUT = {
  start: [0, 0], heading: 90, startAt: 54,
  ops: [
    { s: 110, flex: true, mark: 'hive-straight' },
    { turn: 150, r: 62, y: 4, mark: 'lobe1' },
    { s: 50, y: 6, mark: 'lobe1-out' },
    { turn: -30, r: 60, y: 8, mark: 'dip1' },
    { s: 60, y: 8, flex: true, mark: 'hill-run' },
    { turn: 150, r: 62, y: 10, mark: 'lobe2' },
    { s: 50, y: 4, mark: 'lobe2-out' },
    { turn: -30, r: 60, y: 2, mark: 'dip2' },
    { s: 100, y: 1, mark: 'meadow-run' },
    { turn: 150, r: 62, y: 0, mark: 'lobe3' },
    { s: 50, mark: 'lobe3-out' },
    { turn: -30, r: 60, mark: 'dip3' },
  ],
};

export const def = makeTrack(
  {
    id: 'honeycomb-hive',
    name: 'Honeycomb Hive',
    subtitle: "Buzz through Bizzy's sweet home",
    laps: 3,
    width: 20,
    previewColor: 0xffc444,
    art: ['🐝', '🍯', '🌼'], // menu card emoji: big, bottom-left, top-right
    cup: 'bubble-cup',
    unlock: { type: 'stat', stat: 'itemsUsed', count: 10 },
    theme: {
      skyTop: 0x62c0ff,
      skyBottom: 0xfff3cc,
      fogColor: 0xfff0c8,
      fogNear: 180,
      fogFar: 680,
      ground: 0xa6da76,
      road: 0xffc444, // honey
      roadAlt: 0xffb42e,
      curbA: 0x5a3a24, // bumblebee stripes
      curbB: 0xffd23f,
      offRoad: 0xfff0b8,
      music: 'honeycomb-hive',
      sunColor: 0xfff0c8,
      ambientColor: 0xfff2d0,
      // builder theme extras (see ARCHITECTURE.md -> theme fields)
      groundTints: [0xc8ec7a, 0x8fd46a, 0xbfe57e],
      groundTintMix: 0.6,
      skirt: { color: 0xffc444, trim: 0x5a3a24 },
      pillar: { shape: 'round', color: 0xffe08a, ring: 0x5a3a24 },
    },
  },
  LAYOUT,
  (frac, centroid) => ({
    itemBoxRows: [frac('lobe1', 'mid'), frac('hill-run', 'mid'), frac('lobe2-out', 'end'), frac('meadow-run', 'mid'), frac('lobe3', 'end')],
    boostPads: [
      { at: frac('lobe1-out', 'mid'), lateral: 3 },
      { at: frac('hill-run', 'start') + 0.012, lateral: -3 },
      { at: frac('meadow-run', 'start') + 0.012, lateral: 0 },
      { at: frac('lobe3-out', 'mid'), lateral: -3 },
    ],
    scenery: {
      kind: 'hive',
      terrain: 'hills',
      hills: { amp: 7, scale: 0.012 },
      center: centroid(),
      hive: [frac('meadow-run', 'start'), frac('meadow-run', 'end')],
      hilltop: { at: frac('lobe2', 'mid'), r: 62 },
      fence: { post: 0xfff4d6, postAlt: 0xffd23f, rail: 0xffe08a, topper: 'heart', topperColor: 0xff8fc4 },
      arch: { a: 0xffc444, b: 0x5a3a24, banner: 0xff9f2f, text: 'HONEYCOMB HIVE' },
    },
  }),
);

/** The road surface: golden honeycomb cells with creamy wax walls. */
function hexTexture(ctx) {
  const SQ3 = Math.sqrt(3);
  const shade = [0, 0.1, -0.06, 0.04, -0.1, 0.08, 0.02, -0.04, 0.12, -0.08, 0.05, -0.02];
  const tex = patternTexture(ctx, 192, (u, v) => {
    // tile = 3 hex columns x 4 hex rows (hex size a = 1): exactly periodic
    const X = u * 3 * SQ3, Y = v * 6;
    let d1 = Infinity, d2 = Infinity, id = 0;
    for (let j = -1; j <= 4; j++) {
      const cy = j * 1.5;
      const off = ((j % 2) + 2) % 2 ? SQ3 / 2 : 0;
      for (let i = -1; i <= 3; i++) {
        const cx = i * SQ3 + off;
        const d = Math.hypot(X - cx, Y - cy);
        if (d < d1) { d2 = d1; d1 = d; id = (((i % 3) + 3) % 3) + 3 * (((j % 4) + 4) % 4); } else if (d < d2) d2 = d;
      }
    }
    const edge = d2 - d1; // 0 on a cell wall
    const wall = 1 - smoothstep(0.08, 0.2, edge);
    const glossy = 1 - smoothstep(0, 0.75, d1);
    const k = shade[id % shade.length];
    const honey = [255, 184 + 30 * glossy + 40 * k, 48 + 60 * glossy + 30 * k];
    const wax = [255, 236, 170];
    return honey.map((c, n) => c + (wax[n] - c) * wall);
  });
  // one tile = 3*sqrt(3)*a across x 6a along, with a = 1.25 units
  tex.repeat.set(9 / (3 * SQ3 * 1.25), 9 / (6 * 1.25));
  return tex;
}

export function buildRoadDetails(ctx) {
  retextureRoad(ctx, hexTexture(ctx));
}

export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, hw, L, center, extent, groundH, clearOfRoad, distToRoad,
    scatter, sparkles, backgroundHills, cottonCandyTrees,
  } = ctx;
  const sc = def.scenery;
  const drips = []; // shared honey drips {x, y, z, len, sp, ph}

  buildSkepHive();
  buildHoneyPot();
  buildHoneycombTowers();
  buildFlowers();
  cottonCandyTrees(scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 6) && distToRoad(x, z, 120) > hw + 26, { pad: 110 }),
    [0x8fd46a, 0x6fc85a, 0xb8e07a, 0xffd6ec], { stick: 0xb88a5a });
  buildBees();
  buildDrips();
  backgroundHills(20, extent + 280, extent + 440, [0x8fd46a, 0xb8e07a, 0x7cc860, 0xd8ec8a], { hMin: 22, hMax: 48 });
  sparkles(320, center.x, center.z, extent + 60, 2, 22, [0xfff3a0, 0xffffff, 0xffe070], 1.3);

  // ---------------------------------------------------------------------
  function buildSkepHive() {
    // a giant skep beehive the road runs straight through: stacked golden rings
    const [a, b] = sc.hive;
    const s0 = a * L + HIVE.margin, s1 = b * L - HIVE.margin;
    const n = Math.max(2, Math.floor((s1 - s0) / HIVE.spacing) + 1);
    const mats = [], cols = [];
    const shades = [0xffc444, 0xffb42e, 0xffcf5a];
    const radiusAt = (k) => THREE.MathUtils.lerp(HIVE.rEnd, HIVE.rMid, Math.sin((Math.PI * k) / (n - 1)));
    const frameAt = (k) => {
      const s = s0 + ((s1 - s0) * k) / (n - 1);
      return frames(path, s, s + 0.01, 1)[0];
    };
    for (let k = 0; k < n; k++) {
      const f = frameAt(k);
      const R = radiusAt(k);
      const h = Math.atan2(f.tx, f.tz);
      // the torus lies in its local XY plane; ry = heading stands it across the road
      mats.push(mat4(f.x, f.y - HIVE.drop, f.z, { ry: h, s: R }));
      cols.push(shades[k % shades.length]);
    }
    // the tube radius is authored in torus units, so scale it back to ~HIVE.tube in world units
    const ringGeo = new THREE.TorusGeometry(1, HIVE.tube / ((HIVE.rEnd + HIVE.rMid) / 2), 10, 40);
    instanced(ctx, ringGeo, toon(0xffffff), mats, { colors: cols, ow: 0.012 });
    // glowing honey lanterns hanging inside + honey drips from the ceiling
    const lamps = [];
    for (let k = 1; k < n - 1; k += 2) {
      const f = frameAt(k);
      const R = radiusAt(k);
      const ceil = f.y - HIVE.drop + R - HIVE.tube;
      for (const lat of [-7, 7]) lamps.push({ x: f.x + f.rx * lat, y: ceil - 4.5, z: f.z + f.rz * lat, ph: rng() * 6 });
      drips.push({ x: f.x, y: ceil - 0.4, z: f.z, len: 1.4, sp: 0.6 + rng() * 0.3, ph: rng() * 3 });
    }
    animatedInstances(ctx, new THREE.SphereGeometry(1, 12, 10), glow(0xffe36f), lamps, (it, t, o) => {
      o.position.set(it.x, it.y + Math.sin(t * 1.5 + it.ph) * 0.3, it.z);
      o.scale.setScalar(0.9 + Math.sin(t * 3 + it.ph) * 0.1);
    });
    // honeycomb patches decorating the outside of the hive
    const cells = [];
    for (let k = 0; k < 22; k++) {
      const kk = 1 + Math.floor(rng() * (n - 2));
      const f = frameAt(kk);
      const ang = (0.18 + rng() * 0.64) * Math.PI;
      const R = radiusAt(kk) + HIVE.tube * 0.8;
      const lat = Math.cos(ang) * R;
      cells.push(mat4(f.x + f.rx * lat, f.y - HIVE.drop + Math.sin(ang) * R, f.z + f.rz * lat, {
        ry: Math.atan2(f.tx, f.tz), rz: ang - Math.PI / 2, s: [1.8, 0.9, 1.8],
      }));
    }
    instanced(ctx, hexagonPrism(1, 1), toon(0xffe08a), cells);
  }

  function buildHoneyPot() {
    // hero: a giant honey pot on the hilltop inside the second lobe, honey running over the rim
    const f = frames(path, sc.hilltop.at * L, sc.hilltop.at * L + 0.01, 1)[0];
    const x = f.x - f.rx * sc.hilltop.r, z = f.z - f.rz * sc.hilltop.r;
    if (!clearOfRoad(x, z, SHOULDER_OUT + 18)) return;
    const y = groundH(x, z) - 0.5;
    const pot = new THREE.SphereGeometry(1, 28, 18);
    batch.add(pot, toon(0xc98a4b), mat4(x, y + 10, z, { s: [12, 11, 12] }));
    batch.add(new THREE.CylinderGeometry(8.5, 9.5, 3, 28), toon(0xd99a5a), mat4(x, y + 20.2, z));
    batch.add(new THREE.TorusGeometry(8.6, 1.2, 10, 32), toon(0xe8b070), mat4(x, y + 21.6, z, { rx: Math.PI / 2 }));
    batch.add(new THREE.CylinderGeometry(8, 8, 0.6, 28), toon(0xffb42e), mat4(x, y + 21.4, z), false);
    // a pink ribbon round the pot + a bow
    batch.add(new THREE.TorusGeometry(10.6, 1, 8, 32), toon(0xff8fc4), mat4(x, y + 17.5, z, { rx: Math.PI / 2 }));
    for (const sgn of [-1, 1]) batch.add(new THREE.SphereGeometry(1, 12, 8), toon(0xff8fc4), mat4(x + sgn * 2.2, y + 17.5, z + 10.6, { s: [2.2, 1.4, 0.8] }));
    // honey running down the sides
    const run = new THREE.CapsuleGeometry(1, 1, 4, 10);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + 0.3;
      const len = 3 + (k % 3) * 2.5;
      batch.add(run, toon(0xffb42e), mat4(x + Math.cos(a) * 10.2, y + 18 - len / 2, z + Math.sin(a) * 10.2, { ry: -a, s: [1.2, len, 0.8] }), false);
    }
    // honey dipper leaning in the pot
    batch.add(new THREE.CylinderGeometry(0.7, 0.7, 20, 10), toon(0xe0a86a), mat4(x + 3, y + 26, z, { rz: -0.35 }));
    batch.add(new THREE.CylinderGeometry(2.2, 2.2, 5, 14), toon(0xffc444), mat4(x + 6.4, y + 34.5, z, { rz: -0.35 }));
    drips.push({ x: x + 9, y: y + 13, z: z + 5, len: 2.4, sp: 0.5, ph: 0 });
    drips.push({ x: x - 7, y: y + 12, z: z - 8, len: 2.4, sp: 0.45, ph: 1.4 });
  }

  function buildHoneycombTowers() {
    // clusters of golden hexagon columns, some topped with glowing honey
    const cols = [], colColors = [], tops = [];
    const spots = scatter(14, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 12), { pad: 90 });
    const R = 2.6, SQ3 = Math.sqrt(3);
    const pattern = [[0, 0], [SQ3 * R, 0], [SQ3 * R / 2, 1.5 * R], [-SQ3 * R / 2, 1.5 * R], [-SQ3 * R, 0], [-SQ3 * R / 2, -1.5 * R], [SQ3 * R / 2, -1.5 * R]];
    for (const [x, z] of spots) {
      const gy = groundH(x, z);
      const n = 3 + Math.floor(rng() * 5);
      for (let k = 0; k < n; k++) {
        const [dx, dz] = pattern[k];
        const h = 4 + rng() * 12;
        cols.push(mat4(x + dx, gy + h / 2 - 1, z + dz, { ry: Math.PI / 6, s: [R * 0.98, h, R * 0.98] }));
        colColors.push([0xffc444, 0xffb42e, 0xffd35a, 0xffe08a][k % 4]);
        tops.push(mat4(x + dx, gy + h - 0.9, z + dz, { ry: Math.PI / 6, s: [R * 0.8, 0.4, R * 0.8] }));
        if (rng() < 0.35) drips.push({ x: x + dx + R * 0.7, y: gy + h - 1, z: z + dz, len: 1.6, sp: 0.5 + rng() * 0.4, ph: rng() * 3 });
      }
    }
    instanced(ctx, hexagonPrism(1, 1), toon(0xffffff), cols, { colors: colColors, ow: 0.05 });
    instanced(ctx, hexagonPrism(1, 1), glow(0xffe36f), tops, { outline: false });
  }

  function buildFlowers() {
    // giant daisies and sunflowers that gently nod
    const petalRing = (n, len, w) => mergeGeometries(Array.from({ length: n }, (_, k) => {
      const g = new THREE.SphereGeometry(1, 7, 4);
      g.scale(len, 0.25, w);
      g.translate(len * 0.9, 0, 0);
      g.rotateY((k / n) * Math.PI * 2);
      return g.toNonIndexed();
    }));
    const daisyPetals = petalRing(10, 1.6, 0.6);
    const sunPetals = petalRing(14, 2.2, 0.7);
    const stem = new THREE.CylinderGeometry(0.25, 0.35, 1, 6);
    stem.translate(0, 0.5, 0);
    const centreGeo = new THREE.SphereGeometry(1, 10, 6);
    centreGeo.scale(1, 0.45, 1);
    const near = scatter(70, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 3) && distToRoad(x, z, 80) < hw + 40, { pad: 60 });
    const far = scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 10), { pad: 140 });
    const items = [...near.map((p) => [...p, 1]), ...far.map((p) => [...p, 2.2])].map(([x, z, big], i) => {
      // flower faces turn towards the road to watch the racers go by
      const nr = ctx.index.nearest(x, z, 400);
      const yaw = nr.i >= 0 ? Math.atan2(path.px[nr.i] - x, path.pz[nr.i] - z) : rng() * 6;
      return {
        x, z, y: groundH(x, z) - 0.3, h: (5 + rng() * 5) * big, s: (0.9 + rng() * 0.5) * big, ph: rng() * 6, yaw,
        tilt: big > 1 ? 0.55 : 0.85, sun: i % 3 === 0, color: [0xffffff, 0xff9fc6, 0xfff3a0, 0xd8c8ff][i % 4],
      };
    });
    const sunflowers = items.filter((it) => it.sun), daisies = items.filter((it) => !it.sun);
    const head = (it, t, o, lift = 0) => {
      const nod = Math.sin(t * 1.1 + it.ph) * 0.12;
      o.position.set(it.x + Math.sin(nod) * it.h * 0.3, it.y + it.h + lift, it.z);
      o.rotation.set(it.tilt + nod, it.yaw + Math.sin(t * 0.4 + it.ph) * 0.2, 0, 'YXZ');
      o.scale.setScalar(it.s);
    };
    animatedInstances(ctx, stem, toon(0x5fb84a), items, (it, t, o) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(0, 0, Math.sin(t * 1.1 + it.ph) * 0.04);
      o.scale.set(it.s, it.h, it.s);
    });
    animatedInstances(ctx, daisyPetals, toon(0xffffff), daisies, head, { colors: daisies.map((d) => d.color), outline: true, ow: 0.08 });
    animatedInstances(ctx, sunPetals, toon(0xffd23f), sunflowers, head, { outline: true, ow: 0.08 });
    animatedInstances(ctx, centreGeo, toon(0xffffff), items, (it, t, o) => head(it, t, o, 0.2), {
      colors: items.map((it) => (it.sun ? 0x7a4a2a : 0xffc444)),
    });
  }

  function buildBees() {
    // friendly bumblebees: striped fuzzy bodies, big eyes, flappy wings
    const body = new THREE.SphereGeometry(1, 14, 10).toNonIndexed();
    body.scale(0.8, 0.8, 1.1);
    const pos = body.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const Y = new THREE.Color(0xffd23f), B = new THREE.Color(0x4a3020);
    for (let i = 0; i < pos.count; i += 3) {
      const zc = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const c = zc < -0.75 ? B : Math.floor((zc + 1.1) / 0.45) % 2 ? B : Y;
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    body.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const eyes = mergeGeometries([-1, 1].map((sx) => {
      const g = new THREE.SphereGeometry(0.22, 8, 6).toNonIndexed();
      g.translate(sx * 0.35, 0.25, 1.0);
      return g;
    }));
    const wingGeo = new THREE.SphereGeometry(1, 10, 6);
    wingGeo.scale(0.9, 0.08, 0.55);
    const wings = mergeGeometries([-1, 1].map((sx) => {
      const g = wingGeo.clone().toNonIndexed();
      g.translate(sx * 1.0, 0.8, -0.1);
      return g;
    }));
    const homes = scatter(34, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 2), { pad: 70 });
    const bees = homes.map(([x, z]) => ({
      x, z, y: Math.max(groundH(x, z), 0) + 4 + rng() * 8, r: 3 + rng() * 6, sp: (1 + rng()) * (rng() < 0.5 ? 1 : -1), ph: rng() * 6, s: 0.9 + rng() * 0.5,
    }));
    // a few bees buzzing inside the hive tunnel too
    const [a, b] = sc.hive;
    for (let k = 0; k < 6; k++) {
      const s = (a + (b - a) * (0.2 + k * 0.12)) * L;
      const f = frames(path, s, s + 0.01, 1)[0];
      bees.push({ x: f.x, z: f.z, y: f.y + 9, r: 4 + rng() * 3, sp: 1.6 * (k % 2 ? 1 : -1), ph: rng() * 6, s: 0.8 });
    }
    const pose = (it, t, o) => {
      const ang = t * it.sp * 0.6 + it.ph;
      // a lazy figure-eight around home
      o.position.set(it.x + Math.cos(ang) * it.r, it.y + Math.sin(t * 2.2 + it.ph) * 0.8, it.z + Math.sin(ang * 2) * it.r * 0.5);
      const dx = -Math.sin(ang) * it.r * it.sp, dz = Math.cos(ang * 2) * it.r * it.sp;
      o.rotation.set(0, Math.atan2(dx, dz), Math.sin(t * 3 + it.ph) * 0.15);
      o.scale.setScalar(it.s);
    };
    animatedInstances(ctx, body, ctx.toonVC(), bees, pose, { outline: true, ow: 0.06 });
    animatedInstances(ctx, eyes, toon(0x2a1a2a), bees, pose);
    const wingMat = own(new THREE.MeshBasicMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0.75, depthWrite: false }));
    animatedInstances(ctx, wings, wingMat, bees, (it, t, o) => {
      pose(it, t, o);
      o.scale.set(it.s, it.s * (1 + Math.sin(t * 40 + it.ph) * 0.9), it.s);
    });
  }

  function buildDrips() {
    // honey drips that stretch, fall and plop, over and over
    if (!drips.length) return;
    const drop = new THREE.SphereGeometry(1, 10, 8);
    drop.translate(0, -1, 0);
    animatedInstances(ctx, drop, toon(0xffb42e, { emissive: 0x7a4a00, emissiveIntensity: 0.25 }), drips, (it, t, o) => {
      const u = ((t * it.sp + it.ph) % 1);
      const stretch = smoothstep(0, 0.7, u);
      const fall = u > 0.7 ? (u - 0.7) / 0.3 : 0;
      o.position.set(it.x, it.y - fall * fall * 6, it.z);
      o.scale.set(0.5 * (1 - stretch * 0.3), 0.5 + stretch * it.len * (1 - fall), 0.5 * (1 - stretch * 0.3));
    });
  }
}

export default { def, buildScenery, buildRoadDetails };
