/**
 * Donut Downtown — track module (data + scenery). Cup: adventure-cup.
 * OWNER: Tracks — Adventure Cup.
 *
 * A twinkly night-time city of bakeries. Square city corners, a zig-zag
 * chicane down Bakery Row, a hop over the Sprinkle Street overpass, a glowing
 * tunnel of neon arches along Donut Avenue and — the star of the show — Main
 * Street runs straight through the hole of a GIANT frosted donut.
 */
import * as THREE from 'three';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, mat4, ribbon, frames, dataTexture, rgb, extruded, starShape } from './sceneryKit.js';
import { instanced, animatedInstances, farRing, capsule } from './props/adventure-kit.js';

/** Neon palette (signs, sprinkles, arches). */
export const NEON = Object.freeze([0xff6fd8, 0x6ff3ff, 0xfff27a, 0x9dff8a, 0xb78cff, 0xffa24f]);

export const def = makeTrack(
  {
    id: 'donut-downtown',
    name: 'Donut Downtown',
    subtitle: 'Zoom through the giant donut, all lit up at night!',
    laps: 3,
    width: 18,
    previewColor: 0x6a4cff,
    art: ['🍩', '🌃', '✨'], // menu card emoji: big, bottom-left, top-right
    cup: 'adventure-cup',
    unlock: { type: 'stat', stat: 'multiplayerRaces', count: 3 },
    theme: {
      skyTop: 0x120a36,
      skyBottom: 0x5c2f8f,
      fogColor: 0x3a2466,
      fogNear: 170,
      fogFar: 640,
      ground: 0x3d3466,
      road: 0x34305e, // blueberry asphalt
      roadAlt: 0x2c2852,
      curbA: 0xff6fd8, // neon pink
      curbB: 0x6ff3ff, // neon cyan
      offRoad: 0x51477f, // sidewalk
      music: 'donut-downtown',
      sunColor: 0xd0c4ff,
      ambientColor: 0x9a8cff,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      night: true, // unlit (glowing) curbs/arch, softer sun, no daytime clouds
      skyStars: true,
      roadSprinkles: { style: 'dashes', count: 36, palette: NEON },
      startLineDark: 0x1b1450,
      skirt: { color: 0x3b2a86, trim: 0xff6fd8 },
      pillar: { shape: 'box', color: 0x6a5aa8, ring: 0x6ff3ff },
    },
  },
  {
    start: [0, 0],
    heading: 0,
    startAt: 54,
    ops: [
      { s: 160, flex: true, mark: 'main-street' },
      { turn: -90, r: 38, mark: 'corner-1' },
      { s: 60, flex: true, mark: 'bakery-row' },
      { turn: 35, r: 50, mark: 'chicane-1' },
      { turn: -35, r: 50, mark: 'chicane-2' },
      { s: 30, mark: 'bakery-row-2' },
      { turn: -90, r: 36, mark: 'corner-2' },
      { s: 50, y: 6, mark: 'ramp-up' },
      { s: 50, y: 6, mark: 'overpass' },
      { s: 50, y: 0, mark: 'ramp-down' },
      { turn: 90, r: 36, mark: 'corner-3' },
      { s: 40, mark: 'sprinkle-st' },
      { turn: -90, r: 36, mark: 'corner-4' },
      { s: 80, mark: 'glaze-ave' },
      { turn: -90, r: 40, mark: 'corner-5' },
      { s: 250, mark: 'donut-avenue' },
      { turn: -90, r: 40, mark: 'corner-6' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('bakery-row', 'mid'), frac('overpass', 'mid'), frac('glaze-ave', 'mid'), frac('donut-avenue', 'mid') - 0.03],
    boostPads: [
      { at: frac('main-street', 'end') - 0.03, lateral: 3 },
      { at: frac('chicane-2', 'end'), lateral: -3 },
      { at: frac('ramp-down', 'mid'), lateral: 3 },
      { at: frac('donut-avenue', 'end') - 0.02, lateral: -3 },
    ],
    scenery: {
      kind: 'downtown',
      center: centroid(),
      terrain: 'flat',
      donutAt: frac('main-street', 'end') - 0.075,
      neonTunnel: [frac('donut-avenue', 'start') + 0.03, frac('donut-avenue', 'mid') + 0.02],
      fence: { post: 0xfff6a8, postAlt: 0xff9ce8, rail: 0x9ff7ff, topper: 'ball', topperColor: 0xff9ce8, glow: true },
      arch: { a: 0xff6fd8, b: 0xfff27a, banner: 0x6a4cff, text: 'SPRINKLE KART' },
    },
  }),
);

