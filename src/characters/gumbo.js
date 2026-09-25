/**
 * Gumbo Gummybear — racer module (data + look).
 * Pack: original. Built with the shared parts library (./parts.js).
 */
import { G, toon, glow, frame, surf, addFace, addMouth, buildKartBase, addArms, makeHead, WHITE } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'gumbo',
  name: 'Gumbo Gummybear',
  tagline: 'GRRR! ...Can I have a hug after the race?',
  personality:
    'A big, grumpy-looking gummy bear with candy-corn horns who secretly just wants everyone to be his friend.',
  colors: { primary: 0xff8a3d, secondary: 0x4ccf6a, accent: 0xffd23a, kart: 0xf2663a },
  stats: { speed: 4, accel: 1, handling: 2, weight: 5 },
  voice: { pitch: 0.55, style: 'hoho' },
  locked: false,
  unlock: null,
  pack: 'original',
  pronoun: 'he',
  emoji: '🐻',
  quotes: {
    select: 'GRRR! (That means hello!)',
    win: 'GRRR-EAT! Group hug!',
    oops: 'Grr... I mean, oopsie!',
  },
};

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, {
    body: c.kart,
    trim: c.secondary,
    seat: 0x2f9a4a,
    hub: c.primary,
    width: 1.42,
    rr: 0.37,
    pipes: [[-0.36, 0.56, -1.08], [0.36, 0.56, -1.08]],
  });
  const C = rig.chassis;
  const candyCorn = (target, F, s = 1) => {
    kit.add(target, G.cyl(0.07 * s, 0.095 * s, 0.1 * s, 10), toon(0xffd23a), { f: F, p: [0, 0.05 * s, 0] });
    kit.add(target, G.cyl(0.042 * s, 0.07 * s, 0.1 * s, 10), toon(0xff8c1a), { f: F, p: [0, 0.15 * s, 0] });
    kit.add(target, G.cone(0.042 * s, 0.09 * s, 10), toon(0xfff8e8), { f: F, p: [0, 0.245 * s, 0] });
  };
  for (const x of [-0.4, 0, 0.4]) candyCorn(C, frame([x, 0.36, 1.12], [Math.PI / 2, 0, 0]), 1.0);
  for (const sd of [-1, 1]) candyCorn(C, frame([sd * 0.8, 0.5, 0.02], [0, 0, -sd * Math.PI / 2]), 0.8);
  // gummy shine stripes on the hood
  kit.add(C, G.sph(0.1, 8, 6), glow(0xffe0c8), { p: [-0.25, 0.75, 0.5], s: [1.2, 0.3, 1.8], r: [-0.2, 0, 0], outline: false });

  const gummy = toon(c.primary, { emissive: 0xff5a00, emissiveIntensity: 0.18 });
  const light = toon(0xffc27a, { emissive: 0xff8a00, emissiveIntensity: 0.12 });
  const shine = glow(0xfff1e0);
  const D = rig.driver;
  rig.driver.scale.setScalar(1.1);
  rig.driver.position.z -= 0.04;
  kit.add(D, G.sph(0.4), gummy, { p: [0, 0.94, 0], s: [1.05, 0.98, 0.95] });
  kit.add(D, G.sph(0.28, 12, 8), light, { p: [0, 0.9, 0.22], s: [1, 1.05, 0.55], outline: false });
  kit.add(D, G.sph(0.06, 6, 5), shine, { p: [-0.13, 1.05, 0.36], s: [1, 1.6, 0.4], outline: false });
  // green gummy shell with sugar bumps
  const shell = toon(c.secondary, { emissive: 0x1f8a30, emissiveIntensity: 0.18 });
  kit.add(D, G.sph(0.4), shell, { p: [0, 1.0, -0.3], s: [1.0, 1.0, 0.6] });
  kit.add(D, G.tor(0.36, 0.05, 6, 18), toon(0xfff8e8), { p: [0, 1.0, -0.24], outline: false });
  for (const [x, y] of [[0, 1.2], [-0.2, 0.95], [0.2, 0.95], [0, 0.78], [-0.18, 1.15], [0.18, 1.15]]) {
    kit.add(D, G.cone(0.055, 0.12, 8), toon(0xfff8e8), { p: [x, y, -0.53], r: [-Math.PI / 2, 0, 0] });
  }
  addArms(kit, rig, c.primary, c.primary, { shoulder: [0.36, 1.05, 0.02], r: 0.11, handR: 0.13 });

  const R = 0.47;
  const H = makeHead(rig, 1.58);
  kit.add(H, G.sph(R, 18, 12), gummy);
  for (const sd of [-1, 1]) {
    kit.add(H, G.sph(0.15, 10, 8), gummy, { p: [sd * 0.33, 0.33, -0.06], s: [1, 1, 0.6] });
    kit.add(H, G.sph(0.08, 8, 6), light, { p: [sd * 0.33, 0.33, 0.01], s: [1, 1, 0.4], outline: false });
    candyCorn(H, frame([sd * 0.17, 0.4, 0.06], [0.1, 0, -sd * 0.45]), 1.1);
  }
  // muzzle
  kit.add(H, G.sph(0.21), light, { p: [0, -0.15, 0.34], s: [1.25, 0.85, 0.8] });
  kit.add(H, G.sph(0.075, 10, 8), toon(0x5a2a1a), { p: [0, -0.06, 0.5], s: [1.35, 0.9, 0.9] });
  kit.add(H, G.sph(0.02, 5, 4), shine, { p: [-0.03, -0.035, 0.56], outline: false });
  addFace(kit, rig, R, {
    eyeColor: 0x9a4a12,
    eyeU: 0.32,
    eyeV: 0.12,
    eyeW: 0.17,
    eyeH: 0.22,
    cheekU: 0.6,
    cheekV: -0.12,
    mouth: 'none',
    brows: { color: 0x5a2a1a, v: 0.4, u: 0.3, angle: -0.35, w: 0.05 },
  });
  // grumpy-but-cute grin with two little fangs
  addMouth(kit, H, frame([0, -0.24, 0.49], [0.3, 0, 0]), 0.1, 'smile');
  for (const sd of [-1, 1]) kit.add(H, G.cone(0.022, 0.055, 6), toon(WHITE), { p: [sd * 0.06, -0.3, 0.48], r: [Math.PI, 0, 0], outline: false });
  kit.add(H, G.sph(0.07, 6, 5), shine, { f: surf(R, -0.35, 0.4, 1.0), s: [1.1, 0.55, 0.3], outline: false });
  rig.anims.push((t) => {
    // big grumpy huffs
    const h = Math.sin(t * 2.2);
    H.scale.set(1 + h * 0.015, 1 - h * 0.015, 1);
  });
}

export default { def, build };
