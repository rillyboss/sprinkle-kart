/**
 * Bleep Bloop — racer module (data + look).
 * Pack: B. Built with the shared parts library (./parts.js).
 *
 * A tiny toaster robot: its whole head is a shiny retro toaster with big
 * chibi eyes on the front, two slices of toast in the slots, a pop-down
 * lever on the side and a springy antenna with a blinking heart bulb.
 * Wiggles: TOAST POPS UP (with a flip) whenever Bleep boosts, the lever
 * clicks up and down with it, the antenna boings, the chest heart blinks and
 * the plug-cord tail wags behind the kart.
 */
import { THREE, G, toon, glow, frame, stick, limb, part, addMouth, buildKartBase, addArms, makeHead, EYE_DARK, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'bleep',
  name: 'Bleep Bloop',
  tagline: 'Warming up... DING! Ready to roll!',
  personality:
    'A tiny, tidy toaster robot who says "bleep" when happy, "bloop" when VERY happy, and pops toast whenever things get zoomy.',
  colors: { primary: 0xdfe4f2, secondary: 0xe0a458, accent: 0xff6f61, kart: 0x9fecd6 },
  stats: { speed: 3, accel: 5, handling: 3, weight: 1 },
  voice: { pitch: 1.85, style: 'boing' },
  locked: true,
  unlock: { type: 'stat', stat: 'timeTrialsFinished', count: 1 },
  pack: 'b',
  pronoun: 'they',
  emoji: '🍞',
  quotes: {
    select: 'Bleep bloop! Toasty and ready!',
    win: 'DING! Golden-brown victory!',
    oops: 'Bloop... all crumbs!',
  },
};

const CHROME = 0xdfe4f2;
const DARK_CHROME = 0xa9b0c8;
const TOAST = 0xe0a458;
const CRUST = 0xa8642e;
const CHERRY = 0xff6f61;

/**
 * Big shiny chibi eyes placed at explicit spots (for faces that are not one
 * head sphere: Bleep's flat toaster front, Prince Ribbit's eye bumps).
 * Same shapes + materials as addFace(); wires rig.eyes / rig.happyEyes so
 * model.js blinks them and swaps to happy ^ ^ eyes.
 * @param {{p:number[], r?:number[]}[]} spots  eye centres (head space) + facing
 * @param {{eyeColor:number, R?:number, lashes?:boolean}} o  R = the addFace() head radius the eye sizes are relative to
 */
export function chibiEyes(kit, rig, spots, { eyeColor, R = 0.44, lashes = false }) {
  const H = rig.head;
  const gy = spots.reduce((n, s) => n + s.p[1], 0) / spots.length;
  const eyes = new THREE.Group();
  eyes.position.set(0, gy, 0);
  H.add(eyes);
  const happy = new THREE.Group();
  happy.position.copy(eyes.position);
  happy.visible = false;
  H.add(happy);
  rig.eyes = eyes;
  rig.happyEyes = happy;
  const dark = toon(EYE_DARK);
  const iris = toon(eyeColor, { emissive: eyeColor, emissiveIntensity: 0.25 });
  const shine = glow(WHITE);
  for (const { p, r = [0, 0, 0] } of spots) {
    const side = p[0] < 0 ? -1 : 1;
    const F = frame([p[0], p[1] - gy, p[2]], r);
    kit.add(eyes, G.sph(1, 12, 9), dark, { f: F, s: [0.2 * R, 0.27 * R, 0.13 * R], outline: false });
    kit.add(eyes, G.sph(1, 10, 6), iris, { f: F, p: [0, -0.08 * R, 0.07 * R], s: [0.2 * R * 0.74, 0.27 * R * 0.55, 0.07 * R], outline: false });
    kit.add(eyes, G.sph(0.075 * R, 8, 6), shine, { f: F, p: [-0.06 * R, 0.1 * R, 0.13 * R], outline: false });
    kit.add(eyes, G.sph(0.038 * R, 6, 5), shine, { f: F, p: [0.07 * R, -0.1 * R, 0.13 * R], outline: false });
    if (lashes) {
      kit.add(eyes, G.cap(0.022 * R, 0.1 * R, 5), dark, { f: F, p: [side * 0.2 * R * 0.95, 0.27 * R * 0.72, 0.04 * R], r: [0, 0, -side * 0.9], outline: false });
    }
    kit.add(happy, G.tor(0.12 * R, 0.035 * R, 5, 10, Math.PI), dark, { f: F, p: [0, -0.06 * R, 0.1 * R], outline: false });
  }
}

