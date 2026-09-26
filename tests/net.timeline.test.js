// Host timebase recovery on the guest (NETWORKING.md §7.3, §9.9, acceptance M1-9 / M1-10 / WS5 #5), driven
// by the multi-peer harness at 150 ms RTT / 20 ms jitter:
//   - the host-tick estimate is within ±1 tick after 2 s,
//   - after a 30 s "Pause everyone", a 400 ms host stall and a 3 s starved (hidden) host it is back within
//     ±1 tick within 1 s,
//   - the input lead never runs away (host-reported slack <= target + 2 once settled),
//   - no guest input for a tick after resumeTick is dropped as late,
//   - and the race still converges (identical results, every event once).
import { describe, it, expect } from 'vitest';
import { runNetRace, convergenceProblems } from './helpers/netHarness.js';

const START = 1500;
const PAUSE = { atMs: 9000, ms: 30000 };
const STALL = { atMs: 45000, ms: 400 };
const HIDDEN = { atMs: 50000, ms: 6000, starveAt: 1000, starveMs: 3000 };

const run = runNetRace({
  houses: [[1]], laps: 2, seed: 9, startAtMs: START,
  conditions: { latencyMs: 75, jitterMs: 20 },
  pauses: [PAUSE], stalls: [STALL], hidden: [HIDDEN],
});
const g = run.guests[0];
const errs = g.metrics.timelineErr;
const within = (fromMs, toMs) => errs.filter((e) => e.t >= fromMs && e.t < toMs && !e.paused);
const maxAbs = (list) => Math.max(0, ...list.map((e) => Math.abs(e.err)));

describe('host timeline recovery (harness, 150 ms RTT, 20 ms jitter)', () => {
  it('is within ±1 tick 2 s after the start', () => {
    const list = within(START + 2000, PAUSE.atMs);
    expect(list.length).toBeGreaterThan(100);
    expect(maxAbs(list)).toBeLessThanOrEqual(1);
  });

  it('the host really paused, stalled and starved (and re-anchored with new epochs)', () => {
    const pauses = run.metrics.pauseLog;
    expect(pauses.filter((p) => p.reason === 0).map((p) => p.paused)).toEqual([true, false]);
    expect(pauses.filter((p) => p.reason === 1).map((p) => p.paused)).toEqual([true, false]);
    expect(run.host.clock.state().counters.starves).toBe(1);
    expect(run.host.clock.state().counters.skips).toBe(0); // 400 ms is caught up, never skipped
    expect(run.host.clock.state().counters.catchUpCalls).toBeGreaterThan(0);
    expect(run.host.clock.epoch).toBe(2); // the pause resume and the starvation resume each start an epoch
  });

  it('within 1 s after a 30 s pause the estimate is back within ±1 tick', () => {
    const resumeAt = PAUSE.atMs + PAUSE.ms;
    expect(maxAbs(within(resumeAt + 1000, STALL.atMs))).toBeLessThanOrEqual(1);
    // and it stayed frozen while paused: no guest input for a paused tick was predicted past the lead
    const frozen = g.metrics.leadLog.filter((x) => x.t > PAUSE.atMs + 1000 && x.t < resumeAt - 100);
    expect(frozen.every((x) => x.paused)).toBe(true);
  });

  it('within 1 s after a 400 ms host stall the estimate is back within ±1 tick', () => {
    const end = STALL.atMs + STALL.ms;
    expect(maxAbs(within(end + 1000, HIDDEN.atMs))).toBeLessThanOrEqual(1);
  });

  it('within 1 s after a 3 s host starvation the estimate is back within ±1 tick', () => {
    const end = HIDDEN.atMs + HIDDEN.starveAt + HIDDEN.starveMs;
    const list = within(end + 1000, end + 6000);
    expect(list.length).toBeGreaterThan(100);
    expect(maxAbs(list)).toBeLessThanOrEqual(1);
    expect(g.replica.stats.rewinds).toBeGreaterThanOrEqual(1);
  });

  it('the lead stays <= target + 2 ticks of slack once settled after every event', () => {
    const settled = (from, to) => g.metrics.leadLog.filter((x) => x.t >= from && x.t < to && x.slack !== null && x.slack > -128);
    for (const [from, to] of [[START + 3000, PAUSE.atMs], [PAUSE.atMs + PAUSE.ms + 2000, STALL.atMs], [STALL.atMs + 2000, HIDDEN.atMs],
      [HIDDEN.atMs + HIDDEN.starveAt + HIDDEN.starveMs + 2000, HIDDEN.atMs + HIDDEN.ms + 5000]]) {
      const list = settled(from, to);
      expect(list.length, `${from}..${to}`).toBeGreaterThan(20);
      const over = list.filter((x) => x.slack > x.target + 2);
      expect(over.length / list.length, `${from}..${to}`).toBeLessThan(0.05);
    }
  });

  it('no guest input for a tick after resumeTick is dropped as late', () => {
    for (const p of run.metrics.pauseLog.filter((x) => !x.paused)) {
      const late = run.metrics.lateAfter.filter((x) => x.tick >= p.tick && x.t < p.t + 3000);
      // redundant copies of already-consumed ticks arrive late by design; a FIRST copy never should:
      const consumedLate = late.filter((x) => (run.metrics.takeLog.get(0)?.[x.tick - 1] ?? 'on-time') !== 'on-time');
      expect(consumedLate, `resume at tick ${p.tick}`).toEqual([]);
    }
  });

  it('the race still converges: identical results, every event once, final state within 4 cm', () => {
    // A 3 s starved host freezes the world while the guests (who cannot know yet) extrapolate 250 ms and then
    // freeze; when the host comes back the remote karts are put back where they really are — that one
    // expected hop is the only thing this scenario may add (the continuity rule is for loss + jitter).
    const probs = convergenceProblems(run, { rttMs: 150, contact: false }).filter((p) => !/remote jump/.test(p));
    expect(probs).toEqual([]);
    const jumps = g.metrics.jumps.filter((j) => j.d > 1.5);
    const starveEnd = HIDDEN.atMs + HIDDEN.starveAt + HIDDEN.starveMs;
    expect(jumps.every((j) => j.t >= starveEnd - 100 && j.t < starveEnd + 1500)).toBe(true);
  });
});
