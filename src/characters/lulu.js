/**
 * Lulu Lamb — racer module (data + look).
 * Pack: B. Built with the shared parts library (./parts.js).
 *
 * A sleepy, cloud-fluffy lamb in starry pajamas and a floppy nightcap,
 * driving her BED: a quilted mattress kart with bedposts, a big pillow and a
 * headboard with a glowing crescent moon. Wiggles: her eyelids droop while
 * she drives (wide awake on boosts!), and whenever she sits still for a
 * moment she DOZES OFF: head nods, eyes close, a Zzz floats up and a sleepy
 * nose bubble grows and shrinks. The nightcap pom-pom bounces all the time.
 */
import { THREE, G, toon, glow, frame, surf, stick, limb, part, rng, extrude, addFace, buildKartBase, addArms, makeHead, EYE_DARK, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'lulu',
  name: 'Lulu Lamb',
  tagline: 'Five more minutes... okay, GO!',
  personality:
    'A cloud-fluffy lamb who can nap anywhere: in bed, in the bath, even in the middle of a race. She wakes right up for boosts, snacks and hugs.',
  colors: { primary: 0xfffaf2, secondary: 0xa9c8ff, accent: 0xffe45c, kart: 0xc9b3ff },
  stats: { speed: 2, accel: 4, handling: 4, weight: 2 },
  voice: { pitch: 1.1, style: 'hum' },
  locked: true,
  unlock: { type: 'track', trackId: 'pillow-fort', result: 'finish' },
  pack: 'b',
  pronoun: 'she',
  emoji: '🐑',
  quotes: {
    select: 'Yawn... is it race time? Okay!',
    win: 'Sweet dreams DO come true!',
    oops: 'Baa-bump! I am awake!',
  },
  camera: { height: 0.25, lookHeight: -0.1 }, // floppy nightcap + headboard
};

const WOOD = 0xf6d9b0;
const PJ = 0xa9c8ff;
const STAR = 0xffe45c;
const FACE = 0xffe9e4;
/** Seconds of sitting still before Lulu nods off. */
export const DOZE_AFTER = 1.2;

function zShape(w, h, t) {
  const s = new THREE.Shape();
  s.moveTo(-w, h);
  s.lineTo(w, h);
  s.lineTo(w, h - t);
  s.lineTo(-w + t * 1.6, -h + t);
  s.lineTo(w, -h + t);
  s.lineTo(w, -h);
  s.lineTo(-w, -h);
  s.lineTo(-w, -h + t);
  s.lineTo(w - t * 1.6, h - t);
  s.lineTo(-w, h - t);
  s.closePath();
  return s;
}

