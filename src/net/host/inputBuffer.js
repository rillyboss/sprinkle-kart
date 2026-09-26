/**
 * Host input buffer, one per guest house (NETWORKING.md §9.3). Tick-stamped inputs arrive in
 * redundant INPUT packets (unordered, lossy); the host takes exactly one input set per simulated tick.
 *
 * | Situation                                         | Host uses for tick T                                  |
 * |---------------------------------------------------|-------------------------------------------------------|
 * | input for T present                               | it (status 'on-time')                                 |
 * | missing, last input <= 250 ms old                 | last input, press counters unchanged ('repeated')     |
 * | input for T arrives after T was simulated         | analog dropped; press-counter deltas queued            |
 * | counter delta 2+ (double tap / late presses)      | queued; at most 1 press per counter per tick; queued   |
 * |                                                   | presses older than 250 ms are dropped                 |
 * | counter wrapped (mod 8)                           | deltas mod 8 against the last SEEN value              |
 * | missing > 250 ms                                  | steer eases to 0 over 0.25 s, accel held (coast)      |
 * | missing > 1.5 s, or the robo bit                  | Robo Driver ('robo')                                  |
 * | resume after Robo Driver / reconnect / HELLO /    | rebaseline(): first counters = baseline, NO press,    |
 * | RESYNC                                            | queue cleared, control returns on the next tick       |
 *
 * Press counters (INPUT `presses`: item use bits 0-2, hop/drift press bits 3-5, both mod 8) make
 * redundancy safe: repeating a packet never doubles a press and a lost packet never loses one.
 *
 * The hop is a drift-button EDGE in the sim (`pressed = drift && !driftHeld`). `createPressResolver`
 * turns counter deltas into exactly those edges: the drift output may only rise false → true by
 * consuming a hop press (so a lost tap still hops, late, and a button still held after a rebaseline
 * never hops by itself). The guest runs the SAME resolver on its own inputs (`resolveLocalInputs`
 * in src/net/guest/inputHistory.js), so on-time inputs give bit-identical DriveInputs on both sides.
 */

export const INPUT_BUFFER_SIZE = 64;
export const HOLD_MS = 250;
export const COAST_MS = 250; // steer eases to 0 over this long after the hold
export const ROBO_MS = 1500;
export const STALE_PRESS_MS = 250;
export const SLACK_MISSING = -128;
const TICK_MS = 1000 / 60;

/** @typedef {{ steer: number, accel: number, brake: number, drift: boolean, lookBack?: boolean, robo?: boolean,
 *              assisted?: boolean, itemCount: number, hopCount: number }} PlayerTickInput   one player, one tick (wire form) */
/** @typedef {{ steer: number, accel: number, brake: number, drift: boolean, useItem: boolean, lookBack: boolean,
 *              robo: boolean, assisted: boolean }} ResolvedInput   what the sim gets (a DriveInput + flags) */

export const NEUTRAL_TICK_INPUT = Object.freeze({
  steer: 0, accel: 0, brake: 0, drift: false, lookBack: false, robo: false, assisted: false, itemCount: 0, hopCount: 0,
});

const mod8 = (v) => ((v % 8) + 8) % 8;

/**
 * Press counters → per-tick press edges (one per counter per tick), shared by host and guest.
 * @param {{ staleTicks?: number }} [o]
 */
