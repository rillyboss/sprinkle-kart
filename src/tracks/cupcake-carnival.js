/**
 * Cupcake Carnival — track module (data + scenery). Cup: superstar-cup.
 * OWNER: track builder (Superstar Cup).
 *
 * A sunny funfair. The road is shaped like a cupcake (look at the minimap!):
 * the flat "wrapper" bottom is the midway with game booths and bunting, the
 * right-hand wrapper side is a bumpy roller-coaster run under rainbow hoops,
 * the three frosting swirls on top swoop past the giant ferris wheel, and the
 * left side drives straight through the big striped circus tent.
 */
import * as THREE from 'three';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, frames, ribbon, mat4, Batch, extruded, starShape, heartShape } from './sceneryKit.js';
import { stripedGeometry, instanced, mergeAll, roadFrameAt, sideSpot, balloons, bunting, buildBunting, findSpot } from './props/superstar-kit.js';

export const def = makeTrack(
  {
    id: 'cupcake-carnival',
    name: 'Cupcake Carnival',
    subtitle: 'Ferris wheels, carousels and frosting swirls',
    laps: 3,
    width: 18,
    previewColor: 0xff9ecf,
    art: ['🧁', '🎡', '🎈'], // menu card emoji: big, bottom-left, top-right
    cup: 'superstar-cup',
    unlock: { type: 'stat', stat: 'cupsWon', count: 1 },
    theme: {
      skyTop: 0x5cb8ff,
      skyBottom: 0xffeef8,
      fogColor: 0xfff0f8,
      fogNear: 170,
      fogFar: 640,
      ground: 0x9fe6b8,
      road: 0xf6c3dc, // strawberry frosting
      roadAlt: 0xefb2d0,
      curbA: 0xff4d6d, // circus stripes
      curbB: 0xffffff,
      offRoad: 0xc4f2d4,
      music: 'cupcake-carnival',
      sunColor: 0xfff4de,
      ambientColor: 0xffe0f0,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      roadSprinkles: { style: 'dashes', count: 105, palette: [0xff4f9a, 0x4fb3ff, 0xffe14f, 0x8be08b, 0xb57bff, 0xffffff, 0xff8a3d] },
      groundTints: [0xb8f0c8, 0x8fdcaa, 0xd8f7b8],
      groundTintMix: 0.6,
      skirt: { color: 0xfff4fa, trim: 0xff7fb0 },
    },
  },
  {
    start: [0, 0],
    heading: 90,
    startAt: 63,
    ops: [
      { s: 150, flex: true, mark: 'wrapper-bottom' },
      { turn: 70, r: 40, mark: 'corner-br' },
      { s: 30, mark: 'side-r' },
      { s: 42, hump: 1.5, mark: 'coaster-1' },
      { s: 42, hump: 1.5, mark: 'coaster-2' },
      { s: 42, hump: 1.5, mark: 'coaster-3' },
      { s: 24, mark: 'side-r-top' },
      { turn: 110, r: 62, mark: 'bump-1' },
      { turn: -60, r: 32, mark: 'cusp-1' },
      { turn: 120, r: 70, mark: 'bump-2' },
      { turn: -60, r: 32, mark: 'cusp-2' },
      { turn: 110, r: 62, mark: 'bump-3' },
      { s: 150, flex: true, mark: 'side-l' },
      { turn: 70, r: 40, mark: 'corner-bl' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('side-r', 'mid'), frac('cusp-1', 'mid'), frac('bump-3', 'end'), frac('corner-bl', 'start')],
    boostPads: [
      { at: frac('side-r-top', 'mid'), lateral: 3 },
      { at: frac('bump-2', 'mid'), lateral: -3 },
      { at: frac('side-l', 'start') + 0.02, lateral: 0 },
    ],
    scenery: {
      kind: 'carnival',
      center: centroid(),
      terrain: 'flat',
      // named landmark spots (lap fractions)
      spots: {
        coaster: ['coaster-1', 'coaster-2', 'coaster-3'].map((m) => frac(m, 'mid')),
        ferris: frac('bump-2', 'mid'),
        tent: frac('side-l', 'mid'),
        cusps: [frac('cusp-1', 'mid'), frac('cusp-2', 'mid')],
        helter: frac('corner-br', 'mid'),
      },
      fence: { post: 0xffffff, postAlt: 0x4fb3ff, rail: 0xffd6ea, topper: 'star', topperColor: 0xffd23f },
      arch: { a: 0xff4d6d, b: 0xffffff, banner: 0x4fb3ff, text: 'CARNIVAL!' },
    },
  }),
);

