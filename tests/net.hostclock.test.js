// Host clock (NETWORKING.md §9.9, acceptance M1-10 / WS5 #6): one accumulator, rAF + pump drivers,
// catch-up vs skip, pause/resume epochs, pump starvation.
import { describe, it, expect } from 'vitest';
import {
  createHostClock, TIMEBASE_REASON, PAUSE_REASON, MAX_BACKLOG_TICKS, HOST_MAX_PER_CALL,
} from '../src/net/host/hostClock.js';

const TICK = 1000 / 60;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Collects every tick number the clock hands out and checks the sequence as it goes. */
function tickRecorder() {
  const rec = { next: null, count: 0, problems: [], alphas: [] };
  rec.take = (r) => {
    if (r.ticks > 0) {
      if (rec.next !== null && r.firstTick !== rec.next) rec.problems.push(`gap: expected ${rec.next}, got ${r.firstTick}`);
      rec.next = r.firstTick + r.ticks;
      rec.count += r.ticks;
    }
    rec.alphas.push(r.alpha);
  };
  return rec;
}

describe('hostClock: basics', () => {
  it('runs one tick per 1/60 s from the anchor and reports alpha in [0, 1)', () => {
    const tbs = [];
    const c = createHostClock({ onTimebase: (tb) => tbs.push(tb) });
    c.start(1000);
    expect(tbs).toEqual([{ epoch: 0, tick: 1, hostMs: 1000, reason: TIMEBASE_REASON.start }]);
    let r = c.advance(1000);
    expect(r).toMatchObject({ ticks: 1, firstTick: 1, alpha: 0 });
    r = c.advance(1000 + TICK * 0.5);
    expect(r.ticks).toBe(0);
    expect(r.alpha).toBeCloseTo(0.5, 6);
    r = c.advance(1000 + TICK * 3.25);
    expect(r).toMatchObject({ ticks: 3, firstTick: 2 });
    expect(r.alpha).toBeCloseTo(0.25, 6);
    expect(c.lastTick).toBe(4);
  });

  it('starts lazily on the first advance', () => {
    const c = createHostClock();
    const r = c.advance(50);
    expect(r.ticks).toBe(1);
    expect(c.state()).toMatchObject({ started: true, anchorMs: 50, anchorTick: 1 });
  });

  it('keeps the timebase promise: tick k begins at anchorMs + (k - anchorTick) * 1000/60', () => {
    const c = createHostClock();
    c.start(0);
    for (let k = 1; k <= 600; k++) {
      const begin = (k - 1) * TICK;
      // just before its instant the tick has not run, at its instant it has
      if (k > 1) expect(c.advance(begin - 0.01).ticks).toBe(0);
      const r = c.advance(begin + 0.001);
      expect(r.ticks).toBe(1);
      expect(r.firstTick).toBe(k);
    }
  });

  it('sends a periodic TIMEBASE once per second while running, never while paused', () => {
    const tbs = [];
    const c = createHostClock({ onTimebase: (tb) => tbs.push(tb) });
    c.start(0);
    for (let t = 0; t <= 5000; t += TICK) c.advance(t);
    const periodic = tbs.filter((tb) => tb.reason === TIMEBASE_REASON.periodic);
    expect(periodic.length).toBeGreaterThanOrEqual(4);
    expect(periodic.length).toBeLessThanOrEqual(5);
    c.pause(5001);
    const before = tbs.length;
    for (let t = 5001; t <= 9000; t += TICK) c.advance(t);
    expect(tbs.length).toBe(before);
  });

  it('subscribers can be added and removed', () => {
    const c = createHostClock();
    const got = [];
    const off = c.onTimebase((tb) => got.push(tb.reason));
    const offP = c.onPause((p) => got.push(p.paused ? 'P' : 'R'));
    c.start(0);
    c.pause(10);
    off();
    offP();
    c.resume(20);
    expect(got).toEqual([TIMEBASE_REASON.start, 'P', TIMEBASE_REASON.pause]);
  });
});

