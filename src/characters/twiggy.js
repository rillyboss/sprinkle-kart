/**
 * Twiggy Licorice — racer module (data + look).
 * Pack: A. Built with the shared parts library (./parts.js).
 *
 * A dramatically tall red-licorice showman with a top hat and a curly
 * mustache. Every boost is a performance: cane up, hat tipped, "Ta-daaa!"
 */
import { G, toon, glow, frame, surf, limb, stick, part, addFace, buildKartBase, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'twiggy',
  name: 'Twiggy Licorice',
  tagline: 'Ladies, gentlemen and gummy bears... TA-DAAA!',
  personality:
    'A dramatically tall licorice showman who twirls his curly mustache, tips his top hat to everyone and strikes a fabulous pose every time he zooms.',
  colors: { primary: 0xe8283c, secondary: 0x2e2240, accent: 0xffd23f, kart: 0x3a2a55 },
  camera: { height: 0.7, lookHeight: -0.1 }, // extra-tall licorice + top hat
  stats: { speed: 4, accel: 3, handling: 4, weight: 1 },
  voice: { pitch: 0.95, style: 'boing' },
  locked: true,
  unlock: { type: 'stat', stat: 'wins', count: 3 },
  pack: 'a',
  pronoun: 'he',
  emoji: '🎩',
  quotes: {
    select: 'The star of the show has arrived!',
    win: 'Thank you, thank you! You are too kind!',
    oops: 'A twist in the plot!',
  },
};

