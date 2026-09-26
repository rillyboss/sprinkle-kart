/**
 * Moonbounce Base — track module (data + scenery). Cup: superstar-cup.
 * OWNER: track builder (Superstar Cup).
 *
 * A bouncy moon base under a sky full of candy planets. The road is shaped
 * like a crescent moon (look at the minimap!): a long outer sweep over four
 * boing-boing moon moguls, through a glass tube tunnel between the base domes,
 * round a tight hairpin at the moon's tip, then up and along the rim of the
 * giant crater where the friendly rocket waits for launch day.
 *
 * Low gravity: `def.gameplay` (src/race/gameplay.js) asks physics for floaty
 * hops — the driving-feel code decides exactly what the multipliers do.
 */
import * as THREE from 'three';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, frames, mat4, Batch, extruded, starShape } from './sceneryKit.js';
import { stripedGeometry, instanced, mergeAll, roadFrameAt, sideSpot } from './props/superstar-kit.js';

export const def = makeTrack(
  {
    id: 'moonbounce-base',
    name: 'Moonbounce Base',
    subtitle: 'Boing over the moon moguls in low gravity',
    laps: 3,
    width: 18,
    previewColor: 0xb9a8ff,
    art: ['🌙', '🚀', '⭐'], // menu card emoji: big, bottom-left, top-right
    cup: 'superstar-cup',
    unlock: { type: 'stat', stat: 'wins', count: 8 },
    gameplay: { gravity: 0.55, hopBoost: 1.4 },
    theme: {
      skyTop: 0x0c0830,
      skyBottom: 0x3b2c80,
      fogColor: 0x2f2468,
      fogNear: 220,
      fogFar: 820,
      ground: 0xcdc6ee,
      road: 0x8580cc, // launch-pad lilac
      roadAlt: 0x7a74c2,
      curbA: 0xffe066,
      curbB: 0xffffff,
      offRoad: 0xdcd6f6,
      music: 'moonbounce-base',
      sunColor: 0xe8e0ff,
      ambientColor: 0xa89cff,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      night: true,
      skyStars: true,
      roadSprinkles: { style: 'dots', count: 150, palette: [0xfff27a, 0xffffff, 0x9ff7ff, 0xffb3e6] },
      groundTints: [0xbfb6e8, 0xe4e0f8, 0xc4ccf0],
      groundTintMix: 0.7,
      skirt: { color: 0xd6d0f4, trim: 0xffe066 },
      pillar: { shape: 'round', color: 0xe6e2ff, ring: 0xffe066 },
      startLineDark: 0x2a2266,
    },
  },
  {
    start: [0, 0],
    heading: 0,
    startAt: 54,
    ops: [
      { s: 90, flex: true, mark: 'launch-straight' },
      { turn: 27.5, r: 130, mark: 'outer-0' },
      { turn: 27.5, r: 130, hump: 1.8, mark: 'mogul-1' },
      { turn: 27.5, r: 130, hump: 1.8, mark: 'mogul-2' },
      { turn: 27.5, r: 130, hump: 1.8, mark: 'mogul-3' },
      { turn: 27.5, r: 130, hump: 1.8, mark: 'mogul-4' },
      { turn: 27.5, r: 130, mark: 'outer-5' },
      { turn: 27.5, r: 130, mark: 'outer-6' },
      { turn: 27.5, r: 130, mark: 'outer-7' },
      { s: 40, flex: true, mark: 'tube' },
      { turn: 175, r: 30, mark: 'tip-1' },
      { s: 20, mark: 'tip-1-exit' },
      { turn: -105, r: 55, y: 6, mark: 'rim-1' },
      { turn: -105, r: 55, y: 0, mark: 'rim-2' },
      { s: 60, mark: 'tip-2-entry' },
      { turn: 175, r: 30, mark: 'tip-2' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('outer-0', 'mid'), frac('outer-5', 'mid'), frac('rim-1', 'start'), frac('tip-2-entry', 'mid')],
    boostPads: [
      { at: frac('mogul-2', 'end'), lateral: 3 },
      { at: frac('outer-6', 'end'), lateral: -3 },
      { at: frac('rim-2', 'mid'), lateral: 0 },
    ],
    scenery: {
      kind: 'moon',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 3, scale: 0.02 },
      spots: {
        moguls: ['mogul-1', 'mogul-2', 'mogul-3', 'mogul-4'].map((m) => frac(m, 'mid')),
        tube: [frac('outer-7', 'start'), frac('tube', 'end')],
        crater: frac('rim-1', 'end'), // the rim arcs' midpoint: the crater centre is 55 m to its right
        craterRadius: 55,
        tips: [frac('tip-1', 'mid'), frac('tip-2', 'mid')],
      },
      fence: { post: 0xffffff, postAlt: 0xb9a8ff, rail: 0xe6e2ff, topper: 'star', topperColor: 0xffe066 },
      arch: { a: 0xb9a8ff, b: 0xffe066, banner: 0x6a4cff, text: 'MOON BASE' },
    },
  }),
);

