/**
 * Bubblegum Bay — track module (data + scenery). Cup: bubble-cup (race 1).
 * OWNER: Tracks — Bubble Cup.
 *
 * A sunny pink-sea beach. The lap runs east along the seafront promenade,
 * swoops round a long shoreline sweeper, wiggles through the dunes onto a
 * sandbar peninsula, U-turns round a giant sandcastle (hairpin), then
 * rattles back west over a humped boardwalk pier that crosses the channel
 * into the bubbly inner lagoon. Out at sea a gumball-machine lighthouse
 * blinks, giant gum bubbles float and wobble, and beach balls bounce.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, SHOULDER_OUT, mat4, extruded, starShape, ribbon, frames, smoothstep } from './sceneryKit.js';
import {
  instanced, animatedInstances, patternTexture, waterGrid, turnCentre, stripedSphere,
} from './props/bubble-kit.js';

const HAIRPIN_R = 40;
/** The inner lagoon sits this far "inland" (south, +z) of the pier's middle. */
const LAGOON_OFFSET = 90;
const LAGOON_R = 44;
/** The sea starts this far north (-z) of the pier line. */
const SEA_OFFSET = 44;

const LAYOUT = {
  start: [0, 0], heading: 90, startAt: 54,
  ops: [
    { s: 160, mark: 'promenade' },
    { turn: 90, r: 100, mark: 'shore-sweep' },
    { s: 100, mark: 'surf-straight' },
    { turn: -35, r: 60, mark: 'dune-s1' },
    { turn: 35, r: 60, mark: 'dune-s2' },
    { turn: 180, r: HAIRPIN_R, mark: 'castle-hairpin' },
    { s: 40, mark: 'castle-run' },
    { turn: -90, r: 45, mark: 'boardwalk-turn' },
    { s: 120, hump: 3.2, flex: true, mark: 'pier' },
    { turn: 90, r: 60, mark: 'palm-turn' },
    { s: 80, flex: true, mark: 'palm-run' },
    { turn: 90, r: 60, mark: 'last' },
  ],
};

export const def = makeTrack(
  {
    id: 'bubblegum-bay',
    name: 'Bubblegum Bay',
    subtitle: 'Pop! goes the beach',
    laps: 3,
    width: 20,
    previewColor: 0xff9ecf,
    art: ['🫧', '🏖️', '🍬'], // menu card emoji: big, bottom-left, top-right
    cup: 'bubble-cup',
    unlock: { type: 'stat', stat: 'racesFinished', count: 1 },
    theme: {
      skyTop: 0x3fb4ff,
      skyBottom: 0xffe3f3,
      fogColor: 0xffe2f0,
      fogNear: 180,
      fogFar: 700,
      ground: 0xffe6b8, // warm golden sand
      road: 0xff9fcf, // bubblegum pink
      roadAlt: 0xff8cc4,
      curbA: 0x3fd3e6, // sea-glass aqua
      curbB: 0xffffff,
      offRoad: 0xfff4dc,
      music: 'bubblegum-bay',
      sunColor: 0xfff1dc,
      ambientColor: 0xffe2f2,
      // builder theme extras (see ARCHITECTURE.md -> theme fields)
      roadSprinkles: { style: 'dots', count: 120, palette: [0xffffff, 0xffe3f2, 0xffffff, 0xc8f4ff] },
      skirt: { color: 0xfff4e4, trim: 0x5fdcec },
      pillar: { shape: 'round', color: 0xc98f5e, ring: 0xff8cc4 },
    },
  },
  LAYOUT,
  (frac, centroid) => {
    const pier = centroid('pier', 'pier');
    return {
      itemBoxRows: [frac('promenade', 'end') - 0.025, frac('surf-straight', 'mid'), frac('castle-run', 'mid'), frac('pier', 'mid'), frac('palm-run', 'mid')],
      boostPads: [
        { at: frac('shore-sweep', 'mid'), lateral: -4 },
        { at: frac('castle-hairpin', 'end') + 0.006, lateral: 3.5 },
        { at: frac('pier', 'start') + 0.012, lateral: -3 },
        { at: frac('last', 'mid'), lateral: 4 },
      ],
      scenery: {
        kind: 'bay',
        terrain: 'flat',
        center: centroid(),
        hairpin: { at: frac('castle-hairpin', 'mid'), r: HAIRPIN_R },
        pier: [frac('pier', 'start'), frac('pier', 'end')],
        pierMid: pier,
        lagoon: { center: [pier[0], pier[1] + LAGOON_OFFSET], r: LAGOON_R },
        seaZ: pier[1] - SEA_OFFSET,
        fence: { post: 0xffffff, postAlt: 0x3fd3e6, rail: 0xffb3d9, topper: 'ball', topperColor: 0xff6fb5 },
        arch: { a: 0xff6fb5, b: 0xffffff, banner: 0x2fc3dd, text: 'BUBBLEGUM BAY' },
      },
    };
  },
);

