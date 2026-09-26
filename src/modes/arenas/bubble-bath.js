/**
 * Bubble Bath Bowl — a Bubble Pop Battle arena (not a race track: it is not
 * in the track registry or the lineup). A short, extra-wide rounded-square
 * loop round a giant claw-foot bathtub full of foam, with a rubber duck
 * bobbing in it, soap bubbles floating everywhere, sponge blocks and shampoo
 * bottles. Built with the normal track kit (makeTrack + buildTrack(def, path, { module })).
 * OWNER: showcase features & modes.
 */
import * as THREE from 'three';
import { toon, glow } from '../../render/toon.js';
import { makeTrack } from '../../tracks/layout.js';
import { FENCE_OFFSET, mat4 } from '../../tracks/sceneryKit.js';

const CORNER_R = 34;

export const def = makeTrack(
  {
    id: 'bubble-bath-bowl',
    name: 'Bubble Bath Bowl',
    subtitle: 'Splish, splash, POP!',
    laps: 1,
    width: 26,
    previewColor: 0x8fd8ff,
    art: ['🛁', '🫧', '🦆'],
    arena: true,
    cup: null,
    unlock: null,
    theme: {
      skyTop: 0x7cc8ff,
      skyBottom: 0xe9f7ff,
      fogColor: 0xe6f6ff,
      fogNear: 160,
      fogFar: 560,
      ground: 0xc9ecff,
      road: 0xfff6fb,
      roadAlt: 0xf2e9ff,
      curbA: 0x7ad3ff,
      curbB: 0xffffff,
      offRoad: 0xdff4ff,
      music: 'bubblegum-bay',
      sunColor: 0xfff6ea,
      ambientColor: 0xe0f2ff,
      roadSprinkles: { style: 'dots', count: 140, palette: [0xbfe9ff, 0xffd1ec, 0xffffff, 0xd9ccff] },
      groundTints: [0xd4f0ff, 0xbfe6ff, 0xe4f6ff],
      skirt: { color: 0xffffff, trim: 0x8fd8ff },
    },
  },
  {
    start: [0, 0],
    heading: 90,
    startAt: 36,
    ops: [
      { s: 90, flex: true, mark: 'tile-run' },
      { turn: 90, r: CORNER_R, mark: 'duck-corner' },
      { s: 60, flex: true, mark: 'sponge-side' },
      { turn: 90, r: CORNER_R, mark: 'tap-corner' },
      { s: 90, mark: 'foam-run' },
      { turn: 90, r: CORNER_R, mark: 'soap-corner' },
      { s: 60, mark: 'bottle-side' },
      { turn: 90, r: CORNER_R, mark: 'home-corner' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('tile-run', 'mid'), frac('sponge-side', 'mid'), frac('foam-run', 'mid'), frac('bottle-side', 'mid')],
    boostPads: [
      { at: frac('duck-corner', 'end'), lateral: 0 },
      { at: frac('soap-corner', 'end'), lateral: 0 },
    ],
    scenery: {
      kind: 'bath',
      center: centroid(),
      terrain: 'flat',
      fence: { post: 0xffffff, postAlt: 0x8fd8ff, rail: 0xffffff, topper: 'ball', topperColor: 0xffd1ec },
      arch: { a: 0x8fd8ff, b: 0xffffff, banner: 0xff8fc8, text: 'BUBBLE BATTLE' },
    },
  }),
);

