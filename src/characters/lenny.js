/**
 * Lenny Linguine — racer module (data + look).
 * Pack: original. Built with the shared parts library (./parts.js).
 */
import { G, toon, glow, frame, surf, limb, part, addFace, buildKartBase, addArms, makeHead, SKIN, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'lenny',
  name: 'Lenny Linguine',
  tagline: "I'm not scared... okay, maybe a LITTLE scared!",
  personality:
    "Rocco's tall, noodly little brother with a cosy noodle scarf — his knees wobble like spaghetti, but he's braver than he thinks.",
  colors: { primary: 0x2ec4b6, secondary: 0xa8e86a, accent: 0xffe066, kart: 0x2ec4b6 },
  camera: { height: 0.6, lookHeight: -0.1 }, // extra-tall noodle neck + hat
  stats: { speed: 4, accel: 3, handling: 3, weight: 2 },
  voice: { pitch: 1.05, style: 'boing' },
  locked: false,
  unlock: null,
  pack: 'original',
  emoji: '🍜',
  quotes: {
    select: 'M-m-me? Okay! I can do this!',
    win: 'I did it?! I DID IT! Wheee!',
    oops: 'Wibbly wobbly!',
  },
};

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: c.secondary, seat: 0x1f8f86, hub: c.accent });
  const C = rig.chassis;
  // wobbly noodle antenna with a meatball on top
  const ant = part(C, [-0.45, 0.62, -0.95]);
  kit.add(ant, G.tube([[0, 0, 0], [0.08, 0.35, 0], [-0.08, 0.7, 0], [0.08, 1.05, 0], [-0.04, 1.4, 0], [0.02, 1.62, 0]], 0.04, 24, 6), toon(c.accent));
  kit.add(ant, G.sph(0.1, 10, 8), toon(0x9a5a34), { p: [0.02, 1.7, 0] });
  // noodle swirl stickers
  for (const sd of [-1, 1]) kit.add(C, G.tor(0.08, 0.025, 5, 14), toon(c.accent), { p: [sd * 0.74, 0.46, 0.04], r: [0, Math.PI / 2, 0], outline: false });

  const D = rig.driver;
  const teal = toon(c.primary);
  const lime = toon(c.secondary);
  kit.add(D, G.cap(0.22, 0.34, 10), teal, { p: [0, 1.0, 0], s: [1, 1, 0.85] });
  kit.add(D, G.sph(0.27, 12, 8), lime, { p: [0, 0.78, 0.02], s: [1, 0.7, 0.92] });
  // mint-and-cream striped apron
  const mint = toon(0x9ff0d8);
  const cream = toon(0xfff3dc);
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.066;
    kit.add(D, G.box(0.068, 0.34, 0.03), i % 2 ? cream : mint, {
      p: [x, 0.95, 0.2 - x * x * 2.2], r: [-0.06, Math.atan2(x * 4.4, 1), 0], outline: false,
    });
  }
  kit.add(D, G.box(0.36, 0.03, 0.035), cream, { p: [0, 1.12, 0.19], outline: false });
  addArms(kit, rig, c.primary, SKIN, { shoulder: [0.24, 1.2, 0.0], r: 0.065, handR: 0.095 });
  // noodly neck
  kit.add(D, G.cyl(0.08, 0.09, 0.42, 10), toon(SKIN), { p: [0, 1.46, 0] });
  // cosy noodle scarf with dangly ends
  const noodle = toon(c.accent);
  kit.add(D, G.tor(0.12, 0.055, 6, 16), noodle, { p: [0, 1.32, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(D, G.tor(0.11, 0.045, 6, 16), noodle, { p: [0, 1.4, 0], r: [Math.PI / 2 + 0.15, 0, 0], outline: false });
  const tails = part(D, [0.07, 1.3, 0.1]);
  kit.add(tails, G.tube([[0, 0, 0], [0.04, -0.08, 0.04], [0.0, -0.16, 0.07], [0.05, -0.25, 0.09]], 0.032, 12, 5), noodle);
  kit.add(tails, G.tube([[0.03, 0, 0], [0.1, -0.07, 0.03], [0.08, -0.15, 0.05], [0.13, -0.22, 0.06]], 0.028, 12, 5), noodle, { outline: false });
  rig.anims.push((t, dt, st) => { tails.rotation.x = -0.2 * st.speedF + Math.sin(t * 11) * 0.12 * (0.3 + st.speedF); });
  // wobbly knees poking up beside the steering wheel
  const knees = part(D, [0, 0, 0]);
  for (const sd of [-1, 1]) {
    const hip = [sd * 0.15, 0.68, 0.1];
    const knee = [sd * 0.3, 0.94, 0.46];
    const foot = [sd * 0.27, 0.62, 0.8];
    limb(kit, knees, hip, knee, 0.07, lime);
    limb(kit, knees, knee, foot, 0.065, lime);
    kit.add(knees, G.sph(0.095, 10, 8), lime, { p: knee });
  }
  rig.anims.push((t, dt, st) => {
    const j = 0.025 + 0.02 * (1 - st.speedF);
    knees.position.y = Math.abs(Math.sin(t * 17)) * j;
    knees.rotation.z = Math.sin(t * 23) * j * 0.8;
  });

  const R = 0.42;
  const H = makeHead(rig, 1.9);
  rig.headLag = 1.6; // noodly neck sways more
  kit.add(H, G.sph(R, 18, 12), toon(SKIN));
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.09, 8, 6), toon(SKIN), { p: [sd * 0.41, -0.02, -0.02], s: [0.6, 1, 1] });
  const hair = toon(0xc9793a);
  kit.add(H, G.sph(0.39), hair, { p: [0, 0.0, -0.1], outline: false });
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.12, 8, 6), hair, { p: [sd * 0.33, 0.12, 0.12], s: [0.7, 1, 0.8] });
  addFace(kit, rig, R, {
    eyeColor: 0x2e9c8f,
    eyeV: 0.04,
    eyeH: 0.3,
    mouth: 'tiny',
    mouthV: -0.45,
    mouthW: 0.1,
    brows: { color: 0x8a4a22, v: 0.43, angle: 0.4, w: 0.035 },
  });
  // small nose + freckles
  kit.add(H, G.sph(0.07, 10, 8), toon(0xffbf9c), { p: [0, -0.16, 0.42] });
  const freckle = toon(0xd48a5a);
  for (const sd of [-1, 1]) {
    for (const [u, v] of [[0.44, -0.2], [0.52, -0.14], [0.5, -0.26]]) {
      kit.add(H, G.sph(0.018, 5, 4), freckle, { f: surf(R, u * sd, v, 0.99), outline: false });
    }
  }
  // nervous sweat drop
  const drop = part(H, [0.4, 0.22, 0.12]);
  const water = glow(0x9fe0ff);
  kit.add(drop, G.sph(0.055, 8, 6), water, { outline: false });
  kit.add(drop, G.cone(0.05, 0.09, 8), water, { p: [0, 0.06, 0], outline: false });
  rig.anims.push((t) => {
    const k = (t * 0.8) % 1;
    drop.position.y = 0.22 - k * 0.12;
    drop.scale.setScalar(k < 0.85 ? 1 : (1 - k) / 0.15);
  });
  // puffy cream chef hat with a teal band and a curly spaghetti cowlick
  const HF = frame([0, 0.28, -0.03], [-0.15, 0, -0.06]);
  kit.add(H, G.cyl(0.33, 0.35, 0.14, 18), teal, { f: HF, p: [0, 0.05, 0] });
  const toque = toon(0xfffaf0);
  kit.add(H, G.cyl(0.29, 0.32, 0.3, 16), toque, { f: HF, p: [0, 0.26, 0] });
  kit.add(H, G.sph(0.41, 16, 10), toque, { f: HF, p: [0, 0.5, 0], s: [1, 0.55, 1] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    kit.add(H, G.sph(0.16, 10, 8), toque, { f: HF, p: [Math.cos(a) * 0.26, 0.53, Math.sin(a) * 0.26] });
  }
  kit.add(H, G.sph(0.18, 12, 8), toque, { f: HF, p: [0, 0.66, 0] });
  const curl = part(H, [0, 0, 0]);
  kit.add(curl, G.tube([[0, 0.78, 0], [0.06, 0.9, 0.02], [0.0, 1.0, 0.06], [-0.07, 0.94, 0.04], [-0.03, 0.87, 0.02]], 0.03, 16, 5), noodle, { f: HF });
  rig.anims.push((t) => { curl.rotation.z = Math.sin(t * 7) * 0.04; });
}

export default { def, build };