/** Building archetypes (width, height, depth); windows keep a fixed size on each. */
export const BUILDING_TYPES = Object.freeze([
  { w: 12, h: 16, d: 12 },
  { w: 14, h: 26, d: 12 },
  { w: 12, h: 38, d: 12 },
  { w: 18, h: 20, d: 14 },
  { w: 10, h: 52, d: 10 },
]);

/** Facade texture (white walls, pale windows) + matching window glow map. */
function windowTextures() {
  const lit = [rgb(0xfff2a8), rgb(0xffd6f0), rgb(0xbff6ff), rgb(0xfff2a8)];
  const cell = (x, y) => {
    const cx = x % 16, cy = y % 16;
    const win = cx >= 3 && cx <= 12 && cy >= 4 && cy <= 12;
    const k = ((Math.floor(x / 16) * 7 + Math.floor(y / 16) * 3) % 5);
    return { win, on: k !== 0, c: lit[k % lit.length] };
  };
  const facade = dataTexture(64, (x, y) => {
    const { win, on, c } = cell(x, y);
    if (!win) return [255, 255, 255, 255];
    return on ? [...c, 255] : [70, 60, 110, 255];
  });
  const glowMap = dataTexture(64, (x, y) => {
    const { win, on, c } = cell(x, y);
    return win && on ? [...c, 255] : [0, 0, 0, 255];
  });
  return { facade, glowMap };
}

/** BoxGeometry whose side UVs repeat every 8 units (so windows never stretch). */
function buildingBox({ w, h, d }) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      if (f === 2 || f === 3) { uv.setXY(i, 0.02, 0.02); continue; } // roofs: plain wall colour
      const across = f < 2 ? d : w;
      uv.setXY(i, uv.getX(i) * (across / 8), uv.getY(i) * (h / 8));
    }
  }
  g.translate(0, h / 2, 0);
  return g;
}

/**
 * City lots along the road: building footprints that keep off every piece
 * of road and off each other. Pure (uses rng + road helpers only).
 * @returns {{x:number, z:number, ry:number, type:number, face:{x:number,z:number}, c:number}[]}
 */