export function createPressResolver({ staleTicks = Math.round(STALE_PRESS_MS / TICK_MS) } = {}) {
  let seenItem = null; // last seen counter values (null = no baseline yet)
  let seenHop = null;
  let seenTick = -Infinity;
  const itemQ = []; // stamps (tick the press was observed at)
  const hopQ = [];
  let driftOut = false; // what the sim got last tick
  const stats = { pressesQueued: 0, itemPresses: 0, hopPresses: 0, stalePresses: 0 };

  return {
    /** Make these counters the baseline: no press, queue cleared, held drift must be pressed again. */
    baseline(itemCount = 0, hopCount = 0, tick = -Infinity) {
      seenItem = mod8(itemCount);
      seenHop = mod8(hopCount);
      seenTick = tick;
      itemQ.length = 0;
      hopQ.length = 0;
      driftOut = false;
    },
    /** Forget the baseline: the next observe() becomes the baseline (no press). */
    reset() {
      seenItem = null;
      seenHop = null;
      seenTick = -Infinity;
      itemQ.length = 0;
      hopQ.length = 0;
      driftOut = false;
    },
    get hasBaseline() { return seenItem !== null; },
    /**
     * Counters observed in the input stamped `tick`. Older-than-seen stamps carry no new information
     * (counters are cumulative) and are ignored.
     * @returns {{ item: number, hop: number }} presses queued
     */
    observe(itemCount, hopCount, tick) {
      if (seenItem === null) { this.baseline(itemCount, hopCount, tick); return { item: 0, hop: 0 }; }
      if (!(tick > seenTick)) return { item: 0, hop: 0 };
      const di = mod8(mod8(itemCount) - seenItem);
      const dh = mod8(mod8(hopCount) - seenHop);
      for (let i = 0; i < di; i++) itemQ.push(tick);
      for (let i = 0; i < dh; i++) hopQ.push(tick);
      seenItem = mod8(itemCount);
      seenHop = mod8(hopCount);
      seenTick = tick;
      stats.pressesQueued += di + dh;
      return { item: di, hop: dh };
    },
    /**
     * Presses for tick `tick` given the (held) drift button of the input used for it.
     * @returns {{ useItem: boolean, drift: boolean, hopPress: boolean }}
     */
    dispense(tick, driftHeld) {
      while (itemQ.length && tick - itemQ[0] > staleTicks) { itemQ.shift(); stats.stalePresses++; }
      while (hopQ.length && tick - hopQ[0] > staleTicks) { hopQ.shift(); stats.stalePresses++; }
      let useItem = false;
      if (itemQ.length) { itemQ.shift(); useItem = true; stats.itemPresses++; }
      let drift;
      let hopPress = false;
      if (hopQ.length) {
        if (!driftOut) { hopQ.shift(); drift = true; hopPress = true; stats.hopPresses++; } else drift = false; // release first: the edge comes next tick
      } else {
        drift = !!driftHeld && driftOut; // stays down while held, never rises without a press
      }
      driftOut = drift;
      return { useItem, drift, hopPress };
    },
    /** Pending presses (for stats/tests). */
    get pending() { return { item: itemQ.length, hop: hopQ.length }; },
    get driftOut() { return driftOut; },
    stats,
  };
}

/**
 * @param {{ size?: number, tickMs?: number, holdMs?: number, coastMs?: number, roboMs?: number, staleMs?: number }} [o]
 */
