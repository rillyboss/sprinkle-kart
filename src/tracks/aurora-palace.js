/**
 * Aurora Ice Palace — track module (data + scenery). Cup: superstar-cup.
 * OWNER: track builder (Superstar Cup).
 *
 * A snowy night under dancing northern lights. The road crosses a frozen
 * river on an ice bridge, zig-zags up the glacier on two switchbacks, glides
 * through a colonnade of glowing crystal arches and then makes one huge
 * sweeping turn around the Crystal Palace before sliding back down the hill.
 */
import * as THREE from 'three';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, ribbon, mat4, extruded, starShape, distToPolyline } from './sceneryKit.js';
import { instanced, mergeAll, roadFrameAt, sideSpot, snowfall } from './props/superstar-kit.js';

export const def = makeTrack(
  {
    id: 'aurora-palace',
    name: 'Aurora Ice Palace',
    subtitle: 'A crystal palace under the dancing northern lights',
    laps: 3,
    width: 18,
    previewColor: 0x8fd8ff,
    art: ['🏰', '❄️', '✨'], // menu card emoji: big, bottom-left, top-right
    cup: 'superstar-cup',
    unlock: { type: 'cup-track', cupId: 'cozy-cup', result: 'win' },
    theme: {
      skyTop: 0x0b1440,
      skyBottom: 0x2f5aa0,
      fogColor: 0x456fb0,
      fogNear: 190,
      fogFar: 720,
      ground: 0xe6f0ff,
      road: 0x9fd0f2, // polished ice
      roadAlt: 0x8fc4ec,
      curbA: 0xffffff,
      curbB: 0x7fd8ff,
      offRoad: 0xd8e8ff,
      music: 'aurora-palace',
      sunColor: 0xd6e4ff, // moonlight
      ambientColor: 0x9fb4ff,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      night: true,
      skyStars: true,
      roadSprinkles: { style: 'stars', count: 190, palette: [0xffffff, 0xcff6ff, 0xe3d6ff, 0xfff6c8] },
      groundTints: [0xd4e4ff, 0xf6f9ff, 0xe4dcff],
      groundTintMix: 0.7,
      skirt: { color: 0xe6f6ff, trim: 0x9fd8ff },
      pillar: { shape: 'box', color: 0xe6f6ff, ring: 0x9fd8ff },
      startLineDark: 0x3a4aa0,
    },
  },
  {
    start: [0, 0],
    heading: -90,
    startAt: 54,
    ops: [
      { s: 100, flex: true, mark: 'start' },
      { turn: -90, r: 70, y: 1, mark: 'lake-bend' },
      { s: 50, y: 3, mark: 'ice-bridge' },
      { s: 30, y: 5, mark: 'climb' },
      { turn: -180, r: 34, y: 7, mark: 'switchback-1' },
      { s: 50, y: 9, mark: 'zig' },
      { turn: 180, r: 34, y: 11, mark: 'switchback-2' },
      { s: 60, y: 13, mark: 'colonnade' },
      { turn: -180, r: 80, y: 12, mark: 'aurora-sweep' },
      { s: 150, y: 3, flex: true, mark: 'descent' },
      { turn: -90, r: 55, y: 0, mark: 'last' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('lake-bend', 'mid'), frac('zig', 'mid'), frac('aurora-sweep', 'mid') + 0.01, frac('descent', 'mid') + 0.005],
    boostPads: [
      { at: frac('ice-bridge', 'end'), lateral: 0 },
      { at: frac('colonnade', 'mid'), lateral: 3 },
      { at: frac('descent', 'start') + 0.012, lateral: -3 },
    ],
    scenery: {
      kind: 'aurora',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 8, scale: 0.012 },
      bridges: [[frac('ice-bridge', 'start') - 0.015, frac('ice-bridge', 'end') + 0.015]],
      river: { at: frac('ice-bridge', 'mid') },
      spots: {
        sweep: frac('aurora-sweep', 'mid'),
        colonnade: [frac('colonnade', 'start'), frac('colonnade', 'end')],
        penguins: frac('start', 'mid'),
      },
      fence: { post: 0xffffff, postAlt: 0xbfefff, rail: 0xbff3ff, topper: 'star', topperColor: 0xbff3ff, glow: true },
      arch: { a: 0x8fd8ff, b: 0xffffff, banner: 0x6a7cff, text: 'ICE PALACE' },
    },
  }),
);