const RED = 0xe8283c;
const RED_DARK = 0xb81f33;
const INK = 0x2e2240;
const GOLD = 0xffd23f;

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  // ── showtime kart: deep plum stage wagon with twinkly marquee bulbs ──
  buildKartBase(kit, rig, { body: c.kart, trim: RED, seat: RED, hub: GOLD, bar: RED, tire: INK, steer: GOLD });
  const C = rig.chassis;
  const gold = toon(GOLD, { emissive: GOLD, emissiveIntensity: 0.3 });
  // gold star on the nose
  kit.add(C, G.star(0.17, 0.06), gold, { p: [0, 0.8, 0.78], r: [-0.3, 0, 0] });
  // marquee light bulbs: dim bulbs everywhere + 3 bright "phases" that chase along
  // (one sub-group per phase keeps it at 3 extra draw calls)
  const bulbDim = toon(0xd9c27a);
  const bulbOn = glow(0xfff6c0);
  const phases = [part(C), part(C), part(C)];
  let bulbN = 0;
  const bulb = (p) => {
    kit.add(C, G.sph(0.036, 6, 5), bulbDim, { p, outline: false });
    kit.add(phases[bulbN++ % 3], G.sph(0.046, 6, 5), bulbOn, { p, outline: false });
  };
  for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) bulb([sd * 0.8, 0.5, -0.28 + i * 0.15]);
  // marquee-sign spoiler: a red show board with a gold frame and chasing bulbs
  kit.add(C, G.rbox(1.1, 0.4, 0.08, 0.06), toon(RED), { p: [0, 1.08, -1.04] });
  kit.add(C, G.rbox(1.2, 0.5, 0.05, 0.08), gold, { p: [0, 1.08, -1.0] });
  for (const sd of [-1, 1]) stick(kit, C, [sd * 0.34, 0.55, -0.96], [sd * 0.34, 0.86, -1.02], 0.03, gold);
  for (let i = 0; i < 7; i++) bulb([-0.48 + i * 0.16, 1.34, -1.04]);
  kit.add(C, G.star(0.13, 0.04), gold, { p: [0, 1.08, -1.1], r: [0, Math.PI, 0], outline: false });
  for (const sd of [-1, 1]) kit.add(C, G.star(0.07, 0.03), toon(WHITE), { p: [sd * 0.34, 1.08, -1.1], r: [0, Math.PI, 0], outline: false });

  // ── Twiggy: one long twisted licorice rope ──
  const D = rig.driver;
  rig.driver.scale.setScalar(0.96);
  const red = toon(RED);
  const redDark = toon(RED_DARK);
  // tall twisted body
  kit.add(D, G.cap(0.23, 0.6, 12), red, { p: [0, 1.02, 0] });
  // the licorice twist: two dark grooves spiralling up his body
  for (const ph of [0, Math.PI]) {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = ph + (i / 24) * TAU * 2.2;
      const y = 0.7 + (i / 24) * 0.66;
      const r = 0.225 * Math.min(1, Math.sin((i / 24) * Math.PI) * 2.2 + 0.25);
      pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    kit.add(D, G.tube(pts, 0.022, 48, 4), redDark, { outline: false });
  }
  // gold bow tie + shiny ink-black waistcoat buttons
  kit.add(D, G.cone(0.08, 0.14, 4), toon(GOLD), { p: [-0.07, 1.34, 0.18], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.5] });
  kit.add(D, G.cone(0.08, 0.14, 4), toon(GOLD), { p: [0.07, 1.34, 0.18], r: [0, 0, Math.PI / 2], s: [1, 1, 0.5] });
  kit.add(D, G.sph(0.04, 6, 5), toon(0xffb000), { p: [0, 1.34, 0.21] });
  for (const y of [1.18, 1.06, 0.94]) kit.add(D, G.sph(0.025, 6, 5), toon(GOLD), { p: [0, y, 0.2], outline: false });
  // long bendy knees poking up (he is SO tall for this kart)
  for (const sd of [-1, 1]) {
    const hip = [sd * 0.13, 0.7, 0.1];
    const knee = [sd * 0.28, 1.0, 0.44];
    const foot = [sd * 0.25, 0.64, 0.8];
    limb(kit, D, hip, knee, 0.065, red);
    limb(kit, D, knee, foot, 0.06, red);
    kit.add(D, G.sph(0.085, 8, 6), redDark, { p: knee });
    kit.add(D, G.sph(0.09, 8, 6), toon(INK), { p: foot, s: [1, 0.8, 1.4] });
  }
  // right hand (driver's right = -X) stays on the wheel
  const glove = toon(WHITE);
  limb(kit, D, [0.2, 1.3, 0.0], [0.14, 0.93, 0.6], 0.055, red);
  kit.add(D, G.sph(0.09, 8, 6), glove, { p: [0.14, 0.93, 0.6] });
  // show arm with a candy-cane twirler: waves, then strikes a pose on boosts
  const showArm = part(D, [-0.2, 1.3, 0.0]);
  showArm.name = 'twiggy:show-arm';
  limb(kit, showArm, [0, 0, 0], [-0.06, -0.37, 0.6], 0.055, red);
  kit.add(showArm, G.sph(0.09, 8, 6), glove, { p: [-0.06, -0.37, 0.6] });
  const caneTilt = part(showArm, [-0.06, -0.37, 0.6]);
  caneTilt.rotation.z = 0.7; // leans out to the side, never in front of his face
  const cane = part(caneTilt, [0, 0, 0]);
  const caneRed = toon(RED);
  const caneWhite = toon(WHITE);
  for (let i = 0; i < 6; i++) {
    kit.add(cane, G.cyl(0.026, 0.026, 0.1, 8), i % 2 ? caneRed : caneWhite, { p: [0, 0.05 + i * 0.1, 0], outline: i === 0 || i === 5 });
  }
  kit.add(cane, G.tor(0.08, 0.026, 6, 10, Math.PI), caneRed, { p: [-0.08, 0.62, 0] });
  kit.add(cane, G.sph(0.05, 6, 5), toon(GOLD), { p: [0, -0.02, 0], outline: false });

  // ── head ──
  const R = 0.42;
  const H = part(D, [0, 1.84, 0]);
  rig.head = H;
  rig.headLag = 1.5; // wobbly licorice neck
  kit.add(D, G.cyl(0.1, 0.13, 0.3, 10), red, { p: [0, 1.5, 0] });
  kit.add(H, G.sph(R, 18, 12), red);
  // licorice-twist grooves swirling round the back of his head
  for (const ph of [0, Math.PI]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      const a = ph + Math.PI * 0.2 + k * Math.PI * 0.9;
      const y = -0.32 + k * 0.5;
      const r = Math.sqrt(Math.max(0.01, R * R - y * y)) * 1.005;
      pts.push([Math.cos(a) * r, y, -Math.abs(Math.sin(a)) * r]);
    }
    kit.add(H, G.tube(pts, 0.02, 20, 4), redDark, { outline: false });
  }
  addFace(kit, rig, R, {
    eyeColor: 0x4a2a6a, eyeV: 0.04, eyeW: 0.19, eyeH: 0.27,
    cheek: 0xff9aa8, cheekV: -0.22, cheekU: 0.62, mouth: 'grin', mouthV: -0.52, mouthW: 0.09,
    brows: { color: INK, v: 0.46, angle: 0.28, w: 0.035 },
  });
  // curly ink-licorice mustache (twirls!)
  const stache = part(H, [0, -0.13, 0.41]);
  const ink = toon(INK);
  for (const sd of [-1, 1]) {
    const pts = [[0, 0, 0.02], [0.08, -0.02, 0], [0.16, 0.0, -0.03], [0.21, 0.07, -0.06], [0.18, 0.12, -0.06], [0.14, 0.09, -0.05]].map(([x, y, z]) => [x * sd, y, z]);
    kit.add(stache, G.tube(pts, 0.026, 18, 5), ink);
  }
  kit.add(stache, G.sph(0.045, 6, 5), ink, { p: [0, 0, 0.02] });
  // tall top hat with a rainbow-candy band
  const hat = part(H, [0, 0.3, -0.02]);
  hat.name = 'twiggy:hat';
  hat.rotation.set(-0.12, 0, 0.1);
  const hatM = toon(INK);
  kit.add(hat, G.cyl(0.46, 0.46, 0.04, 20), hatM, { p: [0, 0.02, 0] });
  kit.add(hat, G.cyl(0.29, 0.27, 0.62, 18), hatM, { p: [0, 0.34, 0] });
  const rb = [0xff6b9a, 0xffa64d, 0xffe45c, 0x7ee07a, 0x5ec8ff];
  rb.forEach((col, i) => kit.add(hat, G.cyl(0.285, 0.285, 0.035, 18), toon(col), { p: [0, 0.08 + i * 0.035, 0], outline: false }));
  kit.add(hat, G.star(0.09, 0.03), glow(GOLD), { p: [0, 0.14, 0.29], outline: false });

  let pose = 0;
  rig.anims.push((t, dt, st) => {
    // boosts are showtime: cane arm flings up, hat pops up for a tip
    const want = st.boosting || st.happy ? 1 : 0;
    pose += (want - pose) * Math.min(1, dt * 8 + 0.01);
    const wave = Math.sin(t * 3.2) * 0.08;
    showArm.rotation.x = -pose * 2.3 + wave * (1 - pose);
    showArm.rotation.z = -pose * 0.5;
    cane.rotation.y = t * (2 + pose * 10);
    hat.position.y = 0.3 + pose * 0.22;
    hat.rotation.z = 0.1 + pose * 0.35 + Math.sin(t * 2) * 0.03;
    // mustache twirl
    stache.rotation.z = Math.sin(t * 6) * 0.08;
    stache.scale.set(1 + Math.sin(t * 9) * 0.04, 1, 1);
    // marquee bulbs chase along the sides
    const lit = Math.floor(((t * 6) % 3 + 3) % 3);
    for (let i = 0; i < 3; i++) phases[i].visible = i === lit || (pose > 0.5 && i !== (lit + 1) % 3);
  });
}

export default { def, build };
