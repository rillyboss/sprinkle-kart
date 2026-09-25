/**
 * Princess Peachy Pie — racer module (data + look).
 * Pack: original. Built with the shared parts library (./parts.js).
 */
import { THREE, G, toon, glow, frame, limb, part, addFace, buildKartBase, addArms, makeHead, SKIN, WHITE } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'peachy',
  name: 'Princess Peachy Pie',
  tagline: 'Sweet as pie, fast as a sneeze!',
  personality:
    'The kind and bubbly princess of the Cotton Candy Castle, who wears a real (still warm!) peach pie as her crown.',
  colors: { primary: 0xff8fc8, secondary: 0xffc94d, accent: 0xffa860, kart: 0xff8fc8 },
  stats: { speed: 3, accel: 4, handling: 4, weight: 1 },
  voice: { pitch: 1.5, style: 'giggle' },
  locked: false,
  unlock: null,
  pack: 'original',
  pronoun: 'she',
  emoji: '👑',
  quotes: {
    select: 'Tee-hee! Let the sweetest racer win!',
    win: 'Pie for everyone! Tee-hee!',
    oops: 'Oh, crumbs!',
  },
};

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: WHITE, seat: 0xffd6ea, hub: 0xffffff, bar: c.kart, tire: 0x7a3a66 });
  const C = rig.chassis;
  const heart = toon(0xff4f9a);
  kit.add(C, G.heart(0.3, 0.06), heart, { p: [0, 0.79, 0.62], r: [-0.95, 0, 0] });
  for (const sd of [-1, 1]) kit.add(C, G.heart(0.2, 0.04), heart, { p: [sd * 0.755, 0.46, 0.03], r: [0, sd * Math.PI / 2, 0] });
  // pie-crust trim around the front bumper
  for (let i = 0; i < 7; i++) {
    kit.add(C, G.sph(0.06, 8, 6), toon(0xe9b066), { p: [-0.48 + i * 0.16, 0.47, 1.05], outline: false });
  }
  // big bow on the back
  const bow = toon(0xff5fa8);
  for (const sd of [-1, 1]) kit.add(C, G.cone(0.2, 0.42, 10), bow, { p: [sd * 0.22, 1.18, -0.86], r: [0, 0, sd * Math.PI / 2], s: [1, 1, 0.45] });
  kit.add(C, G.sph(0.1, 10, 8), bow, { p: [0, 1.18, -0.86] });
  for (const sd of [-1, 1]) limb(kit, C, [sd * 0.05, 1.12, -0.86], [sd * 0.18, 0.86, -0.92], 0.045, bow);

  const D = rig.driver;
  const dress = toon(c.primary);
  kit.add(D, G.sph(0.3), dress, { p: [0, 0.96, 0], s: [1, 1, 0.85] });
  kit.add(D, G.cyl(0.28, 0.5, 0.34, 16), toon(0xffb3d9), { p: [0, 0.74, 0.02] });
  kit.add(D, G.tor(0.48, 0.05, 6, 22), toon(WHITE), { p: [0, 0.59, 0.02], r: [Math.PI / 2, 0, 0], outline: false });
  for (const sd of [-1, 1]) kit.add(D, G.sph(0.13, 10, 8), toon(0xffb3d9), { p: [sd * 0.29, 1.1, 0] });
  kit.add(D, G.heart(0.14, 0.04), glow(0x7fd0ff), { p: [0, 1.02, 0.26], outline: false });
  addArms(kit, rig, SKIN, WHITE, { shoulder: [0.3, 1.08, 0.02], r: 0.065, handR: 0.095 });

  const R = 0.45;
  const H = makeHead(rig, 1.57);
  kit.add(H, G.sph(R, 18, 12), toon(0xffe2cc));
  const gold = toon(c.secondary);
  kit.add(H, G.sph(0.49), gold, { p: [0, 0.03, -0.09] });
  for (const [x, y, z] of [[-0.22, 0.33, 0.27], [0, 0.38, 0.3], [0.22, 0.33, 0.27]]) {
    kit.add(H, G.sph(0.15, 10, 8), gold, { p: [x, y, z], s: [1.1, 0.75, 0.7] });
  }
  // bouncy curls
  const curls = part(H, [0, 0, 0]);
  for (const sd of [-1, 1]) {
    kit.add(curls, G.sph(0.13, 10, 8), gold, { p: [sd * 0.44, -0.06, -0.04] });
    kit.add(curls, G.sph(0.12, 10, 8), gold, { p: [sd * 0.47, -0.26, -0.08] });
    kit.add(curls, G.sph(0.105, 10, 8), gold, { p: [sd * 0.43, -0.45, -0.1] });
    kit.add(curls, G.sph(0.12, 10, 8), gold, { p: [sd * 0.25, -0.38, -0.34] });
  }
  kit.add(curls, G.sph(0.14, 10, 8), gold, { p: [0, -0.42, -0.4] });
  rig.anims.push((t, dt, st) => {
    const b = Math.sin(t * 7) * (0.02 + 0.03 * st.speedF);
    curls.position.y = b;
    curls.scale.set(1, 1 + b, 1);
  });
  addFace(kit, rig, R, { eyeColor: 0x4a7de0, lashes: true, mouth: 'grin', mouthV: -0.38, mouthW: 0.1, cheek: 0xff7aa8 });
  // crown made of a tiny peach pie
  const CF = frame([0, 0.4, 0.0], [-0.15, 0, 0.08]).multiply(new THREE.Matrix4().makeScale(1.4, 1.4, 1.4));
  const crust = toon(0xe0a25a);
  kit.add(H, G.cyl(0.22, 0.17, 0.13, 16), crust, { f: CF, p: [0, 0.06, 0] });
  kit.add(H, G.cyl(0.195, 0.195, 0.03, 16), toon(0xffa860), { f: CF, p: [0, 0.13, 0], outline: false });
  const lattice = toon(0xf6cd8a);
  for (const o of [-0.08, 0.08]) {
    kit.add(H, G.box(0.36, 0.025, 0.04), lattice, { f: CF, p: [0, 0.15, o], outline: false });
    kit.add(H, G.box(0.04, 0.03, 0.36), lattice, { f: CF, p: [o, 0.155, 0], outline: false });
  }
  kit.add(H, G.tor(0.2, 0.04, 6, 16), toon(0xf0b56a), { f: CF, p: [0, 0.13, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(H, G.sph(0.075, 10, 8), toon(0xffa860), { f: CF, p: [0, 0.23, 0] });
  kit.add(H, G.sph(0.05, 6, 5), toon(0x5fc44f), { f: CF, p: [0.05, 0.3, 0], s: [1.3, 0.5, 0.8], r: [0, 0, 0.5] });
}

export default { def, build };