/** Signed "is this water?" distance for the sea, the channel and the inner lagoon (no road). */
export function bayWaterSDF(sc, x, z) {
  const shore = sc.seaZ + 9 * Math.sin(x * 0.021) + 5 * Math.sin(x * 0.057 + 1.3);
  const sea = shore - z;
  const [lx, lz] = sc.lagoon.center;
  const lagoon = sc.lagoon.r - Math.hypot(x - lx, z - lz);
  // the channel from the sea, under the pier, into the lagoon
  const [px] = sc.pierMid;
  const inChannel = z > shore - 10 && z < lz;
  const channel = inChannel ? 13 - Math.abs(x - px - Math.sin(z * 0.05) * 4) : -Infinity;
  return Math.max(sea, lagoon, channel);
}

export function buildScenery(ctx) {
  const { def, path, group, rng, own, outlineMat, toonVC, hw, L, center, extent, index, clearOfRoad, animators, scatter, sparkles, backgroundHills, tower, heartFlag } = ctx;
  const sc = def.scenery;
  const [pa, pb] = sc.pier;
  const onPier = (s) => {
    const f = s / L;
    return f > pa + 0.01 && f < pb - 0.01;
  };

  // ===== water: pink sea, channel and lagoon, with foam at the shore =====
  const clearance = hw + SHOULDER_OUT + 8;
  const wet = (x, z) => {
    const w = bayWaterSDF(sc, x, z);
    const n = index.nearest(x, z, clearance + 30);
    if (n.i < 0) return w;
    const road = n.dist - clearance;
    // under the raised pier the water keeps flowing
    if (onPier(n.s) && n.y > 0.6) return w;
    return Math.min(w, road);
  };
  const b = ctx.bounds;
  waterGrid(ctx, {
    area: { minX: b.minX - 520, maxX: b.maxX + 520, minZ: b.minZ - 640, maxZ: b.maxZ + 40 },
    cell: 7, y: 0.14, wet,
    color: 0xff8cc8, deep: 0xf2559f, foam: 0xfff6fb, foamWidth: 5, deepAt: 110,
    emissive: 0xff5fa8, emissiveIntensity: 0.1, ripples: 0.2, rippleTile: 26,
  });
  const isDry = (x, z, m = 4) => wet(x, z) < -m;
  const isSea = (x, z, m = 6) => bayWaterSDF(sc, x, z) > m && clearOfRoad(x, z, FENCE_OFFSET + 12);

  // ===== boardwalk planks + posts on the pier =====
  buildPier();

  // ===== hero 1: the giant sandcastle inside the hairpin =====
  const hp = turnCentre(ctx, sc.hairpin.at, sc.hairpin.r, 1);
  buildSandcastle(hp.x, hp.z);

  // ===== hero 2: the gumball-machine lighthouse out at sea =====
  const lh = findSpot(hp.x + 30, hp.z - 120, (x, z) => isSea(x, z, 18));
  buildLighthouse(lh.x, lh.z);

  // ===== palms, umbrellas, surfboards, beach balls, shells =====
  buildPalms();
  buildUmbrellas();
  buildSurfboards();
  buildBeachBalls();
  buildShellsAndStars();

  // ===== floating gum bubbles, boats, buoys, gulls =====
  buildGumBubbles();
  buildBoatsAndBuoys();
  buildGulls();

  backgroundHills(16, extent + 320, extent + 480, [0xffdcaa, 0x9fe0b4, 0xffc9d9, 0xbfe9a8], { hMin: 12, hMax: 30, widthMul: 3.2 });
  sparkles(240, center.x, center.z - 60, extent + 80, 1, 14, [0xffffff, 0xffe3f4, 0xd9fbff], 1.4);

  // ---------------------------------------------------------------------
  function findSpot(x0, z0, ok) {
    if (ok(x0, z0)) return { x: x0, z: z0 };
    for (let r = 10; r < 300; r += 10) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
        if (ok(x, z)) return { x, z };
      }
    }
    return { x: x0, z: z0 };
  }

  function buildPier() {
    const s0 = pa * L + 4, s1 = pb * L - 4;
    const fr = frames(path, s0, s1, 1.5);
    // plank deck: warm driftwood stripes across the road
    const plankTex = patternTexture(ctx, 64, (u, v) => {
      const plank = Math.floor(v * 4);
      const gap = (v * 4) % 1 < 0.08;
      const base = [[236, 196, 150], [226, 182, 138], [242, 206, 164], [230, 190, 146]][plank];
      const grain = Math.sin(u * 40 + plank * 3) * 5;
      return gap ? [170, 118, 92] : [base[0] + grain, base[1] + grain, base[2] + grain];
    });
    const deckGeo = ribbon(fr, -hw, hw, 0.045, { uv: { across: 6, along: 6 } });
    const deckMat = ctx.toonTex(plankTex);
    const deck = new THREE.Mesh(deckGeo, deckMat);
    group.add(deck);
    // posts standing in the water along both sides + a rope rail
    const posts = [];
    for (let s = s0; s <= s1; s += 8) {
      const f = frames(path, s, s + 0.01, 1)[0];
      for (const side of [-1, 1]) {
        const lat = side * (hw + SHOULDER_OUT + 0.9);
        const h = f.y + 2.2;
        posts.push(mat4(f.x + f.rx * lat, h / 2 - 0.6, f.z + f.rz * lat, { s: [1, h + 1.2, 1] }));
      }
    }
    instanced(ctx, new THREE.CylinderGeometry(0.45, 0.55, 1, 8), toon(0xc98f5e), posts, { ow: 0.08 });
    const caps = posts.map((m) => {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      const sy = new THREE.Vector3().setFromMatrixColumn(m, 1).length();
      return mat4(p.x, p.y + sy / 2 + 0.2, p.z);
    });
    instanced(ctx, new THREE.SphereGeometry(0.6, 10, 8), toon(0xff6fb5), caps);
  }

  function buildSandcastle(x, z) {
    const SAND = 0xf6d49e, SAND2 = 0xeec07e, ROOF = 0xff8cc8, TRIM = 0xffffff;
    const bat = ctx.batch;
    // stepped base (like a bucket-shaped mound)
    bat.add(new THREE.CylinderGeometry(15, 17, 3, 24), toon(SAND2), mat4(x, 1.5, z));
    bat.add(new THREE.CylinderGeometry(11.5, 12.5, 5, 24), toon(SAND), mat4(x, 5.5, z));
    // crenellations on the base ring
    const cren = new THREE.BoxGeometry(2, 1.6, 2);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      bat.add(cren, toon(SAND), mat4(x + Math.cos(a) * 11.4, 8.6, z + Math.sin(a) * 11.4, { ry: -a }));
    }
    // four towers + the tall keep
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      tower(x + Math.cos(a) * 11, 3, z + Math.sin(a) * 11, 3, 9 + (k % 2) * 3, { wall: SAND, roof: ROOF, trim: TRIM, roofH: 5 });
    }
    tower(x, 8, z, 5, 12, { wall: SAND, roof: ROOF, trim: TRIM, roofH: 8 });
    // a big friendly shell door + seashell decorations
    const shell = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      bat.add(shell, toon([0xffc2e0, 0xffffff, 0xbff2ff][k % 3]), mat4(x + Math.cos(a) * 12.2, 5.5, z + Math.sin(a) * 12.2, { ry: -a + Math.PI / 2, rx: Math.PI / 2, s: [1.3, 0.5, 1.3] }));
    }
    // sand buckets and spades nearby
    const bucket = new THREE.CylinderGeometry(1.6, 1.2, 2.4, 14);
    [[0xff5f8f, 1], [0x3fd3e6, 2.4], [0xffd23f, 4]].forEach(([c, ang]) => {
      bat.add(bucket, toon(c), mat4(x + Math.cos(ang) * 16, 1.2, z + Math.sin(ang) * 16));
    });
    heartFlag(x, 28, z, 0xff4f9a);
  }

  function buildLighthouse(x, z) {
    const bat = ctx.batch;
    const S = 1.5; // everything below is authored at 1/1.5 scale
    // little rocky island
    bat.add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xffd7b0), mat4(x, -0.5, z, { s: [16 * S, 4 * S, 14 * S] }));
    // machine base: red + gold coin slot
    bat.add(new THREE.CylinderGeometry(6 * S, 7.5 * S, 12 * S, 20), toon(0xff4f7a), mat4(x, 8 * S, z));
    bat.add(new THREE.CylinderGeometry(7.6 * S, 7.6 * S, 1.2 * S, 20), toon(0xffffff), mat4(x, 14.2 * S, z));
    bat.add(new THREE.BoxGeometry(3 * S, 2.4 * S, 0.6 * S), toon(0xffd23f), mat4(x, 8 * S, z + 7 * S), false);
    // the glass globe full of gumballs
    const R = 9 * S;
    const gy = 14.8 * S + R * 0.9;
    const balls = [];
    for (let i = 0; i < 70; i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.cbrt(rng()) * (R - 1.6 * S);
      const yy = Math.max(-R * 0.8, u * r);
      const rr = Math.sqrt(Math.max(0, r * r - yy * yy));
      balls.push(mat4(x + Math.cos(a) * rr, gy + (yy < 0 ? yy : yy * 0.35 - 2 * S), z + Math.sin(a) * rr, { s: 1.35 * S }));
    }
    instanced(ctx, new THREE.SphereGeometry(1, 10, 8), toon(0xffffff), balls, {
      colors: [0xff5f8f, 0x3fd3e6, 0xffd23f, 0x8be08b, 0xb57bff, 0xff9f40, 0xffffff], outline: false,
    });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 18), own(new THREE.MeshToonMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.32, depthWrite: false, gradientMap: toon(0xffffff).gradientMap })));
    globe.position.set(x, gy, z);
    globe.renderOrder = 2;
    group.add(globe);
    // shine highlight
    const shine = new THREE.Mesh(new THREE.SphereGeometry(1.4 * S, 10, 8), glow(0xffffff));
    shine.position.set(x - R * 0.45, gy + R * 0.5, z + R * 0.55);
    shine.scale.set(1, 1.8, 0.6);
    group.add(shine);
    // cap + lamp room
    bat.add(new THREE.CylinderGeometry(3.4 * S, 4.6 * S, 2.4 * S, 18), toon(0xff4f7a), mat4(x, gy + R + 0.6 * S, z));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.2 * S, 16, 12), own(new THREE.MeshBasicMaterial({ color: 0xfff27a })));
    lamp.position.set(x, gy + R + 3.4 * S, z);
    group.add(lamp);
    bat.add(new THREE.ConeGeometry(3.2 * S, 3 * S, 18), toon(0xff4f7a), mat4(x, gy + R + 6.2 * S, z));
    // sweeping friendly light beams
    const beamGeo = new THREE.ConeGeometry(7, 42, 16, 1, true);
    beamGeo.translate(0, -21, 0);
    beamGeo.rotateZ(Math.PI / 2);
    const beamMat = own(new THREE.MeshBasicMaterial({ color: 0xfff6a8, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const beams = new THREE.Group();
    beams.position.copy(lamp.position);
    for (const flip of [0, Math.PI]) {
      const m = new THREE.Mesh(beamGeo, beamMat);
      m.rotation.y = flip;
      beams.add(m);
    }
    group.add(beams);
    animators.push((dt, t) => {
      beams.rotation.y = t * 0.8;
      lamp.material.color.setHSL(0.15, 1, 0.68 + Math.sin(t * 4) * 0.08);
    });
  }

  function buildPalms() {
    const spots = scatter(34, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 7) && isDry(x, z, 5), { pad: 90 });
    if (!spots.length) return;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, 3, 0), new THREE.Vector3(1.8, 6, 0), new THREE.Vector3(3.4, 8.6, 0),
    ]);
    const trunk = new THREE.TubeGeometry(curve, 10, 0.55, 7, false);
    const top = new THREE.Vector3(3.4, 8.6, 0);
    const leaves = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const leaf = new THREE.SphereGeometry(1, 8, 4);
      leaf.scale(3.2, 0.25, 0.9);
      leaf.translate(3, 0, 0);
      leaf.rotateZ(-0.35);
      leaf.rotateY(a);
      leaf.translate(top.x, top.y, top.z);
      leaves.push(leaf);
    }
    const crown = mergeGeometries(leaves);
    const nuts = mergeGeometries([0, 1, 2].map((k) => {
      const g = new THREE.SphereGeometry(0.55, 8, 6);
      g.translate(top.x + Math.cos(k * 2.1) * 0.7, top.y - 0.6, top.z + Math.sin(k * 2.1) * 0.7);
      return g;
    }));
    const mats = spots.map(([x, z]) => mat4(x, 0, z, { ry: rng() * Math.PI * 2, s: 0.9 + rng() * 0.5 }));
    instanced(ctx, trunk, toon(0xd9a066), mats, { ow: 0.07 });
    instanced(ctx, crown, toon(0xffffff), mats, { colors: [0x6fe0a8, 0x8fe88a, 0xff9fcf, 0x5fd6b8], ow: 0.08 });
    instanced(ctx, nuts, toon(0xff5f8f), mats, { outline: false });
  }

  function buildUmbrellas() {
    const spots = scatter(26, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5) && isDry(x, z, 3) && ctx.distToRoad(x, z, 80) < hw + 60, { pad: 60 });
    if (!spots.length) return;
    // canopy split into alternating segments: coloured (per instance) + white
    const cone = new THREE.ConeGeometry(3.6, 1.6, 12, 1, true).toNonIndexed();
    cone.translate(0, 4.6, 0);
    const src = cone.attributes.position;
    const halves = [[], []];
    for (let i = 0; i < src.count; i += 3) {
      let ax = 0, az = 0;
      for (let k = 0; k < 3; k++) { ax += src.getX(i + k); az += src.getZ(i + k); }
      const seg = Math.floor(((Math.atan2(az, ax) / (Math.PI * 2) + 1) % 1) * 12);
      for (let k = 0; k < 3; k++) halves[seg % 2].push(src.getX(i + k), src.getY(i + k), src.getZ(i + k));
    }
    const [striped, white] = halves.map((arr) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      return g;
    });
    const pole = new THREE.CylinderGeometry(0.12, 0.12, 4.6, 6);
    pole.translate(0, 2.3, 0);
    const mats = spots.map(([x, z]) => mat4(x, 0, z, { rz: (rng() - 0.5) * 0.25, ry: rng() * 6 }));
    instanced(ctx, pole, toon(0xffffff), mats, { outline: false });
    instanced(ctx, striped, toon(0xffffff, { side: THREE.DoubleSide }), mats, { colors: [0xff6fb5, 0x3fd3e6, 0xffd23f, 0xb57bff, 0xff9f40], outline: false });
    instanced(ctx, white, toon(0xffffff, { side: THREE.DoubleSide }), mats, { outline: false });
    // towels under some umbrellas
    const towels = mats.filter((_, i) => i % 2 === 0).map((m) => {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      return mat4(p.x + 2.4, 0.04, p.z + 1, { ry: rng() * 3 });
    });
    instanced(ctx, new THREE.BoxGeometry(2.2, 0.08, 4), toon(0xffffff), towels, { colors: [0x9fe6ff, 0xffc2e0, 0xfff1a8], outline: false });
  }

  function buildSurfboards() {
    const groups = scatter(10, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5) && isDry(x, z, 2), { pad: 70 });
    const mats = [];
    for (const [gx, gz] of groups) {
      const n = 2 + Math.floor(rng() * 3);
      const ry = rng() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const x = gx + Math.cos(ry) * (k - n / 2) * 1.6, z = gz + Math.sin(ry) * (k - n / 2) * 1.6;
        mats.push(mat4(x, 2.2, z, { ry: ry + Math.PI / 2, rz: (rng() - 0.5) * 0.3, s: [0.9, 3.4, 0.22] }));
      }
    }
    instanced(ctx, new THREE.SphereGeometry(1, 12, 10), toon(0xffffff), mats, { colors: [0xff6fb5, 0x3fd3e6, 0xffd23f, 0x8be08b, 0xb57bff, 0xffffff], ow: 0.12 });
  }

  function buildBeachBalls() {
    const spots = scatter(18, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 4) && isDry(x, z, 2), { pad: 50 });
    const items = spots.map(([x, z]) => ({ x, z, r: 1 + rng() * 0.8, ph: rng() * 6, hop: rng() < 0.5 ? 1.5 + rng() * 2 : 0 }));
    const geo = stripedSphere(1, [0xff5f8f, 0xffffff, 0x3fd3e6, 0xffffff, 0xffd23f, 0xffffff], 12);
    animatedInstances(ctx, geo, toonVC(), items, (it, t, o) => {
      const bounce = it.hop ? Math.abs(Math.sin(t * 2.2 + it.ph)) * it.hop : 0;
      o.position.set(it.x, it.r + bounce, it.z);
      o.rotation.set(it.ph, t * 0.6 + it.ph, 0);
      o.scale.setScalar(it.r);
    });
  }

  function buildShellsAndStars() {
    const spots = scatter(90, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 1.5) && isDry(x, z, 1) && ctx.distToRoad(x, z, 60) < hw + 40, { pad: 40 });
    const stars = [], shells = [];
    spots.forEach(([x, z], i) => {
      const m = mat4(x, 0.12, z, { ry: rng() * 6, s: 0.6 + rng() * 0.6 });
      (i % 2 ? stars : shells).push(m);
    });
    const starGeo = extruded(starShape(5, 1, 0.45), 0.25, 0.08, 1);
    starGeo.rotateX(-Math.PI / 2);
    instanced(ctx, starGeo, toon(0xffffff), stars, { colors: [0xff8a5c, 0xff6fb5, 0xffd23f], outline: false });
    const shellGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    shellGeo.scale(1, 0.5, 1.3);
    instanced(ctx, shellGeo, toon(0xffffff), shells, { colors: [0xffe0ef, 0xffffff, 0xd9f6ff, 0xffe8c8], outline: false });
  }

  function buildGumBubbles() {
    // floating over the sea, the lagoon and the channel; a few giants out at sea
    const spots = [];
    const [lx, lz] = sc.lagoon.center;
    for (let i = 0; i < 12; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (sc.lagoon.r - 8);
      spots.push({ x: lx + Math.cos(a) * r, z: lz + Math.sin(a) * r, r: 1.6 + rng() * 3, y: 1 + rng() * 5 });
    }
    for (const [x, z] of scatter(26, (x, z) => isSea(x, z, 10), { pad: 320 })) {
      spots.push({ x, z, r: 2.5 + rng() * 5, y: 2 + rng() * 14 });
    }
    // bubbles drifting over the beach, right beside the road
    for (const [x, z] of scatter(34, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 6) && ctx.distToRoad(x, z, 80) < hw + 45, { pad: 40 })) {
      spots.push({ x, z, r: 1.4 + rng() * 2.6, y: 6 + rng() * 12 });
    }
    for (const [x, z] of scatter(4, (x, z) => isSea(x, z, 60), { pad: 420 })) {
      spots.push({ x, z, r: 11 + rng() * 6, y: 10 + rng() * 12 });
    }
    const items = spots.map((s) => ({ ...s, ph: rng() * 6, sp: 0.5 + rng() * 0.6 }));
    const geo = new THREE.SphereGeometry(1, 20, 14);
    const mat = own(new THREE.MeshToonMaterial({
      color: 0xff8cc8, emissive: 0xff5fa8, emissiveIntensity: 0.25, transparent: true, opacity: 0.6,
      depthWrite: false, gradientMap: toon(0xffffff).gradientMap,
    }));
    const pose = (it, t, o) => {
      const wob = Math.sin(t * 1.7 * it.sp + it.ph);
      o.position.set(it.x + Math.sin(t * 0.3 + it.ph) * 1.5, it.y + it.r + Math.sin(t * it.sp + it.ph) * 1.2, it.z);
      // gum bubbles gently inflate and wobble
      const inflate = 1 + Math.sin(t * 0.9 * it.sp + it.ph * 2) * 0.08;
      o.scale.set(it.r * inflate * (1 + wob * 0.04), it.r * inflate * (1 - wob * 0.04), it.r * inflate);
    };
    const bubbles = animatedInstances(ctx, geo, mat, items, pose);
    if (bubbles) bubbles.mesh.renderOrder = 3;
    // bright shine spots on each bubble
    const shine = animatedInstances(ctx, new THREE.SphereGeometry(1, 8, 6), glow(0xffffff), items, (it, t, o) => {
      pose(it, t, o);
      const r = o.scale.x;
      o.position.x -= r * 0.4; o.position.y += r * 0.45; o.position.z += r * 0.4;
      o.scale.set(r * 0.16, r * 0.24, r * 0.1);
    });
    if (shine) shine.mesh.renderOrder = 4;
  }

  function buildBoatsAndBuoys() {
    const boatSpots = scatter(8, (x, z) => isSea(x, z, 40), { pad: 380 });
    const boats = boatSpots.map(([x, z]) => ({ x, z, ph: rng() * 6, ry: rng() * 6, s: 1.4 + rng() * 0.8 }));
    const hull = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    hull.scale(1.6, 1, 4);
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.5, -2.6, 0, 7, 0.2, 0, 0.5, 2.4], 3));
    sail.computeVertexNormals();
    const bob = (it, t, o) => {
      o.position.set(it.x, 0.35 + Math.sin(t * 1.2 + it.ph) * 0.3, it.z);
      o.rotation.set(Math.sin(t * 1.1 + it.ph) * 0.08, it.ry, Math.sin(t * 0.9 + it.ph) * 0.1);
      o.scale.setScalar(it.s);
    };
    animatedInstances(ctx, hull, toon(0xffffff), boats, bob, { colors: [0xff5f8f, 0x3fd3e6, 0xffd23f], outline: true });
    animatedInstances(ctx, sail, toon(0xffffff, { side: THREE.DoubleSide }), boats, bob, { colors: [0xffffff, 0xffe3f2, 0xfff6c2] });
    const buoySpots = scatter(18, (x, z) => isSea(x, z, 8) && bayWaterSDF(sc, x, z) < 60, { pad: 200 });
    const buoys = buoySpots.map(([x, z]) => ({ x, z, ph: rng() * 6 }));
    animatedInstances(ctx, stripedSphere(1.2, [0xff5f8f, 0xffffff], 10), toonVC(), buoys, (it, t, o) => {
      o.position.set(it.x, 0.5 + Math.sin(t * 1.6 + it.ph) * 0.35, it.z);
      o.rotation.set(Math.sin(t + it.ph) * 0.2, 0, Math.cos(t * 1.3 + it.ph) * 0.2);
    }, { outline: true });
  }

  function buildGulls() {
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.4, -2.2, 0.5, -0.2, 0, 0, -0.5,
      0, 0, 0.4, 0, 0, -0.5, 2.2, 0.5, -0.2,
    ], 3));
    wing.computeVertexNormals();
    const items = [];
    for (let i = 0; i < 9; i++) {
      items.push({ cx: sc.pierMid[0] + (rng() - 0.5) * 300, cz: sc.seaZ - 60 - rng() * 160, r: 18 + rng() * 26, y: 24 + rng() * 18, sp: 0.25 + rng() * 0.2, ph: rng() * 6 });
    }
    animatedInstances(ctx, wing, toon(0xffffff, { side: THREE.DoubleSide }), items, (it, t, o) => {
      const a = t * it.sp + it.ph;
      o.position.set(it.cx + Math.cos(a) * it.r, it.y + Math.sin(t * 2 + it.ph) * 0.6, it.cz + Math.sin(a) * it.r);
      o.rotation.set(0, -a, Math.sin(t * 6 + it.ph) * 0.1);
      o.scale.set(1, 1 + Math.sin(t * 7 + it.ph) * 0.6, 1);
    });
  }
}

export default { def, buildScenery };
