/**
 * Sundae Slopes — track module (data + scenery). Cup: sprinkle-cup.
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
// 4. Sundae Slopes — up an ice-cream mountain and down past chocolate rivers.
// ---------------------------------------------------------------------------
export const def = makeTrack(
  {
    id: 'sundae-slopes',
    name: 'Sundae Slopes',
    subtitle: 'Ice-cream mountains with a cherry on top',
    laps: 3,
    width: 18,
    previewColor: 0x9fe8ff,
    cup: 'sprinkle-cup',
    unlock: null,
    theme: {
      skyTop: 0x7fc4ff,
      skyBottom: 0xfff0f6,
      fogColor: 0xf4f0ff,
      fogNear: 160,
      fogFar: 620,
      ground: 0xfff8ee,
      road: 0xb9774f, // milk chocolate
      roadAlt: 0xc98a5e,
      curbA: 0xffffff, // whipped cream
      curbB: 0xffe9f2,
      offRoad: 0xfde7f0,
      music: 'sundae',
      sunColor: 0xffffff,
      ambientColor: 0xe6f0ff,
      // builder theme extras (see ARCHITECTURE.md → theme fields)
      roadSprinkles: { style: 'dashes', count: 95, palette: [0xff8fc4, 0x8fd8ff, 0xfff1a8, 0xa8ecb0, 0xffffff, 0xd2b8ff] },
      groundTints: [0xffd1e6, 0xd4f7e4, 0xfff0c2],
      groundTintMix: 0.75,
      skirt: { color: 0xd9a15c, trim: 0xff9ec4 },
      pillar: { shape: 'box', color: 0xe0a860, ring: 0xff9ec4 },
    },
  },
  {
    start: [0, 0],
    heading: 0,
    startAt: 54,
    ops: [
      { s: 70, flex: true, mark: 'start-straight' },
      { turn: -90, r: 60, y: 2, mark: 'first-turn' },
      { s: 60, y: 6, mark: 'climb' },
      { turn: 180, r: 28, y: 9, mark: 'hairpin' },
      { s: 100, y: 12, mark: 'summit-run' },
      { turn: -90, r: 60, y: 14, mark: 'summit' },
      { turn: -90, r: 60, y: 12, mark: 'summit-2' },
      { s: 80, y: 7, flex: true, mark: 'slide' },
      { turn: -90, r: 55, y: 4, mark: 'valley-turn' },
      { s: 100, y: 2.5, mark: 'approach' },
      { s: 34, y: 2.5, mark: 'bridge' },
      { s: 107, y: 0.5, mark: 'riverside' },
      { turn: -90, r: 55, y: 0, mark: 'top-turn' },
      { s: 100, y: 0, mark: 'top' },
      { turn: -90, r: 55, y: 0, mark: 'last-turn' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('climb', 'mid'), frac('summit-run', 'mid'), frac('slide', 'mid'), frac('top', 'mid')],
    boostPads: [
      { at: frac('first-turn', 'end') + 0.006, lateral: -3 },
      { at: frac('hairpin', 'end') + 0.01, lateral: 3 },
      { at: frac('slide', 'start') + 0.01, lateral: -3.5 },
      { at: frac('riverside', 'mid'), lateral: 3 },
    ],
    scenery: {
      kind: 'sundae',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 8, scale: 0.013 },
      bridges: [[frac('bridge', 'start') - 0.02, frac('bridge', 'end') + 0.02]],
      river: { at: frac('bridge', 'mid') },
      fence: { post: 0xfff4e0, postAlt: 0xffb3d1, rail: 0xfff4e0, topper: 'cherry', topperColor: 0xe8203a },
      arch: { a: 0xe0a860, b: 0xfff4e0, banner: 0xff8cc6, text: 'SPRINKLE KART' },
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

  buildSundaeWorld();

  function buildSundaeWorld() {
    const river = def.scenery.riverLine || [];
    if (river.length) {
      // chocolate river ribbon + little pools at its ends
      const pos = [];
      const hasPool = [river[0], river[river.length - 1]].map((e) => clearOfRoad(e[0], e[1], FENCE_OFFSET + 26));
      // taper the river into a little trickle at an end without a pool
      const widthAt = (i) => {
        const fromStart = i, fromEnd = river.length - 1 - i;
        let k = 1;
        if (!hasPool[0]) k = Math.min(k, 0.25 + fromStart * 0.25);
        if (!hasPool[1]) k = Math.min(k, 0.25 + fromEnd * 0.25);
        return 9 * Math.min(1, k);
      };
      for (let i = 0; i < river.length - 1; i++) {
        const [ax, az] = river[i], [bx, bz] = river[i + 1];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
        const wa = widthAt(i), wb = widthAt(i + 1);
        const ux = -dz / len, uz = dx / len;
        const y = -1.2;
        pos.push(ax - ux * wa, y, az - uz * wa, bx - ux * wb, y, bz - uz * wb, ax + ux * wa, y, az + uz * wa);
        pos.push(ax + ux * wa, y, az + uz * wa, bx - ux * wb, y, bz - uz * wb, bx + ux * wb, y, bz + uz * wb);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const chocoMat = own(toon(0x7a4127, { unique: true, emissive: 0x2a1208, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
      group.add(new THREE.Mesh(g, chocoMat));
      for (const [k, end] of [river[0], river[river.length - 1]].entries()) {
        if (!hasPool[k]) continue;
        const pool = new THREE.Mesh(new THREE.CircleGeometry(15, 32), chocoMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(end[0], -1.19, end[1]);
        group.add(pool);
      }
      // marshmallows bobbing in the chocolate
      const mm = [];
      for (let i = 0; i < river.length; i += 3) mm.push({ x: river[i][0] + (rng() - 0.5) * 8, z: river[i][1] + (rng() - 0.5) * 8, ph: rng() * 6 });
      const mGeo = new THREE.CylinderGeometry(1, 1, 1.4, 14);
      const mMesh = new THREE.InstancedMesh(mGeo, toon(0xffffff), mm.length);
      const mc = new THREE.Color();
      mm.forEach((m, i) => mMesh.setColorAt(i, mc.set([0xffffff, 0xffd1e6, 0xd4f7e4][i % 3])));
      group.add(mMesh);
      animators.push((dt, t) => {
        mm.forEach((m, i) => mMesh.setMatrixAt(i, mat4(m.x, -1 + Math.sin(t * 1.4 + m.ph) * 0.15, m.z, { rz: 1.4, ry: m.ph + t * 0.1 })));
        mMesh.instanceMatrix.needsUpdate = true;
      });
    }

    // ice-cream scoop mountains
    const flavours = [0xffb3d1, 0xb8f2d6, 0xf2c28a, 0xfff1d6, 0xc7b8ff, 0xffe28a];
    const scoopGeo = new THREE.SphereGeometry(1, 28, 16);
    const drip = new THREE.CapsuleGeometry(0.5, 1, 2, 6);
    const scoops = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng() * 0.2;
      const r = extent + 160 + rng() * 150;
      scoops.push({ x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, y: -8, r: 45 + rng() * 40, c: flavours[i % flavours.length], cherry: i % 3 === 0 });
    }
    for (const [x, z] of scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 26), { pad: 60 })) {
      const r = 10 + rng() * 10;
      if (!clearOfRoad(x, z, FENCE_OFFSET + r + 3)) continue;
      scoops.push({ x, z, y: groundH(x, z) - r * 0.35, r, c: flavours[scoops.length % flavours.length], cherry: rng() < 0.6 });
      if (scoops.length > 26) break;
    }
    const scoopMesh = new THREE.InstancedMesh(scoopGeo, toon(0xffffff), scoops.length);
    const scoopOut = new THREE.InstancedMesh(pushedCopy(scoopGeo, 0.02), outlineMat, scoops.length);
    const col = new THREE.Color();
    const drips = [];
    const cherries = [];
    scoops.forEach((s, i) => {
      const m = mat4(s.x, s.y, s.z, { s: [s.r, s.r * 0.8, s.r] });
      scoopMesh.setMatrixAt(i, m);
      scoopOut.setMatrixAt(i, m);
      scoopMesh.setColorAt(i, col.set(s.c));
      const nd = 10;
      for (let k = 0; k < nd; k++) {
        const a = (k / nd) * Math.PI * 2 + rng() * 0.3;
        const len = 0.8 + rng() * 1.2;
        drips.push({ m: mat4(s.x + Math.cos(a) * s.r * 0.93, s.y - s.r * 0.12 - len * s.r * 0.08, s.z + Math.sin(a) * s.r * 0.93, { s: [s.r * 0.09, s.r * 0.09 * len * 2, s.r * 0.09] }), c: s.c });
      }
      if (s.cherry) cherries.push(mat4(s.x, s.y + s.r * 0.8 + s.r * 0.08, s.z, { s: s.r * 0.14 }));
    });
    group.add(scoopMesh, scoopOut);
    const dripMesh = new THREE.InstancedMesh(drip, toon(0xffffff), drips.length);
    drips.forEach((d, i) => { dripMesh.setMatrixAt(i, d.m); dripMesh.setColorAt(i, col.set(d.c)); });
    group.add(dripMesh);
    const cherryMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), toon(0xe8203a, { emissive: 0x550010, emissiveIntensity: 0.4 }), cherries.length);
    cherries.forEach((m, i) => cherryMesh.setMatrixAt(i, m));
    group.add(cherryMesh);

    // waffle-cone towers with scoops on top
    const waffleTex = ownTex(waffleTexture());
    waffleTex.repeat.set(3, 2);
    const coneGeo = new THREE.ConeGeometry(1, 2.4, 20, 1, true);
    coneGeo.rotateX(Math.PI);
    const coneSpots = scatter(16, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 8) && distToRoad(x, z) < hw + 60, { pad: 60 });
    const cones = new THREE.InstancedMesh(coneGeo, toonTex(waffleTex, 0xffffff, { side: THREE.DoubleSide }), coneSpots.length);
    const tops = new THREE.InstancedMesh(scoopGeo, toon(0xffffff), coneSpots.length);
    const topsOut = new THREE.InstancedMesh(pushedCopy(scoopGeo, 0.05), outlineMat, coneSpots.length);
    coneSpots.forEach(([x, z], i) => {
      const s = 2.6 + rng() * 2;
      const y = groundH(x, z);
      cones.setMatrixAt(i, mat4(x, y + 1.2 * s, z, { s }));
      const tm = mat4(x, y + 2.4 * s + s * 0.35, z, { s: [s * 1.05, s * 0.95, s * 1.05] });
      tops.setMatrixAt(i, tm);
      topsOut.setMatrixAt(i, tm);
      tops.setColorAt(i, col.set(flavours[i % flavours.length]));
    });
    group.add(cones, tops, topsOut);

    // wafer sticks poking out of the snow
    const waferSpots = scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 3), { pad: 90 });
    const wafer = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 6, 1), toon(0xe0a860), waferSpots.length);
    waferSpots.forEach(([x, z], i) => wafer.setMatrixAt(i, mat4(x, groundH(x, z) + 2, z, { rz: (rng() - 0.5) * 0.6, rx: (rng() - 0.5) * 0.6, ry: rng() * 3 })));
    group.add(wafer);

    // sprinkles scattered over the snow
    const sprSpots = scatter(2200, (x, z) => {
      const d = distToRoad(x, z, 70);
      return d > hw + FENCE_OFFSET + 1 && d < hw + 60;
    }, { pad: 70, tries: 6 });
    const spr = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.22, 0.75), toon(0xffffff), sprSpots.length);
    const sc = [0xff4f9a, 0x4fb3ff, 0xffe14f, 0x6bd968, 0xb57bff, 0xff9f40];
    sprSpots.forEach(([x, z], i) => {
      spr.setMatrixAt(i, mat4(x, groundH(x, z) + 0.1, z, { ry: rng() * Math.PI }));
      spr.setColorAt(i, col.set(sc[i % sc.length]));
    });
    group.add(spr);

    // candy-floss trees in minty/pink tones
    cottonCandyTrees(scatter(70, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 4) && (!river.length || distToPolyline(x, z, river) > 16), { pad: 120 }),
      [0xffffff, 0xd4f7e4, 0xffd1e6, 0xcfe8ff], { stick: 0x8a5237 });

    // gently falling sprinkle-snow
    fallingSprinkles(700);
    sparkles(200, center.x, center.z, extent, 4, 30, [0xffffff, 0xffe3f1], 1.2);
  }
}

/**
 * Before the terrain is made: trace the chocolate river so the hills can
 * carve a channel for it (scenery.riverLine).
 */
