import * as THREE from 'three';
import { wrapAngle } from './Kart.js';
import { TUNING as T } from './tuning.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _t = new THREE.Vector3();

/** Signed heading change (radians) along the track from s over `dist`. Negative = right turn. */
export function turnAhead(path, s, dist) {
  return wrapAngle(path.headingAt(s + dist) - path.headingAt(s));
}

/**
 * Precompute a smooth racing line: a lateral offset per track position that
 * hugs the inside of upcoming bends.
 * @returns {{spacing:number, lat: Float32Array}}
 */
export function computeRacingLine(path, spacing = 3) {
  const n = Math.max(8, Math.ceil(path.length / spacing));
  const sp = path.length / n;
  const maxOff = path.halfWidth * 0.6;
  let lat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * sp;
    const dH = wrapAngle(path.headingAt(s + 22) - path.headingAt(s - 6));
    // right turn (dH < 0) => inside is the right side (+lateral)
    lat[i] = clamp(-dH * 10, -maxOff, maxOff);
  }
  // circular box blur, a few passes, for a flowing line
  const R = 4;
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += lat[(i + k + n) % n];
      out[i] = sum / (2 * R + 1);
    }
    lat = out;
  }
  return { spacing: sp, lat, length: path.length };
}

export function racingLineAt(line, s) {
  const n = line.lat.length;
  const f = ((((s % line.length) + line.length) % line.length) / line.spacing);
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const t = f - Math.floor(f);
  return line.lat[i0] * (1 - t) + line.lat[i1] * t;
}

/** Steering value (-1..1) that turns `kart` toward world point (tx, tz). */
export function steerToward(kart, tx, tz, gain = 2.4) {
  const desired = Math.atan2(tx - kart.position.x, tz - kart.position.z);
  const diff = wrapAngle(desired - kart.heading);
  // steer right (+) decreases heading
  return clamp(-diff * gain, -1, 1);
}

/**
 * How likely a CPU is to drift a bend. `spicy` (Zoomy) keeps the old eager
 * drifting; Cozy/Zippy CPUs drift rarely so non-drifting kids can keep up.
 */
export function cpuDriftChance(skill, spicy = false) {
  return spicy ? 0.25 + skill * 0.6 : 0.1 + skill * 0.4;
}

/**
 * Rubber-band speed multiplier for a CPU `gap` metres ahead (+) or behind (-)
 * of the best human. CPUs ahead are eased back quickly and firmly; CPUs behind
 * get a small catch-up nudge but never exceed the human's own speed class
 * (and stay a touch slower when they are right on the human's tail), so a
 * clean-driving child always has a real chance to win.
 */
export function rubberBandMult(baseMult, gap, strength = 1, finalLap = false) {
  let m = baseMult;
  if (gap > 0) m -= clamp(gap / 50, 0, 1) * 0.22 * strength;
  else m += clamp(-gap / 140, 0, 1) * 0.1 * strength;
  // Right behind the kid, CPUs don't bully past — extra polite on the last lap.
  const cap = gap > -30 ? (finalLap ? 0.9 : 0.95) : 1.0;
  return Math.min(m, cap);
}

/**
 * The CPU driver. One per kart; also drives humans for ?autodrive and for
 * the victory lap after finishing.
 */
export class CpuBrain {
  constructor(kart, { skill = 0.75, rng = Math.random, driftChance } = {}) {
    this.kart = kart;
    this.rng = rng;
    this.skill = clamp(skill, 0.2, 1);
    this.baseMult = 0.8 + 0.16 * this.skill;
    // Chance to drift through a given bend. Gentle by default so a child who
    // never drifts can still win; Race passes a spicier value for Zoomy.
    this.driftChance = driftChance ?? cpuDriftChance(this.skill, false);
    this.bandStrength = 1;
    this.lineFollow = 0.45 + 0.55 * this.skill;
    this.phase = rng() * Math.PI * 2;
    this.wander = (rng() - 0.5) * 5; // personal preferred lane
    this.wanderAmp = 1.5 + (1 - this.skill) * 2.5;
    this.time = 0;
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.itemHeldFor = 0;
    this.itemDelay = 1;
    this.driftPlan = null; // null = undecided for this bend, true/false once decided
    this.driftOutFor = 0;
    // countdown: skilled drivers sometimes nail the rocket start
    this.startPress = rng() < this.skill * 0.6 ? 0.25 + rng() * 0.85 : 99;
    this.avoidMemo = new WeakMap();
  }

