/**
 * Peppermint Village — track module (data + scenery). Cup: cozy-cup.
 * OWNER: Tracks — Cozy Cup.
 *
 * A snowy candy-cane village at twinkly twilight — the road itself is shaped
 * like a candy cane (look at the minimap!). Race up Main Street between
 * gingerbread houses under strings of twinkly lights, swing round the big
 * hook past the giant cocoa mug, loop the village tree in the crook of the
 * cane, then whoosh down the toboggan run past the skating pond.
 */
import * as THREE from 'three';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, mat4, pushedCopy, stripeTexture } from './sceneryKit.js';
import { instanced, faceRoad, bulbString, twinkleLights, drifting, roadStitches } from './props/cozy-kit.js';

export const def = makeTrack(
  {
    id: 'peppermint-village',
    name: 'Peppermint Village',
    subtitle: 'Twinkly lights, gingerbread houses and a candy-cane road',
    laps: 3,
    width: 18,
    previewColor: 0xff5a6a,
    art: ['🍬', '🏠', '❄️'], // menu card emoji: big, bottom-left, top-right
    cup: 'cozy-cup',
    unlock: { type: 'stat', stat: 'miniTurbos', count: 15 },
    theme: {
      skyTop: 0x3b4aa6, // twilight blue
      skyBottom: 0xffb9d2, // pink sunset glow
      fogColor: 0xecc9e8,
      fogNear: 160,
      fogFar: 620,
      ground: 0xf2f6ff, // fresh snow
      road: 0xc68552, // gingerbread cobbles
      roadAlt: 0xb3733f,
      curbA: 0xff3b4f,
      curbB: 0xffffff,
      offRoad: 0xe6eefc,
      music: 'peppermint-village',
      sunColor: 0xffd6e2,
      ambientColor: 0xc9ccff,
      // builder theme extras (see ARCHITECTURE.md -> theme fields)
      clouds: false,
      skyStars: true, // the first stars of the evening
      roadSprinkles: { style: 'dots', count: 190, palette: [0xffffff, 0xffffff, 0xff5a6a, 0x6fd08a, 0xfff1a8] },
      groundTints: [0xe2eaff, 0xffffff, 0xfbe9f5],
      groundTintMix: 0.6,
      skirt: { color: 0xffffff, trim: 0xff3b4f },
      pillar: { shape: 'round', color: 0xffffff, ring: 0xff3b4f },
    },
  },
  {
    start: [0, 0],
    heading: 0,
    startAt: 54,
    ops: [
      { s: 200, y: 4, flex: true, mark: 'main-street' },
      { turn: 90, r: 136, y: 9, mark: 'hook-top' },
      { turn: 90, r: 136, y: 11, mark: 'hook-top-2' },
      { s: 40, y: 10, mark: 'hook-leg' },
      { turn: 180, r: 42, y: 9, mark: 'hook-tip' },
      { s: 40, y: 8, mark: 'hook-inner-leg' },
      { turn: -180, r: 52, y: 7, mark: 'hook-inner' },
      { s: 40, y: 4, mark: 'toboggan-run' },
      { turn: -40, r: 160, y: 2, mark: 'toboggan-bend' },
      { turn: 110, r: 56, y: 1, mark: 'square-turn' },
      { s: 10, flex: true, y: 0.5, mark: 'square' },
      { turn: 110, r: 56, y: 0, mark: 'home-turn' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [
      (frac('main-street', 'start') + 0.05) % 1,
      frac('hook-top', 'end'),
      frac('hook-inner-leg', 'mid'),
      frac('toboggan-run', 'end'),
      frac('square', 'mid'),
    ],
    boostPads: [
      { at: frac('main-street', 'end') - 0.03, lateral: 0 },
      { at: frac('hook-leg', 'mid'), lateral: -1.5 },
      { at: frac('hook-inner', 'end') + 0.012, lateral: 1.5 },
      { at: frac('toboggan-bend', 'mid'), lateral: 0 },
    ],
    scenery: {
      kind: 'peppermint-village',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 5, scale: 0.012 },
      mainStreet: [frac('main-street', 'start'), frac('main-street', 'end')],
      villageTree: { at: frac('hook-inner', 'mid'), lateral: 52 },
      cocoa: { at: frac('hook-top', 'end'), lateral: 50 },
      toboggan: frac('toboggan-bend', 'mid'),
      fence: { post: 0xffffff, postAlt: 0xff3b4f, rail: 0xffffff, topper: 'cane', topperColor: 0xff3b4f },
      arch: { a: 0xff3b4f, b: 0xffffff, banner: 0x2f9e5a, text: 'PEPPERMINT' },
    },
  }),
);

