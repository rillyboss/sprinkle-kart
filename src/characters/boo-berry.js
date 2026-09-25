/**
 * Boo Berry — racer module (data + look).
 * Pack: A. Built with the shared parts library (./parts.js).
 *
 * A shy, giggly blueberry ghost. She floats above her seat, and when she gets
 * bonked (or wins!) she blushes so hard she turns see-through.
 */
import { G, toon, glow, frame, surf, limb, part, addFace, buildKartBase, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'boo-berry',
  name: 'Boo Berry',
  tagline: 'Peek-a-boo... oh! Hee hee, hello!',
  personality:
    'A shy little blueberry ghost who giggles behind her hands, floats instead of sitting and blushes so much she goes see-through.',
  colors: { primary: 0x6f86f0, secondary: 0x3f4fb8, accent: 0xff8fc8, kart: 0xd8d0ff },
  stats: { speed: 3, accel: 4, handling: 4, weight: 1 },
  voice: { pitch: 1.75, style: 'giggle' },
  locked: true,
  unlock: { type: 'track', trackId: 'starlight-galaxy', result: 'top3' },
  pack: 'a',
  pronoun: 'she',
  emoji: '🫐',
  quotes: {
    select: 'Oh! Um... hi! Can I race too? Hee hee!',
    win: 'I won? Eep! I am SO berry happy!',
    oops: 'Boo-hoo... just kidding, hee hee!',
  },
};

