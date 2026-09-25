/**
 * Captain Crumbs — racer module (data + look).
 * Pack: A. Built with the shared parts library (./parts.js).
 *
 * A jolly cookie pirate captain with a chocolate-chip beard who sails a
 * little pirate-ship kart and keeps checking the road ahead through his spyglass.
 */
import { THREE, G, toon, glow, frame, surf, limb, stick, part, addFace, addMouth, buildKartBase, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'captain-crumbs',
  name: 'Captain Crumbs',
  tagline: 'Arr-some! Full speed ahead, me hearties!',
  personality:
    'A jolly cookie pirate captain with a chocolate-chip beard who searches for treasure (usually snacks) and calls everything "Arr-some!"',
  colors: { primary: 0xd99a55, secondary: 0x2f3a78, accent: 0xe8413c, kart: 0xa8683a },
  camera: { height: 0.35, lookHeight: -0.1 }, // tall mast + captain's hat
  stats: { speed: 3, accel: 3, handling: 2, weight: 4 },
  voice: { pitch: 0.75, style: 'hoho' },
  locked: true,
  unlock: { type: 'stat', stat: 'bonksGiven', count: 20 },
  pack: 'a',
  pronoun: 'he',
  emoji: '🍪',
  quotes: {
    select: 'Arr-some! Hoist the sprinkles!',
    win: 'Yo ho ho! The treasure be friendship... and cookies!',
    oops: 'Shiver me sprinkles!',
  },
};