  /** Rubber-band multiplier so families get close races. */
  rubberBand(race) {
    const k = this.kart;
    const humans = race.karts.filter((x) => !x.isCPU && !x.finished);
    let ref;
    if (humans.length) {
      ref = -Infinity;
      for (const h of humans) ref = Math.max(ref, h.distance);
    } else {
      ref = 0;
      for (const x of race.karts) ref += x.distance;
      ref /= race.karts.length;
    }
    const finalLap = k.lap >= (k.lapsTotal ?? race.lapsTotal ?? Infinity);
    return rubberBandMult(this.baseMult, k.distance - ref, this.bandStrength, finalLap);
  }

  _targetLateral(race) {
    const k = this.kart;
    const path = race.path;
    const hw = path.halfWidth;
    const line = race.racingLine ? racingLineAt(race.racingLine, k.s + 10) : 0;
    const wobble = Math.sin(this.time * 0.23 + this.phase) * this.wanderAmp;
    let lat = line * this.lineFollow + (this.wander + wobble) * (1 - Math.abs(line) / (hw + 1));
    // Empty-handed? Aim for an item box that is still there.
    if (!k.item && k.itemRoulette <= 0 && race.itemBoxes) {
      let best = null;
      let bestCost = Infinity;
      for (const b of race.itemBoxes.boxes) {
        if (!b.active) continue;
        const ahead = path.delta(k.s, b.slot.s);
        if (ahead < 4 || ahead > 45) continue;
        const cost = Math.abs(b.slot.lateral - lat);
        if (cost < bestCost) { bestCost = cost; best = b; }
      }
      if (best && bestCost < 7) lat += (best.slot.lateral - lat) * (0.4 + 0.5 * this.skill);
    }
    // Look for gumdrops in our lane and (sometimes) dodge them.
    const gumdrops = race.items?.gumdrops || [];
    for (const g of gumdrops) {
      if (g.owner === k && g.grace > 0) continue;
      const ahead = path.delta(k.s, g.s);
      if (ahead < 2 || ahead > 30) continue;
      if (Math.abs(g.lateral - lat) > 2.8) continue;
      let dodge = this.avoidMemo.get(g);
      if (dodge === undefined) {
        dodge = this.rng() < 0.2 + this.skill * 0.65;
        this.avoidMemo.set(g, dodge);
      }
      if (dodge) lat = g.lateral + (g.lateral > 0 ? -3.4 : 3.4);
    }
    return clamp(lat, -(hw - 1.2), hw - 1.2);
  }

  _shouldUseItem(race) {
    const k = this.kart;
    const path = race.path;
    const held = this.itemHeldFor;
    switch (k.item) {
      case 'sprinkle-boost':
      case 'triple-sprinkle':
        return Math.abs(turnAhead(path, k.s, 40)) < 0.4 || held > 7;
      case 'gumdrop': {
        const behind = race.karts.some((o) => o !== k && k.distance - o.distance > 3 && k.distance - o.distance < 25);
        return behind || held > 6;
      }
      case 'cupcake-rocket': {
        if (k.place <= 1) return held > 8;
        const ahead = race.karts.find((o) => o.place === k.place - 1);
        return (ahead && ahead.distance - k.distance < 110) || held > 8;
      }
      case 'bubble-shield':
      case 'rainbow-star':
      default:
        return true;
    }
  }

