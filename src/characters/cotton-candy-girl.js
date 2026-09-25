/**
 * Cotton Candy Girl — racer module (data + look).
 * Pack: original. Built with the shared parts library (./parts.js).
 */
import { THREE, G, toon, glow, part, addFace, buildKartBase, addArms, makeHead, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'cotton-candy-girl',
  name: 'Cotton Candy Girl',
  tagline: 'Sweet, fluffy, and totally un-stop-a-FLUFF-able!',
  personality:
    'A sparkly superhero with a giant pink-and-blue cotton candy cloud for hair, who zooms along on her very own fluffy cloud kart.',
  colors: { primary: 0xff9ed8, secondary: 0x9fd8ff, accent: 0xc9a6ff, kart: 0xffffff },
  camera: { height: 0.6, lookHeight: -0.2 }, // big cloud hair: keep the road ahead in view
  stats: { speed: 4, accel: 4, handling: 3, weight: 2 },
  voice: { pitch: 1.7, style: 'giggle' },
  locked: true,
  unlock: { type: 'stat', stat: 'wins', count: 1 },
  pack: 'original',
  emoji: '🍭',
  quotes: {
    select: 'Fluffy power, ACTIVATE!',
    win: 'Sweet dreams are made of wins!',
    oops: 'Poof! Just a little fluff!',
  },
  unlockHint: 'Win a race to unlock!',
};

