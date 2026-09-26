/**
 * Gumball Garden — a Bubble Pop Battle arena (not a race track). A short,
 * extra-wide rounded-triangle loop round a giant gumball machine in a sunny
 * candy garden: giant lollipops, cotton-candy trees, bouncing gumballs and
 * a big turning crank. Built with the normal track kit.
 * OWNER: showcase features & modes.
 */
import * as THREE from 'three';
import { toon, glow } from '../../render/toon.js';
import { makeTrack } from '../../tracks/layout.js';
import { FENCE_OFFSET, mat4 } from '../../tracks/sceneryKit.js';

const GUM_COLORS = [0xff4d6d, 0xffd23f, 0x4fc3ff, 0x7be07b, 0xb57bff, 0xff8fc8, 0xff9a3d];

export const def = makeTrack(
  {
    id: 'gumball-garden',
    name: 'Gumball Garden',
    subtitle: 'Round and round the gumball machine',
    laps: 1,
    width: 26,
    previewColor: 0xff8fb1,
    art: ['🍬', '🌷', '🎈'],
    arena: true,
    cup: null,
    unlock: null,
    theme: {
      skyTop: 0x5fb8ff,
      skyBottom: 0xfff0f7,
      fogColor: 0xfff0f7,
      fogNear: 170,
      fogFar: 600,
      ground: 0x9fe38a,
      road: 0xffe9c2,
      roadAlt: 0xffdcae,
      curbA: 0xff4d6d,
      curbB: 0xffffff,
      offRoad: 0xc4f0a4,
      music: 'meadow',
      sunColor: 0xfff4dc,
      ambientColor: 0xffeef8,
      roadSprinkles: { style: 'dots', count: 160, palette: GUM_COLORS },
      groundTints: [0xa8ec8a, 0x8fdc7a, 0xc6f59a],
      skirt: { color: 0xfff0f7, trim: 0xff8fb1 },
    },
  },
  {
    start: [0, 0],
    heading: 90,
    startAt: 45,
    ops: [
      { s: 110, flex: true, mark: 'garden-run' },
      { turn: 120, r: 36, mark: 'tulip-bend' },
      { s: 110, flex: true, mark: 'lolly-run' },
      { turn: 120, r: 36, mark: 'crank-bend' },
      { s: 110, mark: 'gum-run' },
      { turn: 120, r: 36, mark: 'home-bend' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('garden-run', 'mid'), frac('lolly-run', 'mid'), frac('gum-run', 'mid')],
    boostPads: [
      { at: frac('tulip-bend', 'end'), lateral: 0 },
      { at: frac('crank-bend', 'end'), lateral: 0 },
      { at: frac('home-bend', 'end') - 0.04, lateral: 0 },
    ],
    scenery: {
      kind: 'gumball',
      center: centroid(),
      terrain: 'flat',
      fence: { post: 0xffffff, postAlt: 0xff4d6d, rail: 0xffffff, topper: 'cherry', topperColor: 0xff4d6d },
      arch: { a: 0xff4d6d, b: 0xffffff, banner: 0xffd23f, text: 'BUBBLE BATTLE' },
    },
  }),
);

