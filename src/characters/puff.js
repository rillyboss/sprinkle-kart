/**
 * Puff the Sprinkle Dragon — racer module (data + look).
 * Pack: B. Built with the shared parts library (./parts.js).
 *
 * A teeny lime dragon with pink bat-wings, a butter-yellow tummy and soft
 * pink spikes, driving a strawberry-frosted donut kart. Wiggles: every few
 * seconds (and every time she boosts) she winds up "ah... ahh..." with her
 * head tipping back and eyes squeezing, then AH-CHOO! a burst of rainbow
 * sprinkles puffs out of her nose. Her wings flap faster with speed and her
 * tail wags.
 */
import { THREE, G, toon, glow, frame, surf, limb, part, rng, extrude, addFace, addMouth, buildKartBase, addArms, makeHead, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'puff',
  name: 'Puff the Sprinkle Dragon',
  tagline: 'Ah... ahh... AH-CHOO! Sprinkles!',
  personality:
    'A teeny dragon who tried to breathe fire once and sneezed rainbow sprinkles instead. Now she thinks it is her superpower (it is).',
  colors: { primary: 0xb4ec7c, secondary: 0xff8fc8, accent: 0xfff0a8, kart: 0xff9ecf },
  stats: { speed: 3, accel: 3, handling: 5, weight: 1 },
  voice: { pitch: 1.7, style: 'yay' },
  locked: true,
  unlock: { type: 'stat', stat: 'miniTurbos', count: 25 },
  pack: 'b',
  pronoun: 'she',
  emoji: '🐉',
  quotes: {
    select: 'Sprinkle power... ah... ACTIVATE!',
    win: 'Sprinkles for everyone! AH-CHOO!',
    oops: 'Oopsie... bless me!',
  },
};

const SPRINKLES = [0xffe45c, 0x5ec8ff, 0x7ee07a, 0xffffff, 0xb68cff, 0xff6b9a];
const SNEEZE_EVERY = 5.2; // seconds between idle sneezes
const WINDUP = 0.9;
const BURST = 0.85;

