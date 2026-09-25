/**
 * Prince Ribbit — racer module (data + look).
 * Pack: B. Built with the shared parts library (./parts.js).
 *
 * A very polite frog prince with big eye-bumps, a golden bow tie, a velvet
 * cape with a fluffy spotted collar and a crown that is three sizes too big.
 * He drives a royal purple kart with a lily pad + water lily on the hood and
 * a heart pennant fluttering at the back. Wiggles: the crown wobbles all the
 * time, and every so often (or when he spins) it slips down over his eyes,
 * then he wiggles it back up; his throat puffs like a proper frog; the
 * pennant flutters faster with speed.
 */
import { THREE, G, toon, glow, frame, surf, stick, part, extrude, addMouth, buildKartBase, addArms, makeHead, WHITE, TAU } from './parts.js';
import { chibiEyes } from './bleep.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'prince-ribbit',
  name: 'Prince Ribbit',
  tagline: 'Pardon me, coming through! Ribbit!',
  personality:
    'A very, very polite frog prince who says "pardon me" every time he zooms past. His crown was a gift from Grandpa Ribbit and is three sizes too big.',
  colors: { primary: 0x6fd46a, secondary: 0x9a6cff, accent: 0xffd23f, kart: 0x9a6cff },
  stats: { speed: 4, accel: 3, handling: 2, weight: 3 },
  voice: { pitch: 0.85, style: 'hoho' },
  locked: true,
  unlock: { type: 'track', trackId: 'mermaid-lagoon', result: 'win' },
  pack: 'b',
  pronoun: 'he',
  emoji: '🐸',
  quotes: {
    select: 'Delighted to race with you! Ribbit!',
    win: 'Oh my! Thank you all ever so much!',
    oops: 'Terribly sorry! My crown slipped!',
  },
  camera: { height: 0.25, lookHeight: -0.1 }, // the too-big crown
};

const GOLD = 0xffd23f;
const VELVET = 0xe8416a;

function pennantShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.14);
  s.lineTo(0.42, 0.1);
  s.lineTo(0.3, 0.0);
  s.lineTo(0.42, -0.1);
  s.lineTo(0, -0.14);
  s.closePath();
  return s;
}

