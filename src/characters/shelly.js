/**
 * Shelly Macaroon — racer module (data + look).
 * Pack: A. Built with the shared parts library (./parts.js).
 *
 * A super-speedy turtle with a pastel macaron for a shell. She tucks her head
 * in to go EXTRA aerodynamic on boosts and hides in her shell when bonked.
 */
import { G, toon, frame, surf, limb, part, addFace, buildKartBase, WHITE } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'shelly',
  name: 'Shelly Macaroon',
  tagline: 'Slow and steady? Nope! Zoom and ready!',
  personality:
    'A zippy little turtle who carries a strawberry macaron shell on her back and loves proving that turtles can be the fastest friends on the track.',
  colors: { primary: 0x8fe3a6, secondary: 0xffa8cc, accent: 0xfff1c9, kart: 0xb9f0ff },
  stats: { speed: 5, accel: 2, handling: 3, weight: 2 },
  voice: { pitch: 1.35, style: 'yay' },
  locked: true,
  unlock: { type: 'track', trackId: 'gumdrop-meadow', result: 'win' },
  pack: 'a',
  pronoun: 'she',
  emoji: '🐢',
  quotes: {
    select: 'Turtle power, full speed ahead!',
    win: 'Who said turtles are slow? Hee hee!',
    oops: 'Eep! Shell-ter time!',
  },
};

const SKIN = 0x8fe3a6;
const SKIN_LIGHT = 0xc9f5c9;
const MAC_PINK = 0xffa8cc;
const MAC_FOOT = 0xff8fbd;
const FILLING = 0xfff1c9;

