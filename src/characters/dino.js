/**
 * Doodle Dino — racer module (data + look).
 * Pack: original. Built with the shared parts library (./parts.js).
 */
import { THREE, G, toon, frame, surf, limb, part, addFace, addMouth, buildKartBase, addArms, makeHead, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'dino',
  name: 'Doodle Dino',
  tagline: 'Is the finish line edible? Asking for me.',
  personality:
    'A goofy lavender dinosaur with mint spots and a sprinkle-donut saddle who is always, always, ALWAYS hungry.',
  colors: { primary: 0xb79cff, secondary: 0xff9ecf, accent: 0x7fe6c4, kart: 0xfff6e6 },
  stats: { speed: 3, accel: 4, handling: 3, weight: 2 },
  voice: { pitch: 1.3, style: 'yay' },
  locked: false,
  unlock: null,
  pack: 'original',
  pronoun: 'they',
  emoji: '🦖',
  quotes: {
    select: 'Rawr! Is there a snack stop?',
    win: 'Winner winner, cookie dinner!',
    oops: 'Munch... oops!',
  },
};

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: c.primary, seat: c.secondary, hub: WHITE, bar: c.primary, tire: 0x5b4a8a, shell: false });
  const C = rig.chassis;
  // cracked eggshell kart
  const shell = toon(c.kart);
  kit.add(C, G.bowl(1, 18, 7), shell, { p: [0, 0.62, 0], s: [0.7, 0.5, 1.1] });
  kit.add(C, G.cyl(1, 1, 0.04, 20), toon(0xf3e2c4), { p: [0, 0.6, 0], s: [0.68, 1, 1.07], outline: false });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    kit.add(C, G.cone(0.1, 0.12, 4), shell, { p: [Math.sin(a) * 0.68, 0.64, Math.cos(a) * 1.07], r: [0, a + Math.PI / 4, 0], s: [1, 1, 0.3], outline: false });
  }
  const spot = toon(c.accent);
  for (const [x, y, z, s] of [[0.66, 0.38, 0.4, 0.14], [-0.66, 0.4, -0.2, 0.16], [0.6, 0.33, -0.55, 0.11], [-0.6, 0.32, 0.55, 0.12], [0, 0.4, 1.02, 0.13]]) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(x, 0, z * 0.6).normalize());
    kit.add(C, G.sph(s, 10, 8), spot, { p: [x, y, z], q, s: [1, 1, 0.3], outline: false });
  }
  kit.add(C, G.cap(0.12, 0.9, 8), toon(c.primary), { p: [0, 0.32, 1.05], r: [0, 0, Math.PI / 2] });

  const D = rig.driver;
  const lav = toon(c.primary);
  const belly = toon(0xfff2c2);
  const mintSpot = toon(c.accent);
  kit.add(D, G.sph(0.34), lav, { p: [0, 0.93, 0], s: [1, 1, 0.9] });
  kit.add(D, G.sph(0.26, 12, 8), belly, { p: [0, 0.9, 0.2], s: [1, 1.05, 0.5], outline: false });
  for (const [x, y, z] of [[0.27, 1.02, -0.1], [-0.25, 0.86, -0.14], [0.2, 0.8, -0.22]]) {
    kit.add(D, G.sph(0.06, 8, 6), mintSpot, { p: [x, y, z], s: [1, 1, 0.5], outline: false });
  }
  // snack bib with a cookie on it
  kit.add(D, G.rbox(0.34, 0.22, 0.03, 0.05), toon(WHITE), { p: [0, 1.05, 0.29], r: [-0.3, 0, 0] });
  kit.add(D, G.cyl(0.065, 0.065, 0.02, 12), toon(0xd9a066), { p: [0, 1.04, 0.31], r: [Math.PI / 2 - 0.3, 0, 0], outline: false });
  for (const [x, y] of [[-0.02, 1.06], [0.025, 1.03], [0.0, 1.01]]) {
    kit.add(D, G.sph(0.012, 5, 4), toon(0x5a3420), { p: [x, y, 0.325], outline: false });
  }
  // sprinkle-donut inner-tube saddle on his back
  const tilt = -Math.PI / 2 - 0.55;
  kit.add(D, G.tor(0.17, 0.085, 8, 18), toon(0xe7a867), { p: [0, 1.1, -0.26], r: [tilt, 0, 0] });
  kit.add(D, G.tor(0.17, 0.07, 8, 18), toon(c.secondary), { p: [0, 1.13, -0.24], r: [tilt, 0, 0], outline: false });
  const sprCols = [0xffe45c, 0x5ec8ff, 0x7ee07a, 0xffffff, 0xb68cff, 0xff6b9a];
  const sprinkleFrame = frame([0, 1.13, -0.24], [tilt, 0, 0]);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    kit.add(D, G.cap(0.015, 0.04, 4), toon(sprCols[i % sprCols.length]), {
      f: sprinkleFrame, p: [Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.07], r: [0, 0, a + 0.8], outline: false,
    });
  }
  // curly tail over the side
  limb(kit, D, [0.2, 0.8, -0.25], [0.55, 0.78, -0.55], 0.12, lav);
  limb(kit, D, [0.55, 0.78, -0.55], [0.68, 0.98, -0.72], 0.08, lav);
  kit.add(D, G.sph(0.05, 8, 6), mintSpot, { p: [0.5, 0.86, -0.5], outline: false });
  addArms(kit, rig, c.primary, c.primary, { r: 0.075, handR: 0.095 });

  const R = 0.42;
  const H = makeHead(rig, 1.56);
  kit.add(H, G.sph(R, 18, 12), lav);
  // small round snout
  kit.add(H, G.sph(0.22), lav, { p: [0, -0.16, 0.28], s: [1.1, 0.8, 0.95] });
  for (const sd of [-1, 1]) {
    kit.add(H, G.sph(0.026, 6, 5), toon(0x4a2d6a), { p: [sd * 0.07, -0.08, 0.49], outline: false });
  }
  // pastel mint spots on the head
  for (const [u, v, s] of [[0.55, 0.45, 0.07], [-0.4, 0.62, 0.06], [0.15, 0.8, 0.05], [-0.7, 0.2, 0.05]]) {
    kit.add(H, G.sph(s, 8, 6), mintSpot, { f: surf(R, u, v, 0.98), s: [1, 1, 0.35], outline: false });
  }
  // soft mint back plates
  const plate = toon(c.accent);
  for (const [y, z, rx, s] of [[0.42, -0.02, -0.2, 1], [0.34, -0.26, -0.8, 0.9], [0.12, -0.42, -1.4, 0.8]]) {
    kit.add(H, G.cone(0.1 * s, 0.2 * s, 4), plate, { p: [0, y, z], r: [rx, 0, 0], s: [0.45, 1, 1] });
  }
  addFace(kit, rig, R, { eyeColor: 0x5b3a8a, eyeU: 0.3, eyeV: 0.16, eyeH: 0.3, eyeW: 0.21, mouth: 'none', cheekU: 0.62, cheekV: -0.12, cheek: 0xffa6c9 });
  addMouth(kit, H, frame([0, -0.27, 0.47], [0.35, 0, 0]), 0.12, 'smile');
  // hungry tongue that pops out now and then
  const tongue = part(H, [0.07, -0.31, 0.45]);
  kit.add(tongue, G.cap(0.045, 0.08, 6), toon(0xff7a9c), { p: [0, -0.02, 0.04], r: [1.2, 0, 0] });
  rig.anims.push((t) => {
    const k = (t % 3.2) / 3.2;
    const out = k > 0.8 ? Math.sin(((k - 0.8) / 0.2) * Math.PI) : 0;
    tongue.scale.setScalar(0.001 + out);
  });
}

export default { def, build };