/** Themed scenery (see ARCHITECTURE.md -> "Scenery ctx API"). */
export function buildScenery(ctx) {
  const {
    group, rng, batch, own, center, extent, groundH, clearOfRoad, animators,
    scatter, cottonCandyTrees, sparkles, backgroundHills,
  } = ctx;
  const cx = center.x;
  const cz = center.z;
  const gy = groundH(cx, cz);

  // --- the giant bathtub in the middle -----------------------------------
  const tubW = 30, tubL = 16, tubH = 7;
  const WATER_Y = gy + tubH * 0.8;
  const white = toon(0xffffff);
  // an open bowl (the lower half of a squashed sphere), white inside and out
  const bowl = new THREE.SphereGeometry(1, 32, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  batch.add(bowl, toon(0xffffff, { side: THREE.DoubleSide }), mat4(cx, gy + tubH, cz, { s: [tubL / 2, tubH, tubW / 2] }), false);
  const rim = new THREE.TorusGeometry(1, 0.06, 8, 48);
  batch.add(rim, toon(0xbfe9ff), mat4(cx, gy + tubH, cz, { s: [tubL / 2, tubW / 2, 8], rx: Math.PI / 2 }));
  // golden claw feet
  const foot = new THREE.SphereGeometry(1, 12, 8);
  for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    batch.add(foot, toon(0xffd46b), mat4(cx + fx * tubL * 0.36, gy + 0.9, cz + fz * tubW * 0.36, { s: [1.3, 1.6, 1.3] }));
  }
  // the tap
  const pipe = new THREE.CylinderGeometry(0.7, 0.7, 1, 12);
  batch.add(pipe, toon(0xd6e4f0), mat4(cx, gy + tubH + 3, cz - tubW / 2 + 1, { s: [1, 6, 1] }));
  batch.add(pipe, toon(0xd6e4f0), mat4(cx, gy + tubH + 5.6, cz - tubW / 2 + 3, { s: [1, 4.5, 1], rx: Math.PI / 2 }));
  batch.add(new THREE.SphereGeometry(1.4, 12, 8), toon(0xff8fc8), mat4(cx, gy + tubH + 6.6, cz - tubW / 2 + 1, {}));

  // water + foam heap (not outlined: soft)
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 40), own(new THREE.MeshToonMaterial({ color: 0x7fd4ff })));
  water.rotation.x = -Math.PI / 2;
  water.scale.set(tubL / 2 * 0.97, tubW / 2 * 0.97, 1);
  water.position.set(cx, WATER_Y, cz);
  group.add(water);
  const foamGeo = new THREE.IcosahedronGeometry(1, 1);
  const foamMat = toon(0xffffff, { emissive: 0xbfe9ff, emissiveIntensity: 0.25 });
  const foam = new THREE.InstancedMesh(foamGeo, foamMat, 26);
  const foamItems = [];
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng();
    foamItems.push({ x: cx + Math.cos(a) * r * (tubL / 2 - 2.5), z: cz + Math.sin(a) * r * (tubW / 2 - 4), s: 1.2 + rng() * 1.8, ph: rng() * 6 });
  }
  group.add(foam);

  // rubber duck bobbing in the tub
  const duck = new THREE.Group();
  const yellow = toon(0xffd93d);
  const body = new THREE.Mesh(new THREE.SphereGeometry(2.2, 18, 12), yellow);
  body.scale.set(1.2, 0.9, 1);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), yellow);
  head.position.set(1.4, 2, 0);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 10), toon(0xff9a3d));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(2.9, 1.8, 0);
  const eyeGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const eyeL = new THREE.Mesh(eyeGeo, toon(0x3a2440));
  eyeL.position.set(2.3, 2.5, 0.65);
  const eyeR = eyeL.clone();
  eyeR.position.z = -0.65;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.4, 10), yellow);
  tail.rotation.z = Math.PI / 2 + 0.6;
  tail.position.set(-2.6, 1, 0);
  duck.add(body, head, beak, eyeL, eyeR, tail);
  duck.scale.setScalar(1.5);
  group.add(duck);

  // --- big floating soap bubbles (shiny, see-through) --------------------
  const bubbleMat = own(new THREE.MeshPhongMaterial({
    color: 0xd9f3ff, emissive: 0x5a7dbf, emissiveIntensity: 0.2, specular: 0xffffff, shininess: 90,
    transparent: true, opacity: 0.35, depthWrite: false,
  }));
  const bubbleGeo = new THREE.SphereGeometry(1, 18, 12);
  const spots = scatter(34, (x, z) => clearOfRoad(x, z, 6), { pad: 60 });
  const bubbles = spots.map(([x, z]) => ({ x, z, y: 5 + rng() * 16, s: 1.2 + rng() * 2.6, ph: rng() * 6, sp: 0.4 + rng() * 0.6 }));
  const bubbleMesh = new THREE.InstancedMesh(bubbleGeo, bubbleMat, bubbles.length || 1);
  bubbleMesh.count = bubbles.length;
  group.add(bubbleMesh);

  // --- sponges, shampoo bottles and ducks round the outside --------------
  const spongeGeo = new THREE.BoxGeometry(1, 1, 1);
  const spongeCols = [0xffe36b, 0xa8f0c0, 0xffb3d9];
  const around = scatter(22, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5) && Math.hypot(x - cx, z - cz) > 30, { pad: 70 });
  around.forEach(([x, z], i) => {
    const y = groundH(x, z);
    if (i % 3 === 0) {
      batch.add(spongeGeo, toon(spongeCols[i % spongeCols.length]), mat4(x, y + 1.6, z, { s: [6, 3.2, 4], ry: rng() * 3 }));
    } else if (i % 3 === 1) {
      const c = [0xff8fc8, 0x9ad0ff, 0xc9a8ff][i % 3];
      batch.add(pipe, toon(c), mat4(x, y + 4, z, { s: [2.4, 8, 2.4] }));
      batch.add(new THREE.SphereGeometry(1, 12, 8), toon(c), mat4(x, y + 8, z, { s: [2.4, 1.2, 2.4] }));
      batch.add(pipe, white, mat4(x, y + 9.4, z, { s: [0.9, 2, 0.9] }));
    } else {
      const s = 1.2 + rng() * 0.8;
      batch.add(new THREE.SphereGeometry(1.6, 12, 8), yellow, mat4(x, y + 1.3 * s, z, { s: [1.3 * s, s, s] }));
      batch.add(new THREE.SphereGeometry(1, 12, 8), yellow, mat4(x + 1.6 * s, y + 2.8 * s, z, { s }));
      batch.add(new THREE.ConeGeometry(0.4, 0.9, 8), toon(0xff9a3d), mat4(x + 2.6 * s, y + 2.7 * s, z, { s, rz: -Math.PI / 2 }));
    }
  });

  cottonCandyTrees(scatter(16, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 8) && Math.hypot(x - cx, z - cz) > 40, { pad: 90 }), [0xbfe9ff, 0xffd1ec, 0xe2d4ff]);
  backgroundHills(10, extent + 150, extent + 230, [0xcfeeff, 0xffe0f1, 0xe6dcff], { hMin: 25, hMax: 55 });
  sparkles(160, cx, cz, extent + 40, 2, 22, [0xffffff, 0xd9f3ff, 0xffe3f3], 1.4);

  // --- animation ----------------------------------------------------------
  const o = new THREE.Object3D();
  animators.push((dt, t) => {
    duck.position.set(cx + Math.sin(t * 0.4) * 2.5, WATER_Y + 0.6 + Math.sin(t * 2.2) * 0.35, cz + Math.cos(t * 0.3) * 4);
    duck.rotation.set(Math.sin(t * 1.7) * 0.08, t * 0.25, Math.sin(t * 2.2) * 0.1);
    for (let i = 0; i < foamItems.length; i++) {
      const f = foamItems[i];
      o.position.set(f.x, WATER_Y + f.s * 0.2, f.z);
      o.scale.setScalar(f.s * (1 + Math.sin(t * 1.5 + f.ph) * 0.06));
      o.rotation.set(0, f.ph + t * 0.1, 0);
      o.updateMatrix();
      foam.setMatrixAt(i, o.matrix);
    }
    foam.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      o.position.set(b.x + Math.sin(t * b.sp + b.ph) * 2, b.y + Math.sin(t * b.sp * 1.3 + b.ph) * 1.5, b.z + Math.cos(t * b.sp + b.ph) * 2);
      const wob = 1 + Math.sin(t * 3 + b.ph) * 0.05;
      o.scale.set(b.s * wob, b.s / wob, b.s * wob);
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      bubbleMesh.setMatrixAt(i, o.matrix);
    }
    bubbleMesh.instanceMatrix.needsUpdate = true;
  });

  // a glowing rim light round the tub so it reads from far away
  const halo = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 48), glow(0xffffff, { transparent: true, opacity: 0.6 }));
  halo.rotation.x = -Math.PI / 2;
  halo.scale.set(tubL / 2 + 1, tubW / 2 + 1, 1);
  halo.position.set(cx, gy + 0.08, cz);
  group.add(halo);
}

export default { def, buildScenery };