  /** @returns DriveInput */
  think(race, dt = 1 / 60) {
    const k = this.kart;
    const path = race.path;
    const input = { steer: 0, accel: 0, brake: 0, drift: false, useItem: false, lookBack: false };
    this.time += dt;

    if (race.state === 'countdown') {
      input.accel = race.countdown <= this.startPress ? 1 : 0;
      return input;
    }
    if (k.isCPU && !k.finished) k.aiSpeedMult = this.rubberBand(race);
    else if (k.isCPU) k.aiSpeedMult = 0.8;

    const speed = Math.max(0, k.speed);
    const lat = this._targetLateral(race);
    const look = 7 + speed * 0.42;
    const tp = path.positionAt(k.s + look, lat, _t);
    let steer = steerToward(k, tp.x, tp.z, 2.4);
    const headingErr = Math.abs(wrapAngle(Math.atan2(tp.x - k.position.x, tp.z - k.position.z) - k.heading));

    // Unstick: back up and turn if we have been stopped for a while.
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      input.brake = 1;
      input.steer = -steer;
      return input;
    }
    if (race.state !== 'countdown' && Math.abs(k.speed) < 1.5 && !k.spinning) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 1.3) {
      this.stuckTime = 0;
      this.reverseTime = 0.8;
    }

    input.steer = steer;
    input.accel = headingErr > 0.9 && speed > 18 ? 0.2 : 1;

    // Drifting through long bends.
    const bend = turnAhead(path, k.s + 3, 30);
    if (!k.drifting) {
      if (Math.abs(bend) < 0.2) this.driftPlan = null; // back on a straight: next bend is a new decision
      const bendy = Math.abs(bend) > 0.38 && Math.abs(turnAhead(path, k.s + 3, 55)) > 0.6;
      if (bendy && speed > T.driftMinSpeed + 4 && Math.sign(steer) === -Math.sign(bend) && Math.abs(steer) > 0.25) {
        if (this.driftPlan === null) this.driftPlan = this.rng() < this.driftChance;
        if (this.driftPlan) input.drift = true;
      }
    } else {
      const hw = path.halfWidth;
      const stillBending = Math.abs(turnAhead(path, k.s, 24)) > 0.2;
      const pinnedOut = steer * k.driftDir < -0.95;
      this.driftOutFor = pinnedOut ? this.driftOutFor + dt : 0;
      const outsideEdge = -k.lateral * k.driftDir > hw - 1; // sliding wide
      const insideEdge = k.lateral * k.driftDir > hw - 1; // turning too tight
      input.drift = stillBending && this.driftOutFor < 0.5 && !outsideEdge && !insideEdge;
      if (!input.drift) this.driftPlan = false;
    }

    // Items
    if (k.item && k.itemRoulette <= 0) {
      if (this.itemHeldFor === 0) this.itemDelay = 0.4 + this.rng() * 2.4 * (1.25 - this.skill);
      this.itemHeldFor += dt;
      if (this.itemHeldFor > this.itemDelay && this._shouldUseItem(race)) {
        input.useItem = true;
        this.itemHeldFor = 0;
      }
    } else {
      this.itemHeldFor = 0;
    }
    return input;
  }
}

const _brains = new WeakMap();

/**
 * DriveInput for any kart using the CPU brain (for `?autodrive=1`).
 * Re-uses the race's own brain for CPU karts; creates one for humans.
 */
export function aiDriveInput(race, kart, dt) {
  let brain = race.brains?.get(kart) || _brains.get(kart);
  if (!brain) {
    brain = new CpuBrain(kart, { skill: 0.8, rng: race.rng || Math.random });
    _brains.set(kart, brain);
  }
  return brain.think(race, dt ?? race.lastDt ?? 1 / 60);
}

/** Kid-Assist per-kart memory (lane choice, unstick timer). */
const _assist = new WeakMap();

/** Kid-Assist steering-help tuning. The pedal rules live in TUNING (kidAssist*). */
export const KID_ASSIST = Object.freeze({
  lineFollow: 0.85, // how much of the racing line the helper follows
  laneRate: 9, // metres per second a held stick moves the chosen lane
  laneReturn: 0.45, // per second: a released stick drifts back to the racing line
  edgeMargin: 2.4, // the target lane stays this far inside the road edge
  gain: 2.4, // steering gain toward the look-ahead point
  kidShare: 0.45, // share of the kid's own stick mixed straight into the steering
  stuckAfter: 1.2, // seconds stalled before the helper backs up a little
  backUpFor: 0.7,
});

