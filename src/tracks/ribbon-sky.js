/**
 * Ribbon Sky Rally — track module (data + scenery). Cup: superstar-cup.
 * OWNER: track builder (Superstar Cup).
 *
 * The grand finale: a rainbow ribbon road floating high above a sea of
 * clouds. Twice a lap the ribbon twirls round in a big loop and crosses over
 * (then under!) itself — the first twirl climbs up into the sky, the second
 * swirls back down — past giant floating bows, drifting hot-air balloons,
 * rainbow gates, streamers and sparkle bursts, round the Superstar Trophy
 * island in the middle.
 */
import * as THREE from 'three';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, ribbon, mat4, Batch, extruded, starShape, heartShape, sparkleTexture } from './sceneryKit.js';
import { instanced, mergeAll, roadFrameAt, sideSpot, hotAirBalloons, findSpot } from './props/superstar-kit.js';

export const def = makeTrack(
  {
    id: 'ribbon-sky',
    name: 'Ribbon Sky Rally',
    subtitle: 'The grand finale on a rainbow ribbon above the clouds',
    laps: 3,
    width: 18,
    previewColor: 0xffa6dc,
    art: ['🎀', '🎈', '🌈'], // menu card emoji: big, bottom-left, top-right
    cup: 'superstar-cup',
    unlock: { type: 'distinct-tracks', result: 'win', count: 6 },
    theme: {
      skyTop: 0x58aaff,
      skyBottom: 0xffe2f3,
      fogColor: 0xffe8f5,
      fogNear: 230,
      fogFar: 900,
      ground: 0xffffff,
      road: 0xfff4fa,
      roadAlt: 0xffeaf5,
      curbA: 0xffffff,
      curbB: 0xffd84d, // gold trim
      offRoad: 0xfff0f8,
      music: 'ribbon-sky',
      sunColor: 0xfff4e6,
      ambientColor: 0xffe0f0,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      roadSprinkles: { style: 'stars', count: 60, palette: [0xffffff, 0xfff27a] },
      skirt: { color: 0xffffff, trim: 0xffb3d9, rainbow: true },
      underside: 0xffc6e8,
      undersideGlow: 0x7a3a70,
      undersideEdge: 0xfff27a,
      startLineDark: 0x6a3a8a,
    },
  },
  {
    start: [0, 0],
    heading: 90,
    y0: 1,
    startAt: 54,
    ops: [
      { s: 130, y: 1, mark: 'grand-straight' },
      { s: 20, y: 1, mark: 'lead-in-a' },
      { turn: 270, r: 38, y: 11, mark: 'twirl-a' },
      { s: 80, y: 12, mark: 'over-a' },
      { turn: 90, r: 50, y: 12, mark: 'cloud-bend' },
      { s: 30, y: 12, mark: 'balloon-run' },
      { turn: 90, r: 55, y: 13, mark: 'sky-sweep' },
      { s: 120, y: 13, flex: true, mark: 'high-road' },
      { s: 20, y: 13, mark: 'lead-in-b' },
      { turn: -270, r: 38, y: 3, mark: 'twirl-b' },
      { s: 60, y: 2, flex: true, mark: 'under-b' },
      { turn: -25, r: 110, y: 2, mark: 'wave-1' },
      { turn: 50, r: 110, y: 2, mark: 'wave-2' },
      { turn: -25, r: 110, y: 1.5, mark: 'wave-3' },
      { turn: 90, r: 50, y: 1, mark: 'rainbow-bend' },
      { s: 30, y: 1, mark: 'rainbow-run' },
      { turn: 90, r: 50, y: 1, mark: 'last' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('twirl-a', 'mid'), frac('cloud-bend', 'end'), frac('high-road', 'mid'), frac('twirl-b', 'mid'), frac('wave-2', 'mid')],
    boostPads: [
      { at: frac('over-a', 'mid'), lateral: 0 },
      { at: frac('sky-sweep', 'end'), lateral: 3 },
      { at: frac('under-b', 'mid'), lateral: -3 },
      { at: frac('rainbow-run', 'mid'), lateral: 0 },
    ],
    scenery: {
      kind: 'ribbon',
      center: centroid(),
      terrain: 'void',
      spots: {
        twirls: [
          { at: frac('twirl-a', 'mid'), side: -1 }, // left twirl: its centre is on the left
          { at: frac('twirl-b', 'mid'), side: 1 },
        ],
        gates: [frac('lead-in-a', 'mid'), frac('lead-in-b', 'mid'), frac('balloon-run', 'mid'), frac('wave-2', 'start')],
        crossings: [frac('over-a', 'mid'), frac('under-b', 'start')],
      },
      fence: { post: 0xffffff, postAlt: 0xffa6dc, rail: 0xffffff, topper: 'heart', topperColor: 0xff5fa8 },
      arch: { a: 0xff8fab, b: 0xffffff, banner: 0xff5fa8, text: 'GRAND FINALE' },
    },
  }),
);

