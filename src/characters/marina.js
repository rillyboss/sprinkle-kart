/**
 * Marina Seashell — racer module (data + look).
 * Pack: B. Built with the shared parts library (./parts.js).
 *
 * A cheerful mermaid with wavy coral hair, a sea-teal tail and a lilac fin,
 * riding a pearly CLAMSHELL HOVER-KART (no wheels!): the bottom shell floats
 * on a cushion of bubbles and the open top shell stands up behind her like a
 * spoiler. Wiggles: the clam bobs on its bubbles, bubble jets stream out of
 * the back (a big fizzy gush while boosting), bubbles pop underneath, her
 * fin flips over the side, her hair floats like it is underwater, and the
 * clam lid breathes open and shut.
 */
import { THREE, G, toon, glow, frame, surf, stick, limb, part, rng, extrude, addFace, addArms, makeHead, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'marina',
  name: 'Marina Seashell',
  tagline: 'Making waves, one bubble at a time!',
  personality:
    'A cheerful mermaid who swapped her fins for a hover-clam so she could race on land. She waves at everyone, even the fish-shaped clouds.',
  colors: { primary: 0x3fcfc4, secondary: 0xff8a6a, accent: 0xc9a6ff, kart: 0xffd6e8 },
  stats: { speed: 4, accel: 2, handling: 4, weight: 2 },
  voice: { pitch: 1.35, style: 'yay' },
  locked: true,
  unlock: { type: 'distinct-tracks', result: 'finish', count: 8 },
  pack: 'b',
  pronoun: 'she',
  emoji: '🧜',
  quotes: {
    select: "Let's make a splash!",
    win: 'Shell-ebration time!',
    oops: 'Oh, barnacles!',
  },
  camera: { height: 0.2, lookHeight: -0.05 }, // the clam-lid spoiler is tall
};

const PEARL = 0xffd6e8;
const RIDGE = 0xff9ec9;
const HOVER = 0.16; // the clam floats this high