/** Kid-Assist memory for a kart (created on first use). */
export function kidAssistState(kart) {
  let st = _assist.get(kart);
  if (!st) {
    st = { lane: 0, stuck: 0, backUp: 0 };
    _assist.set(kart, st);
  }
  return st;
}

/**
 * Pedals under Kid-Assist: ALWAYS full gas, unless the kid really brakes
 * (brake >= TUNING.kidAssistBrake). A resting or lightly-touched trigger no
 * longer cancels the gas — that was the "doesn't fully press the gas" bug:
 * brake 0.1..0.5 left accel at 0, so Kart.js gently braked instead. During
 * the countdown it presses at the right moment for a sparkly Rocket Start.
 * @returns {{accel:number, brake:number}}
 */
export function kidAssistPedals(race, input) {
  const brake = clamp(Number(input?.brake) || 0, 0, 1);
  const braking = brake >= T.kidAssistBrake;
  if (race.state === 'countdown') {
    return { accel: !braking && race.countdown <= T.kidAssistStartAt ? 1 : 0, brake: 0 };
  }
  return braking ? { accel: 0, brake } : { accel: 1, brake: 0 };
}

/**
 * Kid-Assist (the field stays `easyDrive`): always full gas + strong but
 * natural steering help that follows the racing line, keeps clear of the
 * walls and lets the kid choose a lane with the stick. It never drifts by
 * itself (the kid still can). Returns a new DriveInput.
 */
export function applyEasyDrive(race, kart, input) {
  const out = { ...input };
  const pedals = kidAssistPedals(race, input);
  out.accel = pedals.accel;
  out.brake = pedals.brake;
  if (race.state === 'countdown' || !race.path) return out;

  const dt = clamp(Number.isFinite(race.lastDt) ? race.lastDt : 1 / 60, 0, 0.1);
  const st = kidAssistState(kart);
  const path = race.path;
  const hw = path.halfWidth;
  const s = clamp(Number(input.steer) || 0, -1, 1);
  const speed = Math.max(0, kart.speed);

  // The kid's stick moves the chosen lane; let go and it drifts back to the line.
  const edge = Math.max(0, hw - KID_ASSIST.edgeMargin);
  if (Math.abs(s) > 0.15) st.lane = clamp(st.lane + s * KID_ASSIST.laneRate * dt, -2 * edge, 2 * edge);
  else st.lane *= Math.exp(-KID_ASSIST.laneReturn * dt);

  const look = 7 + speed * 0.42;
  const line = race.racingLine ? racingLineAt(race.racingLine, kart.s + look * 0.5) : 0;
  const tgtLat = clamp(line * KID_ASSIST.lineFollow + st.lane, -edge, edge);
  const tp = path.positionAt(kart.s + look, tgtLat, _t);
  const assist = steerToward(kart, tp.x, tp.z, KID_ASSIST.gain);

  // Near a wall the helper takes over more (auto-avoid walls).
  const nearWall = clamp((Math.abs(kart.lateral) - (hw - 3)) / 2.5, 0, 1);
  const share = KID_ASSIST.kidShare * Math.abs(s) * (1 - 0.8 * nearWall);
  out.steer = clamp(assist + (s - assist) * share, -1, 1);

  // Stalled nose-first in a pile-up? Back up for a moment, then carry on.
  if (st.backUp > 0) {
    st.backUp -= dt;
    out.accel = 0;
    out.brake = 1;
    out.steer = -assist;
    return out;
  }
  if (race.state === 'racing' && Math.abs(kart.speed) < 1.5 && !kart.spinning && pedals.accel > 0) st.stuck += dt;
  else st.stuck = 0;
  if (st.stuck > KID_ASSIST.stuckAfter) {
    st.stuck = 0;
    st.backUp = KID_ASSIST.backUpFor;
  }
  return out;
}
