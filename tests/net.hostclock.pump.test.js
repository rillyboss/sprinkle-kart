// Tick pump (NETWORKING.md §9.9): Worker from a Blob, 16.67 ms, drift-corrected, injectable.
import { describe, it, expect, vi } from 'vitest';
import { createTickPump, createDriftCorrectedLoop, PUMP_SOURCE, PUMP_INTERVAL_MS } from '../src/net/tickPump.js';

/** A fake timer world: setTimer/clearTimer + a clock we advance by hand. */
function fakeTimers({ lateness = () => 0 } = {}) {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => { const h = ++id; timers.set(h, { fn, at: now + ms + lateness() }); return h; },
    clearTimer: (h) => { timers.delete(h); },
    run(untilMs) {
      for (;;) {
        let next = null;
        for (const [h, t] of timers) if (t.at <= untilMs && (!next || t.at < next[1].at)) next = [h, t];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = untilMs;
    },
    get pending() { return timers.size; },
  };
}

describe('drift-corrected loop', () => {
  it('ticks at 60 Hz on average even when every timeout fires 4 ms late', () => {
    const ft = fakeTimers({ lateness: () => 4 });
    const ticks = [];
    const loop = createDriftCorrectedLoop({ ...ft, onTick: (t) => ticks.push(t) });
    loop.start();
    ft.run(10000);
    // a naive setInterval(16.67) + 4 ms lateness would give ~485 ticks; the corrected loop stays near 600
    expect(ticks.length).toBeGreaterThanOrEqual(595);
    expect(ticks.length).toBeLessThanOrEqual(601);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(ft.pending).toBe(0);
  });

  it('skips instants it missed instead of bursting after a long block', () => {
    let block = false;
    const ft = fakeTimers({ lateness: () => (block ? 500 : 0) });
    const ticks = [];
    const loop = createDriftCorrectedLoop({ ...ft, onTick: (t) => ticks.push(t) });
    loop.start();
    ft.run(1000);
    block = true;
    ft.run(1100);
    block = false;
    ft.run(3000);
    const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(PUMP_INTERVAL_MS - 1e-6);
    loop.start(); // already running: no second timer
    loop.stop();
    loop.stop();
  });
});

describe('createTickPump', () => {
  it('builds its worker from PUMP_SOURCE, starts/stops it with messages and forwards ticks with the main-thread clock', () => {
    const posted = [];
    let fakeWorker = null;
    const pump = createTickPump({
      now: () => 1234,
      onTick: vi.fn(),
      createWorker: (src) => {
        expect(src).toBe(PUMP_SOURCE);
        fakeWorker = { postMessage: (m) => posted.push(m), terminate: vi.fn(), onmessage: null };
        return fakeWorker;
      },
    });
    expect(pump.kind).toBe('worker');
    fakeWorker.onmessage({ data: 1 }); // not running yet: ignored
    pump.start();
    pump.start();
    expect(posted).toEqual([{ cmd: 'start', interval: PUMP_INTERVAL_MS }]);
    fakeWorker.onmessage({ data: 2 });
    fakeWorker.onmessage({ data: 3 });
    expect(pump.ticks).toBe(2);
    pump.stop();
    fakeWorker.onmessage({ data: 4 });
    expect(pump.ticks).toBe(2);
    expect(posted.at(-1)).toEqual({ cmd: 'stop' });
    pump.dispose();
    expect(fakeWorker.terminate).toHaveBeenCalled();
  });

  it('falls back to drift-corrected timers when no Worker exists (node) or the factory throws', () => {
    for (const createWorker of [() => null, () => { throw new Error('no worker'); }]) {
      const ft = fakeTimers();
      const got = [];
      const pump = createTickPump({ onTick: (t) => got.push(t), createWorker, now: ft.now, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
      expect(pump.kind).toBe('timer');
      pump.start();
      expect(pump.running).toBe(true);
      ft.run(1000);
      expect(got.length).toBeGreaterThanOrEqual(59);
      pump.dispose();
      expect(pump.running).toBe(false);
    }
  });

  it('the default factory is safe in node (no Worker global) and the worker source runs drift-corrected', () => {
    const pump = createTickPump({ onTick: () => {} });
    expect(pump.kind).toBe('timer');
    pump.dispose();
    // execute the worker source in a sandbox with fake timers/performance
    const ft = fakeTimers({ lateness: () => 3 });
    const posts = [];
    const scope = {};
    const fn = new Function('setTimeout', 'clearTimeout', 'performance', 'postMessage', 'scope',
      `${PUMP_SOURCE}; scope.onmessage = onmessage;`);
    fn(ft.setTimer, ft.clearTimer, { now: ft.now }, (m) => posts.push(m), scope);
    scope.onmessage({ data: { cmd: 'start' } });
    ft.run(5000);
    expect(posts.length).toBeGreaterThanOrEqual(297);
    expect(posts.length).toBeLessThanOrEqual(301);
    scope.onmessage({ data: { cmd: 'stop' } });
    const n = posts.length;
    ft.run(6000);
    expect(posts.length).toBe(n);
    scope.onmessage({ data: null }); // junk is ignored
  });
});
