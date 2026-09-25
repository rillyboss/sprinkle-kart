/**
 * Teddy Toyland — track module (data + scenery). Cup: bubble-cup (race 3).
 * OWNER: Tracks — Bubble Cup.
 *
 * Shrunk down to toy size on a giant playroom floor! The road is a
 * play-mat road that snakes back and forth like a toy train track
 * (three switchback U-turns), jumps up a crayon ramp onto a stack of giant
 * picture books, and swings round a huge sweeper where a big friendly
 * teddy bear waves while a wind-up toy train chuffs around him. Block
 * towers, spinning tops, bouncy balls and a star mobile fill the room.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, SHOULDER_OUT, mat4, extruded, starShape, heartShape, frames, smoothstep } from './sceneryKit.js';
import { instanced, animatedInstances, patternTexture, retextureRoad, stripedSphere } from './props/bubble-kit.js';

/** Height of the picture-book plateau (the crayon ramps climb to it). */
export const BOOK_HEIGHT = 5;
/** How far the playroom walls stand beyond the track bounds. */
export const ROOM_MARGIN = 220;

const LAYOUT = {
  start: [0, 0], heading: 90, startAt: 54,
  ops: [
    { s: 70, mark: 'start-straight' },
    { s: 45, y: BOOK_HEIGHT, mark: 'ramp-up' },
    { s: 50, y: BOOK_HEIGHT, mark: 'books' },
    { s: 45, y: 0, mark: 'ramp-down' },
    { s: 20, mark: 'row1-end' },
    { turn: 180, r: 40, mark: 'u1' },
    { s: 120, mark: 'row2' },
    { turn: -180, r: 40, mark: 'u2' },
    { s: 120, mark: 'row3' },
    { turn: 180, r: 40, mark: 'u3' },
    { s: 230, mark: 'row4' },
    { turn: 180, r: 120, mark: 'big-u' },
  ],
};

const PASTELS = [0xff7f9f, 0x7fc8ff, 0xffd95f, 0x8fe08a, 0xb89cff, 0xffa65c, 0x6fe0d0];

export const def = makeTrack(
  {
    id: 'teddy-toyland',
    name: 'Teddy Toyland',
    subtitle: 'Zoom round the giant playroom',
    laps: 3,
    width: 20,
    previewColor: 0xffc86f,
    art: ['🧸', '🚂', '🧱'], // menu card emoji: big, bottom-left, top-right
    cup: 'bubble-cup',
    unlock: { type: 'stat', stat: 'racesFinished', count: 3 },
    theme: {
      skyTop: 0xfff4e2, // a soft, warm ceiling glow
      skyBottom: 0xffe6ee,
      fogColor: 0xfff0e2,
      fogNear: 220,
      fogFar: 800,
      ground: 0xf1c690, // honey-wood floorboards
      road: 0x8b98c8, // play-mat road
      roadAlt: 0x8190c2,
      curbA: 0xff5f6f,
      curbB: 0xffffff,
      offRoad: 0xffeccc,
      music: 'teddy-toyland',
      sunColor: 0xfff2dc,
      ambientColor: 0xfff0e4,
      // builder theme extras (see ARCHITECTURE.md -> theme fields)
      clouds: false, // we are indoors!
      roadSprinkles: { style: 'dots', count: 30, palette: [0x9aa6d4, 0x7f8cbe] },
      skirt: { color: 0xffd98a, trim: 0xff9f6a },
      pillar: { shape: 'box', color: 0x7fc8ff, ring: 0xffd95f },
    },
  },
  LAYOUT,
  (frac, centroid) => ({
    itemBoxRows: [frac('books', 'mid'), frac('row2', 'mid'), frac('row3', 'mid'), frac('row4', 'mid'), frac('big-u', 'mid')],
    boostPads: [
      { at: frac('ramp-up', 'start') + 0.006, lateral: 0 },
      { at: frac('u1', 'end') + 0.006, lateral: -3 },
      { at: frac('u3', 'end') + 0.006, lateral: 3 },
      { at: frac('row4', 'end') - 0.02, lateral: -3.5 },
    ],
    scenery: {
      kind: 'toyland',
      terrain: 'flat',
      center: centroid(),
      books: [frac('books', 'start'), frac('books', 'end')],
      ramps: [[frac('ramp-up', 'start'), frac('ramp-up', 'end')], [frac('ramp-down', 'start'), frac('ramp-down', 'end')]],
      bigU: { at: frac('big-u', 'mid'), r: 120 },
      fence: { post: 0xffffff, postAlt: 0xffd95f, rail: 0x7fc8ff, topper: 'ball', topperColor: 0xff7f9f },
      arch: { a: 0xffc84f, b: 0xffffff, banner: 0x5f9fff, text: 'TEDDY TOYLAND' },
    },
  }),
);

