/**
 * Luna Lollicorn — racer module (data + look).
 * Pack: B. Built with the shared parts library (./parts.js).
 *
 * A snow-white unicorn with a swirly strawberry-lollipop horn, a rainbow mane
 * that ripples and shimmers, and a lollipop kart with two giant swirl pops
 * for a spoiler. Wiggles: mane waves (faster with speed), a sparkle glint
 * sweeps along the mane, a proud head toss now and then, the horn twinkles
 * brighter on boosts, and her rainbow tail swishes.
 */
import { G, toon, glow, frame, surf, stick, limb, part, addFace, addMouth, buildKartBase, addArms, makeHead, WHITE, TAU, RAINBOW } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'luna',
  name: 'Luna Lollicorn',
  tagline: 'Taste the rainbow... then pass it!',
  personality:
    'A sparkly, dreamy unicorn who insists her horn is a lollipop she is saving for later, and that rainbows count as a vegetable.',
  colors: { primary: 0xfffbff, secondary: 0xc9a6ff, accent: 0xff6fae, kart: 0xffc4e6 },
  stats: { speed: 3, accel: 3, handling: 4, weight: 2 },
  voice: { pitch: 1.45, style: 'giggle' },
  locked: true,
  unlock: { type: 'track', trackId: 'cotton-candy-castle', result: 'win' },
  pack: 'b',
  pronoun: 'she',
  emoji: '🦄',
  quotes: {
    select: 'Sparkle up, buttercup!',
    win: 'Rainbows for everyone! Lick responsibly!',
    oops: 'Oh no, my mane!',
  },
  camera: { height: 0.3, lookHeight: -0.1 }, // tall swirly horn: keep the road ahead in view
};

const PINK = 0xff6fae;
const LILAC = 0xc9a6ff;