/** Eyes, cheeks and a grin on Bleep's flat toaster front (z = the front plane). */
function flatFace(kit, rig, { z, y, eyeX, R = 0.44, eyeColor, cheek = 0xff8fb0, mouthY }) {
  chibiEyes(kit, rig, [{ p: [-eyeX, y, z] }, { p: [eyeX, y, z] }], { eyeColor, R });
  for (const side of [-1, 1]) {
    kit.add(rig.head, G.sph(1, 10, 6), toon(cheek), { p: [side * (eyeX + 0.1), y - 0.13, z - 0.005], s: [0.15 * R, 0.085 * R, 0.05 * R], outline: false });
  }
  addMouth(kit, rig.head, frame([0, mouthY, z - 0.004]), R * 0.12, 'grin');
}

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: CHROME, seat: CHERRY, hub: CHROME, bar: DARK_CHROME, steer: DARK_CHROME, tire: 0x3d3150 });
  const C = rig.chassis;
  const chrome = toon(CHROME);
  // a pat of butter melting on the hood + two little oven dials on the nose
  kit.add(C, G.rbox(0.26, 0.08, 0.2, 0.03), toon(0xfff1a0), { p: [0, 0.78, 0.46], r: [-0.2, 0.3, 0] });
  kit.add(C, G.sph(0.1, 10, 6), toon(0xfff1a0), { p: [0.02, 0.745, 0.47], s: [1.6, 0.25, 1.4], r: [-0.2, 0, 0], outline: false });
  for (const sd of [-1, 1]) {
    kit.add(C, G.cyl(0.07, 0.07, 0.05, 12), chrome, { p: [sd * 0.2, 0.54, 1.1], r: [Math.PI / 2 - 0.2, 0, 0] });
    kit.add(C, G.box(0.02, 0.09, 0.02), toon(CHERRY), { p: [sd * 0.2, 0.55, 1.14], r: [-0.2, 0, sd * 0.6], outline: false });
  }
  // rivets on the side pods
  for (const sd of [-1, 1]) for (const z of [-0.2, 0.02, 0.24]) {
    kit.add(C, G.sph(0.035, 6, 5), toon(DARK_CHROME), { p: [sd * 0.81, 0.53, z], outline: false });
  }
  // curly power-cord tail with a plug, wagging off the back bumper
  const cord = part(C, [0, 0.4, -1.12]);
  const cordPts = [];
  for (let i = 0; i <= 14; i++) {
    const k = i / 14;
    cordPts.push([Math.sin(k * 3 * TAU) * 0.07, Math.cos(k * 3 * TAU) * 0.07 + k * 0.05, -k * 0.34]);
  }
  kit.add(cord, G.tube(cordPts, 0.025, 36, 5), toon(0x5a4f78));
  kit.add(cord, G.rbox(0.12, 0.09, 0.1, 0.03), toon(WHITE), { p: [0, 0.06, -0.38] });
  for (const sd of [-1, 1]) kit.add(cord, G.box(0.02, 0.04, 0.07), toon(DARK_CHROME), { p: [sd * 0.03, 0.06, -0.46], outline: false });

  // ── body: a little robot chassis ──
  const D = rig.driver;
  rig.driver.scale.setScalar(0.94);
  kit.add(D, G.rbox(0.52, 0.42, 0.4, 0.12), chrome, { p: [0, 0.9, 0] });
  kit.add(D, G.rbox(0.3, 0.22, 0.04, 0.05), toon(0x5a4f78), { p: [0, 0.92, 0.2] });
  const heart = part(D, [0, 0.92, 0.225]);
  kit.add(heart, G.heart(0.14, 0.03), glow(CHERRY), { outline: false });
  kit.add(D, G.cyl(0.1, 0.12, 0.12, 12), toon(DARK_CHROME), { p: [0, 1.15, 0] });
  addArms(kit, rig, DARK_CHROME, CHERRY, { shoulder: [0.3, 1.0, 0.02], r: 0.055, handR: 0.095 });

  // ── head: the toaster ──
  const H = makeHead(rig, 1.46);
  const hw = 0.86, hh = 0.64, hd = 0.58;
  kit.add(H, G.rbox(hw, hh, hd, 0.16), chrome);
  // coral racing band round the middle + chrome trim lines
  kit.add(H, G.rbox(hw + 0.02, 0.1, hd + 0.02, 0.04), toon(CHERRY), { p: [0, -0.2, 0], outline: false });
  // two dark toast slots on top
  for (const z of [-0.11, 0.11]) kit.add(H, G.rbox(0.56, 0.04, 0.11, 0.02), toon(0x3a2f4a), { p: [0, hh / 2 - 0.005, z], outline: false });
  // little feet-pegs under the toaster (reads as an appliance)
  for (const sd of [-1, 1]) kit.add(H, G.cyl(0.05, 0.06, 0.05, 8), toon(DARK_CHROME), { p: [sd * 0.3, -hh / 2 - 0.01, 0.15], outline: false });
  flatFace(kit, rig, { z: hd / 2 + 0.005, y: 0.04, eyeX: 0.17, eyeColor: 0x2f8fd8, mouthY: -0.1 });
  // back: little vent slits + a cherry heart sticker (what the chase camera sees)
  for (const y of [0.1, 0.02, -0.06]) kit.add(H, G.rbox(0.3, 0.025, 0.02, 0.01), toon(0x8a90aa), { p: [0.12, y, -hd / 2 - 0.004], outline: false });
  kit.add(H, G.heart(0.16, 0.02), toon(CHERRY), { p: [-0.2, 0.04, -hd / 2 - 0.01], r: [0, Math.PI, 0], outline: false });
  // shiny highlight streak (it's very polished)
  kit.add(H, G.cap(0.022, 0.2, 5), glow(WHITE), { p: [-0.33, 0.12, hd / 2 + 0.002], r: [0, 0, 0.5], outline: false });

  // side lever (right) that clicks with the toast; dial (left)
  kit.add(H, G.rbox(0.03, 0.34, 0.07, 0.015), toon(0x3a2f4a), { p: [-hw / 2 - 0.005, 0, 0.05], outline: false });
  const lever = part(H, [-hw / 2 - 0.03, 0, 0.05]);
  kit.add(lever, G.box(0.06, 0.04, 0.05), toon(DARK_CHROME), { outline: false });
  kit.add(lever, G.sph(0.06, 10, 8), toon(CHERRY), { p: [-0.05, 0, 0] });
  kit.add(H, G.cyl(0.09, 0.09, 0.04, 14), toon(WHITE), { p: [hw / 2 + 0.02, 0.02, 0.05], r: [0, 0, Math.PI / 2] });
  kit.add(H, G.box(0.02, 0.12, 0.025), toon(CHERRY), { p: [hw / 2 + 0.045, 0.04, 0.05], r: [0.5, 0, 0], outline: false });

  // springy antenna with a blinking heart bulb
  const ant = part(H, [0.3, hh / 2, -0.2]);
  const zig = [];
  for (let i = 0; i <= 10; i++) zig.push([Math.sin(i * 1.9) * 0.035, i * 0.024, Math.cos(i * 1.9) * 0.035]);
  kit.add(ant, G.tube(zig, 0.012, 30, 4), toon(DARK_CHROME), { outline: false });
  const bulb = part(ant, [0, 0.29, 0]);
  kit.add(bulb, G.sph(0.065, 10, 8), glow(0xfff1a0));
  kit.add(bulb, G.heart(0.07, 0.02), glow(CHERRY), { p: [0, 0, 0.06], outline: false });

  // two slices of toast (the back one has a jam heart for the chase camera)
  const toast = [];
  const toastMat = toon(TOAST);
  const crust = toon(CRUST);
  for (const [i, z] of [[0, 0.11], [1, -0.11]]) {
    const slice = part(H, [0, 0, z]);
    const inner = part(slice, [0, 0.24, 0]);
    kit.add(inner, G.rbox(0.44, 0.34, 0.07, 0.03), crust);
    kit.add(inner, G.rbox(0.38, 0.28, 0.08, 0.03), toastMat, { outline: false });
    // bread-loaf bumps on top
    for (const sd of [-1, 1]) kit.add(inner, G.sph(0.11, 10, 6), crust, { p: [sd * 0.1, 0.16, 0], s: [1, 0.55, 0.32] });
    if (i === 1) kit.add(inner, G.heart(0.13, 0.02), toon(0xd8344f), { p: [0, 0.01, -0.045], r: [0, Math.PI, 0], outline: false });
    else kit.add(inner, G.rbox(0.12, 0.03, 0.09, 0.012), toon(0xfff1a0), { p: [0.05, 0.02, 0.0], r: [0, 0, 0.3], outline: false });
    toast.push({ slice, inner, y: 0, vy: 0, flip: 0 });
  }

  const REST = -0.02; // slices resting in their slots (just the tops peek out)
  let wasBoosting = false;
  rig.anims.push((t, dt, st) => {
    const boostEdge = st.boosting && !wasBoosting;
    wasBoosting = st.boosting;
    let airborne = 0;
    for (let i = 0; i < toast.length; i++) {
      const s = toast[i];
      // POP! on a new boost, and again each time a slice lands while still boosting
      if (s.y <= 0 && s.vy <= 0 && (boostEdge || (st.boosting && s.flip === 0))) {
        s.vy = 3.4 + i * 0.5;
        s.flip = i === 0 ? 1 : -1;
      }
      s.vy -= 11 * dt;
      s.y = Math.max(0, s.y + s.vy * dt);
      if (s.y === 0 && s.vy < 0) {
        s.vy = 0;
        s.flip = 0;
      }
      if (s.y > 0) airborne++;
      // idle: a tiny eager wiggle in the slot
      const wig = s.y === 0 ? Math.max(0, Math.sin(t * 2.3 + i * 2)) * 0.015 : 0;
      s.slice.position.y = REST + s.y + wig;
      s.inner.rotation.x = s.flip * Math.min(1, s.y / 0.5) * Math.PI * 0.5 * (i === 0 ? 1 : 1.3);
      s.inner.rotation.z = Math.sin(s.y * 6) * 0.15;
    }
    lever.position.y = airborne ? 0.12 : -0.12;
    // antenna boing + blinking bulb
    ant.rotation.z = Math.sin(t * 9) * (0.08 + st.speedF * 0.1) - st.steer * 0.2;
    ant.rotation.x = Math.sin(t * 7.3) * 0.06 + (st.boosting ? -0.3 : 0);
    bulb.scale.setScalar(1 + (Math.sin(t * 5) > 0.6 ? 0.25 : 0) + (st.boosting ? 0.3 : 0));
    heart.scale.setScalar(0.85 + Math.abs(Math.sin(t * 3.2)) * 0.3);
    cord.rotation.y = Math.sin(t * (4 + st.speedF * 6)) * 0.35;
    cord.rotation.x = Math.sin(t * 3.1) * 0.1;
  });
}

export default { def, build };
