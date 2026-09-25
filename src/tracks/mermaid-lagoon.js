/**
 * Mermaid Lagoon — track module (data + scenery). Cup: bubble-cup (race 2).
 * OWNER: Tracks — Bubble Cup.
 *
 * A pearly sand island with a round, sparkly lagoon in the middle. Right
 * after the start the road dives down INTO the lagoon through a glass bubble
 * tunnel: fish swim past, bubbles rise, a giant pearl glows in its clam and
 * a mermaid-tail sculpture waves above the water. Then it climbs back up the
 * beach, swings round the clam turn and wiggles through coral S-bends along
 * the north shore, while dolphins leap in the ocean all around the island.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, SHOULDER_OUT, mat4, extruded, starShape, archShape as archShapeSafe, frames, smoothstep } from './sceneryKit.js';
import {
  instanced, animatedInstances, patternTexture, waterGrid, retextureRoad, rippleTexture,
} from './props/bubble-kit.js';

/** Lagoon geometry: the road dives 8 units down over DIVE, runs TUNNEL flat, climbs back over DIVE. */
export const LAGOON = { depth: -12, water: -0.5, roadDepth: -8, dive: 60, tunnel: 70 };
LAGOON.radius = LAGOON.dive + LAGOON.tunnel / 2;

const LAYOUT = {
  start: [-80, 0], heading: 90, startAt: 54,
  ops: [
    { s: 80, mark: 'approach' },
    { s: LAGOON.dive, y: LAGOON.roadDepth, mark: 'dive' },
    { s: LAGOON.tunnel, y: LAGOON.roadDepth, mark: 'tunnel' },
    { s: LAGOON.dive, y: 0, mark: 'rise' },
    { s: 30, mark: 'exit' },
    { turn: 90, r: 50, mark: 'pearl-turn' },
    { s: 40, mark: 'east-run' },
    { turn: 90, r: 50, mark: 'clam-turn' },
    { s: 100, flex: true, mark: 'shore-straight' },
    { turn: -40, r: 80, mark: 'coral-s1' },
    { turn: 80, r: 80, mark: 'coral-s2' },
    { turn: -40, r: 80, mark: 'coral-s3' },
    { turn: 90, r: 60, mark: 'shell-sweep' },
    { s: 60, flex: true, mark: 'west-run' },
    { turn: 90, r: 50, mark: 'tunnel-turn' },
  ],
};

export const def = makeTrack(
  {
    id: 'mermaid-lagoon',
    name: 'Mermaid Lagoon',
    subtitle: 'Splash through the bubble tunnel',
    laps: 3,
    width: 20,
    previewColor: 0x6fe3d6,
    art: ['🧜‍♀️', '🐚', '🫧'], // menu card emoji: big, bottom-left, top-right
    cup: 'bubble-cup',
    unlock: { type: 'stat', stat: 'wins', count: 1 },
    theme: {
      skyTop: 0x4fc2ea,
      skyBottom: 0xffe6f6,
      fogColor: 0xd6f4f4,
      fogNear: 170,
      fogFar: 660,
      ground: 0xf8ecd6, // pearly sand
      road: 0xc9b8f2, // mermaid-scale lavender
      roadAlt: 0xbba8ec,
      curbA: 0x4fdcc8,
      curbB: 0xfff4fb,
      offRoad: 0xfdf3e6,
      music: 'mermaid-lagoon',
      sunColor: 0xfff3e2,
      ambientColor: 0xd6f0ff,
      // builder theme extras (see ARCHITECTURE.md -> theme fields)
      roadSprinkles: { style: 'stars', count: 90, palette: [0xffffff, 0xd8fff8, 0xffe3f6] },
      skirt: { color: 0xece2ff, trim: 0x7fe6da },
      pillar: { shape: 'round', color: 0xffd6e8, ring: 0x7fe6da },
    },
  },
  LAYOUT,
  (frac, centroid) => ({
    itemBoxRows: [frac('tunnel', 'mid'), frac('east-run', 'mid'), frac('shore-straight', 'mid'), frac('shell-sweep', 'mid')],
    boostPads: [
      { at: frac('dive', 'mid'), lateral: -3 },
      { at: frac('rise', 'mid'), lateral: 3 },
      { at: frac('coral-s2', 'mid'), lateral: -3 },
      { at: frac('tunnel-turn', 'end') - 0.004, lateral: 3 },
    ],
    scenery: {
      kind: 'lagoon',
      terrain: 'flat',
      center: centroid(),
      // the lagoon: a round basin (the core cuts the ground; the module draws floor, walls, water)
      basin: { center: centroid('tunnel', 'tunnel'), moatInner: 0, moatOuter: LAGOON.radius, depth: LAGOON.depth },
      tunnel: [frac('dive', 'start'), frac('rise', 'end')],
      fence: { post: 0xffffff, postAlt: 0x4fdcc8, rail: 0xb9f0ec, topper: 'star', topperColor: 0xff8a7a },
      arch: { a: 0x7fe6da, b: 0xffffff, banner: 0x8a6cf0, text: 'MERMAID LAGOON' },
    },
  }),
);

