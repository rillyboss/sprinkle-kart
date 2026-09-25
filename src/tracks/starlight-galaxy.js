/**
 * Starlight Galaxy — track module (data + scenery). Cup: sprinkle-cup.
 * OWNER: done (original track; changes need a golden refresh, see tests/visual.golden.test.js).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import {
  FENCE_OFFSET, SHOULDER_IN, frames, ribbon, mat4, extruded, heartShape, starShape, archShape,
  pushedCopy, stripeTexture, waffleTexture, distToPolyline,
} from './sceneryKit.js';

// ---------------------------------------------------------------------------
// 3. Starlight Galaxy — a glowing star road floating in space ("lollipop"
// layout: up the stem, round a giant swooping loop, back down the stem).
// ---------------------------------------------------------------------------
export const def = makeTrack(
  {
    id: 'starlight-galaxy',
    name: 'Starlight Galaxy',
    subtitle: "Stella's twinkly road among the planets",
    laps: 3,
    width: 18,
    previewColor: 0x7b6cff,
    art: ['🌟', '🪐', '🌙'], // menu card emoji: big, bottom-left, top-right
    cup: 'sprinkle-cup',
    unlock: null,
    theme: {
      skyTop: 0x0c0630,
      skyBottom: 0x5a2c8f,
      fogColor: 0x2a1654,
      fogNear: 200,
      fogFar: 800,
      ground: 0x3a1f6e,
      road: 0x3a36a6,
      roadAlt: 0x322e94,
      curbA: 0x6ff3ff,
      curbB: 0xff8ce6,
      offRoad: 0x4a3a9a,
      music: 'galaxy',
      sunColor: 0xd8d0ff,
      ambientColor: 0x8a7cff,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      night: true, // unlit curbs/arch, softer sun, no daytime clouds
      skyStars: true,
      roadSprinkles: { style: 'stars', count: 220, palette: [0xffffff, 0x9ff7ff, 0xffe27a, 0xff9ce8] },
      skirt: { color: 0x3b2a86, trim: 0x7ff5ff },
    },
  },
  {
    start: [0, 0],
    heading: 0,
    y0: 4,
    startAt: 54,
    ops: [
      { s: 110, y: 4, mark: 'start-straight' },
      { turn: -30, r: 60, y: 5 },
      { turn: 30, r: 60, y: 6, mark: 'stem-s' },
      { turn: -45, r: 60, y: 8 },
      { turn: 135, r: 95, y: 15, mark: 'loop-rise' },
      { turn: 135, r: 95, y: 9, mark: 'loop-fall' },
      { turn: -45, r: 60, y: 6, mark: 'loop-exit' },
      { s: 90, y: 2, flex: true, mark: 'stem-down' },
      { turn: 90, r: 34, y: 1, mark: 'bottom-left' },
      { s: 40, y: 1, flex: true, mark: 'bottom' },
      { turn: 90, r: 34, y: 4, mark: 'bottom-right' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('stem-s', 'end') + 0.01, frac('loop-rise', 'end'), frac('stem-down', 'mid')],
    boostPads: [
      { at: frac('start-straight', 'mid') + 0.02, lateral: -3.5 },
      { at: frac('loop-rise', 'mid'), lateral: 3 },
      { at: frac('loop-exit', 'end') + 0.01, lateral: -3 },
      { at: frac('bottom', 'mid'), lateral: 0 },
    ],
    scenery: {
      kind: 'galaxy',
      center: centroid('loop-rise', 'loop-fall'),
      terrain: 'void',
      fence: { post: 0xfff6a8, postAlt: 0x9ff7ff, rail: 0x9ff7ff, topper: 'star', topperColor: 0xfff27a, glow: true },
      arch: { a: 0x9f8cff, b: 0xfff27a, banner: 0x6a4cff, text: 'SPRINKLE KART' },
    },
  }),
);

/**
 * Themed scenery. `ctx` is the scenery context from src/tracks/core.js
 * (see ARCHITECTURE.md → "Scenery ctx API").
 */