function lilyPadShape(r) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.absarc(0, 0, r, 0.35, TAU - 0.35, false);
  s.closePath();
  return s;
}

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: GOLD, seat: VELVET, hub: GOLD, bar: WHITE, steer: GOLD, hubStar: WHITE });
  const C = rig.chassis;
  const gold = toon(GOLD, { emissive: GOLD, emissiveIntensity: 0.2 });
  // lily pad + pink water lily on the hood
  kit.add(C, extrude(lilyPadShape(0.24), 0.02, 0.01), toon(0x5cc85a), { p: [0, 0.76, 0.5], r: [-Math.PI / 2 - 0.2, 0, Math.PI / 2 + 0.4] });
  const lily = frame([0.02, 0.8, 0.48], [-0.2, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    kit.add(C, G.sph(0.07, 8, 6), toon(i % 2 ? 0xffb3d6 : 0xff8fc8), { f: lily, p: [Math.cos(a) * 0.07, 0.04, Math.sin(a) * 0.07], r: [0, -a, 0.9], s: [1, 0.45, 0.55] });
  }
  kit.add(C, G.sph(0.04, 8, 6), toon(GOLD), { f: lily, p: [0, 0.06, 0] });
  // gold crown-points along the back bumper
  for (const x of [-0.3, 0, 0.3]) kit.add(C, G.cone(0.06, 0.14, 6), gold, { p: [x, 0.52, -1.08] });
  // royal pennant with a heart, fluttering on a gold pole
  stick(kit, C, [-0.52, 0.45, -0.95], [-0.52, 1.72, -0.95], 0.02, gold);
  kit.add(C, G.sph(0.045, 8, 6), gold, { p: [-0.52, 1.75, -0.95] });
  const flag = part(C, [-0.52, 1.6, -0.95]);
  kit.add(flag, extrude(pennantShape(), 0.02, 0.008), toon(VELVET), { p: [0, 0, -0.21], r: [0, Math.PI / 2, 0] });
  kit.add(flag, G.heart(0.1, 0.02), toon(GOLD), { p: [0.022, 0, -0.13], r: [0, Math.PI / 2, 0], outline: false });

  // ── body ──
  const D = rig.driver;
  const skin = toon(c.primary);
  const belly = toon(0xe8f7b0);
  kit.add(D, G.sph(0.34), skin, { p: [0, 0.92, 0], s: [1.05, 0.98, 0.92] });
  kit.add(D, G.sph(0.25, 12, 8), belly, { p: [0, 0.88, 0.2], s: [1.05, 1, 0.5], outline: false });
  // velvet cape with a fluffy spotted collar
  kit.add(D, G.sph(0.38, 14, 10), toon(VELVET), { p: [0, 0.96, -0.2], s: [1.05, 1.1, 0.42] });
  kit.add(D, G.tor(0.23, 0.07, 8, 18), toon(WHITE), { p: [0, 1.18, -0.02], r: [Math.PI / 2 - 0.15, 0, 0] });
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.15 + (i / 6) * Math.PI * 0.7;
    kit.add(D, G.sph(0.018, 5, 4), toon(0x2b2233), { p: [Math.cos(a) * 0.24, 1.2 + Math.sin(a) * 0.0, Math.sin(a) * 0.24 - 0.02 - 0.06], outline: false });
  }
  // polite little gold bow tie
  for (const sd of [-1, 1]) kit.add(D, G.cone(0.06, 0.12, 6), gold, { p: [sd * 0.065, 1.13, 0.27], r: [0, 0, sd * Math.PI / 2] });
  kit.add(D, G.sph(0.035, 8, 6), toon(VELVET), { p: [0, 1.13, 0.29] });
  addArms(kit, rig, c.primary, c.primary, { r: 0.075, handR: 0.095 });

  // ── head ──
  const R = 0.44;
  const H = makeHead(rig, 1.54);
  kit.add(H, G.sph(R, 18, 12), skin, { s: [1.08, 0.94, 1] });
  // eye bumps on top (the frog silhouette) with big chibi eyes on them
  const domeR = 0.19;
  const domes = [[-0.22, 0.31, 0.12], [0.22, 0.31, 0.12]];
  for (const d of domes) kit.add(H, G.sph(domeR, 14, 10), skin, { p: d });
  chibiEyes(kit, rig, domes.map((d) => ({ p: [d[0], d[1] + 0.02, d[2] + domeR * 0.8], r: [-0.1, d[0] * 0.8, 0] })), { eyeColor: 0x7a4a1a, R: 0.46 });
  // throat pouch that puffs, cheeks, nostrils + a wide froggy smile
  const throat = part(H, [0, -0.3, 0.22]);
  kit.add(throat, G.sph(0.18, 12, 8), belly, { s: [1.2, 0.7, 0.8] });
  for (const sd of [-1, 1]) {
    kit.add(H, G.sph(1, 10, 6), toon(0xff8fb0), { f: surf(R, sd * 0.6, -0.18, 0.99), s: [0.07, 0.04, 0.02], outline: false });
    kit.add(H, G.sph(0.018, 5, 4), toon(0x2f7a3a), { p: [sd * 0.06, -0.02, 0.44], outline: false });
  }
  addMouth(kit, H, surf(R, 0, -0.3, 0.99), 0.16, 'smile');
  addMouth(kit, H, surf(R, 0, -0.33, 0.99), 0.045, 'grin');

  // the too-big crown (wobbles and slips!)
  const crown = part(H, [0, 0.5, -0.02]);
  const crownIn = part(crown, [0, 0, 0]);
  crown.name = 'ribbit-crown';
  crownIn.name = 'ribbit-crown-slip';
  kit.add(crownIn, G.cyl(0.4, 0.36, 0.2, 16), gold, { p: [0, 0.08, 0] });
  kit.add(crownIn, G.tor(0.37, 0.035, 6, 20), gold, { p: [0, -0.02, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(crownIn, G.bowl(0.34, 14, 5), toon(VELVET), { p: [0, 0.18, 0], r: [Math.PI, 0, 0], s: [1, 0.5, 1] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    kit.add(crownIn, G.cone(0.075, 0.18, 6), gold, { p: [Math.sin(a) * 0.37, 0.26, Math.cos(a) * 0.37] });
    kit.add(crownIn, G.sph(0.03, 6, 5), glow(0xfff6c9), { p: [Math.sin(a) * 0.37, 0.36, Math.cos(a) * 0.37], outline: false });
  }
  for (const [a, col] of [[0, 0x5ec8ff], [Math.PI / 3, VELVET], [-Math.PI / 3, VELVET], [Math.PI, 0x7ee07a]]) {
    kit.add(crownIn, G.sph(0.05, 8, 6), glow(col), { p: [Math.sin(a) * 0.39, 0.08, Math.cos(a) * 0.39], s: [1, 1, 0.5], r: [0, a, 0] });
  }
  kit.add(crownIn, G.sph(0.06, 10, 8), gold, { p: [0, 0.3, 0] });
  kit.add(crownIn, G.star(0.07, 0.03), gold, { p: [0, 0.42, 0] });

  const SLIP_EVERY = 7;
  let slipT = 3;
  let slip = 0;
  rig.anims.push((t, dt, st) => {
    // constant wobble (it really is too big)
    const wob = 0.07 + st.speedF * 0.05;
    crown.rotation.z = Math.sin(t * 4.1) * wob - st.steer * 0.18;
    crown.rotation.x = Math.sin(t * 3.3 + 1) * wob * 0.7;
    // slip down over the eyes, hang there a moment, then wiggle back up
    slipT += dt;
    if (slipT > SLIP_EVERY) slipT = 0;
    let target = 0;
    if (st.spinning) target = 1;
    else if (slipT < 1.6) target = slipT < 0.25 ? slipT / 0.25 : slipT < 1.1 ? 1 : 0;
    slip += (target - slip) * Math.min(1, dt * (target > slip ? 14 : 5));
    const back = target === 0 && slip > 0.05 ? Math.sin(t * 30) * 0.12 * slip : 0; // wiggle it back up
    crownIn.position.set(back * 0.3, -slip * 0.2, slip * 0.12);
    crownIn.rotation.x = slip * 0.35;
    crownIn.rotation.z = back;
    // froggy throat puff + polite little nod
    const puff = Math.max(0, Math.sin(t * 2.6));
    throat.scale.set(1 + puff * 0.25, 1 + puff * 0.35, 1 + puff * 0.2);
    // pennant flutter
    flag.rotation.y = Math.sin(t * (5 + st.speedF * 9)) * 0.3 + 0.2 + st.speedF * 0.4;
  });
}

export default { def, build };
