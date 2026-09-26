/**
 * Lemonade Volcano — track module (data + scenery). Cup: adventure-cup.
 * OWNER: Tracks — Adventure Cup.
 *
 * A tropical island in a fizzy lemonade sea. The friendliest volcano ever
 * (it only ever burps lemonade bubbles) sits in the middle; the road runs
 * along the sugar-sand beach, climbs the volcano's flank in one huge
 * sweeping arc up to Fizz Ridge (the highest road in the cup), hops a
 * lemonade stream on the Lemon Bridge, wiggles through the rim S-bend and
 * rolls back down to the boardwalk.
 */
import * as THREE from 'three';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, mat4, ribbon, dataTexture, rgb, distToPolyline } from './sceneryKit.js';
import { instanced, animatedInstances, isClearOfCamera, farRing, lathe } from './props/adventure-kit.js';

/** Sea level of the lemonade (the hills apron sits at -3). */
export const SEA_Y = -1.3;

export const def = makeTrack(
  {
    id: 'lemonade-volcano',
    name: 'Lemonade Volcano',
    subtitle: 'A fizzy, bubbly, friendly volcano island',
    laps: 3,
    width: 20,
    previewColor: 0xffe14f,
    art: ['🌋', '🍋', '🫧'], // menu card emoji: big, bottom-left, top-right
    cup: 'adventure-cup',
    unlock: { type: 'stat', stat: 'wins', count: 4 },
    theme: {
      skyTop: 0x2fa8ff,
      skyBottom: 0xe6f7ff,
      fogColor: 0xeaf8ff,
      fogNear: 190,
      fogFar: 720,
      ground: 0xfff1dc, // sugar sand
      road: 0xf2a08e, // pink grapefruit
      roadAlt: 0xe89180,
      curbA: 0xffe14f,
      curbB: 0xffffff,
      offRoad: 0xfff7e6,
      music: 'lemonade-volcano',
      sunColor: 0xfffbe8,
      ambientColor: 0xfff4d8,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      roadSprinkles: { style: 'stars', count: 160, palette: [0xffffff, 0xfff27a, 0xffe14f, 0xfff9d6] },
      groundTints: [0x9fe8a8, 0x7fdc98, 0xffd0c0],
      groundTintMix: 0.8,
      skirt: { color: 0xffd36b, trim: 0xffffff },
      pillar: { shape: 'round', color: 0xfff4e0, ring: 0xffe14f },
    },
  },
  {
    start: [0, 0],
    heading: 0,
    startAt: 54,
    ops: [
      { s: 110, flex: true, mark: 'start-straight' },
      { turn: 70, r: 100, y: 2, mark: 'beach-bend' },
      { s: 60, y: 5, mark: 'climb' },
      { turn: 80, r: 130, y: 11, mark: 'fizz-ridge' },
      { s: 40, y: 13, hump: 1, mark: 'lemon-bridge' },
      { turn: 60, r: 120, y: 14, mark: 'summit-sweep' },
      { turn: -70, r: 60, y: 12, mark: 'rim-s1' },
      { turn: 110, r: 50, y: 9, mark: 'rim-s2' },
      { s: 80, flex: true, y: 4, mark: 'fizzy-descent' },
      { turn: 90, r: 70, y: 1, mark: 'shore-turn' },
      { s: 60, y: 0, mark: 'boardwalk' },
      { turn: 20, r: 80, y: 0, mark: 'last-turn' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('climb', 'mid'), frac('summit-sweep', 'mid'), frac('fizzy-descent', 'mid'), frac('boardwalk', 'mid')],
    boostPads: [
      { at: frac('beach-bend', 'end') - 0.01, lateral: 4 },
      { at: frac('lemon-bridge', 'mid'), lateral: 0 },
      { at: frac('rim-s2', 'end') + 0.012, lateral: -4 },
      { at: frac('shore-turn', 'end'), lateral: 4 },
    ],
    scenery: {
      kind: 'volcano',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 5, scale: 0.012 },
      bridges: [[frac('lemon-bridge', 'start') - 0.015, frac('lemon-bridge', 'end') + 0.015]],
      river: { at: frac('lemon-bridge', 'mid') },
      glassAt: frac('start-straight', 'start') + 0.03,
      geysers: [frac('fizz-ridge', 'start'), frac('summit-sweep', 'end')],
      fence: { post: 0xffffff, postAlt: 0xffe14f, rail: 0xfff6c8, topper: 'star', topperColor: 0xffe14f },
      arch: { a: 0xffe14f, b: 0xffffff, banner: 0x3fb8ff, text: 'SPRINKLE KART' },
    },
  }),
);

