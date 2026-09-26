import * as THREE from 'three';
import {
  Kit, FX, SHADOW_MAT, TAU, WHITE, rng,
  buildKartBase, addArms, makeHead, addFace, G, toon, SKIN,
} from './parts.js';
import { CHARACTER_ENTRIES } from './index.js';
import { buildKartEffects } from '../fx/kartEffects.js';

/**
 * Kart model assembly: the rig, the per-frame animation and the effects.
 *
 *   buildKartModel(charDef) -> { group, update(dt, state), dispose(), characterId, triangles, head }
 *
 * The character's look comes from its module's `build(kit, rig, def)`
 * (looked up by id in the character registry); unknown ids get a friendly
 * generic racer painted in the def's colours.
 *
 * Hierarchy (animated nodes):
 *   group                    <- the Race moves/rotates this
 *   ├─ shadow                   soft blob shadow (never spins)
 *   └─ root                     happy-spin + drift-slide yaw
 *      ├─ chassis               bob / roll / boost pitch
 *      │  ├─ front wheel pivots (steer) → spin, rear axle (spin), steering wheel
 *      │  └─ driver             lean / bounce  → head (tilt, look) → eyes (blink)
 *      └─ effects               src/fx/: drift sparks, rainbow boost puff, shield bubble, dizzy stars
 */

function builderFor(id) {
  for (const e of CHARACTER_ENTRIES) if (e.def.id === id) return e.build;
  return null;
}

/** Fallback for unknown ids: a friendly generic racer painted in the def's colours. */
export function buildGeneric(kit, rig, def) {
  const c = def.colors || { primary: 0xff8fc8, secondary: 0x8fd3ff, accent: 0xffe45c, kart: 0xff8fc8 };
  buildKartBase(kit, rig, { body: c.kart ?? c.primary, trim: c.secondary, seat: c.secondary, hub: c.accent });
  const D = rig.driver;
  kit.add(D, G.sph(0.33), toon(c.primary), { p: [0, 0.94, 0], s: [1, 1, 0.9] });
  addArms(kit, rig, c.primary, WHITE);
  const R = 0.44;
  const H = makeHead(rig, 1.56);
  kit.add(H, G.sph(R, 18, 12), toon(SKIN));
  kit.add(H, G.sph(0.47), toon(c.secondary), { p: [0, 0.06, -0.1] });
  addFace(kit, rig, R, { mouth: 'grin', mouthV: -0.4, mouthW: 0.1 });
}

// ───────────────────────────────────────────────────────────── the model ──

const IDLE = Object.freeze({});
let seedCounter = 0;

/**
 * Build a kart + driver model for a character.
 * @param {import('../data/characters.js').CharacterDef} charDef
 * @returns {{group: THREE.Group, update: (dt:number, state?:object)=>void, dispose: ()=>void,
 *            characterId: string, triangles: number, head: THREE.Object3D}}
 *   `head` is the driver's head node (handy for framing cameras / name tags).
 */