/** A scallop-shell fan: a half disc with a wavy outer edge (flat side on the X axis). */
function fanShape(r) {
  const s = new THREE.Shape();
  const n = 7;
  s.moveTo(-r * 0.2, 0);
  s.lineTo(-r, 0);
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI - (i / n) * Math.PI;
    const a1 = Math.PI - ((i + 1) / n) * Math.PI;
    const am = (a0 + a1) / 2;
    s.quadraticCurveTo(Math.cos(am) * r * 1.12, Math.sin(am) * r * 1.12, Math.cos(a1) * r, Math.sin(a1) * r);
  }
  s.lineTo(r * 0.2, 0);
  s.closePath();
  return s;
}

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  const rand = rng(0xc1a4);
  const C = rig.chassis;
  const pearl = toon(PEARL);
  const ridge = toon(RIDGE);

  // ── the clamshell hover-kart ──
  const hull = part(C, [0, HOVER, 0]);
  hull.name = 'marina-hull';
  kit.add(hull, G.bowl(1, 20, 7), pearl, { p: [0, 0.5, 0], s: [0.72, 0.4, 1.08] });
  // scalloped rim + ridges down the shell
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    kit.add(hull, G.sph(0.085, 7, 5), ridge, { p: [Math.sin(a) * 0.72, 0.5, Math.cos(a) * 1.08], s: [1, 0.7, 1], outline: false });
  }
  // pearly inside of the shell
  kit.add(hull, G.cyl(1, 1, 0.04, 22), toon(0xfff0f6), { p: [0, 0.49, 0], s: [0.69, 1, 1.05], outline: false });
  // a band of darker pink round the belly of the shell
  kit.add(hull, G.tor(1, 0.03, 5, 28), ridge, { p: [0, 0.3, 0], r: [Math.PI / 2, 0, 0], s: [0.61, 0.92, 1], outline: false });
  // soft seat cushion (a sea sponge!) + a pearl on the nose
  kit.add(hull, G.rbox(0.7, 0.16, 0.62, 0.07), toon(0xfff1a0), { p: [0, 0.5, -0.35] });
  for (const [x, z] of [[-0.18, -0.25], [0.15, -0.45], [0.05, -0.2], [-0.1, -0.5]]) kit.add(hull, G.sph(0.025, 5, 4), toon(0xe8c86a), { p: [x, 0.585, z], outline: false });
  kit.add(hull, G.sph(0.11, 12, 10), toon(WHITE, { emissive: 0xffe6f7, emissiveIntensity: 0.4 }), { p: [0, 0.56, 1.1] });
  kit.add(hull, G.sph(0.03, 6, 5), glow(WHITE), { p: [-0.04, 0.6, 1.2], outline: false });
  // coral steering column + a starfish steering wheel
  stick(kit, hull, [0, 0.5, 0.65], [0, 0.74, 0.36], 0.035, toon(0xff8a6a));
  const sw = new THREE.Group();
  sw.position.set(0, 0.76 + HOVER, 0.34);
  sw.rotation.x = -0.95;
  C.add(sw);
  const swSpin = new THREE.Group();
  sw.add(swSpin);
  kit.add(swSpin, G.tor(0.15, 0.032, 6, 16), toon(0xff8a6a));
  kit.add(swSpin, G.star(0.12, 0.04, 0.5), toon(0xffe45c), { outline: false });
  rig.steeringWheel = swSpin;
  // the open top shell standing up behind her as a spoiler (it "breathes")
  const lid = part(C, [0, 0.62 + HOVER, -0.95]);
  lid.name = 'marina-lid';
  kit.add(lid, extrude(fanShape(0.62), 0.05, 0.02), pearl, { p: [0, 0.3, 0], r: [0, 0, 0] });
  for (let i = 1; i < 7; i++) {
    const a = Math.PI - (i / 7) * Math.PI;
    kit.add(lid, G.cap(0.02, 0.44, 4), ridge, { p: [Math.cos(a) * 0.3, Math.sin(a) * 0.3 + 0.02, -0.035], r: [0, 0, a - Math.PI / 2], outline: false });
  }
  kit.add(lid, G.sph(0.09, 10, 8), toon(WHITE, { emissive: 0xffe6f7, emissiveIntensity: 0.4 }), { p: [0, 0.03, -0.05] });
  // bubble jets at the back (the boost flames come out here too)
  const jet = toon(0xbfeaff);
  const pipes = [[-0.3, 0.42 + HOVER, -1.02], [0.3, 0.42 + HOVER, -1.02]];
  for (const p of pipes) {
    kit.add(C, G.cyl(0.08, 0.1, 0.22, 10), jet, { p, r: [Math.PI / 2 + 0.3, 0, 0] });
    kit.add(C, G.tor(0.08, 0.025, 5, 12), toon(RIDGE), { p: [p[0], p[1] - 0.03, p[2] - 0.1], r: [0.3, 0, 0] });
  }
  rig.exhausts = pipes.map((p) => new THREE.Vector3(p[0], p[1], p[2] - 0.2));

  // bubbles: two trailing streams + a fizzy cushion under the shell
  const bubbleMat = toon(0xdff6ff, { transparent: true, opacity: 0.55, emissive: 0x9fdcff, emissiveIntensity: 0.35 });
  const makeBubbles = (p, n, spread, size) => {
    const g = part(C, p);
    g.name = 'marina-bubbles';
    for (let i = 0; i < n; i++) {
      const r = size * (0.6 + rand() * 0.6);
      const q = [(rand() - 0.5) * spread, rand() * spread * 0.8, -rand() * spread * 0.6];
      kit.add(g, G.sph(r, 8, 5), bubbleMat, { p: q, outline: false });
      kit.add(g, G.sph(r * 0.3, 5, 4), glow(WHITE), { p: [q[0] - r * 0.35, q[1] + r * 0.4, q[2] + r * 0.5], outline: false });
    }
    return { g, p };
  };
  const streams = [
    makeBubbles([-0.3, 0.32 + HOVER, -1.12], 4, 0.3, 0.075),
    makeBubbles([0.3, 0.32 + HOVER, -1.12], 4, 0.3, 0.075),
    makeBubbles([-0.3, 0.32 + HOVER, -1.12], 4, 0.3, 0.06),
    makeBubbles([0.3, 0.32 + HOVER, -1.12], 4, 0.3, 0.06),
  ];
  const cushion = makeBubbles([0, 0.12, 0.35], 6, 0.9, 0.08);

  // ── the mermaid ──
  const D = rig.driver;
  D.position.y += HOVER;
  const skin = toon(0xffe0cc);
  const tailMat = toon(c.primary);
  const fin = toon(c.accent);
  // lilac top with a scalloped hem + pearl necklace
  kit.add(D, G.sph(0.3), toon(c.accent), { p: [0, 0.98, 0], s: [1, 0.95, 0.85] });
  kit.add(D, G.sph(0.3, 14, 8), tailMat, { p: [0, 0.78, 0], s: [1.05, 0.7, 0.9] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    kit.add(D, G.sph(0.05, 6, 5), toon(c.accent), { p: [Math.sin(a) * 0.29, 0.86, Math.cos(a) * 0.25], outline: false });
  }
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + (i / 6) * 1.8;
    kit.add(D, G.sph(0.026, 6, 5), toon(WHITE, { emissive: 0xffe6f7, emissiveIntensity: 0.4 }), { p: [Math.sin(a) * 0.17, 1.16 - Math.cos(a * 1.1) * 0.05 + 0.05, Math.cos(a) * 0.16 + 0.05], outline: false });
  }
  addArms(kit, rig, 0xffe0cc, 0xffe0cc, { r: 0.07, handR: 0.085 });
  // her tail curls forward and pops out over the side of the clam
  const tailPts = [[0, 0.72, 0.05], [0.18, 0.6, 0.4], [0.42, 0.66, 0.66], [0.62, 0.84, 0.8]];
  for (let i = 0; i < 3; i++) limb(kit, D, tailPts[i], tailPts[i + 1], 0.2 - i * 0.045, tailMat, { rs: 7 });
  for (const [x, y, z] of [[0.1, 0.72, 0.28], [0.3, 0.64, 0.54], [0.5, 0.74, 0.72]]) {
    kit.add(D, G.sph(0.05, 8, 6), toon(0x9ff0e6), { p: [x, y + 0.1, z], s: [1, 0.6, 1], outline: false });
  }
  const finP = part(D, tailPts[3]);
  for (const sd of [-1, 1]) {
    kit.add(finP, G.sph(0.2, 12, 8), fin, { p: [sd * 0.14, 0.12, 0.02], r: [0, 0.4, sd * 0.7], s: [1, 0.5, 0.18] });
  }

  // ── head ──
  const R = 0.44;
  const H = makeHead(rig, 1.56);
  kit.add(H, G.sph(R, 18, 12), skin);
  const hair = toon(c.secondary);
  kit.add(H, G.sph(0.49), hair, { p: [0, 0.04, -0.1], s: [1.06, 1.06, 0.96] });
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.24, 12, 8), hair, { p: [sd * 0.19, 0.31, 0.25], s: [1.05, 0.55, 0.55], r: [0, 0, sd * 0.4] });
  addFace(kit, rig, R, { eyeColor: 0x16a39a, eyeV: -0.02, lashes: true, mouth: 'grin', mouthV: -0.4, mouthW: 0.11 });
  // pink scallop-shell hair clip + a little starfish
  const clip = surf(R + 0.05, 0.62, 0.42, 1.0);
  kit.add(H, extrude(fanShape(0.12), 0.03, 0.01), toon(RIDGE), { f: clip, r: [0, 0, -0.5] });
  kit.add(H, G.star(0.08, 0.03, 0.5), toon(0xffe45c), { f: surf(R + 0.05, -0.55, 0.5, 1.0), r: [0, 0, 0.3] });
  // a pink scallop bow at the back of her hair (for the chase camera)
  kit.add(H, extrude(fanShape(0.14), 0.03, 0.01), toon(RIDGE), { p: [0, 0.18, -0.6], r: [0, Math.PI, 0] });
  kit.add(H, G.sph(0.04, 8, 6), toon(WHITE, { emissive: 0xffe6f7, emissiveIntensity: 0.4 }), { p: [0, 0.2, -0.64] });
  // long wavy hair flowing down her back in two floaty parts
  const locks = [];
  for (const [i, sd] of [[0, -1], [1, 1]]) {
    const lock = part(H, [sd * 0.24, -0.12, -0.22]);
    limb(kit, lock, [0, 0, 0], [sd * 0.08, -0.3, -0.08], 0.14, hair, { rs: 6 });
    limb(kit, lock, [sd * 0.08, -0.3, -0.08], [sd * -0.02, -0.56, -0.16], 0.12, hair, { rs: 6 });
    kit.add(lock, G.sph(0.11, 10, 8), hair, { p: [sd * 0.06, -0.66, -0.12] });
    locks.push([lock, i]);
  }
  const backLock = part(H, [0, -0.1, -0.34]);
  limb(kit, backLock, [0, 0, 0], [0, -0.35, -0.1], 0.18, hair, { rs: 6 });
  kit.add(backLock, G.sph(0.14, 10, 8), hair, { p: [0, -0.5, -0.12] });
  locks.push([backLock, 2]);

  let lidT = 0;
  rig.anims.push((t, dt, st) => {
    // float on the bubbles (on top of the shared chassis bob)
    C.position.y += Math.sin(t * 2.4) * 0.035;
    hull.rotation.z = Math.sin(t * 1.9) * 0.03;
    // bubble streams: each group drifts back and up, grows, then starts again
    const rate = st.boosting ? 2.6 : 0.9 + st.speedF * 0.9;
    for (let i = 0; i < streams.length; i++) {
      const { g, p } = streams[i];
      const k = (t * rate + i * 0.5) % 1;
      g.position.set(p[0] + Math.sin(t * 3 + i) * 0.05, p[1] + k * 0.45, p[2] - k * (0.15 + st.speedF * 0.9));
      g.scale.setScalar((st.boosting ? 1.5 : 1) * (0.4 + Math.sin(k * Math.PI) * 0.8));
    }
    const kc = (t * 0.8) % 1;
    cushion.g.position.y = 0.08 + kc * 0.12;
    cushion.g.scale.setScalar(0.5 + Math.sin(kc * Math.PI) * 0.6);
    // fin flips, hair floats
    finP.rotation.x = Math.sin(t * 3.2) * 0.35;
    finP.rotation.z = Math.sin(t * 2.1) * 0.2;
    for (const [lock, i] of locks) {
      lock.rotation.x = -0.15 - st.speedF * 0.35 + Math.sin(t * 1.8 + i * 1.3) * 0.12;
      lock.rotation.z = Math.sin(t * 1.4 + i * 2) * 0.1;
    }
    // the clam lid breathes (and flips open wide on boosts)
    lidT += ((st.boosting ? 1 : 0) - lidT) * Math.min(1, dt * 6);
    lid.rotation.x = -0.25 + Math.sin(t * 1.3) * 0.06 - lidT * 0.25;
  });
}

export default { def, build };