/** A flat round lollipop: a disc with a two-tone spiral on the face that points along +Z of frame F. */
function swirlPop(kit, target, F, r, base, stripe, both = false) {
  kit.add(target, G.cyl(r, r, 0.07, 18), toon(base), { f: F, r: [Math.PI / 2, 0, 0] });
  const turns = 2.6;
  const n = 26;
  for (const face of both ? [1, -1] : [1]) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * turns * TAU;
      const rad = 0.08 * r + (i / n) * r * 0.8;
      pts.push([Math.cos(a) * rad * face, Math.sin(a) * rad, face * 0.038]);
    }
    kit.add(target, G.tube(pts, r * 0.085, 40, 4), toon(stripe), { f: F, outline: false });
  }
}

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: WHITE, seat: LILAC, hub: 0xffe45c, hubStar: WHITE, bar: WHITE, steerHeart: PINK, steer: WHITE });
  const C = rig.chassis;

  // rainbow racing stripe over the hood + nose
  const stripeCols = [PINK, 0xffe45c, 0x5ec8ff];
  stripeCols.forEach((col, i) => {
    const x = (i - 1) * 0.1;
    kit.add(C, G.box(0.08, 0.02, 0.8), toon(col), { p: [x, 0.735, 0.5], r: [-0.2, 0, 0], outline: false });
    kit.add(C, G.box(0.08, 0.02, 0.45), toon(col), { p: [x, 0.56, 0.78], r: [-0.2, 0, 0], outline: false });
  });
  // swirl pops on the side pods
  for (const sd of [-1, 1]) swirlPop(kit, C, frame([sd * 0.82, 0.46, 0.02], [0, sd * Math.PI / 2, 0]), 0.15, WHITE, PINK);
  // two giant swirl lollipops for a spoiler (the chase camera sees their swirls)
  for (const sd of [-1, 1]) {
    stick(kit, C, [sd * 0.34, 0.52, -0.98], [sd * 0.42, 1.18, -1.06], 0.03, toon(WHITE));
    swirlPop(kit, C, frame([sd * 0.43, 1.28, -1.07], [0, Math.PI, 0]), 0.22, sd < 0 ? WHITE : 0xfff1a8, sd < 0 ? PINK : 0x8fd3ff, true);
  }
  // tiny heart gem on the nose
  kit.add(C, G.heart(0.16, 0.05), toon(PINK, { emissive: PINK, emissiveIntensity: 0.3 }), { p: [0, 0.52, 1.1], r: [-0.3, 0, 0] });

  // ── body ──
  const D = rig.driver;
  const coat = toon(c.primary);
  const hoof = toon(LILAC);
  kit.add(D, G.sph(0.33), coat, { p: [0, 0.93, 0], s: [1, 1, 0.9] });
  kit.add(D, G.sph(0.22, 12, 8), toon(0xffeef8), { p: [0, 0.9, 0.18], s: [1, 1.05, 0.5], outline: false });
  // pink ribbon collar with a bow
  kit.add(D, G.tor(0.2, 0.04, 6, 16), toon(PINK), { p: [0, 1.2, 0.02], r: [Math.PI / 2 - 0.1, 0, 0] });
  for (const sd of [-1, 1]) kit.add(D, G.sph(0.07, 10, 8), toon(PINK), { p: [sd * 0.07, 1.17, 0.22], s: [1.2, 0.8, 0.5] });
  kit.add(D, G.sph(0.035, 8, 6), toon(0xffe45c), { p: [0, 1.17, 0.25] });
  addArms(kit, rig, c.primary, LILAC, { r: 0.08, handR: 0.095 });

  // rainbow tail swishing over the side of the seat
  const tail = part(D, [0.18, 0.78, -0.28]);
  const tailPts = [[0, 0, 0], [0.28, 0.02, -0.22], [0.46, 0.2, -0.36], [0.5, 0.44, -0.4]];
  for (let i = 0; i < 3; i++) limb(kit, tail, tailPts[i], tailPts[i + 1], 0.1 - i * 0.012, toon([PINK, 0xffe45c, 0x8fd3ff][i]));
  kit.add(tail, G.sph(0.09, 10, 8), toon(LILAC), { p: tailPts[3] });

  // ── head ──
  const R = 0.43;
  const H = makeHead(rig, 1.56);
  kit.add(H, G.sph(R, 18, 12), coat);
  // soft pink muzzle + nostrils
  kit.add(H, G.sph(0.24), toon(0xffe6f3), { p: [0, -0.16, 0.26], s: [1.05, 0.78, 0.9] });
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.028, 6, 5), toon(0xd65c95), { p: [sd * 0.075, -0.1, 0.475], s: [1.2, 0.8, 0.5], outline: false });
  addFace(kit, rig, R, { eyeColor: 0x8a5cff, eyeU: 0.31, eyeV: 0.14, eyeW: 0.2, eyeH: 0.3, lashes: true, mouth: 'none', cheekU: 0.63, cheekV: -0.1, cheek: 0xff9ec9 });
  addMouth(kit, H, frame([0, -0.26, 0.455], [0.4, 0, 0]), 0.1, 'smile');
  // pointy ears with pink insides
  for (const sd of [-1, 1]) {
    kit.add(H, G.cone(0.1, 0.26, 10), coat, { p: [sd * 0.27, 0.37, -0.06], r: [-0.1, 0, -sd * 0.38] });
    kit.add(H, G.cone(0.055, 0.17, 8), toon(0xffb3d6), { p: [sd * 0.265, 0.36, -0.02], r: [-0.1, 0, -sd * 0.38], s: [1, 1, 0.5], outline: false });
  }

  // swirly strawberry-lollipop horn
  const horn = part(H, [0, 0.33, 0.2]);
  horn.rotation.x = 0.42;
  const hornH = 0.44;
  kit.add(horn, G.cone(0.085, hornH, 12), toon(0xfff7fb), { p: [0, hornH / 2, 0] });
  const helix = [];
  for (let i = 0; i <= 30; i++) {
    const k = i / 30;
    const y = 0.02 + k * (hornH - 0.07);
    const rad = 0.085 * (1 - y / hornH) + 0.008;
    helix.push([Math.cos(k * 3.5 * TAU) * rad, y, Math.sin(k * 3.5 * TAU) * rad]);
  }
  kit.add(horn, G.tube(helix, 0.02, 48, 4), toon(PINK), { outline: false });
  const hornStar = part(horn, [0, hornH + 0.04, 0]);
  kit.add(hornStar, G.star(0.07, 0.03), glow(0xfff6c9), { outline: false });

  // rainbow forelock swooping across the forehead (beside the horn)
  const bangs = [
    [-0.2, 0.72, 0, 0.13],
    [-0.42, 0.58, 1, 0.13],
    [-0.6, 0.38, 2, 0.11],
    [0.24, 0.72, 4, 0.11],
    [0.44, 0.56, 5, 0.1],
  ];
  for (const [u, v, ci, r] of bangs) kit.add(H, G.sph(r, 10, 8), toon(RAINBOW[ci]), { f: surf(R, u, v, 1.0), s: [1.3, 0.9, 0.55] });

  // rainbow mane down the back of the head in three rippling sections
  const maneParts = [];
  const locks = [
    [0.35, 0.05, 0, 0.14], [0.75, -0.05, 1, 0.15],
    [1.15, 0.05, 2, 0.15], [1.55, -0.05, 3, 0.15],
    [1.95, 0.05, 4, 0.14], [2.3, -0.04, 5, 0.12],
  ];
  for (let s = 0; s < 3; s++) {
    const [a0] = locks[s * 2];
    const pivot = part(H, [0, Math.cos(a0) * R, -Math.sin(a0) * R]);
    for (const [a, x, ci, r] of locks.slice(s * 2, s * 2 + 2)) {
      const p = [x, Math.cos(a) * R * 1.02 - pivot.position.y, -Math.sin(a) * R * 1.02 - pivot.position.z];
      kit.add(pivot, G.sph(r, 12, 8), toon(RAINBOW[ci]), { p, r: [-a, 0, 0], s: [1.5, 0.75, 1.15] });
    }
    maneParts.push(pivot);
  }
  // a sparkle glint that sweeps along the mane (the shimmer)
  const glint = part(H, [0, 0, 0]);
  kit.add(glint, G.star(0.06, 0.025), glow(WHITE), { outline: false });
  kit.add(glint, G.sph(0.035, 6, 5), glow(0xfff6c9), { p: [0.07, -0.05, 0.02], outline: false });

  let toss = 0;
  rig.anims.push((t, dt, st) => {
    const sp = 3 + st.speedF * 5;
    for (let i = 0; i < maneParts.length; i++) {
      maneParts[i].rotation.x = Math.sin(t * sp - i * 0.9) * (0.08 + st.speedF * 0.06);
      maneParts[i].rotation.z = Math.sin(t * sp * 0.7 - i) * 0.05;
    }
    // shimmer: the glint slides from the top of the mane to its tip, then rests
    const k = (t * 0.55) % 1.4;
    const on = k < 1;
    const a = 0.3 + Math.min(k, 1) * 2.0;
    glint.position.set(0.12, Math.cos(a) * (R + 0.12), -Math.sin(a) * (R + 0.12));
    glint.rotation.z = t * 4;
    glint.scale.setScalar(on ? 0.4 + Math.sin(Math.min(k, 1) * Math.PI) * 0.9 : 0.001);
    // horn twinkles, extra bright while boosting
    hornStar.rotation.y = t * 3;
    hornStar.scale.setScalar((st.boosting ? 1.7 : 1) + Math.sin(t * 7) * 0.2);
    // tail swish
    tail.rotation.y = Math.sin(t * (2.5 + st.speedF * 5)) * 0.25;
    tail.rotation.z = Math.sin(t * 1.9) * 0.08;
    // a proud little head toss every few seconds (or on celebrations)
    const tk = (t % 6.5) / 6.5;
    const tossTarget = st.happy ? Math.abs(Math.sin(t * 6)) * 0.25 : tk > 0.9 ? Math.sin(((tk - 0.9) / 0.1) * Math.PI) * 0.3 : 0;
    toss += (tossTarget - toss) * Math.min(1, dt * 12);
    if (rig.head) rig.head.rotation.x -= toss;
  });
}

export default { def, build };
