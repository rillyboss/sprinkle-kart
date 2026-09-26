/**
 * Pillow Fort Dreamland — track module (data + scenery). Cup: cozy-cup.
 * OWNER: Tracks — Cozy Cup.
 *
 * A giant cosy bedroom at bedtime. The road is a stitched pajama ribbon that
 * puffs round the edge of a cloud (look at the minimap!), up and over rolling
 * blanket hills, through a pillow-fort tunnel strung with fairy lights, past
 * counting sheep hopping their fence, under a sleepy crescent-moon night-light,
 * with storybook towers, bunny slippers and glowing mushroom lamps all around.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, frames, mat4, pushedCopy, dataTexture, smoothstep } from './sceneryKit.js';
import { instanced, faceRoad, twinkleLights, roadStitches } from './props/cozy-kit.js';

export const def = makeTrack(
  {
    id: 'pillow-fort',
    name: 'Pillow Fort Dreamland',
    subtitle: 'Blanket hills, counting sheep and a pillow-fort tunnel',
    laps: 3,
    width: 19,
    previewColor: 0x8a6adf,
    art: ['🌙', '🐑', '⭐'], // menu card emoji: big, bottom-left, top-right
    cup: 'cozy-cup',
    unlock: { type: 'stat', stat: 'racesFinished', count: 6 },
    theme: {
      skyTop: 0x140c40,
      skyBottom: 0x3d2c86,
      fogColor: 0x2c2468,
      fogNear: 170,
      fogFar: 690,
      ground: 0x6f5fd0, // a big quilted blanket
      road: 0x9f86f2, // pajama-ribbon road
      roadAlt: 0x8e74e4,
      curbA: 0xffb3de,
      curbB: 0xfff6ff,
      offRoad: 0x8373e0,
      music: 'pillow-fort',
      sunColor: 0xc6ccff,
      ambientColor: 0x8a80ff,
      // builder theme extras (see ARCHITECTURE.md -> theme fields)
      night: true,
      skyStars: true,
      roadSprinkles: { style: 'stars', count: 210, palette: [0xfff6a8, 0xffffff, 0xffc2f0, 0xa8e6ff] },
      groundTints: [0x8a6ae0, 0x5a78d8, 0xb07ad8],
      groundTintMix: 0.7,
      skirt: { color: 0x6a5acd, trim: 0xffb3de },
      pillar: { shape: 'round', color: 0xfff6ff, ring: 0xffb3de },
      startLineDark: 0x3a2a86,
    },
  },
  {
    start: [0, 0],
    heading: 0,
    y0: 1,
    startAt: 54,
    ops: [
      { s: 120, flex: true, y: 1, mark: 'start-straight' },
      { turn: 115, r: 50, y: 3, mark: 'puff-1' },
      { turn: -50, r: 36, y: 4, mark: 'dip-1' },
      { s: 60, flex: true, y: 6, mark: 'pillow-tunnel' },
      { turn: 110, r: 60, y: 9, mark: 'puff-2' },
      { turn: -55, r: 36, y: 10, mark: 'dip-2' },
      { turn: 120, r: 66, y: 12, mark: 'puff-3' },
      { turn: -55, r: 36, y: 11, mark: 'dip-3' },
      { s: 70, y: 7, hump: 1.8, mark: 'blanket-roll' },
      { turn: 110, r: 60, y: 4, mark: 'puff-4' },
      { turn: -50, r: 36, y: 3, mark: 'dip-4' },
      { s: 70, y: 2, mark: 'sheep-meadow' },
      { turn: 115, r: 50, y: 1, mark: 'puff-5' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [
      frac('puff-1', 'end'),
      frac('puff-2', 'end'),
      frac('puff-3', 'end'),
      frac('blanket-roll', 'end'),
      frac('sheep-meadow', 'mid'),
    ],
    boostPads: [
      { at: frac('start-straight', 'end') - 0.02, lateral: 0 },
      { at: frac('pillow-tunnel', 'mid'), lateral: 0 }, // zoom through the fort!
      { at: frac('puff-3', 'mid'), lateral: -1.5 },
      { at: frac('blanket-roll', 'mid'), lateral: 1.5 },
      { at: frac('puff-5', 'mid'), lateral: 0 },
    ],
    scenery: {
      kind: 'pillow-fort',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 9, scale: 0.014 },
      tunnel: [frac('pillow-tunnel', 'start') - 0.004, frac('pillow-tunnel', 'end') + 0.004],
      meadow: frac('sheep-meadow', 'mid'),
      fence: { post: 0xfff6a8, postAlt: 0xffc2f0, rail: 0xffd6f5, topper: 'star', topperColor: 0xfff27a, glow: true },
      arch: { a: 0xb48cff, b: 0xfff6a8, banner: 0x6a4cff, text: 'SWEET DREAMS' },
    },
  }),
);

const PASTEL = [0xffc2e8, 0xb8e6ff, 0xfff0a8, 0xc9f2d2, 0xe2c6ff, 0xffd6b8];
const LAMP = [0xff9ef0, 0x9fe8ff, 0xfff06a, 0xb8a8ff];

/** Crescent-moon outline (tips to the right), about 2 units tall. */
export function crescentShape() {
  const s = new THREE.Shape();
  const a0 = (40 * Math.PI) / 180;
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((2 * Math.PI - 2 * a0) * i) / n;
    const x = Math.cos(a), y = Math.sin(a);
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  const cx = 0.45, r = Math.hypot(Math.cos(a0) - cx, Math.sin(a0));
  const b0 = Math.atan2(-Math.sin(a0), Math.cos(a0) - cx);
  for (let i = 1; i < n; i++) {
    const b = b0 - ((2 * Math.PI + 2 * b0) * i) / n;
    s.lineTo(cx + Math.cos(b) * r, Math.sin(b) * r);
  }
  s.closePath();
  return s;
}

