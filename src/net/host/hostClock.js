/**
 * The host's authoritative tick clock (NETWORKING.md §9.9): ONE accumulator, two drivers.
 *
 *   due = anchorTick + floor((hostNow - anchorMs) * tickHz / 1000) - lastTick
 *
 * - Visible tab: every rAF frame calls `advance(now)` (source 'raf'), runs the due ticks and gets
 *   `alpha` in [0, 1) for `race.present(alpha)`.
 * - Hidden tab, or rAF older than `rafStaleMs` (50 ms): the Worker pump calls
 *   `advance(now, { source: 'pump' })`. The pump is ignored again after 2 consecutive on-time rAF
 *   frames. Both drivers call the same function with the same `due` formula, so each tick runs
 *   exactly once whoever calls.
 * - A backlog is caught up at most `maxPerCall` (6) ticks per call, staying on the timebase. A backlog
 *   larger than `maxBacklog` (30 ticks = 500 ms) is SKIPPED instead: re-anchor at `lastTick + 1`,
 *   `epoch + 1`, TIMEBASE reason 4.
 * - `pause()` freezes the accumulator; `resume()` re-anchors at `resumeTick = lastTick + 1` with a
 *   new epoch (TIMEBASE reason 3).
 * - Pump starvation (the pump is driving and did not call for > 1 s): PAUSE reason 1 is reported,
 *   then the clock re-anchors with a new epoch and resumes (so guests show "Waiting for the host…"
 *   instead of seeing a burst of catch-up ticks).
 *
 * The clock never runs the simulation itself; `advance()` tells the caller how many ticks to run
 * (the host driver runs them) and `firstTick` is the number of the first one.
 *
 * TIMEBASE promise (§7.3): within an epoch, host tick k begins at anchorMs + (k - anchorTick) * 1000/60.
 */

export const TICK_HZ = 60;
export const HOST_MAX_PER_CALL = 6;
export const MAX_BACKLOG_TICKS = 30;
export const RAF_STALE_MS = 50;
export const PUMP_STARVE_MS = 1000;
export const TIMEBASE_PERIOD_MS = 1000;

/** TIMEBASE reasons (NETWORKING.md §6.2 0x34). */
export const TIMEBASE_REASON = Object.freeze({ periodic: 0, start: 1, pause: 2, resume: 3, skip: 4 });
/** PAUSE reasons (§6.2 0x30). */
export const PAUSE_REASON = Object.freeze({ snack: 0, starved: 1, skip: 2 });

/**
 * @typedef {object} Timebase
 * @property {number} epoch u8
 * @property {number} tick     host tick `tick` began at host time `hostMs`
 * @property {number} hostMs
 * @property {number} reason   TIMEBASE_REASON
 *
 * @typedef {object} PauseInfo
 * @property {boolean} paused
 * @property {number} reason   PAUSE_REASON
 * @property {number} tick     pauseTick (last simulated tick) on pause, resumeTick (next tick) on resume
 * @property {number} epoch
 */

/**
 * @param {object} [o]
 * @param {() => number} [o.now]            host wall clock in ms (used by start/pause/resume without an argument)
 * @param {number} [o.tickHz]
 * @param {number} [o.maxPerCall]
 * @param {number} [o.maxBacklog]
 * @param {number} [o.rafStaleMs]
 * @param {number} [o.starveMs]
 * @param {number} [o.periodMs]             periodic TIMEBASE interval (0 = off)
 * @param {number} [o.phaseMs]              put the tick grid this far BEFORE the start / resume frame (the game
 *                                          uses half a tick): vsync-locked frames then land mid-tick instead of on
 *                                          the boundary, where any callback jitter gave 0- and 2-tick frames
 * @param {(tb: Timebase) => void} [o.onTimebase]
 * @param {(p: PauseInfo) => void} [o.onPause]
 */