const RAINBOW = [0xff8fab, 0xffb86b, 0xffe27a, 0x9be89b, 0x86c8ff, 0xa99bff, 0xe39bff];
const CLOUDS = [0xffffff, 0xffe6f4, 0xefe6ff, 0xfff1e0, 0xe6f4ff];

/** The rainbow ribbon itself: seven pastel lanes across the road, with glittery seams. */
export function buildRoadDetails(ctx) {
  const { group, toonVC, own, hw, loopFrames, animate } = ctx;
  const w = (hw * 2) / RAINBOW.length;
  const geos = RAINBOW.map((c, k) => {
    const col = new THREE.Color(c);
    return ribbon(loopFrames, -hw + k * w, -hw + (k + 1) * w, 0.03, { color: () => col });
  });
  const lanesGeo = mergeAll(geos, { color: true });
  const lanesMat = toonVC({ emissive: 0x442244, emissiveIntensity: 0.25 });
  // The lanes ARE the road surface: swap them in for the plain road ribbon (same
  // height) instead of layering on top, so the twisting twirls never flicker.
  const road = group.getObjectByName('road');
  if (road) {
    road.geometry.dispose();
    road.geometry = lanesGeo;
    road.material = lanesMat;
  } else {
    const lanes = new THREE.Mesh(lanesGeo, lanesMat);
    lanes.name = 'road';
    group.add(lanes);
  }
  const seams = [];
  for (let k = 1; k < RAINBOW.length; k++) seams.push(ribbon(loopFrames, -hw + k * w - 0.07, -hw + k * w + 0.07, 0.04));
  const seamMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
  const seamMesh = new THREE.Mesh(mergeAll(seams), seamMat);
  seamMesh.renderOrder = 1;
  group.add(seamMesh);
  animate((dt, t) => { seamMat.opacity = 0.5 + Math.sin(t * 3) * 0.25; });
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, ownTex, outlineMat,
    hw, L, center, extent, clearOfRoad, distToRoad, animate,
    scatter, sparkles, floatingShapes, tower, heartFlag,
  } = ctx;
  const spots = def.scenery.spots;
  const edge = hw + FENCE_OFFSET;

  cloudSea();
  roadsideClouds();
  twirlBows();
  rainbowGates();
  trophyIsland();
  balloons();
  bigRainbow();
  streamers();
  sparkleBursts();
  floatingShapes(extruded(heartShape(), 0.3, 0.08, 5), scatter(30, (x, z) => clearOfRoad(x, z, 10), { pad: 60 }), [0xff7ac8, 0xffffff, 0xffd84d], { yMin: 16, yMax: 40, scale: [1.2, 2.2] });
  floatingShapes(extruded(starShape(5, 1, 0.45), 0.35, 0.08, 1), scatter(40, (x, z) => clearOfRoad(x, z, 10), { pad: 80 }), [0xfff27a, 0xffffff, 0x9ff7ff, 0xffb3e6], { yMin: -10, yMax: 45, scale: [1.2, 2.6], glowy: true });
  sparkles(620, center.x, center.z, extent + 160, -30, 80, [0xffffff, 0xfff7b0, 0xffd1ec, 0xd8f4ff], 2.2);

  // ---------------------------------------------------------------------
  /** A soft sea of pastel clouds far below the ribbon. */
  function cloudSea() {
    const items = [];
    for (let i = 0; i < 260; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (extent + 460);
      const s = 16 + rng() * 26;
      items.push({ m: mat4(center.x + Math.cos(a) * r, -52 - rng() * 22, center.z + Math.sin(a) * r, { s: [s * 1.6, s * 0.62, s * 1.6], ry: rng() * 3 }), c: CLOUDS[i % CLOUDS.length] });
    }
    const mesh = instanced(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff, { emissive: 0x7a5a8a, emissiveIntensity: 0.35 }), items, { outline: false });
    mesh.name = 'cloud-sea';
    const g = new THREE.Group();
    group.add(g);
    g.add(mesh);
    animate((dt, t) => { g.position.y = Math.sin(t * 0.25) * 1.5; g.rotation.y = Math.sin(t * 0.02) * 0.05; });
  }

  /** Fluffy cloud clusters hugging the ribbon, just below road level. */
  function roadsideClouds() {
    const items = [];
    for (let s = 10; s < L; s += 34) {
      const { p } = roadFrameAt(path, s);
      for (const side of [-1, 1]) {
        if (rng() < 0.35) continue;
        const n = 2 + Math.floor(rng() * 3);
        const lat0 = side * (edge + 5 + rng() * 10);
        for (let k = 0; k < n; k++) {
          const r = 3 + rng() * 4;
          const q = sideSpot(path, s + (k - n / 2) * 4, lat0 + (rng() - 0.5) * 5);
          if (!clearOfRoad(q.x, q.z, FENCE_OFFSET + r * 0.6)) continue;
          items.push({ m: mat4(q.x, p.y - 3.2 - r, q.z, { s: [r * 1.3, r * 0.75, r * 1.3] }), c: CLOUDS[(k + items.length) % CLOUDS.length] });
        }
      }
    }
    instanced(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff, { emissive: 0x7a5a8a, emissiveIntensity: 0.3 }), items, { ow: 0.04 });
  }

  /** A giant ribbon bow floating in the middle of each twirl. */
  function twirlBows() {
    const loopGeo = new THREE.TorusGeometry(3.4, 1.3, 10, 28);
    const bows = [];
    spots.twirls.forEach((tw, i) => {
      const s = tw.at * L;
      const c = sideSpot(path, s, tw.side * 38);
      const g = new THREE.Group();
      g.name = 'twirl-bow';
      g.position.set(c.x, c.y + 9, c.z);
      group.add(g);
      const col = i === 0 ? 0xff5fa8 : 0x8f7bff;
      const mat = toon(col, { emissive: col, emissiveIntensity: 0.25 });
      const b = new Batch();
      b.add(loopGeo, mat, mat4(-4.2, 0.6, 0, { s: [1.25, 0.8, 1], rz: 0.25 }));
      b.add(loopGeo, mat, mat4(4.2, 0.6, 0, { s: [1.25, 0.8, 1], rz: -0.25 }));
      b.add(new THREE.SphereGeometry(1.9, 16, 12), toon(0xffd84d), mat4(0, 0.4, 0, { s: [1, 1.1, 0.9] }));
      b.add(new THREE.BoxGeometry(2.2, 9, 0.6), mat, mat4(-2.2, -4.6, 0, { rz: -0.35 }));
      b.add(new THREE.BoxGeometry(2.2, 9, 0.6), mat, mat4(2.2, -4.6, 0, { rz: 0.35 }));
      b.build(g, outlineMat);
      g.scale.setScalar(1.5);
      bows.push({ g, y: c.y + 9, ph: i * 2 });
    });
    animate((dt, t) => {
      for (const b of bows) {
        b.g.rotation.y = t * 0.4 + b.ph;
        b.g.position.y = b.y + Math.sin(t * 0.9 + b.ph) * 1.2;
      }
    });
  }

  /** Rainbow gates over the road at the twirl entries and the big sweeps. */
  function rainbowGates() {
    for (const f of spots.gates) {
      const { p, h } = roadFrameAt(path, f * L);
      RAINBOW.forEach((c, k) => {
        batch.add(new THREE.TorusGeometry(edge + 3.6 - k * 0.55, 0.3, 6, 40, Math.PI), toon(c, { emissive: c, emissiveIntensity: 0.3 }), mat4(p.x, p.y, p.z, { ry: h }), k === 0);
      });
      for (const side of [-1, 1]) {
        const q = sideSpot(path, f * L, side * (edge + 3.6));
        batch.add(new THREE.IcosahedronGeometry(2.4, 1), toon(0xffffff, { emissive: 0x7a5a8a, emissiveIntensity: 0.3 }), mat4(q.x, q.y - 0.4, q.z, { s: [1.4, 0.9, 1.4] }));
      }
    }
  }

  /** The Superstar Trophy on its own floating cloud island in the middle. */
  function trophyIsland() {
    const [x, z] = findSpot(ctx, def.scenery.center, 34);
    const y = -6;
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const items = [];
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2, r = 14 + rng() * 10;
      const s = 7 + rng() * 6;
      items.push({ m: mat4(x + Math.cos(a) * r, y - 2 - rng() * 3, z + Math.sin(a) * r, { s: [s * 1.3, s * 0.7, s * 1.3] }), c: CLOUDS[k % CLOUDS.length] });
    }
    items.push({ m: mat4(x, y - 3, z, { s: [22, 8, 22] }), c: 0xffffff });
    instanced(ctx, puff, toon(0xffffff, { emissive: 0x7a5a8a, emissiveIntensity: 0.3 }), items, { ow: 0.03 });
    // the golden cup (lathe profile)
    const prof = [[0, 0], [5.5, 0], [5.5, 1.2], [2.2, 2], [1.4, 5], [1.6, 7], [6.5, 11], [8.2, 17], [7.6, 17.2], [6.2, 12], [0, 11.5]].map(([a, b]) => new THREE.Vector2(a, b));
    const gold = toon(0xffd84d, { emissive: 0x7a5000, emissiveIntensity: 0.35 });
    batch.add(new THREE.LatheGeometry(prof, 32), gold, mat4(x, y + 2, z));
    for (const side of [-1, 1]) batch.add(new THREE.TorusGeometry(2.6, 0.55, 8, 20, Math.PI * 1.3), gold, mat4(x + side * 7.8, y + 15, z, { rz: side > 0 ? -1.2 : Math.PI + 1.2 - Math.PI * 0.3 }));
    batch.add(new THREE.CylinderGeometry(6, 6.6, 2, 24), toon(0xff5fa8), mat4(x, y + 1, z));
    // four candy towers round the rim
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      tower(x + Math.cos(a) * 16, y, z + Math.sin(a) * 16, 2.6, 12 + (k % 2) * 4, { wall: 0xfff6fb, roof: [0xff8fab, 0xa99bff, 0x86c8ff, 0xffb86b][k], trim: 0xffd84d, roofH: 6 });
    }
    heartFlag(x, y + 21, z, 0xff5fa8);
    // the superstar spinning above the cup
    const star = new THREE.Mesh(extruded(starShape(5, 1, 0.45), 0.4, 0.08), glow(0xfff27a));
    star.name = 'superstar';
    star.scale.setScalar(5);
    star.position.set(x, y + 30, z);
    group.add(star);
    animate((dt, t) => { star.rotation.y = t * 1.1; star.position.y = y + 30 + Math.sin(t * 1.4) * 1.2; });
  }

  /** Drifting striped hot-air balloons, some close to the ribbon, some far away. */
  function balloons() {
    const list = [];
    const pairs = [[0xff8fab, 0xffffff], [0x86c8ff, 0xffe27a], [0xffe27a, 0xff8fab], [0x9be89b, 0xffffff], [0xa99bff, 0xffd1ec], [0xffb86b, 0xfff4e0], [0xe39bff, 0x9ff7ff]];
    for (const [x, z] of scatter(18, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 16) && distToRoad(x, z, 200) < hw + 90, { pad: 60 })) {
      const s = 4.5 + rng() * 2.5;
      const [a, b] = pairs[list.length % pairs.length];
      list.push({ x, y: 18 + rng() * 22, z, s, a, b });
    }
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2 + rng() * 0.3;
      const r = extent + 120 + rng() * 200;
      const [a, b] = pairs[(k + 3) % pairs.length];
      list.push({ x: center.x + Math.cos(ang) * r, y: 20 + rng() * 70, z: center.z + Math.sin(ang) * r, s: 9 + rng() * 6, a, b });
    }
    hotAirBalloons(ctx, list, { bob: 2 });
  }

  /** A huge rainbow standing in the sky behind the track. */
  function bigRainbow() {
    const rb = new THREE.Group();
    rb.name = 'big-rainbow';
    RAINBOW.forEach((c, k) => {
      rb.add(new THREE.Mesh(new THREE.TorusGeometry(300 - k * 10, 5, 8, 72, Math.PI), own(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, fog: false, depthWrite: false }))));
    });
    rb.position.set(center.x + 60, -60, center.z + extent + 360);
    rb.rotation.y = Math.PI - 0.3;
    group.add(rb);
  }

  /** Long silky ribbon streamers waving in the sky. */
  function streamers() {
    const n = 9, seg = 40, len = 90;
    const list = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.4;
      const r = extent * 0.6 + rng() * (extent * 0.7 + 60);
      const geo = new THREE.PlaneGeometry(len, 2.6, seg, 1);
      const mesh = new THREE.Mesh(geo, own(toon(RAINBOW[i % RAINBOW.length], { unique: true, side: THREE.DoubleSide, emissive: RAINBOW[i % RAINBOW.length], emissiveIntensity: 0.35 })));
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      mesh.position.set(x, 38 + rng() * 30, z);
      mesh.rotation.y = rng() * Math.PI;
      mesh.frustumCulled = false;
      group.add(mesh);
      list.push({ mesh, base: Float32Array.from(geo.attributes.position.array), ph: rng() * 6 });
    }
    animate((dt, t) => {
      for (const s of list) {
        const pos = s.mesh.geometry.attributes.position;
        const b = s.base;
        for (let i = 0; i < pos.count; i++) {
          const x = b[i * 3];
          const k = (x / len + 0.5);
          pos.array[i * 3 + 1] = b[i * 3 + 1] + Math.sin(x * 0.12 + t * 1.6 + s.ph) * 4 * k;
          pos.array[i * 3 + 2] = Math.cos(x * 0.09 + t * 1.2 + s.ph) * 3 * k;
        }
        pos.needsUpdate = true;
      }
    });
  }

  /** Friendly glitter bursts popping in the sky, like sparkly confetti poppers. */
  function sparkleBursts() {
    const n = 6, per = 70;
    const tex = ownTex(sparkleTexture());
    const bursts = [];
    for (let i = 0; i < n; i++) {
      const dirs = new Float32Array(per * 3);
      for (let k = 0; k < per; k++) {
        const u = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
        dirs.set([Math.cos(a) * rr, u, Math.sin(a) * rr], k * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(per * 3), 3));
      const mat = own(new THREE.PointsMaterial({ size: 3.2, map: tex, color: RAINBOW[i % RAINBOW.length], transparent: true, depthWrite: false, fog: false }));
      const pts = new THREE.Points(g, mat);
      pts.frustumCulled = false;
      group.add(pts);
      bursts.push({ pts, g, mat, dirs, t: -rng() * 4, i });
    }
    const place = (b) => {
      const a = rng() * Math.PI * 2, r = extent * 0.5 + rng() * (extent + 120);
      b.pts.position.set(center.x + Math.cos(a) * r, 55 + rng() * 60, center.z + Math.sin(a) * r);
      b.mat.color.set(RAINBOW[Math.floor(rng() * RAINBOW.length)]);
    };
    bursts.forEach(place);
    animate((dt) => {
      for (const b of bursts) {
        b.t += dt;
        if (b.t < 0) { b.mat.opacity = 0; continue; }
        const k = b.t / 2.4;
        if (k >= 1) { b.t = -(1 + rng() * 3); place(b); continue; }
        const r = 26 * (1 - Math.pow(1 - k, 3));
        const arr = b.g.attributes.position.array;
        for (let q = 0; q < arr.length; q += 3) {
          arr[q] = b.dirs[q] * r;
          arr[q + 1] = b.dirs[q + 1] * r - k * k * 8;
          arr[q + 2] = b.dirs[q + 2] * r;
        }
        b.g.attributes.position.needsUpdate = true;
        b.mat.opacity = 1 - k * k;
      }
    });
  }
}

export default { def, buildScenery, buildRoadDetails };