const COOKIE = 0xd99a55;
const COOKIE_LIGHT = 0xecc088;
const CHIP = 0x5a3420;
const COAT = 0x2f3a78;
const GOLD = 0xffcf4a;
const WOOD = 0xa8683a;
const WOOD_DARK = 0x7e4a2a;

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  // ── pirate-ship kart: wooden hull, a mast with a billowing sail ──
  buildKartBase(kit, rig, { body: WOOD, trim: WOOD_DARK, seat: 0xe8413c, hub: GOLD, bar: WOOD_DARK, tire: 0x4a3024, steer: WOOD_DARK, width: 1.36 });
  const C = rig.chassis;
  const plank = toon(WOOD_DARK);
  // hull planks along the sides + gold trim
  for (const sd of [-1, 1]) {
    for (const y of [0.36, 0.46]) kit.add(C, G.box(0.02, 0.02, 1.9), plank, { p: [sd * 0.69, y, 0], outline: false });
    kit.add(C, G.box(0.03, 0.04, 0.6), toon(GOLD), { p: [sd * 0.84, 0.58, 0.02], outline: false });
    // round porthole stickers
    for (const z of [-0.12, 0.16]) {
      kit.add(C, G.tor(0.07, 0.022, 5, 12), toon(GOLD), { p: [sd * 0.83, 0.44, z], r: [0, Math.PI / 2, 0], outline: false });
      kit.add(C, G.cyl(0.06, 0.06, 0.02, 10), glow(0xbfe9ff), { p: [sd * 0.83, 0.44, z], r: [0, 0, Math.PI / 2], outline: false });
    }
  }
  // pointy prow with a cookie figurehead
  kit.add(C, G.cone(0.34, 0.5, 4), toon(WOOD), { p: [0, 0.52, 1.14], r: [Math.PI / 2, Math.PI / 4, 0], s: [1.2, 1, 0.6] });
  kit.add(C, G.cyl(0.13, 0.13, 0.05, 14), toon(COOKIE), { p: [0, 0.82, 0.8], r: [Math.PI / 2 - 0.4, 0, 0] });
  for (const [x, y] of [[-0.05, 0.85], [0.05, 0.8], [0.02, 0.88]]) kit.add(C, G.sph(0.022, 5, 4), toon(CHIP), { p: [x, y, 0.83], outline: false });
  // mast + billowing sail (the chase cam sees the sail)
  const mastWood = toon(WOOD_DARK);
  stick(kit, C, [0, 0.6, -0.98], [0, 2.02, -0.98], 0.045, mastWood);
  stick(kit, C, [-0.46, 1.84, -0.98], [0.46, 1.84, -0.98], 0.03, mastWood);
  stick(kit, C, [-0.4, 1.02, -0.98], [0.4, 1.02, -0.98], 0.03, mastWood);
  const sail = part(C, [0, 1.43, -0.98]);
  sail.name = 'captain-crumbs:sail';
  const sailGeo = new THREE.CylinderGeometry(1, 1, 0.8, 14, 1, true, -0.5, 1.0);
  kit.add(sail, sailGeo, toon(0xfff6e4, { side: THREE.DoubleSide }), { p: [0, 0, -0.82], s: [0.7, 1, 0.9], outline: false });
  // a smiling cookie painted on the sail
  for (const sd of [-1, 1]) {
    const z = sd > 0 ? 0.085 : -0.015;
    kit.add(sail, G.cyl(0.2, 0.2, 0.02, 16), toon(COOKIE), { p: [0, 0.02, z], r: [Math.PI / 2, 0, 0], outline: false });
    for (const [x, y] of [[-0.08, 0.1], [0.09, 0.07], [0.0, -0.08], [-0.1, -0.05], [0.1, -0.09], [0.01, 0.04]]) {
      kit.add(sail, G.sph(0.03, 5, 4), toon(CHIP), { p: [x, 0.02 + y, z + sd * 0.015], outline: false });
    }
  }
  // pennant flag on top
  const pennant = part(C, [0, 2.0, -0.98]);
  kit.add(pennant, G.cone(0.08, 0.34, 4), toon(0xff7ab8), { p: [0, 0, -0.17], r: [-Math.PI / 2, 0, 0], s: [1, 1, 0.25] });
  kit.add(C, G.sph(0.05, 6, 5), toon(GOLD), { p: [0, 2.05, -0.98] });

  // ── the captain ──
  const D = rig.driver;
  D.scale.setScalar(1.04);
  const coat = toon(COAT);
  kit.add(D, G.sph(0.36), coat, { p: [0, 0.93, 0], s: [1.05, 0.95, 0.92] });
  kit.add(D, G.cyl(0.3, 0.4, 0.3, 14), coat, { p: [0, 0.72, 0.0] });
  // red sash + gold buttons + belt buckle
  kit.add(D, G.tor(0.34, 0.05, 5, 18), toon(c.accent), { p: [0, 0.84, 0], r: [Math.PI / 2 + 0.25, 0, 0], outline: false });
  kit.add(D, G.rbox(0.12, 0.1, 0.04, 0.02), toon(GOLD), { p: [0, 0.84, 0.35], r: [-0.25, 0, 0], outline: false });
  for (const sd of [-1, 1]) for (const y of [1.08, 0.97]) kit.add(D, G.sph(0.03, 6, 5), toon(GOLD), { p: [sd * 0.12, y, 0.31], outline: false });
  // gold epaulettes
  for (const sd of [-1, 1]) {
    kit.add(D, G.cyl(0.11, 0.12, 0.05, 12), toon(GOLD), { p: [sd * 0.3, 1.16, 0], r: [0, 0, -sd * 0.4] });
  }
  // right hand on the wheel
  const cookieM = toon(COOKIE);
  limb(kit, D, [0.32, 1.08, 0.02], [0.14, 0.93, 0.6], 0.085, coat);
  kit.add(D, G.sph(0.1, 10, 8), cookieM, { p: [0.14, 0.93, 0.6] });
  // spyglass arm (driver's right = -X, the portrait side): rests on the wheel,
  // pops up to his eye to peek at the road ahead
  const SHOULDER = new THREE.Vector3(-0.32, 1.08, 0.02);
  const HAND = new THREE.Vector3(0.18, -0.15, 0.58); // relative to the shoulder
  const spyArm = part(D, SHOULDER.toArray());
  spyArm.name = 'captain-crumbs:spyglass-arm';
  limb(kit, spyArm, [0, 0, 0], HAND.toArray(), 0.085, coat);
  kit.add(spyArm, G.sph(0.1, 10, 8), cookieM, { p: HAND.toArray() });
  const spy = part(spyArm, HAND.toArray());
  spy.name = 'captain-crumbs:spyglass';
  const brass = toon(GOLD);
  kit.add(spy, G.cyl(0.065, 0.065, 0.2, 10), toon(WOOD_DARK), { p: [0, 0, -0.07], r: [Math.PI / 2, 0, 0] });
  kit.add(spy, G.cyl(0.05, 0.05, 0.22, 10), brass, { p: [0, 0, 0.13], r: [Math.PI / 2, 0, 0] });
  kit.add(spy, G.cyl(0.07, 0.07, 0.03, 10), brass, { p: [0, 0, 0.25], r: [Math.PI / 2, 0, 0], outline: false });
  kit.add(spy, G.cyl(0.05, 0.05, 0.01, 10), glow(0xbfe9ff), { p: [0, 0, 0.265], r: [Math.PI / 2, 0, 0], outline: false });
  kit.add(spy, G.cyl(0.06, 0.06, 0.03, 10), brass, { p: [0, 0, -0.18], r: [Math.PI / 2, 0, 0], outline: false });
  // peek pose: the hand holds the spyglass right in front of his right eye
  const PEEK_HAND = new THREE.Vector3(-0.15, 1.52, 0.66).sub(SHOULDER);
  const PEEK_Q = new THREE.Quaternion().setFromUnitVectors(HAND.clone().normalize(), PEEK_HAND.clone().normalize());
  const PEEK_S = PEEK_HAND.length() / HAND.length(); // a stretchy cartoon arm
  const PEEK_Q_INV = PEEK_Q.clone().invert();
  const ID_Q = new THREE.Quaternion();

  // ── head: a big round cookie ──
  const R = 0.45;
  const H = part(D, [0, 1.55, 0]);
  rig.head = H;
  kit.add(H, G.sph(R, 18, 12), cookieM);
  // chocolate chips dotted around the cookie head
  const chip = toon(CHIP);
  for (const [u, v] of [[0.62, 0.42], [-0.64, 0.38], [0.84, 0.05], [-0.86, 0.02]]) {
    kit.add(H, G.cone(0.04, 0.05, 6), chip, { f: surf(R, u, v, 0.99), r: [Math.PI / 2, 0, 0], outline: false });
  }
  // lighter baked crumbs around the edge
  for (const sd of [-1, 1]) kit.add(H, G.sph(0.1, 8, 6), toon(COOKIE_LIGHT), { f: surf(R, sd * 0.9, 0.1, 0.94), s: [1, 1, 0.4], outline: false });
  addFace(kit, rig, R, {
    eyeColor: 0x3a6ab0, eyeV: 0.08, eyeW: 0.19, eyeH: 0.26,
    cheek: 0xff8f8f, cheekU: 0.6, cheekV: -0.14, mouth: 'none',
    brows: { color: CHIP, v: 0.45, angle: 0.12, w: 0.045 },
  });
  // chocolate-chip beard: a chunky crescent of chocolate chips hugging his jaw
  const beard = part(H, [0, 0, 0]);
  const beardM = toon(0x6b3f25);
  // (each clump is a chunky chocolate chip)
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI * 0.85 + (i / 8) * Math.PI * 0.7; // along the lower jaw
    const u = Math.cos(a) * 0.62;
    const v = Math.sin(a) * 0.62 - 0.12;
    kit.add(beard, G.sph(0.1, 8, 6), beardM, { f: surf(R, u, v, 0.97), s: [1.1, 1.1, 0.8] });
    kit.add(beard, G.cone(0.075, 0.11, 7), beardM, { f: surf(R, u * 1.05, v - 0.08, 0.98), r: [Math.PI / 2 + 0.9, 0, 0], outline: false });
  }
  kit.add(beard, G.cone(0.12, 0.18, 7), beardM, { f: surf(R, 0, -0.78, 0.92), r: [Math.PI / 2 + 0.8, 0, 0] });
  // happy smile peeking out above the beard + a big round cookie nose
  addMouth(kit, H, surf(R, 0, -0.33, 0.985), 0.1, 'grin');
  kit.add(H, G.sph(0.075, 10, 8), toon(0xc7864a), { p: [0, -0.1, 0.45] });
  // captain's hat: navy bicorne with gold trim and a heart-cookie badge
  const hat = part(H, [0, 0.36, -0.02]);
  hat.rotation.x = -0.12;
  const hatM = toon(COAT);
  kit.add(hat, G.sph(0.4, 16, 8), hatM, { p: [0, 0.02, 0], s: [1.2, 0.55, 1.05] });
  // the big half-moon bicorne brim, worn side-to-side like a proper captain
  const brim = new THREE.CylinderGeometry(0.6, 0.6, 0.16, 18, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
  kit.add(hat, brim, hatM, { p: [0, 0.04, 0.0], s: [1, 0.72, 1] });
  kit.add(hat, G.tor(0.6, 0.03, 4, 22, Math.PI), toon(GOLD), { p: [0, 0.04, 0.085], s: [1, 0.72, 1], outline: false });
  kit.add(hat, G.tor(0.6, 0.03, 4, 22, Math.PI), toon(GOLD), { p: [0, 0.04, -0.085], s: [1, 0.72, 1], outline: false });
  kit.add(hat, G.heart(0.2, 0.05), toon(COOKIE_LIGHT), { p: [0, 0.22, 0.1] });
  for (const [x, y] of [[0.03, 0.24], [-0.04, 0.19]]) kit.add(hat, G.sph(0.025, 5, 4), toon(CHIP), { p: [x, y, 0.14], outline: false });
  // red feather plume that bobs
  const plume = part(hat, [0.36, 0.3, -0.02]);
  kit.add(plume, G.cap(0.06, 0.34, 6), toon(0xff5f8f), { p: [0.1, 0.12, -0.05], r: [0.4, 0, -0.8] });

  let peek = 0;
  rig.anims.push((t, dt, st) => {
    // spyglass: up to his eye every few seconds, and all the way on boosts
    const cyc = (t % 6) / 6;
    const idlePeek = cyc > 0.72 && cyc < 0.95 ? 1 : 0;
    const want = st.boosting ? 1 : st.spinning ? 0 : idlePeek;
    peek += (want - peek) * Math.min(1, dt * 7 + 0.01);
    spyArm.quaternion.slerpQuaternions(ID_Q, PEEK_Q, peek);
    spyArm.scale.setScalar(1 + (PEEK_S - 1) * peek);
    spy.quaternion.slerpQuaternions(ID_Q, PEEK_Q_INV, peek); // the spyglass keeps looking straight ahead
    spy.scale.setScalar(1 / spyArm.scale.x);
    // sail billows with speed, pennant flutters
    sail.scale.set(1, 1, 0.75 + 0.35 * st.speedF + Math.sin(t * 7) * 0.03 * st.speedF);
    sail.rotation.y = st.steer * 0.15;
    pennant.rotation.y = Math.sin(t * 11) * 0.3 * (0.3 + st.speedF);
    plume.rotation.z = Math.sin(t * 5) * 0.12;
    beard.rotation.x = Math.sin(t * 9) * 0.015 * st.speedF;
  });
}

export default { def, build };