/** Play-mat road: blue-grey mat, dashed white centre line, cream lane edges. */
function playMatTexture(ctx) {
  const tex = patternTexture(ctx, 128, (u, v) => {
    // one tile = the whole road width across (u = 0 is the centre line) x 12 units along
    const base = [139, 152, 200];
    const speck = (Math.sin(u * 311.7 + v * 173.3) * 43758.5453) % 1;
    let c = base.map((k) => k + (speck - 0.5) * 8);
    const du = Math.min(u, 1 - u);
    if (du < 0.012 && v % 1 < 0.5) c = [255, 255, 255];
    const edge = Math.abs(u - 0.5);
    if (edge > 0.035 && edge < 0.055) c = [255, 241, 196];
    return c;
  });
  tex.repeat.set(9 / 20, 9 / 12);
  return tex;
}

export function buildRoadDetails(ctx) {
  retextureRoad(ctx, playMatTexture(ctx));
}

export function buildScenery(ctx) {
  const { def, path, group, rng, batch, own, hw, L, bounds, center, clearOfRoad, distToRoad, animators, scatter, sparkles, heartFlag } = ctx;
  const sc = def.scenery;
  const room = { minX: bounds.minX - ROOM_MARGIN, maxX: bounds.maxX + ROOM_MARGIN, minZ: bounds.minZ - ROOM_MARGIN, maxZ: bounds.maxZ + ROOM_MARGIN };
  const WALL_H = 200;

  floorboards();
  buildRoom();
  buildBooks();
  buildCrayonRamps();
  const bu = bigUCentre();
  buildRug(bu.x - 25, bu.z, 62);
  buildTeddy(bu.x - 25, bu.z);
  buildTrain(bu.x - 25, bu.z);
  buildBlocks();
  buildTops();
  buildBalls();
  buildRingStackers();
  buildMobile();
  buildPaperPlanes();
  sparkles(160, center.x, center.z, 260, 4, 40, [0xffffff, 0xfff3b0, 0xffd6ec], 1.2);

  // ---------------------------------------------------------------------
  function bigUCentre() {
    const f = frames(path, sc.bigU.at * L, sc.bigU.at * L + 0.01, 1)[0];
    return { x: f.x - f.rx * sc.bigU.r, z: f.z - f.rz * sc.bigU.r };
  }

  function floorboards() {
    const ground = group.getObjectByName('ground');
    if (!ground) return;
    const tex = patternTexture(ctx, 128, (u, v) => {
      const board = Math.floor(u * 4);
      const tint = [[241, 198, 144], [234, 188, 132], [246, 206, 154], [237, 194, 140]][board];
      const seam = (u * 4) % 1 < 0.035 || ((v + board * 0.37) % 1) < 0.012;
      const grain = Math.sin(v * 60 + board * 2 + Math.sin(v * 9) * 2) * 4;
      return seam ? [196, 146, 98] : tint.map((k) => k + grain);
    });
    tex.repeat.set(1 / 24, 1 / 60); // boards 6 units wide, 60 long (UVs are world units)
    ground.material.map = tex;
    ground.material.color.set(0xffffff); // the texture carries the wood colour
    ground.material.needsUpdate = true;
  }

  function buildRoom() {
    const wallTex = patternTexture(ctx, 128, (u, v) => {
      const stripe = Math.floor(u * 8) % 2;
      let c = stripe ? [255, 222, 232] : [255, 236, 242];
      // little polka hearts / dots in the pale stripes
      const du = ((u * 8) % 1) - 0.5, dv = ((v * 4) % 1) - 0.5;
      if (!stripe && Math.hypot(du, dv * 2) < 0.18) c = [255, 196, 214];
      return c;
    });
    const w = room.maxX - room.minX, d = room.maxZ - room.minZ;
    const mk = (len) => {
      const t = wallTex.clone();
      t.needsUpdate = true;
      ctx.ownTex(t);
      t.repeat.set(len / 40, WALL_H / 40);
      return ctx.toonTex(t);
    };
    const walls = [
      { x: (room.minX + room.maxX) / 2, z: room.minZ, ry: 0, len: w },
      { x: (room.minX + room.maxX) / 2, z: room.maxZ, ry: Math.PI, len: w },
      { x: room.minX, z: (room.minZ + room.maxZ) / 2, ry: Math.PI / 2, len: d },
      { x: room.maxX, z: (room.minZ + room.maxZ) / 2, ry: -Math.PI / 2, len: d },
    ];
    for (const wl of walls) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wl.len, WALL_H), mk(wl.len));
      m.position.set(wl.x, WALL_H / 2 - 0.1, wl.z);
      m.rotation.y = wl.ry;
      group.add(m);
      // chunky white skirting board
      batch.add(new THREE.BoxGeometry(wl.len, 7, 2), toon(0xffffff), mat4(wl.x, 3.5, wl.z, { ry: wl.ry }));
    }
    // the ground outside the room is hidden by the walls; floor sparkles of sunlight from the window
    const nz = room.minZ + 0.6;
    const wx = (room.minX + room.maxX) / 2 + 40;
    batch.add(new THREE.BoxGeometry(150, 96, 3), toon(0xffffff), mat4(wx, 90, nz));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(136, 82), own(new THREE.MeshBasicMaterial({ color: 0x9fd8ff, fog: false })));
    pane.position.set(wx, 90, nz + 1.7);
    group.add(pane);
    batch.add(new THREE.BoxGeometry(4, 82, 1), toon(0xffffff), mat4(wx, 90, nz + 2), false);
    batch.add(new THREE.BoxGeometry(136, 4, 1), toon(0xffffff), mat4(wx, 90, nz + 2), false);
    // fluffy clouds and a smiley sun outside the window
    const cloud = new THREE.SphereGeometry(1, 12, 8);
    const puffs = [];
    for (let k = 0; k < 9; k++) puffs.push(mat4(wx - 50 + k * 12 + (k % 3) * 4, 70 + (k % 2) * 8 + Math.sin(k) * 4, nz + 1.9, { s: [8 + (k % 3) * 2, 5, 0.4] }));
    instanced(ctx, cloud, glow(0xffffff), puffs, { outline: false });
    const sun = new THREE.Mesh(new THREE.CircleGeometry(12, 24), glow(0xffe36f));
    sun.position.set(wx + 44, 110, nz + 1.95);
    group.add(sun);
    // pink curtains
    for (const sx of [-1, 1]) batch.add(new THREE.BoxGeometry(22, 110, 3), toon(0xff9fc6), mat4(wx + sx * 82, 84, nz + 3));
    batch.add(new THREE.CylinderGeometry(1.4, 1.4, 190, 10), toon(0xffd95f), mat4(wx, 140, nz + 4, { rz: Math.PI / 2 }));
    // a big bookshelf on the east wall
    const ex = room.maxX - 0.6, ez = (room.minZ + room.maxZ) / 2 - 60;
    batch.add(new THREE.BoxGeometry(12, 120, 110), toon(0xe0a86a), mat4(ex - 6, 60, ez));
    for (let shelf = 0; shelf < 4; shelf++) {
      let zz = ez - 50;
      while (zz < ez + 48) {
        const bw = 3 + rng() * 4, bh = 16 + rng() * 10;
        batch.add(new THREE.BoxGeometry(10, bh, bw), toon(PASTELS[Math.floor(rng() * PASTELS.length)]), mat4(ex - 12, 8 + shelf * 28 + bh / 2, zz + bw / 2), false);
        zz += bw + 0.6;
      }
      batch.add(new THREE.BoxGeometry(14, 2, 110), toon(0xc98f55), mat4(ex - 7, 6 + shelf * 28, ez), false);
    }
    // crayon drawings pinned to the west wall
    const wxW = room.minX + 0.8;
    [[-80, 0xffe36f], [0, 0x8fe08a], [80, 0x7fc8ff]].forEach(([dz, c], i) => {
      const zc = (room.minZ + room.maxZ) / 2 + dz;
      batch.add(new THREE.BoxGeometry(1, 42, 54), toon(0xffffff), mat4(wxW, 70 + (i % 2) * 10, zc));
      batch.add(new THREE.BoxGeometry(1.4, 16, 16), toon(c), mat4(wxW + 0.4, 74 + (i % 2) * 10, zc), false);
      heartFlag(wxW + 2, 90 + (i % 2) * 10, zc + 20, PASTELS[i]);
    });
  }

  function buildBooks() {
    // a stack of giant picture books carrying the plateau road
    const [a, b] = sc.books;
    const f0 = frames(path, a * L - 6, a * L - 5.99, 1)[0];
    const f1 = frames(path, b * L + 6, b * L + 6.01, 1)[0];
    const cx = (f0.x + f1.x) / 2, cz = (f0.z + f1.z) / 2;
    const len = Math.hypot(f1.x - f0.x, f1.z - f0.z);
    const h = Math.atan2(f1.x - f0.x, f1.z - f0.z);
    const half = hw + SHOULDER_OUT + 2.5;
    const covers = [0xff7f9f, 0x7fc8ff, 0xffd95f];
    const thick = (BOOK_HEIGHT - 0.25) / 2;
    for (let k = 0; k < 2; k++) {
      const y = thick * k + thick / 2;
      const jig = k === 1 ? 1.2 : 0;
      batch.add(new THREE.BoxGeometry(half * 2 + 1 + jig, thick, len + 2 - jig * 2), toon(covers[k]), mat4(cx, y, cz, { ry: h + (k ? 0.02 : -0.015) }));
      // white page edges on the open side
      batch.add(new THREE.BoxGeometry(half * 2 + 1.6 + jig, thick * 0.72, len + 0.6 - jig * 2), toon(0xfffaf0), mat4(cx, y, cz, { ry: h + (k ? 0.02 : -0.015) }), false);
    }
    // a picture book lying open on the floor beside the plateau, bookmark ribbon peeking out
    const side = [cx + Math.cos(h) * (half + 20), cz - Math.sin(h) * (half + 20)];
    if (clearOfRoad(side[0], side[1], SHOULDER_OUT + 16)) {
      for (const sgn of [-1, 1]) {
        const ox = Math.cos(h) * sgn * 7.6, oz = -Math.sin(h) * sgn * 7.6;
        batch.add(new THREE.BoxGeometry(15, 0.8, 22), toon(covers[2]), mat4(side[0] + ox, 0.6, side[1] + oz, { ry: h, rz: -sgn * 0.12 }));
        batch.add(new THREE.BoxGeometry(14, 1.2, 21), toon(0xfffaf0), mat4(side[0] + ox * 0.97, 1.4, side[1] + oz * 0.97, { ry: h, rz: -sgn * 0.12 }), false);
        // a big friendly picture on each page
        batch.add(new THREE.CylinderGeometry(3.6, 3.6, 0.2, 20), toon(sgn > 0 ? 0xff9fc6 : 0x8fe08a), mat4(side[0] + ox * 0.97, 2.1 + 0.1, side[1] + oz * 0.97, { ry: h, rz: -sgn * 0.12 }), false);
      }
      batch.add(new THREE.BoxGeometry(1.2, 0.3, 30), toon(0xff5f6f), mat4(side[0], 2.2, side[1], { ry: h }), false);
    }
  }

  function buildCrayonRamps() {
    // giant crayons lying along both sides of each ramp, climbing with it
    const body = new THREE.CylinderGeometry(1, 1, 1, 12);
    body.rotateX(Math.PI / 2);
    const tip = new THREE.ConeGeometry(1, 2.4, 12);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, 0, 0.5 + 1.2);
    const bodies = [], tips = [], bands = [], cols = [];
    const lat = hw + SHOULDER_OUT + 1.6;
    for (const [a, b] of sc.ramps) {
      const f0 = frames(path, a * L - 2, a * L - 1.99, 1)[0];
      const f1 = frames(path, b * L + 2, b * L + 2.01, 1)[0];
      for (const sgn of [-1, 1]) {
        const x0 = f0.x + f0.rx * lat * sgn, z0 = f0.z + f0.rz * lat * sgn;
        const x1 = f1.x + f1.rx * lat * sgn, z1 = f1.z + f1.rz * lat * sgn;
        const len = Math.hypot(x1 - x0, z1 - z0, f1.y - f0.y);
        const yaw = Math.atan2(x1 - x0, z1 - z0);
        const pitch = -Math.atan2(f1.y - f0.y, Math.hypot(x1 - x0, z1 - z0));
        // the tip points up the slope (towards the books)
        const up = f1.y > f0.y;
        const m = mat4((x0 + x1) / 2, (f0.y + f1.y) / 2 + 1, (z0 + z1) / 2, { ry: up ? yaw : yaw + Math.PI, rx: up ? pitch : -pitch, s: [1.1, 1.1, len - 3] });
        const c = PASTELS[(bodies.length * 3) % PASTELS.length];
        bodies.push(m); cols.push(c);
        const mt = mat4((x0 + x1) / 2, (f0.y + f1.y) / 2 + 1, (z0 + z1) / 2, { ry: up ? yaw : yaw + Math.PI, rx: up ? pitch : -pitch, s: [1.1, 1.1, 1] });
        const fwd = new THREE.Vector3(0, 0, (len - 3) / 2).applyMatrix4(new THREE.Matrix4().extractRotation(mt));
        tips.push(mat4((x0 + x1) / 2 + fwd.x, (f0.y + f1.y) / 2 + 1 + fwd.y, (z0 + z1) / 2 + fwd.z, { ry: up ? yaw : yaw + Math.PI, rx: up ? pitch : -pitch, s: [1.1, 1.1, 1.1] }));
        bands.push(mat4((x0 + x1) / 2, (f0.y + f1.y) / 2 + 1, (z0 + z1) / 2, { ry: up ? yaw : yaw + Math.PI, rx: up ? pitch : -pitch, s: [1.16, 1.16, (len - 3) * 0.55] }));
      }
    }
    instanced(ctx, body, toon(0xffffff), bands, { colors: [0xffffff], outline: false });
    instanced(ctx, body, toon(0xffffff), bodies, { colors: cols, ow: 0.05 });
    instanced(ctx, tip, toon(0xffffff), tips, { colors: cols });
    // more crayons scattered on the floor
    const loose = scatter(18, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 8), { pad: 90 }).map(([x, z]) => mat4(x, 1.1, z, { ry: rng() * 6, s: [1.1, 1.1, 10 + rng() * 6] }));
    const looseCols = loose.map((_, i) => PASTELS[i % PASTELS.length]);
    instanced(ctx, body, toon(0xffffff), loose, { colors: looseCols });
  }

  function buildRug(x, z, r) {
    const geo = new THREE.CircleGeometry(r, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const rings = [0xffd6e6, 0xfff2c2, 0xd6f0ff, 0xe2d6ff, 0xd8f6dc];
    for (let i = 0; i < pos.count; i++) {
      const rr = Math.hypot(pos.getX(i), pos.getZ(i)) / r;
      c.set(rings[Math.min(rings.length - 1, Math.floor(rr * rings.length))]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const rug = new THREE.Mesh(geo, ctx.toonVC());
    rug.position.set(x, 0.03, z);
    group.add(rug);
  }

  function buildTeddy(x, z) {
    // a huge, soft, friendly teddy bear sitting in the middle of the big sweeper, waving
    const FUR = 0xd9a066, LIGHT = 0xf6d6a8, NOSE = 0x5a3a3a;
    const teddy = new THREE.Group();
    teddy.position.set(x, 0, z);
    teddy.scale.setScalar(1.55);
    // face the start straight (roughly towards the rest of the room)
    teddy.rotation.y = Math.atan2(center.x - x, center.z - z);
    group.add(teddy);
    const add = (geo, color, p, s = [1, 1, 1], parent = teddy) => {
      const m = new THREE.Mesh(geo, toon(color));
      m.position.set(...p);
      m.scale.set(...s);
      parent.add(m);
      return m;
    };
    const sph = new THREE.SphereGeometry(1, 24, 18);
    add(sph, FUR, [0, 9, 0], [8.5, 9.5, 7.5]); // body
    add(sph, LIGHT, [0, 8.5, 5.2], [5.6, 6.4, 3]); // tummy
    for (const sx of [-1, 1]) {
      add(sph, FUR, [sx * 5.5, 3, 5], [3.4, 3.2, 5]); // legs
      add(sph, LIGHT, [sx * 5.5, 3, 9.6], [2.4, 2.4, 0.8]); // paw pads
    }
    const head = new THREE.Group();
    head.position.set(0, 22.5, 0.5);
    teddy.add(head);
    add(sph, FUR, [0, 0, 0], [7, 6.4, 6.4], head);
    add(sph, LIGHT, [0, -1.6, 5.4], [3, 2.3, 1.8], head); // snout
    add(sph, NOSE, [0, -0.6, 7.1], [1.1, 0.8, 0.7], head);
    for (const sx of [-1, 1]) {
      add(sph, FUR, [sx * 5.4, 5, 0], [2.4, 2.4, 1.4], head); // ears
      add(sph, 0xffb3c6, [sx * 5.4, 5, 0.9], [1.4, 1.4, 0.8], head);
      const eye = new THREE.Mesh(sph, toon(0x2a1a2a));
      eye.position.set(sx * 2.4, 1.2, 5.6);
      eye.scale.set(0.9, 1.1, 0.6);
      head.add(eye);
      const glint = new THREE.Mesh(sph, glow(0xffffff));
      glint.position.set(sx * 2.4 + 0.3, 1.6, 6.1);
      glint.scale.setScalar(0.3);
      head.add(glint);
      add(sph, 0xff9fb6, [sx * 4, -1.4, 4.8], [1.2, 0.8, 0.5], head); // rosy cheeks
    }
    // a big pink bow tie
    const bow = new THREE.SphereGeometry(1, 12, 10);
    for (const sx of [-1, 1]) add(bow, 0xff6f9f, [sx * 2.4, 17.4, 5.6], [2.6, 1.8, 1]);
    add(bow, 0xff8fb4, [0, 17.4, 6.2], [1, 1, 1]);
    // arms: one resting, one waving hello
    add(sph, FUR, [-8.2, 10.5, 1.5], [2.8, 5.2, 2.8]).rotation.z = -0.5;
    const arm = new THREE.Group();
    arm.position.set(7.2, 15, 1);
    teddy.add(arm);
    add(sph, FUR, [1.4, 3.8, 0], [2.8, 5.2, 2.8], arm).rotation.z = -0.35;
    animators.push((dt, t) => {
      arm.rotation.z = -0.35 + Math.sin(t * 2.4) * 0.35;
      head.rotation.z = Math.sin(t * 1.2) * 0.06;
      head.rotation.y = Math.sin(t * 0.5) * 0.15;
    });
  }

  function buildTrain(cx, cz) {
    // a wind-up toy train chuffing round an oval track around the teddy
    const rx = 44, rz = 58;
    const point = (a) => new THREE.Vector3(cx + Math.cos(a) * rx, 0, cz + Math.sin(a) * rz);
    // rails + sleepers
    const railGeos = [];
    for (const off of [-1.6, 1.6]) {
      const pts = [];
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * Math.PI * 2;
        const n = new THREE.Vector2(Math.cos(a) / rx, Math.sin(a) / rz).normalize();
        pts.push(new THREE.Vector3(cx + Math.cos(a) * rx + n.x * off, 0.5, cz + Math.sin(a) * rz + n.y * off));
      }
      railGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.3, 5, true));
    }
    group.add(new THREE.Mesh(mergeGeometries(railGeos), toon(0xb8c0d8)));
    const ties = [];
    for (let k = 0; k < 80; k++) {
      const a = (k / 80) * Math.PI * 2;
      const p = point(a);
      const tang = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz);
      ties.push(mat4(p.x, 0.2, p.z, { ry: tang }));
    }
    instanced(ctx, new THREE.BoxGeometry(5, 0.4, 1.2), toon(0xc98f55), ties, { outline: false });
    // cars: vertex-coloured merged geometry each (engine + 3 wagons)
    const vc = (geo, color) => {
      const g = geo.toNonIndexed();
      const c = new THREE.Color(color);
      const arr = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      if (g.attributes.uv) g.deleteAttribute('uv');
      return g;
    };
    const wheel = (x, z, c) => {
      const g = new THREE.CylinderGeometry(1.3, 1.3, 0.6, 14);
      g.rotateZ(Math.PI / 2);
      g.translate(x, 1.3, z);
      return vc(g, c);
    };
    const wheels = (c) => [-1, 1].flatMap((sx) => [-2, 2].map((sz) => wheel(sx * 2.3, sz, c)));
    const tr = (g, x, y, z) => { g.translate(x, y, z); return g; };
    const engine = mergeGeometries([
      vc(tr(new THREE.BoxGeometry(4.4, 3, 8), 0, 3, 0), 0xff5f6f),
      vc(tr(new THREE.CylinderGeometry(1.9, 1.9, 5, 14).rotateX(Math.PI / 2), 0, 4.8, 1.2), 0xff7f9f),
      vc(tr(new THREE.BoxGeometry(4.6, 4, 3), 0, 6, -2.6), 0x7fc8ff),
      vc(tr(new THREE.BoxGeometry(5.2, 0.6, 3.6), 0, 8.2, -2.6), 0xffd95f),
      vc(tr(new THREE.CylinderGeometry(0.9, 0.6, 2.6, 10), 0, 7.6, 2.6), 0x5a4a6a),
      vc(tr(new THREE.SphereGeometry(0.8, 10, 8), 0, 4.8, 3.8), 0xffe36f),
      ...wheels(0x5a4a6a),
    ]);
    const wagon = (c) => mergeGeometries([
      vc(tr(new THREE.BoxGeometry(4.4, 3, 7), 0, 3.2, 0), c),
      vc(tr(new THREE.BoxGeometry(4.8, 0.5, 7.4), 0, 4.9, 0), 0xffffff),
      ...wheels(0x5a4a6a),
    ]);
    const cars = [engine, wagon(0x8fe08a), wagon(0xffd95f), wagon(0xb89cff)].map((g) => {
      const m = new THREE.Mesh(g, ctx.toonVC());
      group.add(m);
      return m;
    });
    // cargo: blocks and a ball riding in the wagons
    const cargo = [
      new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), toon(0x7fc8ff)),
      new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), toon(0xff7f9f)),
      new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), toon(0xffa65c)),
    ];
    cargo.forEach((m) => group.add(m));
    // steam puffs
    const puffItems = Array.from({ length: 8 }, (_, i) => ({ i }));
    let engineTip = new THREE.Vector3();
    const puffs = animatedInstances(ctx, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff), puffItems, (it, t, o) => {
      const u = ((t * 0.9 + it.i / puffItems.length) % 1);
      o.position.set(engineTip.x + Math.sin(it.i * 2.1) * u * 2, engineTip.y + u * 9, engineTip.z + Math.cos(it.i * 1.7) * u * 2);
      o.scale.setScalar(0.6 + u * 1.8);
    });
    const speed = 0.22;
    const place = (t) => {
      cars.forEach((m, k) => {
        const a = -t * speed - k * 0.2;
        const p = point(a);
        const ahead = point(a - 0.01);
        m.position.set(p.x, 0.3 + Math.abs(Math.sin(t * 10 + k)) * 0.15, p.z);
        m.rotation.y = Math.atan2(ahead.x - p.x, ahead.z - p.z);
        if (k > 0) {
          const c = cargo[k - 1];
          c.position.set(p.x, 6.4, p.z);
          c.rotation.y = m.rotation.y + t;
        } else {
          const fwd = new THREE.Vector3(0, 9, 2.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), m.rotation.y);
          engineTip = new THREE.Vector3(p.x + fwd.x, fwd.y, p.z + fwd.z);
        }
      });
    };
    place(0);
    animators.unshift((dt, t) => place(t)); // before the puffs read engineTip
    if (puffs) puffs.update(0);
  }

  function buildBlocks() {
    // toy block towers and pyramids between the switchbacks
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const mats = [], cols = [];
    const spots = scatter(26, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 9), { pad: 110 });
    spots.forEach(([x, z], i) => {
      const s = 4 + rng() * 3;
      const kind = i % 3;
      const ry = rng() * Math.PI;
      if (kind === 0) {
        const n = 2 + Math.floor(rng() * 4);
        for (let k = 0; k < n; k++) {
          mats.push(mat4(x + (rng() - 0.5) * 0.8, s * (k + 0.5), z + (rng() - 0.5) * 0.8, { ry: ry + (rng() - 0.5) * 0.4, s }));
          cols.push(PASTELS[(i + k) % PASTELS.length]);
        }
      } else if (kind === 1) {
        // little pyramid: 3 + 2 + 1
        const cx = Math.cos(ry), cz = Math.sin(ry);
        for (let row = 0; row < 3; row++) {
          for (let k = 0; k < 3 - row; k++) {
            const off = (k - (2 - row) / 2) * s * 1.02;
            mats.push(mat4(x + cx * off, s * (row + 0.5), z + cz * off, { ry: -ry, s }));
            cols.push(PASTELS[(i * 2 + row + k) % PASTELS.length]);
          }
        }
      } else {
        mats.push(mat4(x, s / 2, z, { ry, s }));
        cols.push(PASTELS[i % PASTELS.length]);
        mats.push(mat4(x + s * 0.3, s * 1.5, z, { ry: ry + 0.6, s: s * 0.9 }));
        cols.push(PASTELS[(i + 3) % PASTELS.length]);
      }
    });
    instanced(ctx, cube, toon(0xffffff), mats, { colors: cols, ow: 0.03 });
    // a white inset "label" face on every block side (reads as a letter block)
    const labels = [];
    const face = new THREE.PlaneGeometry(0.62, 0.62);
    const faceGeo = mergeGeometries([0, 1, 2, 3].map((k) => {
      const g = face.clone();
      g.translate(0, 0, 0.502);
      g.rotateY((k * Math.PI) / 2);
      return g;
    }));
    mats.forEach((m) => labels.push(m));
    instanced(ctx, faceGeo, toon(0xfffaf0), labels, { outline: false });
    // a stubby dot on each label (like the letter's blob)
    const dot = new THREE.CylinderGeometry(0.16, 0.16, 0.02, 10);
    dot.rotateX(Math.PI / 2);
    const dotGeo = mergeGeometries([0, 1, 2, 3].map((k) => {
      const g = dot.clone();
      g.translate(0, 0, 0.51);
      g.rotateY((k * Math.PI) / 2);
      return g;
    }));
    instanced(ctx, dotGeo, toon(0xffffff), labels, { colors: cols.map((c, i) => PASTELS[(PASTELS.indexOf(c) + 2) % PASTELS.length]), outline: false });
  }

  function buildTops() {
    // spinning tops twirling happily on the floor
    const top = mergeGeometries([
      new THREE.ConeGeometry(2.2, 2.6, 16).rotateX(Math.PI).translate(0, 1.3, 0).toNonIndexed(),
      new THREE.CylinderGeometry(2.2, 2.2, 0.8, 16).translate(0, 2.9, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.3, 0.3, 2, 8).translate(0, 4.2, 0).toNonIndexed(),
    ]);
    const spots = scatter(10, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 6), { pad: 80 });
    const items = spots.map(([x, z]) => ({ x, z, ph: rng() * 6, s: 1.2 + rng() * 0.8, sp: 6 + rng() * 4, wob: 0.08 + rng() * 0.1 }));
    animatedInstances(ctx, top, toon(0xffffff), items, (it, t, o) => {
      o.position.set(it.x + Math.cos(t * 0.5 + it.ph) * 3, 0, it.z + Math.sin(t * 0.5 + it.ph) * 3);
      o.rotation.set(Math.sin(t * 3 + it.ph) * it.wob, t * it.sp, Math.cos(t * 3 + it.ph) * it.wob, 'YXZ');
      o.scale.setScalar(it.s);
    }, { colors: PASTELS, outline: true, ow: 0.08 });
  }

  function buildBalls() {
    const spots = scatter(14, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 6), { pad: 90 });
    const items = spots.map(([x, z]) => ({ x, z, r: 2 + rng() * 2, ph: rng() * 6, hop: 2 + rng() * 5 }));
    animatedInstances(ctx, stripedSphere(1, [0xff7f9f, 0xffd95f, 0x7fc8ff, 0x8fe08a], 12), ctx.toonVC(), items, (it, t, o) => {
      const b = Math.abs(Math.sin(t * 2 + it.ph));
      o.position.set(it.x, it.r + b * it.hop, it.z);
      o.rotation.set(t * 0.8 + it.ph, it.ph, 0);
      const squash = 1 - (1 - b) * 0.12;
      o.scale.set(it.r / Math.sqrt(squash), it.r * squash, it.r / Math.sqrt(squash));
    }, { outline: true, ow: 0.05 });
  }

  function buildRingStackers() {
    // rainbow ring-stacker toys: big landmarks at the switchback ends
    const spots = scatter(5, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 16), { pad: 60 });
    const ringGeo = new THREE.TorusGeometry(1, 0.55, 10, 24);
    ringGeo.rotateX(Math.PI / 2);
    const rings = [], cols = [], poles = [], caps = [];
    const rainbow = [0xff6f91, 0xffa94d, 0xffe066, 0x8ce99a, 0x74c0fc, 0x9775fa];
    for (const [x, z] of spots) {
      const s = 1.6 + rng() * 0.6;
      let y = 1.2 * s;
      rainbow.forEach((c, k) => {
        const r = (6 - k * 0.8) * s;
        rings.push(mat4(x, y, z, { s: [r, 1.8 * s, r] }));
        cols.push(c);
        y += 1.95 * s;
      });
      poles.push(mat4(x, y / 2, z, { s: [s, y, s] }));
      caps.push(mat4(x, y + 1.2 * s, z, { s: 2.2 * s }));
    }
    instanced(ctx, ringGeo, toon(0xffffff), rings, { colors: cols, ow: 0.04 });
    instanced(ctx, new THREE.CylinderGeometry(1, 1, 1, 10), toon(0xfff3d6), poles, { outline: false });
    instanced(ctx, new THREE.SphereGeometry(1, 14, 10), toon(0xff6f91), caps);
  }

  function buildMobile() {
    // a slowly turning baby mobile of stars, moons and clouds hanging from the ceiling
    const m = new THREE.Group();
    m.position.set(center.x + 30, 110, center.z - 20);
    group.add(m);
    const bar = new THREE.Mesh(new THREE.TorusGeometry(32, 0.6, 6, 48), toon(0xffffff));
    bar.rotation.x = Math.PI / 2;
    m.add(bar);
    const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 90, 5), toon(0xffffff));
    hang.position.y = 45;
    m.add(hang);
    const star = extruded(starShape(5, 4, 1.8), 1.2, 0.3, 1);
    const heart = extruded(heartShape(), 0.6, 0.15, 6).scale(6, 6, 6);
    const moon = new THREE.TorusGeometry(3.6, 1.4, 8, 20, Math.PI * 1.25);
    const shapes = [star, heart, moon, star, heart, star];
    const dangles = shapes.map((g, k) => {
      const a = (k / shapes.length) * Math.PI * 2;
      const holder = new THREE.Group();
      holder.position.set(Math.cos(a) * 32, 0, Math.sin(a) * 32);
      m.add(holder);
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 14 + (k % 2) * 8, 4), toon(0xffffff));
      str.position.y = -(7 + (k % 2) * 4);
      holder.add(str);
      const mesh = new THREE.Mesh(g, toon(PASTELS[k % PASTELS.length], { emissive: 0x442233, emissiveIntensity: 0.3 }));
      mesh.position.y = -(15 + (k % 2) * 8);
      holder.add(mesh);
      return mesh;
    });
    animators.push((dt, t) => {
      m.rotation.y = t * 0.12;
      dangles.forEach((d, k) => { d.rotation.y = Math.sin(t * 0.8 + k) * 0.8; d.rotation.z = Math.sin(t * 0.6 + k) * 0.1; });
    });
  }

  function buildPaperPlanes() {
    const plane = new THREE.BufferGeometry();
    plane.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 3, -2.2, 0.3, -2, 0, -0.5, -1.6,
      0, 0, 3, 0, -0.5, -1.6, 2.2, 0.3, -2,
    ], 3));
    plane.computeVertexNormals();
    const items = Array.from({ length: 6 }, (_, i) => ({
      cx: center.x + (rng() - 0.5) * 200, cz: center.z + (rng() - 0.5) * 180, r: 30 + rng() * 40, y: 30 + rng() * 30, sp: (0.15 + rng() * 0.1) * (i % 2 ? 1 : -1), ph: rng() * 6,
    }));
    animatedInstances(ctx, plane, toon(0xffffff, { side: THREE.DoubleSide }), items, (it, t, o) => {
      const a = t * it.sp + it.ph;
      o.position.set(it.cx + Math.cos(a) * it.r, it.y + Math.sin(t * 0.7 + it.ph) * 4, it.cz + Math.sin(a) * it.r);
      const tx = -Math.sin(a) * Math.sign(it.sp), tz = Math.cos(a) * Math.sign(it.sp);
      o.rotation.set(0, Math.atan2(tx, tz), -0.35 * Math.sign(it.sp));
      o.scale.setScalar(1.6);
    }, { colors: [0xffffff, 0xfff3b0, 0xd6f0ff, 0xffd6e6] });
  }
}

export default { def, buildScenery, buildRoadDetails };