export function prepare({ def, path, index }) {
  if (!def.scenery?.river) return def;
  return { ...def, scenery: { ...def.scenery, riverLine: riverPolyline(def, path, index) } };
}

/** Road details drawn right after the road/curbs (before fences and scenery). */
export function buildRoadDetails(ctx) {
  const { path, group, own, hw, loopFrames } = ctx;
  buildChocolateRoadDetails();

  /** Glossy milk-chocolate centre stripe + whipped-cream scallops along both kerbs. */
  function buildChocolateRoadDetails() {
    // (sits just above the road but below the start line at 0.05)
    const gloss = new THREE.Mesh(ribbon(loopFrames, -1.6, 1.6, 0.036), own(toon(0xc98760, { unique: true, emissive: 0x2a1208, emissiveIntensity: 0.2 })));
    const shine = new THREE.Mesh(ribbon(loopFrames, -0.3, 0.3, 0.042), own(toon(0xe6ae84, { unique: true, emissive: 0x442211, emissiveIntensity: 0.25 })));
    group.add(gloss, shine);
    // low-poly dollops: this runs ~1000 times round the lap, keep it cheap
    const puffGeo = new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    const step = 2.3;
    const n = Math.floor(path.length / step);
    const cream = new THREE.InstancedMesh(puffGeo, toon(0xffffff, { emissive: 0x554444, emissiveIntensity: 0.25 }), n * 2);
    let k = 0;
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 1]) {
        const sP = i * step + (side > 0 ? step / 2 : 0);
        const p = path.positionAt(sP, side * (hw + SHOULDER_IN * 0.5));
        const m = mat4(p.x, p.y + 0.05, p.z, { s: [1.05, 0.34, 1.05] });
        cream.setMatrixAt(k, m);
        k++;
      }
    }
    group.add(cream);
  }
}

/** Chocolate river: perpendicular to the road at the bridge, wiggling off both ways, stopping before other road. */
function riverPolyline(def, path, index) {
  const s = def.scenery.river.at * path.length;
  const p = path.pointAt(s);
  const r = path.rightAt(s);
  const hw = path.halfWidth;
  const bridgeRange = (def.scenery.bridges || [])[0];
  const inBridge = (i) => {
    if (!bridgeRange) return false;
    const si = i * path.step;
    return si >= bridgeRange[0] * path.length - 30 && si <= bridgeRange[1] * path.length + 30;
  };
  const sides = [];
  for (const dir of [-1, 1]) {
    const pts = [];
    for (let d = 0; d <= 260; d += 6) {
      const wig = Math.sin(d * 0.03) * 10 * Math.min(1, d / 40);
      const x = p.x + r.x * d * dir + -r.z * wig;
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