export function planLots({ path, rng, hw, clearOfRoad, scatter }, { every = 13, setback = FENCE_OFFSET + 5, keepOut = [], infill = 0 } = {}) {
  const lots = [];
  const palette = [0xffc2e2, 0xc9b8ff, 0xa8e8ff, 0xffe0b8, 0xb8ffd9, 0xffb8c8];
  const fits = (x, z, r) => {
    if (!clearOfRoad(x, z, setback + r - 1)) return false;
    for (const k of keepOut) if (Math.hypot(k.x - x, k.z - z) < k.r + r) return false;
    for (const l of lots) if (Math.hypot(l.x - x, l.z - z) < l.r + r + 1.5) return false;
    return true;
  };
  for (let s = 0; s < path.length; s += every) {
    for (const side of [-1, 1]) {
      const type = Math.floor(rng() * BUILDING_TYPES.length);
      const T = BUILDING_TYPES[type];
      const r = Math.hypot(T.w, T.d) / 2;
      const lat = side * (hw + setback + r + rng() * 4);
      const p = path.positionAt(s, lat);
      if (!fits(p.x, p.z, r)) continue;
      const h = path.headingAt(s);
      const inward = path.positionAt(s, 0);
      lots.push({ x: p.x, z: p.z, r, ry: h, type, face: { x: inward.x - p.x, z: inward.z - p.z }, c: palette[Math.floor(rng() * palette.length)] });
    }
  }
  // back-lot buildings filling the blocks further from the road
  if (infill && scatter) {
    for (const [x, z] of scatter(infill, (x, z) => clearOfRoad(x, z, setback + 12), { pad: 70 })) {
      const type = Math.floor(rng() * BUILDING_TYPES.length);
      const T = BUILDING_TYPES[type];
      const r = Math.hypot(T.w, T.d) / 2;
      if (!fits(x, z, r)) continue;
      lots.push({ x, z, r, ry: Math.floor(rng() * 4) * (Math.PI / 2), type, face: { x: 1, z: 0 }, c: palette[Math.floor(rng() * palette.length)], back: true });
    }
  }
  return lots;
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, own, ownTex, hw, center, extent, distToRoad, clearOfRoad, animators,
    scatter, sparkles, floatingShapes,
  } = ctx;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const donutS = def.scenery.donutAt * path.length;
  const donutP = path.pointAt(donutS);
  const lots = planLots(ctx, { keepOut: [{ x: donutP.x, z: donutP.z, r: hw + FENCE_OFFSET + 5 + 8 * 2 + 4 }], infill: 140 });
  buildBuildings(lots);
  buildStreetLamps();
  buildGiantDonut();
  buildNeonTunnel();
  buildSkyline();
  buildMoon();
  buildFireworks();
  floatingShapes(capsule(0.35, 1.4, 2, 6), scatter(70, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 6), { pad: 60 }), NEON, { yMin: 16, yMax: 40, scale: [1.2, 2.2], glowy: true });
  sparkles(300, center.x, center.z, extent + 60, 4, 60, [0xffffff, 0xff9ce8, 0x9ff7ff, 0xfff27a], 1.6);

  // --------------------------------------------------------------------------

  function buildBuildings(list) {
    const { facade, glowMap } = windowTextures();
    ownTex(facade); ownTex(glowMap);
    const mat = own(toon(0xffffff, { unique: true }));
    mat.map = facade;
    mat.emissiveMap = glowMap;
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveIntensity = 0.95;
    mat.needsUpdate = true;
    animators.push((dt, t) => { mat.emissiveIntensity = 0.88 + Math.sin(t * 0.7) * 0.07; });
    BUILDING_TYPES.forEach((T, k) => {
      const items = list.filter((l) => l.type === k).map((l) => ({ m: mat4(l.x, -0.05, l.z, { ry: l.ry }), c: l.c }));
      instanced(ctx, buildingBox(T), mat, items, { outline: 0.12 });
    });
    // roof caps, and a spinning donut sign on some roofs
    const caps = [], signs = [], awnings = [], shopGlow = [];
    for (const l of list) {
      const T = BUILDING_TYPES[l.type];
      if (l.back) { caps.push({ m: mat4(l.x, T.h, l.z, { ry: l.ry, s: [T.w + 0.8, 0.8, T.d + 0.8] }), c: pick([0xff6fd8, 0x6ff3ff, 0xfff27a, 0xffffff]) }); if (rng() < 0.3) signs.push({ x: l.x, y: T.h + 5, z: l.z, ph: rng() * 6, c: pick(NEON) }); continue; }
      caps.push({ m: mat4(l.x, T.h, l.z, { ry: l.ry, s: [T.w + 0.8, 0.8, T.d + 0.8] }), c: pick([0xff6fd8, 0x6ff3ff, 0xfff27a, 0xffffff]) });
      if (rng() < 0.35) signs.push({ x: l.x, y: T.h + 5, z: l.z, ph: rng() * 6, c: pick(NEON) });
      // bakery storefront facing the road: striped awning + glowing shop window
      const fl = Math.hypot(l.face.x, l.face.z) || 1;
      const fx = l.face.x / fl, fz = l.face.z / fl;
      const reach = Math.abs(fx * Math.sin(l.ry) + fz * Math.cos(l.ry)) > 0.7 ? T.d / 2 : T.w / 2;
      const ay = Math.atan2(fx, fz);
      awnings.push({ m: mat4(l.x + fx * (reach + 1), 4.2, l.z + fz * (reach + 1), { ry: ay, s: [Math.min(T.w, T.d) * 0.8, 1, 1] }), c: pick([0xff6fd8, 0x6ff3ff, 0xffa24f, 0x9dff8a]) });
      shopGlow.push({ m: mat4(l.x + fx * (reach + 0.08), 2, l.z + fz * (reach + 0.08), { ry: ay, s: [Math.min(T.w, T.d) * 0.7, 3, 1] }), c: pick([0xfff2a8, 0xffd6f0, 0xbff6ff]) });
    }
    instanced(ctx, new THREE.BoxGeometry(1, 1, 1), toon(0xffffff, { emissive: 0x332266, emissiveIntensity: 0.4 }), caps);
    const awningGeo = new THREE.CylinderGeometry(1.2, 1.2, 1, 10, 1, true, 0, Math.PI);
    awningGeo.rotateZ(Math.PI / 2);
    instanced(ctx, awningGeo, toon(0xffffff, { side: THREE.DoubleSide, emissive: 0x442255, emissiveIntensity: 0.5 }), awnings, { outline: 0.06 });
    instanced(ctx, new THREE.PlaneGeometry(1, 1), glow(0xffffff), shopGlow);
    // spinning neon donut signs
    const ringGeo = new THREE.TorusGeometry(2.6, 1.1, 10, 20);
    animatedInstances(ctx, ringGeo, glow(0xffffff), signs, (sg, t, o) => {
      o.x = sg.x; o.y = sg.y + Math.sin(t * 1.5 + sg.ph) * 0.4; o.z = sg.z;
      o.ry = t * 0.8 + sg.ph;
    });
    instanced(ctx, new THREE.CylinderGeometry(0.2, 0.2, 5, 5), toon(0xd8d0ff), signs.map((sg) => ({ m: mat4(sg.x, sg.y - 3.2, sg.z) })));
  }

  /** Lollipop street lamps all along the kerbs. */
  function buildStreetLamps() {
    const posts = [], bulbs = [];
    for (let s = 6; s < path.length; s += 22) {
      for (const side of [-1, 1]) {
        const q = path.positionAt(s, side * (hw + FENCE_OFFSET + 2.2));
        if (distToRoad(q.x, q.z, hw + 20) < hw + FENCE_OFFSET + 1.5) continue; // never on other road
        posts.push({ m: mat4(q.x, q.y + 3.4, q.z) });
        bulbs.push({ m: mat4(q.x, q.y + 7.2, q.z), c: pick([0xfff2a8, 0xff9ce8, 0x9ff7ff]) });
      }
    }
    instanced(ctx, new THREE.CylinderGeometry(0.18, 0.26, 6.8, 6), toon(0xd8d0ff), posts);
    instanced(ctx, new THREE.SphereGeometry(0.9, 12, 8), glow(0xffffff), bulbs);
  }

  /** THE giant donut standing over Main Street: drive through the hole! */
  function buildGiantDonut() {
    const s = def.scenery.donutAt * path.length;
    const p = path.pointAt(s);
    const h = path.headingAt(s);
    const hole = hw + FENCE_OFFSET + 5; // the road + fences fit through with room to spare
    const tube = 8;
    const R = hole + tube;
    const cy = p.y + hole * 0.42; // half-sunk: the ground hides the bottom of the ring
    const g = new THREE.Group();
    g.position.set(p.x, cy, p.z);
    g.rotation.y = h;
    group.add(g);
    const dough = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 16, 48), toon(0xe8a860));
    dough.scale.z = 0.8;
    g.add(dough);
    // strawberry icing on both faces, with a wobbly drippy edge
    const icingMat = toon(0xff8fcf, { emissive: 0x551133, emissiveIntensity: 0.35 });
    const icingGeo = new THREE.TorusGeometry(R, tube * 0.86, 12, 48);
    for (const side of [-1, 1]) {
      const icing = new THREE.Mesh(icingGeo, icingMat);
      icing.position.z = side * tube * 0.3;
      icing.scale.z = 0.62;
      g.add(icing);
    }
    const out = new THREE.Mesh(new THREE.TorusGeometry(R, tube + 0.4, 12, 48), ctx.outlineMat);
    out.scale.z = 0.84;
    g.add(out);
    // sprinkles scattered over both icing faces
    const spr = [];
    for (let k = 0; k < 170; k++) {
      const a = rng() * Math.PI * 2;
      const rr = R + (rng() - 0.5) * tube * 1.3;
      const side = k % 2 ? 1 : -1;
      const lz = side * (tube * 0.3 + Math.sqrt(Math.max(0, 1 - ((rr - R) / (tube * 0.86)) ** 2)) * tube * 0.86 * 0.62 + 0.2);
      const wp = new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, lz).applyEuler(new THREE.Euler(0, h, 0)).add(g.position);
      if (wp.y < p.y + 0.5) continue;
      spr.push({ m: mat4(wp.x, wp.y, wp.z, { ry: h, rx: 0, rz: rng() * Math.PI }), c: pick(NEON) });
    }
    instanced(ctx, capsule(0.4, 1.6, 1, 5), glow(0xffffff), spr);
    // twinkling bulbs round the hole, chasing like a theatre sign
    const bulbs = [];
    for (let k = 0; k < 30; k++) {
      const a = (k / 30) * Math.PI * 2;
      const rr = hole - 0.6;
      const wp = new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, tube * 0.2).applyEuler(new THREE.Euler(0, h, 0)).add(g.position);
      if (wp.y < p.y + 0.5) continue;
      bulbs.push({ x: wp.x, y: wp.y, z: wp.z, k });
    }
    const bulbMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const bulbMesh = animatedInstances(ctx, new THREE.SphereGeometry(0.55, 8, 6), bulbMat, bulbs, (b, t, o) => {
      o.x = b.x; o.y = b.y; o.z = b.z;
      o.sx = o.sy = o.sz = (Math.floor(t * 6 + b.k) % 3 === 0) ? 1.5 : 0.8;
    });
    if (bulbMesh) bulbs.forEach((b, i) => bulbMesh.setColorAt(i, new THREE.Color(NEON[b.k % NEON.length])));
  }

  /** A tunnel of glowing neon arches along Donut Avenue, colours chasing along it. */
  function buildNeonTunnel() {
    const [f0, f1] = def.scenery.neonTunnel;
    const span = hw + FENCE_OFFSET + 2;
    const arches = [];
    let k = 0;
    for (let s = f0 * path.length; s < f1 * path.length; s += 13, k++) {
      const p = path.pointAt(s);
      arches.push({ m: mat4(p.x, p.y, p.z, { ry: path.headingAt(s), s: [1, 1.05, 1] }), k });
    }
    const geo = new THREE.TorusGeometry(span, 0.55, 8, 32, Math.PI);
    const mesh = instanced(ctx, geo, own(new THREE.MeshBasicMaterial({ color: 0xffffff })), arches);
    if (!mesh) return;
    const c = new THREE.Color();
    animators.push((dt, t) => {
      arches.forEach((a, i) => mesh.setColorAt(i, c.setHSL(((a.k * 0.09 - t * 0.35) % 1 + 1) % 1, 0.9, 0.66)));
      mesh.instanceColor.needsUpdate = true;
    });
    // glowing lane stripes inside the tunnel
    const fr = frames(path, f0 * path.length, f1 * path.length, 1.5);
    for (const lat of [-hw * 0.5, hw * 0.5]) group.add(new THREE.Mesh(ribbon(fr, lat - 0.25, lat + 0.25, 0.045), glow(0x9ff7ff)));
  }

  /** Tall city towers on the horizon, windows glowing. */
  function buildSkyline() {
    const spots = farRing(ctx, 46, extent + 120, extent + 260);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    instanced(ctx, geo, toon(0xffffff, { emissive: 0x221144, emissiveIntensity: 0.6 }), spots.map(([x, z, a]) => {
      const h = 40 + rng() * 90;
      return { m: mat4(x, 0, z, { ry: a, s: [14 + rng() * 16, h, 14 + rng() * 12] }), c: pick([0x6a5aa8, 0x7d5fc0, 0x5a4a96, 0x8f6fd0]) };
    }));
    // twinkling roof beacons
    const beacons = spots.map(([x, z]) => ({ x, z, y: 0, ph: rng() * 6 }));
    // (heights re-rolled cheaply: beacons float at a pleasant skyline height)
    beacons.forEach((b) => { b.y = 50 + rng() * 60; });
    animatedInstances(ctx, new THREE.SphereGeometry(1.4, 8, 6), glow(0xff6fd8), beacons, (b, t, o) => {
      o.x = b.x; o.y = b.y; o.z = b.z;
      o.sx = o.sy = o.sz = 0.6 + (Math.sin(t * 2 + b.ph) > 0.6 ? 0.8 : 0);
    });
  }

  /** A big smiling moon over the city. */
  function buildMoon() {
    const m = own(new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false }));
    const moon = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 20), m);
    moon.position.set(center.x - extent - 260, 230, center.z - extent - 200);
    group.add(moon);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(62, 40), own(new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.18, fog: false, depthWrite: false })));
    halo.position.copy(moon.position);
    halo.lookAt(center.x, 20, center.z);
    group.add(halo);
    const face = new THREE.Group();
    face.position.copy(moon.position);
    face.lookAt(center.x, 20, center.z);
    const ink = own(new THREE.MeshBasicMaterial({ color: 0x5a3a5a, fog: false }));
    for (const ex of [-13, 13]) {
      const eye = new THREE.Mesh(new THREE.TorusGeometry(5, 1.2, 6, 14, Math.PI), ink);
      eye.position.set(ex, 7, 38.5);
      face.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(11, 1.4, 6, 20, Math.PI), ink);
    smile.position.set(0, -4, 38);
    smile.rotation.z = Math.PI;
    face.add(smile);
    group.add(face);
    // a little star hanging off the moon
    const star = new THREE.Mesh(extruded(starShape(5, 1, 0.45), 0.3, 0.05, 1), own(new THREE.MeshBasicMaterial({ color: 0xfff27a, fog: false })));
    star.scale.setScalar(9);
    star.position.set(moon.position.x + 55, moon.position.y - 30, moon.position.z);
    group.add(star);
    animators.push((dt, t) => { star.rotation.y = t * 0.6; });
  }

  /** Gentle fireworks: sparkle bursts blooming over the rooftops, one after another. */
  function buildFireworks() {
    const bursts = [];
    for (let k = 0; k < 4; k++) {
      const a = rng() * Math.PI * 2, r = extent * 0.5 + rng() * extent * 0.6;
      bursts.push({ x: center.x + Math.cos(a) * r, y: 70 + rng() * 40, z: center.z + Math.sin(a) * r, ph: k / 4, c: NEON[k % NEON.length] });
    }
    const sparks = [];
    for (const b of bursts) {
      for (let k = 0; k < 26; k++) {
        const u = rng() * 2 - 1, th = rng() * Math.PI * 2;
        const q = Math.sqrt(1 - u * u);
        sparks.push({ b, dx: Math.cos(th) * q, dy: u, dz: Math.sin(th) * q, c: b.c });
      }
    }
    animatedInstances(ctx, new THREE.SphereGeometry(0.9, 6, 4), own(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })), sparks, (sp, t, o) => {
      const u = (t * 0.22 + sp.b.ph) % 1;
      const grow = Math.min(1, u * 4);
      const r = 4 + grow * 20;
      o.x = sp.b.x + sp.dx * r; o.y = sp.b.y + sp.dy * r - u * u * 10; o.z = sp.b.z + sp.dz * r;
      const vis = u < 0.6 ? 1 - u / 0.6 : 0;
      o.sx = o.sy = o.sz = Math.max(0.001, vis * 1.3);
    });
  }

}

/** Road details: glowing dashed lane lines. */
export function buildRoadDetails(ctx) {
  const { path, group, hw } = ctx;
  const geos = [];
  for (let s = 0; s < path.length - 5; s += 9) {
    const fr = frames(path, s, s + 4, 1);
    for (const lat of [-hw / 3, hw / 3]) geos.push(ribbon(fr, lat - 0.2, lat + 0.2, 0.042));
  }
  const pos = [];
  for (const g of geos) { pos.push(...g.attributes.position.array); g.dispose(); }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  group.add(new THREE.Mesh(merged, glow(0xfff6a8)));
}

export default { def, buildScenery, buildRoadDetails };