/** The road surface: shimmering lavender-aqua mermaid scales. */
function scaleTexture(ctx) {
  const light = [222, 210, 255], mid = [196, 180, 244], dark = [150, 128, 214], aqua = [176, 236, 232];
  const tex = patternTexture(ctx, 128, (u, v) => {
    const N = 2; // scales per tile across / rows per tile (even -> seamless)
    const x = u * N, y = v * N;
    let hit = null;
    for (let j = Math.floor(y) - 1; j <= Math.floor(y) + 1; j++) {
      const off = ((j % 2) + 2) % 2 ? 0.5 : 0;
      for (let k = Math.floor(x - off) - 1; k <= Math.floor(x - off) + 1; k++) {
        const cx = k + 0.5 + off, cy = j + 0.5;
        const d = Math.hypot(x - cx, (y - cy) * 1.15);
        if (d < 0.72 && y <= cy + 0.02 && (!hit || cy > hit.cy)) hit = { cy, d, row: j };
      }
    }
    const d = hit ? hit.d / 0.72 : 1;
    const shimmer = hit ? (((hit.row % 3) + 3) % 3) / 2 : 0;
    const base = mid.map((c, i) => c + (light[i] - c) * (1 - d) * 0.9 + (aqua[i] - c) * shimmer * 0.35 * (1 - d));
    const rim = smoothstep(0.84, 0.97, d);
    return base.map((c, i) => c + (dark[i] - c) * rim);
  });
  tex.repeat.set(9 / 4, 9 / 4); // one tile = 4 x 4 units (2 x 2 scales)
  return tex;
}

export function buildRoadDetails(ctx) {
  retextureRoad(ctx, scaleTexture(ctx));
}