describe('hostClock: catch-up and skip', () => {
  it('catches a 400 ms stall up at <= 6 ticks per call without a new epoch', () => {
    const tbs = [];
    const c = createHostClock({ onTimebase: (tb) => tbs.push(tb) });
    c.start(0);
    const rec = tickRecorder();
    let t = 0;
    for (; t < 1000; t += TICK) rec.take(c.advance(t));
    t += 400; // stall
    const calls = [];
    for (let i = 0; i < 12; i++, t += TICK) { const r = c.advance(t); calls.push(r.ticks); rec.take(r); }
    expect(Math.max(...calls)).toBe(HOST_MAX_PER_CALL);
    expect(c.epoch).toBe(0);
    expect(tbs.filter((tb) => tb.reason === TIMEBASE_REASON.skip)).toEqual([]);
    // fully caught up: the tick count matches wall time again
    const expected = Math.floor(((t - TICK) * 60) / 1000 + 1e-9) + 1;
    expect(c.lastTick).toBe(expected);
    expect(rec.problems).toEqual([]);
  });

  it('a 2 s stall gives exactly one skip + TIMEBASE (reason 4) and ticks continue in order', () => {
    const tbs = [];
    const c = createHostClock({ onTimebase: (tb) => tbs.push(tb) });
    c.start(0);
    const rec = tickRecorder();
    let t = 0;
    for (; t < 1000; t += TICK) rec.take(c.advance(t));
    const before = c.lastTick;
    t += 2000;
    for (let i = 0; i < 60; i++, t += TICK) rec.take(c.advance(t));
    const skips = tbs.filter((tb) => tb.reason === TIMEBASE_REASON.skip);
    expect(skips).toHaveLength(1);
    expect(skips[0]).toMatchObject({ epoch: 1, tick: before + 1 });
    expect(c.epoch).toBe(1);
    expect(c.state().counters.skips).toBe(1);
    expect(rec.problems).toEqual([]);
  });

  it('never runs a tick before its instant right after a skip re-anchor', () => {
    const c = createHostClock();
    c.start(0);
    c.advance(0);
    const r = c.advance(10000); // big skip
    expect(r.ticks).toBe(1);
    expect(c.advance(10000 + TICK * 0.9).ticks).toBe(0);
    expect(c.advance(10000 + TICK).ticks).toBe(1);
  });

  it('exactly MAX_BACKLOG_TICKS still catches up; one more skips', () => {
    for (const [extra, skip] of [[MAX_BACKLOG_TICKS, false], [MAX_BACKLOG_TICKS + 1, true]]) {
      const c = createHostClock();
      c.start(0);
      c.advance(0);
      c.advance((extra) * TICK + 0.001);
      expect(c.state().counters.skips > 0, `backlog ${extra}`).toBe(skip);
    }
  });
});

describe('hostClock: pause, resume and starvation', () => {
  it('pause freezes the accumulator; resume re-anchors at resumeTick with a new epoch', () => {
    const tbs = [];
    const pauses = [];
    const c = createHostClock({ onTimebase: (tb) => tbs.push(tb), onPause: (p) => pauses.push(p) });
    c.start(0);
    for (let t = 0; t < 500; t += TICK) c.advance(t);
    const pauseTick = c.lastTick;
    expect(c.pause(500)).toEqual({ paused: true, reason: PAUSE_REASON.snack, tick: pauseTick, epoch: 0 });
    expect(c.pause(501)).toBeNull(); // already paused
    for (let t = 500; t < 30500; t += TICK) expect(c.advance(t).ticks).toBe(0);
    expect(c.resume(30500)).toEqual({ paused: false, reason: PAUSE_REASON.snack, tick: pauseTick + 1, epoch: 1 });
    expect(c.resume(30501)).toBeNull();
    expect(tbs.at(-1)).toEqual({ epoch: 1, tick: pauseTick + 1, hostMs: 30500, reason: TIMEBASE_REASON.resume });
    const r = c.advance(30500);
    expect(r).toMatchObject({ ticks: 1, firstTick: pauseTick + 1 });
    expect(pauses.map((p) => p.paused)).toEqual([true, false]);
    expect(c.pause.length).toBeGreaterThanOrEqual(0);
  });

  it('pause/resume before start are no-ops', () => {
    const c = createHostClock();
    expect(c.pause(0)).toBeNull();
    expect(c.resume(0)).toBeNull();
  });

  it('a starved pump (> 1 s without a pump call while it drives) reports PAUSE reason 1 and resumes on a new epoch', () => {
    const pauses = [];
    const tbs = [];
    const c = createHostClock({ onPause: (p) => pauses.push(p), onTimebase: (tb) => tbs.push(tb) });
    c.start(0);
    c.usePump(true);
    const rec = tickRecorder();
    let t = 0;
    for (; t < 1000; t += TICK) rec.take(c.advance(t, { source: 'pump' }));
    t += 3000; // the pump starves for 3 s
    for (let i = 0; i < 30; i++, t += TICK) rec.take(c.advance(t, { source: 'pump' }));
    expect(pauses.map((p) => [p.paused, p.reason])).toEqual([[true, PAUSE_REASON.starved], [false, PAUSE_REASON.starved]]);
    expect(pauses[1].tick).toBe(pauses[0].tick + 1);
    expect(c.epoch).toBe(1);
    expect(tbs.filter((tb) => tb.reason === TIMEBASE_REASON.skip)).toEqual([]);
    expect(rec.problems).toEqual([]);
    expect(c.state().counters.starves).toBe(1);
  });
});

