/**
 * Bizzy Bumble — racer module (data + look).
 * Pack: original. Built with the shared parts library (./parts.js).
 */
import { G, toon, glow, surf, stick, part, addFace, buildKartBase, addArms, makeHead } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'bizzy',
  name: 'Bizzy Bumble',
  tagline: 'Un-BEE-lievably fast! Buzz buzz!',
  personality:
    'A silly bumblebee pilot who talks almost entirely in puns and buzzes her tiny wings when she gets excited.',
  colors: { primary: 0xffd23f, secondary: 0x2b2233, accent: 0xff9ecf, kart: 0xffd23f },
  stats: { speed: 2, accel: 4, handling: 5, weight: 1 },
  voice: { pitch: 1.6, style: 'hum' },
  locked: false,
  unlock: null,
  pack: 'original',
  pronoun: 'she',
  emoji: '🐝',
  quotes: {
    select: "Let's bee-gin! Buzz buzz!",
    win: "I'm the bee's knees!",
    oops: 'Oh, honey!',
  },
};

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: c.secondary, seat: 0xff9ecf, hub: c.kart, bar: c.secondary });
  const C = rig.chassis;
  const black = toon(c.secondary);
  kit.add(C, G.box(1.33, 0.08, 0.14), black, { p: [0, 0.56, 0.15], outline: false });
  kit.add(C, G.box(1.33, 0.08, 0.14), black, { p: [0, 0.56, -0.2], outline: false });
  kit.add(C, G.rbox(0.8, 0.07, 0.14, 0.03), black, { p: [0, 0.72, 0.62], r: [-0.2, 0, 0], outline: false });
  const honey = toon(0xffa51f);
  kit.add(C, G.cyl(0.14, 0.14, 0.05, 6), honey, { p: [0, 0.77, 0.36], r: [-0.2, 0, 0] });
  for (const sd of [-1, 1]) {
    kit.add(C, G.cyl(0.09, 0.09, 0.05, 6), honey, { p: [sd * 0.76, 0.46, 0.05], r: [0, 0, Math.PI / 2] });
  }
  // stinger tail-light
  kit.add(C, G.cone(0.12, 0.34, 10), black, { p: [0, 0.48, -1.2], r: [-Math.PI / 2, 0, 0] });

  const D = rig.driver;
  rig.driver.scale.setScalar(0.96);
  const yellow = toon(c.primary);
  kit.add(D, G.sph(0.35), yellow, { p: [0, 0.93, 0] });
  for (const [y, rad] of [[0.84, 0.335], [1.04, 0.31]]) kit.add(D, G.tor(rad, 0.05, 6, 20), black, { p: [0, y, 0], r: [Math.PI / 2, 0, 0], outline: false });
  addArms(kit, rig, c.secondary, c.secondary, { r: 0.06, handR: 0.085 });
  // buzzy wings
  const wingMat = toon(0xeaf8ff, { transparent: true, opacity: 0.72, emissive: 0xbfe9ff, emissiveIntensity: 0.5 });
  const wings = [];
  for (const sd of [-1, 1]) {
    const w = part(D, [sd * 0.12, 1.2, -0.3]);
    w.rotation.y = sd * 0.35;
    kit.add(w, G.sph(0.36, 12, 8), wingMat, { p: [sd * 0.26, 0.3, -0.04], s: [0.85, 0.5, 0.06], r: [0, 0, sd * -0.75], outline: false });
    kit.add(w, G.sph(0.24, 10, 6), wingMat, { p: [sd * 0.28, 0.0, -0.04], s: [0.85, 0.5, 0.06], r: [0, 0, sd * -0.2], outline: false });
    wings.push([w, sd]);
  }

  const R = 0.43;
  const H = makeHead(rig, 1.55);
  kit.add(H, G.sph(R, 18, 12), yellow);
  for (const [x, z] of [[-0.08, 0.1], [0.06, 0.12], [0, -0.02]]) kit.add(H, G.sph(0.1, 8, 6), black, { p: [x, 0.4, z] });
  // goggles on her forehead
  const band = toon(0x8b5a2b);
  kit.add(H, G.tor(0.43, 0.035, 5, 22), band, { p: [0, 0.2, 0], r: [Math.PI / 2 - 0.35, 0, 0], outline: false });
  for (const sd of [-1, 1]) {
    const F = surf(R, sd * 0.22, 0.5, 1.02);
    kit.add(H, G.tor(0.1, 0.035, 6, 14), toon(0xd9a441), { f: F });
    kit.add(H, G.sph(0.09, 10, 6), glow(0xbfe9ff), { f: F, s: [1, 1, 0.3], outline: false });
  }
  addFace(kit, rig, R, { eyeColor: 0x7a4a1a, eyeV: -0.05, mouth: 'grin', mouthV: -0.42, mouthW: 0.11, lashes: true });
  // wobbly antennae
  const antennae = [];
  for (const sd of [-1, 1]) {
    const a = part(H, [sd * 0.12, 0.36, 0.05]);
    stick(kit, a, [0, 0, 0], [sd * 0.16, 0.36, 0.06], 0.02, black);
    kit.add(a, G.sph(0.07, 10, 8), toon(c.accent), { p: [sd * 0.17, 0.4, 0.07] });
    antennae.push([a, sd]);
  }
  rig.anims.push((t, dt, st) => {
    const buzz = Math.sin(t * 55);
    for (const [w, sd] of wings) w.rotation.z = sd * buzz * 0.35;
    for (const [a, sd] of antennae) a.rotation.z = Math.sin(t * 5 + sd) * 0.12 - st.steer * 0.15;
  });
}

export default { def, build };
