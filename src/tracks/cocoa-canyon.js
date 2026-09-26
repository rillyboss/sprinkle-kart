/**
 * Cocoa Canyon — track module (data + scenery). Cup: adventure-cup.
 * OWNER: Tracks — Adventure Cup.
 *
 * A desert canyon made of layered chocolate rock. The lap snakes through the
 * esses, squeezes down a narrow SLOT CANYON, swings up onto the mesa in one
 * long banked-feeling SWEEPER, passes under the giant Cocoa Arch, crosses the
 * chocolate river below a cocoa waterfall and finishes with the tight
 * Caramel Hairpin at the end of the "finger".
 */
import * as THREE from 'three';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, mat4, ribbon, stripeTexture, distToPolyline } from './sceneryKit.js';
import { instanced, animatedInstances, isClearOfCamera, farRing, capsule, spotsAlong } from './props/adventure-kit.js';

/** Layered chocolate rock colours: dark, milk, caramel, white chocolate, strawberry. */
export const ROCK_LAYERS = Object.freeze([0x5a3220, 0x8a5536, 0xc98a4b, 0xf2dcb4, 0xf2a0b4]);

export const def = makeTrack(
  {
    id: 'cocoa-canyon',
    name: 'Cocoa Canyon',
    subtitle: 'Chocolate rocks and a cocoa waterfall',
    laps: 3,
    width: 18,
    previewColor: 0xc98a4b,
    art: ['🍫', '🌵', '🏜️'], // menu card emoji: big, bottom-left, top-right
    cup: 'adventure-cup',
    unlock: { type: 'stat', stat: 'timeTrialsFinished', count: 1 },
    theme: {
      skyTop: 0x4fa3e8,
      skyBottom: 0xffe3bd,
      fogColor: 0xffd9b3,
      fogNear: 170,
      fogFar: 680,
      ground: 0xe6ad78,
      road: 0xc7864a, // caramel
      roadAlt: 0xb87940,
      curbA: 0x6b3a22, // dark chocolate
      curbB: 0xfff0d6, // white chocolate
      offRoad: 0xeec18e,
      music: 'cocoa-canyon',
      sunColor: 0xffe4bc,
      ambientColor: 0xffe8d8,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      roadSprinkles: { style: 'dots', count: 140, palette: [0x4a2616, 0x4a2616, 0xfff0d6, 0xff9ec4, 0x6b3a22] },
      groundTints: [0xd9956a, 0xf2c890, 0xf4b3a0],
      groundTintMix: 0.7,
      skirt: { color: 0x7a4a2a, trim: 0xf2dcb4 },
      pillar: { shape: 'box', color: 0x8a5536, ring: 0xf2dcb4 },
    },
  },
  {
    start: [0, 0],
    heading: 0,
    startAt: 54,
    ops: [
      { s: 120, flex: true, mark: 'start-straight' },
      { turn: -40, r: 90, mark: 'esses-1' },
      { turn: 60, r: 80, y: 2, mark: 'esses-2' },
      { turn: -50, r: 90, y: 4, mark: 'esses-3' },
      { s: 80, y: 6, mark: 'slot-canyon' },
      { turn: -150, r: 105, y: 11, mark: 'sweeper' },
      { s: 110, y: 11, mark: 'mesa-top' },
      { turn: -60, r: 60, y: 9, mark: 'mesa-exit' },
      { s: 50, y: 7, flex: true, mark: 'descent' },
      { s: 36, y: 6, mark: 'bridge' },
      { s: 50, y: 4, mark: 'descent-2' },
      { turn: 60, r: 60, y: 3, mark: 'finger-turn' },
      { s: 90, y: 2, mark: 'finger-run' },
      { turn: -180, r: 30, y: 1, mark: 'hairpin' },
      { s: 30, y: 0, mark: 'return' },
      { turn: 20, r: 80, mark: 'kink' },
      { turn: -20, r: 80, mark: 'kink2' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('esses-2', 'mid'), frac('sweeper', 'mid'), frac('descent', 'mid'), frac('finger-run', 'mid')],
    boostPads: [
      { at: frac('slot-canyon', 'mid'), lateral: 3 },
      { at: frac('mesa-top', 'mid'), lateral: -3 },
      { at: frac('descent-2', 'mid'), lateral: 3 },
      { at: frac('hairpin', 'end') + 0.008, lateral: -3 },
    ],
    scenery: {
      kind: 'canyon',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 9, scale: 0.012 },
      bridges: [[frac('bridge', 'start') - 0.02, frac('bridge', 'end') + 0.02]],
      river: { at: frac('bridge', 'mid') },
      slot: [frac('slot-canyon', 'start') - 0.01, frac('slot-canyon', 'end') + 0.005],
      cocoaArch: frac('mesa-top', 'mid') + 0.012,
      fence: { post: 0x6b3a22, postAlt: 0xfff0d6, rail: 0xf2dcb4, topper: 'ball', topperColor: 0xff8fb8 },
      arch: { a: 0x8a5536, b: 0xfff0d6, banner: 0xff7fae, text: 'SPRINKLE KART' },
    },
  }),
);

