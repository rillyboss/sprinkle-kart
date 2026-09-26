import * as THREE from 'three';
import { TUNING as T, statsToPhysics } from './tuning.js';

/**
 * Kart state + arcade physics. Everything here is pure simulation (no
 * rendering) so it can be unit-tested headless.
 *
 * Model: the kart keeps a world XZ velocity. Each step the velocity is split
 * into forward/sideways parts relative to the heading; sideways speed is
 * scrubbed by grip (and mostly converted back into forward speed), which
 * gives responsive turning normally and a lovely slide while drifting.
 */

export const NEUTRAL_INPUT = Object.freeze({
  steer: 0, accel: 0, brake: 0, drift: false, useItem: false, lookBack: false,
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * Squared XZ distance from point (x, z) to the path the kart travelled this
 * frame (from kart.phys.frameStartX/Z to its current position), so fast karts
 * on slow frames cannot skip past gumdrops or item boxes.
 */
export function sweptDistSq(kart, x, z) {
  const bx = kart.position.x, bz = kart.position.z;
  const ax = kart.phys?.frameStartX ?? bx, az = kart.phys?.frameStartZ ?? bz;
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / len2 : 1;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - x, pz = az + dz * t - z;
  return px * px + pz * pz;
}

/** Facing more than ~110° away from the racing direction counts as backwards. */
export const WRONG_WAY_ALONG = -0.35;

/**
 * Should the friendly "turn around" hint show? Moving backwards for 1 s, or
 * pointing backwards for 1.5 s even while stalled (e.g. nose-to-nose at a wall).
 * @param {number} backwardsTime seconds the kart has faced the wrong way
 * @param {number} speed forward speed
 */
export function isWrongWay(backwardsTime, speed) {
  return backwardsTime > 1.5 || (backwardsTime > 1 && Math.abs(speed) > 3);
}

/**
 * Build a fresh KartState (see ARCHITECTURE.md) positioned on the grid.
 */
export function createKart({ id, participant, charDef, speedClass, lapsTotal, path, gridS, gridLat }) {
  const phys = statsToPhysics(charDef?.stats, speedClass);
  const s = path.wrap(gridS);
  const position = path.positionAt(s, gridLat);
  const heading = path.headingAt(s);
  const isCPU = participant.playerIndex === null || participant.playerIndex === undefined;
  return {
    id,
    characterId: participant.characterId,
    playerIndex: isCPU ? null : participant.playerIndex,
    isCPU,
    easyDrive: !!participant.easyDrive,
    name: charDef?.name ?? prettyName(participant.characterId),
    charDef: charDef ?? null,
    position,
    heading,
    speed: 0,
    velocity: new THREE.Vector3(),
    s,
    lateral: gridLat,
    lap: 1,
    lapsTotal,
    distance: path.delta(0, s), // unwrapped distance travelled since the line (negative on the grid)
    progress: path.delta(0, s),
    place: 0,
    finished: false,
    finishTime: null,
    finishPlace: null,
    lapTimes: [],
    item: null,
    itemCharges: 0,
    itemRoulette: 0,
    boosting: false,
    spinning: false,
    shielded: false,
    drifting: false,
    driftLevel: 0,
    driftDir: 0,
    starPower: 0,
    offRoad: false,
    wrongWay: false,
    aiSpeedMult: 1,
    stats: phys,
    model: null,
    // Internal simulation state
    phys: {
      boostTime: 0,
      spinTime: 0,
      spinAngle: 0,
      shieldTime: 0,
      hopTime: 0,
      hopY: 0,
      driftWindow: 0,
      driftHeld: false,
      driftCharge: 0,
      driftTime: 0, // seconds since the current drift started
      slide: 0, // 0 = full grip .. 1 = full drift slide (eases in / out)
      slideDir: 0, // direction of the drift that is easing out
      hopLen: T.hopDuration, // duration of the current hop (low gravity = floatier)
      steerSmoothed: 0,
      throttle: 0, // the accel actually applied last step (0..1, for engine sounds)
      braking: false,
      reversing: false,
      groundY: position.y,
      pitch: 0,
      roll: 0,
      onPad: -1,
      wallCooldown: 0,
      wrongWayTime: 0,
      rouletteTime: 0,
      pendingItem: null,
      lastLapStart: 0,
      accelPressedAt: null,
      prevAccel: false,
      bumpCooldowns: new Map(),
    },
  };
}

function prettyName(id = 'racer') {
  return String(id).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Give a kart a speed boost for `seconds` (keeps the longer of current/new). */
export function giveBoost(kart, seconds) {
  kart.phys.boostTime = Math.max(kart.phys.boostTime, seconds);
  kart.boosting = true;
}

/**
 * Bonk a kart into a happy twirl. Returns 'bonked' | 'blocked' | 'immune'.
 * Star power makes you immune; a bubble shield pops instead.
 */
export function bonkKart(kart) {
  if (kart.starPower > 0) return 'immune';
  if (kart.phys.spinTime > 0) return 'immune';
  if (kart.shielded) {
    kart.shielded = false;
    kart.phys.shieldTime = 0;
    return 'blocked';
  }
  kart.phys.spinTime = T.spinDuration;
  kart.spinning = true;
  kart.velocity.multiplyScalar(T.bonkSpeedKeep);
  kart.speed *= T.bonkSpeedKeep;
  cancelDrift(kart);
  return 'bonked';
}

function cancelDrift(kart) {
  kart.drifting = false;
  kart.driftLevel = 0;
  kart.driftDir = 0;
  kart.phys.driftCharge = 0;
  kart.phys.driftTime = 0;
}

const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * How far into the full drift slide a kart is `t` seconds after the drift
 * started (0..1, smooth, no snap). Grip blends by this, drift yaw by its
 * square (so the first ~0.2 s turn no harder than normal steering).
 */
export function driftBlend(t, easeIn = T.driftEaseIn) {
  return smoothstep(easeIn > 0 ? t / easeIn : 1);
}

/**
 * Drift yaw multiplier (x turnRate x handling) for a steer value relative to
 * the drift direction: `into` 0 = pushing out (wide, forgiving arc), 0.5 =
 * neutral, 1 = pulling in (tight arc). Never turns against the drift.
 */
export function driftTurnFactor(into) {
  return T.driftTurnBase + T.driftTurnRange * clamp(into, 0, 1);
}

/** Mini-turbo charge gained per second while drifting (`into` as above). */
export function driftChargeRate(into) {
  return T.driftCharge[0] + T.driftCharge[1] * clamp(into, 0, 1);
}

/** Drift level (0..3) for a charge amount. */
export function driftLevelFor(charge) {
  let lvl = 0;
  for (let i = 0; i < T.driftLevels.length; i++) if (charge >= T.driftLevels[i]) lvl = i + 1;
  return lvl;
}

/**
 * Hop shape for a track's gameplay modifiers: low gravity = longer, floatier
 * hops; hopBoost = higher. Returns { duration, height }.
 */
export function hopShape(gameplay) {
  const g = clamp(gameplay?.gravity ?? 1, 0.2, 2);
  const boost = clamp(gameplay?.hopBoost ?? 1, 0.5, 3);
  return { duration: T.hopDuration / Math.sqrt(g), height: T.hopHeight * boost };
}

/** Effective top speed for a kart right now. */
export function currentMaxSpeed(kart) {
  const p = kart.phys;
  let max = kart.stats.maxSpeed * (kart.isCPU ? kart.aiSpeedMult : 1);
  if (kart.starPower > 0) max *= T.starMult;
  if (p.boostTime > 0) return max * T.boostMult;
  if (kart.offRoad && kart.starPower <= 0) max *= kart.easyDrive ? T.offRoadMultEasy : T.offRoadMult;
  return max;
}

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();

/**
 * Advance one kart by `dt` (a small sub-step).
 * @param {object} kart KartState
 * @param {object} input DriveInput
 * @param {{path, boostPads, emit}} env
 * @param {number} dt
 */
export function stepKart(kart, input, env, dt) {
  const p = kart.phys;
  const path = env.path;
  const emit = env.emit || (() => {});

  // ---- timers -------------------------------------------------------------
  if (p.boostTime > 0) p.boostTime = Math.max(0, p.boostTime - dt);
  if (kart.starPower > 0) kart.starPower = Math.max(0, kart.starPower - dt);
  if (p.shieldTime > 0) {
    p.shieldTime = Math.max(0, p.shieldTime - dt);
    if (p.shieldTime === 0 && kart.shielded) {
      kart.shielded = false;
      emit({ type: 'shield-pop', kart, expired: true });
    }
  }
  if (p.wallCooldown > 0) p.wallCooldown -= dt;
  if (p.spinTime > 0) {
    p.spinTime = Math.max(0, p.spinTime - dt);
    const t = 1 - p.spinTime / T.spinDuration;
    const ease = 1 - Math.pow(1 - t, 3);
    p.spinAngle = ease * Math.PI * 2 * T.twirlTurns;
    if (p.spinTime === 0) p.spinAngle = 0;
  }
  kart.spinning = p.spinTime > 0;

  let steer = clamp(input.steer || 0, -1, 1);
  let accel = clamp(input.accel || 0, 0, 1);
  let brake = clamp(input.brake || 0, 0, 1);
  const driftBtn = !!input.drift;
  if (kart.spinning) { steer = 0; accel = 0; brake = 0; }

  const max = currentMaxSpeed(kart);
  const boosting = p.boostTime > 0;
  kart.boosting = boosting;

  // ---- decompose velocity -------------------------------------------------
  let h = kart.heading;
  let fx = Math.sin(h), fz = Math.cos(h);
  let rx = -fz, rz = fx; // right = (-tz, 0, tx)
  const v = kart.velocity;
  let f = v.x * fx + v.z * fz;
  let side = v.x * rx + v.z * rz;

  // ---- throttle / brake ---------------------------------------------------
  p.braking = false;
  if (boosting) {
    f = Math.max(f, 0);
    if (f < max) f = Math.min(max, f + T.boostAccel * dt);
    p.throttle = 1;
  } else if (accel > 0 && brake < 0.5) {
    if (f < 0) f += T.brakeDecel * dt;
    const frac = clamp(f / Math.max(1, max), 0, 1);
    f += kart.stats.accel * accel * (1 - T.accelCurve * frac) * dt;
    p.throttle = accel;
  } else if (brake > 0) {
    if (f > 0.5) {
      f = Math.max(0, f - T.brakeDecel * brake * dt);
      p.braking = true;
    } else f = Math.max(-T.reverseMax, f - T.reverseAccel * brake * dt);
    p.throttle = 0;
  } else {
    const c = T.coastDecel * dt;
    f = Math.abs(f) <= c ? 0 : f - Math.sign(f) * c;
    p.throttle = 0;
  }
  if (f > max) f = Math.max(max, f - (kart.offRoad ? T.offRoadDecel : T.overSpeedDecel) * dt);
  p.reversing = f < -0.5;

  // ---- hop + drift --------------------------------------------------------
  if (p.hopTime > 0) {
    const hop = hopShape(env.gameplay);
    p.hopTime = Math.max(0, p.hopTime - dt);
    p.hopY = Math.sin(Math.PI * (1 - p.hopTime / p.hopLen)) * hop.height;
    if (p.hopTime === 0) {
      p.hopY = 0;
      emit({ type: 'land', kart, strength: 0.35 + 0.1 * (kart.drifting ? 1 : 0) });
    }
  } else {
    p.hopY = 0;
  }
  if (p.driftWindow > 0) p.driftWindow -= dt;

  const pressed = driftBtn && !p.driftHeld;
  p.driftHeld = driftBtn;
  if (pressed && !kart.spinning && p.hopTime <= 0 && f > T.driftMinSpeed * 0.8) {
    const hop = hopShape(env.gameplay);
    p.hopTime = p.hopLen = hop.duration;
    p.driftWindow = hop.duration + T.driftStartWindow;
    emit({ type: 'hop', kart });
  }
  if (!kart.drifting && driftBtn && p.driftWindow > 0 && Math.abs(steer) > T.driftSteerStart && f > T.driftMinSpeed * 0.8) {
    kart.drifting = true;
    kart.driftDir = Math.sign(steer);
    kart.driftLevel = 0;
    p.driftCharge = 0;
    p.driftTime = 0;
    emit({ type: 'drift-start', kart, dir: kart.driftDir });
  }
  if (kart.drifting) {
    if (kart.spinning || f < T.driftMinSpeed * 0.6) {
      cancelDrift(kart);
    } else if (!driftBtn) {
      const lvl = kart.driftLevel;
      cancelDrift(kart);
      if (lvl > 0) {
        giveBoost(kart, T.miniTurbo[lvl]);
        emit({ type: 'drift-boost', kart, level: lvl });
      }
    } else {
      p.driftTime += dt;
      const into = (steer * kart.driftDir + 1) / 2; // 0 = steering out, 1 = steering in
      p.driftCharge += dt * driftChargeRate(into);
      const lvl = driftLevelFor(p.driftCharge);
      if (lvl > kart.driftLevel) {
        kart.driftLevel = lvl;
        emit({ type: 'drift-level', kart, level: lvl });
      }
    }
  }
  // Slide amount: eases in over driftEaseIn, back to full grip over driftEaseOut.
  const blend = kart.drifting ? driftBlend(p.driftTime) : 0;
  p.slide = kart.drifting ? blend : Math.max(0, p.slide - dt / Math.max(1e-3, T.driftEaseOut));

  // ---- steering -----------------------------------------------------------
  p.steerSmoothed += (steer - p.steerSmoothed) * Math.min(1, dt * T.steerSmoothing);
  const absF = Math.abs(f);
  const lowSpeed = clamp(absF / T.turnFullSpeed, 0, 1);
  const speedFactor = lowSpeed * (1 - T.highSpeedTurnDamp * clamp(absF / (kart.stats.maxSpeed * T.boostMult), 0, 1));
  let yaw = p.steerSmoothed * T.turnRate * kart.stats.handling * speedFactor * (kart.easyDrive ? T.kidAssistTurn : 1);
  if (kart.drifting) p.slideDir = kart.driftDir;
  const arcDir = kart.drifting ? kart.driftDir : p.slide > 0 ? p.slideDir || 0 : 0;
  if (arcDir !== 0) {
    // Blend from normal steering into the drift arc (entry: blend^2, so no
    // kick) and back out again as grip returns (exit: no snap either).
    const into = (p.steerSmoothed * arcDir + 1) / 2;
    const driftYaw = arcDir * T.turnRate * kart.stats.handling * lowSpeed * driftTurnFactor(into);
    const w = kart.drifting ? blend * blend : p.slide * p.slide;
    yaw += (driftYaw - yaw) * w;
  }
  if (f < -0.5) yaw = -yaw; // reversing steers like a real car
  if (kart.spinning) yaw = 0;

  // Re-compose world velocity, rotate heading, re-decompose (inertia -> slide).
  let vx = fx * f + rx * side;
  let vz = fz * f + rz * side;
  h = wrapAngle(h - yaw * dt); // steer right (+) turns toward `right` => heading decreases
  fx = Math.sin(h); fz = Math.cos(h);
  rx = -fz; rz = fx;
  let f2 = vx * fx + vz * fz;
  let s2 = vx * rx + vz * rz;
  const grip = kart.spinning ? 3 : T.grip + (T.driftGrip - T.grip) * p.slide;
  const transfer = T.gripTransfer + (T.driftGripTransfer - T.gripTransfer) * p.slide;
  let newSide = s2 * Math.exp(-grip * dt);
  if (f2 > 0.5) {
    // Scrubbed sideways speed flows back into forward speed, but never
    // more than the kart already had (no free energy from wiggling).
    const conserved = Math.sqrt(Math.max(0, f2 * f2 + s2 * s2 - newSide * newSide));
    f2 += (conserved - f2) * transfer;
  }
  const hardMax = Math.max(max, kart.stats.maxSpeed * T.boostMult * T.starMult);
  f2 = clamp(f2, -T.reverseMax - 2, hardMax);
  // A slide never adds free speed: the total (forward + sideways) speed is
  // eased back to the current top speed, like the forward part above.
  if (f2 > 0.5 && p.slide > 0) {
    const tot = Math.hypot(f2, newSide);
    if (tot > max) {
      const k = Math.max(max, tot - T.overSpeedDecel * dt) / tot;
      f2 *= k;
      newSide *= k;
    }
  }
  vx = fx * f2 + rx * newSide;
  vz = fz * f2 + rz * newSide;
  kart.heading = h;
  kart.speed = f2;
  v.set(vx, 0, vz);

  // ---- integrate ----------------------------------------------------------
  kart.position.x += vx * dt;
  kart.position.z += vz * dt;

  constrainToTrack(kart, env, dt);

  // Wrong-way detection (for a friendly HUD hint).
  const tan = path.tangentAt(kart.s, _r);
  const along = fx * tan.x + fz * tan.z;
  p.wrongWayTime = along < WRONG_WAY_ALONG ? p.wrongWayTime + dt : 0;
  kart.wrongWay = isWrongWay(p.wrongWayTime, f2);

  // Boost pads
  if (env.boostPads) {
    let on = -1;
    for (let i = 0; i < env.boostPads.length; i++) {
      const pad = env.boostPads[i];
      if (Math.abs(path.delta(pad.s, kart.s)) < pad.length / 2 && Math.abs(kart.lateral - pad.lateral) < pad.halfWidth) {
        on = i;
        break;
      }
    }
    if (on >= 0 && p.onPad !== on) {
      giveBoost(kart, T.padBoost);
      emit({ type: 'boost', kart, source: 'pad' });
    }
    p.onPad = on;
  }
}

/**
 * Keep a kart on the road: update s / lateral / height, apply the soft wall.
 * Exported so the race can re-apply it after kart-kart bumps.
 */
export function constrainToTrack(kart, env, dt) {
  const path = env.path;
  const p = kart.phys;
  const pr = path.project(kart.position, kart.s);
  kart.distance += path.delta(kart.s, pr.s);
  kart.s = pr.s;
  kart.lateral = pr.lateral;

  const soft = path.halfWidth + T.wallMargin - T.kartHalfWidth;
  const absLat = Math.abs(pr.lateral);
  if (absLat > soft) {
    const sideSign = Math.sign(pr.lateral);
    const pen = absLat - soft;
    let newPen = pen * Math.exp(-T.wallSpring * dt);
    if (newPen > T.wallHardExtra) newPen = T.wallHardExtra;
    const r = path.rightAt(pr.s, _r);
    const move = (newPen - pen) * sideSign; // negative => inward
    kart.position.x += r.x * move;
    kart.position.z += r.z * move;
    kart.lateral = sideSign * (soft + newPen);

    // Remove the outward velocity (with a tiny friendly bounce).
    const v = kart.velocity;
    const out = (v.x * r.x + v.z * r.z) * sideSign;
    if (out > 0) {
      const k = out * (1 + T.wallBounce);
      v.x -= r.x * sideSign * k;
      v.z -= r.z * sideSign * k;
      if (!kart.easyDrive && out > 5 && p.wallCooldown <= 0) {
        const loss = Math.min(T.wallSpeedLoss, (out / Math.max(10, kart.stats.maxSpeed)) * 0.5);
        v.multiplyScalar(1 - loss);
      }
      if (out > 5 && p.wallCooldown <= 0) {
        p.wallCooldown = 0.45;
        env.emit?.({ type: 'bump', kart, wall: true, strength: Math.min(1, out / 20) });
      }
    }

    // Redirect the nose along the wall so nobody gets stuck facing it.
    const fx = Math.sin(kart.heading), fz = Math.cos(kart.heading);
    const facingOut = (fx * r.x + fz * r.z) * sideSign;
    if (facingOut > 0.05) {
      const th = path.headingAt(pr.s);
      const fwdDiff = wrapAngle(th - kart.heading);
      const backDiff = wrapAngle(th + Math.PI - kart.heading);
      const reversing = kart.speed < -0.5;
      const target = reversing ? backDiff : (Math.abs(fwdDiff) <= Math.abs(backDiff) + 0.6 ? fwdDiff : backDiff);
      const rate = T.wallTurn * (kart.easyDrive ? 1.8 : 1) * dt * (0.5 + facingOut);
      kart.heading = wrapAngle(kart.heading + clamp(target, -rate, rate));
    }
  }
  kart.offRoad = Math.abs(kart.lateral) > path.halfWidth + 0.4;

  // Height with smoothing (+ hop), and slope pitch for the model.
  p.groundY += (pr.height - p.groundY) * Math.min(1, dt * T.heightSmoothing);
  kart.position.y = p.groundY + p.hopY;
  const hA = path.pointAt(pr.s + 2, _v).y;
  const hB = path.pointAt(pr.s - 2, _v).y;
  const tan = path.tangentAt(pr.s, _v);
  const along = Math.sin(kart.heading) * tan.x + Math.cos(kart.heading) * tan.z;
  const slope = ((hA - hB) / 4) * along;
  const targetPitch = -Math.atan(slope);
  p.pitch += (targetPitch - p.pitch) * Math.min(1, dt * T.pitchSmoothing);
  const speedFrac = clamp(Math.abs(kart.speed) / Math.max(1, kart.stats.maxSpeed), 0, 1);
  const targetRoll = -p.steerSmoothed * 0.06 * speedFrac - kart.driftDir * 0.05;
  p.roll += (targetRoll - p.roll) * Math.min(1, dt * 8);
}