const WARM = 0xffe08a;
const LIGHTS = [0xff4f6a, 0xfff06a, 0x6ff0a0, 0x7fc8ff, 0xff9ef0];

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md -> "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, ownTex, outlineMat, toonTex,
    hw, L, center, extent, groundH, distToRoad, clearOfRoad, animate,
    scatter, lollipops, sparkles, backgroundHills,
  } = ctx;
  const sc = def.scenery;
  const bulbs = [];
  const smoke = [];
  const snowParts = { body: [], coal: [], nose: [], scarf: [], hat: [] };

  buildGingerbreadStreet();
  buildVillageTree();
  buildCocoaMug();
  buildSnowmen();
  buildSkatingPond();
  buildPines();
  buildCandyCanes();
  twinkleLights(ctx, bulbs, LIGHTS, { size: 0.32 });
  buildChimneySmoke();
  buildWinterSky();

  // ----- gingerbread houses + twinkly garlands along Main Street ---------------------
  function buildGingerbreadStreet() {
    const [a, b] = sc.mainStreet;
    const sA = ((a > b ? a - 1 : a) * L) + 20, sB = b * L - 10;
    const bodyColors = [0xc98a4b, 0xd99a5b, 0xb97a3b];
    const roofColors = [0xffffff, 0xffd1e6, 0xc9f2e0];
    let k = 0;
    const houseAt = (x, z, face, i) => {
      const y = groundH(x, z) - 0.2;
      const w = 9 + (i % 3), h = 6.5 + (i % 2) * 1.5, d = 8;
      const c = Math.cos(face), sn = Math.sin(face);
      const at = (dx, dy, dz, o = {}) => mat4(x + dx * c + dz * sn, y + dy, z - dx * sn + dz * c, { ...o, ry: face + (o.ry || 0) });
      batch.add(new THREE.BoxGeometry(w, h, d), toon(bodyColors[i % 3]), at(0, h / 2, 0));
      // a steep icing roof: triangular prism, ridge along local x (parallel to the street), apex up
      batch.add(new THREE.CylinderGeometry(1, 1, 1, 3).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), toon(roofColors[i % 3]), at(0, h + 2.4, 0, { s: [w + 1.2, 4.8, d * 0.62] }));
      // icing drips along the eaves (front)
      for (let q = -Math.floor(w / 2); q <= Math.floor(w / 2); q++) {
        batch.add(new THREE.SphereGeometry(0.42, 6, 4), toon(0xffffff), at(q, h + 0.1, d / 2 + 0.2), false);
      }
      // door with a candy-cane frame and two warm windows
      batch.add(new THREE.BoxGeometry(2, 3.4, 0.3), toon(0x7a3f22), at(0, 1.7, d / 2 + 0.05), false);
      batch.add(new THREE.TorusGeometry(1.2, 0.18, 5, 12, Math.PI), toon(0xff3b4f), at(0, 3.4, d / 2 + 0.12), false);
      for (const dx of [-w * 0.3, w * 0.3]) {
        batch.add(new THREE.PlaneGeometry(1.8, 1.8), glow(WARM), at(dx, h * 0.55, d / 2 + 0.06), false);
        batch.add(new THREE.PlaneGeometry(1.8, 1.8), glow(WARM), at(dx, h * 0.55, -d / 2 - 0.06, { ry: Math.PI }), false);
        batch.add(new THREE.BoxGeometry(2.3, 0.3, 0.4), toon(0xffffff), at(dx, h * 0.55 - 1.05, d / 2 + 0.15), false);
      }
      // gumdrops on the roof ridge
      for (let q = -1; q <= 1; q++) batch.add(new THREE.SphereGeometry(0.6, 8, 6), toon(LIGHTS[(i + q + 3) % LIGHTS.length]), at(q * 2.6, h + 7.3, 0), false);
      // chimney + smoke
      batch.add(new THREE.BoxGeometry(1.4, 3, 1.4), toon(0xff3b4f), at(w * 0.28, h + 3.4, -1.2));
      const top = at(w * 0.28, h + 5.1, -1.2);
      const e = new THREE.Vector3().setFromMatrixPosition(top);
      smoke.push({ x: e.x, y: e.y, z: e.z, ph: rng() });
      // twinkly bulbs along the front eave
      for (let q = 0; q <= 6; q++) {
        const e2 = new THREE.Vector3().setFromMatrixPosition(at(-w / 2 + (q / 6) * w, h + 0.55, d / 2 + 0.6));
        bulbs.push([e2.x, e2.y, e2.z]);
      }
    };
    // outer side of Main Street, then a row on the strip between the cane's two legs
    for (let s = sA; s <= sB; s += 24) {
      for (const side of [-1, 1]) {
        const p = path.positionAt(s, side * (hw + FENCE_OFFSET + 8.5));
        if (!clearOfRoad(p.x, p.z, FENCE_OFFSET + 4.2)) continue;
        houseAt(p.x, p.z, faceRoad(ctx, p.x, p.z), k++);
      }
    }
    // garlands of lights across the street between candy-cane lamp posts
    const caneTex = ownTex(stripeTexture(0xff3b4f, 0xffffff, 6));
    caneTex.repeat.set(1, 5);
    const poleMat = toonTex(caneTex);
    const poles = [];
    const poleLat = hw + FENCE_OFFSET + 1.3;
    for (let s = sA + 10; s <= sB; s += 36) {
      const l = path.positionAt(s, -poleLat), r = path.positionAt(s, poleLat);
      for (const p of [l, r]) {
        poles.push(mat4(p.x, p.y + 5.8, p.z));
        batch.add(new THREE.SphereGeometry(0.9, 12, 8), glow(0xfff6d0), mat4(p.x, p.y + 12, p.z), false);
      }
      for (const q of bulbString([l.x, l.y + 11.2, l.z], [r.x, r.y + 11.2, r.z], 2.2, 16).slice(1, -1)) bulbs.push(q);
    }
    instanced(ctx, new THREE.CylinderGeometry(0.35, 0.42, 11.6, 10), poleMat, poles, { name: 'lamp-posts', ow: 0.08 });
  }

  // ----- the village tree in the crook of the cane ----------------------------------
  function buildVillageTree() {
    const t = sc.villageTree;
    const p = path.positionAt(t.at * L, t.lateral);
    const x = p.x, z = p.z, y = groundH(x, z) - 0.4;
    const green = toon(0x3f9a6a, { emissive: 0x06220f, emissiveIntensity: 0.3 });
    const tiers = [[13, 12, 2], [10.5, 11, 10], [8, 10, 17.5], [5.2, 8, 24]];
    for (const [r, h, yy] of tiers) {
      batch.add(new THREE.ConeGeometry(r, h, 18), green, mat4(x, y + yy + h / 2, z));
      batch.add(new THREE.TorusGeometry(r * 0.78, 0.35, 5, 24), toon(0xffffff), mat4(x, y + yy + 1.4, z, { rx: Math.PI / 2 }), false);
    }
    batch.add(new THREE.CylinderGeometry(2, 2.4, 3, 12), toon(0x8a5a36), mat4(x, y + 1.5, z));
    // glowing baubles
    for (let k = 0; k < 60; k++) {
      const ti = k % tiers.length;
      const [r, h, yy] = tiers[ti];
      const f = rng();
      const rr = r * (1 - f) * 0.98;
      const a = rng() * Math.PI * 2;
      bulbs.push([x + Math.cos(a) * rr, y + yy + f * h, z + Math.sin(a) * rr]);
    }
    // a spinning star on top
    const star = new THREE.Mesh(starGeometry(), glow(0xfff06a));
    star.position.set(x, y + 34.5, z);
    star.scale.setScalar(2.6);
    star.name = 'village-star';
    group.add(star);
    animate((dt, time) => { star.rotation.y = time * 0.8; star.scale.setScalar(2.6 + Math.sin(time * 3) * 0.2); });
    // presents around the trunk
    const gifts = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rng() * 0.3, rr = 15 + rng() * 5;
      const gx = x + Math.cos(a) * rr, gz = z + Math.sin(a) * rr;
      if (!clearOfRoad(gx, gz, FENCE_OFFSET + 2.5)) continue;
      const s = 1.6 + rng() * 1.4;
      gifts.push({ m: mat4(gx, groundH(gx, gz) + s / 2, gz, { s, ry: a }), color: LIGHTS[k % LIGHTS.length] });
    }
    instanced(ctx, new THREE.BoxGeometry(1, 1, 1), toon(0xffffff), gifts, { name: 'presents', ow: 0.05 });
    const ribbons = gifts.map((g) => ({ m: new THREE.Matrix4().multiplyMatrices(g.m, mat4(0, 0, 0, { s: [1.04, 1.04, 0.22] })) }));
    instanced(ctx, new THREE.BoxGeometry(1, 1, 1), toon(0xffffff), ribbons, { outline: false, name: 'present-ribbons' });
  }

  // ----- a giant cup of cocoa with bobbing marshmallows -----------------------------------
  function buildCocoaMug() {
    const c = sc.cocoa;
    let p = null;
    for (const lat of [c.lateral, -c.lateral, c.lateral * 1.5]) {
      const q = path.positionAt(c.at * L, lat);
      if (clearOfRoad(q.x, q.z, FENCE_OFFSET + 18)) { p = q; break; }
    }
    if (!p) return;
    const x = p.x, z = p.z, y = groundH(x, z) - 0.5;
    const R = 11, H = 16;
    batch.add(new THREE.CylinderGeometry(R, R * 0.9, H, 28, 1, true), toon(0xff5a6a, { side: THREE.DoubleSide }), mat4(x, y + H / 2, z));
    batch.add(new THREE.TorusGeometry(R, 0.7, 6, 32), toon(0xffffff), mat4(x, y + H, z, { rx: Math.PI / 2 }), false);
    batch.add(new THREE.CircleGeometry(R * 0.97, 28), toon(0x8a4a2a, { emissive: 0x2a1000, emissiveIntensity: 0.4 }), mat4(x, y + H - 1.2, z, { rx: -Math.PI / 2 }), false);
    const face = faceRoad(ctx, x, z);
    batch.add(new THREE.TorusGeometry(4.2, 1.1, 8, 18, Math.PI), toon(0xff5a6a), mat4(x - Math.cos(face) * R, y + H * 0.5, z + Math.sin(face) * R, { ry: face, rz: Math.PI / 2 }));
    // white hearts painted on the mug
    for (let k = 0; k < 6; k++) {
      const a = face + (k - 2.5) * 0.45;
      batch.add(new THREE.SphereGeometry(1, 10, 6), toon(0xffffff), mat4(x + Math.sin(a) * R * 0.97, y + H * (0.35 + (k % 2) * 0.25), z + Math.cos(a) * R * 0.97, { ry: a, s: [1.3, 1.3, 0.25] }), false);
    }
    const mm = [];
    for (let k = 0; k < 7; k++) mm.push({ a: (k / 7) * Math.PI * 2, r: 3 + (k % 3) * 2.2, ph: rng() * 6, color: k % 3 ? 0xffffff : 0xffc6de });
    const mGeo = new THREE.CylinderGeometry(1.5, 1.5, 2, 12);
    const mMesh = new THREE.InstancedMesh(mGeo, toon(0xffffff), mm.length);
    const col = new THREE.Color();
    mm.forEach((m, i) => mMesh.setColorAt(i, col.set(m.color)));
    mMesh.name = 'marshmallows';
    group.add(mMesh);
    const write = (t) => {
      mm.forEach((m, i) => {
        const a = m.a + t * 0.2;
        mMesh.setMatrixAt(i, mat4(x + Math.cos(a) * m.r, y + H - 0.8 + Math.sin(t * 1.5 + m.ph) * 0.35, z + Math.sin(a) * m.r, { rz: 0.4 + Math.sin(t + m.ph) * 0.2, ry: a }));
      });
      mMesh.instanceMatrix.needsUpdate = true;
    };
    write(0);
    animate((dt, t) => write(t));
    for (let k = 0; k < 3; k++) smoke.push({ x: x + (k - 1) * 3, y: y + H + 1, z, ph: k / 3, big: true });
  }

  // ----- friendly snowmen ---------------------------------------------------------------
  function buildSnowmen() {
    const spots = [];
    for (const [x, z] of scatter(60, (x, z) => {
      const d = distToRoad(x, z, 50);
      return d > hw + FENCE_OFFSET + 5 && d < hw + 30;
    }, { pad: 40 })) {
      if (spots.some((p) => Math.hypot(p[0] - x, p[1] - z) < 40)) continue;
      spots.push([x, z]);
      if (spots.length >= 12) break;
    }
    addSnowmen(spots.map(([x, z]) => ({ x, z, y: groundH(x, z) - 0.2, s: 1.3 + rng() * 0.5, face: faceRoad(ctx, x, z) })));
  }

  function addSnowmen(list) {
    for (const m of list) {
      const base = mat4(m.x, m.y, m.z, { ry: m.face, s: m.s });
      const at = (dx, dy, dz, o = {}) => new THREE.Matrix4().multiplyMatrices(base, mat4(dx, dy, dz, o));
      snowParts.body.push(at(0, 1.4, 0, { s: 1.6 }), at(0, 3.6, 0, { s: 1.15 }), at(0, 5.3, 0, { s: 0.85 }));
      for (const dx of [-0.3, 0.3]) snowParts.coal.push(at(dx, 5.55, 0.75, { s: 0.12 }));
      for (let q = -2; q <= 2; q++) snowParts.coal.push(at(q * 0.16, 5.02 + Math.abs(q) * 0.07, 0.78, { s: 0.07 })); // smile
      for (const yy of [3.5, 3.9]) snowParts.coal.push(at(0, yy, 1.12, { s: 0.12 }));
      snowParts.nose.push(at(0, 5.3, 0.95, { rx: Math.PI / 2, s: [0.18, 0.7, 0.18] }));
      snowParts.scarf.push({ m: at(0, 4.55, 0, { rx: Math.PI / 2, s: 0.9 }), color: LIGHTS[snowParts.scarf.length % LIGHTS.length] });
      snowParts.hat.push({ m: at(0, 6.3, 0, { s: [0.7, 0.8, 0.7] }), color: [0x2f9e5a, 0xff3b4f, 0x6a4cff][snowParts.hat.length % 3] });
    }
  }
  function flushSnowmen() {
    instanced(ctx, new THREE.SphereGeometry(1, 16, 10), toon(0xffffff, { emissive: 0x303048, emissiveIntensity: 0.25 }), snowParts.body, { name: 'snowmen', ow: 0.05 });
    instanced(ctx, new THREE.SphereGeometry(1, 6, 4), toon(0x2a2438), snowParts.coal, { outline: false, name: 'snowman-coal' });
    instanced(ctx, new THREE.ConeGeometry(1, 1, 8), toon(0xff8a2a), snowParts.nose, { outline: false, name: 'snowman-noses' });
    instanced(ctx, new THREE.TorusGeometry(0.95, 0.28, 6, 16), toon(0xffffff), snowParts.scarf, { outline: false, name: 'snowman-scarves' });
    instanced(ctx, new THREE.CylinderGeometry(0.9, 1.05, 1.3, 12), toon(0xffffff), snowParts.hat, { name: 'snowman-hats', ow: 0.05 });
  }

  // ----- the skating pond ---------------------------------------------------------------
  function buildSkatingPond() {
    const spot = scatter(1, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 30) && distToRoad(x, z, 120) < hw + 55, { pad: 60 })[0];
    if (!spot) { flushSnowmen(); return; }
    const [x, z] = spot;
    const y = groundH(x, z) + 0.05;
    const R = 24;
    const ice = own(toon(0xcdeeff, { unique: true, emissive: 0x3a6a9a, emissiveIntensity: 0.3 }));
    batch.add(new THREE.CylinderGeometry(R + 1.6, R + 2.2, 1.2, 36), toon(0xffffff), mat4(x, y - 0.4, z));
    const pond = new THREE.Mesh(new THREE.CircleGeometry(R, 36), ice);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(x, y + 0.25, z);
    pond.name = 'skating-pond';
    group.add(pond);
    animate((dt, t) => { ice.emissiveIntensity = 0.28 + Math.sin(t * 2) * 0.05; });
    // three little snowmen skating in circles
    const skaters = [0, 1, 2].map((k) => ({ r: 8 + k * 5, sp: 0.5 - k * 0.1, ph: k * 2.1 }));
    const bodies = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 8), toon(0xffffff), skaters.length * 3);
    const scarves = new THREE.InstancedMesh(new THREE.TorusGeometry(0.95, 0.28, 6, 14), toon(0xff3b4f), skaters.length);
    const noses = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), toon(0xff8a2a), skaters.length);
    bodies.name = 'skaters';
    group.add(bodies, scarves, noses);
    const write = (t) => {
      skaters.forEach((sk, i) => {
        const a = t * sk.sp + sk.ph;
        const sx = x + Math.cos(a) * sk.r, sz = z + Math.sin(a) * sk.r;
        const face = -a; // facing along the circle
        const base = mat4(sx, y + 0.3, sz, { ry: face, rz: Math.sin(t * 3 + sk.ph) * 0.08 });
        const at = (dx, dy, dz, o = {}) => new THREE.Matrix4().multiplyMatrices(base, mat4(dx, dy, dz, o));
        bodies.setMatrixAt(i * 3, at(0, 1.2, 0, { s: 1.3 }));
        bodies.setMatrixAt(i * 3 + 1, at(0, 3, 0, { s: 0.95 }));
        bodies.setMatrixAt(i * 3 + 2, at(0, 4.4, 0, { s: 0.7 }));
        scarves.setMatrixAt(i, at(0, 3.75, 0, { rx: Math.PI / 2, s: 0.75 }));
        noses.setMatrixAt(i, at(0, 4.4, 0.8, { rx: Math.PI / 2, s: [0.15, 0.6, 0.15] }));
      });
      bodies.instanceMatrix.needsUpdate = scarves.instanceMatrix.needsUpdate = noses.instanceMatrix.needsUpdate = true;
    };
    write(0);
    animate((dt, t) => write(t));
    // snowmen cheering at the pond edge
    addSnowmen([0.6, 2.4, 4.1].map((a) => {
      const sx = x + Math.cos(a) * (R + 5), sz = z + Math.sin(a) * (R + 5);
      return { x: sx, z: sz, y: groundH(sx, sz) - 0.2, s: 1.1, face: Math.atan2(x - sx, z - sz) };
    }).filter((m) => clearOfRoad(m.x, m.z, FENCE_OFFSET + 3)));
    flushSnowmen();
  }

  // ----- snowy pines ---------------------------------------------------------------------
  function buildPines() {
    const lower = [], upper = [], caps = [], trunks = [];
    for (const [x, z] of scatter(150, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 7), { pad: 150 })) {
      const s = 1 + rng() * 1.2;
      const y = groundH(x, z);
      trunks.push(mat4(x, y + 0.8 * s, z, { s: [s, s * 1.6, s] }));
      lower.push(mat4(x, y + 3.6 * s, z, { s: [4 * s, 5.5 * s, 4 * s], ry: rng() * 6 }));
      upper.push(mat4(x, y + 7 * s, z, { s: [2.9 * s, 4.6 * s, 2.9 * s], ry: rng() * 6 }));
      caps.push(mat4(x, y + 8.9 * s, z, { s: [1.6 * s, 2.2 * s, 1.6 * s] }));
    }
    const cone = new THREE.ConeGeometry(1, 1, 8);
    instanced(ctx, new THREE.CylinderGeometry(0.4, 0.5, 1, 6), toon(0x8a5a36), trunks, { outline: false, name: 'pine-trunks' });
    instanced(ctx, cone, toon(0x3f9a6a, { emissive: 0x06220f, emissiveIntensity: 0.3 }), lower, { name: 'pines', ow: 0.04 });
    instanced(ctx, cone, toon(0x4fae7a, { emissive: 0x06220f, emissiveIntensity: 0.3 }), upper, { name: 'pines-top', ow: 0.04 });
    instanced(ctx, cone, toon(0xffffff, { emissive: 0x303048, emissiveIntensity: 0.25 }), caps, { outline: false, name: 'pine-snowcaps' });
  }

  // ----- giant candy canes + peppermint lollipops -------------------------------------------
  function buildCandyCanes() {
    const caneTex = ownTex(stripeTexture(0xff3b4f, 0xffffff, 6));
    caneTex.repeat.set(10, 1);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 6, 0), new THREE.Vector3(0, 8, 0),
      new THREE.Vector3(0.9, 9.3, 0), new THREE.Vector3(2, 8.8, 0), new THREE.Vector3(2.4, 7.6, 0),
    ]);
    const caneGeo = new THREE.TubeGeometry(curve, 20, 0.5, 7, false);
    const spots = scatter(26, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5), { pad: 90 });
    instanced(ctx, caneGeo, toonTex(caneTex), spots.map(([x, z]) => mat4(x, groundH(x, z) - 0.2, z, { ry: rng() * 6, s: 1 + rng() * 0.8 })), { name: 'giant-canes', ow: 0.06 });
    lollipops(scatter(24, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 4), { pad: 100 }),
      [[0xff3b4f, 0xffffff], [0x2f9e5a, 0xffffff], [0xff9ef0, 0xffffff]],
      { height: [5, 8], radius: [1.8, 2.8] });
  }

  // ----- chimney + mug steam puffs -------------------------------------------------------------
  function buildChimneySmoke() {
    if (!smoke.length) return;
    const per = 3;
    const puff = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false })), smoke.length * per);
    puff.name = 'chimney-smoke';
    puff.frustumCulled = false;
    group.add(puff);
    const write = (t) => {
      smoke.forEach((sm, i) => {
        for (let k = 0; k < per; k++) {
          const f = (t * 0.3 + sm.ph + k / per) % 1;
          const s = (sm.big ? 2.2 : 0.7) * (1 + f * 2.2) * (1 - f * 0.3);
          puff.setMatrixAt(i * per + k, mat4(sm.x + Math.sin(t + k) * f * 1.5, sm.y + f * (sm.big ? 14 : 7), sm.z + f * 1.2, { s }));
        }
      });
      puff.instanceMatrix.needsUpdate = true;
    };
    write(0);
    animate((dt, t) => write(t));
  }

  // ----- snowfall, far snowy mountains, sparkles --------------------------------------------
  function buildWinterSky() {
    backgroundHills(22, extent + 250, extent + 420, [0xffffff, 0xe6e9ff, 0xf6e6ff, 0xdfe8ff], { hMin: 40, hMax: 95, widthMul: 1.6 });
    drifting(ctx, new THREE.IcosahedronGeometry(1, 0), glow(0xffffff), 420, { top: 42, bottom: -3, fall: [2, 4], sway: 1.6, spin: 1, scale: [0.12, 0.26] });
    sparkles(220, center.x, center.z, extent + 40, 2, 26, [0xffffff, 0xfff6c8, 0xffd1ec], 1.3);
    void outlineMat; void pushedCopy;
  }
}

/** A chunky 5-point star, extruded (for the top of the village tree). */
function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.45 : 1;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false });
  g.center();
  return g;
}

/** Road details: piped-icing dashes along both edges of the gingerbread road. */
export function buildRoadDetails(ctx) {
  roadStitches(ctx, { color: 0xffffff, lateral: ctx.hw - 1.3, dash: 1.4, gap: 1.1, width: 0.42 });
}

export default { def, buildScenery, buildRoadDetails };
