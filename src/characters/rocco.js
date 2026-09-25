/**
 * Rocco Ravioli — racer module (data + look).
 * Pack: original. Built with the shared parts library (./parts.js).
 */
import { G, toon, frame, limb, stick, part, addFace, buildKartBase, makeHead, SKIN, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'rocco',
  name: 'Rocco Ravioli',
  tagline: 'Extra cheese, extra speed!',
  personality:
    'A jolly, round pasta chef in a checkered apron whose curly spaghetti mustache wiggles whenever he laughs — which is always.',
  colors: { primary: 0xe8413c, secondary: 0xfff3dc, accent: 0x5cc85a, kart: 0xe8413c },
  camera: { height: 0.3, lookHeight: -0.15 }, // puffy chef hat: keep the road ahead in view
  stats: { speed: 3, accel: 3, handling: 3, weight: 3 },
  voice: { pitch: 0.8, style: 'hoho' },
  locked: false,
  unlock: null,
  pack: 'original',
  pronoun: 'he',
  emoji: '🍝',
  quotes: {
    select: 'Ho ho! Time to cook up some speed!',
    win: 'Bellissimo! Pasta party for everyone!',
    oops: 'Oopsie-meatball!',
  },
};

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  // Italian-flag kart: tomato red body, cream trim, basil-green seat.
  buildKartBase(kit, rig, { body: c.kart, trim: c.secondary, seat: c.accent, hub: c.accent, bar: c.secondary });
  const C = rig.chassis;
  // hood ornament: a happy wedge of cheese
  const cheese = toon(0xffd35c);
  kit.add(C, G.cyl(0.15, 0.15, 0.12, 3), cheese, { p: [0, 0.82, 0.74], r: [Math.PI / 2, 0, 0] });
  for (const [x, y] of [[-0.03, 0.84], [0.04, 0.79]]) kit.add(C, G.sph(0.025, 6, 5), toon(0xf0b53a), { p: [x, y, 0.8], outline: false });
  // tomato stickers on side pods
  for (const sd of [-1, 1]) {
    kit.add(C, G.sph(0.09, 10, 8), toon(0xff4a3d), { p: [sd * 0.72, 0.47, 0.05], s: [0.4, 1, 1] });
    kit.add(C, G.star(0.05, 0.02), toon(0x4caf50), { p: [sd * 0.755, 0.55, 0.05], r: [0, sd * Math.PI / 2, 0], outline: false });
  }
  // rolling-pin spoiler
  const wood = toon(0xe8b979);
  kit.add(C, G.cyl(0.1, 0.1, 1.0, 12), wood, { p: [0, 1.2, -1.0], r: [0, 0, Math.PI / 2] });
  for (const sd of [-1, 1]) {
    kit.add(C, G.cyl(0.04, 0.04, 0.24, 8), toon(0xb8834a), { p: [sd * 0.62, 1.2, -1.0], r: [0, 0, Math.PI / 2] });
    stick(kit, C, [sd * 0.3, 0.55, -0.95], [sd * 0.3, 1.12, -1.0], 0.03, toon(c.primary));
  }

  const D = rig.driver;
  // cream double-breasted chef jacket
  const cream = toon(c.secondary);
  kit.add(D, G.sph(0.36), cream, { p: [0, 0.94, 0], s: [1.02, 0.92, 0.9] });
  kit.add(D, G.sph(0.37, 14, 8), cream, { p: [0, 0.78, 0.02], s: [1.04, 0.62, 0.94] });
  kit.add(D, G.tor(0.16, 0.05, 6, 14), cream, { p: [0, 1.2, 0.02], r: [Math.PI / 2, 0, 0] });
  // red neckerchief
  kit.add(D, G.cone(0.11, 0.17, 4), toon(c.primary), { p: [0, 1.12, 0.24], r: [Math.PI + 0.35, 0, 0], s: [1, 1, 0.35] });
  // two rows of little red buttons
  const btn = toon(c.primary);
  for (const sd of [-1, 1]) for (const y of [1.06, 0.98]) kit.add(D, G.sph(0.03, 8, 6), btn, { p: [sd * 0.1, y, 0.29], outline: false });
  // red-and-white checkered apron hugging the tummy
  const redM = toon(0xe8413c);
  const whiteM = toon(WHITE);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = (col - 1.5) * 0.115;
      const y = 0.9 - row * 0.105;
      const z = 0.35 - x * x * 1.6 - row * 0.012;
      kit.add(D, G.box(0.118, 0.108, 0.03), (row + col) % 2 ? redM : whiteM, {
        p: [x, y, z], r: [0.12, Math.atan2(x * 3.2, 1), 0], outline: false,
      });
    }
  }
  kit.add(D, G.box(0.5, 0.035, 0.03), whiteM, { p: [0, 0.955, 0.335], r: [0.12, 0, 0], outline: false }); // apron hem
  // arms: right hand on the wheel, left hand waves a fork with a meatball
  const skin = toon(SKIN);
  limb(kit, D, [0.31, 1.06, 0.02], [0.14, 0.93, 0.6], 0.085, cream);
  kit.add(D, G.sph(0.1, 10, 8), skin, { p: [0.14, 0.93, 0.6] });
  const forkArm = part(D, [-0.31, 1.06, 0.02]);
  limb(kit, forkArm, [0, 0, 0], [-0.36, 0.34, 0.1], 0.08, cream);
  kit.add(forkArm, G.sph(0.1, 10, 8), skin, { p: [-0.36, 0.34, 0.1] });
  const fork = toon(0xdcd6ec);
  stick(kit, forkArm, [-0.35, 0.24, 0.1], [-0.42, 0.86, 0.12], 0.022, fork);
  kit.add(forkArm, G.box(0.13, 0.03, 0.03), fork, { p: [-0.42, 0.86, 0.12], outline: false });
  for (const dx of [-0.05, 0, 0.05]) stick(kit, forkArm, [-0.42 + dx, 0.86, 0.12], [-0.42 + dx, 1.02, 0.12], 0.013, fork, { outline: false });
  kit.add(forkArm, G.sph(0.1, 12, 8), toon(0x9a5a34), { p: [-0.42, 0.7, 0.12] });
  kit.add(forkArm, G.sph(0.032, 6, 5), toon(0xe8413c), { p: [-0.39, 0.78, 0.2], outline: false }); // sauce dab
  rig.anims.push((t, dt, st) => {
    forkArm.rotation.z = -0.08 + Math.sin(t * 5) * (0.1 + 0.08 * st.speedF);
    forkArm.rotation.x = Math.sin(t * 2.5) * 0.06;
  });

  const R = 0.45;
  const H = makeHead(rig, 1.55);
  kit.add(H, G.sph(R, 18, 12), skin);
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.1, 8, 6), skin, { p: [sd * 0.44, -0.02, -0.02], s: [0.6, 1, 1] });
  const hair = toon(0x6b3f25);
  kit.add(H, G.sph(0.42), hair, { p: [0, 0.0, -0.1], outline: false });
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.14, 8, 6), hair, { p: [sd * 0.38, 0.1, -0.16], s: [0.8, 1, 1] });
  addFace(kit, rig, R, {
    eyeColor: 0x7a4a2a,
    eyeV: 0.06,
    mouth: 'grin',
    mouthV: -0.6,
    mouthW: 0.11,
    cheekV: -0.3,
    cheekU: 0.62,
    brows: { color: 0x4a2a1a, v: 0.42, w: 0.05, angle: -0.12 },
  });
  // little button nose
  kit.add(H, G.sph(0.085, 10, 8), toon(0xffb3a0), { p: [0, -0.08, 0.46] });
  // curly spaghetti mustache (wiggles when he laughs)
  const stache = part(H, [0, -0.19, 0.42]);
  const pasta = toon(0xf5c24c);
  for (const sd of [-1, 1]) {
    const pts = [[0, 0, 0.02], [0.1, -0.03, 0.0], [0.2, -0.02, -0.04], [0.27, 0.04, -0.08], [0.26, 0.12, -0.09], [0.19, 0.12, -0.07], [0.17, 0.06, -0.05], [0.22, 0.04, -0.06]]
      .map(([x, y, z]) => [x * sd, y, z]);
    kit.add(stache, G.tube(pts, 0.042, 24, 6), pasta);
  }
  kit.add(stache, G.sph(0.06, 8, 6), pasta, { p: [0, -0.01, 0.03] });
  rig.anims.push((t, dt, st) => {
    const w = Math.sin(t * 9) * (0.04 + 0.05 * st.speedF);
    stache.scale.set(1 + w, 1 - w * 0.5, 1);
    stache.rotation.z = Math.sin(t * 4.5) * 0.05;
  });
  // short, puffy white chef toque with a red band and a basil-leaf badge
  const HF = frame([0, 0.3, -0.04], [-0.2, 0, 0.05]);
  kit.add(H, G.cyl(0.37, 0.39, 0.14, 18), toon(c.primary), { f: HF, p: [0, 0.05, 0] });
  const toque = toon(WHITE);
  kit.add(H, G.cyl(0.33, 0.36, 0.22, 16), toque, { f: HF, p: [0, 0.22, 0] });
  kit.add(H, G.sph(0.47, 16, 10), toque, { f: HF, p: [0, 0.42, 0], s: [1, 0.52, 1] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    kit.add(H, G.sph(0.17, 10, 8), toque, { f: HF, p: [Math.cos(a) * 0.3, 0.45, Math.sin(a) * 0.3] });
  }
  kit.add(H, G.sph(0.2, 12, 8), toque, { f: HF, p: [0, 0.6, 0] });
  kit.add(H, G.sph(0.08, 8, 6), toon(0x4caf50), { f: HF, p: [-0.05, 0.06, 0.38], r: [0, 0, 0.7], s: [0.55, 1, 0.3] });
  kit.add(H, G.sph(0.08, 8, 6), toon(0x5cc85a), { f: HF, p: [0.06, 0.06, 0.38], r: [0, 0, -0.7], s: [0.55, 1, 0.3] });
}

export default { def, build };