function moonShape(r) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, Math.PI * 0.35, Math.PI * 1.65, false);
  s.absarc(r * 0.45, 0, r * 0.78, Math.PI * 1.45, Math.PI * 0.55, true);
  s.closePath();
  return s;
}

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  const rand = rng(0x1a3b);
  buildKartBase(kit, rig, { body: c.kart, trim: WOOD, seat: WHITE, hub: STAR, bar: WOOD, steer: WOOD, shell: false, lights: false, tire: 0x5b4a8a });
  const C = rig.chassis;
  const wood = toon(WOOD);
  // bed frame + mattress + a starry quilt pulled up over the front
  kit.add(C, G.rbox(1.34, 0.18, 2.06, 0.06), wood, { p: [0, 0.34, 0] });
  kit.add(C, G.rbox(1.24, 0.22, 1.92, 0.1), toon(0xf4f7ff), { p: [0, 0.52, 0] });
  const quilt = toon(c.kart);
  kit.add(C, G.rbox(1.32, 0.16, 1.05, 0.08), quilt, { p: [0, 0.66, 0.42] });
  kit.add(C, G.rbox(0.9, 0.2, 0.5, 0.1), quilt, { p: [0, 0.72, 0.32] }); // her knees under the covers
  for (const sd of [-1, 1]) kit.add(C, G.rbox(0.05, 0.26, 1.0, 0.025), quilt, { p: [sd * 0.66, 0.53, 0.42], outline: false });
  kit.add(C, G.rbox(1.26, 0.06, 0.2, 0.03), toon(WHITE), { p: [0, 0.75, -0.08], outline: false }); // folded sheet
  for (let i = 0; i < 7; i++) {
    const x = (rand() - 0.5) * 1.1;
    const z = 0.05 + rand() * 0.85;
    kit.add(C, G.star(0.06, 0.02), toon(i % 3 === 0 ? WHITE : STAR), { p: [x, 0.75 + (Math.abs(z - 0.32) < 0.25 && Math.abs(x) < 0.4 ? 0.05 : 0), z], r: [-Math.PI / 2, 0, rand() * TAU], outline: false });
  }
  // footboard + bedposts with ball tops
  kit.add(C, G.rbox(1.3, 0.3, 0.1, 0.05), wood, { p: [0, 0.6, 1.02] });
  for (const [x, z, h] of [[-0.66, 1.02, 0.5], [0.66, 1.02, 0.5], [-0.66, -1.0, 0.95], [0.66, -1.0, 0.95]]) {
    kit.add(C, G.cyl(0.055, 0.06, h, 10), wood, { p: [x, 0.3 + h / 2, z] });
    kit.add(C, G.sph(0.09, 10, 8), toon(STAR), { p: [x, 0.33 + h, z] });
  }
  // headboard with a glowing crescent moon + the big fluffy pillow
  kit.add(C, G.rbox(1.3, 0.6, 0.1, 0.05), wood, { p: [0, 0.95, -1.02] });
  kit.add(C, G.cyl(0.5, 0.5, 0.1, 20), wood, { p: [0, 1.2, -1.02], r: [Math.PI / 2, 0, 0], s: [1.25, 1, 0.6] });
  kit.add(C, extrude(moonShape(0.2), 0.03, 0.01), glow(0xfff1a8), { p: [0, 1.18, -1.085], r: [0, Math.PI, 0.3] });
  kit.add(C, G.star(0.06, 0.02), glow(0xfff1a8), { p: [0.28, 1.32, -1.08], outline: false });
  kit.add(C, G.star(0.04, 0.02), glow(0xfff1a8), { p: [-0.3, 1.1, -1.08], outline: false });
  kit.add(C, G.rbox(0.95, 0.42, 0.26, 0.13), toon(WHITE), { p: [0, 0.92, -0.8], r: [-0.25, 0, 0] });

  // ── body: starry pajamas ──
  const D = rig.driver;
  const pj = toon(PJ);
  const wool = toon(c.primary);
  kit.add(D, G.sph(0.33), pj, { p: [0, 0.94, 0], s: [1, 1, 0.9] });
  for (const [x, y] of [[-0.14, 1.02], [0.12, 0.86], [0.2, 1.08], [-0.05, 0.8]]) {
    kit.add(D, G.star(0.05, 0.02), toon(STAR), { p: [x, y, 0.3 - Math.abs(x) * 0.3], outline: false });
  }
  // pajama collar + two big buttons
  kit.add(D, G.tor(0.19, 0.045, 6, 16), toon(WHITE), { p: [0, 1.19, 0.02], r: [Math.PI / 2 - 0.1, 0, 0] });
  for (const y of [1.06, 0.92]) kit.add(D, G.sph(0.035, 8, 6), toon(0xff9ec9), { p: [0, y, 0.3] });
  // fluffy wool tail poking over the pillow
  for (const [x, y, r] of [[0, 1.0, 0.1], [0.07, 1.07, 0.07], [-0.07, 1.06, 0.07]]) kit.add(D, G.ico(r, 1), wool, { p: [x, y, -0.34] });
  addArms(kit, rig, PJ, c.primary, { r: 0.08, handR: 0.1 });

  // ── head ──
  const R = 0.42;
  const H = makeHead(rig, 1.55);
  kit.add(H, G.sph(R, 18, 12), toon(FACE));
  // cloud-fluffy wool all round the top and back of her head
  const puffs = [
    [0, 0.3, 0.2, 0.17], [-0.2, 0.3, 0.14, 0.15], [0.2, 0.3, 0.14, 0.15], [-0.34, 0.14, 0.08, 0.14], [0.34, 0.14, 0.08, 0.14],
    [0, 0.34, -0.05, 0.2], [-0.24, 0.26, -0.18, 0.18], [0.24, 0.26, -0.18, 0.18], [0, 0.16, -0.32, 0.22],
    [-0.3, -0.02, -0.2, 0.17], [0.3, -0.02, -0.2, 0.17], [0, -0.12, -0.3, 0.19],
  ];
  for (const [x, y, z, r] of puffs) kit.add(H, G.ico(r, 1), wool, { p: [x, y, z] });
  // floppy ears
  const ears = [];
  for (const sd of [-1, 1]) {
    const ear = part(H, [sd * 0.4, 0.02, -0.02]);
    kit.add(ear, G.sph(0.14, 10, 8), toon(FACE), { p: [sd * 0.1, -0.06, 0], s: [1.25, 0.55, 0.7], r: [0, 0, sd * -0.5] });
    kit.add(ear, G.sph(0.09, 8, 6), toon(0xffc2d6), { p: [sd * 0.11, -0.07, 0.05], s: [1.2, 0.5, 0.3], r: [0, 0, sd * -0.5], outline: false });
    ears.push([ear, sd]);
  }
  const eyeV = -0.02;
  const eyeU = 0.34;
  addFace(kit, rig, R, { eyeColor: 0x7a6bd8, eyeU, eyeV, mouth: 'tiny', mouthV: -0.4, mouthW: 0.09, cheek: 0xff9ec9 });
  // tiny pink nose
  kit.add(H, G.sph(0.04, 8, 6), toon(0xff8fb0), { f: surf(R, 0, -0.2, 1.0), s: [1.3, 0.9, 0.6], outline: false });
  // droopy eyelids (half-closed while driving, open wide on boosts)
  const lids = part(H, [0, 0, 0]);
  lids.name = 'lulu-lids';
  const lidMat = toon(FACE);
  const dark = toon(EYE_DARK);
  for (const side of [-1, 1]) {
    const F = surf(R, eyeU * side, eyeV, 0.9);
    kit.add(lids, new THREE.SphereGeometry(1, 12, 5, 0, TAU, 0, Math.PI / 2), lidMat, { f: F, p: [0, 0.07 * R, 0.01], s: [0.24 * R, 0.22 * R, 0.16 * R], outline: false });
    kit.add(lids, G.tor(0.2 * R, 0.022 * R, 4, 10, Math.PI * 0.8), dark, { f: F, p: [0, -0.1 * R, 0.13 * R], r: [0, 0, Math.PI * 0.1], outline: false });
  }
  // sleeping eyes: soft closed curves (shown while she dozes)
  const sleepy = part(H, [0, 0, 0]);
  sleepy.visible = false;
  sleepy.name = 'lulu-sleepy-eyes';
  for (const side of [-1, 1]) {
    kit.add(sleepy, G.tor(0.12 * R, 0.03 * R, 5, 10, Math.PI), dark, { f: surf(R, eyeU * side, eyeV, 0.97), p: [0, 0.03 * R, 0], r: [0, 0, Math.PI], outline: false });
  }
  // the floppy nightcap with a bouncy pom-pom
  const capMat = toon(PJ);
  kit.add(H, G.tor(0.3, 0.07, 8, 18), toon(WHITE), { p: [0, 0.36, -0.06], r: [Math.PI / 2 + 0.25, 0, 0.1] });
  const capPts = [[0, 0.38, -0.06], [0.05, 0.66, -0.14], [0.26, 0.84, -0.32], [0.5, 0.72, -0.48]];
  const radii = [0.28, 0.19, 0.11];
  for (let i = 0; i < 3; i++) kit.add(H, G.cyl(radii[i] * 0.72, radii[i], 0.001 + Math.hypot(capPts[i + 1][0] - capPts[i][0], capPts[i + 1][1] - capPts[i][1], capPts[i + 1][2] - capPts[i][2]) + 0.06, 12), capMat, {
    p: capPts[i].map((v, k) => (v + capPts[i + 1][k]) / 2),
    q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...capPts[i + 1].map((v, k) => v - capPts[i][k])).normalize()),
  });
  for (const [x, y, z] of [[-0.12, 0.5, 0.12], [0.16, 0.56, 0.05], [0.12, 0.7, -0.22]]) kit.add(H, G.star(0.045, 0.02), toon(STAR), { p: [x, y, z], outline: false });
  const pom = part(H, capPts[3]);
  kit.add(pom, G.ico(0.1, 1), toon(WHITE), { p: [0.02, -0.08, 0] });

  // Zzz + sleepy nose bubble (only while dozing)
  const zzz = part(H, [0.38, 0.5, 0.1]);
  const zMat = toon(0xb9a8ff, { emissive: 0x9f8aff, emissiveIntensity: 0.3 });
  for (const [i, s] of [[0, 1], [1, 0.75], [2, 0.55]]) {
    kit.add(zzz, extrude(zShape(0.07 * s, 0.08 * s, 0.028 * s), 0.025, 0.01), zMat, { p: [i * 0.13, i * 0.17, 0], r: [0, -0.3, 0.15 * i] });
  }
  zzz.visible = false;
  zzz.name = 'lulu-zzz';
  const bubble = part(H, [0.03, -0.2, R + 0.02]);
  kit.add(bubble, G.sph(0.13, 12, 8), toon(0xdff6ff, { transparent: true, opacity: 0.55, emissive: 0x9fdcff, emissiveIntensity: 0.35 }), { p: [0.04, -0.02, 0.1], outline: true, ow: 0.012 });
  kit.add(bubble, G.sph(0.03, 6, 5), glow(WHITE), { p: [0.02, 0.04, 0.2], outline: false });
  bubble.visible = false;
  bubble.name = 'lulu-nose-bubble';

  let still = 0;
  let doze = 0;
  rig.anims.push((t, dt, st) => {
    // nodding off when she has been sitting still for a moment
    still = st.speedF < 0.04 && !st.boosting && !st.spinning && !st.happy ? still + dt : 0;
    const dozing = still > DOZE_AFTER;
    doze += ((dozing ? 1 : 0) - doze) * Math.min(1, dt * 3);
    const Hd = rig.head;
    if (Hd) {
      Hd.rotation.x += doze * (0.22 + Math.sin(t * 1.3) * 0.05);
      Hd.rotation.z += doze * 0.12;
    }
    if (dozing && rig.eyes) {
      rig.eyes.visible = false;
      if (rig.happyEyes) rig.happyEyes.visible = false;
    }
    sleepy.visible = dozing;
    lids.visible = !dozing && !st.boosting && rig.eyes?.visible !== false;
    lids.position.y = Math.sin(t * 0.9) * 0.008; // heavy, heavy eyelids
    if (st.boosting && rig.eyes) rig.eyes.scale.set(1.12, rig.eyes.scale.y * 1.12, 1);
    else if (rig.eyes) rig.eyes.scale.x = 1;
    // Zzz drifts up and loops; the nose bubble breathes in and out
    zzz.visible = dozing;
    bubble.visible = dozing;
    if (dozing) {
      const k = (t * 0.45) % 1;
      zzz.position.set(0.38 + k * 0.12, 0.5 + k * 0.35, 0.1);
      zzz.scale.setScalar(0.5 + Math.sin(k * Math.PI) * 0.7);
      bubble.scale.setScalar(0.35 + (Math.sin(t * 1.6) * 0.5 + 0.5) * 0.9);
    }
    // bouncy pom-pom + floppy ears
    pom.rotation.z = Math.sin(t * 3.1) * 0.25 + st.steer * 0.3;
    pom.position.y = capPts[3][1] + Math.abs(Math.sin(t * 4.4)) * 0.03 * (1 - doze);
    for (const [ear, sd] of ears) ear.rotation.z = sd * (Math.sin(t * 2.6 + sd) * 0.08 - doze * 0.25 - st.speedF * 0.15);
  });
}

export default { def, build };