const ICE = [0xbff3ff, 0xd9c8ff, 0xffd1f0, 0xffffff];

/** Before the terrain is made: trace the frozen river so the hills carve a channel for it. */
export function prepare({ def, path, index }) {
  if (!def.scenery?.river) return def;
  return { ...def, scenery: { ...def.scenery, riverLine: riverPolyline(def, path, index) } };
}

/** Frosty glowing lane lines on the ice road. */
export function buildRoadDetails(ctx) {
  const { group, own, hw, loopFrames, animate } = ctx;
  const geos = [];
  for (const lat of [-hw * 0.36, hw * 0.36]) geos.push(ribbon(loopFrames, lat - 0.2, lat + 0.2, 0.045));
  const mat = own(new THREE.MeshBasicMaterial({ color: 0xdffaff, transparent: true, opacity: 0.5, depthWrite: false }));
  const lines = new THREE.Mesh(mergeAll(geos), mat);
  lines.renderOrder = 1;
  group.add(lines);
  animate((dt, t) => { mat.opacity = 0.38 + Math.sin(t * 1.7) * 0.14; });
}

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own,
    hw, L, center, extent, groundH, distToRoad, clearOfRoad, animate,
    scatter, sparkles, floatingShapes,
  } = ctx;
  const spots = def.scenery.spots;
  const edge = hw + FENCE_OFFSET;
  const river = def.scenery.riverLine || [];
  const offRiver = (x, z, m = 14) => !river.length || distToPolyline(x, z, river) > m;

  aurora();
  moon();
  palace();
  colonnade();
  frozenRiver();
  pines();
  snowmen();
  penguins();
  crystals();
  mountains();
  floatingShapes(extruded(starShape(6, 1, 0.32), 0.2, 0.04, 1), scatter(46, (x, z) => clearOfRoad(x, z, 8), { pad: 80 }), ICE, { yMin: 10, yMax: 34, scale: [1.2, 2.6], glowy: true });
  snowfall(ctx, 1100, { colors: [0xffffff, 0xe6f4ff, 0xf4ecff], size: 0.8, top: 55 });
  sparkles(420, center.x, center.z, extent + 80, 1, 40, [0xffffff, 0xbff3ff, 0xe3d6ff], 1.5);

  // ---------------------------------------------------------------------
  /** Dancing northern lights: big additive curtains far away in the sky. */
  function aurora() {
    const curtains = [
      { a0: -0.6, a1: 0.9, r: 520, y: 150, h: 170, c1: 0x5cffc8, c2: 0xff7fe0, sp: 0.5 },
      { a0: 1.4, a1: 2.9, r: 560, y: 170, h: 150, c1: 0x7fffb2, c2: 0x9f8cff, sp: 0.42 },
      { a0: 3.3, a1: 4.6, r: 540, y: 140, h: 160, c1: 0x6fe7ff, c2: 0xff9fd6, sp: 0.55 },
      { a0: 4.8, a1: 6.0, r: 500, y: 190, h: 130, c1: 0x9dffb0, c2: 0x7f9fff, sp: 0.47 },
    ];
    const mats = [];
    for (const c of curtains) {
      const seg = 72;
      const pos = [], uv = [];
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const a = c.a0 + (c.a1 - c.a0) * t;
        const wob = Math.sin(t * 9 + c.a0) * 30;
        const x = center.x + Math.cos(a) * (c.r + wob), z = center.z + Math.sin(a) * (c.r + wob);
        pos.push(x, c.y, z, x, c.y + c.h, z);
        uv.push(t, 0, t, 1);
      }
      const idx = [];
      for (let i = 0; i < seg; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const mat = own(new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, c1: { value: new THREE.Color(c.c1) }, c2: { value: new THREE.Color(c.c2) }, sp: { value: c.sp } },
        vertexShader: /* glsl */`
          uniform float time; uniform float sp;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.y += sin(uv.x * 18.0 + time * sp * 2.0) * 10.0 * uv.y;
            p.x += sin(uv.x * 7.0 + time * sp) * 16.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */`
          uniform float time; uniform float sp; uniform vec3 c1; uniform vec3 c2;
          varying vec2 vUv;
          void main() {
            float rays = 0.55 + 0.45 * sin(vUv.x * 60.0 + time * sp * 3.0 + sin(vUv.x * 13.0 + time * 0.7) * 2.0);
            float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
            float ends = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
            vec3 col = mix(c1, c2, smoothstep(0.35, 1.0, vUv.y));
            gl_FragColor = vec4(col * rays * fade * ends * 0.85, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      }));
      mats.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = 'aurora';
      mesh.frustumCulled = false;
      mesh.renderOrder = -8;
      group.add(mesh);
    }
    animate((dt, t) => { for (const m of mats) m.uniforms.time.value = t; });
  }

  function moon() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(26, 24, 16), own(new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false })));
    m.position.set(center.x - 380, 260, center.z - 420);
    group.add(m);
    const halo = new THREE.Mesh(new THREE.RingGeometry(30, 46, 48), own(new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.25, fog: false, depthWrite: false })));
    halo.position.copy(m.position);
    halo.lookAt(center.x, 0, center.z);
    group.add(halo);
  }

  /** The Crystal Palace in the middle of the big aurora sweep. */
  function palace() {
    const q = sideSpot(path, spots.sweep * L, 80); // the sweep turns right: its centre is 80 m to the right
    const x = q.x, z = q.z;
    const gy = groundH(x, z);
    // a snowy mound for it to stand on
    batch.add(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xf4f8ff), mat4(x, gy - 2, z, { s: [40, 9, 40] }));
    const y = gy + 6;
    const iceMat = toon(0xcfeeff, { emissive: 0x3a6aa8, emissiveIntensity: 0.35 });
    const lilac = toon(0xe0d4ff, { emissive: 0x5a4aa0, emissiveIntensity: 0.3 });
    const roofMat = toon(0x9fd8ff, { emissive: 0x2a5a98, emissiveIntensity: 0.45 });
    const windowMat = glow(0xfff1c2);
    // great hall + keep
    batch.add(new THREE.CylinderGeometry(15, 16, 12, 8), lilac, mat4(x, y + 6, z));
    batch.add(new THREE.CylinderGeometry(8, 9, 26, 8), iceMat, mat4(x, y + 13, z));
    batch.add(new THREE.ConeGeometry(10, 22, 8), roofMat, mat4(x, y + 37, z));
    batch.add(new THREE.CylinderGeometry(15.6, 15.6, 1.2, 8), toon(0xffffff), mat4(x, y + 12.4, z), false);
    // six crystal towers around it
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      const tx = x + Math.cos(a) * 19, tz = z + Math.sin(a) * 19;
      const th = 16 + (k % 2) * 7;
      batch.add(new THREE.CylinderGeometry(3.2, 3.6, th, 6), k % 2 ? iceMat : lilac, mat4(tx, y + th / 2, tz));
      batch.add(new THREE.ConeGeometry(4.2, 11, 6), roofMat, mat4(tx, y + th + 5.5, tz));
      batch.add(new THREE.OctahedronGeometry(1.4, 0), glow(ICE[k % 3]), mat4(tx, y + th + 12.4, tz, { s: [1, 1.7, 1] }), false);
      for (let w = 0; w < 3; w++) {
        const wa = a + Math.PI + (w - 1) * 0.9;
        batch.add(new THREE.BoxGeometry(1.2, 2.4, 0.3), windowMat, mat4(tx + Math.cos(wa) * 3.3, y + th * 0.65, tz + Math.sin(wa) * 3.3, { ry: -wa + Math.PI / 2 }), false);
      }
    }
    // keep windows all round
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      batch.add(new THREE.BoxGeometry(1.6, 3.4, 0.3), windowMat, mat4(x + Math.cos(a) * 8.3, y + 20, z + Math.sin(a) * 8.3, { ry: -a + Math.PI / 2 }), false);
      batch.add(new THREE.BoxGeometry(2.2, 3.2, 0.3), windowMat, mat4(x + Math.cos(a) * 15.4, y + 6, z + Math.sin(a) * 15.4, { ry: -a + Math.PI / 2 }), false);
    }
    // crystal spikes growing out of the mound
    for (let k = 0; k < 16; k++) {
      const a = rng() * Math.PI * 2, r = 24 + rng() * 10;
      const sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r;
      const h = 3 + rng() * 5;
      batch.add(new THREE.OctahedronGeometry(1, 0), glow(ICE[k % 3]), mat4(sx, groundH(sx, sz) + h * 0.5, sz, { s: [h * 0.28, h, h * 0.28], rz: (rng() - 0.5) * 0.5 }), false);
    }
    // a big spinning snowflake-star on the spire
    const flake = new THREE.Mesh(extruded(starShape(6, 1, 0.34), 0.25, 0.05, 1), glow(0xfff6c8));
    flake.position.set(x, y + 52, z);
    flake.scale.setScalar(4.2);
    group.add(flake);
    animate((dt, t) => { flake.rotation.y = t * 0.8; flake.position.y = y + 52 + Math.sin(t * 1.2) * 0.8; });
  }

  /** Glowing crystal arches over the colonnade straight near the top of the climb. */
  function colonnade() {
    const [f0, f1] = spots.colonnade;
    const s0 = f0 * L + 6, s1 = f1 * L - 2;
    const n = 5;
    const archMat = own(new THREE.MeshBasicMaterial({ color: 0xbff3ff, transparent: true, opacity: 0.75 }));
    const pillarMat = toon(0xe6f8ff, { emissive: 0x4a7ab8, emissiveIntensity: 0.4 });
    const gems = [];
    for (let i = 0; i < n; i++) {
      const s = s0 + ((s1 - s0) * i) / (n - 1);
      const { p, h } = roadFrameAt(path, s);
      const r = edge + 1.4;
      const m = mat4(p.x, p.y, p.z, { ry: h });
      const arch = new THREE.Mesh(new THREE.TorusGeometry(r, 0.55, 8, 40, Math.PI), archMat);
      arch.position.copy(p);
      arch.rotation.y = h;
      arch.scale.y = 1.25;
      group.add(arch);
      for (const side of [-1, 1]) {
        batch.add(new THREE.CylinderGeometry(0.9, 1.2, 4, 6), pillarMat, new THREE.Matrix4().multiplyMatrices(m, mat4(side * r, 0, 0)));
        batch.add(new THREE.OctahedronGeometry(1.2, 0), glow(ICE[(i + (side > 0 ? 1 : 0)) % 3]), new THREE.Matrix4().multiplyMatrices(m, mat4(side * r, 4.6, 0, { s: [1, 1.6, 1] })), false);
      }
      gems.push({ m: new THREE.Matrix4().multiplyMatrices(m, mat4(0, r * 1.25 + 0.9, 0, { s: [1.2, 1.9, 1.2] })), c: ICE[i % ICE.length] });
    }
    instanced(ctx, new THREE.OctahedronGeometry(1, 0), own(new THREE.MeshBasicMaterial({ color: 0xffffff })), gems, { outline: false });
    animate((dt, t) => { archMat.color.setHSL(0.52 + Math.sin(t * 0.6) * 0.06, 0.9, 0.78); });
  }

  /** The frozen river under the ice bridge, with little ice floes. */
  function frozenRiver() {
    if (!river.length) return;
    const pos = [];
    const W = 10;
    const taper = (k) => W * Math.min(1, 0.3 + Math.min(k, river.length - 1 - k) * 0.2);
    for (let i = 0; i < river.length - 1; i++) {
      const [ax, az] = river[i], [bx, bz] = river[i + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const ux = -dz / len, uz = dx / len;
      const wa = taper(i), wb = taper(i + 1);
      const y = -1.7;
      pos.push(ax - ux * wa, y, az - uz * wa, bx - ux * wb, y, bz - uz * wb, ax + ux * wa, y, az + uz * wa);
      pos.push(ax + ux * wa, y, az + uz * wa, bx - ux * wb, y, bz - uz * wb, bx + ux * wb, y, bz + uz * wb);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const ice = new THREE.Mesh(g, own(toon(0xaee4ff, { unique: true, emissive: 0x3a7ab8, emissiveIntensity: 0.45, side: THREE.DoubleSide })));
    ice.name = 'frozen-river';
    group.add(ice);
    const floes = [];
    for (let i = 1; i < river.length - 1; i += 2) {
      floes.push({ m: mat4(river[i][0] + (rng() - 0.5) * 8, -1.55, river[i][1] + (rng() - 0.5) * 8, { s: [1.5 + rng() * 2, 0.3, 1.2 + rng() * 1.6], ry: rng() * 3 }) });
    }
    instanced(ctx, new THREE.CylinderGeometry(1, 1, 1, 7), toon(0xffffff), floes, { outline: false });
  }

  /** Frosted pine trees on the snowy hills. */
  function pines() {
    const tiers = mergeAll([
      new THREE.ConeGeometry(2.6, 3.4, 8).translate(0, 2.6, 0),
      new THREE.ConeGeometry(2.1, 3, 8).translate(0, 4.4, 0),
      new THREE.ConeGeometry(1.5, 2.6, 8).translate(0, 6.1, 0),
    ]);
    const snow = mergeAll([
      new THREE.ConeGeometry(1.2, 1.3, 8).translate(0, 7.0, 0),
      new THREE.TorusGeometry(1.75, 0.28, 5, 12).rotateX(Math.PI / 2).translate(0, 3.2, 0),
      new THREE.TorusGeometry(1.35, 0.24, 5, 12).rotateX(Math.PI / 2).translate(0, 5.0, 0),
    ]);
    const trunk = new THREE.CylinderGeometry(0.35, 0.45, 1.4, 6).translate(0, 0.7, 0);
    const items = [];
    for (const [x, z] of scatter(190, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 7) && offRiver(x, z), { pad: 140 })) {
      const s = 0.9 + rng() * 1.1;
      if (!clearOfRoad(x, z, FENCE_OFFSET + 3.5 + 2.6 * s)) continue;
      items.push({ m: mat4(x, groundH(x, z) - 0.2, z, { s, ry: rng() * 6 }), c: [0x6fc2a8, 0x7fb8d8, 0x8fd0b8, 0x9aa8e8][items.length % 4] });
    }
    instanced(ctx, tiers, toon(0xffffff, { emissive: 0x1a3050, emissiveIntensity: 0.3 }), items, { ow: 0.06 });
    instanced(ctx, snow, toon(0xffffff, { emissive: 0x506080, emissiveIntensity: 0.35 }), items.map((it) => ({ m: it.m })), { outline: false });
    instanced(ctx, trunk, toon(0x9a7ab8), items.map((it) => ({ m: it.m })), { outline: false });
  }

  /** Friendly snowmen with scarves near the road. */
  function snowmen() {
    const body = mergeAll([
      new THREE.SphereGeometry(1.5, 14, 10).translate(0, 1.3, 0),
      new THREE.SphereGeometry(1.1, 14, 10).translate(0, 3.3, 0),
      new THREE.SphereGeometry(0.8, 14, 10).translate(0, 4.8, 0),
    ]);
    const scarf = new THREE.TorusGeometry(0.72, 0.22, 6, 14).rotateX(Math.PI / 2).translate(0, 4.2, 0);
    const hat = mergeAll([new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12).translate(0, 5.9, 0), new THREE.CylinderGeometry(0.9, 0.9, 0.12, 14).translate(0, 5.45, 0)]);
    const nose = new THREE.ConeGeometry(0.14, 0.7, 6).rotateX(Math.PI / 2).translate(0, 4.8, 1.05);
    const eyes = mergeAll([new THREE.SphereGeometry(0.1, 6, 4).translate(-0.28, 5.05, 0.72), new THREE.SphereGeometry(0.1, 6, 4).translate(0.28, 5.05, 0.72)]);
    const list = [];
    for (let k = 0; k < 12; k++) {
      const s = (0.05 + (k / 12) * 0.9 + rng() * 0.03) * L;
      const side = k % 2 ? 1 : -1;
      const q = sideSpot(path, s, side * (edge + 5 + rng() * 6));
      if (!clearOfRoad(q.x, q.z, FENCE_OFFSET + 3.5) || !offRiver(q.x, q.z)) continue;
      const { p } = roadFrameAt(path, s);
      list.push({ m: mat4(q.x, groundH(q.x, q.z) - 0.2, q.z, { ry: Math.atan2(p.x - q.x, p.z - q.z) + (rng() - 0.5) * 0.8 }), k });
    }
    instanced(ctx, body, toon(0xffffff, { emissive: 0x3a4a70, emissiveIntensity: 0.3 }), list);
    instanced(ctx, scarf, toon(0xffffff), list.map((it) => ({ m: it.m, c: [0xff6fa8, 0x7fd8ff, 0xffd23f, 0xb58cff][it.k % 4] })), { outline: false });
    instanced(ctx, hat, toon(0x5a4aa0), list, { outline: false });
    instanced(ctx, nose, toon(0xffa14f), list, { outline: false });
    instanced(ctx, eyes, toon(0x2a2040), list, { outline: false });
  }

  /** A little huddle of penguins cheering (hop-hop!) near the start. */
  function penguins() {
    const s0 = spots.penguins * L;
    const body = new THREE.CapsuleGeometry(0.6, 0.8, 4, 10).translate(0, 1.05, 0);
    const belly = new THREE.SphereGeometry(0.5, 10, 8).scale(0.9, 1.2, 0.6).translate(0, 0.95, 0.32);
    const beak = new THREE.ConeGeometry(0.16, 0.4, 6).rotateX(Math.PI / 2).translate(0, 1.55, 0.62);
    const feet = mergeAll([new THREE.BoxGeometry(0.3, 0.1, 0.4).translate(-0.25, 0.05, 0.2), new THREE.BoxGeometry(0.3, 0.1, 0.4).translate(0.25, 0.05, 0.2)]);
    const list = [];
    const { p } = roadFrameAt(path, s0);
    for (let k = 0; k < 14; k++) {
      const side = k < 7 ? -1 : 1;
      const q = sideSpot(path, s0 + (k % 7) * 3.2 - 10, side * (edge + 2.5 + (k % 2) * 1.8));
      list.push({ x: q.x, z: q.z, y: groundH(q.x, q.z), face: Math.atan2(p.x - q.x, p.z - q.z), ph: rng() * 6 });
    }
    const meshes = [
      new THREE.InstancedMesh(body, toon(0x2e3566), list.length),
      new THREE.InstancedMesh(belly, toon(0xffffff), list.length),
      new THREE.InstancedMesh(beak, toon(0xffb347), list.length),
      new THREE.InstancedMesh(feet, toon(0xffb347), list.length),
    ];
    group.add(...meshes);
    const update = (t) => {
      list.forEach((pg, i) => {
        const hop = Math.max(0, Math.sin(t * 5 + pg.ph)) * 0.35;
        const m = mat4(pg.x, pg.y + hop, pg.z, { ry: pg.face, rz: Math.sin(t * 4 + pg.ph) * 0.18 });
        for (const mesh of meshes) mesh.setMatrixAt(i, m);
      });
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    };
    update(0);
    animate((dt, t) => update(t));
  }

  /** Glowing crystal clusters poking out of the snow. */
  function crystals() {
    const items = [];
    for (const [x, z] of scatter(70, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 3) && distToRoad(x, z, 120) < hw + 70, { pad: 60 })) {
      const n = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const h = 1.2 + rng() * 2.4;
        const cx = x + (rng() - 0.5) * 2.2, cz = z + (rng() - 0.5) * 2.2;
        items.push({ m: mat4(cx, groundH(cx, cz) + h * 0.4, cz, { s: [h * 0.3, h, h * 0.3], rz: (rng() - 0.5) * 0.7, rx: (rng() - 0.5) * 0.7 }), c: ICE[items.length % 3] });
      }
    }
    instanced(ctx, new THREE.OctahedronGeometry(1, 0), own(new THREE.MeshBasicMaterial({ color: 0xffffff })), items, { outline: false });
  }

  /** A ring of snow-capped mountains far away. */
  function mountains() {
    const n = 22;
    const base = [], caps = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.2;
      const r = extent + 280 + rng() * 170;
      const h = 90 + rng() * 110, w = h * (0.8 + rng() * 0.5);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const ry = rng() * 3;
      base.push({ m: mat4(x, h / 2 - 6, z, { s: [w, h, w], ry }), c: [0x7f8fd8, 0x8fa4e8, 0x9a8fe0][i % 3] });
      caps.push({ m: mat4(x, h * 0.815 - 6, z, { s: [w * 0.38, h * 0.38, w * 0.38], ry }) });
    }
    const cone = new THREE.ConeGeometry(0.5, 1, 7);
    instanced(ctx, cone, toon(0xffffff, { emissive: 0x1a2050, emissiveIntensity: 0.25 }), base, { outline: false });
    instanced(ctx, cone, toon(0xffffff, { emissive: 0x606a90, emissiveIntensity: 0.4 }), caps, { outline: false });
  }
}

/** Frozen river: perpendicular to the road at the bridge, wiggling off both ways, stopping before other road. */
function riverPolyline(def, path, index) {
  const s = def.scenery.river.at * path.length;
  const p = path.pointAt(s);
  const r = path.rightAt(s);
  const hw = path.halfWidth;
  const range = (def.scenery.bridges || [])[0];
  const inBridge = (i) => {
    if (!range) return false;
    const si = i * path.step;
    return si >= range[0] * path.length - 30 && si <= range[1] * path.length + 30;
  };
  const sides = [];
  for (const dir of [-1, 1]) {
    const pts = [];
    for (let d = 0; d <= 240; d += 6) {
      const wig = Math.sin(d * 0.035) * 9 * Math.min(1, d / 40);
      const x = p.x + r.x * d * dir - r.z * wig;
      const z = p.z + r.z * d * dir + r.x * wig;
      const n = index.nearest(x, z, hw + 40);
      if (d > 34 && n.i >= 0 && !inBridge(n.i) && n.dist < hw + 30) break;
      pts.push([x, z]);
    }
    sides.push(pts);
  }
  return [...sides[0].reverse(), ...sides[1].slice(1)];
}

export default { def, buildScenery, prepare, buildRoadDetails };