export function buildScenery(ctx) {
  const {
    def, path, group, rng, batch, own, ownTex, outlineMat, toonTex, toonVC,
    hw, L, bounds, center, extent, groundH, distToRoad, clearOfRoad, animators, loopFrames,
    scatter, cottonCandyTrees, floatingShapes, sparkles, backgroundHills, lollipops, tower, heartFlag, fallingSprinkles,
  } = ctx;

  buildGalaxyWorld();

  function buildGalaxyWorld() {
    const [gx, gz] = def.scenery.center || [center.x, center.z];
    // a sea of purple clouds far below
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const cloudCount = 200;
    const cloudMat = toon(0xffffff, { emissive: 0x2a1060, emissiveIntensity: 0.6 });
    const clouds = new THREE.InstancedMesh(puff, cloudMat, cloudCount);
    const col = new THREE.Color();
    const cc = [0x8a5cff, 0xb57bff, 0xff8ce6, 0x6a4cff, 0x9f8cff];
    for (let i = 0; i < cloudCount; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (extent + 420);
      const s = 18 + rng() * 30;
      clouds.setMatrixAt(i, mat4(center.x + Math.cos(a) * r, -70 - rng() * 25, center.z + Math.sin(a) * r, { s: [s * 1.6, s * 0.7, s * 1.6] }));
      clouds.setColorAt(i, col.set(cc[i % cc.length]));
    }
    group.add(clouds);

    // floating star-crystal islands under the road
    const rock = new THREE.ConeGeometry(1, 1, 6);
    rock.rotateX(Math.PI);
    const islands = [];
    for (let s = 20; s < L; s += 70) {
      const p = path.pointAt(s);
      islands.push({ x: p.x, y: p.y - 3.4, z: p.z, r: 6 + rng() * 3 });
    }
    const isl = new THREE.InstancedMesh(rock, toon(0x5a3aa8), islands.length);
    islands.forEach((it, i) => isl.setMatrixAt(i, mat4(it.x, it.y - it.r * 0.6, it.z, { s: [it.r, it.r * 1.3, it.r], ry: rng() })));
    group.add(isl);
    const crystalGeo = new THREE.OctahedronGeometry(1, 0);
    const crystals = [];
    islands.forEach((it) => {
      for (let k = 0; k < 3; k++) {
        const a = rng() * Math.PI * 2;
        crystals.push({ x: it.x + Math.cos(a) * it.r * 0.8, y: it.y - it.r * 0.3 - rng() * 3, z: it.z + Math.sin(a) * it.r * 0.8, s: 0.8 + rng() * 1.2, c: [0x7ff5ff, 0xff9ce8, 0xfff27a][k] });
      }
    });
    const cr = new THREE.InstancedMesh(crystalGeo, own(new THREE.MeshBasicMaterial({ color: 0xffffff })), crystals.length);
    crystals.forEach((c2, i) => {
      cr.setMatrixAt(i, mat4(c2.x, c2.y, c2.z, { s: [c2.s * 0.6, c2.s * 1.4, c2.s * 0.6] }));
      cr.setColorAt(i, col.set(c2.c));
    });
    group.add(cr);

    // planets
    const planets = [
      { d: [260, 90, -180], r: 45, c: 0xff9ce8, ring: 0xfff27a, face: true },
      { d: [-300, 140, 120], r: 60, c: 0x7fd3ff, ring: 0xb57bff },
      { d: [120, 200, 380], r: 34, c: 0xffc46b, ring: null },
      { d: [-160, 60, -360], r: 26, c: 0x9ff7a8, ring: 0xffffff },
      { d: [420, 170, 220], r: 22, c: 0xd8b8ff, ring: null },
    ];
    for (const pl of planets) {
      const x = center.x + pl.d[0] * 1.45, y = pl.d[1] * 1.3, z = center.z + pl.d[2] * 1.45;
      const pm = own(toon(pl.c, { unique: true, emissive: pl.c, emissiveIntensity: 0.25 }));
      pm.fog = false;
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(pl.r, 36, 24), pm);
      sphere.position.set(x, y, z);
      group.add(sphere);
      if (pl.ring) {
        const rmat = own(new THREE.MeshBasicMaterial({ color: pl.ring, transparent: true, opacity: 0.7, side: THREE.DoubleSide, fog: false }));
        const ring = new THREE.Mesh(new THREE.RingGeometry(pl.r * 1.35, pl.r * 1.9, 64), rmat);
        ring.position.copy(sphere.position);
        ring.rotation.set(-Math.PI / 2 + 0.4, 0.3, 0);
        group.add(ring);
      }
      if (pl.face) {
        // a sleepy smiling planet face, turned toward the track
        const face = new THREE.Group();
        face.position.copy(sphere.position);
        face.lookAt(center.x, 10, center.z);
        const fm = own(new THREE.MeshBasicMaterial({ color: 0x3a2046, fog: false }));
        for (const ex of [-0.33, 0.33]) {
          const eye = new THREE.Mesh(new THREE.TorusGeometry(pl.r * 0.1, pl.r * 0.025, 6, 16, Math.PI), fm);
          eye.position.set(ex * pl.r, pl.r * 0.15, pl.r * 0.96);
          eye.rotation.z = Math.PI;
          face.add(eye);
        }
        const smile = new THREE.Mesh(new THREE.TorusGeometry(pl.r * 0.22, pl.r * 0.03, 6, 20, Math.PI), fm);
        smile.position.set(0, -pl.r * 0.12, pl.r * 0.93);
        smile.rotation.z = Math.PI;
        face.add(smile);
        const cm = own(new THREE.MeshBasicMaterial({ color: 0xff6fae, fog: false }));
        for (const ex of [-0.5, 0.5]) {
          const cheek = new THREE.Mesh(new THREE.CircleGeometry(pl.r * 0.09, 16), cm);
          cheek.position.set(ex * pl.r, -pl.r * 0.02, pl.r * 0.88);
          cheek.rotation.y = ex * 0.5;
          face.add(cheek);
        }
        group.add(face);
      }
    }

    // soft glowing lane dashes on the star road
    const dashGeos = [];
    for (let s0 = 0; s0 < L - 6; s0 += 8) {
      const fr = frames(path, s0, s0 + 3.5, 0.7);
      for (const lat of [-hw * 0.34, hw * 0.34]) dashGeos.push(ribbon(fr, lat - 0.22, lat + 0.22, 0.05));
    }
    const dashMat = own(new THREE.MeshBasicMaterial({ color: 0x9ff7ff, transparent: true, opacity: 0.55, depthWrite: false }));
    const dashes = new THREE.Mesh(mergeGeometries(dashGeos), dashMat);
    dashes.renderOrder = 1;
    group.add(dashes);
    animators.push((dt, t) => { dashMat.opacity = 0.4 + Math.sin(t * 2.5) * 0.15; });

    // the observatory on its own floating island in the big loop
    buildObservatory(gx, gz);

    // glowing star rings over the road
    const ringMats = [];
    for (let k = 0; k < 6; k++) {
      const s = ((k + 0.5) / 6) * L;
      if (Math.abs(path.delta(s, 0)) < 30) continue;
      const p = path.pointAt(s);
      const h = path.headingAt(s);
      const m = own(new THREE.MeshBasicMaterial({ color: 0x9ff7ff, transparent: true, opacity: 0.8 }));
      ringMats.push(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(hw + FENCE_OFFSET + 1.5, 0.45, 8, 48, Math.PI), m);
      ring.position.copy(p);
      ring.rotation.y = h;
      group.add(ring);
    }
    animators.push((dt, t) => ringMats.forEach((m, i) => m.color.setHSL((0.5 + t * 0.05 + i * 0.12) % 1, 0.9, 0.72)));

    // twinkly stars floating around
    const starGeo = extruded(starShape(5, 1, 0.45), 0.35, 0.08, 1);
    floatingShapes(starGeo, scatter(60, (x, z) => clearOfRoad(x, z, 8), { pad: 90 }), [0xfff27a, 0xffffff, 0x9ff7ff, 0xff9ce8], { yMin: -6, yMax: 30, scale: [1.2, 3], glowy: true });
    sparkles(700, center.x, center.z, extent + 120, -40, 80, [0xffffff, 0x9ff7ff, 0xfff27a, 0xff9ce8], 2.4);
    shootingStars();
  }

  function buildObservatory(x, z) {
    // built at 1x then scaled up via a helper that scales around (x, y, z)
    const S = 1.5;
    const y = -2;
    const add = batch.add.bind(batch);
    const scaled = (geo, mat, m, outline) => add(geo, mat, new THREE.Matrix4().makeTranslation(x, y, z)
      .multiply(new THREE.Matrix4().makeScale(S, S, S)).multiply(new THREE.Matrix4().makeTranslation(-x, -y, -z)).multiply(m), outline);
    scaled(new THREE.ConeGeometry(26, 34, 8).rotateX(Math.PI), toon(0x5a3aa8), mat4(x, y - 17, z));
    scaled(new THREE.CylinderGeometry(26, 26, 2, 8), toon(0x9f7bff), mat4(x, y, z));
    scaled(new THREE.CylinderGeometry(9, 10, 10, 24), toon(0xf4eeff), mat4(x, y + 6, z));
    scaled(new THREE.SphereGeometry(9.4, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xbfd4ff), mat4(x, y + 11, z));
    scaled(new THREE.BoxGeometry(2.4, 9, 0.6), toon(0x3a2a7a), mat4(x, y + 15, z + 8.4, { rx: -0.35 }), false);
    scaled(new THREE.CylinderGeometry(1.1, 1.5, 12, 14), toon(0xfff27a), mat4(x, y + 20, z + 5, { rx: 0.9 }));
    scaled(new THREE.TorusGeometry(9.2, 0.4, 8, 32), toon(0x9ff7ff), mat4(x, y + 11, z, { rx: Math.PI / 2 }), false);
    const star = extruded(starShape(5, 1, 0.45), 0.4, 0.08);
    scaled(star, glow(0xfff27a), mat4(x, y + 24, z, { s: 3 }), false);
    // lamp posts around the island
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      scaled(new THREE.CylinderGeometry(0.25, 0.3, 4, 6), toon(0xffffff), mat4(x + Math.cos(a) * 20, y + 3, z + Math.sin(a) * 20), false);
      scaled(new THREE.SphereGeometry(0.9, 10, 8), glow([0x9ff7ff, 0xff9ce8, 0xfff27a][k % 3]), mat4(x + Math.cos(a) * 20, y + 5.4, z + Math.sin(a) * 20), false);
    }
  }

  function shootingStars() {
    const n = 5;
    const geo = new THREE.CylinderGeometry(0.0, 1.2, 40, 6);
    geo.rotateZ(Math.PI / 2);
    const mats = [];
    const items = [];
    for (let i = 0; i < n; i++) {
      const m = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, depthWrite: false }));
      mats.push(m);
      const mesh = new THREE.Mesh(geo, m);
      group.add(mesh);
      items.push({ mesh, m, t: rng() * 6, dur: 1.4, from: new THREE.Vector3(), dir: new THREE.Vector3() });
    }
    const reset = (it) => {
      const a = rng() * Math.PI * 2;
      it.from.set(center.x + Math.cos(a) * 500, 220 + rng() * 160, center.z + Math.sin(a) * 500);
      it.dir.set(-Math.cos(a + 0.6), -0.25, -Math.sin(a + 0.6)).normalize();
      it.mesh.rotation.set(0, -Math.atan2(it.dir.z, it.dir.x), Math.asin(it.dir.y));
      it.t = -(1 + rng() * 5);
    };
    items.forEach(reset);
    animators.push((dt) => {
      for (const it of items) {
        it.t += dt;
        if (it.t < 0) { it.m.opacity = 0; continue; }
        if (it.t > it.dur) { reset(it); continue; }
        it.mesh.position.copy(it.from).addScaledVector(it.dir, it.t * 380);
        it.m.opacity = Math.sin((it.t / it.dur) * Math.PI) * 0.9;
      }
    });
  }
}

export default { def, buildScenery };