export function createHostClock({
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  tickHz = TICK_HZ,
  maxPerCall = HOST_MAX_PER_CALL,
  maxBacklog = MAX_BACKLOG_TICKS,
  rafStaleMs = RAF_STALE_MS,
  starveMs = PUMP_STARVE_MS,
  periodMs = TIMEBASE_PERIOD_MS,
  phaseMs = 0,
  onTimebase,
  onPause,
} = {}) {
  const tickMs = 1000 / tickHz;
  const phase = Math.max(0, Math.min(tickMs * 0.99, Number(phaseMs) || 0));
  const tbListeners = new Set();
  const pauseListeners = new Set();
  if (onTimebase) tbListeners.add(onTimebase);
  if (onPause) pauseListeners.add(onPause);

  let started = false;
  let epoch = 0;
  let anchorTick = 1;
  let anchorMs = 0;
  let lastTick = 0;
  let paused = false;
  let hidden = false; // usePump(true): the tab is hidden, the pump drives
  let pumpDriving = false;
  let lastRafMs = null;
  let onTimeRaf = 0;
  let lastPumpMs = null;
  let lastPeriodicMs = 0;
  let lastAlpha = 0;
  const counters = { ticks: 0, skips: 0, starves: 0, catchUpCalls: 0, pumpTicks: 0, rafTicks: 0, maxBacklog: 0 };

  const emitTb = (reason, at = anchorMs) => {
    const tb = { epoch, tick: anchorTick, hostMs: anchorMs, reason };
    lastPeriodicMs = at;
    for (const fn of tbListeners) fn(tb);
    return tb;
  };
  const emitPause = (p) => { for (const fn of pauseListeners) fn(p); };
  const reanchor = (ms) => {
    anchorTick = lastTick + 1;
    anchorMs = ms - phase;
    epoch = (epoch + 1) & 0xff;
  };

  function start(ms = now(), startTick = 1) {
    started = true;
    paused = false;
    anchorTick = startTick;
    anchorMs = ms - phase;
    lastTick = startTick - 1;
    lastRafMs = null;
    lastPumpMs = null;
    emitTb(TIMEBASE_REASON.start, ms);
    return state();
  }

  /** The due count right now (may be negative right after a re-anchor: never runs ticks early). */
  const dueAt = (ms) => anchorTick + Math.floor(((ms - anchorMs) * tickHz) / 1000 + 1e-9) - lastTick;
  const fracAt = (ms) => {
    const x = ((ms - anchorMs) * tickHz) / 1000;
    const f = x - Math.floor(x + 1e-9);
    return f < 0 ? 0 : f >= 1 ? 0 : f;
  };

  /**
   * Run the clock forward to `ms`.
   * @param {number} ms host wall clock now
   * @param {{ source?: 'raf'|'pump' }} [opts]
   * @returns {{ ticks: number, alpha: number, firstTick: number, epoch: number, ignored?: boolean, backlog: number }}
   */
  function advance(ms, { source = 'raf' } = {}) {
    if (!started) start(ms);
    const firstTick = lastTick + 1;
    if (source === 'pump') {
      if (!pumpDriving) {
        const stale = lastRafMs === null || ms - lastRafMs > rafStaleMs;
        if (hidden || stale) { pumpDriving = true; onTimeRaf = 0; lastPumpMs = ms; } else {
          return { ticks: 0, alpha: lastAlpha, firstTick, epoch, ignored: true, backlog: Math.max(0, dueAt(ms)) };
        }
      }
      if (!paused && lastPumpMs !== null && ms - lastPumpMs > starveMs) {
        // The pump itself starved (hidden host, throttled machine): tell guests, then come back on a new epoch.
        counters.starves++;
        const pauseTick = lastTick;
        emitPause({ paused: true, reason: PAUSE_REASON.starved, tick: pauseTick, epoch });
        emitTb(TIMEBASE_REASON.pause, ms);
        reanchor(ms);
        emitPause({ paused: false, reason: PAUSE_REASON.starved, tick: lastTick + 1, epoch });
        emitTb(TIMEBASE_REASON.resume, ms);
      }
      lastPumpMs = ms;
    } else {
      const onTime = lastRafMs !== null && ms - lastRafMs <= rafStaleMs;
      lastRafMs = ms;
      if (pumpDriving && !hidden) {
        onTimeRaf = onTime ? onTimeRaf + 1 : 0;
        if (onTimeRaf >= 2) { pumpDriving = false; lastPumpMs = null; }
      }
    }
    if (paused) return { ticks: 0, alpha: lastAlpha, firstTick, epoch, backlog: 0 };

    let due = dueAt(ms);
    if (due > maxBacklog) {
      counters.skips++;
      reanchor(ms);
      emitTb(TIMEBASE_REASON.skip, ms);
      due = dueAt(ms);
    }
    counters.maxBacklog = Math.max(counters.maxBacklog, due);
    const ticks = Math.max(0, Math.min(due, maxPerCall));
    if (due > maxPerCall) counters.catchUpCalls++;
    lastTick += ticks;
    counters.ticks += ticks;
    if (source === 'pump') counters.pumpTicks += ticks; else counters.rafTicks += ticks;
    const backlog = Math.max(0, due - ticks);
    lastAlpha = backlog > 0 ? 0 : fracAt(ms);
    if (periodMs > 0 && ms - lastPeriodicMs >= periodMs) emitTb(TIMEBASE_REASON.periodic, ms);
    return { ticks, alpha: lastAlpha, firstTick, epoch, backlog };
  }

  /** Freeze the accumulator ("Pause everyone"). Returns the PAUSE info (pauseTick = last simulated tick). */
  function pause(ms = now(), reason = PAUSE_REASON.snack) {
    if (!started || paused) return null;
    paused = true;
    const info = { paused: true, reason, tick: lastTick, epoch };
    emitPause(info);
    emitTb(TIMEBASE_REASON.pause, ms);
    return info;
  }

  /** Re-anchor at resumeTick = lastTick + 1 with a new epoch. Returns the PAUSE (resume) info. */
  function resume(ms = now(), reason = PAUSE_REASON.snack) {
    if (!started || !paused) return null;
    paused = false;
    reanchor(ms);
    lastPumpMs = pumpDriving ? ms : null;
    const info = { paused: false, reason, tick: lastTick + 1, epoch };
    emitPause(info);
    emitTb(TIMEBASE_REASON.resume, ms);
    return info;
  }

  /** `visibilitychange`: hidden → the pump drives at once; visible → rAF takes over after 2 on-time frames. */
  function usePump(on) {
    hidden = !!on;
    if (hidden) { pumpDriving = true; onTimeRaf = 0; } else { lastRafMs = null; onTimeRaf = 0; }
  }

  /** The current timebase (for a TIMEBASE message) without changing anything. */
  function timebase(reason = TIMEBASE_REASON.periodic) {
    return { epoch, tick: anchorTick, hostMs: anchorMs, reason };
  }

  function state() {
    return {
      started, epoch, anchorTick, anchorMs, lastTick, paused, hidden, pumpDriving, tickMs,
      counters: { ...counters },
    };
  }

  return {
    start, advance, pause, resume, usePump, timebase, state,
    get lastTick() { return lastTick; },
    get epoch() { return epoch; },
    get paused() { return paused; },
    /** Subscribe to TIMEBASE announcements; returns an unsubscribe function. */
    onTimebase(fn) { tbListeners.add(fn); return () => tbListeners.delete(fn); },
    /** Subscribe to PAUSE announcements (starvation pauses included). */
    onPause(fn) { pauseListeners.add(fn); return () => pauseListeners.delete(fn); },
  };
}
