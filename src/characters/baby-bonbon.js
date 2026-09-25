/**
 * Baby Bonbon — racer module (data + look).
 * Pack: A. Built with the shared parts library (./parts.js).
 *
 * A giggly baby in a wrapped-candy onesie (hood twists stick out like a
 * bonbon wrapper!) riding a pram-shaped stroller kart. Bounces when she
 * giggles, sucks her pacifier, throws her arms up on boosts: "Wheee!"
 */
import { THREE, G, toon, glow, frame, surf, limb, stick, part, addFace, buildKartBase, SKIN, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'baby-bonbon',
  name: 'Baby Bonbon',
  tagline: 'Goo-goo, ga-ZOOM!',
  personality:
    'A giggly baby wrapped up like a sweet bonbon who races in a turbo stroller, never lets go of her pacifier and laughs at absolutely everything.',
  colors: { primary: 0xff7fb4, secondary: 0xb68cff, accent: 0xfff27a, kart: 0xbfe9ff },
  stats: { speed: 3, accel: 5, handling: 3, weight: 1 },
  voice: { pitch: 2.0, style: 'giggle' },
  locked: true,
  unlock: { type: 'stat', stat: 'kidAssistFinishes', count: 1 },
  pack: 'a',
  pronoun: 'she',
  emoji: '🍬',
  quotes: {
    select: 'Goo-goo! Ga-ga! VROOM!',
    win: 'Hee hee hee! Again! Again!',
    oops: 'Uh-oh! Hee hee!',
  },
};

const PINK = 0xff7fb4;
const LILAC = 0xb68cff;
const CREAM = 0xfff6ea;

