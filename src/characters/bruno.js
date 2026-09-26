/**
 * Bruno Bananas — racer module (data + look).
 * Pack: A. Built with the shared parts library (./parts.js).
 *
 * A big, gentle, lavender gorilla in a banana-split kart. He wears a waffle-cone
 * party hat and a cosy pink sprinkle scarf whose long end flutters in the wind
 * and flips up to boop his nose when he boosts.
 */
import { G, toon, glow, frame, surf, limb, stick, part, addFace, addMouth, buildKartBase, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'bruno',
  name: 'Bruno Bananas',
  tagline: 'Big hugs, bigger bananas!',
  personality:
    'A gentle giant gorilla with soft lavender fur who drives a banana-split kart, wears his cosiest sprinkle scarf and a waffle-cone party hat to every race and says "excuse me" when he zooms past.',
  colors: { primary: 0xb49ae6, secondary: 0xffd84d, accent: 0xff8fc4, kart: 0xffe27a }, // lavender fur, banana-yellow sundae boat
  camera: { height: 0.3, lookHeight: -0.1 }, // he's a big fella
  stats: { speed: 4, accel: 2, handling: 2, weight: 4 },
  voice: { pitch: 0.6, style: 'hoho' },
  locked: true,
  unlock: { type: 'stat', stat: 'racesFinished', count: 2 },
  pack: 'a',
  pronoun: 'he',
  emoji: '🍌',
  quotes: {
    select: 'Ooh-ooh! Banana time!',
    win: 'Bananas for everyone! Group hug!',
    oops: 'Oof! Slippy banana!',
  },
};