/**
 * Before the terrain is made: trace the lemonade stream that runs from the
 * volcano, under the Lemon Bridge and out to the sea, so the hills carve a
 * little gorge for it.
 */
export function prepare({ def, path, index }) {
  if (!def.scenery?.river) return def;
  return { ...def, scenery: { ...def.scenery, riverLine: streamPolyline(def, path, index) } };
}

export function streamPolyline(def, path, index) {
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
    for (let d = 0; d <= 200; d += 6) {
      const wig = Math.sin(d * 0.04) * 7 * Math.min(1, d / 40);
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
 * The spot inside the loop that is farthest from the road (where the volcano
 * goes) and that distance. Pure: works on a TrackPath + road index.
 */
export function volcanoSite(path, index, center, extent) {
  // even-odd point-in-loop test on the centre line
  const inside = (x, z) => {
    let c = false;
    for (let i = 0, j = path.count - 1; i < path.count; j = i++) {
      const xi = path.px[i], zi = path.pz[i], xj = path.px[j], zj = path.pz[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  let best = { x: center.x, z: center.z, room: 0 };
  for (let gx = -extent; gx <= extent; gx += 8) {
    for (let gz = -extent; gz <= extent; gz += 8) {
      const x = center.x + gx, z = center.z + gz;
      const d = index.nearest(x, z, extent * 2).dist;
      if (d > best.room && inside(x, z)) best = { x, z, room: d };
    }
  }
  return best;
}

/** A lemon-slice texture: rind, pith and juicy segments (DataTexture, no DOM). */
function lemonSliceTexture() {
  const rind = rgb(0xffd21f), pith = rgb(0xfffbe6), flesh = rgb(0xfff08a), seg = rgb(0xffe45c);
  return dataTexture(64, (x, y) => {
    const dx = (x - 31.5) / 32, dy = (y - 31.5) / 32;
    const r = Math.hypot(dx, dy);
    if (r > 0.97) return [...rind, 0];
    if (r > 0.86) return [...rind, 255];
    if (r > 0.78) return [...pith, 255];
    const a = (Math.atan2(dy, dx) / (Math.PI * 2)) * 10;
    const edge = Math.abs(a - Math.round(a));
    if (edge < 0.06 || r < 0.08) return [...pith, 255];
    return [...(r > 0.5 ? flesh : seg), 255];
  }, { repeat: false });
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, index, group, rng, own, ownTex, toonTex, hw, center, extent, groundH, distToRoad, clearOfRoad, animators,
    scatter, sparkles,
  } = ctx;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const stream = def.scenery.riverLine || [];
  const nearStream = (x, z, m) => stream.length > 1 && distToPolyline(x, z, stream) < m;
  const site = volcanoSite(path, index, center, extent);
  const lemonTex = ownTex(lemonSliceTexture());

  buildSea();
  buildVolcano();
  buildStream();
  buildPalms();
  buildBeachProps();
  buildHibiscus();
  buildLemonadeGlass();
  buildFloaties();
  buildFizz();
  buildFarIslands();
  buildGeysers();
  sparkles(260, center.x, center.z, extent + 80, 0, 26, [0xffffff, 0xfff27a, 0xfffbe0], 1.3);

  // --------------------------------------------------------------------------

  function buildSea() {
    const sea = own(toon(0xffe46b, { unique: true, emissive: 0x6b5200, emissiveIntensity: 0.35 }));
    const m = new THREE.Mesh(new THREE.CircleGeometry(extent + 900, 64), sea);
    m.rotation.x = -Math.PI / 2;
    m.position.set(center.x, SEA_Y, center.z);
    group.add(m);
    animators.push((dt, t) => { sea.emissiveIntensity = 0.32 + Math.sin(t * 1.3) * 0.05; });
  }

  /** The friendly volcano: peach rock, a frosting-white top, a glowing lemonade crater. */
  function buildVolcano() {
    const R = Math.max(30, Math.min(140, site.room - (hw + FENCE_OFFSET + 5))); // its foot comes right up to the fence
    const H = R * 0.95;
    const { x, z } = site;
    const y0 = groundH(x, z) - 4;
    const body = lathe([[R, 0], [R * 0.86, H * 0.12], [R * 0.62, H * 0.38], [R * 0.42, H * 0.7], [R * 0.3, H * 0.94], [R * 0.27, H], [R * 0.2, H * 0.93]], 28);
    ctx.batch.add(body, toon(0xffa98a), mat4(x, y0, z));
    const cap = lathe([[R * 0.47, H * 0.64], [R * 0.42, H * 0.7], [R * 0.3, H * 0.94], [R * 0.27, H + 0.4], [R * 0.2, H * 0.93]], 28);
    ctx.batch.add(cap, toon(0xfff6ea), mat4(x, y0 + 0.3, z, { s: [1.03, 1, 1.03] }), false);
    // round frosting dollops piped along the edge of the white cap
    const dollops = [];
    for (let k = 0; k < 30; k++) {
      const a = (k / 30) * Math.PI * 2;
      dollops.push({ m: mat4(x + Math.cos(a) * R * 0.465, y0 + H * 0.645, z + Math.sin(a) * R * 0.465, { s: [R * 0.055, R * 0.045, R * 0.055] }) });
    }
    instanced(ctx, new THREE.SphereGeometry(1, 12, 8), toon(0xfff6ea), dollops, { outline: 0.06 });
    // glowing crater lake of lemonade
    const lakeMat = own(new THREE.MeshBasicMaterial({ color: 0xfff27a }));
    const lake = new THREE.Mesh(new THREE.CircleGeometry(R * 0.22, 28), lakeMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(x, y0 + H * 0.955, z);
    group.add(lake);
    animators.push((dt, t) => lakeMat.color.setHSL(0.14, 1, 0.68 + Math.sin(t * 2.2) * 0.06));
    // lemonade rivulets running down the flanks
    const flows = [];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.4;
      const pts = [];
      for (let u = 0; u <= 1.001; u += 0.1) {
        const rr = R * (0.27 + u * 0.7);
        const wig = Math.sin(u * 7 + k) * 0.08;
        pts.push(new THREE.Vector3(x + Math.cos(a + wig) * rr * 1.02, y0 + Math.max(0.5, profileY(rr)) + 0.6, z + Math.sin(a + wig) * rr * 1.02));
      }
      flows.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, R * 0.035, 6, false));
    }
    const flowMat = own(new THREE.MeshBasicMaterial({ color: 0xffe14f }));
    for (const g of flows) group.add(new THREE.Mesh(g, flowMat));
    animators.push((dt, t) => flowMat.color.setHSL(0.14, 1, 0.6 + Math.sin(t * 3) * 0.05));
    // a giant lemon slice leaning on the rim, like a cocktail garnish
    const sliceGeo = new THREE.CylinderGeometry(R * 0.2, R * 0.2, R * 0.03, 32);
    const sliceMat = toonTex(lemonTex, 0xffffff, { emissive: 0x332800, emissiveIntensity: 0.25 });
    const slice = new THREE.Mesh(sliceGeo, [toon(0xffd21f), sliceMat, sliceMat]);
    slice.position.set(x + R * 0.26, y0 + H + R * 0.12, z);
    slice.rotation.set(0.2, 0.3, Math.PI / 2 - 0.35);
    group.add(slice);
    // a sleepy, happy face turned towards the start line (it is the friendliest volcano)
    const toStart = path.pointAt(0);
    const fa = Math.atan2(toStart.x - x, toStart.z - z);
    const faceY = H * 0.46, faceR = R * 0.58;
    const onCone = (lat, up) => {
      const yy = faceY + up;
      const rr = faceR - up * ((R * 0.62 - R * 0.42) / (H * 0.32)) + 0.6;
      const a2 = fa + lat / faceR;
      return [x + Math.sin(a2) * rr, y0 + yy, z + Math.cos(a2) * rr, a2];
    };
    const ink = glow(0x5a2a3a);
    const arcGeo = new THREE.TorusGeometry(R * 0.07, R * 0.012, 6, 16, Math.PI);
    for (const side of [-1, 1]) {
      const [ex, ey, ez, ea] = onCone(side * R * 0.16, R * 0.1);
      ctx.batch.add(arcGeo, ink, mat4(ex, ey, ez, { ry: ea, rx: -0.45 }), false); // closed happy eye
      const [cx2, cy2, cz2, ca] = onCone(side * R * 0.26, -R * 0.02);
      ctx.batch.add(new THREE.CircleGeometry(R * 0.06, 16), glow(0xff8fa8), mat4(cx2, cy2, cz2, { ry: ca, rx: -0.45 }), false);
    }
    const [mx, my, mz, ma] = onCone(0, -R * 0.03);
    ctx.batch.add(new THREE.TorusGeometry(R * 0.11, R * 0.014, 6, 20, Math.PI), ink, mat4(mx, my, mz, { ry: ma, rx: -0.45, rz: Math.PI }), false);
    // happy puffs of fizz drifting up from the crater
    const puffs = [];
    for (let k = 0; k < 10; k++) puffs.push({ ph: k / 10, a: rng() * Math.PI * 2, r: R * 0.1 * rng(), s: R * (0.05 + rng() * 0.04) });
    animatedInstances(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff, { emissive: 0x777766, emissiveIntensity: 0.4 }), puffs, (p, t, o) => {
      const u = (t * 0.08 + p.ph) % 1;
      o.x = x + Math.cos(p.a + u * 2) * (p.r + u * R * 0.2);
      o.z = z + Math.sin(p.a + u * 2) * (p.r + u * R * 0.2);
      o.y = y0 + H + u * R * 0.9;
      const k = Math.sin(u * Math.PI) * (1 + u);
      o.sx = o.sy = o.sz = p.s * Math.max(0.05, k);
    });
    // profile height (for the rivulets) as a function of radius
    function profileY(rr) {
      const prof = [[R, 0], [R * 0.86, H * 0.12], [R * 0.62, H * 0.38], [R * 0.42, H * 0.7], [R * 0.3, H * 0.94], [R * 0.27, H]];
      for (let i = 0; i < prof.length - 1; i++) {
        const [r0, h0] = prof[i], [r1, h1] = prof[i + 1];
        if (rr <= r0 && rr >= r1) return h0 + ((r0 - rr) / (r0 - r1)) * (h1 - h0);
      }
      return rr > R ? 0 : H;
    }
  }

  /** The lemonade stream in its little gorge under the Lemon Bridge. */
  function buildStream() {
    if (stream.length < 2) return;
    const pos = [];
    for (let i = 0; i < stream.length - 1; i++) {
      const [ax, az] = stream[i], [bx, bz] = stream[i + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const ux = (-dz / len) * 7, uz = (dx / len) * 7;
      const y = -1.15;
      pos.push(ax - ux, y, az - uz, bx - ux, y, bz - uz, ax + ux, y, az + uz);
      pos.push(ax + ux, y, az + uz, bx - ux, y, bz - uz, bx + ux, y, bz + uz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mat = own(new THREE.MeshBasicMaterial({ color: 0xfff08a, side: THREE.DoubleSide }));
    group.add(new THREE.Mesh(g, mat));
    animators.push((dt, t) => mat.color.setHSL(0.14, 1, 0.72 + Math.sin(t * 2.6) * 0.04));
    // bubbles bobbing up along the stream
    const bubbles = [];
    for (let i = 0; i < stream.length; i += 2) {
      for (let k = 0; k < 2; k++) bubbles.push({ x: stream[i][0] + (rng() - 0.5) * 10, z: stream[i][1] + (rng() - 0.5) * 10, ph: rng(), s: 0.4 + rng() * 0.6 });
    }
    animatedInstances(ctx, new THREE.SphereGeometry(1, 10, 8), own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })), bubbles, (b, t, o) => {
      const u = (t * 0.5 + b.ph) % 1;
      o.x = b.x; o.z = b.z; o.y = -1.1 + u * 2.5;
      o.sx = o.sy = o.sz = b.s * (1 - u * 0.6);
    });
  }

  /** Lemon palms: curvy trunks, fronds, and a cluster of lemons. */
  function buildPalms() {
    const spots = scatter(90, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5) && isClearOfCamera(ctx, x, z, 3)
      && groundH(x, z) > SEA_Y + 0.4 && !nearStream(x, z, 12) && Math.hypot(x - site.x, z - site.z) > site.room * 0.6, { pad: 120 });
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.7, 1, 7, 4, true);
    const frondGeo = new THREE.SphereGeometry(1, 8, 4);
    frondGeo.scale(0.9, 0.12, 3.6);
    frondGeo.translate(0, 0, 3);
    const trunks = [], fronds = [], lemons = [];
    for (const [x, z] of spots) {
      const h = 7 + rng() * 6;
      const y = groundH(x, z);
      const lean = 0.08 + rng() * 0.2, ry = rng() * Math.PI * 2;
      trunks.push({ m: mat4(x, y + h / 2, z, { s: [1, h, 1], rz: lean, ry }) });
      const tx = x - Math.sin(lean) * h * Math.cos(ry), tz = z + Math.sin(lean) * h * Math.sin(ry);
      const c = pick([0x3fcf7a, 0x5fd88a, 0x2fb86a]);
      for (let k = 0; k < 7; k++) fronds.push({ m: mat4(tx, y + h, tz, { ry: (k / 7) * Math.PI * 2 + ry, rx: 0.3 + rng() * 0.3 }), c });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + rng();
        lemons.push({ m: mat4(tx + Math.cos(a) * 0.7, y + h - 0.7, tz + Math.sin(a) * 0.7, { s: [0.55, 0.45, 0.45], ry: a }) });
      }
    }
    instanced(ctx, trunkGeo, toon(0xd9a066), trunks, { outline: 0.08 });
    instanced(ctx, frondGeo, toon(0xffffff, { emissive: 0x0f3a14, emissiveIntensity: 0.25 }), fronds);
    instanced(ctx, new THREE.SphereGeometry(1, 10, 8), toon(0xffe14f, { emissive: 0x443300, emissiveIntensity: 0.3 }), lemons, { outline: 0.1 });
  }

  /** Low tropical bushes dotted with hibiscus flowers along the fences. */
  function buildHibiscus() {
    const spots = scatter(150, (x, z) => {
      const d = distToRoad(x, z, 50);
      return d > hw + FENCE_OFFSET + 1.8 && d < hw + 40 && groundH(x, z) > SEA_Y + 0.5 && !nearStream(x, z, 9);
    }, { pad: 50 });
    const bushes = [], flowers = [];
    for (const [x, z] of spots) {
      const s = 1.1 + rng() * 1.3;
      const y = groundH(x, z);
      bushes.push({ m: mat4(x, y + s * 0.4, z, { s: [s * 1.3, s * 0.9, s * 1.3], ry: rng() * 3 }), c: pick([0x3fcf7a, 0x5fd88a, 0x2fb86a]) });
      for (let k = 0; k < 2; k++) {
        const a = rng() * Math.PI * 2;
        flowers.push({ m: mat4(x + Math.cos(a) * s * 0.9, y + s * 0.8, z + Math.sin(a) * s * 0.9, { s: 0.45 }), c: pick([0xff5fa2, 0xff9f40, 0xffe14f, 0xff7ac8, 0xffffff]) });
      }
    }
    instanced(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff, { emissive: 0x0f3a14, emissiveIntensity: 0.25 }), bushes, { outline: 0.05 });
    instanced(ctx, new THREE.IcosahedronGeometry(1, 0), toon(0xffffff, { emissive: 0x442233, emissiveIntensity: 0.3 }), flowers);
  }

  /** Striped beach umbrellas, towels and sandcastle-ish sugar cubes on the sand. */
  function buildBeachProps() {
    const beach = scatter(34, (x, z) => {
      const g = groundH(x, z);
      return g > SEA_Y + 0.2 && g < 2.2 && clearOfRoad(x, z, FENCE_OFFSET + 4) && isClearOfCamera(ctx, x, z, 3.5) && !nearStream(x, z, 10);
    }, { pad: 140 });
    const pole = [], shade = [], towels = [];
    const shadeGeo = new THREE.ConeGeometry(3.2, 1.4, 10, 1, true);
    for (const [x, z] of beach) {
      const y = groundH(x, z);
      const tilt = (rng() - 0.5) * 0.3;
      pole.push({ m: mat4(x, y + 2, z, { s: [1, 4, 1], rz: tilt }) });
      shade.push({ m: mat4(x - Math.sin(tilt) * 4, y + 4.4, z, { rz: tilt }), c: pick([0xff6fae, 0x3fb8ff, 0xffe14f, 0x7ddc6a, 0xff9f40]) });
      const a = rng() * Math.PI;
      towels.push({ m: mat4(x + Math.cos(a) * 3, y + 0.06, z + Math.sin(a) * 3, { ry: a, s: [1.6, 1, 3] }), c: pick([0xff9ed2, 0x9fdcff, 0xfff27a, 0xc2f5b0]) });
    }
    instanced(ctx, new THREE.CylinderGeometry(0.1, 0.1, 1, 5), toon(0xffffff), pole);
    instanced(ctx, shadeGeo, toon(0xffffff, { side: THREE.DoubleSide }), shade, { outline: 0.06 });
    instanced(ctx, new THREE.BoxGeometry(1, 0.08, 1), toon(0xffffff), towels);
  }

  /** A giant glass of lemonade with a bendy straw beside the start straight. */
  function buildLemonadeGlass() {
    const s = def.scenery.glassAt * path.length;
    let spot = null;
    for (const side of [1, -1]) {
      for (let d = hw + FENCE_OFFSET + 16; d < hw + 70; d += 3) {
        const q = path.positionAt(s, side * d);
        if (clearOfRoad(q.x, q.z, FENCE_OFFSET + 12) && !nearStream(q.x, q.z, 20)) { spot = q; break; }
      }
      if (spot) break;
    }
    if (!spot) return;
    const { x, z } = spot;
    const y = groundH(x, z) - 0.3;
    const R = 7, H = 18;
    const glass = own(toon(0xe8fbff, { unique: true, transparent: true, opacity: 0.42, emissive: 0x335566, emissiveIntensity: 0.2 }));
    glass.depthWrite = false;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.85, H, 28, 1, true), glass);
    cup.position.set(x, y + H / 2, z);
    cup.renderOrder = 2;
    group.add(cup);
    const juice = own(toon(0xffe45c, { unique: true, emissive: 0x665000, emissiveIntensity: 0.35 }));
    ctx.batch.add(new THREE.CylinderGeometry(R * 0.93, R * 0.8, H * 0.74, 24), juice, mat4(x, y + H * 0.37 + 0.2, z), false);
    ctx.batch.add(new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.6, 24), toon(0xffffff), mat4(x, y + 0.3, z), false);
    // ice cubes bobbing in the lemonade
    const cubes = [0, 1, 2, 3].map((k) => ({ a: (k / 4) * Math.PI * 2, ph: rng() * 6 }));
    animatedInstances(ctx, new THREE.BoxGeometry(2.6, 2.6, 2.6), own(new THREE.MeshBasicMaterial({ color: 0xf2feff, transparent: true, opacity: 0.8 })), cubes, (c, t, o) => {
      o.x = x + Math.cos(c.a + t * 0.2) * R * 0.45; o.z = z + Math.sin(c.a + t * 0.2) * R * 0.45;
      o.y = y + H * 0.74 + Math.sin(t * 1.5 + c.ph) * 0.3;
      o.ry = c.ph + t * 0.3; o.rx = 0.3;
    });
    // bendy striped straw
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x + 2, y + 4, z), new THREE.Vector3(x + 2.6, y + H + 4, z),
      new THREE.Vector3(x + 3.4, y + H + 7, z), new THREE.Vector3(x + 6.5, y + H + 8, z),
    ]);
    const straw = new THREE.TubeGeometry(curve, 24, 0.7, 8, false);
    ctx.batch.add(straw, toon(0xff6fae), mat4(0, 0, 0));
    // lemon slice on the rim
    const slice = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.7, 28), [toon(0xffd21f), toonTex(lemonTex), toonTex(lemonTex)]);
    slice.position.set(x - R + 0.6, y + H + 0.4, z);
    slice.rotation.set(0, 0, Math.PI / 2 - 0.2);
    group.add(slice);
  }

  /** Lemon-slice floaties and rubber rings bobbing on the lemonade sea. */
  function buildFloaties() {
    const items = [];
    for (let k = 0; k < 40; k++) {
      const a = rng() * Math.PI * 2, r = extent + 60 + rng() * 260;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (groundH(x, z) > SEA_Y - 0.3) continue;
      items.push({ x, z, ph: rng() * 6, s: 2 + rng() * 2.5, ring: rng() < 0.4, c: pick([0xff6fae, 0x3fb8ff, 0x7ddc6a, 0xffffff]) });
    }
    const slices = items.filter((i) => !i.ring);
    const rings = items.filter((i) => i.ring);
    const pose = (it, t, o) => {
      o.x = it.x + Math.sin(t * 0.3 + it.ph) * 2; o.z = it.z + Math.cos(t * 0.25 + it.ph) * 2;
      o.y = SEA_Y + 0.25 + Math.sin(t * 1.4 + it.ph) * 0.25;
      o.rx = Math.sin(t * 1.1 + it.ph) * 0.08; o.rz = Math.cos(t * 1.3 + it.ph) * 0.08; o.ry = it.ph + t * 0.1;
      o.sx = o.sy = o.sz = it.s;
    };
    const sliceGeo = new THREE.CylinderGeometry(1, 1, 0.22, 24);
    const sliceMat = toonTex(lemonTex);
    const sliceMesh = animatedInstances(ctx, sliceGeo, sliceMat, slices, pose);
    if (sliceMesh) sliceMesh.material = [toon(0xffd21f), sliceMat, sliceMat];
    const ringGeo = new THREE.TorusGeometry(0.8, 0.35, 8, 20);
    ringGeo.rotateX(Math.PI / 2);
    animatedInstances(ctx, ringGeo, toon(0xffffff), rings, pose, { outline: 0.06 });
  }

  /** Fizzy bubbles rising out of the sea all around the island. */
  function buildFizz() {
    const bubbles = [];
    for (let k = 0; k < 160; k++) {
      const a = rng() * Math.PI * 2, r = extent + 40 + rng() * 300;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (groundH(x, z) > SEA_Y - 0.2) continue;
      bubbles.push({ x, z, ph: rng(), sp: 0.25 + rng() * 0.3, s: 0.5 + rng() * 1.1 });
    }
    animatedInstances(ctx, new THREE.SphereGeometry(1, 8, 6), own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })), bubbles, (b, t, o) => {
      const u = (t * b.sp + b.ph) % 1;
      o.x = b.x + Math.sin(u * 9 + b.ph * 6) * 0.6; o.z = b.z;
      o.y = SEA_Y + u * 5;
      o.sx = o.sy = o.sz = b.s * (u < 0.85 ? 1 : 1 + (u - 0.85) * 4) * (u > 0.97 ? 0.01 : 1);
    });
  }

  /** Lemonade geysers beside Fizz Ridge that burst up in turn: whoosh! */
  function buildGeysers() {
    const [f0, f1] = def.scenery.geysers;
    const spots = [];
    let s0 = f0 * path.length, s1 = f1 * path.length;
    if (s1 < s0) s1 += path.length;
    for (let s = s0 + 20, k = 0; s < s1; s += 55, k++) {
      const side = k % 2 ? 1 : -1;
      const q = path.positionAt(s, side * (hw + FENCE_OFFSET + 9));
      if (!clearOfRoad(q.x, q.z, FENCE_OFFSET + 6) || nearStream(q.x, q.z, 10)) continue;
      spots.push({ x: q.x, z: q.z, y: groundH(q.x, q.z), ph: k * 0.37 });
    }
    const burst = (g, t) => {
      const u = (t * 0.28 + g.ph) % 1; // quiet, then a quick happy spurt
      return u < 0.7 ? 0.08 : Math.sin(((u - 0.7) / 0.3) * Math.PI);
    };
    // sugar-rock rim + a fizzy column + sparkly droplets
    instanced(ctx, new THREE.TorusGeometry(2.2, 0.8, 6, 14), toon(0xfff6ea), spots.map((g) => ({ m: mat4(g.x, g.y + 0.3, g.z, { rx: Math.PI / 2 }) })), { outline: 0.06 });
    const colGeo = new THREE.CylinderGeometry(1.1, 1.6, 1, 10, 1, true);
    colGeo.translate(0, 0.5, 0);
    animatedInstances(ctx, colGeo, own(new THREE.MeshBasicMaterial({ color: 0xfff08a, transparent: true, opacity: 0.85 })), spots, (g, t, o) => {
      const b = burst(g, t);
      o.x = g.x; o.y = g.y; o.z = g.z;
      o.sy = 0.3 + b * 16; o.sx = o.sz = 0.8 + b * 0.4; o.ry = t;
    });
    const drops = spots.flatMap((g) => [0, 1, 2, 3, 4, 5].map((k) => ({ g, a: (k / 6) * Math.PI * 2, ph: rng() })));
    animatedInstances(ctx, new THREE.SphereGeometry(0.7, 8, 6), own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })), drops, (d, t, o) => {
      const b = burst(d.g, t);
      const r = 1.5 + b * 3.5;
      o.x = d.g.x + Math.cos(d.a + t) * r; o.z = d.g.z + Math.sin(d.a + t) * r;
      o.y = d.g.y + 0.5 + b * (12 + Math.sin(d.a * 3) * 3);
      o.sx = o.sy = o.sz = 0.3 + b;
    });
  }

  /** Little palm islets and sugar-rock stacks out at sea. */
  function buildFarIslands() {
    const isl = farRing(ctx, 9, extent + 230, extent + 330);
    const dome = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    instanced(ctx, dome, toon(0xfff1dc), isl.map(([x, z]) => {
      const r = 18 + rng() * 22;
      return { m: mat4(x, SEA_Y - 0.5, z, { s: [r, r * 0.25, r * 0.8], ry: rng() * 3 }) };
    }));
    const trunks = [], fronds = [];
    const frondGeo = new THREE.SphereGeometry(1, 6, 3);
    frondGeo.scale(1.4, 0.2, 5);
    frondGeo.translate(0, 0, 4);
    for (const [x, z] of isl) {
      for (let k = 0; k < 2; k++) {
        const px = x + (rng() - 0.5) * 12, pz = z + (rng() - 0.5) * 12;
        const h = 12 + rng() * 8;
        trunks.push({ m: mat4(px, SEA_Y + h / 2, pz, { s: [1.4, h, 1.4], rz: (rng() - 0.5) * 0.3 }) });
        for (let f = 0; f < 6; f++) fronds.push({ m: mat4(px, SEA_Y + h, pz, { ry: (f / 6) * Math.PI * 2, rx: 0.4 }) });
      }
    }
    instanced(ctx, new THREE.CylinderGeometry(0.5, 0.8, 1, 6, 1, true), toon(0xd9a066), trunks);
    instanced(ctx, frondGeo, toon(0x3fcf7a), fronds);
  }
}

/** Road details: a sparkly lemon-yellow centre line of little dashes. */
export function buildRoadDetails(ctx) {
  const { path, group, own } = ctx;
  const geos = [];
  const fr = [];
  for (let s = 0; s < path.length - 4; s += 7) {
    const a = path.pointAt(s), b = path.pointAt(s + 3.2);
    const ta = path.tangentAt(s), tb = path.tangentAt(s + 3.2);
    fr.length = 0;
    fr.push({ s, x: a.x, y: a.y, z: a.z, tx: ta.x, tz: ta.z, rx: -ta.z, rz: ta.x });
    fr.push({ s: s + 3.2, x: b.x, y: b.y, z: b.z, tx: tb.x, tz: tb.z, rx: -tb.z, rz: tb.x });
    geos.push(ribbon(fr, -0.35, 0.35, 0.04));
  }
  if (!geos.length) return;
  const merged = new THREE.BufferGeometry();
  const pos = [];
  for (const g of geos) { pos.push(...g.attributes.position.array); g.dispose(); }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  group.add(new THREE.Mesh(merged, own(new THREE.MeshBasicMaterial({ color: 0xfff27a }))));
}

export default { def, buildScenery, prepare, buildRoadDetails };
