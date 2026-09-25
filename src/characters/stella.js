/**
 * Stella Starbloom — racer module (data + look).
 * Pack: original. Built with the shared parts library (./parts.js).
 */
import { G, toon, glow, stick, part, addFace, buildKartBase, addArms, makeHead, EYE_DARK } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'stella',
  name: 'Stella Starbloom',
  tagline: 'Wishing on every star... especially the finish line.',
  personality:
    'A calm, dreamy space princess who hums lullabies to the planets, with her tiny star buddy Twinkle always close by.',
  colors: { primary: 0x2fc4c0, secondary: 0xeae6ff, accent: 0xffe45c, kart: 0x2fc4c0 },
  stats: { speed: 4, accel: 2, handling: 3, weight: 3 },
  voice: { pitch: 1.15, style: 'hum' },
  locked: false,
  unlock: null,
  pack: 'original',
  pronoun: 'she',
  emoji: '⭐',
  quotes: {
    select: 'Twinkle and I are ready to shine.',
    win: 'The stars are twinkling just for you!',
    oops: 'Oh my stars!',
  },
};

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: 0xf4f2ff, seat: 0xb9a8ff, hub: 0x3a2f6a, hubStar: c.accent, bar: c.accent });
  const C = rig.chassis;
  const gold = toon(c.accent, { emissive: c.accent, emissiveIntensity: 0.4 });
  for (const sd of [-1, 1]) {
    kit.add(C, G.star(0.13, 0.05), glow(c.accent), { p: [sd * 0.77, 0.46, 0.02], r: [0, Math.PI / 2, 0], outline: false });
    // little rocket fins
    kit.add(C, G.rbox(0.06, 0.4, 0.34, 0.03), toon(0xf4f2ff), { p: [sd * 0.4, 0.72, -0.98], r: [0.5, 0, sd * 0.35] });
  }
  kit.add(C, G.star(0.16, 0.06), gold, { p: [0, 0.8, 0.8], r: [-0.3, 0, 0] });
  // crescent moon spoiler
  kit.add(C, G.tor(0.28, 0.075, 8, 18, Math.PI * 1.25), gold, { p: [0, 1.0, -1.04], r: [0, 0, -Math.PI * 0.125] });
  stick(kit, C, [0, 0.55, -0.97], [0, 0.72, -1.04], 0.035, toon(0xf4f2ff));

  const D = rig.driver;
  const gown = toon(c.primary);
  kit.add(D, G.sph(0.31), gown, { p: [0, 0.96, 0], s: [1, 1, 0.85] });
  kit.add(D, G.cyl(0.28, 0.48, 0.34, 16), gown, { p: [0, 0.74, 0.02] });
  kit.add(D, G.tor(0.2, 0.04, 6, 16), toon(0xf4f2ff), { p: [0, 1.2, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(D, G.star(0.08, 0.03), glow(c.accent), { p: [0, 1.0, 0.27], outline: false });
  addArms(kit, rig, c.primary, 0xffe9e0, { r: 0.075, handR: 0.09 });

  const R = 0.44;
  const H = makeHead(rig, 1.58);
  const skin = toon(0xffe9e0);
  kit.add(H, G.sph(R, 18, 12), skin);
  const hair = toon(0xe8e2ff);
  kit.add(H, G.sph(0.49), hair, { p: [0, 0.03, -0.1], s: [1.04, 1.06, 0.95] });
  kit.add(H, G.cap(0.3, 0.45, 10), hair, { p: [0, -0.45, -0.24], s: [1.25, 1, 0.6] });
  for (const sd of [-1, 1]) {
    kit.add(H, G.sph(0.24, 12, 8), hair, { p: [sd * 0.2, 0.3, 0.26], s: [1.0, 0.55, 0.55], r: [0, 0, sd * 0.35] });
    kit.add(H, G.cap(0.12, 0.35, 8), hair, { p: [sd * 0.4, -0.25, 0.08], r: [0, 0, sd * 0.12] });
  }
  addFace(kit, rig, R, { eyeColor: 0x1f9eab, eyeV: -0.02, lashes: true, mouth: 'smile', mouthW: 0.11 });
  // tiara with a star
  kit.add(H, G.tor(0.3, 0.03, 5, 18, Math.PI), toon(0xdcd6ec), { p: [0, 0.3, 0.06], r: [-0.5, 0, 0] });
  kit.add(H, G.star(0.1, 0.04), glow(c.accent), { p: [0, 0.6, 0.12], r: [-0.3, 0, 0], outline: false });
  for (const sd of [-1, 1]) kit.add(H, G.star(0.05, 0.02), glow(c.accent), { p: [sd * 0.44, -0.16, 0.03], outline: false });

  // glowing star wand, held up in her left hand
  const wand = part(D, [0.14, 0.93, 0.6]);
  stick(kit, wand, [0, 0, 0], [0.34, 0.52, -0.06], 0.022, toon(0xf4f2ff));
  const wandStar = part(wand, [0.38, 0.6, -0.07]);
  kit.add(wandStar, G.star(0.13, 0.05), glow(c.accent), { outline: false });
  kit.add(wandStar, G.star(0.17, 0.02), glow(0xfff6c9, { transparent: true, opacity: 0.45 }), { outline: false });

  // Twinkle, the tiny floating star buddy
  const twinkle = part(D, [0.7, 1.9, 0]);
  kit.add(twinkle, G.star(0.15, 0.08), toon(c.accent, { emissive: 0xffc400, emissiveIntensity: 0.45 }));
  for (const sd of [-1, 1]) {
    kit.add(twinkle, G.sph(0.022, 6, 5), toon(EYE_DARK), { p: [sd * 0.04, 0.01, 0.06], s: [1, 1.4, 0.6], outline: false });
    kit.add(twinkle, G.sph(0.025, 6, 5), toon(0xff8fb0), { p: [sd * 0.075, -0.035, 0.055], s: [1, 0.6, 0.4], outline: false });
  }
  rig.anims.push((t, dt, st) => {
    const a = t * 1.3;
    twinkle.position.set(Math.cos(a) * 0.72, 1.95 + Math.sin(t * 2.6) * 0.1, Math.sin(a) * 0.5 - 0.05);
    twinkle.rotation.z = Math.sin(t * 3) * 0.3;
    wandStar.rotation.y = t * 2.5;
    wandStar.scale.setScalar(1 + Math.sin(t * 6) * 0.1);
    wand.rotation.z = Math.sin(t * 2) * 0.08;
  });
}

export default { def, build };