export function buildScenery(ctx) {
  const { def, path, group, rng, own, hw, L, extent, bounds, clearOfRoad, distToRoad, animators, scatter, sparkles, backgroundHills, batch } = ctx;
  const B = def.scenery.basin;
  const [lcx, lcz] = B.center;
  const R = B.moatOuter;
  const [ta, tb] = def.scenery.tunnel;
  const inLagoon = (x, z, m = 0) => Math.hypot(x - lcx, z - lcz) < R - m;
  let oceanShore = () => -Infinity;

  buildLagoonBowl();
  buildGlassTunnel();
  buildUnderwater();
  buildOcean();
  buildShore();
  buildConchPalace();
  backgroundHills(14, extent + 330, extent + 480, [0xb8f0e0, 0xffd6ea, 0xd9ccff, 0xa8e8f0], { hMin: 12, hMax: 34, widthMul: 3 });
  sparkles(260, lcx, lcz, R + 30, 0.5, 12, [0xffffff, 0xd8fff8, 0xffe3f6], 1.5);

  // ---------------------------------------------------------------------
  function buildLagoonBowl() {
    // sandy floor with soft rings of colour, and a coral-pink rim wall
    const floorGeo = new THREE.CircleGeometry(R + 0.5, 64, 0, Math.PI * 2);
    floorGeo.rotateX(-Math.PI / 2);
    const pos = floorGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const cA = new THREE.Color(0xf3e4c8), cB = new THREE.Color(0xbfeee4), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i)) / R;
      c.copy(cA).lerp(cB, smoothstep(0.2, 0.95, r));
      col.set([c.r, c.g, c.b], i * 3);
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const floor = new THREE.Mesh(floorGeo, ctx.toonVC());
    floor.position.set(lcx, B.depth, lcz);
    group.add(floor);
    const wallGeo = new THREE.CylinderGeometry(R + 0.4, R + 0.4, -B.depth + 0.05, 72, 1, true);
    const wall = new THREE.Mesh(wallGeo, toon(0xf6c8c0, { side: THREE.DoubleSide }));
    wall.position.set(lcx, B.depth / 2, lcz);
    group.add(wall);
    // a pearly lip around the rim
    const lip = new THREE.Mesh(new THREE.TorusGeometry(R + 0.6, 0.5, 6, 96), toon(0xffffff));
    lip.rotation.x = Math.PI / 2;
    lip.position.set(lcx, 0.05, lcz);
    group.add(lip);
    // the water surface: see-through from above and from inside the tunnel
    const water = new THREE.Mesh(new THREE.CircleGeometry(R + 0.3, 72), own(new THREE.MeshToonMaterial({
      color: 0x5fe0e6, emissive: 0x2fb8c8, emissiveIntensity: 0.25, transparent: true, opacity: 0.42,
      side: THREE.DoubleSide, depthWrite: false, gradientMap: toon(0xffffff).gradientMap,
    })));
    water.material.map = rippleTexture(ctx, 0.3);
    water.material.map.repeat.set(R / 14, R / 14);
    water.rotation.x = -Math.PI / 2;
    water.position.set(lcx, LAGOON.water, lcz);
    water.renderOrder = 5;
    water.name = 'lagoon-water';
    group.add(water);
    animators.push((dt, t) => {
      water.material.map.offset.set((t * 0.01) % 1, (t * 0.006) % 1);
      water.material.opacity = 0.42 + Math.sin(t * 0.8) * 0.03;
    });
  }

  function buildGlassTunnel() {
    // glass arch over the road wherever it runs under the water
    const s0 = ta * L, s1 = tb * L;
    const fr = frames(path, s0, s1, 2).filter((f) => f.y < LAGOON.water - 0.6 && inLagoon(f.x, f.z, -2));
    if (fr.length < 2) return;
    const halfW = hw + SHOULDER_OUT + 1.4;
    const H = 7.4;
    const seg = 16;
    const pos = [];
    const pt = (f, k) => {
      const a = Math.PI * (k / seg);
      const lat = Math.cos(a) * halfW;
      return [f.x + f.rx * lat, f.y + Math.sin(a) * H, f.z + f.rz * lat];
    };
    for (let i = 0; i < fr.length - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const a0 = pt(fr[i], k), a1 = pt(fr[i], k + 1), b0 = pt(fr[i + 1], k), b1 = pt(fr[i + 1], k + 1);
        pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const glass = new THREE.Mesh(g, own(new THREE.MeshToonMaterial({
      color: 0xd8fbff, emissive: 0x9ff4ff, emissiveIntensity: 0.25, transparent: true, opacity: 0.26,
      side: THREE.DoubleSide, depthWrite: false, gradientMap: toon(0xffffff).gradientMap,
    })));
    glass.renderOrder = 6;
    glass.name = 'bubble-tunnel';
    group.add(glass);
    // glowing ribs every 10 units (thin arched strips) + a pearl string along the top
    const rib = [], pearls = [];
    for (let i = 0; i < fr.length; i += 5) {
      const f = fr[i];
      for (let k = 0; k < seg; k++) {
        const a = pt(f, k), b = pt(f, k + 1);
        const o = (p, d) => [p[0] + f.tx * d, p[1], p[2] + f.tz * d];
        rib.push(...o(a, -0.25), ...o(b, -0.25), ...o(a, 0.25), ...o(a, 0.25), ...o(b, -0.25), ...o(b, 0.25));
      }
      pearls.push(mat4(f.x, f.y + H - 0.75, f.z, { s: 0.5 }));
    }
    const ribGeo = new THREE.BufferGeometry();
    ribGeo.setAttribute('position', new THREE.Float32BufferAttribute(rib, 3));
    ribGeo.computeVertexNormals();
    group.add(new THREE.Mesh(ribGeo, glow(0xa8f6ff, { side: THREE.DoubleSide })));
    instanced(ctx, new THREE.SphereGeometry(1, 10, 8), glow(0xfff4fb), pearls, { outline: false });
  }

  function buildUnderwater() {
    const floorY = B.depth;
    const inBowl = (x, z, m) => inLagoon(x, z, m) && clearOfRoad(x, z, hw + 6);
    const bowl = { minX: lcx - R, maxX: lcx + R, minZ: lcz - R, maxZ: lcz + R };
    // coral: branchy clusters in bright candy colours
    const branch = new THREE.CylinderGeometry(0.35, 0.55, 1, 6);
    branch.translate(0, 0.5, 0);
    const knob = new THREE.SphereGeometry(0.7, 8, 6);
    const coralParts = [], knobs = [], coralCols = [];
    const palette = [0xff7a9c, 0xffa65c, 0xb57bff, 0xff5fbf, 0x5fd6ff];
    for (const [x, z] of scatter(34, (x, z) => inBowl(x, z, 5), { area: bowl })) {
      const c = palette[Math.floor(rng() * palette.length)];
      const s = 1 + rng() * 1.2;
      for (let k = 0; k < 5; k++) {
        const a = rng() * Math.PI * 2, tilt = 0.2 + rng() * 0.5, h = (2.5 + rng() * 3) * s;
        coralParts.push(mat4(x, floorY, z, { ry: a, rz: tilt, s: [s, h, s] }));
        const tx = x + Math.sin(tilt) * h * Math.cos(a) * -1, tz = z + Math.sin(tilt) * h * Math.sin(a);
        knobs.push(mat4(tx, floorY + Math.cos(tilt) * h, tz, { s }));
        coralCols.push(c);
      }
    }
    instanced(ctx, branch, toon(0xffffff), coralParts, { colors: coralCols, outline: false });
    instanced(ctx, knob, toon(0xffffff), knobs, { colors: coralCols, outline: false });
    // swaying sea grass
    const grassGeo = new THREE.ConeGeometry(0.5, 1, 4);
    grassGeo.translate(0, 0.5, 0);
    const grass = scatter(90, (x, z) => inBowl(x, z, 3), { area: bowl }).map(([x, z]) => ({ x, z, h: 3 + rng() * 5, ph: rng() * 6 }));
    animatedInstances(ctx, grassGeo, toon(0xffffff), grass, (it, t, o) => {
      o.position.set(it.x, floorY, it.z);
      o.rotation.set(Math.sin(t * 1.2 + it.ph) * 0.18, 0, Math.cos(t * 0.9 + it.ph) * 0.18);
      o.scale.set(1, it.h, 1);
    }, { colors: [0x6fe0a8, 0x4fcf9a, 0x9ff0b8] });
    // hero: a giant glowing pearl in an open clam, right beside the tunnel
    const clam = pickClear(lcx, lcz + 38, 12);
    const shellTop = new THREE.SphereGeometry(10, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    shellTop.scale(1, 0.45, 1);
    batch.add(shellTop, toon(0xffb8d9), mat4(clam.x, floorY + 0.2, clam.z));
    batch.add(shellTop, toon(0xffc9e4), mat4(clam.x, floorY + 1.2, clam.z - 5, { rx: -1.1 }));
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(3.6, 24, 16), own(new THREE.MeshBasicMaterial({ color: 0xfff6fb })));
    pearl.position.set(clam.x, floorY + 5.2, clam.z);
    group.add(pearl);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(5.6, 20, 14), own(new THREE.MeshBasicMaterial({ color: 0xffd6f4, transparent: true, opacity: 0.25, depthWrite: false })));
    halo.position.copy(pearl.position);
    group.add(halo);
    animators.push((dt, t) => {
      halo.scale.setScalar(1 + Math.sin(t * 2) * 0.06);
      pearl.material.color.setHSL(0.9 + Math.sin(t * 0.7) * 0.05, 1, 0.94);
    });
    // hero: the mermaid-tail sculpture rising out of the water on the far side
    const tailSpot = pickClear(lcx - 30, lcz + 55, 8);
    buildMermaidTail(tailSpot.x, tailSpot.z, floorY);
    // schools of fish circling round the tunnel
    const fishBody = new THREE.SphereGeometry(1, 10, 8);
    fishBody.scale(0.38, 0.8, 1.25);
    const tail = new THREE.ConeGeometry(0.7, 1, 4);
    tail.rotateX(-Math.PI / 2);
    tail.scale(0.3, 1, 1);
    tail.translate(0, 0, -1.5);
    const fishGeo = mergeGeometries([fishBody.toNonIndexed(), tail.toNonIndexed()]);
    const fish = [];
    for (let sch = 0; sch < 6; sch++) {
      const r = 22 + rng() * (R - 34), y = floorY + 3 + rng() * 6, sp = (0.12 + rng() * 0.1) * (rng() < 0.5 ? 1 : -1);
      const ph0 = rng() * Math.PI * 2;
      for (let k = 0; k < 7; k++) fish.push({ r: r + (rng() - 0.5) * 5, y: y + (rng() - 0.5) * 2.5, sp, ph: ph0 + k * 0.07 + rng() * 0.05, w: rng() * 6 });
    }
    animatedInstances(ctx, fishGeo, toon(0xffffff), fish, (it, t, o) => {
      const a = t * it.sp + it.ph;
      o.position.set(lcx + Math.cos(a) * it.r, it.y + Math.sin(t * 1.5 + it.w) * 0.5, lcz + Math.sin(a) * it.r);
      // swim along the circle: tangent = (-sin a, cos a) * sign(sp); model forward is +z
      const tx = -Math.sin(a) * Math.sign(it.sp), tz = Math.cos(a) * Math.sign(it.sp);
      o.rotation.set(0, Math.atan2(tx, tz), Math.sin(t * 8 + it.w) * 0.12);
      o.scale.setScalar(1.3);
    }, { colors: [0xffa65c, 0xffe14f, 0xff7ac8, 0x5fd6ff, 0xb57bff, 0xff6f91], outline: true, ow: 0.08 });
    // bubbles rising from the floor to the surface
    const bub = scatter(70, (x, z) => inLagoon(x, z, 4), { area: bowl }).map(([x, z]) => ({ x, z, sp: 1.2 + rng() * 1.6, ph: rng() * 20, r: 0.25 + rng() * 0.45 }));
    const rise = -B.depth + LAGOON.water;
    animatedInstances(ctx, new THREE.SphereGeometry(1, 8, 6), own(new THREE.MeshBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.7, depthWrite: false })), bub, (it, t, o) => {
      const h = ((t * it.sp + it.ph) % rise);
      o.position.set(it.x + Math.sin(t * 2 + it.ph) * 0.4, B.depth + h, it.z);
      o.scale.setScalar(it.r * (0.6 + (h / rise) * 0.6));
    });
    // starfish on the floor
    const starGeo = extruded(starShape(5, 1, 0.45), 0.3, 0.08, 1);
    starGeo.rotateX(-Math.PI / 2);
    const floorStars = scatter(40, (x, z) => inBowl(x, z, 3), { area: bowl }).map(([x, z]) => mat4(x, floorY + 0.15, z, { ry: rng() * 6, s: 0.8 + rng() }));
    instanced(ctx, starGeo, toon(0xffffff), floorStars, { colors: [0xff8a5c, 0xff6fb5, 0xffd23f], outline: false });
  }

  /** A spot inside the lagoon at least `r` from the rim and clear of the road. */
  function pickClear(x0, z0, r) {
    for (let d = 0; d < 80; d += 4) {
      const n = d === 0 ? 1 : 12;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = x0 + Math.cos(a) * d, z = z0 + Math.sin(a) * d;
        if (inLagoon(x, z, r) && clearOfRoad(x, z, SHOULDER_OUT + r + 3)) return { x, z };
      }
    }
    return { x: x0, z: z0 };
  }

  function buildMermaidTail(x, z, y0) {
    // a friendly pearly-teal mermaid tail curling up out of the water, fin waving
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 8, 0), new THREE.Vector3(-1.5, 15, 0), new THREE.Vector3(1.5, 21, 0), new THREE.Vector3(4.5, 24, 0),
    ]);
    const tubular = 30, radial = 14;
    const tube = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
    // taper the tube towards the tip
    const p = tube.attributes.position;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const u = Math.floor(i / (radial + 1)) / tubular;
      const c = curve.getPointAt(Math.min(1, u), tmp);
      const k = THREE.MathUtils.lerp(4.2, 1.4, u);
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
    }
    tube.computeVertexNormals();
    const tailGroup = new THREE.Group();
    tailGroup.position.set(x, y0, z);
    group.add(tailGroup);
    tailGroup.add(new THREE.Mesh(tube, toon(0x4fd6c8)));
    // scale bands
    for (let k = 1; k < 6; k++) {
      const c = curve.getPointAt(k / 7);
      const band = new THREE.Mesh(new THREE.TorusGeometry(THREE.MathUtils.lerp(4.3, 1.5, k / 7), 0.35, 6, 20), toon(0xb8a8ff));
      band.position.copy(c);
      band.rotation.x = Math.PI / 2;
      tailGroup.add(band);
    }
    const fin = new THREE.Group();
    fin.position.copy(curve.getPointAt(1));
    tailGroup.add(fin);
    const lobe = new THREE.SphereGeometry(1, 16, 10);
    lobe.scale(5, 1.6, 0.5);
    for (const sgn of [-1, 1]) {
      const m = new THREE.Mesh(lobe, toon(0xff9fd4));
      m.position.set(sgn * 4, 1.6, 0);
      m.rotation.z = sgn * 0.5;
      fin.add(m);
    }
    animators.push((dt, t) => {
      fin.rotation.z = Math.sin(t * 1.4) * 0.25;
      fin.rotation.x = Math.sin(t * 0.9) * 0.1;
      tailGroup.rotation.y = Math.sin(t * 0.3) * 0.2;
    });
  }

  function buildOcean() {
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
    const hx = (bounds.maxX - bounds.minX) / 2 + 95, hz = (bounds.maxZ - bounds.minZ) / 2 + 95;
    const shore = (x, z) => {
      // a soft rounded-rectangle island with a wobbly beach
      const q = Math.pow(Math.pow(Math.abs(x - cx) / hx, 4) + Math.pow(Math.abs(z - cz) / hz, 4), 0.25);
      return (q - 1) * Math.min(hx, hz) + 9 * Math.sin(x * 0.027 + 0.5) + 7 * Math.sin(z * 0.041 + 2) + 4 * Math.sin((x + z) * 0.08);
    };
    oceanShore = shore;
    waterGrid(ctx, {
      area: { minX: bounds.minX - 600, maxX: bounds.maxX + 600, minZ: bounds.minZ - 600, maxZ: bounds.maxZ + 600 },
      cell: 8, y: 0.12, wet: shore, skip: (x, z) => inLagoon(x, z, -4),
      color: 0x5fd8e0, deep: 0x2fa8d8, foam: 0xffffff, foamWidth: 6, deepAt: 140,
      emissive: 0x1f8fb0, emissiveIntensity: 0.12, ripples: 0.22, rippleTile: 30,
    });
    // dolphins leaping in friendly arcs out at sea
    const body = new THREE.SphereGeometry(1, 14, 10);
    body.scale(0.9, 0.9, 3);
    const finG = new THREE.ConeGeometry(0.6, 1.4, 4);
    finG.translate(0, 1.2, 0);
    const fluke = new THREE.SphereGeometry(1, 8, 6);
    fluke.scale(1.8, 0.2, 0.6);
    fluke.translate(0, 0, -3);
    const dolphinGeo = mergeGeometries([body, finG, fluke].map((g) => g.toNonIndexed()));
    const pods = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rng();
      pods.push({ x: cx + Math.cos(a) * (hx + 50), z: cz + Math.sin(a) * (hz + 50), dir: rng() * Math.PI * 2, ph: rng() * 10, period: 5 + rng() * 3 });
    }
    animatedInstances(ctx, dolphinGeo, toon(0x9fd8ff), pods, (it, t, o) => {
      const u = ((t + it.ph) % it.period) / 1.6; // a leap lasts 1.6 s, then they swim under
      const k = Math.min(1, u);
      const y = u < 1 ? Math.sin(k * Math.PI) * 7 - 1 : -6;
      const fx = Math.sin(it.dir), fz = Math.cos(it.dir);
      o.position.set(it.x + fx * (k - 0.5) * 22, y, it.z + fz * (k - 0.5) * 22);
      o.rotation.set(-Math.cos(k * Math.PI) * 0.9, it.dir, 0);
      o.scale.setScalar(1.6);
    }, { outline: true, ow: 0.07 });
  }

  function buildConchPalace() {
    // hero on land: a swirly conch-shell palace between the north shore and the lagoon
    const need = 16;
    let spot = null;
    const tx = lcx - 20, tz = lcz - R - 60;
    for (let d = 0; d < 200 && !spot; d += 5) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = tx + Math.cos(a) * d, z = tz + Math.sin(a) * d;
        if (clearOfRoad(x, z, SHOULDER_OUT + need + 2) && !inLagoon(x, z, -need - 4) && oceanShore(x, z) < -need) { spot = { x, z }; break; }
      }
    }
    if (!spot) return;
    const { x, z } = spot;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const r = THREE.MathUtils.lerp(11, 1.6, u);
      const tube = THREE.MathUtils.lerp(3.2, 0.9, u);
      const y = 2.6 + i * 2.6;
      batch.add(new THREE.TorusGeometry(r, tube, 10, 32), toon(i % 2 ? 0xffd6e6 : 0xfff3e8), mat4(x + Math.sin(i * 1.3) * 0.8, y, z + Math.cos(i * 1.3) * 0.8, { rx: Math.PI / 2 + 0.08 * Math.sin(i), rz: 0.08 * Math.cos(i) }));
    }
    batch.add(new THREE.CylinderGeometry(9.5, 11, 6, 28), toon(0xfff3e8), mat4(x, 3, z));
    batch.add(new THREE.ConeGeometry(2, 5, 16), toon(0xffb8d9), mat4(x, 2.6 + n * 2.6 + 1.2, z));
    batch.add(new THREE.ShapeGeometry(archShapeSafe(4, 6)), toon(0x8a6cf0), mat4(x, 0.05, z + 11.05), false);
    for (const dx of [-5.5, 5.5]) batch.add(new THREE.CircleGeometry(1.2, 16), glow(0xbff6ff), mat4(x + dx, 6.5, z + 10.2), false);
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), glow(0xfff4fb));
    pearl.position.set(x, 2.6 + n * 2.6 + 4.6, z);
    group.add(pearl);
    animators.push((dt, t) => { pearl.position.y = 2.6 + n * 2.6 + 4.6 + Math.sin(t * 1.5) * 0.4; });
  }

  function buildShore() {
    const onLand = (x, z, m) => !inLagoon(x, z, -8) && oceanShore(x, z) < -m;
    // soft patches of pink, lilac and mint sand so the island is not one flat colour
    const disc = new THREE.CircleGeometry(1, 28);
    disc.rotateX(-Math.PI / 2);
    const patches = [];
    for (const [x, z] of scatter(34, (x, z) => onLand(x, z, 25) && clearOfRoad(x, z, SHOULDER_OUT + 14), { pad: 60 })) {
      const r = 8 + rng() * 16;
      const room = distToRoad(x, z, 80) - hw - SHOULDER_OUT - 1;
      const rr = Math.min(r, room, Math.hypot(x - lcx, z - lcz) - R - 2);
      if (rr > 5) patches.push(mat4(x, 0.02 + patches.length * 0.001, z, { s: [rr, 1, rr * (0.7 + rng() * 0.3)], ry: rng() * 6 }));
    }
    instanced(ctx, disc, toon(0xffffff), patches, { colors: [0xffe0ea, 0xece2ff, 0xdff7ea, 0xfff0d0], outline: false });
    // coral rocks around the island
    const rocks = [];
    for (const [x, z] of scatter(40, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 6) && onLand(x, z, 8), { pad: 80 })) {
      const n = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) rocks.push(mat4(x + (rng() - 0.5) * 6, 0, z + (rng() - 0.5) * 6, { s: [2 + rng() * 3, 1.5 + rng() * 3, 2 + rng() * 3], ry: rng() * 6 }));
    }
    instanced(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff), rocks, { colors: [0xffc9d6, 0xd9ccff, 0xffe0c2, 0xbff0e4] });
    // scallop shells standing up like fans
    const fan = new THREE.CylinderGeometry(3, 3, 0.5, 14, 1, false, -Math.PI / 2, Math.PI);
    fan.rotateX(Math.PI / 2);
    const shells = scatter(16, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5) && onLand(x, z, 6), { pad: 80 })
      .map(([x, z]) => mat4(x, 0, z, { ry: rng() * 6, s: 1 + rng() * 0.8 }));
    instanced(ctx, fan, toon(0xffffff), shells, { colors: [0xffb8d9, 0xfff0e0, 0xffd6a8, 0xe0d0ff] });
    // bright coral trees on land
    const trunk = new THREE.CylinderGeometry(0.4, 0.6, 1, 6);
    trunk.translate(0, 0.5, 0);
    const tm = [], pm = [], pc = [];
    for (const [x, z] of scatter(46, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 5) && onLand(x, z, 10), { pad: 100 })) {
      const h = 4 + rng() * 4, c = [0xff7a9c, 0xffa65c, 0xb57bff, 0x5fd6ff, 0xff5fbf][Math.floor(rng() * 5)];
      tm.push(mat4(x, 0, z, { s: [1, h, 1] }));
      for (let k = 0; k < 3; k++) {
        const a = rng() * 6;
        pm.push(mat4(x + Math.cos(a) * 1.4, h + rng() * 1.2, z + Math.sin(a) * 1.4, { s: 1.4 + rng() }));
        pc.push(c);
      }
    }
    instanced(ctx, trunk, toon(0xfff0e6), tm, { outline: false });
    instanced(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff), pm, { colors: pc });
    // pearls scattered near the road
    const pearls = scatter(60, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 1.5) && onLand(x, z, 2) && distToRoad(x, z, 50) < hw + 30, { pad: 30 })
      .map(([x, z]) => mat4(x, 0.5, z, { s: 0.5 + rng() * 0.5 }));
    instanced(ctx, new THREE.SphereGeometry(1, 10, 8), glow(0xfff4fb), pearls, { outline: false });
  }
}

export default { def, buildScenery, buildRoadDetails };