/** Wrapper twist + fan (a bonbon end) pointing along local +X of frame F. */
function wrapperEnd(kit, target, F, col, stripe) {
  kit.add(target, G.cone(0.1, 0.2, 8), toon(col), { f: F, p: [0.06, 0, 0], r: [0, 0, Math.PI / 2] });
  // crinkly fan: a pleated (low-segment) cone with a stripe of the other colour
  kit.add(target, G.cone(0.21, 0.26, 7), toon(col), { f: F, p: [0.27, 0, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.6] });
  kit.add(target, G.cone(0.14, 0.18, 7), toon(stripe), { f: F, p: [0.33, 0, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.62], outline: false });
}

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  // ── turbo stroller: a baby-blue pram tub, a folded hood and a push handle ──
  buildKartBase(kit, rig, {
    body: c.kart, trim: WHITE, seat: 0xffd6ec, hub: PINK, bar: WHITE, tire: 0x8a7ab8, steer: 0xffe45c, steerHeart: 0xff7ab8,
    shell: false, fr: 0.26, rr: 0.38, pipes: [[-0.3, 0.55, -1.02], [0.3, 0.55, -1.02]],
  });
  const C = rig.chassis;
  const tub = toon(c.kart);
  kit.add(C, G.rbox(1.0, 0.24, 1.7, 0.1), tub, { p: [0, 0.36, 0] });
  kit.add(C, G.bowl(1, 18, 6), tub, { p: [0, 0.78, 0.0], s: [0.62, 0.42, 0.98] });
  kit.add(C, G.tor(1, 0.055, 6, 24), toon(WHITE), { p: [0, 0.78, 0], r: [Math.PI / 2, 0, 0], s: [0.62, 0.98, 1] });
  // polka dots on the tub
  const dot = toon(WHITE);
  for (const sd of [-1, 1]) {
    for (const [y, z] of [[0.6, 0.45], [0.52, -0.05], [0.62, -0.5], [0.45, 0.2]]) {
      const x = sd * Math.sqrt(Math.max(0.01, 1 - (z / 0.98) ** 2 - ((0.78 - y) / 0.42) ** 2)) * 0.62;
      kit.add(C, G.sph(0.05, 8, 6), dot, { p: [x, y, z], s: [0.35, 1, 1], outline: false });
    }
  }
  // folded-back pram hood: a low quarter-dome behind her (the chase cam still sees her)
  const hoodGeo = new THREE.SphereGeometry(0.56, 16, 6, Math.PI, Math.PI, 0, Math.PI / 2);
  kit.add(C, hoodGeo, toon(LILAC, { side: THREE.DoubleSide }), { p: [0, 0.8, -0.5], s: [1, 0.85, 0.95], outline: false });
  for (const a of [0.45, 0.95]) {
    kit.add(C, G.tor(0.565, 0.025, 4, 18, Math.PI), toon(WHITE), { f: frame([0, 0.8, -0.5], [-a, 0, 0]), s: [1, 0.85, 1], outline: false });
  }
  kit.add(C, G.tor(0.56, 0.04, 5, 20, Math.PI), toon(WHITE), { p: [0, 0.8, -0.5], s: [1, 0.85, 1] });
  // push handle arching up at the back + a hanging rattle
  const bar = toon(WHITE);
  for (const sd of [-1, 1]) stick(kit, C, [sd * 0.42, 0.7, -0.9], [sd * 0.42, 1.22, -1.22], 0.035, bar);
  kit.add(C, G.cap(0.06, 0.8, 8), toon(PINK), { p: [0, 1.24, -1.24], r: [0, 0, Math.PI / 2] });
  const rattle = part(C, [0.0, 1.2, -1.24]);
  stick(kit, rattle, [0, 0, 0], [0, -0.14, 0], 0.012, toon(LILAC), { outline: false });
  kit.add(rattle, G.sph(0.07, 10, 8), toon(0xffe45c), { p: [0, -0.2, 0] });
  kit.add(rattle, G.star(0.05, 0.02), glow(WHITE), { p: [0, -0.2, -0.07], outline: false });
  // baby-bottle exhausts
  for (const sd of [-1, 1]) {
    kit.add(C, G.cyl(0.06, 0.06, 0.12, 8), toon(0xffe45c), { p: [sd * 0.3, 0.55, -1.2], r: [Math.PI / 2, 0, 0], outline: false });
    kit.add(C, G.cone(0.05, 0.1, 8), toon(0xffc8a0), { p: [sd * 0.3, 0.55, -1.3], r: [-Math.PI / 2, 0, 0], outline: false });
  }

  // ── Baby Bonbon ──
  const D = rig.driver;
  D.scale.setScalar(0.9);
  rig.bounce = 2.6; // giggle bounce!
  const onesie = toon(PINK);
  const skin = toon(0xffe2cc);
  kit.add(D, G.sph(0.32), onesie, { p: [0, 0.9, 0], s: [1.05, 0.95, 0.95] });
  // candy stripes spiralling round the onesie
  for (let i = 0; i < 3; i++) kit.add(D, G.tor(0.3 - i * 0.02, 0.028, 4, 16), toon(CREAM), { p: [0, 0.8 + i * 0.12, 0], r: [Math.PI / 2 + 0.3, 0, 0], outline: false });
  // round tummy button (a candy button)
  kit.add(D, G.sph(0.05, 8, 6), toon(0xffe45c), { p: [0, 0.92, 0.3], s: [1, 1, 0.5], outline: false });
  // chubby little arms: up for "wheee!" on boosts
  const arms = [];
  for (const sd of [-1, 1]) {
    const arm = part(D, [sd * 0.28, 1.04, 0.04]);
    arm.name = 'baby-bonbon:arm';
    limb(kit, arm, [0, 0, 0], [-sd * 0.12, -0.1, 0.54], 0.08, onesie);
    kit.add(arm, G.sph(0.095, 10, 8), skin, { p: [-sd * 0.12, -0.1, 0.56] });
    arms.push([arm, sd]);
  }
  // chubby legs + booties poking forward
  for (const sd of [-1, 1]) {
    limb(kit, D, [sd * 0.14, 0.72, 0.16], [sd * 0.2, 0.74, 0.5], 0.085, onesie);
    kit.add(D, G.sph(0.1, 8, 6), toon(WHITE), { p: [sd * 0.2, 0.76, 0.58], s: [1, 0.9, 1.2] });
  }

  // ── big baby head in a bonbon hood ──
  const R = 0.48;
  const H = part(D, [0, 1.5, 0]);
  rig.head = H;
  kit.add(H, G.sph(R, 18, 12), skin);
  // hood: a pink shell around the back and sides of her head
  kit.add(H, G.sph(0.54, 18, 12), onesie, { p: [0, 0.04, -0.12], s: [1, 1, 0.9] });
  kit.add(H, G.tor(0.43, 0.06, 6, 22), toon(CREAM), { p: [0, 0.03, 0.26], s: [1, 1.02, 1] });
  // the bonbon twists sticking out of each side (her silhouette!)
  const twists = [];
  for (const sd of [-1, 1]) {
    const tw = part(H, [sd * 0.5, 0.06, -0.1]);
    tw.rotation.set(0, sd < 0 ? Math.PI : 0, 0.12);
    tw.scale.setScalar(1.15);
    wrapperEnd(kit, tw, frame(), PINK, LILAC);
    twists.push([tw, sd]);
  }
  // one little curl of hair
  const curl = frame([0, 0.5, 0.18]);
  kit.add(H, G.tor(0.06, 0.022, 5, 12, Math.PI * 1.5), toon(0xc9793a), { f: curl, p: [0, 0.05, 0], r: [0, 0, 0.5] });
  kit.add(H, G.sph(0.03, 5, 4), toon(0xc9793a), { f: curl, p: [0.06, 0.02, 0], outline: false });
  addFace(kit, rig, R, {
    eyeColor: 0x6a4ab8, eyeU: 0.34, eyeV: -0.02, eyeW: 0.22, eyeH: 0.3,
    cheek: 0xff8fb8, cheekU: 0.58, cheekV: -0.3, mouth: 'none',
  });
  // pacifier: a lilac shield + a pink ring handle
  const paci = part(H, [0, -0.28, 0.44]);
  paci.name = 'baby-bonbon:pacifier';
  kit.add(paci, G.sph(0.12, 12, 8), toon(LILAC), { s: [1.2, 0.85, 0.3] });
  kit.add(paci, G.tor(0.07, 0.022, 5, 12), toon(0xff5fa8), { p: [0, -0.02, 0.05] });
  kit.add(paci, G.sph(0.035, 6, 5), toon(0xffe45c), { p: [0, 0, 0.04], outline: false });

  let whee = 0;
  rig.anims.push((t, dt, st) => {
    // arms up on boosts, happy flappy arms when she wins
    const want = st.boosting ? 1 : 0;
    whee += (want - whee) * Math.min(1, dt * 9 + 0.01);
    const flap = st.happy ? Math.sin(t * 14) * 0.4 : 0;
    for (const [arm, sd] of arms) {
      arm.rotation.x = -whee * 2.1 + flap;
      arm.rotation.z = sd * whee * 0.5;
    }
    // giggle bounce + wiggly head shake when she's twirling or tickled
    const giggle = st.spinning || st.happy ? 1 : 0.25;
    H.position.y = 1.5 + Math.abs(Math.sin(t * 9)) * 0.04 * giggle;
    H.rotation.z += Math.sin(t * 18) * 0.05 * giggle;
    // suck-suck-suck on the pacifier
    const suck = Math.sin(t * 7) * 0.08;
    paci.scale.set(1 + suck, 1 + suck, 1);
    paci.position.z = 0.44 + suck * 0.08;
    for (const [tw, sd] of twists) tw.rotation.x = Math.sin(t * 8 + sd) * (0.08 + 0.12 * st.speedF);
    rattle.rotation.x = Math.sin(t * 6) * 0.3 * (0.3 + st.speedF) + 0.3 * st.speedF;
  });
}

export default { def, build };