const PASTEL = [0xff9ecf, 0xffd23f, 0x7fd3ff, 0xb9a3ff, 0x8be0a8, 0xffb37a];
const RAINBOW = [0xff6f91, 0xffa94d, 0xffe066, 0x8ce99a, 0x74c0fc, 0x9775fa];

/** Candy-striped centre line (alternating sprinkle colours) — drawn right after the road. */
export function buildRoadDetails(ctx) {
  const { path, group, toonVC, L } = ctx;
  const cols = [0xffffff, 0xffd23f, 0x4fb3ff, 0xff5fa8].map((c) => new THREE.Color(c));
  const geos = [];
  for (let s0 = 0; s0 < L - 6; s0 += 7) {
    const c = cols[Math.floor(s0 / 7) % cols.length];
    geos.push(ribbon(frames(path, s0, s0 + 3.4, 1.7), -0.35, 0.35, 0.04, { color: () => c }));
  }
  const line = new THREE.Mesh(mergeAll(geos, { color: true }), toonVC());
  line.name = 'centre-line';
  group.add(line);
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, outlineMat, toonVC,
    hw, L, center, extent, clearOfRoad, animate,
    scatter, cottonCandyTrees, sparkles, backgroundHills, tower, fallingSprinkles, floatingShapes,
  } = ctx;
  const spots = def.scenery.spots;
  const edge = hw + FENCE_OFFSET;

  ferrisWheel();
  carousel();
  bigTopTent();
  coasterHoops();
  midway();
  helterSkelter();
  cupcakes();
  world();

  // ---------------------------------------------------------------------
  /** The giant ferris wheel inside the middle frosting swirl, with cupcake gondolas. */
  function ferrisWheel() {
    const s = spots.ferris * L;
    const hub = sideSpot(path, s, -46);
    const { p } = roadFrameAt(path, s);
    const R = 24, H = 31;
    const wheel = new THREE.Group();
    wheel.name = 'ferris-wheel';
    wheel.position.set(hub.x, 0, hub.z);
    wheel.rotation.y = Math.atan2(p.x - hub.x, p.z - hub.z); // face the road
    group.add(wheel);
    const b = new Batch();
    const white = toon(0xffffff), pink = toon(0xff7fb8), gold = toon(0xffd23f);
    for (const side of [-1, 1]) {
      for (const lean of [-1, 1]) {
        const len = Math.hypot(H, 11);
        b.add(new THREE.CylinderGeometry(0.55, 0.8, 1, 8), white, mat4(lean * 5.5, H / 2, side * 3.4, { s: [1, len, 1], rz: -lean * Math.atan2(11, H) }));
      }
      b.add(new THREE.CylinderGeometry(9, 10, 1.2, 20), pink, mat4(0, 0.6, side * 3.4, { s: [0.9, 1, 0.35] }));
    }
    b.add(new THREE.CylinderGeometry(1.4, 1.4, 8.4, 16), gold, mat4(0, H, 0, { rx: Math.PI / 2 }));
    b.build(wheel, outlineMat);
    // the turning part
    const rotor = new THREE.Group();
    rotor.position.y = H;
    wheel.add(rotor);
    const rb = new Batch();
    for (const z of [-1.3, 1.3]) {
      rb.add(new THREE.TorusGeometry(R, 0.45, 8, 64), pink, mat4(0, 0, z));
      rb.add(new THREE.TorusGeometry(R * 0.55, 0.3, 6, 40), white, mat4(0, 0, z), false);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        rb.add(new THREE.BoxGeometry(0.3, R, 0.3), white, mat4(Math.cos(a) * R / 2, Math.sin(a) * R / 2, z, { rz: a - Math.PI / 2 }), false);
      }
    }
    rb.build(rotor, outlineMat);
    const bulbs = [];
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      for (const z of [-1.75, 1.75]) bulbs.push({ m: mat4(Math.cos(a) * R, Math.sin(a) * R, z, { s: 0.55 }), c: PASTEL[k % PASTEL.length] });
    }
    const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), own(new THREE.MeshBasicMaterial({ color: 0xffffff })), bulbs.length);
    const bc = new THREE.Color();
    bulbs.forEach((it, i) => { bulbMesh.setMatrixAt(i, it.m); bulbMesh.setColorAt(i, bc.set(it.c)); });
    rotor.add(bulbMesh);
    // cupcake gondolas that stay upright
    const n = 12;
    const cupGeo = stripedGeometry(new THREE.CylinderGeometry(1.5, 1.1, 1.6, 14, 1), [0xffffff, 0xdcdcdc], 14);
    cupGeo.translate(0, -1.6, 0);
    const topGeo = new THREE.SphereGeometry(1.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    topGeo.translate(0, -0.8, 0);
    const cups = new THREE.InstancedMesh(cupGeo, toonVC(), n);
    const tops = new THREE.InstancedMesh(topGeo, toon(0xffffff, { emissive: 0x442233, emissiveIntensity: 0.25 }), n);
    const hang = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 4), gold, n);
    for (let i = 0; i < n; i++) {
      cups.setColorAt(i, bc.set(PASTEL[i % PASTEL.length]));
      tops.setColorAt(i, bc.set([0xffffff, 0xffe0f0, 0xfff3c4][i % 3]));
    }
    wheel.add(cups, tops, hang);
    const place = (t) => {
      const rot = t * 0.18;
      rotor.rotation.z = rot;
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        const x = Math.cos(a) * R, y = H + Math.sin(a) * R;
        const m = mat4(x, y, 0, { rz: Math.sin(t * 1.3 + i) * 0.08 });
        cups.setMatrixAt(i, m);
        tops.setMatrixAt(i, m);
        hang.setMatrixAt(i, mat4(x, y - 0.4, 0));
      }
      cups.instanceMatrix.needsUpdate = tops.instanceMatrix.needsUpdate = hang.instanceMatrix.needsUpdate = true;
    };
    place(0);
    animate((dt, t) => place(t));
  }

  /** A spinning carousel of candy ponies in the middle of the fair. */
  function carousel() {
    const [cx, cz] = findSpot(ctx, def.scenery.center, 30);
    const g = new THREE.Group();
    g.name = 'carousel';
    g.position.set(cx, 0, cz);
    group.add(g);
    const R = 11;
    const b = new Batch();
    b.add(new THREE.CylinderGeometry(R + 1, R + 1.6, 1.2, 32), toon(0xffe0f0), mat4(0, 0.6, 0));
    b.add(new THREE.CylinderGeometry(1.1, 1.1, 12, 12), toon(0xffd23f), mat4(0, 6, 0));
    b.build(g, outlineMat);
    const rotor = new THREE.Group();
    g.add(rotor);
    const rb = new Batch();
    rb.add(new THREE.CylinderGeometry(R, R, 0.6, 32), toon(0xb9a3ff), mat4(0, 1.5, 0));
    rb.add(new THREE.TorusGeometry(R + 0.3, 0.5, 8, 40), toon(0xffd23f), mat4(0, 10.6, 0, { rx: Math.PI / 2 }), false);
    rb.add(extruded(starShape(5, 1, 0.45), 0.4, 0.08), glow(0xffd23f), mat4(0, 20.8, 0, { s: 1.8 }), false);
    rb.build(rotor, outlineMat);
    const roof = new THREE.Mesh(stripedGeometry(new THREE.ConeGeometry(R + 2.4, 8, 24, 1), [0xff7fb8, 0xffffff], 24), toonVC({ side: THREE.DoubleSide }));
    roof.position.y = 14.8;
    rotor.add(roof);
    // scalloped valance of little hearts round the rim
    const valance = [];
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      valance.push({ m: mat4(Math.sin(a) * (R + 2.2), 10.2, Math.cos(a) * (R + 2.2), { ry: a, rz: Math.PI, s: 1.7 }), c: k % 2 ? 0xff7fb8 : 0xffffff });
    }
    const vm = new THREE.InstancedMesh(extruded(heartShape(), 0.2, 0, 3), toon(0xffffff), valance.length);
    const vc = new THREE.Color();
    valance.forEach((it, i) => { vm.setMatrixAt(i, it.m); vm.setColorAt(i, vc.set(it.c)); });
    rotor.add(vm);
    // ponies on golden poles, bobbing up and down
    const nP = 8;
    const body = new THREE.CapsuleGeometry(0.75, 1.9, 4, 10).rotateZ(Math.PI / 2);
    const head = new THREE.SphereGeometry(0.7, 12, 10).translate(1.6, 0.9, 0);
    const legGeos = [[-0.8, 0.35], [-0.8, -0.35], [0.8, 0.35], [0.8, -0.35]].map(([x, z]) => new THREE.CylinderGeometry(0.16, 0.16, 1.2, 5).translate(x, -0.9, z));
    const pony = mergeAll([body, head, ...legGeos]);
    const ponies = new THREE.InstancedMesh(pony, toon(0xffffff), nP);
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.14, 9, 6), glow(0xffe38a), nP);
    const ponyCols = [0xffffff, 0xffc2e0, 0xc2e6ff, 0xfff0a8];
    for (let i = 0; i < nP; i++) {
      ponies.setColorAt(i, vc.set(ponyCols[i % 4]));
      const a = (i / nP) * Math.PI * 2;
      poles.setMatrixAt(i, mat4(Math.sin(a) * (R - 3), 6.2, Math.cos(a) * (R - 3)));
    }
    rotor.add(ponies, poles);
    const update = (t) => {
      rotor.rotation.y = t * 0.45;
      for (let i = 0; i < nP; i++) {
        const a = (i / nP) * Math.PI * 2;
        const y = 4.6 + Math.sin(t * 2.2 + i * 1.7) * 0.9;
        ponies.setMatrixAt(i, mat4(Math.sin(a) * (R - 3), y, Math.cos(a) * (R - 3), { ry: a + Math.PI / 2 }));
      }
      ponies.instanceMatrix.needsUpdate = true;
    };
    update(0);
    animate((dt, t) => update(t));
  }

  /** The big striped circus tent the road drives straight through. */
  function bigTopTent() {
    const { p, h } = roadFrameAt(path, spots.tent * L);
    const g = new THREE.Group();
    g.name = 'big-top';
    g.position.copy(p);
    g.rotation.y = h;
    group.add(g);
    const R = 25, base = 10, H = 11;
    const roof = new THREE.Mesh(stripedGeometry(new THREE.ConeGeometry(R, H, 32, 1, true), [0xff4d6d, 0xffffff], 32), toonVC({ side: THREE.DoubleSide }));
    roof.position.y = base + H / 2;
    g.add(roof);
    const b = new Batch();
    b.add(new THREE.TorusGeometry(R, 0.6, 8, 48), toon(0xffd23f), mat4(0, base, 0, { rx: Math.PI / 2 }), false);
    const lat = edge + 1.6;
    for (const side of [-1, 1]) {
      for (const along of [-15, 0, 15]) {
        b.add(new THREE.CylinderGeometry(0.45, 0.55, base, 8), toon(0xffffff), mat4(side * lat, base / 2, along));
        b.add(new THREE.SphereGeometry(0.8, 10, 8), toon(0xffd23f), mat4(side * lat, base + 0.4, along), false);
      }
    }
    b.add(new THREE.CylinderGeometry(0.3, 0.3, 4, 6), toon(0xffd23f), mat4(0, base + H + 1.5, 0), false);
    b.build(g, outlineMat);
    const flag = new THREE.Mesh(ctx.flagGeo, toon(0xff4d6d, { side: THREE.DoubleSide }));
    flag.position.set(0, base + H + 3, 0);
    flag.scale.setScalar(2);
    g.add(flag);
    // twinkly bulbs round the tent's rim (seen from inside as you zoom through)
    const n = 40;
    const bulbMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), bulbMat, n);
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      bulbs.setMatrixAt(k, mat4(Math.sin(a) * (R - 0.8), base - 0.6, Math.cos(a) * (R - 0.8)));
      bulbs.setColorAt(k, col.set(PASTEL[k % PASTEL.length]));
    }
    g.add(bulbs);
    animate((dt, t) => {
      flag.rotation.y = Math.sin(t * 1.3) * 0.6;
      bulbMat.color.setScalar(0.85 + Math.sin(t * 6) * 0.15);
    });
  }

  /** Rainbow hoops over the roller-coaster humps. */
  function coasterHoops() {
    const r = edge + 1.2;
    spots.coaster.forEach((f, i) => {
      const { p, h } = roadFrameAt(path, f * L);
      const m = mat4(p.x, p.y, p.z, { ry: h });
      batch.add(new THREE.TorusGeometry(r, 0.7, 10, 48, Math.PI), toon(RAINBOW[(i * 2) % 6]), m);
      batch.add(new THREE.TorusGeometry(r - 1.3, 0.45, 8, 48, Math.PI), toon(RAINBOW[(i * 2 + 1) % 6]), m, false);
    });
  }

  /** Game booths with striped awnings along the midway (start straight + tent side), and bunting overhead. */
  function midway() {
    const booths = [];
    const addRow = (s0, s1, step) => {
      for (let s = s0; s < s1; s += step) {
        if (Math.abs(path.delta(s, 0)) < 12) continue; // leave room for the start arch
        for (const side of [-1, 1]) {
          const q = sideSpot(path, s, side * (edge + 6));
          if (!clearOfRoad(q.x, q.z, FENCE_OFFSET + 3.5)) continue;
          booths.push({ q, h: path.headingAt(s) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), k: booths.length });
        }
      }
    };
    addRow(-L * 0.06, L * 0.035, 13);
    const t0 = (spots.tent - 0.06) * L, t1 = (spots.tent + 0.075) * L;
    addRow(t0, t0 + 25, 13);
    addRow(t1 - 25, t1, 13);
    const bodyItems = [], awnItems = [], signItems = [], bulbItems = [];
    for (const { q, h, k } of booths) {
      const fx = Math.sin(h), fz = Math.cos(h);
      bodyItems.push({ m: mat4(q.x, q.y + 1.6, q.z, { ry: h, s: [5, 3.2, 3.4] }), c: 0xfff6fb });
      awnItems.push({ m: mat4(q.x + fx * 1.9, q.y + 3.6, q.z + fz * 1.9, { ry: h, rx: 0.45, s: [5.6, 0.35, 2.4] }), c: PASTEL[k % PASTEL.length] });
      signItems.push({ m: mat4(q.x, q.y + 4.9, q.z, { ry: h, s: 1.1 }), c: PASTEL[(k + 2) % PASTEL.length] });
      for (let j = -2; j <= 2; j++) {
        bulbItems.push({ m: mat4(q.x + fx * 3 + Math.cos(h) * j * 1.2, q.y + 3.05, q.z + fz * 3 - Math.sin(h) * j * 1.2, { s: 0.28 }), c: PASTEL[(j + 5 + k) % PASTEL.length] });
      }
    }
    instanced(ctx, new THREE.BoxGeometry(1, 1, 1), toon(0xffffff), bodyItems);
    instanced(ctx, new THREE.BoxGeometry(1, 1, 1), toon(0xffffff), awnItems);
    instanced(ctx, new THREE.TorusGeometry(0.9, 0.45, 10, 20), toon(0xffffff, { emissive: 0x442233, emissiveIntensity: 0.3 }), signItems);
    instanced(ctx, new THREE.SphereGeometry(1, 6, 5), own(new THREE.MeshBasicMaterial({ color: 0xffffff })), bulbItems, { outline: false });
    // balloons tied to every other booth
    balloons(ctx, booths.filter((b, i) => i % 2 === 0).map((b) => [b.q.x + (rng() - 0.5) * 2, b.q.z + (rng() - 0.5) * 2]), PASTEL, { yMin: 6.5, yMax: 9, scale: [0.8, 1.1] });
    // bunting across the road
    const col = { flags: [], poles: [], cords: [] };
    for (const s of [-L * 0.045, -L * 0.022, L * 0.018, L * 0.036]) bunting(ctx, s, { collect: col });
    for (const f of spots.cusps) bunting(ctx, f * L, { collect: col, height: 9 });
    for (const f of spots.coaster) bunting(ctx, f * L + 21, { collect: col, height: 10, sag: 1.6 });
    buildBunting(ctx, col, { pole: 0xffd23f });
  }

  /** A helter-skelter tower with a rainbow spiral slide outside the first corner. */
  function helterSkelter() {
    const q = sideSpot(path, spots.helter * L, edge + 22);
    if (!clearOfRoad(q.x, q.z, FENCE_OFFSET + 10)) return;
    tower(q.x, 0, q.z, 3.6, 17, { wall: 0xfff6fb, roof: 0x4fb3ff, trim: 0xffd23f, roofH: 7, windows: true });
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const a = t * Math.PI * 2 * 3.2;
      pts.push(new THREE.Vector3(q.x + Math.cos(a) * 5.4, 16.5 - t * 15.5, q.z + Math.sin(a) * 5.4));
    }
    const slide = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.9, 6, false);
    const count = slide.attributes.position.count;
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      c.set(RAINBOW[Math.floor(i / 7 / 14) % RAINBOW.length]); // 7 verts per ring, 14 rings per colour
      col.set([c.r, c.g, c.b], i * 3);
    }
    slide.setAttribute('color', new THREE.BufferAttribute(col, 3));
    group.add(new THREE.Mesh(slide, toonVC()));
  }

  /** Cupcakes of every size, including the giant one by the start line. */
  function cupcakes() {
    const wrap = stripedGeometry(new THREE.CylinderGeometry(1, 0.78, 1.1, 18, 1), [0xffffff, 0xd9d9d9], 18);
    wrap.translate(0, 0.55, 0);
    const frosting = mergeAll([
      new THREE.TorusGeometry(0.82, 0.34, 10, 24).rotateX(Math.PI / 2).translate(0, 1.25, 0),
      new THREE.TorusGeometry(0.58, 0.3, 10, 20).rotateX(Math.PI / 2).translate(0, 1.62, 0),
      new THREE.TorusGeometry(0.32, 0.24, 8, 16).rotateX(Math.PI / 2).translate(0, 1.92, 0),
      new THREE.SphereGeometry(0.3, 10, 8).translate(0, 2.12, 0),
    ]);
    const cherry = new THREE.SphereGeometry(0.26, 12, 10).translate(0, 2.52, 0);
    const list = [];
    const gq = sideSpot(path, L * 0.02, -(edge + 34));
    const giant = clearOfRoad(gq.x, gq.z, FENCE_OFFSET + 26);
    if (giant) list.push({ x: gq.x, z: gq.z, s: 13 });
    for (const [x, z] of scatter(26, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 8), { pad: 90 })) list.push({ x, z, s: 2.2 + rng() * 3 });
    const frostCols = [0xffc2e0, 0xfff3c4, 0xc2e6ff, 0xd9c2ff, 0xffffff, 0xb8f0c8];
    const wItems = list.map((c, i) => ({ m: mat4(c.x, 0, c.z, { s: c.s, ry: rng() * 6 }), c: PASTEL[i % PASTEL.length] }));
    instanced(ctx, wrap, toonVC(), wItems, { ow: 0.04 });
    instanced(ctx, frosting, toon(0xffffff, { emissive: 0x442233, emissiveIntensity: 0.2 }), wItems.map((w, i) => ({ m: w.m, c: frostCols[i % frostCols.length] })), { ow: 0.04 });
    instanced(ctx, cherry, toon(0xff3b5c, { emissive: 0x550011, emissiveIntensity: 0.35 }), wItems.map((w) => ({ m: w.m })), { ow: 0.03 });
    if (giant) {
      // chunky sprinkles on the giant cupcake's frosting
      const c0 = list[0];
      const spr = [];
      for (let k = 0; k < 90; k++) {
        const a = rng() * Math.PI * 2, tier = rng();
        const r = 0.9 - tier * 0.5, y = 1.35 + tier * 0.75;
        spr.push({ m: mat4(c0.x + Math.cos(a) * r * c0.s, y * c0.s, c0.z + Math.sin(a) * r * c0.s, { s: [0.9, 0.9, 2.6], ry: rng() * 3, rx: rng() }), c: PASTEL[k % PASTEL.length] });
      }
      instanced(ctx, new THREE.CapsuleGeometry(0.18, 0.4, 2, 6).rotateX(Math.PI / 2), toon(0xffffff), spr, { outline: false });
    }
  }

  /** Trees, hills, balloons in the sky, confetti and sparkles. */
  function world() {
    cottonCandyTrees(scatter(70, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5), { pad: 140 }), [0xffc2e0, 0xfff3c4, 0xc2e6ff, 0xffffff, 0xd9c2ff]);
    backgroundHills(20, extent + 250, extent + 420, [0x8fdcaa, 0xb8f0c8, 0x7fd3a0, 0xd8f7b8], { hMin: 30, hMax: 70 });
    const balloonGeo = new THREE.SphereGeometry(1, 12, 10).scale(1, 1.2, 1);
    floatingShapes(balloonGeo, scatter(40, (x, z) => clearOfRoad(x, z, 6), { pad: 60 }), PASTEL, { yMin: 14, yMax: 38, scale: [1.3, 2.4] });
    fallingSprinkles(420);
    sparkles(240, center.x, center.z, extent + 40, 3, 26, [0xffffff, 0xfff7b0, 0xffd1ec], 1.4);
  }
}

export default { def, buildScenery, buildRoadDetails };