const BERRY = 0x6f86f0;
const BERRY_DARK = 0x3f4fb8;
const BLOOM = 0xa9b8ff; // the frosty dusty bloom on a real blueberry

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  // ── blueberry-pie kart: lavender body, golden crust, berries on top ──
  buildKartBase(kit, rig, { body: c.kart, trim: 0xf0c27a, seat: 0x9aa8ff, hub: BERRY, bar: WHITE, tire: 0x4a4a8a, steer: 0xf0c27a });
  const C = rig.chassis;
  const crust = toon(0xf0c27a);
  const crustDark = toon(0xd99a4e);
  // pie lattice on the hood (the hood tilts up toward the front)
  const hoodY = (z) => 0.752 + (z - 0.48) * 0.2;
  for (const o of [-0.22, 0, 0.22]) {
    kit.add(C, G.box(0.08, 0.03, 0.74), crust, { p: [o, hoodY(0.48), 0.48], r: [-0.2, 0, 0], outline: false });
    const z = 0.48 + o * 1.25;
    kit.add(C, G.box(0.76, 0.03, 0.08), crust, { p: [0, hoodY(z) + 0.004, z], r: [-0.2, 0, 0], outline: false });
  }
  // crimped crust around the front bumper
  for (let i = 0; i < 7; i++) kit.add(C, G.sph(0.06, 8, 6), crustDark, { p: [-0.48 + i * 0.16, 0.47, 1.06], outline: false });
  // blueberries peeking through the lattice + on the side pods
  const berry = toon(BERRY);
  for (const [x, z] of [[-0.11, 0.37], [0.11, 0.6], [-0.11, 0.6], [0.11, 0.37]]) kit.add(C, G.sph(0.065, 8, 6), berry, { p: [x, hoodY(z) + 0.01, z], outline: false });
  for (const sd of [-1, 1]) {
    for (const [y, z] of [[0.5, 0.18], [0.44, -0.06], [0.52, -0.2]]) kit.add(C, G.sph(0.075, 8, 6), berry, { p: [sd * 0.78, y, z] });
  }
  // a little friendly ghost-pal spoiler (Boo's plushie buddy, waving hello)
  const flag = part(C, [0, 1.12, -1.02]);
  const sheet = toon(WHITE);
  kit.add(flag, G.sph(0.3, 14, 10), sheet, { p: [0, 0.06, 0], s: [1.25, 1, 0.55] });
  kit.add(flag, G.cyl(0.37, 0.4, 0.22, 14, 1), sheet, { p: [0, -0.1, 0], s: [1, 1, 0.55] });
  for (let i = 0; i < 5; i++) kit.add(flag, G.sph(0.085, 8, 6), sheet, { p: [-0.32 + i * 0.16, -0.21, 0], s: [1, 0.8, 0.55], outline: false });
  for (const sd of [-1, 1]) {
    kit.add(flag, G.sph(0.035, 6, 5), toon(BERRY_DARK), { p: [sd * 0.1, 0.08, -0.16], s: [1, 1.3, 0.5], outline: false });
    kit.add(flag, G.sph(0.03, 6, 5), toon(0xff9ad0), { p: [sd * 0.18, 0.0, -0.15], s: [1.3, 0.8, 0.4], outline: false });
    kit.add(flag, G.sph(0.07, 8, 6), sheet, { p: [sd * 0.42, -0.02, 0], s: [1, 0.7, 0.6] });
  }
  kit.add(flag, G.tor(0.035, 0.01, 4, 8, Math.PI), toon(BERRY_DARK), { p: [0, 0.01, -0.165], r: [0, Math.PI, Math.PI], outline: false });
  for (const sd of [-1, 1]) kit.add(C, G.cyl(0.03, 0.03, 0.5, 6), crust, { p: [sd * 0.3, 0.75, -0.98] });

  // ── Boo: the body IS the berry (the head), with a wispy ghost tail ──
  const D = rig.driver;
  rig.bounce = 0.4;
  const H = part(D, [0, 1.38, 0]);
  rig.head = H;
  rig.headLag = 1.3;
  const R = 0.52;
  // two versions of her berry body: solid and blushing see-through
  const solid = part(H, [0, 0, 0]);
  const ghosty = part(H, [0, 0, 0]);
  ghosty.visible = false;
  solid.name = 'boo-berry:solid';
  ghosty.name = 'boo-berry:see-through';
  const seeThrough = toon(BERRY, { transparent: true, opacity: 0.42, emissive: 0xff8fc8, emissiveIntensity: 0.35 });
  const seeTail = toon(0xc8d2ff, { transparent: true, opacity: 0.35 });
  const berryBody = (target, mat, tailMat) => {
    kit.add(target, G.sph(R, 20, 14), mat, { s: [1, 0.96, 0.98], outline: target === solid });
    // ghost tail: tapers down into the seat with three soft wisps
    kit.add(target, G.cyl(R * 0.82, R * 0.42, 0.42, 16, 1), tailMat, { p: [0, -0.46, -0.04], outline: target === solid });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      kit.add(target, G.sph(0.11, 8, 6), tailMat, { p: [Math.cos(a) * 0.19, -0.7, Math.sin(a) * 0.17 - 0.04], outline: false });
    }
  };
  berryBody(solid, berry, toon(0xdde3ff));
  berryBody(ghosty, seeThrough, seeTail);
  // frosty bloom highlight
  kit.add(solid, G.sph(0.12, 8, 6), toon(BLOOM), { f: surf(R, -0.45, 0.45, 0.99), s: [1.6, 1, 0.3], outline: false });
  kit.add(solid, G.sph(0.05, 6, 5), glow(WHITE), { f: surf(R, -0.5, 0.52, 1.0), s: [1.4, 1, 0.4], outline: false });
  // the blueberry crown (calyx) on top
  const calyx = toon(BERRY_DARK);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    kit.add(H, G.cone(0.07, 0.16, 5), calyx, { p: [Math.cos(a) * 0.1, R * 0.95, Math.sin(a) * 0.1], r: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9] });
  }
  kit.add(H, G.cyl(0.08, 0.1, 0.06, 8), calyx, { p: [0, R * 0.95, 0], outline: false });
  // a tiny leaf, worn like a bow
  kit.add(H, G.sph(0.1, 8, 6), toon(0x7ad98f), { p: [0.15, R * 0.98, -0.06], r: [0, 0.4, -0.5], s: [1, 0.25, 0.55] });

  addFace(kit, rig, R, {
    eyeColor: 0x2a2f7a, eyeU: 0.3, eyeV: -0.02, eyeW: 0.19, eyeH: 0.27, lashes: true,
    cheek: 0xff9ad0, cheekU: 0.55, cheekV: -0.28, mouth: 'tiny', mouthV: -0.38, mouthW: 0.08,
    brows: { color: BERRY_DARK, v: 0.33, u: 0.3, angle: 0.35, w: 0.03 },
  });
  // extra-big blush that glows when she's flustered
  const blush = part(H, [0, 0, 0]);
  blush.name = 'boo-berry:blush';
  for (const sd of [-1, 1]) {
    kit.add(blush, G.sph(1, 10, 6), glow(0xff8fc8), { f: surf(R, 0.55 * sd, -0.26, 1.0), s: [0.1, 0.06, 0.03], outline: false });
  }
  blush.scale.setScalar(0.001);

  // little ghostly arms reaching for the wheel (shy hands up by her face when she's bashful)
  const armMat = toon(0xdde3ff);
  const arms = [];
  for (const sd of [-1, 1]) {
    const arm = part(D, [sd * 0.32, 1.08, 0.12]);
    limb(kit, arm, [0, 0, 0], [-sd * 0.18, -0.14, 0.46], 0.07, armMat);
    kit.add(arm, G.sph(0.09, 8, 6), armMat, { p: [-sd * 0.18, -0.14, 0.48] });
    arms.push([arm, sd]);
  }

  let fluster = 0;
  rig.anims.push((t, dt, st, s) => {
    // float up and down over the seat
    H.position.y = 1.38 + Math.sin(t * 2.4) * 0.05 + (st.happy ? Math.abs(Math.sin(t * 6)) * 0.12 : 0);
    // bonked or celebrating: blush see-through (eases in, eases out)
    const want = st.spinning || st.happy ? 1 : 0;
    fluster += (want - fluster) * Math.min(1, dt * 6 + 0.01);
    const see = fluster > 0.5;
    solid.visible = !see;
    ghosty.visible = see;
    blush.scale.setScalar(0.001 + fluster);
    // hands go shyly up to her cheeks while flustered, otherwise on the wheel
    for (const [arm, sd] of arms) {
      arm.rotation.x = -fluster * 0.9 + Math.sin(t * 2.4 + sd) * 0.04;
      arm.rotation.z = sd * fluster * 0.25;
    }
    // stretch into a speedy teardrop on boosts
    const k = st.boosting ? 1 : 0;
    solid.scale.set(1 - k * 0.06, 1 + k * 0.08, 1 - k * 0.04);
    ghosty.scale.copy(solid.scale);
    flag.rotation.z = Math.sin(t * 5) * 0.08 * (0.3 + st.speedF);
    flag.position.y = 1.12 + Math.sin(t * 2.4 + 1) * 0.03;
  });
}

export default { def, build };
