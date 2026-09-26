/**
 * WS7 COPY of tests/helpers/netSim.js, so the running game has captureSimState / predictTick /
 * makeCountdown until WS1 PR (a) lands (parity: tests/net.integration.standins.test.js). When WS1 merges:
 * delete this file and point src/online/stack.js at src/race/{simState,predict}.js.
 *
 * Original header: TEMPORARY sim hooks for the WS5 netcode tests until WS1 PR (a) lands (NETWORKING.md §8.4, §8.5):
 *   captureSimState(race, tick)            SimState of today's Race (entity ids assigned here, per item object)
 *   predictTick(localKarts, inputs, ctx)   one 1/60 s step of this machine's LOCAL karts, mirroring Race.update(1/60)
 *   makeCountdown(seconds)                 the host's exact float countdown sequence → goTick and countdown-after-tick
 *   raceTick(race, inputs)                 race.tick(inputs) when WS1's API exists, else race.update(1/60, inputs)
 *
 * Nothing in src/ imports this: the netcode receives these functions as options (WS7 passes WS1's).
 */
import * as THREE from 'three';
import { stepKart, giveBoost, constrainToTrack } from '../../race/Kart.js';
import { TUNING as T } from '../../race/tuning.js';
import { predictGumdropHits } from '../../net/guest/localHits.js';

const GUMDROP_COLORS = [0xff6fb5, 0x7ee07e, 0xffd35c, 0x8fb8ff, 0xc38bff];
const ids = new WeakMap();
let nextEntityId = 1;
const entityId = (obj) => {
  let id = ids.get(obj);
  if (!id) { id = nextEntityId; nextEntityId = (nextEntityId % 0xfffe) + 1; ids.set(obj, id); }
  return id;
};
const kid = (k) => (k && Number.isInteger(k.id) ? k.id : 255);

/** One kart as KartSim (exact floats). */
export function captureKart(k) {
  const p = k.phys;
  const { bumpCooldowns, ...phys } = p; // eslint-disable-line no-unused-vars
  return {
    id: k.id, gridSlot: k.gridSlot ?? k.id,
    position: [k.position.x, k.position.y, k.position.z], heading: k.heading,
    velocity: [k.velocity.x, k.velocity.y, k.velocity.z], speed: k.speed, s: k.s, lateral: k.lateral, lap: k.lap,
    distance: k.distance, progress: k.progress, place: k.place, finished: k.finished, finishTime: k.finishTime,
    finishPlace: k.finishPlace, finishEstimated: !!k.finishEstimated, lapTimes: k.lapTimes.slice(), item: k.item,
    itemCharges: k.itemCharges, itemRoulette: k.itemRoulette, boosting: k.boosting, spinning: k.spinning,
    shielded: k.shielded, drifting: k.drifting, driftLevel: k.driftLevel, driftDir: k.driftDir, starPower: k.starPower,
    offRoad: k.offRoad, wrongWay: k.wrongWay, aiSpeedMult: k.aiSpeedMult, battleOut: !!k.battleOut, roboDriven: !!k.roboDriven,
    phys: { ...phys, assist: null },
  };
}

export function captureSimState(race, tick = 0) {
  const path = race.path;
  const v = new THREE.Vector3();
  return {
    tick, state: race.state, countdown: race.countdown, countdownShown: race._countdownShown ?? 0, time: race.time,
    clock: race.clock, finishCount: race.finishCount, firstFinishTime: race.firstFinishTime,
    firstHumanFinishTime: race.firstHumanFinishTime, rng: 0, nextEntityId,
    bumpTimes: [...(race._bumpTimes?.entries?.() ?? [])],
    karts: race.karts.map(captureKart),
    boxes: {
      active: race.itemBoxes.boxes.map((b) => !!b.active),
      respawn: race.itemBoxes.boxes.map((b) => b.respawn || 0),
    },
    gumdrops: race.items.gumdrops.map((g) => ({
      id: entityId(g), x: g.position.x, y: g.position.y, z: g.position.z, s: g.s, lateral: g.lateral, owner: kid(g.owner),
      grace: g.grace, age: g.age, color: Math.max(0, GUMDROP_COLORS.indexOf(g.color)), near: [], dodged: [],
    })),
    rockets: race.items.rockets.map((r) => {
      const pos = r.mesh?.position ?? path.positionAt(r.s, r.lateral, v);
      return {
        id: entityId(r), owner: kid(r.owner), target: kid(r.target), chased: !!r.chased, distance: r.distance, s: r.s,
        lateral: r.lateral, y: r.y, travelled: r.travelled, life: r.life, age: r.age,
        x: pos.x, z: pos.z, heading: path.headingAt(r.s),
      };
    }),
    starOn: [], itemBoost: [], battle: null, modeInfo: race.modeInfo ? { ...race.modeInfo } : null,
  };
}

/** The host's countdown, float for float: `after(r)` = race.countdown after race tick r (1-based). */
export function makeCountdown(seconds = 3) {
  const after = [seconds];
  let c = seconds;
  let goTick = 0;
  while (c > 0) {
    c = Math.max(0, c - Math.min(1 / 60, T.maxFrameDt));
    after.push(c);
    goTick++;
  }
  return { goTick, after: (r) => (r <= 0 ? seconds : r >= after.length ? 0 : after[r]) };
}

export function raceTick(race, inputs) {
  if (typeof race.tick === 'function') race.tick(inputs); else race.update(1 / 60, inputs);
}

