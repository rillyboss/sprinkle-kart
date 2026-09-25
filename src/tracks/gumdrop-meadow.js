/**
 * Gumdrop Meadow — track module (data + scenery). Cup: sprinkle-cup.
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
// 2. Gumdrop Meadow — sunny rolling hills, the gentle first track.
// The road is shaped like a big heart (look at the minimap!).
// ---------------------------------------------------------------------------
export const def = makeTrack(
  {
    id: 'gumdrop-meadow',
    name: 'Gumdrop Meadow',
    subtitle: 'Rolling hills of gumdrops and lollipops',
    laps: 3,
    width: 20,
    previewColor: 0x8fe08a,
    cup: 'sprinkle-cup',
    unlock: null,
    theme: {
      skyTop: 0x5fb8ff,
      skyBottom: 0xdff4ff,
      fogColor: 0xe4f6ff,
      fogNear: 170,
      fogFar: 650,
      ground: 0x93e07f,
      road: 0xf5dcae,
      roadAlt: 0xeccd9a,
      curbA: 0xff4d5e,
      curbB: 0xffffff,
      offRoad: 0xb8ec94,
      music: 'meadow',
      sunColor: 0xfff4d6,
      ambientColor: 0xd8f0ff,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      roadSprinkles: { style: 'dots', count: 200, palette: [0xff9fb0, 0xffe39a, 0xa8e6a3, 0xa8d8ff, 0xffffff, 0xd9a86a] },
      groundTints: [0xa8ec8a, 0x7fd67a, 0xc6f59a],
      skirt: { color: 0xfff0f7, trim: 0xff9ccc },
    },
  },
  {
    start: [0, 0],
    heading: 135,
    startAt: 54,
    ops: [
      { s: 170, y: 3, flex: true, mark: 'start-straight' },
      { turn: 90, r: 82, y: 8, mark: 'right-lobe' },
      { turn: 90, r: 82, y: 6, mark: 'right-lobe-2' },
      { s: 20, y: 5 },
      { turn: -90, r: 30, y: 4, mark: 'dip' },
      { s: 20, y: 5, mark: 'dip-exit' },
      { turn: 90, r: 82, y: 9, mark: 'left-lobe' },
      { turn: 90, r: 82, y: 7, mark: 'left-lobe-2' },
      { s: 170, y: 1, flex: true, mark: 'left-side' },
      { turn: 90, r: 40, y: 0, mark: 'tip' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('start-straight', 'end') - 0.03, frac('dip-exit', 'mid'), frac('left-side', 'start') + 0.02, frac('left-side', 'end') - 0.03],
    boostPads: [
      { at: frac('start-straight', 'mid'), lateral: 4 },
      { at: frac('right-lobe-2', 'end'), lateral: -3 },
      { at: frac('left-lobe', 'end'), lateral: 3 },
      { at: frac('left-side', 'mid'), lateral: -4 },
    ],
    scenery: {
      kind: 'meadow',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 10, scale: 0.011 },
      fence: { post: 0xffffff, postAlt: 0xff3b4f, rail: 0xffffff, topper: 'cane', topperColor: 0xff3b4f },
      arch: { a: 0xff3b4f, b: 0xffffff, banner: 0x4fc3ff, text: 'SPRINKLE KART' },
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

  buildMeadowWorld();

  function buildMeadowWorld() {
    const gumColors = [0xff4d5e, 0xff9f40, 0xffd93d, 0x6bd968, 0xb06bff, 0xff7ac8, 0x4fc3ff];
    const domeGeo = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const place = (spots, rMin, rMax) => spots.map(([x, z]) => ({ x, z, y: groundH(x, z) - 0.3, r: rMin + rng() * (rMax - rMin) }));
    const small = place(scatter(170, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 3), { pad: 150 }), 1.2, 3.2);
    const big = [];
    for (const [x, z] of scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 18), { pad: 100 })) {
      const r = 7 + rng() * 9;
      if (clearOfRoad(x, z, FENCE_OFFSET + r + 2)) big.push({ x, z, y: groundH(x, z) - 0.6, r });
      if (big.length >= 14) break;
    }
    const all = [...small, ...big];
    const gums = new THREE.InstancedMesh(domeGeo, toon(0xffffff, { emissive: 0x222222, emissiveIntensity: 0.3 }), all.length);
    const gOut = new THREE.InstancedMesh(pushedCopy(domeGeo, 0.05), outlineMat, all.length);
    const col = new THREE.Color();
    all.forEach((g, i) => {
      const m = mat4(g.x, g.y, g.z, { s: [g.r, g.r * 1.15, g.r] });
      gums.setMatrixAt(i, m);
      gOut.setMatrixAt(i, m);
      gums.setColorAt(i, col.set(gumColors[i % gumColors.length]));
    });
    group.add(gums, gOut);
    // sugar sparkle dots on gumdrops
    const sugar = [];
    all.forEach((g) => {
      const n = Math.min(10, Math.round(g.r * 2));
      for (let k = 0; k < n; k++) {
        const a = rng() * Math.PI * 2, el = rng() * 1.2 + 0.1;
        sugar.push(mat4(g.x + Math.cos(a) * Math.cos(el) * g.r, g.y + Math.sin(el) * g.r * 1.15, g.z + Math.sin(a) * Math.cos(el) * g.r, { s: 0.12 * Math.max(1, g.r * 0.4) }));
      }
    });
    const sugarMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), glow(0xffffff), sugar.length);
    sugar.forEach((m, i) => sugarMesh.setMatrixAt(i, m));
    group.add(sugarMesh);

    lollipops(scatter(46, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 3), { pad: 120 }),
      [[0xff4d5e, 0xffffff], [0x4fc3ff, 0xfff3a8], [0xb06bff, 0xffc2f0], [0x6bd968, 0xffffff]],
      { height: [5, 9], radius: [1.8, 3] });

    // giant candy canes
    const caneTex = ownTex(stripeTexture(0xff3b4f, 0xffffff, 6));
    caneTex.repeat.set(10, 1);
    const caneMat = toonTex(caneTex);
    const caneSpots = scatter(22, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5), { pad: 90 });
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 6, 0), new THREE.Vector3(0, 8, 0),
      new THREE.Vector3(0.9, 9.3, 0), new THREE.Vector3(2, 8.8, 0), new THREE.Vector3(2.4, 7.6, 0),
    ]);
    const caneGeo = new THREE.TubeGeometry(curve, 24, 0.45, 7, false);
    const canes = new THREE.InstancedMesh(caneGeo, caneMat, caneSpots.length);
    const caneOut = new THREE.InstancedMesh(pushedCopy(caneGeo, 0.06), outlineMat, caneSpots.length);
    caneSpots.forEach(([x, z], i) => {
      const m = mat4(x, groundH(x, z) - 0.2, z, { ry: rng() * Math.PI * 2, s: 0.8 + rng() * 0.6 });
      canes.setMatrixAt(i, m);
      caneOut.setMatrixAt(i, m);
    });
    group.add(canes, caneOut);

    // flowers near the road
    const flowerSpots = scatter(420, (x, z) => {
      const d = distToRoad(x, z, 60);
      return d > hw + FENCE_OFFSET + 1.5 && d < hw + 45;
    }, { pad: 60 });
    const stem = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 5);
    const head = new THREE.IcosahedronGeometry(0.32, 0);
    const stems = new THREE.InstancedMesh(stem, toon(0x4caf50), flowerSpots.length);
    const heads = new THREE.InstancedMesh(head, toon(0xffffff), flowerSpots.length);
    const fc = [0xff7ac8, 0xffffff, 0xffe14f, 0xb06bff, 0x4fc3ff, 0xff9f40];
    flowerSpots.forEach(([x, z], i) => {
      const y = groundH(x, z);
      stems.setMatrixAt(i, mat4(x, y + 0.4, z));
      heads.setMatrixAt(i, mat4(x, y + 0.85, z, { s: [1, 0.6, 1] }));
      heads.setColorAt(i, col.set(fc[i % fc.length]));
    });
    group.add(stems, heads);

    // gumdrop "cottage" and bunnies of the meadow: a gingerbread hut in the heart
    const [hx, hz] = def.scenery.center || [center.x, center.z];
    if (clearOfRoad(hx, hz, 30)) buildGingerHouse(hx, hz, groundH(hx, hz));

    // a big rainbow in the sky and soft green background hills
    const rb = new THREE.Group();
    const rainbow = [0xff6f91, 0xffa94d, 0xffe066, 0x8ce99a, 0x74c0fc, 0x9775fa];
    rainbow.forEach((c2, k) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(260 - k * 9, 4.4, 8, 64, Math.PI), own(new THREE.MeshBasicMaterial({ color: c2, transparent: true, opacity: 0.55, fog: false, depthWrite: false })));
      rb.add(m);
    });
    rb.position.set(center.x - 120, -20, center.z - extent - 330);
    rb.rotation.y = 0.35;
    group.add(rb);
    backgroundHills(22, extent + 260, extent + 420, [0x7fd67a, 0xa8ec8a, 0x6cc56a, 0xc6f59a], { hMin: 30, hMax: 70 });
    floatingShapes(extruded(heartShape(), 0.3, 0.08, 5), scatter(18, () => true, { pad: 10 }), [0xff7ac8, 0xffffff, 0xffe14f], { yMin: 12, yMax: 26, scale: [1, 1.8] });
    sparkles(260, center.x, center.z, extent + 40, 3, 25, [0xffffff, 0xfff7b0], 1.3);
  }

  function buildGingerHouse(x, z, y) {
    const G = 0xc98a4b, ICING = 0xffffff;
    batch.add(new THREE.BoxGeometry(12, 8, 10), toon(G), mat4(x, y + 4, z));
    const roof = new THREE.CylinderGeometry(1, 1, 1, 3);
    roof.rotateX(-Math.PI / 2); // triangular prism, ridge along z, apex up
    batch.add(roof, toon(0xff7ac8), mat4(x, y + 10.4, z, { s: [8, 5, 11.4] }));
    batch.add(new THREE.BoxGeometry(12.4, 0.6, 10.4), toon(ICING), mat4(x, y + 8.1, z), false);
    batch.add(new THREE.ShapeGeometry(archShape(3, 5)), toon(0x7a4a33), mat4(x, y, z + 5.03), false);
    for (const dx of [-3.8, 3.8]) {
      batch.add(new THREE.PlaneGeometry(2.2, 2.2), glow(0xfff1a8), mat4(x + dx, y + 4.5, z + 5.03), false);
    }
    const drops = new THREE.SphereGeometry(0.45, 8, 6);
    for (let i = -5; i <= 5; i++) batch.add(drops, toon([0xff4d5e, 0x6bd968, 0xffd93d, 0x4fc3ff][(i + 5) % 4]), mat4(x + i * 1.1, y + 8.6, z + 5.2), false);
    batch.add(new THREE.BoxGeometry(1.6, 4, 1.6), toon(0xff4d5e), mat4(x + 3.5, y + 12, z - 1.5));
    heartFlag(x + 3.5, y + 14, z - 1.5, 0xff4d5e);
  }
}

export default { def, buildScenery };