/** A macaron (two domed cookies + ruffly feet + cream filling) along local +Z. */
function macaron(kit, target, F, r, top, foot, fill) {
  const topM = toon(top);
  const footM = toon(foot);
  const big = r > 0.2; // little charms and stickers get fewer segments
  const [w, h, ts] = big ? [16, 10, 20] : [10, 6, 12];
  kit.add(target, G.sph(r, w, h), topM, { f: F, p: [0, 0, r * 0.34], s: [1, 1, 0.42] });
  kit.add(target, G.sph(r, w, h), topM, { f: F, p: [0, 0, -r * 0.34], s: [1, 1, 0.42], outline: big });
  for (const sd of [-1, 1]) kit.add(target, G.tor(r * 0.93, r * 0.09, 4, ts), footM, { f: F, p: [0, 0, sd * r * 0.2], outline: false });
  kit.add(target, G.cyl(r * 0.9, r * 0.9, r * 0.28, ts), toon(fill), { f: F, r: [Math.PI / 2, 0, 0], outline: false });
}

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  // ── macaron-shop kart: sky-blue body, pink trim, macaron wheels ──
  buildKartBase(kit, rig, {
    body: c.kart, trim: 0xffc8de, seat: 0xc9a6ff, hub: FILLING, bar: 0xffa8cc, tire: MAC_PINK, steer: 0xffa8cc,
  });
  const C = rig.chassis;
  // go-faster speed stripes on the hood
  for (const sd of [-1, 1]) kit.add(C, G.box(0.1, 0.02, 0.8), toon(WHITE), { p: [sd * 0.16, 0.745, 0.46], r: [-0.2, 0, 0], outline: false });
  // mini macaron stickers on the side pods
  const cols = [[0xffa8cc, 0xfff1c9], [0xc9a6ff, 0xfff1c9]];
  for (const sd of [-1, 1]) {
    const [a, b] = cols[sd < 0 ? 0 : 1];
    macaron(kit, C, frame([sd * 0.79, 0.46, 0.04], [0, sd * Math.PI / 2, 0]), 0.12, a, a, b);
  }
  // low lavender wing (kept low so her macaron shell is the star from behind)
  kit.add(C, G.rbox(1.1, 0.07, 0.3, 0.03), toon(0xc9a6ff), { p: [0, 0.74, -1.06], r: [0.12, 0, 0] });
  for (const sd of [-1, 1]) kit.add(C, G.rbox(0.06, 0.24, 0.3, 0.03), toon(0xc9a6ff), { p: [sd * 0.52, 0.64, -1.04] });
  // little stubby turtle feet on the pedals
  const skin = toon(SKIN);
  for (const sd of [-1, 1]) kit.add(C, G.sph(0.1, 8, 6), skin, { p: [sd * 0.18, 0.72, 0.62], s: [1, 0.7, 1.3] });

  // ── Shelly ──
  const D = rig.driver;
  D.scale.setScalar(0.95);
  const belly = toon(0xfff3b0);
  kit.add(D, G.sph(0.32), skin, { p: [0, 0.92, 0], s: [1, 1, 0.9] });
  // creamy plastron with little segment lines
  kit.add(D, G.sph(0.27, 12, 8), belly, { p: [0, 0.9, 0.12], s: [0.95, 1.05, 0.6], outline: false });
  for (const y of [0.82, 0.96]) kit.add(D, G.tor(0.15, 0.012, 4, 12, Math.PI), toon(0xe8cf80), { p: [0, y, 0.285], r: [0, 0, Math.PI], s: [1, 0.3, 1], outline: false });
  // pink racing scarf
  const scarf = toon(0xff6fa8);
  kit.add(D, G.tor(0.15, 0.05, 6, 14), scarf, { p: [0, 1.2, 0.02], r: [Math.PI / 2, 0, 0] });
  const tails = part(D, [0.1, 1.2, -0.12]);
  kit.add(tails, G.cap(0.04, 0.24, 5), scarf, { p: [0.02, -0.02, -0.16], r: [1.3, 0, 0.2] });
  kit.add(tails, G.cap(0.035, 0.2, 5), scarf, { p: [0.08, -0.06, -0.14], r: [1.1, 0, -0.4], outline: false });
  addArmsTurtle(kit, rig, skin);

  // the macaron shell on her back (the chase cam sees a big round macaron)
  const shell = part(D, [0, 1.06, -0.36]);
  shell.name = 'shelly:shell';
  macaron(kit, shell, frame([0, 0, 0], [0.12, 0, 0]), 0.52, MAC_PINK, MAC_FOOT, FILLING);
  // a sugar-pearl heart pressed on the back
  kit.add(shell, G.heart(0.2, 0.05), toon(WHITE), { p: [0, 0.05, -0.41], r: [0.12, Math.PI, 0], outline: false });
  // little tail peeking out
  kit.add(D, G.cone(0.07, 0.16, 8), skin, { p: [0, 0.66, -0.48], r: [-1.9, 0, 0] });

  // ── head on a stretchy neck ──
  const neck = part(D, [0, 1.2, 0.02]);
  neck.name = 'shelly:neck';
  kit.add(neck, G.cyl(0.11, 0.13, 0.3, 10), skin, { p: [0, 0.08, 0] });
  const H = part(neck, [0, 0.34, 0.02]);
  rig.head = H;
  rig.headLag = 1.5; // bendy neck
  const R = 0.43;
  kit.add(H, G.sph(R, 18, 12), skin);
  // soft lighter snout
  kit.add(H, G.sph(0.24, 12, 8), toon(SKIN_LIGHT), { p: [0, -0.16, 0.26], s: [1.25, 0.8, 0.75], outline: false });
  // freckle spots on the top of her head
  for (const [u, v, s] of [[0.1, 0.8, 0.07], [-0.3, 0.7, 0.055], [0.38, 0.6, 0.05]]) {
    kit.add(H, G.sph(s, 8, 6), toon(0x6fcf8c), { f: surf(R, u, v, 0.985), s: [1, 1, 0.3], outline: false });
  }
  addFace(kit, rig, R, {
    eyeColor: 0x2f8a6a, eyeV: 0.02, eyeW: 0.21, eyeH: 0.29, lashes: true,
    cheek: 0xff8fb8, cheekV: -0.25, mouth: 'grin', mouthV: -0.4, mouthW: 0.1,
  });
  // sporty headband with a macaron charm
  const band = toon(0xffffff);
  kit.add(H, G.tor(0.42, 0.045, 6, 22), band, { p: [0, 0.18, -0.02], r: [Math.PI / 2 - 0.3, 0, 0] });
  kit.add(H, G.tor(0.425, 0.02, 4, 22), toon(0xff6fa8), { p: [0, 0.18, -0.02], r: [Math.PI / 2 - 0.3, 0, 0], outline: false });
  macaron(kit, H, frame([0.26, 0.42, 0.18], [-0.6, 0.5, 0.3]), 0.1, 0xc9a6ff, 0xb68cff, FILLING);

  const neckRest = neck.position.clone();
  let tuck = 0;
  rig.anims.push((t, dt, st, s) => {
    // curious slow neck stretch when idle; tuck in on boosts; hide when twirling
    const target = st.spinning ? 1 : st.boosting ? 0.55 : 0;
    tuck += (target - tuck) * Math.min(1, dt * 9 + 0.01);
    const stretch = (1 - st.speedF) * (0.5 + 0.5 * Math.sin(t * 0.9)) * 0.06;
    neck.position.set(neckRest.x, neckRest.y - tuck * 0.36 + stretch, neckRest.z - tuck * 0.16);
    const hs = 1 - tuck * 0.12;
    H.scale.setScalar(hs);
    neck.rotation.x = -0.06 * st.speedF + tuck * 0.2; // lean into the wind
    tails.rotation.x = -0.3 * st.speedF + Math.sin(t * 12) * 0.15 * (0.3 + st.speedF);
    shell.rotation.z = Math.sin(t * 3) * 0.02 - st.steer * 0.04;
  });
}

/** Short turtle arms to the wheel, with round little hands. */
function addArmsTurtle(kit, rig, mat) {
  for (const sd of [-1, 1]) {
    limb(kit, rig.driver, [sd * 0.28, 1.04, 0.04], [sd * 0.14, 0.93, 0.6], 0.08, mat);
    kit.add(rig.driver, G.sph(0.1, 10, 8), mat, { p: [sd * 0.14, 0.93, 0.6] });
  }
}

export default { def, build };
