/**
 * Teacup Garden — track module (data + scenery). Cup: cozy-cup.
 * OWNER: Tracks — Cozy Cup.
 *
 * A whimsical tea-party garden on a sunny morning. A grand, long sweeper
 * circles a giant polka-dot teapot that puffs steam, the spinning teacup ride
 * twirls beside the rose walk, a wiggly hedge-maze slalom squeezes between
 * tall green hedges with topiary on top, and a little humped bridge hops over
 * the Tea Stream before the macaron-lined home straight with party bunting.
 */
import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FENCE_OFFSET, mat4, pushedCopy, ribbon } from './sceneryKit.js';
import { instanced, faceRoad, bulbString } from './props/cozy-kit.js';

export const def = makeTrack(
  {
    id: 'teacup-garden',
    name: 'Teacup Garden',
    subtitle: 'Twirly teacups, a giant teapot and a hedge-maze wiggle',
    laps: 3,
    width: 19,
    previewColor: 0xffb3d9,
    art: ['🫖', '🍰', '🌹'], // menu card emoji: big, bottom-left, top-right
    cup: 'cozy-cup',
    unlock: { type: 'stat', stat: 'wins', count: 2 },
    theme: {
      skyTop: 0x86ccff,
      skyBottom: 0xfff2fa,
      fogColor: 0xfdf0fb,
      fogNear: 180,
      fogFar: 680,
      ground: 0x9fe39a, // mown lawn
      road: 0xf7e4f1, // a lilac-cream tablecloth
      roadAlt: 0xefd3e8,
      curbA: 0xff9ecb,
      curbB: 0xffffff,
      offRoad: 0xd7f3c8,
      music: 'teacup-garden',
      sunColor: 0xfffaf0,
      ambientColor: 0xf1ecff,
      // builder theme extras (see ARCHITECTURE.md -> theme fields)
      roadSprinkles: { style: 'dots', count: 170, palette: [0xffb3c7, 0xb8e6ff, 0xfff0a8, 0xc9f2c2, 0xe2c6ff, 0xffffff] },
      groundTints: [0xb6f0a8, 0x86d68a, 0xe0f7b8],
      groundTintMix: 0.55,
      skirt: { color: 0xffffff, trim: 0xffb3d9 },
      pillar: { shape: 'round', color: 0xffffff, ring: 0xff9ecb },
    },
  },
  {
    start: [0, 0],
    heading: 0,
    startAt: 54,
    ops: [
      { s: 100, flex: true, mark: 'start-straight' },
      { turn: 200, r: 130, mark: 'teapot-sweep' },
      { turn: -50, r: 60, mark: 'rose-kink' },
      { s: 110, mark: 'rose-walk' },
      { turn: 120, r: 45, mark: 'saucer-turn' },
      { s: 20, mark: 'maze-gate' },
      { turn: -50, r: 30, mark: 'maze-1' },
      { s: 10, mark: 'maze-gap-1' },
      { turn: 100, r: 30, mark: 'maze-2' },
      { s: 10, mark: 'maze-gap-2' },
      { turn: -100, r: 30, mark: 'maze-3' },
      { s: 10, mark: 'maze-gap-3' },
      { turn: 50, r: 30, mark: 'maze-4' },
      { s: 70, flex: true, hump: 2.5, mark: 'tea-bridge' },
      { turn: 60, r: 40, mark: 'macaron-bend' },
      { s: 15, mark: 'macaron-row' },
      { turn: 30, r: 60, mark: 'home-bend' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [
      frac('teapot-sweep', 'start') + 0.03,
      frac('teapot-sweep', 'end') - 0.03,
      frac('rose-walk', 'mid'),
      frac('maze-gap-2', 'mid'),
      frac('start-straight', 'start') + 0.02,
    ],
    boostPads: [
      { at: frac('start-straight', 'end') - 0.025, lateral: 3.5 },
      { at: frac('teapot-sweep', 'mid'), lateral: -3 },
      { at: frac('rose-walk', 'start') + 0.006, lateral: 3 },
      { at: frac('maze-4', 'end') + 0.012, lateral: 0 },
    ],
    scenery: {
      kind: 'teacup-garden',
      center: centroid(),
      terrain: 'flat',
      // off-centre inside the sweeper, so it sits ahead-left of racers for most of the curve
      teapot: { at: frac('teapot-sweep', 'start') + (frac('teapot-sweep', 'end') - frac('teapot-sweep', 'start')) * 0.86, lateral: -66 },
      teacups: centroid('rose-kink', 'maze-4'),
      maze: [frac('maze-gate', 'start'), frac('maze-4', 'end')],
      bridge: frac('tea-bridge', 'mid'),
      homeStraight: [frac('start-straight', 'start'), frac('start-straight', 'end')],
      fence: { post: 0xffffff, postAlt: 0xffc6de, rail: 0xffffff, topper: 'heart', topperColor: 0xff7fb0 },
      arch: { a: 0xff9ecb, b: 0xffffff, banner: 0x8a6adf, text: 'TEA TIME!' },
    },
  }),
);

/** Cup profile for LatheGeometry (a teacup ~1 wide, 1 tall). */
export function teacupGeometry(seg = 20) {
  const pts = [
    [0, 0], [0.45, 0], [0.5, 0.06], [0.72, 0.2], [0.9, 0.48], [1, 0.9], [1.04, 1], [0.97, 1.0], [0.9, 0.52], [0.7, 0.26], [0, 0.22],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md -> "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, outlineMat,
    hw, L, center, extent, distToRoad, clearOfRoad, animate,
    scatter, cottonCandyTrees, floatingShapes, sparkles, backgroundHills,
  } = ctx;
  const sc = def.scenery;
  const col = new THREE.Color();
  const PASTELS = [0xffb3c7, 0xb8e6ff, 0xfff0a8, 0xc9f2c2, 0xe2c6ff, 0xffd1a8];

  buildTeapot();
  buildTeacupRide();
  buildHedgeMaze();
  buildTeaStream();
  buildMacarons();
  buildCakeStands();
  buildRoses();
  buildBunting();
  buildGardenSky();

  // ----- the giant teapot ------------------------------------------------------
  function buildTeapot() {
    const t = sc.teapot;
    const p = path.positionAt(t.at * L, t.lateral);
    const x = p.x, z = p.z;
    const face = faceRoad(ctx, x, z) + 0.9; // spout points along the sweeper
    const R = 20;
    const pink = toon(0xffa8cf), white = toon(0xffffff), gold = toon(0xffd66b, { emissive: 0x4a3300, emissiveIntensity: 0.3 });
    const c = Math.cos(face), sn = Math.sin(face);
    const at = (dx, dy, dz, o = {}) => mat4(x + dx * c + dz * sn, dy, z - dx * sn + dz * c, { ...o, ry: face + (o.ry || 0) });
    // saucer
    batch.add(new THREE.CylinderGeometry(R * 1.6, R * 1.3, 2, 40), white, at(0, 1, 0));
    batch.add(new THREE.TorusGeometry(R * 1.55, 0.5, 6, 48), toon(0xff9ecb), at(0, 2, 0, { rx: Math.PI / 2 }), false);
    // body
    batch.add(new THREE.SphereGeometry(R, 32, 20), pink, at(0, 2 + R * 0.82, 0, { s: [1, 0.82, 1] }));
    batch.add(new THREE.TorusGeometry(R * 0.72, 0.9, 8, 36), gold, at(0, 2 + R * 1.42, 0, { rx: Math.PI / 2 }), false);
    // spout
    const spoutCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, R * 0.7), new THREE.Vector3(0, R * 0.25, R * 1.12), new THREE.Vector3(0, R * 0.75, R * 1.35), new THREE.Vector3(0, R * 0.95, R * 1.5),
    ]);
    batch.add(new THREE.TubeGeometry(spoutCurve, 16, R * 0.16, 12, false), pink, at(0, 2 + R * 0.55, 0));
    // handle
    batch.add(new THREE.TorusGeometry(R * 0.45, R * 0.1, 8, 20, Math.PI * 1.2), pink, at(0, 2 + R * 0.95, -R * 0.95, { ry: Math.PI / 2, rz: -Math.PI * 0.1 }));
    // polka dots
    const dots = [];
    for (let k = 0; k < 46; k++) {
      const a = rng() * Math.PI * 2, e = -0.5 + rng() * 1.2;
      const nx = Math.cos(e) * Math.sin(a), ny = Math.sin(e), nz = Math.cos(e) * Math.cos(a);
      const m = at(nx * R, 2 + R * 0.82 + ny * R * 0.82, nz * R, { ry: Math.atan2(nx, nz), rx: -Math.asin(ny) * 0.9, s: [1.3, 1.3, 0.35] });
      dots.push({ m, color: [0xffffff, 0xfff0a8, 0xb8e6ff][k % 3] });
    }
    instanced(ctx, new THREE.SphereGeometry(1, 10, 6), toon(0xffffff), dots, { outline: false, name: 'teapot-dots' });
    // the lid bobs and the knob spins: "tea's ready!"
    const lid = new THREE.Group();
    lid.name = 'teapot-lid';
    const lidGeo = new THREE.SphereGeometry(R * 0.66, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const lidMesh = new THREE.Mesh(lidGeo, toon(0xffc2dd));
    const lidOut = new THREE.Mesh(pushedCopy(lidGeo, 0.3), outlineMat);
    lidMesh.scale.y = lidOut.scale.y = 0.55;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(R * 0.14, 14, 10), gold);
    knob.position.y = R * 0.4;
    lid.add(lidMesh, lidOut, knob);
    const lidBase = 2 + R * 1.45;
    lid.position.set(x, lidBase, z);
    group.add(lid);
    // steam puffs from the spout
    const tip = new THREE.Vector3(0, 2 + R * 0.55 + R * 0.95, R * 1.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), face);
    const puffs = [];
    for (let k = 0; k < 9; k++) puffs.push({ ph: k / 9, sway: rng() * 6 });
    const steam = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false })), puffs.length);
    steam.name = 'teapot-steam';
    steam.frustumCulled = false;
    group.add(steam);
    const write = (time) => {
      const hop = Math.max(0, Math.sin(time * 2.4));
      lid.position.y = lidBase + hop * hop * 2.2;
      lid.rotation.z = Math.sin(time * 4.8) * 0.06 * hop;
      knob.rotation.y = time * 2;
      puffs.forEach((pf, i) => {
        const f = (time * 0.35 + pf.ph) % 1;
        const s = 1.2 + f * 4.5;
        steam.setMatrixAt(i, mat4(x + tip.x + Math.sin(time + pf.sway) * f * 3, tip.y + f * 22, z + tip.z + Math.cos(time * 0.7 + pf.sway) * f * 3, { s: s * (1 - f * 0.4) }));
      });
      steam.instanceMatrix.needsUpdate = true;
    };
    write(0);
    animate((dt, time) => write(time));
  }

  // ----- the spinning teacup ride ----------------------------------------------
  function buildTeacupRide() {
    let [x, z] = sc.teacups;
    const R0 = 26;
    if (!clearOfRoad(x, z, FENCE_OFFSET + R0)) {
      const alt = scatter(1, (xx, zz) => clearOfRoad(xx, zz, FENCE_OFFSET + R0) && Math.hypot(xx - x, zz - z) < 160, { pad: 0 });
      if (!alt.length) return;
      [[x, z]] = alt;
    }
    const ride = new THREE.Group();
    ride.name = 'teacup-ride';
    ride.position.set(x, 0, z);
    group.add(ride);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(R0, R0 + 1, 1.4, 40), toon(0xfff3fa));
    deck.position.y = 0.7;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R0, 0.6, 6, 48), toon(0xff9ecb));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.4;
    ride.add(deck, rim);
    // a centre pole with a spinning sugar-bowl top
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 14, 14), toon(0xffe1ef));
    pole.position.y = 8;
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xb8e6ff));
    bowl.position.y = 15;
    ride.add(pole, bowl);
    const cupGeo = teacupGeometry();
    const cupOut = pushedCopy(cupGeo, 0.04);
    const teaGeo = new THREE.CircleGeometry(0.9, 18);
    teaGeo.rotateX(-Math.PI / 2);
    const handleGeo = new THREE.TorusGeometry(0.28, 0.07, 6, 12);
    const saucerGeo = new THREE.CylinderGeometry(1.35, 1.2, 0.12, 20);
    const cups = [];
    const spin = new THREE.Group();
    ride.add(spin);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const cup = new THREE.Group();
      cup.position.set(Math.cos(a) * R0 * 0.62, 1.4, Math.sin(a) * R0 * 0.62);
      cup.scale.setScalar(5.2);
      const body = new THREE.Mesh(cupGeo, toon(PASTELS[k % PASTELS.length], { side: THREE.DoubleSide }));
      const out = new THREE.Mesh(cupOut, outlineMat);
      const tea = new THREE.Mesh(teaGeo, toon(0xd9955a));
      tea.position.y = 0.8;
      const handle = new THREE.Mesh(handleGeo, toon(PASTELS[k % PASTELS.length]));
      handle.position.set(1.02, 0.6, 0);
      const saucer = new THREE.Mesh(saucerGeo, toon(0xffffff));
      saucer.position.y = 0.02;
      cup.add(body, out, tea, handle, saucer);
      spin.add(cup);
      cups.push({ cup, ph: rng() * 6, dir: k % 2 ? 1 : -1 });
    }
    animate((dt, time) => {
      spin.rotation.y = time * 0.35;
      bowl.rotation.y = -time * 0.8;
      for (const c of cups) {
        c.cup.rotation.y = time * 1.6 * c.dir + c.ph;
        c.cup.position.y = 1.4 + Math.abs(Math.sin(time * 1.3 + c.ph)) * 0.6;
      }
    });
  }

  // ----- hedge maze: tall hedges hug the slalom, a maze of hedges beyond ------------------
  function buildHedgeMaze() {
    const [a, b] = sc.maze;
    const s0 = a * L - 25, s1 = b * L + 20;
    const walls = [];
    const balls = [];
    const lat = hw + FENCE_OFFSET + 2.4;
    const step = 2.6;
    for (let s = s0; s <= s1; s += step) {
      const hdg = path.headingAt(s);
      for (const side of [-1, 1]) {
        const p = path.positionAt(s, side * lat);
        const inner = path.positionAt(s, side * (lat - 1.5));
        if (!clearOfRoad(inner.x, inner.z, FENCE_OFFSET + 0.4)) continue; // tight inside of a bend
        walls.push(mat4(p.x, 3, p.z, { ry: hdg, s: [2.6, 6, step * 1.35] }));
        if (Math.round((s - s0) / step) % 5 === 0) balls.push(mat4(p.x, 7.4, p.z, { s: 1.5 + rng() * 0.3 }));
      }
    }
    // loose maze walls outside the slalom
    const mid = path.pointAt(((a + b) / 2) * L);
    for (const [x, z] of scatter(90, (x, z) => Math.hypot(x - mid.x, z - mid.z) < 150 && clearOfRoad(x, z, FENCE_OFFSET + 12), { pad: 30 })) {
      const len = 8 + Math.floor(rng() * 4) * 4;
      const rot = rng() < 0.5 ? 0 : Math.PI / 2;
      const ex = Math.sin(rot) * len * 0.5, ez = Math.cos(rot) * len * 0.5;
      if (!clearOfRoad(x + ex, z + ez, FENCE_OFFSET + 8) || !clearOfRoad(x - ex, z - ez, FENCE_OFFSET + 8)) continue;
      walls.push(mat4(x, 2.5, z, { ry: rot, s: [2.4, 5, len] }));
      balls.push(mat4(x + ex, 6, z + ez, { s: 1.3 }));
    }
    instanced(ctx, new THREE.BoxGeometry(1, 1, 1), toon(0x55b565, { emissive: 0x0a2a10, emissiveIntensity: 0.25 }), walls, { name: 'hedges', ow: 0.03 });
    instanced(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0x6fcf73, { emissive: 0x0a2a10, emissiveIntensity: 0.25 }), balls, { name: 'topiary', ow: 0.08 });
    // pink and white roses dotted on the hedges
    const roses = [];
    const e = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < walls.length; i += 2) {
      walls[i].decompose(e, q, s);
      roses.push({ m: mat4(e.x + (rng() - 0.5) * 2.8, 1.5 + rng() * 4, e.z + (rng() - 0.5) * 2.8, { s: 0.45 }), color: [0xff7fb0, 0xffffff, 0xff4f8a][i % 3] });
    }
    instanced(ctx, new THREE.IcosahedronGeometry(1, 0), toon(0xffffff), roses, { outline: false, name: 'hedge-roses' });
  }

  // ----- the tea stream under the little bridge ---------------------------------------
  function buildTeaStream() {
    const s = sc.bridge * L;
    const p = path.pointAt(s);
    const r = path.rightAt(s);
    const pts = [];
    for (let d = -90; d <= 90; d += 6) {
      const wig = Math.sin(d * 0.05) * 5;
      const x = p.x + r.x * d - r.z * wig, z = p.z + r.z * d + r.x * wig;
      if (Math.abs(d) > 16 && !clearOfRoad(x, z, 6)) continue;
      pts.push([x, z]);
    }
    if (pts.length < 2) return;
    const pos = [];
    const y = 0.04;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      if (Math.hypot(bx - ax, bz - az) > 10) continue;
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const ux = (-dz / len) * 5, uz = (dx / len) * 5;
      pos.push(ax - ux, y, az - uz, bx - ux, y, bz - uz, ax + ux, y, az + uz);
      pos.push(ax + ux, y, az + uz, bx - ux, y, bz - uz, bx + ux, y, bz + uz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const tea = own(toon(0xe0a468, { unique: true, emissive: 0x4a2a10, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
    const m = new THREE.Mesh(g, tea);
    m.name = 'tea-stream';
    group.add(m);
    animate((dt, t) => { tea.emissiveIntensity = 0.22 + Math.sin(t * 1.5) * 0.06; });
    // sugar-cube stepping stones along both banks
    const cubes = [];
    for (let i = 0; i < pts.length; i += 2) {
      const [x, z] = pts[i];
      for (const side of [-1, 1]) {
        const cx = x + side * 6.6 * r.z, cz = z - side * 6.6 * r.x;
        if (clearOfRoad(cx, cz, FENCE_OFFSET + 1)) cubes.push(mat4(cx, 0.6, cz, { ry: rng() * 6, s: 1.2 }));
      }
    }
    instanced(ctx, new THREE.BoxGeometry(1, 1, 1), toon(0xffffff), cubes, { name: 'sugar-cubes', ow: 0.05 });
  }

  // ----- macarons: giant stacks along the home straight --------------------------------
  function buildMacarons() {
    const shells = [], creams = [];
    const addMac = (x, y, z, s, c, tilt = 0) => {
      shells.push({ m: mat4(x, y + 0.45 * s, z, { s: [s, s * 0.45, s], rz: tilt }), color: c });
      shells.push({ m: mat4(x, y + 1.25 * s, z, { s: [s, s * 0.45, s], rz: tilt }), color: c });
      creams.push(mat4(x, y + 0.85 * s, z, { s: [s * 0.93, s * 0.28, s * 0.93] }));
    };
    const [a, b] = sc.homeStraight;
    const sA = a * L, sB = (b < a ? b + 1 : b) * L;
    let k = 0;
    for (let s = sA; s < sB; s += 22) {
      for (const side of [-1, 1]) {
        const p = path.positionAt(s, side * (hw + FENCE_OFFSET + 5.5));
        if (!clearOfRoad(p.x, p.z, FENCE_OFFSET + 3)) continue;
        const sz = 2.2 + rng() * 0.6;
        const levels = 2 + (k % 3);
        for (let l = 0; l < levels; l++) addMac(p.x, l * 1.75 * sz, p.z, sz * (1 - l * 0.12), PASTELS[(k + l) % PASTELS.length]);
        k++;
      }
    }
    for (const [x, z] of scatter(26, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 6), { pad: 80 })) {
      addMac(x, 0, z, 2.5 + rng() * 2, PASTELS[k++ % PASTELS.length], (rng() - 0.5) * 0.3);
    }
    instanced(ctx, new THREE.SphereGeometry(1, 18, 8), toon(0xffffff, { emissive: 0x33222a, emissiveIntensity: 0.2 }), shells, { name: 'macaron-shells', ow: 0.05 });
    instanced(ctx, new THREE.CylinderGeometry(1, 1, 1, 18), toon(0xfffaf2), creams, { outline: false, name: 'macaron-cream' });
  }

  // ----- tiered cake stands with cupcakes ----------------------------------------------
  function buildCakeStands() {
    const spots = scatter(5, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 16) && distToRoad(x, z, 120) < hw + 60, { pad: 40 });
    const cakes = [], frost = [], cherries = [];
    for (const [x, z] of spots) {
      const tiers = [[9, 0.8], [6.5, 6.5], [4, 11.5]];
      batch.add(new THREE.CylinderGeometry(0.7, 0.9, 15, 10), toon(0xffd66b), mat4(x, 7.5, z), false);
      tiers.forEach(([r, y], ti) => {
        batch.add(new THREE.CylinderGeometry(r, r * 0.92, 0.5, 28), toon(0xffffff), mat4(x, y, z));
        const n = Math.round(r * 0.9);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ti;
          const cx = x + Math.cos(a) * r * 0.66, cz = z + Math.sin(a) * r * 0.66;
          cakes.push({ m: mat4(cx, y + 0.9, cz, { s: 1.1 }), color: [0xffd1a8, 0xf2c28a, 0xc98a5a][i % 3] });
          frost.push({ m: mat4(cx, y + 1.8, cz, { s: [1.25, 1.0, 1.25] }), color: PASTELS[(i + ti) % PASTELS.length] });
          cherries.push(mat4(cx, y + 2.75, cz, { s: 0.34 }));
        }
      });
      batch.add(new THREE.SphereGeometry(0.9, 12, 8), toon(0xff4f8a), mat4(x, 15.6, z), false);
    }
    instanced(ctx, new THREE.CylinderGeometry(0.85, 0.6, 1.3, 10), toon(0xffffff), cakes, { name: 'cupcakes', ow: 0.05 });
    instanced(ctx, new THREE.ConeGeometry(1, 1.5, 10, 2), toon(0xffffff), frost, { outline: false, name: 'cupcake-frosting' });
    instanced(ctx, new THREE.SphereGeometry(1, 8, 6), toon(0xff3b5c), cherries, { outline: false, name: 'cupcake-cherries' });
  }

  // ----- rose bushes ---------------------------------------------------------------
  function buildRoses() {
    const bushes = [], flowers = [];
    for (const [x, z] of scatter(70, (x, z) => {
      const d = distToRoad(x, z, 60);
      return d > hw + FENCE_OFFSET + 3.5 && d < hw + 50;
    }, { pad: 50 })) {
      const R = 1.6 + rng() * 1.2;
      if (!clearOfRoad(x, z, FENCE_OFFSET + R + 1)) continue;
      bushes.push(mat4(x, R * 0.7, z, { s: [R, R * 0.85, R] }));
      const c = [0xff4f8a, 0xffffff, 0xff9ecb, 0xfff0a8][bushes.length % 4];
      for (let k = 0; k < 5; k++) {
        const a = rng() * Math.PI * 2, e = rng() * 1.1;
        flowers.push({ m: mat4(x + Math.cos(a) * Math.cos(e) * R, R * 0.7 + Math.sin(e) * R * 0.85, z + Math.sin(a) * Math.cos(e) * R, { s: 0.42 }), color: c });
      }
    }
    instanced(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0x4fae5f, { emissive: 0x0a2a10, emissiveIntensity: 0.25 }), bushes, { name: 'rose-bushes', ow: 0.07 });
    instanced(ctx, new THREE.IcosahedronGeometry(1, 0), toon(0xffffff, { emissive: 0x331122, emissiveIntensity: 0.25 }), flowers, { outline: false, name: 'roses' });
  }

  // ----- tea-party bunting over the home straight --------------------------------------
  function buildBunting() {
    const [a, b] = sc.homeStraight;
    const sA = a * L + 30, sB = (b < a ? b + 1 : b) * L - 10;
    const flags = [];
    const poleLat = hw + FENCE_OFFSET + 1.4;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.7, 0, 0, 0.7, 0, 0, 0, -1.3, 0], 3));
    tri.computeVertexNormals();
    let k = 0;
    for (let s = sA; s <= sB; s += 34) {
      const l = path.positionAt(s, -poleLat), r = path.positionAt(s, poleLat);
      for (const p of [l, r]) batch.add(new THREE.CylinderGeometry(0.25, 0.3, 11, 8), toon(0xffffff), mat4(p.x, p.y + 5.5, p.z), false);
      const pts = bulbString([l.x, l.y + 10.6, l.z], [r.x, r.y + 10.6, r.z], 1.6, 14);
      const hdg = path.headingAt(s);
      for (const [x, y, z] of pts.slice(1, -1)) flags.push({ m: mat4(x, y, z, { ry: hdg }), color: PASTELS[k++ % PASTELS.length] });
    }
    instanced(ctx, tri, toon(0xffffff, { side: THREE.DoubleSide }), flags, { outline: false, name: 'bunting' });
  }

  // ----- sky: butterflies, floating sugar cubes, far hills, fluffy trees ------------------
  function buildGardenSky() {
    backgroundHills(22, extent + 260, extent + 430, [0x8fd88a, 0xb8ecae, 0xffd1e6, 0xc9f2c2], { hMin: 26, hMax: 62 });
    cottonCandyTrees(scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 10), { pad: 140 }), [0x7fd67a, 0xa8ec8a, 0xffc6de, 0xfff0a8]);
    // butterflies flapping round in lazy loops
    const wing = new THREE.CircleGeometry(0.8, 8);
    wing.translate(0.75, 0, 0);
    wing.rotateX(-Math.PI / 2);
    const flies = [];
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (extent + 20);
      flies.push({ cx: center.x + Math.cos(a) * r, cz: center.z + Math.sin(a) * r, y: 3 + rng() * 6, rad: 4 + rng() * 8, sp: 0.4 + rng() * 0.5, ph: rng() * 6 });
    }
    const wingMat = toon(0xffffff, { side: THREE.DoubleSide, emissive: 0x332233, emissiveIntensity: 0.3 });
    const wings = new THREE.InstancedMesh(wing, wingMat, flies.length * 2);
    wings.name = 'butterflies';
    wings.frustumCulled = false;
    flies.forEach((f, i) => { const c = PASTELS[i % PASTELS.length]; wings.setColorAt(i * 2, col.set(c)); wings.setColorAt(i * 2 + 1, col.set(c)); });
    group.add(wings);
    const write = (t) => {
      flies.forEach((f, i) => {
        const a = t * f.sp + f.ph;
        const x = f.cx + Math.cos(a) * f.rad, z = f.cz + Math.sin(a) * f.rad;
        const y = f.y + Math.sin(t * 2 + f.ph) * 0.8;
        const hdg = -a;
        const flap = Math.sin(t * 14 + f.ph) * 0.9;
        wings.setMatrixAt(i * 2, mat4(x, y, z, { ry: hdg, rz: flap, s: 0.9 }));
        wings.setMatrixAt(i * 2 + 1, mat4(x, y, z, { ry: hdg + Math.PI, rz: -flap, s: 0.9 }));
      });
      wings.instanceMatrix.needsUpdate = true;
    };
    write(0);
    animate((dt, t) => write(t));
    floatingShapes(new THREE.BoxGeometry(1, 1, 1), scatter(22, () => true, { pad: 10 }), [0xffffff, 0xffd1e6, 0xb8e6ff], { yMin: 9, yMax: 22, scale: [1, 1.8] });
    sparkles(200, center.x, center.z, extent + 40, 2, 22, [0xffffff, 0xffe3f1], 1.2);
  }
}

