import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import {
  FENCE_OFFSET, SKY_RADIUS, SHOULDER_IN, SHOULDER_OUT, APRON_Y, TREE_CAMERA_CLEARANCE, OUTLINE_COLOR,
} from './constants.js';
import {
  makeRng, seedFromString, smoothstep, createPathIndex, bridgeWeights, createTerrain,
  computeItemBoxSlots, computeBoostPads, distToPolyline,
} from './pathTools.js';
import {
  frames, ribbon, wall, heartShape, starShape, extruded, mat4, Batch, roadTexture, stripeTexture,
} from './geometry.js';
import { createSceneryHelpers } from './sceneryKit.js';
import { getTrackModule } from './index.js';

/**
 * Track core — turns a TrackDef + TrackPath into a charming 3D world:
 * road ribbon (following elevation), candy-stripe curbs, shoulders, edge
 * fences, supports/skirts under elevated road, start/finish arch, glowing
 * boost pads, a gradient sky dome, lights, ground, and then hands a scenery
 * context to the track's own module (`buildScenery(ctx)`) for themed props.
 *
 * Everything generic is driven by TrackDef data (theme + scenery fields, see
 * ARCHITECTURE.md). Nothing here touches the scene: the caller adds
 * `built.group` and applies `trackDef.theme.fog*` to `scene.fog`. The sky dome
 * re-centres itself on whichever camera is rendering (works per split-screen
 * viewport), so cameras only need `far > SKY_RADIUS`; ~1200 keeps the far
 * clouds/planets in view.
 *
 * Build order is fixed (it decides the seeded random numbers every helper
 * draws): sky → lights → ground → road → curbs → shoulders → module
 * buildRoadDetails → skirts/supports → fences → start arch → boost pads →
 * module buildScenery → daytime clouds → batch bake.
 */

/**
 * @param {object} inputDef TrackDef
 * @param {import('../track/TrackPath.js').TrackPath} path
 * @param {{module?: {buildScenery?:Function, prepare?:Function, buildRoadDetails?:Function}}} [opts]
 *   `module` overrides the registry lookup (handy for previewing a track that is not registered yet).
 */