/** Themed scenery (see ARCHITECTURE.md -> "Scenery ctx API"). */
export function buildScenery(ctx) {
  const {
    group, rng, batch, own, center, extent, groundH, clearOfRoad, animators,
    scatter, cottonCandyTrees, sparkles, backgroundHills, lollipops,
  } = ctx;
  const cx = center.x;
  const cz = center.z;
  const gy = groundH(cx, cz);

  // --- the giant gumball machine ------------------------------------------
  const red = toon(0xff4d6d);
  const base = new THREE.CylinderGeometry(1, 1.2, 1, 24);
  batch.add(base, red, mat4(cx, gy + 4, cz, { s: [8, 8, 8] }));
  batch.add(new THREE.CylinderGeometry(1, 1, 1, 24), toon(0xffd23f), mat4(cx, gy + 8.4, cz, { s: [8.6, 0.8, 8.6] }));
  // coin plate + chute
  batch.add(new THREE.CylinderGeometry(1, 1, 1, 18), toon(0xd6e4f0), mat4(cx, gy + 5, cz + 8.3, { s: [2.4, 0.5, 2.4], rx: Math.PI / 2 }));
  batch.add(new THREE.BoxGeometry(1, 1, 1), toon(0xd6e4f0), mat4(cx, gy + 1.6, cz + 8.6, { s: [3.4, 1.6, 2] }));
  // glass globe
  const R = 11;
  const globeY = gy + 9 + R * 0.92;
  const glass = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20), own(new THREE.MeshPhongMaterial({
    color: 0xeaf7ff, emissive: 0x6d8fbf, emissiveIntensity: 0.15, specular: 0xffffff, shininess: 110,
    transparent: true, opacity: 0.28, depthWrite: false,
  })));
  glass.position.set(cx, globeY, cz);
  glass.renderOrder = 2;
  group.add(glass);
  // cap on top
  batch.add(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), red, mat4(cx, globeY + R - 1.2, cz, { s: [4.5, 3, 4.5] }));
  batch.add(new THREE.SphereGeometry(1.2, 12, 8), toon(0xffd23f), mat4(cx, globeY + R + 2.2, cz, {}));
  // gumballs inside the globe (a gently jiggling heap)
  const gumGeo = new THREE.SphereGeometry(1, 14, 10);
  const gums = [];
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * (R - 1.8);
    const h = rng() * R * 0.9;
    const maxR = Math.sqrt(Math.max(0, (R - 1.6) ** 2 - (h - R * 0.1) ** 2));
    const r = Math.min(rr, maxR);
    gums.push({ x: cx + Math.cos(a) * r, y: globeY - R * 0.8 + h, z: cz + Math.sin(a) * r, ph: rng() * 6, s: 1.3 + rng() * 0.3 });
  }
  const gumMesh = new THREE.InstancedMesh(gumGeo, toon(0xffffff), gums.length);
  const col = new THREE.Color();
  gums.forEach((g, i) => gumMesh.setColorAt(i, col.set(GUM_COLORS[i % GUM_COLORS.length])));
  group.add(gumMesh);
  // the crank
  const crank = new THREE.Group();
  crank.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 5, 10), toon(0xd6e4f0)));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), toon(0xffd23f));
  knob.position.y = 2.6;
  crank.add(knob);
  crank.position.set(cx, gy + 6.2, cz + 8.8);
  group.add(crank);

  // --- garden: lollipops, trees, tulips, gumballs rolling round ------------
  lollipops(scatter(14, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5), { pad: 80 }), [[0xff4d6d, 0xffffff], [0x4fc3ff, 0xffffff], [0xffd23f, 0xff8fc8], [0x7be07b, 0xffffff]], { height: [7, 11], radius: [2, 3.2] });
  cottonCandyTrees(scatter(26, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 8) && Math.hypot(x - cx, z - cz) > 28, { pad: 100 }), [0xffb3d9, 0xbfe9ff, 0xfff0a8]);
  const stem = new THREE.CylinderGeometry(0.18, 0.18, 1, 6);
  const bloom = new THREE.ConeGeometry(1, 1.4, 6, 1, true);
  const tulipSpots = scatter(70, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 2.5), { pad: 60 });
  tulipSpots.forEach(([x, z], i) => {
    const y = groundH(x, z);
    batch.add(stem, toon(0x5fbf5f), mat4(x, y + 1.2, z, { s: [1, 2.4, 1] }), false);
    batch.add(bloom, toon(GUM_COLORS[i % GUM_COLORS.length]), mat4(x, y + 2.8, z, { s: 0.8, rx: Math.PI }), true);
  });
  const rolling = scatter(12, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 6) && Math.hypot(x - cx, z - cz) > 30, { pad: 70 })
    .map(([x, z], i) => ({ x, z, y: groundH(x, z), r: 1.6 + rng() * 1.6, ph: rng() * 6, c: GUM_COLORS[i % GUM_COLORS.length] }));
  const bounce = new THREE.InstancedMesh(gumGeo, toon(0xffffff), rolling.length || 1);
  bounce.count = rolling.length;
  rolling.forEach((g, i) => bounce.setColorAt(i, col.set(g.c)));
  group.add(bounce);

  backgroundHills(12, extent + 160, extent + 240, [0x9fe38a, 0xffd1ec, 0xbfe9ff], { hMin: 30, hMax: 70 });
  sparkles(140, cx, cz, extent + 40, 2, 22, [0xffffff, 0xffe3f3, 0xfff6c4], 1.3);

  const halo = new THREE.Mesh(new THREE.RingGeometry(1, 1.08, 48), glow(0xffffff, { transparent: true, opacity: 0.6 }));
  halo.rotation.x = -Math.PI / 2;
  halo.scale.setScalar(12);
  halo.position.set(cx, gy + 0.08, cz);
  group.add(halo);

  // --- animation ------------------------------------------------------------
  const o = new THREE.Object3D();
  animators.push((dt, t) => {
    crank.rotation.z = t * 1.2;
    for (let i = 0; i < gums.length; i++) {
      const g = gums[i];
      o.position.set(g.x, g.y + Math.abs(Math.sin(t * 2 + g.ph)) * 0.25, g.z);
      o.scale.setScalar(g.s);
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      gumMesh.setMatrixAt(i, o.matrix);
    }
    gumMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < rolling.length; i++) {
      const g = rolling[i];
      const hop = Math.abs(Math.sin(t * 2.4 + g.ph));
      o.position.set(g.x, g.y + g.r + hop * 2.2, g.z);
      o.scale.set(g.r * (1 + (1 - hop) * 0.12), g.r * (1 - (1 - hop) * 0.12), g.r * (1 + (1 - hop) * 0.12));
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      bounce.setMatrixAt(i, o.matrix);
    }
    bounce.instanceMatrix.needsUpdate = true;
  });
}

export default { def, buildScenery };