/** Gingham tablecloth shade for a road cell: 0 white, 1 light, 2 where the stripes cross. */
export function ginghamShade(col, row) {
  return (col & 1) + (row & 1);
}

/** Road details: a pink gingham tablecloth road with white lace scallops along both edges. */
export function buildRoadDetails(ctx) {
  const { path, group, hw, loopFrames, toonVC } = ctx;
  const cols = 8;
  const cell = (2 * hw) / cols;
  const shades = [0xfff4fa, 0xf8d6e8, 0xefb3d3].map((c) => new THREE.Color(c));
  const strips = [];
  for (let j = 0; j < cols; j++) {
    const l0 = -hw + j * cell;
    strips.push(ribbon(loopFrames, l0, l0 + cell, 0.036, { color: (k, f) => shades[ginghamShade(j, Math.floor(f.s / cell))] }));
  }
  const cloth = new THREE.Mesh(mergeGeometries(strips), toonVC());
  cloth.name = 'gingham-road';
  group.add(cloth);
  const geo = new THREE.CircleGeometry(0.85, 8, 0, Math.PI);
  geo.rotateX(-Math.PI / 2);
  const step = 1.7;
  const n = Math.floor(path.length / step);
  const lace = new THREE.InstancedMesh(geo, toon(0xffffff, { emissive: 0x333333, emissiveIntensity: 0.3 }), n * 2);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step;
    const hdg = path.headingAt(s);
    for (const side of [-1, 1]) {
      const p = path.positionAt(s, side * (hw - 0.02));
      // a flat half-disc pointing into the road
      lace.setMatrixAt(k++, mat4(p.x, p.y + 0.045, p.z, { ry: hdg + (side > 0 ? -Math.PI / 2 : Math.PI / 2) }));
    }
  }
  lace.name = 'lace-edge';
  group.add(lace);
}

export default { def, buildScenery, buildRoadDetails };