export function createInputBuffer({
  size = INPUT_BUFFER_SIZE, tickMs = TICK_MS, holdMs = HOLD_MS, coastMs = COAST_MS, roboMs = ROBO_MS, staleMs = STALE_PRESS_MS,
} = {}) {
  const holdTicks = Math.round(holdMs / tickMs);
  const coastTicks = Math.max(1, Math.round(coastMs / tickMs));
  const roboTicks = Math.round(roboMs / tickMs);
  /** ring slot → { tick, players, slack } */
  const ring = new Array(size).fill(null);
  /** per-tick arrival slack for the snapshot's inputSlack (first arrival wins) */
  const slackRing = new Array(size).fill(null);
  const resolvers = [];
  let lastConsumed = 0; // newest tick taken
  let lastInput = null; // players[] of the newest input actually used (on-time)
  let lastInputTick = -Infinity; // tick of that input
  let newestSeen = -Infinity; // newest tick received at all (late ones included)
  let robo = false;
  let forcedRobo = false;
  let needBaseline = true;
  let firstTake = null;
  const stats = { onTime: 0, repeated: 0, coasting: 0, robo: 0, late: 0, dup: 0, future: 0, rebaselines: 0 };

  const resolverFor = (p) => {
    while (resolvers.length <= p) resolvers.push(createPressResolver({ staleTicks: Math.round(staleMs / tickMs) }));
    return resolvers[p];
  };

  function rebaseline() {
    needBaseline = true;
    for (const r of resolvers) r.reset();
    stats.rebaselines++;
  }

  /**
   * Store the inputs of `tick` (one PlayerTickInput per local player of the house, seat order).
   * @param {number} tick
   * @param {PlayerTickInput[]} perPlayer
   * @returns {'stored'|'dup'|'late'|'future'}
   */
  function push(tick, perPlayer) {
    if (!Array.isArray(perPlayer) || !perPlayer.length) return 'dup';
    newestSeen = Math.max(newestSeen, tick);
    if (tick <= lastConsumed) {
      // Late: the analog part is useless now, but press-counter deltas are queued (a late press is late,
      // never lost). While Robo Driver has the wheel (or before a baseline) nothing is queued.
      stats.late++;
      if (!robo && !needBaseline) perPlayer.forEach((pi, p) => resolverFor(p).observe(pi.itemCount, pi.hopCount, tick));
      return 'late';
    }
    if (tick > lastConsumed + size) { stats.future++; return 'future'; }
    const slot = tick % size;
    if (ring[slot] && ring[slot].tick === tick) { stats.dup++; return 'dup'; }
    ring[slot] = { tick, players: perPlayer };
    if (!slackRing[slot] || slackRing[slot].tick !== tick) slackRing[slot] = { tick, slack: tick - (lastConsumed + 1) };
    return 'stored';
  }

  /**
   * The input set for tick `tick` (call once per simulated tick, in order).
   * @returns {{ inputs: ResolvedInput[], status: 'on-time'|'repeated'|'robo', presses: Array<{ item: boolean, hop: boolean }>,
   *             coasting: boolean, roboChanged: boolean }}
   */
  function take(tick) {
    const slot = tick % size;
    const entry = ring[slot] && ring[slot].tick === tick ? ring[slot] : null;
    if (entry) ring[slot] = null;
    if (firstTake === null) firstTake = tick;
    lastConsumed = Math.max(lastConsumed, tick);
    const wasRobo = robo;
    const roboBit = entry ? entry.players.some((p) => p.robo) : false;

    let status;
    let src = null;
    let coasting = false;
    if (forcedRobo || roboBit) {
      robo = true;
      status = 'robo';
      if (entry) { lastInputTick = tick; }
    } else if (entry) {
      if (robo || needBaseline) {
        // Inputs resumed: the first counters are the baseline (no phantom press), control returns now.
        entry.players.forEach((pi, p) => resolverFor(p).baseline(pi.itemCount, pi.hopCount, tick));
        needBaseline = false;
        robo = false;
      } else {
        entry.players.forEach((pi, p) => resolverFor(p).observe(pi.itemCount, pi.hopCount, tick));
      }
      src = entry.players;
      lastInput = entry.players;
      lastInputTick = tick;
      status = 'on-time';
    } else {
      const heard = Math.max(lastInputTick, newestSeen, firstTake - 1);
      const age = tick - Math.max(lastInputTick, firstTake - 1); // since the last input we could use
      const silence = tick - Math.min(tick, heard); // since we heard anything at all
      if (robo || silence > roboTicks) {
        robo = true;
        status = 'robo';
      } else {
        status = 'repeated';
        src = lastInput || [NEUTRAL_TICK_INPUT];
        if (age > holdTicks) coasting = true;
      }
    }

    const presses = [];
    let inputs;
    if (status === 'robo') {
      inputs = (lastInput || [NEUTRAL_TICK_INPUT]).map(() => ({
        steer: 0, accel: 0, brake: 0, drift: false, useItem: false, lookBack: false, robo: true, assisted: false,
      }));
      stats.robo++;
    } else {
      const ease = coasting ? Math.max(0, 1 - (tick - lastInputTick - holdTicks) / coastTicks) : 1;
      inputs = src.map((pi, p) => {
        const r = resolverFor(p);
        const d = r.dispense(tick, !!pi.drift);
        presses.push({ item: d.useItem, hop: d.hopPress });
        return {
          steer: (pi.steer || 0) * ease,
          accel: pi.accel || 0,
          brake: pi.brake || 0,
          drift: d.drift,
          useItem: d.useItem,
          lookBack: !!pi.lookBack,
          robo: false,
          assisted: !!pi.assisted,
        };
      });
      if (status === 'on-time') stats.onTime++; else stats.repeated++;
      if (coasting) stats.coasting++;
    }
    return { inputs, status, presses, coasting, roboChanged: wasRobo !== robo };
  }

  return {
    push,
    take,
    rebaseline,
    /** How many ticks early the input for `tick` arrived (SLACK_MISSING = never arrived in time). */
    slack(tick) {
      const s = slackRing[tick % size];
      return s && s.tick === tick ? Math.max(-127, Math.min(127, s.slack)) : SLACK_MISSING;
    },
    /**
     * Forget inputs stored for ticks not simulated yet. After a catch-up skip or a starved pump the guests'
     * timelines were ahead of the host; they rewind and re-send those ticks, and the fresh copies must win
     * over the stale ones (a duplicate tick is otherwise ignored).
     */
    dropFuture() {
      for (let i = 0; i < size; i++) {
        if (ring[i] && ring[i].tick > lastConsumed) ring[i] = null;
        if (slackRing[i] && slackRing[i].tick > lastConsumed) slackRing[i] = null;
      }
      newestSeen = Math.min(newestSeen, lastConsumed);
      stats.dropFuture = (stats.dropFuture || 0) + 1;
    },
    /** Host decision (guest dropped / asleep): force Robo Driver on (true) or give the wheel back (false → rebaseline). */
    setRobo(on) {
      if (on) { forcedRobo = true; robo = true; } else if (forcedRobo) { forcedRobo = false; rebaseline(); }
    },
    get lastConsumed() { return lastConsumed; },
    get newestSeen() { return newestSeen; },
    get robo() { return robo; },
    get lastInputTick() { return lastInputTick; },
    /** Pending queued presses per player. */
    pending() { return resolvers.map((r) => r.pending); },
    stats,
    /** Buffer occupancy (bounded by `size`). */
    get occupancy() { return ring.filter(Boolean).length; },
  };
}