export function buildKartModel(charDef) {
  const def = charDef || { id: 'unknown', colors: undefined };
  const group = new THREE.Group();
  group.name = `kart:${def.id}`;

  const shadow = new THREE.Mesh(FX.shadow, SHADOW_MAT);
  shadow.scale.set(0.95, 1, 1.35);
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  group.add(shadow);

  const root = new THREE.Group();
  group.add(root);
  const chassis = new THREE.Group();
  root.add(chassis);
  const driver = new THREE.Group();
  driver.position.set(0, 0, -0.3);
  chassis.add(driver);

  const rig = {
    root,
    chassis,
    driver,
    head: null,
    eyes: null,
    happyEyes: null,
    steeringWheel: null,
    frontPivots: [],
    frontSpins: [],
    rearAxle: null,
    exhausts: [],
    wheelR: [0.28, 0.33],
    anims: [],
    bounce: 1,
    headLag: 1,
    // Paint Shop (src/modes/paint.js): a repainted kart body for every racer (null = own colours).
    paint: Number.isInteger(def.paint) ? def.paint : null,
  };

  const kit = new Kit();
  (builderFor(def.id) || buildGeneric)(kit, rig, def);
  kit.bake();

  // Count the baked model's triangles (effects excluded — they are hidden most of the time).
  let triangles = 0;
  for (const g of kit.geometries) triangles += g.attributes.position.count / 3;

  const owned = { geometries: kit.geometries, materials: [] };
  const fx = buildKartEffects(rig, owned);

  // Per-kart animation state (never reallocated).
  const seed = rng(0x9e3779b1 ^ (++seedCounter * 7919));
  const st = {
    t: seed() * 10,
    steer: 0,
    speedF: 0,
    driftYaw: 0,
    spinA: 0,
    boostPitch: 0,
    shieldS: 0,
    wheelF: 0,
    wheelR: 0,
    blinkT: 1 + seed() * 3,
    blinkLeft: 0,
    phase: seed() * TAU,
    rootYaw: 0,
    drifting: false,
    boosting: false,
    spinning: false,
    happy: false,
  };

  function update(dt, state) {
    const s = state || IDLE;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    st.t += dt;
    const t = Number.isFinite(s.time) ? s.time + st.phase : st.t;
    const speed = Number.isFinite(s.speed) ? s.speed : 0;
    st.speedF = Math.min(1, Math.abs(speed) / 30);
    const k10 = 1 - Math.exp(-dt * 10);
    const k6 = 1 - Math.exp(-dt * 6);
    const steerIn = Math.max(-1, Math.min(1, s.steer || 0));
    st.steer += (steerIn - st.steer) * k10;
    st.drifting = !!s.drifting;
    st.boosting = !!s.boosting;
    st.spinning = !!s.spinning;
    st.happy = !!s.happy;

    // wheels + steering
    st.wheelF = (st.wheelF + (speed * dt) / rig.wheelR[0]) % TAU;
    st.wheelR = (st.wheelR + (speed * dt) / rig.wheelR[1]) % TAU;
    for (let i = 0; i < rig.frontPivots.length; i++) {
      rig.frontPivots[i].rotation.y = -st.steer * 0.45;
      rig.frontSpins[i].rotation.x = st.wheelF;
    }
    if (rig.rearAxle) rig.rearAxle.rotation.x = st.wheelR;
    if (rig.steeringWheel) rig.steeringWheel.rotation.z = st.steer * 1.3;

    // drift slide + happy spin
    // The physics already angles the kart into a drift (slip angle, src/race/Kart.js); the model only
    // adds a tiny extra lean-in so counter-steering never swings the nose the "wrong" way.
    const driftTarget = st.drifting ? -Math.sign(s.driftDir || 0) * 0.06 : 0;
    st.driftYaw += (driftTarget - st.driftYaw) * k6;
    if (st.spinning) {
      st.spinA += dt * 14;
    } else if (st.spinA !== 0) {
      const target = Math.ceil(st.spinA / TAU - 1e-6) * TAU;
      st.spinA = Math.min(target, st.spinA + dt * 11);
      if (target - st.spinA < 1e-3) st.spinA = 0;
    }
    st.rootYaw = st.driftYaw + st.spinA;
    rig.root.rotation.y = st.rootYaw;

    // chassis bob, roll, boost pitch
    st.boostPitch += ((st.boosting ? -0.06 : 0) - st.boostPitch) * k6;
    const vib = Math.sin(t * 41) * 0.007 * st.speedF;
    rig.chassis.position.y = Math.sin(t * 3.1) * 0.012 + vib + (st.happy ? Math.abs(Math.sin(t * 7)) * 0.12 : 0);
    rig.chassis.rotation.z = -st.steer * 0.05 * st.speedF;
    rig.chassis.rotation.x = st.boostPitch + (st.drifting ? Math.sin(t * 20) * 0.01 : 0);

    // driver lean + bounce
    const D = rig.driver;
    D.rotation.z = st.steer * (0.1 + 0.14 * st.speedF);
    D.rotation.x = st.boosting ? -0.1 : 0;
    const bounce = Math.abs(Math.sin(t * 5.2)) * 0.03 * (0.4 + st.speedF) * rig.bounce;
    D.position.y = bounce;
    const H = rig.head;
    if (H) {
      H.rotation.z = st.steer * 0.12 * rig.headLag + Math.sin(t * 1.7) * 0.03;
      H.rotation.y = -st.steer * 0.28;
      H.rotation.x = Math.sin(t * 2.3) * 0.025 + (st.boosting ? 0.08 : 0);
    }

    // eyes: blink, or happy ^ ^ while spinning / celebrating
    const happyEyes = st.spinning || st.happy;
    if (rig.eyes) {
      st.blinkT -= dt;
      if (st.blinkT <= 0) {
        st.blinkLeft = 0.13;
        st.blinkT = 2.2 + seed() * 3.5;
      }
      st.blinkLeft = Math.max(0, st.blinkLeft - dt);
      rig.eyes.visible = !happyEyes;
      rig.eyes.scale.y = st.blinkLeft > 0 ? 0.12 : 1;
      if (rig.happyEyes) rig.happyEyes.visible = happyEyes;
    }

    // effects (src/fx/kartEffects.js)
    fx.update(t, dt, s, st);

    // character wiggles: (t, dt, st = smoothed anim state, s = raw model state from the Race:
    // speed, steer, drifting, driftLevel, spinning, boosting, shielded, star, driftDir, hop, offRoad, time)
    for (let i = 0; i < rig.anims.length; i++) rig.anims[i](t, dt, st, s);
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    for (const g of owned.geometries) g.dispose();
    for (const m of owned.materials) m.dispose();
    fx.dispose();
  }

  update(0, IDLE);
  return { group, update, dispose, characterId: def.id, triangles: Math.round(triangles), head: rig.head };
}

/** Ids that have a hand-built model (anything else gets the generic racer). */
export function modelledCharacterIds() {
  return CHARACTER_ENTRIES.filter((e) => typeof e.build === 'function').map((e) => e.def.id);
}