/** A little scalloped bat-wing outline (root at the origin, tip up and out to +X). */
function wingShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.06, 0.26, 0.2, 0.34);
  s.quadraticCurveTo(0.32, 0.4, 0.44, 0.44); // wing tip
  s.quadraticCurveTo(0.4, 0.3, 0.42, 0.16);
  s.quadraticCurveTo(0.34, 0.2, 0.28, 0.08);
  s.quadraticCurveTo(0.2, 0.12, 0.14, -0.02);
  s.quadraticCurveTo(0.08, 0.04, 0, 0);
  return s;
}

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  const rand = rng(0x5eed);
  buildKartBase(kit, rig, { body: c.kart, trim: 0xfff4e6, seat: 0xb68cff, hub: WHITE, wheels: 'donut', icing: 0xff9ecf, steerHeart: 0xffe45c, steer: 0xfff4e6 });
  const C = rig.chassis;
  // frosting drips down the sides + rainbow sprinkles all over the hood
  const frosting = toon(0xfff4e6);
  for (const sd of [-1, 1]) {
    for (const [z, len] of [[0.7, 0.1], [0.35, 0.16], [-0.15, 0.08], [-0.55, 0.14]]) {
      kit.add(C, G.cap(0.05, len, 6), frosting, { p: [sd * 0.66, 0.46 - len / 2, z], outline: false });
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = (rand() - 0.5) * 0.9;
    const z = -0.95 + rand() * 1.95;
    const onHood = z > 0.1 && Math.abs(x) < 0.38;
    const y = onHood ? 0.74 - (z - 0.1) * 0.2 + 0.01 : 0.56;
    if (!onHood && z > -0.62 && z < 0.1 && Math.abs(x) < 0.45) continue; // not under the seat
    kit.add(C, G.cap(0.018, 0.05, 4), toon(SPRINKLES[i % SPRINKLES.length]), { p: [x, y, z], r: [Math.PI / 2, rand() * TAU, 0], outline: false });
  }
  // a big frosted donut standing up as a spoiler
  kit.add(C, G.tor(0.2, 0.09, 8, 16), toon(0xe7a867), { p: [0, 1.02, -1.02] });
  kit.add(C, G.tor(0.2, 0.075, 8, 16), toon(c.kart), { p: [0, 1.02, -1.055], s: [1, 1, 0.8], outline: false });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    kit.add(C, G.cap(0.018, 0.05, 4), toon(SPRINKLES[i % 6]), { p: [Math.cos(a) * 0.2, 1.02 + Math.sin(a) * 0.2, -1.12], r: [0, 0, a + 0.7], outline: false });
  }
  limb(kit, C, [0, 0.55, -0.98], [0, 0.8, -1.02], 0.05, toon(0xfff4e6));

  // ── body ──
  const D = rig.driver;
  const scales = toon(c.primary);
  const belly = toon(c.accent);
  const pink = toon(c.secondary);
  kit.add(D, G.sph(0.34), scales, { p: [0, 0.93, 0], s: [1, 1, 0.92] });
  kit.add(D, G.sph(0.26, 12, 8), belly, { p: [0, 0.88, 0.19], s: [1, 1.08, 0.5], outline: false });
  for (const y of [0.8, 0.92, 1.04]) kit.add(D, G.tor(0.18 - Math.abs(y - 0.92) * 0.5, 0.012, 4, 14, Math.PI), toon(0xe8c86a), { p: [0, y, 0.29], r: [0, 0, Math.PI], s: [1, 0.35, 1], outline: false });
  addArms(kit, rig, c.primary, c.primary, { r: 0.075, handR: 0.09 });
  // spikes down her back
  for (const [y, z, s] of [[1.12, -0.26, 1], [0.96, -0.33, 0.9], [0.8, -0.32, 0.8]]) {
    kit.add(D, G.cone(0.07 * s, 0.14 * s, 8), pink, { p: [0, y, z], r: [-1.9, 0, 0] });
  }
  // pink bat-wings (they flap)
  const wings = [];
  const wingGeo = () => {
    const g = extrude(wingShape(), 0.03, 0.012);
    g.translate(0.22, 0.2, 0); // extrude() centres it: put the root back at the origin
    return g;
  };
  for (const sd of [-1, 1]) {
    const w = part(D, [sd * 0.14, 1.1, -0.24]);
    // mirrored by a half-turn (not a negative scale) so both wings keep their faces outward
    kit.add(w, wingGeo(), pink, { s: 1.15, r: [0, sd > 0 ? 0.5 : Math.PI - 0.5, 0] });
    limb(kit, w, [0, 0, 0], [sd * 0.46, 0.46, -0.24], 0.03, scales);
    wings.push([w, sd]);
  }
  // curly tail with a heart tip, wagging over the side
  const tail = part(D, [-0.2, 0.74, -0.26]);
  limb(kit, tail, [0, 0, 0], [-0.3, -0.02, -0.25], 0.1, scales);
  limb(kit, tail, [-0.3, -0.02, -0.25], [-0.46, 0.2, -0.36], 0.07, scales);
  kit.add(tail, G.heart(0.2, 0.06), pink, { p: [-0.48, 0.34, -0.38], r: [0, -0.6, 0] });

  // ── head ──
  const R = 0.44;
  const H = makeHead(rig, 1.56);
  kit.add(H, G.sph(R, 18, 12), scales);
  // round snout with two nostrils (where the sprinkles come from!)
  kit.add(H, G.sph(0.24), scales, { p: [0, -0.15, 0.32], s: [1.15, 0.82, 1.05] });
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.034, 6, 5), toon(0x4a7a2a), { p: [sd * 0.085, -0.09, 0.56], s: [1.2, 0.9, 0.6], outline: false });
  addFace(kit, rig, R, { eyeColor: 0xd24f9a, eyeU: 0.31, eyeV: 0.14, eyeH: 0.3, eyeW: 0.21, lashes: true, mouth: 'none', cheekU: 0.63, cheekV: -0.1, cheek: 0xff9ec9 });
  addMouth(kit, H, frame([0, -0.26, 0.535], [0.45, 0, 0]), 0.11, 'smile');
  // little cream horns + pink ear-frills + a crest of soft pink head spikes
  for (const sd of [-1, 1]) {
    kit.add(H, G.cone(0.07, 0.24, 10), toon(0xfff4e6), { p: [sd * 0.2, 0.43, -0.04], r: [-0.35, 0, -sd * 0.35] });
    kit.add(H, G.cone(0.1, 0.26, 4), pink, { f: surf(R, sd * 0.92, 0.12, 0.95), p: [sd * 0.02, 0, -0.1], r: [-1.2, 0, 0], s: [0.35, 1, 1] });
  }
  for (const [y, z, s] of [[0.42, -0.16, 1.2], [0.28, -0.35, 1.1], [0.05, -0.44, 0.95]]) {
    kit.add(H, G.cone(0.12 * s, 0.26 * s, 8), pink, { p: [0, y, z], r: [-0.7 - (0.42 - y) * 3.2, 0, 0], s: [0.7, 1, 1] });
  }
  // a tiny white freckle dot pattern on the cheeks
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.02, 5, 4), glow(WHITE), { f: surf(R, sd * 0.5, -0.02, 1.0), outline: false });

  // the SNEEZE: a sprinkle burst + a little white puff, in front of her nose
  const burst = part(D, [0, 1.44, 0.55]);
  for (let i = 0; i < 16; i++) {
    const a = rand() * TAU;
    const rr = 0.05 + rand() * 0.22;
    kit.add(burst, G.cap(0.022, 0.06, 4), toon(SPRINKLES[i % 6]), {
      p: [Math.cos(a) * rr, Math.sin(a) * rr * 0.8, rand() * 0.3],
      r: [rand() * TAU, rand() * TAU, 0],
      outline: false,
    });
  }
  const cloud = part(D, [0, 1.44, 0.52]);
  for (const [x, y, r] of [[0, 0, 0.1], [0.09, 0.04, 0.07], [-0.08, 0.05, 0.07]]) kit.add(cloud, G.ico(r, 1), toon(WHITE), { p: [x, y, 0] });

  let sneezeT = 2.2; // time since the last sneeze started (starts mid-cycle, burst hidden)
  let wasBoosting = false;
  let tilt = 0;
  rig.anims.push((t, dt, st) => {
    // wings + tail
    const flap = Math.sin(t * (6 + st.speedF * 10 + (st.boosting ? 8 : 0)));
    for (const [w, sd] of wings) {
      w.rotation.z = sd * flap * 0.35;
      w.rotation.y = sd * (0.2 + flap * 0.15);
    }
    tail.rotation.y = Math.sin(t * 3.4) * 0.3;

    // sneeze timeline: windup (ah... ahh...) -> CHOO -> sprinkles fly
    if (st.boosting && !wasBoosting && sneezeT > WINDUP + 0.3) sneezeT = WINDUP - 0.12; // boost = instant sneeze
    wasBoosting = st.boosting;
    sneezeT += dt;
    if (sneezeT > SNEEZE_EVERY) sneezeT = 0;
    let target = 0;
    let squint = false;
    if (sneezeT < WINDUP) {
      const k = sneezeT / WINDUP;
      target = -0.32 * k * k; // head tips back
      squint = k > 0.45;
    } else if (sneezeT < WINDUP + 0.18) {
      target = 0.28; // CHOO!
      squint = true;
    }
    tilt += (target - tilt) * Math.min(1, dt * (sneezeT < WINDUP ? 8 : 30));
    if (rig.head) rig.head.rotation.x += tilt;
    if (squint && rig.eyes && rig.eyes.visible) rig.eyes.scale.y = 0.2;

    const bk = (sneezeT - WINDUP) / BURST;
    if (bk >= 0 && bk < 1) {
      const e = 1 - (1 - bk) * (1 - bk);
      burst.position.set(0, 1.44 - bk * bk * 0.35, 0.55 + e * 1.1);
      burst.scale.setScalar(0.3 + e * 1.3);
      burst.rotation.z = bk * 2;
      cloud.position.set(0, 1.46 + e * 0.1, 0.55 + e * 0.35);
      cloud.scale.setScalar(bk < 0.6 ? 0.5 + bk * 1.6 : Math.max(0.001, (1 - bk) * 3.5));
    } else {
      burst.scale.setScalar(0.001);
      cloud.scale.setScalar(0.001);
    }
  });
}

export default { def, build };