const FUR = 0xb49ae6; // soft lavender, like a grape-swirl sundae
const FUR_DARK = 0x8a6cc8;
const FACE = 0xfff0dc; // vanilla-cream face and tummy
const SCARF = 0xff8fc4;
const SCARF_STRIPE = 0xfff4fa;
const WAFFLE = 0xe6b169;
const WAFFLE_DARK = 0xc48a45;
const BANANA = 0xffc93a; // a touch deeper than the banana-yellow boat
const BANANA_TIP = 0x8a5a2b;

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  // ── banana-split kart: a banana-yellow sundae boat with bananas for side pods ──
  buildKartBase(kit, rig, {
    body: c.kart, trim: 0xffb3d1, seat: 0xe79ac6, hub: BANANA, bar: WHITE, tire: 0x5a4a7a,
    width: 1.4, rr: 0.36, shell: false, pipes: [[-0.34, 0.52, -1.06], [0.34, 0.52, -1.06]],
  });
  const C = rig.chassis;
  const dish = toon(c.kart);
  const pinkRim = toon(0xffb3d1);
  // long oval glass-dish tub
  kit.add(C, G.bowl(1, 18, 6), dish, { p: [0, 0.66, 0], s: [0.66, 0.42, 1.08] });
  kit.add(C, G.tor(1, 0.05, 6, 24), pinkRim, { p: [0, 0.66, 0], r: [Math.PI / 2, 0, 0], s: [0.66, 1.08, 1] });
  kit.add(C, G.rbox(0.9, 0.2, 1.6, 0.08), dish, { p: [0, 0.34, 0] });
  // hood: vanilla cream with chocolate drizzle
  kit.add(C, G.sph(0.4, 14, 8), toon(0xfff8ea), { p: [0, 0.66, 0.62], s: [1.2, 0.35, 0.95] });
  const choc = toon(0x6b3a22);
  kit.add(C, G.tube([[-0.32, 0.73, 0.5], [-0.1, 0.78, 0.66], [0.08, 0.74, 0.48], [0.3, 0.77, 0.66]], 0.028, 16, 5), choc, { outline: false });
  // a cherry on the nose
  kit.add(C, G.sph(0.1, 10, 8), toon(0xe8233f, { emissive: 0xa0001a, emissiveIntensity: 0.25 }), { p: [0, 0.8, 0.86] });
  kit.add(C, G.sph(0.03, 6, 5), glow(WHITE), { p: [-0.04, 0.84, 0.94], outline: false });
  kit.add(C, G.tube([[0, 0.88, 0.86], [0.02, 0.98, 0.84], [0.08, 1.04, 0.8]], 0.014, 8, 4), toon(0x5a8a2a));
  // banana side pods (peeled a little at the front)
  const banana = toon(BANANA);
  for (const sd of [-1, 1]) {
    const pts = [[sd * 0.72, 0.62, -0.95], [sd * 0.8, 0.5, -0.5], [sd * 0.82, 0.46, 0.1], [sd * 0.78, 0.5, 0.6], [sd * 0.68, 0.64, 1.0]];
    kit.add(C, G.tube(pts, 0.15, 18, 8), banana);
    kit.add(C, G.sph(0.06, 6, 5), toon(BANANA_TIP), { p: [sd * 0.68, 0.66, 1.06], outline: false });
    kit.add(C, G.cone(0.05, 0.12, 6), toon(BANANA_TIP), { p: [sd * 0.72, 0.66, -1.02], r: [-1.2, 0, 0] });
    kit.add(C, G.sph(0.03, 5, 4), toon(0xc9a02a), { p: [sd * 0.93, 0.5, 0.2], outline: false });
    kit.add(C, G.sph(0.03, 5, 4), toon(0xc9a02a), { p: [sd * 0.94, 0.47, -0.3], outline: false });
  }
  // three-scoop spoiler: strawberry, vanilla, chocolate + whipped cream + cherry
  const scoops = [[-0.46, 0xffa6c9], [0, 0xfff3d6], [0.46, 0x8a5234]];
  const SZ = -1.1;
  kit.add(C, G.rbox(1.34, 0.12, 0.32, 0.05), pinkRim, { p: [0, 1.02, SZ] });
  for (const sd of [-1, 1]) stick(kit, C, [sd * 0.4, 0.55, -0.98], [sd * 0.4, 0.98, SZ], 0.035, pinkRim);
  for (const [x, col] of scoops) {
    kit.add(C, G.sph(0.21, 12, 8), toon(col), { p: [x, 1.18, SZ], s: [1, 0.9, 1] });
    kit.add(C, G.tor(0.19, 0.045, 5, 12), toon(col), { p: [x, 1.08, SZ], r: [Math.PI / 2, 0, 0], outline: false });
  }
  // whipped-cream swirl and a cherry on the middle scoop
  const cream = toon(WHITE);
  kit.add(C, G.tor(0.11, 0.055, 6, 12), cream, { p: [0, 1.38, SZ], r: [Math.PI / 2, 0, 0] });
  kit.add(C, G.tor(0.06, 0.045, 6, 10), cream, { p: [0, 1.45, SZ], r: [Math.PI / 2, 0, 0.5], outline: false });
  kit.add(C, G.cone(0.05, 0.09, 8), cream, { p: [0, 1.52, SZ], outline: false });
  kit.add(C, G.sph(0.08, 8, 6), toon(0xe8233f), { p: [0, 1.6, SZ] });
  const spr = [0xffe45c, 0x5ec8ff, 0x7ee07a, 0xb68cff, 0xff6b9a];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    kit.add(C, G.cap(0.018, 0.04, 4), toon(spr[i % spr.length]), {
      p: [scoops[i % 3][0] + Math.cos(a) * 0.1, 1.33, SZ + Math.sin(a) * 0.1], r: [a, 0, 1], outline: false,
    });
  }

  // ── Bruno ──
  const D = rig.driver;
  D.scale.setScalar(1.12);
  D.position.z -= 0.05;
  rig.bounce = 0.7; // big and steady
  const fur = toon(FUR);
  const face = toon(FACE);
  kit.add(D, G.sph(0.4), fur, { p: [0, 0.92, 0], s: [1.1, 0.95, 0.95] });
  kit.add(D, G.sph(0.28, 12, 8), face, { p: [0, 0.9, 0.2], s: [1.05, 1, 0.55], outline: false });
  // fluffy shoulders
  for (const sd of [-1, 1]) kit.add(D, G.sph(0.2, 10, 8), fur, { p: [sd * 0.36, 1.08, 0.0] });
  // big gentle arms with pale knuckles
  for (const sd of [-1, 1]) {
    limb(kit, D, [sd * 0.4, 1.08, 0.02], [sd * 0.2, 0.9, 0.58], 0.12, fur);
    kit.add(D, G.sph(0.14, 10, 8), fur, { p: [sd * 0.19, 0.9, 0.6] });
    kit.add(D, G.sph(0.09, 8, 6), face, { p: [sd * 0.17, 0.95, 0.7], s: [1.2, 0.7, 0.6], outline: false });
  }

  // cosy sprinkle scarf: a knitted pink loop round his neck ...
  const knit = toon(SCARF);
  const stripe = toon(SCARF_STRIPE);
  const SPRINKLES = [0xffe45c, 0x5ec8ff, 0x7ee07a, 0xb68cff, 0xff6b6b];
  kit.add(D, G.tor(0.27, 0.095, 6, 14), knit, { p: [0, 1.17, 0.05], r: [Math.PI / 2 - 0.2, 0, 0] });
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + (i / 6) * 1.8 + Math.PI / 2; // across the front of the loop
    kit.add(D, G.cap(0.014, 0.035, 4), toon(SPRINKLES[i % SPRINKLES.length]), {
      p: [Math.cos(a) * 0.29, 1.2 + (i % 2) * 0.03, 0.05 + Math.sin(a) * 0.3], r: [0, 0, 0.3 + i], outline: false,
    });
  }
  // ... and one long end with stripes, sprinkles and a fluffy fringe
  const scarf = part(D, [0.24, 1.14, 0.34]);
  scarf.name = 'bruno:scarf';
  scarf.rotation.x = -0.3; // rests on his round tummy
  kit.add(scarf, G.rbox(0.2, 0.5, 0.06, 0.03), knit, { p: [0, -0.25, 0] });
  for (const y of [-0.12, -0.3]) kit.add(scarf, G.box(0.205, 0.055, 0.065), stripe, { p: [0, y, 0], outline: false });
  for (const [x, y, k] of [[-0.04, -0.2, 0], [0.04, -0.38, 1], [-0.03, -0.44, 2], [0.05, -0.05, 3]]) {
    kit.add(scarf, G.cap(0.012, 0.03, 4), toon(SPRINKLES[k]), { p: [x, y, 0.03], r: [0, 0, 0.6 + k], outline: false });
  }
  for (let i = 0; i < 5; i++) kit.add(scarf, G.cyl(0.02, 0.012, 0.09, 5), stripe, { p: [-0.08 + i * 0.04, -0.54, 0], outline: false });

  // ── head ──
  const H = part(D, [0, 1.52, 0]);
  rig.head = H;
  const R = 0.46;
  kit.add(H, G.sph(R, 18, 12), fur);
  // a little waffle-cone party hat: whipped-cream brim, criss-cross waffle lines, cherry pom-pom
  const tuft = part(H, [0.07, 0.4, 0.02]);
  tuft.name = 'bruno:hat';
  tuft.rotation.z = -0.18; // worn at a jaunty angle
  kit.add(tuft, G.cone(0.15, 0.36, 10), toon(WAFFLE), { p: [0, 0.16, 0] });
  for (const y of [0.06, 0.16, 0.26]) {
    const r = 0.15 * (1 - (y + 0.02) / 0.36) + 0.006;
    kit.add(tuft, G.tor(r, 0.01, 3, 10), toon(WAFFLE_DARK), { p: [0, y, 0], r: [Math.PI / 2, 0, 0], outline: false });
  }
  kit.add(tuft, G.tor(0.15, 0.045, 5, 12), toon(WHITE), { p: [0, -0.01, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(tuft, G.sph(0.06, 8, 6), toon(0xe8233f), { p: [0, 0.36, 0] });
  // round ears
  for (const sd of [-1, 1]) {
    kit.add(H, G.sph(0.13, 10, 8), fur, { p: [sd * 0.45, 0.02, -0.02], s: [0.6, 1, 1] });
    kit.add(H, G.sph(0.08, 8, 6), face, { p: [sd * 0.5, 0.02, 0.0], s: [0.4, 1, 1], outline: false });
  }
  // peachy face mask (the face lives on this sphere)
  const FC = [0, -0.04, 0.1];
  const FR = 0.38;
  kit.add(H, G.sph(FR, 16, 10), face, { p: FC, s: [1.05, 1, 1] });
  // chunky brow ridge (lifts in surprise)
  const brow = part(H, [0, 0.14, 0.4]);
  brow.name = 'bruno:brow';
  for (const sd of [-1, 1]) kit.add(brow, G.cap(0.05, 0.13, 6), toon(FUR_DARK), { p: [sd * 0.12, 0, 0], r: [0, sd * 0.35, Math.PI / 2 + sd * 0.18], s: [1, 1, 0.8] });
  addFace(kit, rig, FR, {
    c: FC, eyeColor: 0x4a2f7a, eyeU: 0.32, eyeV: 0.02, eyeW: 0.21, eyeH: 0.28,
    cheek: 0xff9ad0, cheekU: 0.6, cheekV: -0.28, mouth: 'none',
  });
  // big soft muzzle with a smile
  kit.add(H, G.sph(0.22, 14, 8), toon(0xfff7ec), { p: [0, -0.24, 0.34], s: [1.3, 0.8, 0.85] });
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.03, 6, 5), toon(0x6a4a9a), { p: [sd * 0.06, -0.15, 0.51], s: [1.2, 0.8, 0.6], outline: false });
  addMouth(kit, H, frame([0, -0.27, 0.52], [0.2, 0, 0]), 0.11, 'grin');

  rig.anims.push((t, dt, st, s) => {
    // the scarf end flutters with speed and flips up to boop his nose on boosts
    const flap = Math.sin(t * 17) * (0.05 + 0.25 * st.speedF) + Math.sin(t * 29) * 0.06 * st.speedF;
    const up = st.boosting ? -2.35 : -0.3 - 0.55 * st.speedF;
    scarf.rotation.x += (up + flap - scarf.rotation.x) * Math.min(1, dt * 12 + 0.02);
    scarf.rotation.z = Math.sin(t * 13) * 0.12 * st.speedF - st.steer * 0.2;
    // surprised brows while boosting / twirling, happy bob of the tuft
    const lift = st.boosting || st.spinning ? 0.07 : 0;
    brow.position.y += (0.14 + lift - brow.position.y) * Math.min(1, dt * 10 + 0.02);
    tuft.rotation.z = -0.18 + Math.sin(t * 6) * 0.1 + st.steer * 0.15; // the party hat wobbles
    // big gentle breathing
    const b = Math.sin(t * 1.8);
    D.scale.set(1.12 + b * 0.012, 1.12 - b * 0.008, 1.12);
  });
}

export default { def, build };