/** Build the kart + driver into the rig (see ./parts.js for the API). */
export function build(kit, rig, def) {
  const c = def.colors;
  const pink = c.primary;
  const blue = c.secondary;
  buildKartBase(kit, rig, { body: WHITE, trim: pink, seat: 0xffc8ea, hub: WHITE, hubStar: 0xffe45c, tire: 0xd98ac0, shell: false });
  const C = rig.chassis;
  // fluffy cloud kart
  const puffCols = [toon(WHITE), toon(0xffd3ee), toon(0xcdeeff)];
  kit.add(C, G.rbox(1.15, 0.3, 1.8, 0.14), puffCols[0], { p: [0, 0.4, 0] });
  const puffs = [
    [0, 0.55, 0.85, 0.34, 0], [-0.4, 0.5, 0.75, 0.28, 1], [0.4, 0.5, 0.75, 0.28, 2],
    [-0.6, 0.48, 0.25, 0.28, 2], [0.6, 0.48, 0.25, 0.28, 1], [-0.62, 0.5, -0.25, 0.28, 0], [0.62, 0.5, -0.25, 0.28, 0],
    [-0.45, 0.52, -0.85, 0.3, 1], [0.45, 0.52, -0.85, 0.3, 2], [0, 0.5, -0.95, 0.3, 0], [0, 0.72, 0.5, 0.26, 0],
  ];
  for (const [x, y, z, r, ci] of puffs) kit.add(C, G.ico(r, 1), puffCols[ci], { p: [x, y, z] });
  // pastel rainbow spoiler
  const rb = [0xff8fb8, 0xffc36b, 0xfff07a, 0x8ee8a0, 0x8fd0ff];
  rb.forEach((col, i) => kit.add(C, G.tor(0.62 - i * 0.07, 0.036, 5, 18, Math.PI), toon(col), { p: [0, 0.78, -1.02], outline: i === 0 || i === rb.length - 1 }));
  for (const sd of [-1, 1]) kit.add(C, G.ico(0.16, 1), puffCols[0], { p: [sd * 0.52, 0.78, -1.02] });

  const D = rig.driver;
  kit.add(D, G.sph(0.3), toon(c.accent), { p: [0, 0.96, 0], s: [1, 1, 0.85] });
  kit.add(D, G.cyl(0.28, 0.5, 0.3, 16), toon(pink), { p: [0, 0.74, 0.02] });
  kit.add(D, G.star(0.1, 0.04), glow(0xffe45c), { p: [0, 1.02, 0.26], outline: false });
  // sparkly cape
  const cape = new THREE.ConeGeometry(0.55, 0.85, 14, 1, true, Math.PI / 2, Math.PI);
  kit.add(D, cape, toon(0xb48cff, { side: THREE.DoubleSide }), { p: [0, 0.85, -0.1], outline: false });
  for (const [x, y] of [[-0.2, 0.7], [0.25, 0.62], [0.05, 0.9], [-0.35, 0.52], [0.38, 0.48]]) {
    kit.add(D, G.star(0.04, 0.02), glow(WHITE), { p: [x, y, -0.1 - Math.sqrt(Math.max(0.3 - x * x, 0.01)) * 0.72], r: [0, Math.PI, 0], outline: false });
  }
  addArms(kit, rig, 0xffe4d6, WHITE, { r: 0.065, handR: 0.095 });

  const R = 0.44;
  const H = makeHead(rig, 1.56);
  kit.add(H, G.sph(R, 18, 12), toon(0xffe4d6));
  // the HUGE fluffy cotton candy cloud hair
  const hair = part(H, [0, 0, 0]);
  const hp = toon(0xffa6dc);
  const hb = toon(0xa6dcff);
  const hairPuffs = [
    [0, 0.48, -0.05, 0.36, hp], [-0.32, 0.42, 0.02, 0.28, hb], [0.32, 0.42, 0.02, 0.28, hb],
    [0, 0.62, -0.32, 0.32, hb], [-0.22, 0.74, 0.02, 0.24, hp], [0.22, 0.74, 0.02, 0.24, hp], [0, 0.9, -0.12, 0.25, hb],
    [-0.47, 0.14, -0.1, 0.26, hp], [0.47, 0.14, -0.1, 0.26, hp], [-0.52, -0.16, -0.16, 0.23, hb], [0.52, -0.16, -0.16, 0.23, hb],
    [-0.42, -0.4, -0.22, 0.19, hp], [0.42, -0.4, -0.22, 0.19, hp], [0, 0.12, -0.4, 0.4, hp], [0, -0.28, -0.36, 0.3, hb],
    [-0.4, 0.55, -0.3, 0.24, hp], [0.4, 0.55, -0.3, 0.24, hp],
  ];
  for (const [x, y, z, r, m] of hairPuffs) kit.add(hair, G.ico(r, 1), m, { p: [x, y, z] });
  for (const [x, y, z, r, m] of [[-0.2, 0.33, 0.29, 0.14, hp], [0.04, 0.37, 0.32, 0.13, hb], [0.26, 0.31, 0.28, 0.13, hp]]) {
    kit.add(H, G.ico(r, 1), m, { p: [x, y, z] });
  }
  kit.add(hair, G.star(0.1, 0.04), glow(0xffe45c), { p: [0.34, 0.38, 0.27], r: [0, 0.5, 0.2], outline: false });
  addFace(kit, rig, R, { eyeColor: 0xd9438f, lashes: true, mouth: 'grin', mouthV: -0.4, mouthW: 0.1, cheek: 0xff7aa8 });

  // cotton-candy cone wand
  const wand = part(D, [0.14, 0.93, 0.6]);
  wand.rotation.z = -0.62;
  kit.add(wand, G.cone(0.075, 0.34, 10), toon(0xe8b36a), { p: [0, 0.2, 0], r: [Math.PI, 0, 0] });
  kit.add(wand, G.ico(0.14, 1), hp, { p: [0, 0.42, 0] });
  kit.add(wand, G.ico(0.09, 1), hb, { p: [0.07, 0.5, 0.04] });
  const wandStar = part(wand, [0, 0.62, 0]);
  kit.add(wandStar, G.star(0.08, 0.03), glow(0xffe45c), { outline: false });

  // twinkly sparkles that float around her
  const sparkles = part(D, [0, 1.5, 0]);
  const sparkleCols = [0xffffff, 0xffe45c, 0xff9ed8, 0x9fd8ff];
  const bits = [];
  sparkleCols.forEach((col, i) => {
    const g = part(sparkles, [0, 0, 0]);
    kit.add(g, G.star(0.06, 0.02), glow(col), { outline: false });
    bits.push(g);
  });
  rig.anims.push((t, dt, st) => {
    const b = Math.sin(t * 3) * 0.025;
    hair.scale.set(1 + b, 1 - b * 0.6, 1 + b);
    wandStar.rotation.z = t * 3;
    wand.rotation.x = Math.sin(t * 2.4) * 0.12;
    wand.rotation.z = -0.62 + Math.sin(t * 1.7) * 0.08;
    for (let i = 0; i < bits.length; i++) {
      const a = t * 0.9 + (i / bits.length) * TAU;
      bits[i].position.set(Math.cos(a) * 0.95, Math.sin(t * 2 + i * 1.7) * 0.35, Math.sin(a) * 0.75);
      bits[i].scale.setScalar(0.6 + 0.5 * Math.abs(Math.sin(t * 4 + i)));
      bits[i].rotation.z = t * 2 + i;
    }
  });
}

export default { def, build };