function selfUse(k, emit) {
  const item = k.item;
  switch (item) {
    case 'sprinkle-boost':
    case 'triple-sprinkle':
      giveBoost(k, T.itemBoost);
      emit({ type: 'boost', kart: k, source: 'item' });
      break;
    case 'bubble-shield': k.shielded = true; k.phys.shieldTime = T.shieldDuration; break;
    case 'rainbow-star': k.starPower = T.starDuration; giveBoost(k, 0.6); break;
    case 'gumdrop': case 'cupcake-rocket': break; // cosmetic: the slot empties, the host spawns the entity
    default: return;
  }
  const chargesLeft = item === 'triple-sprinkle' && k.itemCharges > 1 ? k.itemCharges - 1 : 0;
  emit({ type: 'item-use', kart: k, item, chargesLeft });
  if (chargesLeft > 0) k.itemCharges = chargesLeft; else { k.item = null; k.itemCharges = 0; }
}

/** Race._collideKarts for the given karts only (no star bonks: those are host-only item effects). */
export function collideKarts(karts, { emit = () => {}, bumpTimes = new Map(), time = 0 } = {}) {
  const R = T.kartRadius * 2;
  for (let i = 0; i < karts.length; i++) {
    const a = karts[i];
    if (a.battleOut) continue;
    for (let j = i + 1; j < karts.length; j++) {
      const b = karts[j];
      if (b.battleOut) continue;
      let dx = b.position.x - a.position.x;
      let dz = b.position.z - a.position.z;
      if (Math.abs(dx) > R || Math.abs(dz) > R || Math.abs(b.position.y - a.position.y) > 2) continue;
      let d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 < 1e-6) { dx = 0.01; dz = 0; d2 = 1e-4; }
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const overlap = R - d;
      const ma = a.stats.mass, mb = b.stats.mass;
      const wa = mb / (ma + mb), wb = ma / (ma + mb);
      a.position.x -= nx * overlap * wa; a.position.z -= nz * overlap * wa;
      b.position.x += nx * overlap * wb; b.position.z += nz * overlap * wb;
      const vrel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
      if (vrel < 0) {
        const jImp = (-(1 + T.bumpRestitution) * vrel) / (1 / ma + 1 / mb);
        a.velocity.x -= (nx * jImp) / ma; a.velocity.z -= (nz * jImp) / ma;
        b.velocity.x += (nx * jImp) / mb; b.velocity.z += (nz * jImp) / mb;
      }
      const key = a.id * 64 + b.id;
      const last = bumpTimes.get(key) ?? -Infinity;
      if (-vrel > 2.5 && time - last > T.bumpCooldown) {
        bumpTimes.set(key, time);
        emit({ type: 'bump', kart: a, other: b, strength: Math.min(1, -vrel / 15) });
      }
    }
  }
}

/**
 * One tick for this machine's local karts together (Race.update(1/60) order for those karts only).
 * @param {object[]} localKarts
 * @param {object[]} inputs   DriveInput per local kart (same order)
 * @param {{ path, boostPads, jumps?, rings?, gameplay, tick: number, startTick?: number, goTick: number, countdownAfter?: (r:number)=>number,
 *           emit?: Function, bumpTimes?: Map, lapsTotal?: number, time?: number }} ctx
 */
export function predictTick(localKarts, inputs, ctx) {
  const emit = ctx.emit || (() => {});
  const env = { path: ctx.path, boostPads: ctx.boostPads, jumps: ctx.jumps, rings: ctx.rings, emit, gameplay: ctx.gameplay };
  const startTick = ctx.startTick ?? 1;
  const r = ctx.tick - startTick + 1; // race tick number (1-based)
  const goR = ctx.goTick - startTick + 1;
  if (r <= goR) {
    const cd = ctx.countdownAfter ? ctx.countdownAfter(r) : Math.max(0, (goR - r) / 60);
    localKarts.forEach((k, i) => {
      const held = (inputs[i]?.accel || 0) > 0.5;
      if (held && !k.phys.prevAccel) k.phys.accelPressedAt = cd;
      if (!held) k.phys.accelPressedAt = null;
      k.phys.prevAccel = held;
    });
    if (r === goR) {
      for (const k of localKarts) {
        const at = k.phys.accelPressedAt;
        if (k.phys.prevAccel && at !== null && at <= T.startBoostWindow) {
          giveBoost(k, T.startBoost);
          emit({ type: 'boost', kart: k, source: 'start' });
        }
      }
    }
    return;
  }
  localKarts.forEach((k, i) => {
    const inp = inputs[i];
    if (inp?.useItem && k.item && k.itemRoulette <= 0 && !k.spinning && !k.battleOut) selfUse(k, emit);
  });
  for (const k of localKarts) { k.phys.frameStartX = k.position.x; k.phys.frameStartZ = k.position.z; }
  const L = ctx.path.length;
  for (let step = 0; step < 2; step++) {
    collideKarts(localKarts, { emit, bumpTimes: ctx.bumpTimes, time: ctx.time ?? 0 });
    localKarts.forEach((k, i) => stepKart(k, inputs[i] || {}, env, 1 / 120));
    for (const k of localKarts) {
      k.progress = k.distance;
      if (k.finished) continue;
      const lapNow = Math.floor(Math.max(0, k.distance) / L) + 1;
      if (lapNow > k.lap) k.lap = Math.min(lapNow, ctx.lapsTotal ?? lapNow);
    }
  }
  // static gumdrops from the newest snapshot: bonk our own kart at the tick it really touches one (§9.8)
  if (ctx.hazards) predictGumdropHits(localKarts, ctx.hazards, emit);
}

export { constrainToTrack };