/** "Z" outline for the floating snoozes. */
function zShape() {
  const pts = [[-0.5, 0.5], [0.5, 0.5], [0.5, 0.32], [-0.18, -0.32], [0.5, -0.32], [0.5, -0.5], [-0.5, -0.5], [-0.5, -0.32], [0.18, 0.32], [-0.5, 0.32]];
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md -> "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, ownTex, outlineMat, toonVC,
    hw, L, center, extent, groundH, distToRoad, clearOfRoad, animate,
    scatter, floatingShapes, sparkles, backgroundHills,
  } = ctx;
  const sc = def.scenery;
  const col = new THREE.Color();
  const bulbs = [];

  buildPillowFort();
  buildMoonLamp();
  buildCountingSheep();
  buildPillows();
  buildStorybooks();
  buildMushroomLamps();
  buildSlippers();
  twinkleLights(ctx, bulbs, [0xfff6a8, 0xffb3de, 0xa8e6ff, 0xc9f2d2], { size: 0.3, speed: 1.8 });
  buildDreamSky();

  // ----- the pillow-fort tunnel ----------------------------------------------------------
  function buildPillowFort() {
    const [a, b] = sc.tunnel;
    const fr = frames(path, a * L, b * L, 1.5);
    const span = hw + FENCE_OFFSET + 2.2;
    // pillow walls, stacked three high on both sides
    const pillows = [];
    let k = 0;
    for (let i = 0; i < fr.length; i += 3) {
      const f = fr[i];
      const hdg = Math.atan2(f.tx, f.tz);
      for (const side of [-1, 1]) {
        for (let lvl = 0; lvl < 3; lvl++) {
          const lat = side * (span + 0.6 - lvl * 0.35);
          const x = f.x + f.rx * lat, z = f.z + f.rz * lat;
          const gy = Math.min(groundH(x, z), f.y - 0.6);
          pillows.push({ m: mat4(x, gy + 1.1 + lvl * 2.05, z, { ry: hdg + (rng() - 0.5) * 0.25, rz: (rng() - 0.5) * 0.12, s: [1.8, 1.15, 2.6] }), color: PASTEL[k++ % PASTEL.length] });
        }
      }
    }
    instanced(ctx, new THREE.SphereGeometry(1, 16, 10), toon(0xffffff, { emissive: 0x5a4a8a, emissiveIntensity: 0.5 }), pillows, { name: 'fort-pillows', ow: 0.05 });
    // the blanket roof: a soft arch with stripes, draped over the pillow walls
    const nU = 14;
    const pos = [], colr = [], idx = [];
    const stripe = [new THREE.Color(0xff9ecf), new THREE.Color(0xfff0f8), new THREE.Color(0x9fd8ff)];
    fr.forEach((f, i) => {
      const edge = Math.min(i, fr.length - 1 - i);
      const droop = (1 - smoothstep(0, 4, edge)) * 1.2;
      const c = stripe[Math.floor(f.s / 4) % 3];
      for (let u = 0; u <= nU; u++) {
        const t = u / nU;
        const lat = -span - 0.8 + (2 * span + 1.6) * t;
        const yy = f.y + 6.6 + Math.sin(Math.PI * t) * 4.6 - droop + Math.sin(f.s * 0.5 + t * 6) * 0.12;
        pos.push(f.x + f.rx * lat, yy, f.z + f.rz * lat);
        colr.push(c.r, c.g, c.b);
      }
      if (i > 0) {
        const r0 = (i - 1) * (nU + 1), r1 = i * (nU + 1);
        for (let u = 0; u < nU; u++) idx.push(r0 + u, r1 + u, r0 + u + 1, r0 + u + 1, r1 + u, r1 + u + 1);
      }
      if (i % 2 === 0) for (const t of [0.22, 0.5, 0.78]) {
        const lat = -span + 2 * span * t;
        bulbs.push([f.x + f.rx * lat, f.y + 6.1 + Math.sin(Math.PI * t) * 4.4, f.z + f.rz * lat]);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const blanket = new THREE.Mesh(g, toonVC({ side: THREE.DoubleSide, emissive: 0x201a40, emissiveIntensity: 0.4 }));
    blanket.name = 'fort-blanket';
    group.add(blanket);
    // a little pennant on top of the fort
    const mid = fr[Math.floor(fr.length / 2)];
    batch.add(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), toon(0xfff6a8), mat4(mid.x, mid.y + 13.5, mid.z), false);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 3), toon(0xff9ecf));
    flag.rotation.z = -Math.PI / 2;
    flag.position.set(mid.x + 1.2, mid.y + 15.4, mid.z);
    group.add(flag);
    animate((dt, t) => { flag.rotation.x = Math.sin(t * 3) * 0.3; });
  }

  // ----- the sleepy crescent-moon night-light ---------------------------------------------------
  function buildMoonLamp() {
    const [cx, cz] = def.scenery.center || [center.x, center.z];
    let x = cx, z = cz;
    if (!clearOfRoad(x, z, FENCE_OFFSET + 22)) {
      const alt = scatter(1, (xx, zz) => clearOfRoad(xx, zz, FENCE_OFFSET + 22) && Math.hypot(xx - cx, zz - cz) < 90, { pad: 0 })[0];
      if (!alt) return;
      [x, z] = alt;
    }
    const baseY = Math.max(groundH(x, z), 0) + 40;
    const moon = new THREE.Group();
    moon.name = 'moon-night-light';
    moon.position.set(x, baseY, z);
    group.add(moon);
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(crescentShape(), { depth: 0.35, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2, curveSegments: 12 }), glow(0xfff1b0));
    body.geometry.translate(0, 0, -0.2);
    moon.add(body);
    // a sleepy face: closed eye, smile, rosy cheek, and a striped nightcap on the top tip
    const face = new THREE.Group();
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 5, 12, Math.PI), toon(0x3a2046));
    eye.position.set(-0.66, 0.2, 0.3);
    eye.rotation.z = Math.PI;
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 5, 12, Math.PI), toon(0x3a2046));
    smile.position.set(-0.6, -0.14, 0.3);
    smile.rotation.z = Math.PI;
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 6), toon(0xff9ecf));
    cheek.position.set(-0.52, 0.02, 0.28);
    cheek.scale.z = 0.3;
    face.add(eye, smile, cheek);
    moon.add(face);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 12), toon(0x6a4cff));
    cap.position.set(0.88, 0.95, 0);
    cap.rotation.z = -0.9;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), toon(0xffffff));
    pom.position.set(1.28, 1.2, 0);
    moon.add(cap, pom);
    moon.scale.setScalar(21);
    moon.rotation.y = faceRoad(ctx, x, z);
    // soft halo
    const haloTex = ownTex(dataTexture(64, (px, py) => {
      const d = Math.hypot(px - 31.5, py - 31.5) / 32;
      const a = Math.max(0, 1 - d) ** 2;
      return [255, 244, 200, Math.round(a * 180)];
    }, { repeat: false }));
    const halo = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, fog: false })));
    halo.scale.set(100, 100, 1);
    halo.position.set(x, baseY, z);
    group.add(halo);
    // a ribbon string up to the sky so it looks hung like a mobile
    batch.add(new THREE.CylinderGeometry(0.12, 0.12, 60, 5), glow(0xd9ccff), mat4(x, baseY + 52, z), false);
    animate((dt, t) => {
      moon.position.y = baseY + Math.sin(t * 0.6) * 1.5;
      moon.rotation.z = Math.sin(t * 0.4) * 0.08;
      halo.material.opacity = 0.85 + Math.sin(t * 1.3) * 0.15;
    });
  }

  // ----- counting sheep hopping over a fence --------------------------------------------------------
  function buildCountingSheep() {
    const s = sc.meadow * L;
    let side = 0, p0 = null;
    for (const sd of [1, -1]) {
      const p = path.positionAt(s, sd * (hw + FENCE_OFFSET + 16));
      if (clearOfRoad(p.x, p.z, FENCE_OFFSET + 9)) { side = sd; p0 = p; break; }
    }
    const t = path.tangentAt(s);
    const fluff = [];
    for (const [dx, dy, dz, r] of [[0, 0, 0, 1], [0.6, 0.15, 0.3, 0.75], [-0.6, 0.15, -0.3, 0.75], [0.1, 0.45, -0.5, 0.7], [-0.1, 0.4, 0.55, 0.7], [0, 0.55, 0, 0.72]]) {
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.translate(dx, dy, dz);
      fluff.push(g);
    }
    const fluffGeo = mergeGeometries(fluff);
    fluffGeo.scale(1, 0.85, 1.25);
    const sheep = [];
    const jumpers = p0 ? 5 : 0;
    for (let i = 0; i < jumpers; i++) sheep.push({ jump: true, ph: i / jumpers });
    // sleepy sheep napping in the blanket fields
    for (const [x, z] of scatter(14, (xx, zz) => clearOfRoad(xx, zz, FENCE_OFFSET + 5) && distToRoad(xx, zz, 90) < hw + 60, { pad: 50 })) {
      sheep.push({ jump: false, x, z, y: groundH(x, z), h: rng() * 6 });
    }
    if (!sheep.length) return;
    const n = sheep.length;
    const body = new THREE.InstancedMesh(fluffGeo, toon(0xffffff, { emissive: 0x6a5aa8, emissiveIntensity: 0.6 }), n);
    const bodyOut = new THREE.InstancedMesh(pushedCopy(fluffGeo, 0.07), outlineMat, n);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 8), toon(0xc9bff0), n);
    const eyes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 6, 4), toon(0x2a2040), n * 2);
    const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 6), toon(0x9a8ad0), n * 4);
    body.name = 'sheep';
    group.add(body, bodyOut, head, eyes, legs);
    if (p0) {
      // the fence they hop over
      const fx = p0.x, fz = p0.z, fy = groundH(fx, fz);
      const hdg = Math.atan2(t.x, t.z) + Math.PI / 2;
      for (const d of [-2.2, 2.2]) batch.add(new THREE.BoxGeometry(0.4, 2.2, 0.4), toon(0xfff6a8), mat4(fx + Math.sin(hdg + Math.PI / 2) * d, fy + 1.1, fz + Math.cos(hdg + Math.PI / 2) * d), false);
      for (const yy of [0.8, 1.6]) batch.add(new THREE.BoxGeometry(5, 0.3, 0.25), toon(0xffc2e8), mat4(fx, fy + yy, fz, { ry: hdg + Math.PI / 2 }), false);
    }
    const tmp = new THREE.Matrix4();
    const write = (time) => {
      sheep.forEach((sh, i) => {
        let x, y, z, h, hop = 0, sc2 = 1;
        if (sh.jump) {
          const f = (time * 0.12 + sh.ph) % 1;
          const d = (f - 0.5) * 34; // along the road, the fence at d = 0
          x = p0.x + t.x * d; z = p0.z + t.z * d;
          const j = Math.max(0, 1 - Math.abs(d) / 4.5);
          hop = Math.sin(j * Math.PI / 2) ** 2 * 3.4;
          y = groundH(x, z) + hop;
          h = Math.atan2(t.x, t.z);
          sc2 = smoothstep(0, 0.08, f) * (1 - smoothstep(0.92, 1, f));
        } else {
          x = sh.x; z = sh.z; h = sh.h; y = sh.y - 0.5 + Math.sin(time * 1.2 + i) * 0.05;
        }
        const base = mat4(x, y + 1.25, z, { ry: h, s: 1.3 * Math.max(0.001, sc2) });
        body.setMatrixAt(i, base);
        bodyOut.setMatrixAt(i, base);
        head.setMatrixAt(i, tmp.multiplyMatrices(base, mat4(0, 0.35, 1.35, { s: [1, 1, 1.15] })));
        eyes.setMatrixAt(i * 2, tmp.multiplyMatrices(base, mat4(-0.2, 0.5, 1.8)));
        eyes.setMatrixAt(i * 2 + 1, tmp.multiplyMatrices(base, mat4(0.2, 0.5, 1.8)));
        const tuck = hop > 0.2 ? 0.9 : sh.jump ? Math.sin(time * 9 + i) * 0.4 : 1.4;
        let q = 0;
        for (const lx of [-0.45, 0.45]) for (const lz of [-0.7, 0.7]) {
          legs.setMatrixAt(i * 4 + q++, tmp.multiplyMatrices(base, mat4(lx, -0.85, lz, { rx: sh.jump ? tuck * Math.sign(lz) * 0.6 : Math.PI / 2 * 0.9 })));
        }
      });
      for (const m of [body, bodyOut, head, eyes, legs]) m.instanceMatrix.needsUpdate = true;
    };
    write(0);
    animate((dt, time) => write(time));
  }

  // ----- giant pillows lounging on the blanket hills ----------------------------------------------
  function buildPillows() {
    const items = [], buttons = [];
    for (const [x, z] of scatter(40, (xx, zz) => clearOfRoad(xx, zz, FENCE_OFFSET + 10), { pad: 110 })) {
      const s = 2.5 + rng() * 2.5;
      const y = groundH(x, z);
      const m = mat4(x, y + s * 0.5, z, { ry: rng() * 6, rz: (rng() - 0.5) * 0.3, s: [s * 1.5, s * 0.6, s] });
      items.push({ m, color: PASTEL[items.length % PASTEL.length] });
      buttons.push(new THREE.Matrix4().multiplyMatrices(m, mat4(0, 0.92, 0, { s: [0.12, 0.12, 0.18] })));
    }
    instanced(ctx, new THREE.SphereGeometry(1, 16, 10), toon(0xffffff, { emissive: 0x5a4a8a, emissiveIntensity: 0.55 }), items, { name: 'pillows', ow: 0.05 });
    instanced(ctx, new THREE.SphereGeometry(1, 8, 6), toon(0xfff6a8), buttons, { outline: false, name: 'pillow-buttons' });
  }

  // ----- storybook towers on the horizon ------------------------------------------------------------
  function buildStorybooks() {
    const covers = [], pages = [];
    const coverColors = [0xff7ab8, 0x6ac8ff, 0xffd84d, 0x7ce0a0, 0xb48cff, 0xff9f6a];
    const stacks = 9;
    for (let k = 0; k < stacks; k++) {
      const a = (k / stacks) * Math.PI * 2 + rng() * 0.4;
      const r = extent + 70 + rng() * 60;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      let y = Math.max(-3, groundH(x, z) - 0.5);
      const books = 3 + Math.floor(rng() * 4);
      for (let b = 0; b < books; b++) {
        const w = 22 - b * 1.5 + rng() * 3, d = 16 - b + rng() * 2, h = 4 + rng() * 2.5;
        const ry = rng() * 0.6 - 0.3 + a;
        covers.push({ m: mat4(x, y + h / 2, z, { ry, s: [w, h, d] }), color: coverColors[(k + b) % coverColors.length] });
        pages.push(mat4(x + Math.cos(ry) * 0.6, y + h / 2, z - Math.sin(ry) * 0.6, { ry, s: [w - 0.6, h * 0.8, d + 0.4] }));
        y += h;
      }
    }
    instanced(ctx, new THREE.BoxGeometry(1, 1, 1), toon(0xffffff, { emissive: 0x201840, emissiveIntensity: 0.4 }), covers, { name: 'storybooks', ow: 0.012 });
    instanced(ctx, new THREE.BoxGeometry(1, 1, 1), toon(0xfff6e0, { emissive: 0x302a40, emissiveIntensity: 0.3 }), pages, { outline: false, name: 'storybook-pages' });
  }

  // ----- glowing mushroom night-lights beside the road --------------------------------------------
  function buildMushroomLamps() {
    const spots = scatter(46, (x, z) => {
      const d = distToRoad(x, z, 30);
      return d > hw + FENCE_OFFSET + 2 && d < hw + FENCE_OFFSET + 12;
    }, { pad: 30 });
    const stems = [], caps = [];
    for (const [x, z] of spots) {
      const y = groundH(x, z);
      const s = 1 + rng() * 0.8;
      stems.push(mat4(x, y + 0.8 * s, z, { s: [s, s, s] }));
      caps.push([x, y + 1.6 * s, z, s]);
    }
    instanced(ctx, new THREE.CylinderGeometry(0.35, 0.5, 1.6, 8), toon(0xfff6ff, { emissive: 0x403a60, emissiveIntensity: 0.5 }), stems, { outline: false, name: 'mushroom-stems' });
    const capGeo = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.scale(1.4, 1.1, 1.4);
    // scale per lamp baked into the spots by twinkleLights' size, so group them by size bands
    for (const band of [[1, 1.4], [1.4, 1.81]]) {
      const inBand = caps.filter((c) => c[3] >= band[0] && c[3] < band[1]);
      twinkleLights(ctx, inBand, LAMP, { geo: capGeo, size: (band[0] + band[1]) / 2, speed: 1.2 });
    }
  }

  // ----- giant bunny slippers by the start ------------------------------------------------------------
  function buildSlippers() {
    const s = L - 44;
    let k = 0;
    for (const side of [1, -1]) {
      const p = path.positionAt(s + side * 8, side * (hw + FENCE_OFFSET + 11));
      if (!clearOfRoad(p.x, p.z, FENCE_OFFSET + 6.5)) continue;
      const y = groundH(p.x, p.z);
      const h = path.headingAt(s) + side * 0.5;
      const c = Math.cos(h), sn = Math.sin(h);
      const at = (dx, dy, dz, o = {}) => mat4(p.x + dx * c + dz * sn, y + dy, p.z - dx * sn + dz * c, { ...o, ry: h + (o.ry || 0) });
      const pink = toon(k ? 0xb8e6ff : 0xffc2e8);
      batch.add(new THREE.SphereGeometry(1, 20, 12), pink, at(0, 1.3, 0, { s: [2.6, 1.5, 4.4] }));
      batch.add(new THREE.CircleGeometry(1, 16), toon(0x6a4c9a), at(0, 2.75, -1.4, { rx: -Math.PI / 2, s: [1.7, 2.2, 1] }), false);
      batch.add(new THREE.SphereGeometry(1, 14, 10), pink, at(0, 2.3, 2.6, { s: 1.5 }));
      for (const dx of [-0.7, 0.7]) {
        batch.add(new THREE.CapsuleGeometry(0.45, 2.6, 4, 8), pink, at(dx, 4.6, 2.3, { rz: dx * 0.35, rx: -0.2 }));
        batch.add(new THREE.SphereGeometry(0.18, 8, 6), toon(0x2a2040), at(dx * 0.75, 2.7, 3.95), false);
      }
      batch.add(new THREE.SphereGeometry(0.28, 8, 6), toon(0xff7ab8), at(0, 2.3, 4.1), false);
      k++;
    }
  }

  // ----- floating Zzz's, glow stars, dream clouds, sparkles ------------------------------------------
  function buildDreamSky() {
    backgroundHills(20, extent + 240, extent + 420, [0x5a4ab8, 0x7a5ad0, 0x4a5ab8, 0x8a6ad8], { hMin: 30, hMax: 70 });
    floatingShapes(new THREE.ExtrudeGeometry(zShape(), { depth: 0.18, bevelEnabled: false }).center(), scatter(26, () => true, { pad: 10 }), [0xfff6a8, 0xffc2f0, 0xa8e6ff], { yMin: 9, yMax: 24, scale: [1.2, 2.4], glowy: true });
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.42 : 1, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    floatingShapes(new THREE.ExtrudeGeometry(star, { depth: 0.2, bevelEnabled: false }).center(), scatter(22, () => true, { pad: 20 }), [0xfff27a, 0xffffff], { yMin: 16, yMax: 34, scale: [1.2, 2.2], glowy: true });
    // soft dream clouds drifting low over the hills
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const puffs = [];
    for (let c = 0; c < 14; c++) {
      const a = rng() * Math.PI * 2, r = extent * 0.5 + rng() * (extent + 80);
      const cx = center.x + Math.cos(a) * r, cz = center.z + Math.sin(a) * r;
      if (!clearOfRoad(cx, cz, FENCE_OFFSET + 14)) continue;
      const cy = Math.max(groundH(cx, cz), 0) + 18 + rng() * 14;
      const size = 4 + rng() * 3;
      for (let p = 0; p < 5; p++) {
        puffs.push({ m: mat4(cx + (p - 2) * size * 0.7, cy + (p % 2) * size * 0.3, cz + (rng() - 0.5) * size, { s: size * (p === 2 ? 1.3 : 0.9) }), color: [0xe2c6ff, 0xffd6f0, 0xc9d8ff][c % 3] });
      }
    }
    const clouds = instanced(ctx, puff, own(toon(0xffffff, { unique: true, emissive: 0x3a2a70, emissiveIntensity: 0.5 })), puffs, { outline: false, name: 'dream-clouds' });
    if (clouds.mesh) {
      const cloudGroup = new THREE.Group();
      clouds.mesh.removeFromParent();
      cloudGroup.add(clouds.mesh);
      cloudGroup.position.set(0, 0, 0);
      group.add(cloudGroup);
      animate((dt, t) => { cloudGroup.position.x = Math.sin(t * 0.05) * 12; cloudGroup.position.y = Math.sin(t * 0.3) * 0.8; });
    }
    sparkles(260, center.x, center.z, extent + 40, 2, 26, [0xfff6a8, 0xa8e6ff, 0xffc2f0], 1.4);
    void col;
  }
}

/** Road details: quilt stitches sewn along both edges of the pajama-ribbon road. */
export function buildRoadDetails(ctx) {
  roadStitches(ctx, { color: 0xfff0fb, lateral: ctx.hw - 1.2, dash: 1.2, gap: 1, width: 0.3 });
}

export default { def, buildScenery, buildRoadDetails };