describe('hostClock: rAF and pump drivers', () => {
  it('ignores the pump while rAF is on time, takes over when rAF is > 50 ms stale, hands back after 2 on-time frames', () => {
    const c = createHostClock();
    c.start(0);
    c.advance(0);
    c.advance(TICK);
    expect(c.advance(TICK * 1.5, { source: 'pump' })).toMatchObject({ ignored: true, ticks: 0 });
    // rAF stops; the pump sees a stale rAF and drives
    const r = c.advance(TICK + 60, { source: 'pump' });
    expect(r.ignored).toBeUndefined();
    expect(r.ticks).toBeGreaterThan(0);
    expect(c.state().pumpDriving).toBe(true);
    c.advance(TICK + 80); // first rAF back (late relative to the previous rAF → not on time)
    expect(c.state().pumpDriving).toBe(true);
    c.advance(TICK + 96);
    expect(c.state().pumpDriving).toBe(true);
    c.advance(TICK + 112);
    expect(c.state().pumpDriving).toBe(false);
    expect(c.advance(TICK + 113, { source: 'pump' }).ignored).toBe(true);
  });

  it('usePump(true) makes the pump drive at once even while rAF is fresh; usePump(false) hands back to rAF', () => {
    const c = createHostClock();
    c.start(0);
    c.advance(0);
    c.usePump(true);
    expect(c.advance(5, { source: 'pump' }).ignored).toBeUndefined();
    expect(c.state()).toMatchObject({ hidden: true, pumpDriving: true });
    c.usePump(false);
    c.advance(20);
    c.advance(36);
    c.advance(52);
    expect(c.state().pumpDriving).toBe(false);
  });

  it('10 000 ticks under interleaved fake rAF (60/144 Hz, gaps, hidden periods) and a jittery pump: every tick once, in order, alpha in [0, 1)', () => {
    const rnd = mulberry(7);
    const tbs = [];
    const c = createHostClock({ onTimebase: (tb) => tbs.push(tb) });
    const rec = tickRecorder();
    c.start(0);
    // schedule: visible 60 Hz, visible 144 Hz, a 400 ms stall, hidden 3 s (pump), a 2 s stall, ...
    const phases = [];
    let tEnd = 0;
    const push = (kind, ms, extra = {}) => { phases.push({ kind, from: tEnd, to: tEnd + ms, ...extra }); tEnd += ms; };
    for (let round = 0; round < 9; round++) {
      push('raf', 4000, { hz: 60 });
      push('raf', 4000, { hz: 144 });
      push('stall', 400);
      push('raf', 3000, { hz: 144, gaps: true });
      push('hidden', 3000);
      push('raf', 3000, { hz: 60 });
    }
    push('stall', 2000);
    push('raf', 12000, { hz: 60 });
    const events = [];
    for (const ph of phases) {
      if (ph.kind === 'raf') {
        const step = 1000 / ph.hz;
        for (let t = ph.from; t < ph.to; t += step) {
          if (ph.gaps && rnd() < 0.03) { t += 30 + rnd() * 90; continue; } // dropped frames (up to ~120 ms)
          events.push({ t: t + rnd() * 0.8, src: 'raf' });
        }
      } else if (ph.kind === 'hidden') {
        events.push({ t: ph.from, src: 'hide' });
        events.push({ t: ph.to - 0.001, src: 'show' });
      }
    }
    // the pump posts all the time (it only drives when the clock lets it)
    for (let t = 0; t < tEnd; t += TICK) {
      const inStall = phases.some((ph) => ph.kind === 'stall' && t >= ph.from && t < ph.to);
      if (!inStall) events.push({ t: t + rnd() * 3, src: 'pump' });
    }
    events.sort((a, b) => a.t - b.t);
    const hiddenTicks = [];
    let hiddenStart = null;
    for (const e of events) {
      if (e.src === 'hide') { c.usePump(true); hiddenStart = c.lastTick; continue; }
      if (e.src === 'show') { hiddenTicks.push(c.lastTick - hiddenStart); c.usePump(false); continue; }
      const r = c.advance(e.t, { source: e.src });
      rec.take(r);
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThan(1);
    }
    expect(rec.problems).toEqual([]);
    expect(rec.count).toBeGreaterThanOrEqual(10000);
    // hidden periods of 3 s keep ticking at 60 Hz
    for (const n of hiddenTicks) expect(Math.abs(n - 180)).toBeLessThanOrEqual(3);
    // only the final 2 s stall skips; every 400 ms stall is caught up
    expect(tbs.filter((tb) => tb.reason === TIMEBASE_REASON.skip)).toHaveLength(1);
    expect(c.state().counters.catchUpCalls).toBeGreaterThan(0);
    expect(c.state().counters.pumpTicks).toBeGreaterThan(1000);
    expect(c.state().counters.rafTicks).toBeGreaterThan(5000);
  });
});