export function buildTrack(inputDef, path, opts = {}) {
  const mod = opts.module ?? getTrackModule(inputDef.id) ?? {};
  let def = inputDef;
  const group = new THREE.Group();
  group.name = `track:${def.id}`;
  const theme = def.theme;
  const night = !!theme.night;
  const rng = makeRng(seedFromString(def.id));
  const index = createPathIndex(path);
  const ownedMaterials = [];
  const ownedTextures = [];
  const animators = [];
  const own = (m) => { ownedMaterials.push(m); return m; };
  const ownTex = (t) => { ownedTextures.push(t); return t; };
  const outlineMat = own(new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide }));
  const batch = new Batch();
  const flagGeo = new THREE.ShapeGeometry(heartShape(), 8);
  flagGeo.rotateZ(-Math.PI / 2);
  flagGeo.translate(0.55, 0, 0);
  const hw = path.halfWidth;
  const L = path.length;
  const bounds = path.getBounds();
  const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;

  const toonTex = (tex, color = 0xffffff, extra = {}) => {
    const m = own(toon(color, { unique: true, ...extra }));
    m.map = tex;
    m.needsUpdate = true;
    return m;
  };
  const toonVC = (extra = {}) => {
    const m = own(toon(0xffffff, { unique: true, ...extra }));
    m.vertexColors = true;
    m.needsUpdate = true;
    return m;
  };

  // A module may derive extra scenery data before the terrain exists (e.g. a river channel).
  if (typeof mod.prepare === 'function') def = mod.prepare({ def, path, index }) || def;
  const terrain = createTerrain(def, path, index);
  const groundH = (x, z) => terrain.height(x, z) ?? -1000;
  const bw = bridgeWeights(def, path);

  // Road-side helpers ------------------------------------------------------
  const loopFrames = frames(path, 0, L, path.step);
  const distToRoad = (x, z, maxR = 80) => index.nearest(x, z, maxR).dist;
  const clearOfRoad = (x, z, margin) => distToRoad(x, z, hw + margin + 2) > hw + margin;

  /** The scenery context handed to track modules (see ARCHITECTURE.md → "Scenery ctx API"). */
  const ctx = {
    def, path, theme, group, rng, index, terrain, groundH, bridgeWeight: bw, night,
    hw, L, bounds, center, extent, loopFrames, distToRoad, clearOfRoad,
    own, ownTex, outlineMat, toonTex, toonVC, batch, animators, flagGeo,
    /** Register a per-frame animation: fn(dt, time). */
    animate: (fn) => { animators.push(fn); return fn; },
    FENCE_OFFSET, SHOULDER_IN, SHOULDER_OUT, TREE_CAMERA_CLEARANCE, distToPolyline, smoothstep,
  };
  Object.assign(ctx, createSceneryHelpers(ctx));

  // ===== Sky ===============================================================
  const sky = buildSky(theme, own, rng, animators);
  group.add(sky);

  // ===== Lights ============================================================
  const lights = [];
  const hemi = new THREE.HemisphereLight(theme.skyBottom, theme.ground, night ? 0.9 : 1.05);
  const sun = new THREE.DirectionalLight(theme.sunColor, night ? 1.25 : 1.6);
  sun.position.set(center.x + 160, 260, center.z + 120);
  sun.target.position.copy(center);
  const amb = new THREE.AmbientLight(theme.ambientColor, night ? 0.55 : 0.35);
  group.add(hemi, sun, sun.target, amb);
  lights.push(hemi, sun, amb);

  // ===== Ground ============================================================
  buildGround();

  // ===== Road ==============================================================
  const roadTex = ownTex(roadTexture(def));
  const roadMat = toonTex(roadTex);
  const road = new THREE.Mesh(ribbon(loopFrames, -hw, hw, 0.03, { uv: { across: 9, along: 9 } }), roadMat);
  road.name = 'road';
  group.add(road);

  // Curbs: candy stripes, gently raised
  const curbA = new THREE.Color(theme.curbA);
  const curbB = new THREE.Color(theme.curbB);
  const stripeLen = 2.6;
  const curbColor = (k, f) => (Math.floor(f.s / stripeLen) % 2 === 0 ? curbA : curbB);
  const curbLift = (f, lat) => (Math.abs(lat) > hw + 0.1 ? 0.12 : 0.02);
  const curbMat = night
    ? own(new THREE.MeshBasicMaterial({ vertexColors: true }))
    : toonVC();
  const curbGeo = mergeGeometries([
    ribbon(loopFrames, hw, hw + SHOULDER_IN, 0.04, { color: curbColor, lift: curbLift }),
    ribbon(loopFrames, -hw - SHOULDER_IN, -hw, 0.04, { color: curbColor, lift: curbLift }),
  ]);
  group.add(new THREE.Mesh(curbGeo, curbMat));

  // Shoulders (off-road band) under the fences
  const shoulderMat = own(toon(theme.offRoad, { unique: true }));
  const shoulderGeo = mergeGeometries([
    ribbon(loopFrames, hw + SHOULDER_IN, hw + SHOULDER_OUT, 0.015),
    ribbon(loopFrames, -hw - SHOULDER_OUT, -hw - SHOULDER_IN, 0.015),
  ]);
  group.add(new THREE.Mesh(shoulderGeo, shoulderMat));

  if (typeof mod.buildRoadDetails === 'function') mod.buildRoadDetails(ctx);

  buildSkirtsAndSupports();
  buildFences();
  buildStartArch();
  const boostPads = computeBoostPads(def, path);
  buildBoostPads(boostPads);
  const itemBoxSlots = computeItemBoxSlots(def, path);

  // ===== Theme scenery (the track's own module) =============================
  if (typeof mod.buildScenery === 'function') mod.buildScenery(ctx);

  if (theme.clouds ?? !night) buildClouds();

  batch.build(group, outlineMat);

  // =========================================================================
  // Section builders (closures share the context above)
  // =========================================================================

  function buildGround() {
    const g = groundColorFn();
    if (terrain.kind === 'void') return;
    if (terrain.kind === 'flat') {
      const c = def.scenery?.basin ?? def.scenery?.castle;
      const size = extent + 900;
      const shape = new THREE.Shape();
      shape.moveTo(center.x - size, -(center.z - size));
      shape.lineTo(center.x + size, -(center.z - size));
      shape.lineTo(center.x + size, -(center.z + size));
      shape.lineTo(center.x - size, -(center.z + size));
      shape.closePath();
      if (c) {
        const hole = new THREE.Path();
        hole.absarc(c.center[0], -c.center[1], c.moatOuter, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
      const geo = new THREE.ShapeGeometry(shape, 48);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -0.05, 0);
      const ground = new THREE.Mesh(geo, own(toon(theme.ground, { unique: true })));
      ground.name = 'ground';
      group.add(ground);
      return;
    }
    // hills: a detailed heightfield around the track + a big flat apron
    const pad = 150;
    const w = bounds.maxX - bounds.minX + pad * 2;
    const d = bounds.maxZ - bounds.minZ + pad * 2;
    const cell = 3.5;
    const nx = Math.ceil(w / cell), nz = Math.ceil(d / cell);
    const geo = new THREE.PlaneGeometry(w, d, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate(center.x, 0, center.z);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrain.height(x, z);
      pos.setY(i, y);
      g(x, z, y, col);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, toonVC());
    ground.name = 'ground';
    group.add(ground);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), own(toon(theme.ground, { unique: true })));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(center.x, APRON_Y - 0.05, center.z);
    group.add(apron);
  }

  /** Ground colour variation: theme.groundTints (3 colours) blended by soft noise. */
  function groundColorFn() {
    const base = new THREE.Color(theme.ground);
    const noiseRng = makeRng(seedFromString(def.id + ':gc'));
    const p = [noiseRng() * 10, noiseRng() * 10, noiseRng() * 10];
    const tints = (theme.groundTints || DEFAULT_GROUND_TINTS).map((h) => new THREE.Color(h));
    const mix0 = theme.groundTintMix ?? 0.5;
    return (x, z, y, out) => {
      out.copy(base);
      const n1 = Math.sin(x * 0.031 + p[0]) * Math.cos(z * 0.027 + p[1]);
      const n2 = Math.sin((x + z) * 0.05 + p[2]);
      out.lerp(tints[0], smoothstep(0.35, 0.75, n1) * mix0);
      out.lerp(tints[1], smoothstep(-0.4, -0.8, n1) * 0.6);
      out.lerp(tints[2], smoothstep(0.6, 0.95, n2) * 0.5);
      // slightly lighter up high
      out.offsetHSL(0, 0, Math.max(-0.05, Math.min(0.06, (y - 3) * 0.008)));
    };
  }

  function buildSkirtsAndSupports() {
    const outer = hw + SHOULDER_OUT;
    const sk = theme.skirt || {};
    const skirtColor = new THREE.Color(sk.color ?? 0xfff0f7);
    const trim = new THREE.Color(sk.trim ?? 0xff9ccc);
    const isRainbow = !!sk.rainbow;
    const rainbow = [0xff6f91, 0xffa94d, 0xffe066, 0x8ce99a, 0x74c0fc, 0x9775fa, 0xf783ac].map((h) => new THREE.Color(h));
    const top = (f) => f.y + 0.015;
    let bottom;
    if (terrain.kind === 'void') bottom = (f) => f.y - 2.4;
    else bottom = (f) => Math.min(f.y - 0.2, groundH(f.x, f.z));
    const geos = [];
    for (const side of [-1, 1]) {
      const lat = side * outer;
      const skip = terrain.kind === 'void' ? null : (a, b, ga, gb) => ga < 0.25 && gb < 0.25;
      const bFn = terrain.kind === 'void' ? bottom
        : (f) => Math.min(f.y - 0.2, groundH(f.x + f.rx * lat, f.z + f.rz * lat));
      geos.push(wall(loopFrames, lat, top, bFn, {
        skip,
        color: (k, f) => {
          if (isRainbow) {
            const band = Math.floor(((f.s / 3) % 7 + 7) % 7);
            return rainbow[band];
          }
          return Math.floor(f.s / 6) % 2 ? skirtColor : trim;
        },
      }));
    }
    const skirtMat = terrain.kind === 'void'
      ? own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
      : toonVC({ side: THREE.DoubleSide });
    const skirt = new THREE.Mesh(mergeGeometries(geos), skirtMat);
    group.add(skirt);

    if (terrain.kind === 'void') {
      // underside of the floating road
      const under = ribbon(loopFrames, -outer, outer, -2.4);
      const um = own(toon(theme.underside ?? 0x2a1d66, { unique: true, side: THREE.DoubleSide, emissive: theme.undersideGlow ?? 0x1a0f44 }));
      group.add(new THREE.Mesh(under, um));
      // glowing edge line along the underside
      const lineGeo = mergeGeometries([
        ribbon(loopFrames, outer - 0.35, outer, -2.35),
        ribbon(loopFrames, -outer, -outer + 0.35, -2.35),
      ]);
      group.add(new THREE.Mesh(lineGeo, glow(theme.undersideEdge ?? 0x7ff5ff)));
      return;
    }

    // Pillars where the road is well above the ground
    const pillars = [];
    for (let s = 0; s < L; s += 9) {
      const f = frames(path, s, s + 0.01, 1)[0];
      for (const side of [-1, 1]) {
        const lat = side * (hw - 1.5);
        const x = f.x + f.rx * lat, z = f.z + f.rz * lat;
        const gy = groundH(x, z);
        const gap = f.y - gy;
        if (gap > 2.4) pillars.push({ x, z, y0: gy, y1: f.y - 0.2 });
      }
    }
    if (pillars.length) {
      const pil = theme.pillar || {};
      const colGeo = pil.shape === 'box'
        ? new THREE.BoxGeometry(1.6, 1, 1.6)
        : new THREE.CylinderGeometry(0.9, 1.1, 1, 12);
      const colMat = toon(pil.color ?? 0xffffff);
      const ringGeo = new THREE.TorusGeometry(1.05, 0.3, 8, 16);
      const ringMat = toon(pil.ring ?? 0xff8cc6);
      const cols = new THREE.InstancedMesh(colGeo, colMat, pillars.length);
      const rings = new THREE.InstancedMesh(ringGeo, ringMat, pillars.length * 2);
      pillars.forEach((p, i) => {
        const h = p.y1 - p.y0;
        cols.setMatrixAt(i, mat4(p.x, p.y0 + h / 2, p.z, { s: [1, h, 1] }));
        rings.setMatrixAt(i * 2, mat4(p.x, p.y1 - 0.3, p.z, { rx: Math.PI / 2 }));
        rings.setMatrixAt(i * 2 + 1, mat4(p.x, p.y0 + 0.3, p.z, { rx: Math.PI / 2 }));
      });
      group.add(cols, rings);
    }
  }

  function buildFences() {
    const f = def.scenery?.fence || {};
    const glowy = !!f.glow;
    const spacing = 4;
    const lat = hw + FENCE_OFFSET;
    const posts = [];
    for (let s = 0; s < L - spacing * 0.5; s += spacing) {
      const fr = frames(path, s, s + 0.01, 1)[0];
      for (const side of [-1, 1]) {
        posts.push({ x: fr.x + fr.rx * lat * side, y: fr.y, z: fr.z + fr.rz * lat * side, h: Math.atan2(fr.tx, fr.tz), k: posts.length });
      }
    }
    const postH = 1.35;
    const postGeo = new THREE.CylinderGeometry(0.2, 0.24, postH, 6, 1, true);
    const postMat = glowy ? glow(0xffffff) : toon(0xffffff);
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    const cA = new THREE.Color(f.post ?? 0xffffff);
    const cB = new THREE.Color(f.postAlt ?? 0xff7fbf);
    posts.forEach((p, i) => {
      postMesh.setMatrixAt(i, mat4(p.x, p.y + postH / 2, p.z));
      postMesh.setColorAt(i, Math.floor(i / 2) % 2 ? cB : cA);
    });
    group.add(postMesh);

    // toppers
    let topGeo;
    const topper = f.topper || 'ball';
    if (topper === 'heart') topGeo = extruded(heartShape(), 0.3, 0, 3).scale(0.7, 0.7, 0.7);
    else if (topper === 'star') topGeo = extruded(starShape(5, 0.5, 0.22), 0.2, 0, 1);
    else if (topper === 'cane') {
      topGeo = new THREE.TorusGeometry(0.28, 0.12, 5, 8, Math.PI);
      topGeo.translate(0.28, 0, 0);
    } else if (topper === 'cherry') topGeo = new THREE.SphereGeometry(0.34, 8, 6);
    else topGeo = new THREE.SphereGeometry(0.3, 8, 6);
    const topMat = glowy ? own(new THREE.MeshBasicMaterial({ color: f.topperColor ?? 0xff4f9a })) : toon(f.topperColor ?? 0xff4f9a);
    const topMesh = new THREE.InstancedMesh(topGeo, topMat, posts.length);
    posts.forEach((p, i) => {
      topMesh.setMatrixAt(i, mat4(p.x, p.y + postH + 0.3, p.z, { ry: p.h + (i % 2 ? Math.PI / 2 : -Math.PI / 2) }));
    });
    group.add(topMesh);
    if (glowy) {
      animators.push((dt, t) => {
        topMat.color.setHSL(0.14 + Math.sin(t * 2) * 0.03, 1, 0.7 + Math.sin(t * 3) * 0.08);
      });
    }

    // rails: two soft bands
    const railGeos = [];
    for (const side of [-1, 1]) {
      for (const [y0, y1] of [[0.45, 0.7], [0.95, 1.2]]) {
        railGeos.push(wall(loopFrames, side * lat, (fr) => fr.y + y1, (fr) => fr.y + y0));
      }
    }
    const railMat = glowy
      ? own(new THREE.MeshBasicMaterial({ color: f.rail ?? 0x9ff7ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }))
      : own(toon(f.rail ?? 0xffa6d8, { unique: true, side: THREE.DoubleSide }));
    group.add(new THREE.Mesh(mergeGeometries(railGeos), railMat));
  }

  function buildStartArch() {
    const a = def.scenery?.arch || {};
    // checkered line
    const cells = Math.round(path.width / 1.5);
    const light = new THREE.Color(0xffffff);
    const dark = new THREE.Color(theme.startLineDark ?? (night ? 0x1b1450 : 0x5b2d6e));
    const rows = [];
    for (let r = 0; r < 2; r++) {
      const s0 = -1.5 + r * 1.5;
      const fr = frames(path, s0, s0 + 1.5, 1.5);
      for (let c = 0; c < cells; c++) {
        const l0 = -hw + (c * path.width) / cells;
        const l1 = -hw + ((c + 1) * path.width) / cells;
        const col = (r + c) % 2 ? light : dark;
        rows.push(ribbon(fr, l0, l1, 0.05, { color: () => col }));
      }
    }
    const lineMat = night ? own(new THREE.MeshBasicMaterial({ vertexColors: true })) : toonVC();
    group.add(new THREE.Mesh(mergeGeometries(rows), lineMat));

    // the arch
    const p = path.pointAt(0);
    const h = path.headingAt(0);
    const arch = new THREE.Group();
    arch.position.copy(p);
    arch.rotation.y = h;
    group.add(arch);
    const span = hw + FENCE_OFFSET + 1.8;
    const pillarH = 11;
    const stripeTex = ownTex(stripeTexture(a.a ?? 0xff7fbf, a.b ?? 0xffffff, 6));
    stripeTex.repeat.set(1, 4);
    const pillarMat = night ? own(new THREE.MeshBasicMaterial({ map: stripeTex })) : toonTex(stripeTex);
    const pillarGeo = new THREE.CylinderGeometry(0.9, 1.05, pillarH, 16);
    for (const side of [-1, 1]) {
      const pm = new THREE.Mesh(pillarGeo, pillarMat);
      pm.position.set(side * span, pillarH / 2, 0);
      arch.add(pm);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), night ? glow(a.b ?? 0xfff27a) : toon(a.b ?? 0xffffff));
      ball.position.set(side * span, pillarH + 0.9, 0);
      arch.add(ball);
    }
    // curved top
    const bowGeo = new THREE.TorusGeometry(span, 0.7, 10, 40, Math.PI);
    const bow = new THREE.Mesh(bowGeo, night ? glow(a.a ?? 0x9f8cff) : toon(a.a ?? 0xff7fbf));
    bow.position.y = pillarH;
    bow.scale.y = 0.35;
    arch.add(bow);
    // banner
    const bannerW = span * 1.5, bannerH = 2.8;
    const bannerMat = bannerMaterial(a.text ?? 'SPRINKLE KART', a.banner ?? 0xff5fa8, night);
    const bannerGeo = new THREE.PlaneGeometry(bannerW, bannerH);
    for (const flip of [0, Math.PI]) {
      const b = new THREE.Mesh(bannerGeo, bannerMat);
      b.position.set(0, pillarH + 1.2, flip ? -0.05 : 0.05);
      b.rotation.y = flip;
      arch.add(b);
    }
    // balloons bobbing on the pillars
    const balloonColors = [0xff5fa8, 0x4fb3ff, 0xffd23f, 0x8be08b, 0xb57bff];
    const balloonGeo = new THREE.SphereGeometry(0.85, 14, 10);
    balloonGeo.scale(1, 1.2, 1);
    const balloons = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const bm = new THREE.Mesh(balloonGeo, night ? glow(balloonColors[(i + (side > 0 ? 2 : 0)) % 5]) : toon(balloonColors[(i + (side > 0 ? 2 : 0)) % 5]));
        const ang = (i / 4) * Math.PI * 2;
        const base = new THREE.Vector3(side * span + Math.cos(ang) * 1.1, pillarH + 3 + (i % 2) * 0.8, Math.sin(ang) * 1.1);
        bm.position.copy(base);
        arch.add(bm);
        balloons.push({ m: bm, base, ph: i + side * 3 });
      }
    }
    animators.push((dt, t) => {
      for (const b of balloons) {
        b.m.position.y = b.base.y + Math.sin(t * 1.6 + b.ph) * 0.25;
        b.m.rotation.z = Math.sin(t * 1.2 + b.ph) * 0.15;
      }
    });
  }

  function bannerMaterial(text, color, isNight) {
    const hex = '#' + new THREE.Color(color).getHexString();
    if (typeof document === 'undefined') {
      return own(isNight ? new THREE.MeshBasicMaterial({ color }) : toon(color, { unique: true }));
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 192;
    const c2 = canvas.getContext('2d');
    c2.fillStyle = hex;
    roundRect(c2, 6, 6, 1012, 180, 80);
    c2.fill();
    c2.lineWidth = 12;
    c2.strokeStyle = '#ffffff';
    c2.stroke();
    c2.font = 'bold 112px "Fredoka", "Baloo 2", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.lineWidth = 14;
    c2.strokeStyle = '#3a2046';
    c2.strokeText(text, 512, 102);
    c2.fillStyle = '#ffffff';
    c2.fillText(text, 512, 102);
    // little hearts at the ends
    c2.fillStyle = '#ffe3f1';
    for (const x of [70, 954]) drawHeart(c2, x, 96, 34);
    const tex = ownTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return own(new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  }

  function buildBoostPads(pads) {
    if (!pads.length) return;
    const plates = [];
    const chevrons = [[], [], []];
    const mapPt = (sc, lc, a, b, yOff, out) => {
      const s = sc + a;
      const fr = frames(path, s, s + 0.01, 1)[0];
      out.push(fr.x + fr.rx * (lc + b), fr.y + yOff, fr.z + fr.rz * (lc + b));
    };
    for (const pad of pads) {
      const fr = frames(path, pad.s - 3, pad.s + 3, 0.75);
      plates.push(ribbon(fr, pad.lateral - 2.5, pad.lateral + 2.5, 0.06));
      for (let k = 0; k < 3; k++) {
        const a0 = -1.9 + k * 1.7;
        const poly = [
          [a0, -2.1], [a0 + 1.2, 0], [a0 + 0.5, 0], [a0 - 0.7, -2.1],
          [a0 + 1.2, 0], [a0, 2.1], [a0 - 0.7, 2.1], [a0 + 0.5, 0],
        ];
        const arr = chevrons[k];
        for (let q = 0; q < 2; q++) {
          const [p0, p1, p2, p3] = poly.slice(q * 4, q * 4 + 4);
          for (const [a, b] of [p0, p1, p2, p0, p2, p3]) mapPt(pad.s, pad.lateral, a, b, 0.09, arr);
        }
      }
    }
    const plateMat = own(new THREE.MeshBasicMaterial({ color: 0xff9a3c }));
    group.add(new THREE.Mesh(mergeGeometries(plates), plateMat));
    const chevMats = [0, 1, 2].map(() => own(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })));
    chevrons.forEach((arr, k) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, chevMats[k]));
    });
    const cHot = new THREE.Color(0xffffff);
    const cWarm = new THREE.Color(0xffe066);
    const cPink = new THREE.Color(0xff6fb0);
    animators.push((dt, t) => {
      for (let k = 0; k < 3; k++) {
        const phase = (t * 3 - k * 0.33) % 1;
        const v = phase < 0 ? phase + 1 : phase;
        chevMats[k].color.copy(cPink).lerp(v < 0.5 ? cHot : cWarm, v < 0.5 ? 1 - v * 2 : (v - 0.5) * 2);
      }
      plateMat.color.setHSL(0.07 + Math.sin(t * 4) * 0.015, 1, 0.6);
    });
  }

  function buildClouds() {
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const mat = own(toon(0xffffff, { unique: true, emissive: 0xfff0fa, emissiveIntensity: 0.35 }));
    mat.fog = false;
    const count = 26;
    const perCloud = 6;
    const mesh = new THREE.InstancedMesh(puff, mat, count * perCloud);
    let k = 0;
    for (let c = 0; c < count; c++) {
      const ang = rng() * Math.PI * 2;
      const dist = 480 + rng() * 260;
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
      const cy = 110 + rng() * 150;
      const size = 14 + rng() * 14;
      for (let p = 0; p < perCloud; p++) {
        const ox = (p - perCloud / 2) * size * 0.55 + (rng() - 0.5) * size * 0.3;
        const oy = (rng() - 0.3) * size * 0.35;
        const r = size * (0.45 + rng() * 0.35) * (p === 2 || p === 3 ? 1.3 : 1);
        mesh.setMatrixAt(k++, mat4(cx + ox * Math.cos(ang + 1.57), cy + oy, cz + ox * Math.sin(ang + 1.57), { s: [r, r * 0.8, r] }));
      }
    }
    const cg = new THREE.Group();
    cg.position.set(center.x, 0, center.z);
    cg.add(mesh);
    group.add(cg);
    animators.push((dt) => { cg.rotation.y += dt * 0.004; });
  }

  // =========================================================================

  return {
    group,
    sky,
    itemBoxSlots,
    boostPads,
    lights,
    terrainHeight: (x, z) => terrain.height(x, z),
    update(dt, time) {
      for (const fn of animators) fn(dt, time);
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose?.();
      });
      for (const m of ownedMaterials) m.dispose();
      for (const t of ownedTextures) t.dispose();
      flagGeo.dispose();
      group.removeFromParent();
    },
  };
}

