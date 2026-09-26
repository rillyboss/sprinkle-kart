/**
 * Tick pump (NETWORKING.md §9.9): a dedicated Web Worker, built from a Blob, that posts a message
 * every 16.67 ms. Dedicated-worker timers are not throttled like a hidden tab's main-thread timers
 * (≤ 1 Hz), so the host keeps simulating while its tab is in the background. The worker corrects
 * its own drift against `performance.now()` (each timeout aims at the next ideal instant, never at
 * "now + interval"), and it skips instants it already missed instead of bursting.
 *
 * On every message the main thread calls `hostClock.advance(now, { source: 'pump' })`; the clock
 * decides whether the pump is currently driving.
 *
 *   const pump = createTickPump({ onTick: (t) => driver.frame(t, 'pump') });
 *   pump.start(); … pump.stop();
 *
 * Everything is injectable for tests: `createWorker(source)` (default: `new Worker(URL.createObjectURL(
 * new Blob([source])))`) and a timer fallback (`setTimeout`) when no Worker exists (node).
 */

export const PUMP_INTERVAL_MS = 1000 / 60;

/**
 * The worker's source. `postMessage` receives the worker-side `performance.now()` of the tick; the
 * main thread uses its own clock (worker and page share the time origin for dedicated workers, but
 * we never rely on it).
 */
export const PUMP_SOURCE = `
let timer = null;
let next = 0;
let interval = ${PUMP_INTERVAL_MS};
function loop() {
  const now = performance.now();
  postMessage(now);
  next += interval;
  if (next < now) next = now + interval; // missed instants are skipped, never burst
  timer = setTimeout(loop, Math.max(0, next - performance.now()));
}
onmessage = (e) => {
  const m = e.data || {};
  if (m.cmd === 'start') {
    interval = m.interval || interval;
    clearTimeout(timer);
    next = performance.now() + interval;
    timer = setTimeout(loop, interval);
  } else if (m.cmd === 'stop') {
    clearTimeout(timer);
    timer = null;
  }
};
`;

/**
 * Pure drift-corrected scheduler (the same maths as the worker, for tests and the timer fallback).
 * @param {{ now: () => number, setTimer: (fn: () => void, ms: number) => any, clearTimer: (h: any) => void,
 *           interval?: number, onTick: (t: number) => void }} o
 */
export function createDriftCorrectedLoop({ now, setTimer, clearTimer, interval = PUMP_INTERVAL_MS, onTick }) {
  let handle = null;
  let next = 0;
  let running = false;
  const loop = () => {
    if (!running) return;
    const t = now();
    onTick(t);
    next += interval;
    if (next < t) next = t + interval;
    handle = setTimer(loop, Math.max(0, next - now()));
  };
  return {
    start() {
      if (running) return;
      running = true;
      next = now() + interval;
      handle = setTimer(loop, interval);
    },
    stop() {
      running = false;
      if (handle !== null) clearTimer(handle);
      handle = null;
    },
    get running() { return running; },
  };
}

function defaultCreateWorker(source) {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const w = new Worker(url);
  w.__skUrl = url;
  return w;
}

/**
 * @param {object} o
 * @param {(nowMs: number) => void} o.onTick   called on the main thread for every pump message
 * @param {() => number} [o.now]               main-thread clock passed to onTick
 * @param {number} [o.interval]
 * @param {(source: string) => (Worker|null)} [o.createWorker]
 * @param {(fn: () => void, ms: number) => any} [o.setTimer]   fallback timers when there is no Worker
 * @param {(h: any) => void} [o.clearTimer]
 */
export function createTickPump({
  onTick,
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  interval = PUMP_INTERVAL_MS,
  createWorker = defaultCreateWorker,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
} = {}) {
  let worker;
  try { worker = createWorker(PUMP_SOURCE); } catch { worker = null; }
  let running = false;
  let ticks = 0;
  const tick = () => { ticks++; onTick(now()); };
  const fallback = worker ? null : createDriftCorrectedLoop({ now, setTimer, clearTimer, interval, onTick: tick });
  if (worker) worker.onmessage = () => { if (running) tick(); };

  return {
    /** 'worker' when a real (or injected) worker runs the timer, 'timer' for the main-thread fallback. */
    kind: worker ? 'worker' : 'timer',
    start() {
      if (running) return;
      running = true;
      if (worker) worker.postMessage({ cmd: 'start', interval }); else fallback.start();
    },
    stop() {
      if (!running) return;
      running = false;
      if (worker) worker.postMessage({ cmd: 'stop' }); else fallback.stop();
    },
    dispose() {
      this.stop();
      if (worker) {
        worker.terminate?.();
        if (worker.__skUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(worker.__skUrl);
      }
    },
    get running() { return running; },
    get ticks() { return ticks; },
  };
}
