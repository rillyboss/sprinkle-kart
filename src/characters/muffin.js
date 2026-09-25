/**
 * Muffin Button — racer module (data + look).
 * Pack: original. Built with the shared parts library (./parts.js).
 */
import { G, toon, glow, frame, limb, stick, part, rng, addFace, buildKartBase, addArms, makeHead, SKIN, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'muffin',
  name: 'Muffin Button',
  tagline: 'Tiny cupcake, GIANT zoomies!',
  personality:
    'An excitable little cupcake kid with a cherry on top who squeaks "yay!" at absolutely everything.',
  colors: { primary: 0x8fd3ff, secondary: 0xff9ecf, accent: 0xe8233f, kart: 0x8fd3ff },
  stats: { speed: 2, accel: 5, handling: 4, weight: 1 },
  voice: { pitch: 1.9, style: 'yay' },
  locked: false,
  unlock: null,
  pack: 'original',
  pronoun: 'they',
  emoji: '🧁',
  quotes: {
    select: 'Yay yay YAY! Pick me!',
    win: 'YAAAY! Best day EVER!',
    oops: 'Eep! Sprinkles everywhere!',
  },
};

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  // pink steering wheel with a heart hub (reads as a cute heart, not a frowny face, at card size)
  buildKartBase(kit, rig, { body: c.kart, trim: WHITE, seat: c.secondary, wheels: 'donut', icing: c.secondary, steer: 0xff7ab8, steerHeart: 0xff4f9a });
  const C = rig.chassis;
  const r = rng(7);
  const cols = [0xffe45c, 0xff6b9a, 0x7ee07a, 0xffffff, 0xb68cff, 0xffa64d];
  for (let i = 0; i < 14; i++) {
    kit.add(C, G.cap(0.022, 0.06, 4), toon(cols[i % cols.length]), {
      p: [(r() - 0.5) * 0.8, 0.745 + r() * 0.02, 0.28 + r() * 0.45],
      r: [-0.2, r() * TAU, Math.PI / 2],
      outline: false,
    });
  }
  // birthday candle spoiler
  kit.add(C, G.cyl(0.08, 0.08, 0.5, 10), toon(WHITE), { p: [0, 1.15, -0.95] });
  for (const y of [1.0, 1.15, 1.3]) kit.add(C, G.cyl(0.085, 0.085, 0.04, 10), toon(c.secondary), { p: [0, y, -0.95], outline: false });
  const flame = part(C, [0, 1.5, -0.95]);
  kit.add(flame, G.sph(0.07, 8, 6), glow(0xffd23f), { s: [1, 1.6, 1], outline: false });
  kit.add(flame, G.sph(0.04, 6, 5), glow(0xfff6c9), { p: [0, -0.02, 0.02], s: [1, 1.4, 1], outline: false });
  stick(kit, C, [0, 0.55, -0.95], [0, 0.9, -0.95], 0.04, toon(WHITE));
  rig.anims.push((t) => {
    flame.scale.set(1 + Math.sin(t * 13) * 0.1, 1 + Math.sin(t * 17) * 0.15, 1);
  });

  const D = rig.driver;
  rig.driver.scale.setScalar(0.92);
  rig.bounce = 2.2; // she's SO excited
  // cupcake wrapper body
  kit.add(D, G.cyl(0.37, 0.27, 0.44, 18), toon(c.primary), { p: [0, 0.82, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const p0 = [Math.cos(a) * 0.28, 0.61, Math.sin(a) * 0.28];
    const p1 = [Math.cos(a) * 0.375, 1.03, Math.sin(a) * 0.375];
    limb(kit, D, p0, p1, 0.022, toon(WHITE), { outline: false, rs: 4 });
  }
  kit.add(D, G.sph(0.37, 16, 8), toon(0xc8864a), { p: [0, 1.06, 0], s: [1.02, 0.35, 1.02] });
  addArms(kit, rig, SKIN, SKIN, { shoulder: [0.3, 1.02, 0.04], r: 0.065, handR: 0.09 });

  const R = 0.44;
  const H = makeHead(rig, 1.46);
  kit.add(H, G.sph(R, 18, 12), toon(0xffe4cc));
  addFace(kit, rig, R, { eyeColor: 0x7a4a2a, eyeH: 0.31, eyeW: 0.22, eyeV: -0.06, mouth: 'grin', mouthV: -0.42, mouthW: 0.12, cheekV: -0.3 });
  // swirly frosting hat with sprinkles
  const icing = toon(c.secondary);
  const FF = frame([0, 0.24, -0.02], [-0.1, 0, 0]);
  kit.add(H, G.tor(0.33, 0.14, 8, 20), icing, { f: FF, p: [0, 0.02, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(H, G.tor(0.21, 0.12, 8, 18), icing, { f: FF, p: [0, 0.18, 0], r: [Math.PI / 2, 0, 0.6] });
  kit.add(H, G.sph(0.16, 12, 8), icing, { f: FF, p: [0, 0.3, 0] });
  kit.add(H, G.cone(0.09, 0.18, 10), icing, { f: FF, p: [0, 0.44, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.3;
    const top = i % 2 === 0;
    const rad = top ? 0.33 : 0.21;
    const y = top ? 0.13 : 0.28;
    kit.add(H, G.cap(0.02, 0.055, 4), toon(cols[i % cols.length]), {
      f: FF,
      p: [Math.cos(a) * rad, y, Math.sin(a) * rad],
      r: [r() * 3, a, r() * 3],
      outline: false,
    });
  }
  // wobbly cherry on top
  const cherry = part(H, [0, 0.78, -0.02]);
  kit.add(cherry, G.sph(0.12, 12, 10), toon(c.accent, { emissive: 0xa0001a, emissiveIntensity: 0.25 }));
  kit.add(cherry, G.sph(0.035, 6, 5), glow(WHITE), { p: [-0.05, 0.05, 0.09], outline: false });
  kit.add(cherry, G.tube([[0, 0.09, 0], [0.02, 0.2, 0], [0.09, 0.28, 0]], 0.016, 8, 5), toon(0x5a8a2a));
  rig.anims.push((t, dt, st) => {
    cherry.rotation.z = Math.sin(t * 6.5) * (0.12 + 0.18 * st.speedF);
    cherry.rotation.x = Math.cos(t * 5.1) * 0.08;
  });
}

export default { def, build };