/** Default ground tint trio (grassy greens) when a theme gives none. */
export const DEFAULT_GROUND_TINTS = Object.freeze([0xa8ec8a, 0x7fd67a, 0xc6f59a]);

// ---------------------------------------------------------------------------

/** Gradient sky dome (+ a star field when theme.skyStars). */
function buildSky(theme, own, rng, animators) {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const mat = own(new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      bottom: { value: new THREE.Color(theme.skyBottom) },
      horizon: { value: new THREE.Color(theme.fogColor) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(bottom, top, smoothstep(0.02, 0.65, h));
        c = mix(horizon, c, smoothstep(-0.06, 0.12, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }));
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky';
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  followCamera(sky);
  if (theme.skyStars) {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.02;
      const rr = Math.sqrt(1 - y * y);
      const R = SKY_RADIUS * 0.9;
      pos[i * 3] = Math.cos(a) * rr * R;
      pos[i * 3 + 1] = (u < 0 && rng() < 0.3 ? -y : y) * R;
      pos[i * 3 + 2] = Math.sin(a) * rr * R;
      c.set([0xffffff, 0xfff2b0, 0xbfe9ff, 0xffc2f0][i % 4]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pm = own(new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false }));
    const stars = new THREE.Points(g, pm);
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    followCamera(stars);
    sky.add(stars);
    animators.push((dt, t) => { pm.opacity = 0.8 + Math.sin(t * 2.3) * 0.2; });
  }
  return sky;
}

/** Keep an object centred on the camera that is drawing it (sky dome, star field). */
export function followCamera(obj) {
  obj.onBeforeRender = (renderer, scene, camera) => {
    obj.matrixWorld.makeTranslation(camera.matrixWorld.elements[12], camera.matrixWorld.elements[13], camera.matrixWorld.elements[14]);
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHeart(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.4, y - s, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.3, x, y + s * 0.35);
  ctx.fill();
}