const NEON = [0xfff27a, 0x9ff7ff, 0xffb3e6, 0xc2ffb0];

/** Glowing bounce pads on the mogul crests + chasing runway lights along both edges. */
export function buildRoadDetails(ctx) {
  const { def, path, group, own, hw, L, animate } = ctx;
  // bounce pads: concentric rings painted on each mogul crest
  const padGeos = [];
  for (const f of def.scenery.spots.moguls) {
    const { p, h } = roadFrameAt(path, f * L);
    for (const [r0, r1] of [[1.9, 2.4], [3.7, 4.2], [5.5, 6.0]]) {
      padGeos.push(new THREE.RingGeometry(r0, r1, 32).rotateX(-Math.PI / 2).rotateY(h).translate(p.x, p.y + 0.06, p.z));
    }
  }
  const padMat = own(new THREE.MeshBasicMaterial({ color: 0x9ff7ff, transparent: true, opacity: 0.8, depthWrite: false }));
  const pads = new THREE.Mesh(mergeAll(padGeos), padMat);
  pads.name = 'bounce-pads';
  pads.renderOrder = 1;
  group.add(pads);
  // runway lights with a chasing twinkle
  const step = 6;
  const n = Math.floor(L / step);
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 6, 4), own(new THREE.MeshBasicMaterial({ color: 0xffffff })), n * 2);
  lights.name = 'runway-lights';
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    for (const side of [-1, 1]) {
      path.positionAt(i * step, side * (hw + 0.65), v);
      lights.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), mat4(v.x, v.y + 0.2, v.z));
    }
  }
  const on = new THREE.Color(0xfff27a), off = new THREE.Color(0xd6ceff), c = new THREE.Color();
  const paint = (t) => {
    for (let i = 0; i < n; i++) {
      const k = ((i - t * 12) % 14 + 14) % 14;
      c.copy(off).lerp(on, k < 2 ? 1 - k / 2 : 0);
      lights.setColorAt(i * 2, c);
      lights.setColorAt(i * 2 + 1, c);
    }
    lights.instanceColor.needsUpdate = true;
  };
  paint(0);
  group.add(lights);
  animate((dt, t) => {
    paint(t);
    padMat.color.setHSL(0.5 + Math.sin(t * 2) * 0.08, 1, 0.75);
    padMat.opacity = 0.45 + Math.sin(t * 5) * 0.15;
  });
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, outlineMat, toonVC,
    hw, L, center, extent, groundH, clearOfRoad, animate,
    scatter, sparkles, floatingShapes,
  } = ctx;
  const spots = def.scenery.spots;
  const edge = hw + FENCE_OFFSET;
  const cq = sideSpot(path, spots.crater * L, spots.craterRadius);
  const crater = { x: cq.x, z: cq.z, r: 24 };

  bigCrater();
  rocket();
  glassTube();
  domes();
  radarAndAntennas();
  craters();
  bunnies();
  planets();
  floatingShapes(new THREE.DodecahedronGeometry(1, 0), scatter(40, (x, z) => clearOfRoad(x, z, 8), { pad: 80 }), [0xb9b0e0, 0xd6d0f4, 0xa89cd8], { yMin: 6, yMax: 26, scale: [1, 3] });
  floatingShapes(extruded(starShape(5, 1, 0.45), 0.35, 0.08, 1), scatter(36, (x, z) => clearOfRoad(x, z, 8), { pad: 90 }), NEON, { yMin: 10, yMax: 40, scale: [1.2, 2.6], glowy: true });
  sparkles(520, center.x, center.z, extent + 140, -4, 70, [0xffffff, 0x9ff7ff, 0xfff27a, 0xffb3e6], 2.2);

  // ---------------------------------------------------------------------
  /** The giant crater the rim road wraps around. */
  function bigCrater() {
    const y = groundH(crater.x, crater.z);
    batch.add(new THREE.TorusGeometry(crater.r, 3.2, 10, 48).rotateX(Math.PI / 2), toon(0xd8d2f4), mat4(crater.x, y + 0.2, crater.z, { s: [1, 0.55, 1] }));
    batch.add(new THREE.CircleGeometry(crater.r, 48).rotateX(-Math.PI / 2), toon(0x9a90d0), mat4(crater.x, y + 0.08, crater.z), false);
    batch.add(new THREE.CircleGeometry(crater.r * 0.55, 40).rotateX(-Math.PI / 2), toon(0x8a80c4), mat4(crater.x, y + 0.1, crater.z), false);
  }

  /** A tall, friendly striped rocket on its launch pad in the crater, puffing little clouds. */
  function rocket() {
    const y = groundH(crater.x, crater.z) + 0.1;
    const g = new THREE.Group();
    g.name = 'rocket';
    g.position.set(crater.x, y, crater.z);
    group.add(g);
    const b = new Batch();
    b.add(new THREE.CylinderGeometry(9, 10, 1.4, 24), toon(0xffe066), mat4(0, 0.7, 0));
    b.add(new THREE.CylinderGeometry(6.5, 6.5, 0.4, 24), toon(0x6a4cff), mat4(0, 1.6, 0), false);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      b.add(new THREE.BoxGeometry(0.8, 18, 0.8), toon(0xffffff), mat4(Math.cos(a) * 7.5, 9, Math.sin(a) * 7.5));
    }
    b.build(g, outlineMat);
    const ship = new THREE.Group();
    ship.position.y = 2;
    g.add(ship);
    const bodyMesh = new THREE.Mesh(stripedGeometry(new THREE.CylinderGeometry(3.4, 3.8, 20, 24, 4), [0xffffff, 0xffffff, 0xff7fb8, 0xffffff], 24), toonVC());
    bodyMesh.position.y = 13;
    ship.add(bodyMesh);
    const sb = new Batch();
    sb.add(new THREE.ConeGeometry(3.4, 8, 24), toon(0xff7fb8), mat4(0, 27, 0));
    sb.add(new THREE.SphereGeometry(0.9, 12, 10), glow(0xfff27a), mat4(0, 31.4, 0), false);
    sb.add(new THREE.CylinderGeometry(2.6, 3.2, 3, 20), toon(0x9ff7ff), mat4(0, 1.5, 0));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      sb.add(new THREE.BoxGeometry(0.6, 7, 4.2), toon(0x6a4cff), mat4(Math.cos(a) * 4.4, 5.5, Math.sin(a) * 4.4, { ry: -a }));
      // round porthole windows
      const wa = a + 1;
      sb.add(new THREE.CylinderGeometry(1.1, 1.1, 0.4, 16).rotateZ(Math.PI / 2), glow(0x9ff7ff), mat4(Math.cos(wa) * 3.45, 17, Math.sin(wa) * 3.45, { ry: -wa }), false);
      sb.add(new THREE.TorusGeometry(1.15, 0.22, 6, 16).rotateY(Math.PI / 2), toon(0xffe066), mat4(Math.cos(wa) * 3.5, 17, Math.sin(wa) * 3.5, { ry: -wa }), false);
    }
    sb.build(ship, outlineMat);
    // idle puffs of happy steam round the base
    const nP = 10;
    const puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), toon(0xffffff, { emissive: 0x6a5acd, emissiveIntensity: 0.35 }), nP);
    g.add(puffs);
    const seeds = Array.from({ length: nP }, (_, i) => ({ a: (i / nP) * Math.PI * 2, ph: rng() }));
    const update = (t) => {
      ship.position.y = 2 + Math.sin(t * 1.1) * 0.25;
      seeds.forEach((sd, i) => {
        const k = (t * 0.35 + sd.ph) % 1;
        const r = 4 + k * 7;
        puffs.setMatrixAt(i, mat4(Math.cos(sd.a) * r, 2.5 + k * 3, Math.sin(sd.a) * r, { s: 1.2 + k * 2.2 * (1 - k * 0.6) }));
      });
      puffs.instanceMatrix.needsUpdate = true;
    };
    update(0);
    animate((dt, t) => update(t));
  }

  /** The glass tube tunnel over the end of the outer sweep. */
  function glassTube() {
    const [f0, f1] = spots.tube;
    const s0 = f0 * L, s1 = f1 * L;
    const R = edge + 1.4;
    const fr = frames(path, s0, s1, 2);
    // translucent half-pipe shell
    const pos = [], idx = [];
    const seg = 16;
    fr.forEach((f) => {
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI;
        const lat = Math.cos(a) * R, up = Math.sin(a) * R * 0.72;
        pos.push(f.x + f.rx * lat, f.y + up, f.z + f.rz * lat);
      }
    });
    for (let i = 0; i < fr.length - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const a = i * (seg + 1) + k, b = a + seg + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const glass = new THREE.Mesh(g, own(new THREE.MeshBasicMaterial({ color: 0x9ff7ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })));
    glass.name = 'glass-tube';
    glass.renderOrder = 2;
    group.add(glass);
    // glowing ribs
    const ribMat = own(new THREE.MeshBasicMaterial({ color: 0x9ff7ff }));
    const ribs = [];
    for (let s = s0; s <= s1 + 0.01; s += 9) {
      const { p, h } = roadFrameAt(path, s);
      ribs.push({ m: mat4(p.x, p.y, p.z, { ry: h, s: [1, 0.72, 1] }) });
    }
    instanced(ctx, new THREE.TorusGeometry(R, 0.28, 6, 32, Math.PI), ribMat, ribs, { outline: false });
    // chunky end rings
    for (const s of [s0, s1]) {
      const { p, h } = roadFrameAt(path, s);
      batch.add(new THREE.TorusGeometry(R + 0.3, 1.0, 10, 40, Math.PI), toon(0xe6e2ff), mat4(p.x, p.y, p.z, { ry: h, s: [1, 0.72, 1] }));
    }
    animate((dt, t) => { ribMat.color.setHSL(0.5 + Math.sin(t * 0.8) * 0.08, 1, 0.72); });
  }

  /** Glass habitat domes with little candy gardens inside, near the tube. */
  function domes() {
    const [f0, f1] = spots.tube;
    const list = [];
    for (const [f, side, r] of [[f0 - 0.02, 1, 12], [f0 + 0.03, -1, 9], [(f0 + f1) / 2, 1, 10], [f1 + 0.01, -1, 13], [f1 + 0.05, 1, 8]]) {
      const q = sideSpot(path, f * L, side * (edge + r + 5));
      if (!clearOfRoad(q.x, q.z, FENCE_OFFSET + r + 1)) continue;
      list.push({ x: q.x, z: q.z, y: groundH(q.x, q.z), r });
    }
    const domeGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const glassMat = own(new THREE.MeshBasicMaterial({ color: 0xbff3ff, transparent: true, opacity: 0.28, depthWrite: false }));
    for (const d of list) {
      const m = new THREE.Mesh(domeGeo, glassMat);
      m.position.set(d.x, d.y, d.z);
      m.scale.setScalar(d.r);
      m.renderOrder = 2;
      group.add(m);
      batch.add(new THREE.TorusGeometry(d.r, 0.6, 8, 40).rotateX(Math.PI / 2), toon(0xffe066), mat4(d.x, d.y + 0.3, d.z), false);
      for (let k = 0; k < 3; k++) {
        const a = rng() * Math.PI * 2, rr = d.r * 0.45 * rng();
        const tx = d.x + Math.cos(a) * rr, tz = d.z + Math.sin(a) * rr;
        batch.add(new THREE.CylinderGeometry(0.2, 0.25, 2.5, 6), toon(0xffffff), mat4(tx, d.y + 1.25, tz), false);
        batch.add(new THREE.IcosahedronGeometry(1.5, 1), toon(NEON[k % NEON.length]), mat4(tx, d.y + 3.2, tz));
      }
    }
  }

  /** A turning radar dish and blinking antenna towers. */
  function radarAndAntennas() {
    const [t1, t2] = spots.tips;
    const q = sideSpot(path, t1 * L, edge + 26);
    if (clearOfRoad(q.x, q.z, FENCE_OFFSET + 12)) {
      const y = groundH(q.x, q.z);
      batch.add(new THREE.CylinderGeometry(1.4, 2.4, 8, 10), toon(0xe6e2ff), mat4(q.x, y + 4, q.z));
      const dish = new THREE.Group();
      dish.name = 'radar';
      dish.position.set(q.x, y + 9, q.z);
      group.add(dish);
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), toon(0xffffff, { side: THREE.DoubleSide }));
      bowl.rotation.x = Math.PI * 0.72;
      dish.add(bowl);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), glow(0xffb3e6));
      tip.position.set(0, 1.8, 3);
      dish.add(tip);
      animate((dt, t) => { dish.rotation.y = t * 0.35; });
    }
    const beacons = [];
    for (const [f, side] of [[t2, 1], [0.2, 1], [0.7, -1], [0.45, 1]]) {
      const a = sideSpot(path, f * L, side * (edge + 16));
      if (!clearOfRoad(a.x, a.z, FENCE_OFFSET + 6)) continue;
      const y = groundH(a.x, a.z);
      batch.add(new THREE.CylinderGeometry(0.3, 0.6, 16, 6), toon(0xffffff), mat4(a.x, y + 8, a.z));
      for (const h of [5, 10]) batch.add(new THREE.TorusGeometry(1, 0.15, 5, 16).rotateX(Math.PI / 2), toon(0xb9a8ff), mat4(a.x, y + h, a.z), false);
      beacons.push({ m: mat4(a.x, y + 16.6, a.z) });
    }
    const beaconMat = own(new THREE.MeshBasicMaterial({ color: 0xff7fb8 }));
    instanced(ctx, new THREE.SphereGeometry(0.9, 10, 8), beaconMat, beacons, { outline: false });
    animate((dt, t) => { beaconMat.color.setHSL(0.92, 1, Math.sin(t * 4) > 0 ? 0.72 : 0.35); });
  }

  /** Little craters all over the moon. */
  function craters() {
    const rims = [], floors = [];
    for (const [x, z] of scatter(60, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 7) && Math.hypot(x - crater.x, z - crater.z) > crater.r + 8, { pad: 150 })) {
      const r = 2.5 + rng() * 6;
      if (!clearOfRoad(x, z, FENCE_OFFSET + r + 2)) continue;
      const y = groundH(x, z);
      rims.push({ m: mat4(x, y + 0.1, z, { s: [r, r * 0.55, r] }) });
      floors.push({ m: mat4(x, y + 0.06, z, { s: r }) });
    }
    instanced(ctx, new THREE.TorusGeometry(1, 0.28, 6, 20).rotateX(Math.PI / 2), toon(0xd8d2f4), rims, { ow: 0.03 });
    instanced(ctx, new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), toon(0xa89ed8), floors, { outline: false });
  }

  /** Moon bunnies doing big, slow, low-gravity hops beside the road. */
  function bunnies() {
    const body = mergeAll([
      new THREE.SphereGeometry(0.8, 12, 10).scale(1, 0.9, 1.1).translate(0, 0.8, 0),
      new THREE.SphereGeometry(0.55, 12, 10).translate(0, 1.7, 0.45),
      new THREE.CapsuleGeometry(0.14, 0.8, 3, 6).rotateX(-0.2).translate(-0.22, 2.55, 0.35),
      new THREE.CapsuleGeometry(0.14, 0.8, 3, 6).rotateX(-0.2).translate(0.22, 2.55, 0.35),
      new THREE.SphereGeometry(0.28, 8, 6).translate(0, 0.9, -0.85),
    ]);
    const cheeks = mergeAll([new THREE.SphereGeometry(0.12, 6, 4).translate(-0.3, 1.62, 0.9), new THREE.SphereGeometry(0.12, 6, 4).translate(0.3, 1.62, 0.9)]);
    const list = [];
    for (let k = 0; k < 16; k++) {
      const s = ((k + 0.5) / 16 + (rng() - 0.5) * 0.02) * L;
      const side = k % 2 ? 1 : -1;
      const q = sideSpot(path, s, side * (edge + 4 + rng() * 10));
      if (!clearOfRoad(q.x, q.z, FENCE_OFFSET + 2.5)) continue;
      const { p } = roadFrameAt(path, s);
      list.push({ x: q.x, z: q.z, y: groundH(q.x, q.z), face: Math.atan2(p.x - q.x, p.z - q.z), ph: rng() * 6, sp: 0.8 + rng() * 0.4 });
    }
    const meshes = [
      new THREE.InstancedMesh(body, toon(0xffffff, { emissive: 0x4a3a90, emissiveIntensity: 0.3 }), list.length),
      new THREE.InstancedMesh(cheeks, glow(0xff9fd0), list.length),
    ];
    group.add(...meshes);
    const update = (t) => {
      list.forEach((b, i) => {
        const k = (t * b.sp * 0.6 + b.ph) % 1;
        const hop = Math.sin(k * Math.PI) * 3.2; // floaty moon hop
        const squish = k < 0.06 || k > 0.94 ? 0.8 : 1;
        const m = mat4(b.x, b.y + hop, b.z, { ry: b.face, s: [1 / Math.sqrt(squish), squish, 1 / Math.sqrt(squish)] });
        for (const mesh of meshes) mesh.setMatrixAt(i, m);
      });
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    };
    update(0);
    animate((dt, t) => update(t));
  }

  /** Candy planets and a ringed bubblegum giant in the sky. */
  function planets() {
    const list = [
      { d: [-320, 150, -300], r: 70, c: 0x7fd8c0, ring: null, face: true },
      { d: [360, 190, 140], r: 48, c: 0xff9fd0, ring: 0xfff27a },
      { d: [80, 260, 420], r: 26, c: 0xffc46b, ring: null },
      { d: [-420, 110, 260], r: 20, c: 0xb9a8ff, ring: 0xffffff },
    ];
    for (const pl of list) {
      const pm = own(toon(pl.c, { unique: true, emissive: pl.c, emissiveIntensity: 0.3 }));
      pm.fog = false;
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(pl.r, 36, 24), pm);
      sphere.position.set(center.x + pl.d[0] * 1.3, pl.d[1], center.z + pl.d[2] * 1.3);
      group.add(sphere);
      if (pl.ring) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(pl.r * 1.35, pl.r * 1.9, 64), own(new THREE.MeshBasicMaterial({ color: pl.ring, transparent: true, opacity: 0.7, side: THREE.DoubleSide, fog: false })));
        ring.position.copy(sphere.position);
        ring.rotation.set(-Math.PI / 2 + 0.35, 0.25, 0);
        group.add(ring);
      }
      if (pl.face) {
        // a sleepy smile, turned toward the track
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
        const smile = new THREE.Mesh(new THREE.TorusGeometry(pl.r * 0.2, pl.r * 0.03, 6, 20, Math.PI), fm);
        smile.position.set(0, -pl.r * 0.1, pl.r * 0.94);
        smile.rotation.z = Math.PI;
        face.add(smile);
        group.add(face);
      }
    }
  }
}

export default { def, buildScenery, buildRoadDetails };