/**
 * Before the terrain is made: trace the chocolate river (perpendicular to the
 * road at the bridge, wiggling off both ways, stopping before other road) so
 * the hills carve a channel for it. The end that points towards the middle of
 * the track is where the waterfall pours in (scenery.riverFallsEnd = 0 | 1).
 */
export function prepare({ def, path, index }) {
  if (!def.scenery?.river) return def;
  const riverLine = riverPolyline(def, path, index);
  const [cx, cz] = def.scenery.center;
  const d0 = Math.hypot(riverLine[0][0] - cx, riverLine[0][1] - cz);
  const d1 = Math.hypot(riverLine[riverLine.length - 1][0] - cx, riverLine[riverLine.length - 1][1] - cz);
  return { ...def, scenery: { ...def.scenery, riverLine, riverFallsEnd: d0 < d1 ? 0 : 1 } };
}

export function riverPolyline(def, path, index) {
  const s = def.scenery.river.at * path.length;
  const p = path.pointAt(s);
  const r = path.rightAt(s);
  const hw = path.halfWidth;
  const [a, b] = def.scenery.bridges[0];
  const inBridge = (i) => {
    const si = i * path.step;
    return si >= a * path.length - 30 && si <= b * path.length + 30;
  };
  const sides = [];
  for (const dir of [-1, 1]) {
    const pts = [];
    for (let d = 0; d <= 220; d += 6) {
      const wig = Math.sin(d * 0.035) * 9 * Math.min(1, d / 40);
      const x = p.x + r.x * d * dir - r.z * wig;
      const z = p.z + r.z * d * dir + r.x * wig;
      const n = index.nearest(x, z, hw + 40);
      if (d > 30 && n.i >= 0 && !inBridge(n.i) && n.dist < hw + 30) break;
      pts.push([x, z]);
    }
    sides.push(pts);
  }
  return [...sides[0].reverse(), ...sides[1].slice(1)];
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, own, ownTex, toonTex, hw, center, extent, groundH, distToRoad, clearOfRoad, animators,
    scatter, sparkles, backgroundHills,
  } = ctx;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const river = def.scenery.riverLine || [];
  const nearRiver = (x, z, m) => river.length > 1 && distToPolyline(x, z, river) < m;
  const rockGeo = new THREE.CylinderGeometry(1, 1.06, 1, 8);
  const rocks = []; // every layered rock slab in the world goes into ONE instanced mesh

  buildRiverAndFalls();
  buildSlotCanyon();
  buildMesas();
  buildCocoaArch();
  flushRocks();
  buildMarshmallowCacti();
  buildBoulders();
  buildTumbleweeds();
  backgroundHills(18, extent + 260, extent + 420, [0xd9956a, 0xc98a4b, 0xe6ad78, 0xb87940], { hMin: 30, hMax: 60 });
  sparkles(220, center.x, center.z, extent + 40, 2, 20, [0xfff0d6, 0xffd1e6, 0xffffff], 1.1); // sugar dust

  // --------------------------------------------------------------------------

  /** A stack of chocolate layers (each a slab in the shared rock mesh). */
  function mesa(x, z, r, h, { y0 = groundH(x, z) - 1.5, layers = 3 + Math.floor(rng() * 3), taper = 0.9, ry = rng() * Math.PI } = {}) {
    let y = y0, rr = r;
    const k0 = Math.floor(rng() * ROCK_LAYERS.length);
    for (let k = 0; k < layers; k++) {
      const lh = (h / layers) * (0.7 + rng() * 0.6);
      rocks.push({ m: mat4(x, y + lh / 2, z, { s: [rr, lh, rr * (0.85 + rng() * 0.3)], ry }), c: ROCK_LAYERS[(k0 + k) % ROCK_LAYERS.length] });
      y += lh;
      rr *= taper + rng() * 0.08;
    }
    return y;
  }

  function flushRocks() {
    instanced(ctx, rockGeo, toon(0xffffff), rocks, { outline: 0.05 });
  }

  function buildRiverAndFalls() {
    if (river.length < 2) return;
    const pos = [];
    for (let i = 0; i < river.length - 1; i++) {
      const [ax, az] = river[i], [bx, bz] = river[i + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const ux = (-dz / len) * 8, uz = (dx / len) * 8;
      const y = -1.25;
      pos.push(ax - ux, y, az - uz, bx - ux, y, bz - uz, ax + ux, y, az + uz);
      pos.push(ax + ux, y, az + uz, bx - ux, y, bz - uz, bx + ux, y, bz + uz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const cocoa = own(toon(0x6b3a22, { unique: true, emissive: 0x2a1208, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
    group.add(new THREE.Mesh(g, cocoa));
    animators.push((dt, t) => { cocoa.emissiveIntensity = 0.28 + Math.sin(t * 2.1) * 0.06; });
    // marshmallows floating down the river
    const mm = [];
    for (let i = 0; i < 16; i++) mm.push({ u: rng(), off: (rng() - 0.5) * 9, ph: rng() * 6, c: pick([0xffffff, 0xffd1e6, 0xfff0d6]) });
    const totalLen = river.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - river[i - 1][0], p[1] - river[i - 1][1]) : 0), 0);
    const at = (u) => {
      let d = u * totalLen;
      for (let i = 1; i < river.length; i++) {
        const [ax, az] = river[i - 1], [bx, bz] = river[i];
        const l = Math.hypot(bx - ax, bz - az);
        if (d <= l) { const t = d / l; return [ax + (bx - ax) * t, az + (bz - az) * t, bx - ax, bz - az]; }
        d -= l;
      }
      const e = river[river.length - 1];
      return [e[0], e[1], 1, 0];
    };
    const flow = def.scenery.riverFallsEnd === 0 ? 1 : -1; // flows away from the waterfall
    animatedInstances(ctx, new THREE.CylinderGeometry(1, 1, 1.3, 12), toon(0xffffff), mm, (m, t, o) => {
      let u = (m.u + flow * t * 0.012) % 1;
      if (u < 0) u += 1;
      const [x, z, dx, dz] = at(u);
      const l = Math.hypot(dx, dz) || 1;
      o.x = x + (-dz / l) * m.off; o.z = z + (dx / l) * m.off; o.y = -1.05 + Math.sin(t * 1.6 + m.ph) * 0.12;
      o.rz = 1.45; o.ry = m.ph + t * 0.2;
    }, { outline: 0.06 });

    // the waterfall: a tall chocolate cliff with a cocoa curtain pouring into a pool
    const endIdx = def.scenery.riverFallsEnd === 0 ? 0 : river.length - 1;
    const e = river[endIdx];
    const prev = river[endIdx === 0 ? 1 : endIdx - 1];
    const dx = e[0] - prev[0], dz = e[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1;
    const fx = dx / l, fz = dz / l; // pointing from the river into the cliff
    const pool = new THREE.Mesh(new THREE.CircleGeometry(14, 32), cocoa);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(e[0], -1.24, e[1]);
    group.add(pool);
    const cx = e[0] + fx * 22, cz = e[1] + fz * 22;
    const top = mesa(cx, cz, 18, 34, { y0: -3, layers: 5, taper: 0.93, ry: Math.atan2(fx, fz) });
    const fallTex = ownTex(stripeTexture(0x7a4127, 0x9a5a34, 6));
    fallTex.repeat.set(1, 3);
    const fallMat = toonTex(fallTex, 0xffffff, { side: THREE.DoubleSide, emissive: 0x2a1208, emissiveIntensity: 0.35 });
    const fallH = top + 1;
    const fall = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 8, fallH, 12, 1, true, -Math.PI / 2.4, Math.PI / 1.2), fallMat);
    fall.position.set(e[0] + fx * 6, fallH / 2 - 1.3, e[1] + fz * 6);
    fall.rotation.y = Math.atan2(-fx, -fz) + Math.PI;
    group.add(fall);
    animators.push((dt, t) => { fallTex.offset.y = (t * 0.9) % 1; });
    // marshmallow foam puffs where the cocoa splashes down
    const foam = [];
    for (let k = 0; k < 12; k++) {
      const a = rng() * Math.PI * 2, r = 3 + rng() * 6;
      foam.push({ x: e[0] + fx * 4 + Math.cos(a) * r, z: e[1] + fz * 4 + Math.sin(a) * r, s: 1 + rng() * 1.4, ph: rng() * 6 });
    }
    animatedInstances(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff, { emissive: 0x554444, emissiveIntensity: 0.3 }), foam, (f, t, o) => {
      const k = 0.85 + Math.sin(t * 3 + f.ph) * 0.2;
      o.x = f.x; o.y = -0.9 + Math.sin(t * 2.4 + f.ph) * 0.25; o.z = f.z;
      o.sx = o.sz = f.s * k; o.sy = f.s * k * 0.7;
    });
  }

  /** Tall layered walls on both sides of the slot canyon: squeeze through! */
  function buildSlotCanyon() {
    const [f0, f1] = def.scenery.slot;
    for (const p of spotsAlong(ctx, { from: f0, to: f1, every: 9, gap: FENCE_OFFSET + 9, jitter: 5 })) {
      const r = 6 + rng() * 3;
      const q = path.positionAt(p.s, p.side * (hw + FENCE_OFFSET + 3.5 + r + rng() * 3));
      if (!clearOfRoad(q.x, q.z, FENCE_OFFSET + 3 + r * 0.9)) continue;
      mesa(q.x, q.z, r, 20 + rng() * 14, { layers: 4 + Math.floor(rng() * 2), taper: 0.94 });
    }
  }

  function buildMesas() {
    // big buttes around the canyon (well away from the road)
    let n = 0;
    for (const [x, z] of scatter(60, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 30) && !nearRiver(x, z, 30), { pad: 110 })) {
      const r = 12 + rng() * 14;
      if (!clearOfRoad(x, z, FENCE_OFFSET + r + 8)) continue;
      mesa(x, z, r, 16 + rng() * 26);
      if (++n >= 16) break;
    }
    // little hoodoo stacks closer in
    for (const [x, z] of scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 8) && isClearOfCamera(ctx, x, z, 3) && !nearRiver(x, z, 14), { pad: 80 })) {
      mesa(x, z, 1.8 + rng() * 1.8, 5 + rng() * 9, { layers: 3, taper: 0.8 });
    }
    // a far ring of tall mesas on the horizon
    for (const [x, z] of farRing(ctx, 14, extent + 190, extent + 280)) mesa(x, z, 30 + rng() * 25, 40 + rng() * 40, { y0: -4, layers: 4 });
  }

  /** The giant natural rock arch spanning the mesa-top road. */
  function buildCocoaArch() {
    const s = def.scenery.cocoaArch * path.length;
    const p = path.pointAt(s);
    const h = path.headingAt(s);
    const span = hw + FENCE_OFFSET + 7;
    const arch = new THREE.TorusGeometry(span, 3.6, 8, 24, Math.PI);
    const cream = new THREE.TorusGeometry(span, 1.2, 6, 24, Math.PI);
    const rot = { ry: h, s: [1, 1.15, 1] };
    ctx.batch.add(arch, toon(0x8a5536), mat4(p.x, p.y - 2, p.z, rot));
    ctx.batch.add(cream, toon(0xfff0d6), mat4(p.x, p.y - 2 + 3.3, p.z, { ...rot, s: [1.02, 1.2, 1.4] }), false);
    // chunky feet so it looks carved out of the canyon
    for (const side of [-1, 1]) {
      const q = path.positionAt(s, side * span);
      mesa(q.x, q.z, 5.5, 10, { y0: groundH(q.x, q.z) - 2, layers: 3, taper: 0.8 });
    }
    // strawberry-cream drips hanging off the arch
    const drips = [];
    for (let a = 0.25; a < Math.PI - 0.2; a += 0.22) {
      const lx = Math.cos(a) * span, ly = Math.sin(a) * span * 1.15 - 2;
      const x = p.x + Math.cos(h) * lx, z = p.z - Math.sin(h) * lx;
      drips.push({ m: mat4(x, p.y + ly - 3.6, z, { s: [0.7, 1.4 + rng() * 1.2, 0.7] }) });
    }
    instanced(ctx, capsule(1, 1, 3, 8), toon(0xf2a0b4), drips);
  }

  /** Marshmallow cacti: pillowy white/pink bodies, arms, and a sugar flower. */
  function buildMarshmallowCacti() {
    const spots = scatter(70, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 4) && isClearOfCamera(ctx, x, z, 2.5) && !nearRiver(x, z, 12), { pad: 100 });
    const bodies = [], arms = [], flowers = [];
    const bodyGeo = capsule(1, 1, 3, 8);
    for (const [x, z] of spots) {
      const h = 3 + rng() * 4;
      const y = groundH(x, z);
      const c = pick([0xffffff, 0xffe3ef, 0xfff4dc, 0xd9f5e8]);
      const ry = rng() * Math.PI;
      bodies.push({ m: mat4(x, y + h / 2 + 0.6, z, { s: [1.1, h / 2, 1.1], ry }), c });
      const nArms = 1 + Math.floor(rng() * 2);
      for (let k = 0; k < nArms; k++) {
        const side = k === 0 ? 1 : -1;
        const ay = y + h * (0.45 + rng() * 0.25);
        const ax = x + Math.cos(ry) * side * 1.6, az = z - Math.sin(ry) * side * 1.6;
        arms.push({ m: mat4(ax, ay, az, { s: [0.6, 0.9, 0.6], ry }), c });
        arms.push({ m: mat4(ax, ay + 1.3, az, { s: [0.55, 0.8, 0.55], ry }), c });
      }
      flowers.push({ m: mat4(x, y + h + 1.7, z, { s: 0.55 }), c: pick([0xff5fa2, 0xffb13d, 0xb57bff]) });
    }
    instanced(ctx, bodyGeo, toon(0xffffff, { emissive: 0x553344, emissiveIntensity: 0.25 }), bodies, { outline: 0.06 });
    instanced(ctx, bodyGeo, toon(0xffffff, { emissive: 0x553344, emissiveIntensity: 0.25 }), arms, { outline: 0.1 });
    instanced(ctx, new THREE.IcosahedronGeometry(1, 0), toon(0xffffff), flowers);
  }

  function buildBoulders() {
    const spots = scatter(120, (x, z) => {
      const d = distToRoad(x, z, 60);
      return d > hw + FENCE_OFFSET + 1.5 && d < hw + 55 && !nearRiver(x, z, 10);
    }, { pad: 60 });
    instanced(ctx, new THREE.DodecahedronGeometry(1, 0), toon(0xffffff), spots.map(([x, z]) => {
      const s = 0.6 + rng() * 1.6;
      return { m: mat4(x, groundH(x, z) + s * 0.3, z, { s: [s * 1.2, s * 0.8, s], ry: rng() * 3, rx: rng() * 0.4 }), c: pick(ROCK_LAYERS.slice(0, 3)) };
    }), { outline: 0.06 });
    // choc-chip pebbles
    const chips = scatter(500, (x, z) => {
      const d = distToRoad(x, z, 50);
      return d > hw + FENCE_OFFSET + 1 && d < hw + 45;
    }, { pad: 50, tries: 8 });
    instanced(ctx, new THREE.ConeGeometry(0.35, 0.4, 6), toon(0x4a2616), chips.map(([x, z]) => ({ m: mat4(x, groundH(x, z) + 0.15, z) })));
  }

  /** Cotton-candy tumbleweeds rolling back and forth across the sand. */
  function buildTumbleweeds() {
    const weeds = [];
    for (const [x, z] of scatter(14, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 26) && !nearRiver(x, z, 20), { pad: 60 })) {
      const a = rng() * Math.PI * 2;
      weeds.push({ x, z, dx: Math.cos(a), dz: Math.sin(a), len: 10 + rng() * 10, s: 1.2 + rng() * 0.8, ph: rng() * 6, c: pick([0xffc2dd, 0xfff0d6, 0xd9c2ff]) });
    }
    animatedInstances(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff, { emissive: 0x663355, emissiveIntensity: 0.35 }), weeds, (w, t, o) => {
      const u = Math.sin(t * 0.35 + w.ph); // ping-pong along its lane
      const x = w.x + w.dx * u * w.len, z = w.z + w.dz * u * w.len;
      o.x = x; o.z = z; o.y = groundH(x, z) + w.s + Math.abs(Math.sin(t * 2.2 + w.ph)) * 0.5;
      o.ry = Math.atan2(w.dx, w.dz); o.rx = u * w.len / w.s;
      o.sx = o.sy = o.sz = w.s;
    }, { outline: 0.08 });
  }
}

/** Road details: a glossy chocolate stripe down the middle of the caramel road. */
export function buildRoadDetails(ctx) {
  const { group, own, loopFrames, hw } = ctx;
  const stripe = new THREE.Mesh(ribbon(loopFrames, -0.5, 0.5, 0.038), own(toon(0x8a5536, { unique: true, emissive: 0x2a1208, emissiveIntensity: 0.25 })));
  group.add(stripe);
  // little white-chocolate studs just inside each kerb
  const studs = [];
  for (let s = 0; s < ctx.path.length; s += 6) {
    for (const side of [-1, 1]) {
      const p = ctx.path.positionAt(s, side * (hw - 0.6));
      studs.push({ m: mat4(p.x, p.y + 0.06, p.z, { s: [0.55, 0.12, 0.55] }) });
    }
  }
  instanced(ctx, new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), glow(0xfff0d6), studs);
}

export default { def, buildScenery, prepare, buildRoadDetails };
