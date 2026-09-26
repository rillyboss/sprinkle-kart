// Host timeline estimate (NETWORKING.md §7.3) and the lead controller (§9.2): unit level.
// The harness-driven pause/stall/starvation recovery is in tests/net.timeline.test.js.
import { describe, it, expect } from 'vitest';
import { createHostTimeline, HARD_RESYNC_COUNT } from '../src/net/guest/hostTimeline.js';
import { createLeadController } from '../src/net/guest/leadController.js';

const TICK = 1000 / 60;
const fixedClock = (offset = 0, rttMs = 0) => ({ hostNow: (ms) => ms + offset, rttMs });

describe('host timeline', () => {
  it('is unknown (0) until the first TIMEBASE, then extrapolates host ticks from the anchor', () => {
    const tl = createHostTimeline({ clock: fixedClock(500) });
    expect(tl.known).toBe(false);
    expect(tl.tickAt(100)).toBe(0);
    tl.onTimebase({ epoch: 0, tick: 1, hostMs: 1000, reason: 1 }); // host tick 1 began at host 1000 = local 500
    expect(tl.tickAt(500)).toBeCloseTo(1, 9);
    expect(tl.tickAt(500 + TICK * 30)).toBeCloseTo(31, 9);
    expect(tl.epoch).toBe(0);
  });

  it('same-epoch TIMEBASE within 1 tick is ignored; > 1 tick off hard-resyncs; newer epochs always win, older ones never', () => {
    const tl = createHostTimeline({ clock: fixedClock(0) });
    tl.onTimebase({ epoch: 3, tick: 100, hostMs: 0 });
    expect(tl.onTimebase({ epoch: 3, tick: 160, hostMs: 1000 + 10 })).toBe(false); // 0.6 tick off
    expect(tl.onTimebase({ epoch: 3, tick: 170, hostMs: 1000 })).toBe(true);
    expect(tl.tickAt(1000)).toBeCloseTo(170, 9);
    expect(tl.onTimebase({ epoch: 2, tick: 5, hostMs: 1000 })).toBe(false);
    expect(tl.onTimebase({ epoch: 4, tick: 171, hostMs: 1500 })).toBe(true);
    expect(tl.epoch).toBe(4);
    expect(tl.onTimebase({ epoch: 3, tick: 999, hostMs: 1500 })).toBe(false);
    // epoch wraps: 255 → 0 is newer
    const w = createHostTimeline({ clock: fixedClock(0) });
    w.onTimebase({ epoch: 255, tick: 1, hostMs: 0 });
    expect(w.onTimebase({ epoch: 0, tick: 50, hostMs: 100 })).toBe(true);
  });

  it('pause freezes tickAt at pauseTick; resume + its TIMEBASE unfreeze on the new epoch', () => {
    const tl = createHostTimeline({ clock: fixedClock(0) });
    tl.onTimebase({ epoch: 0, tick: 1, hostMs: 0 });
    tl.onPause(120);
    expect(tl.paused).toBe(true);
    expect(tl.tickAt(5000)).toBe(120);
    expect(tl.tickAt(30000)).toBe(120);
    tl.onResume(121, 30000);
    expect(tl.paused).toBe(true); // still waiting for the resume TIMEBASE
    expect(tl.tickAt(30100)).toBe(120);
    tl.onTimebase({ epoch: 1, tick: 121, hostMs: 30000 - 20 });
    expect(tl.paused).toBe(false);
    expect(tl.tickAt(30000 - 20 + TICK * 10)).toBeCloseTo(131, 9);
    tl.onResume(500, 1); // not paused: ignored
    expect(tl.paused).toBe(false);
  });

  it('a resume whose TIMEBASE never arrives unfreezes by itself after the grace time', () => {
    const tl = createHostTimeline({ clock: fixedClock(0, 40) });
    tl.onTimebase({ epoch: 0, tick: 1, hostMs: 0 });
    tl.onPause(60);
    tl.onResume(61, 10000);
    expect(tl.tickAt(10200)).toBe(60);
    const t = tl.tickAt(10600);
    expect(t).toBeCloseTo(61 + (600 + 20) / TICK, 6); // anchored one-way (20 ms) before the resume arrived
    expect(tl.paused).toBe(false);
  });

  it('snapshot arrivals slew a slightly wrong anchor (<= 0.25 tick per snapshot) and ignore other epochs', () => {
    const tl = createHostTimeline({ clock: fixedClock(0, 0) });
    tl.onTimebase({ epoch: 0, tick: 0, hostMs: 0 });
    // the truth: host tick k is at local k*TICK + 25 (our anchor is 1.5 ticks early)
    const truth = (k) => k * TICK + 25;
    let steps = 0;
    for (let k = 2; k < 400; k += 2) {
      tl.onSnapshot(k, 0, truth(k));
      steps++;
    }
    expect(tl.tickAt(truth(400)) - 400).toBeCloseTo(0, 1);
    expect(tl.stats.slews).toBeGreaterThan(0);
    expect(tl.stats.slews).toBeLessThanOrEqual(steps);
    tl.onSnapshot(402, 9, truth(402));
    expect(tl.stats.ignored).toBe(1);
  });

  it('a snapshot tick newer than the estimate pulls it forward at once', () => {
    const tl = createHostTimeline({ clock: fixedClock(0, 20) });
    tl.onTimebase({ epoch: 0, tick: 0, hostMs: 0 });
    tl.onSnapshot(200, 0, 1000); // estimate at 1000 ms is 60, but the host already simulated 200
    expect(tl.tickAt(1000)).toBeCloseTo(200 + 10 / TICK, 6);
    expect(tl.stats.pulls).toBe(1);
  });

  it('|median residual| > 3 ticks for 5 snapshots in a row hard-resyncs to the snapshot estimate', () => {
    const tl = createHostTimeline({ clock: fixedClock(0, 0) });
    tl.onTimebase({ epoch: 0, tick: 0, hostMs: 0 });
    // the host is really 10 ticks BEHIND our line (a lost re-anchor): arrivals look late
    for (let i = 0; i < HARD_RESYNC_COUNT + 6; i++) {
      const k = 100 + i * 2;
      tl.onSnapshot(k, 0, (k + 10) * TICK);
    }
    expect(tl.stats.hardResyncs).toBeGreaterThanOrEqual(1);
    const k = 200;
    expect(Math.abs(tl.tickAt((k + 10) * TICK) - k)).toBeLessThan(1);
  });

  it('works with a bare offset clock and exposes one-way ticks', () => {
    const tl = createHostTimeline({ clock: { offset: 100, rttMs: 50 } });
    tl.onTimebase({ epoch: 0, tick: 10, hostMs: 100 });
    expect(tl.tickAt(0)).toBeCloseTo(10, 9);
    expect(tl.oneWayTicks()).toBeCloseTo(25 / TICK, 9);
    const t2 = createHostTimeline({ clock: null, oneWayMs: () => 16.6667 });
    expect(t2.oneWayTicks()).toBeCloseTo(1, 3);
  });
});

describe('lead controller', () => {
  it('starts at RTT/2 + target slack + 1 tick', () => {
    const lc = createLeadController();
    lc.reset(100);
    expect(lc.lead).toBe(Math.ceil(6 / 2) + 2 + 1);
    expect(lc.targetSlack).toBe(2);
  });

  it('slack < 0 for 3 snapshots → +2 ticks at once, then waits a round trip before judging again', () => {
    const lc = createLeadController();
    lc.reset(0);
    const l0 = lc.lead;
    lc.onSlack(-1); lc.onSlack(-128); expect(lc.lead).toBe(l0);
    lc.onSlack(-2);
    expect(lc.lead).toBe(l0 + 2);
    lc.onSlack(-1); lc.onSlack(-1); lc.onSlack(-1);
    expect(lc.lead).toBe(l0 + 2); // cooldown
    expect(lc.stats.jumpsUp).toBe(1);
    expect(lc.stats.missing).toBe(1);
  });

  it('slack > target + 4 for 10 snapshots → −2 ticks at once', () => {
    const lc = createLeadController();
    lc.reset(0);
    lc.update(0);
    const l0 = lc.lead;
    for (let i = 0; i < 9; i++) lc.onSlack(9);
    expect(lc.lead).toBe(l0);
    lc.onSlack(9);
    expect(lc.lead).toBe(l0 - 2);
    expect(lc.stats.jumpsDown).toBe(1);
  });

  it('holds slack in [target−1, target+1] by ±3 % dilation', () => {
    const lc = createLeadController();
    lc.reset(0);
    lc.onSlack(0);
    lc.onSlack(0);
    expect(lc.rate).toBeCloseTo(0.03);
    const l0 = lc.lead;
    lc.update(100);
    expect(lc.lead).toBeCloseTo(l0 + 3, 6);
    for (let i = 0; i < 20; i++) lc.onSlack(5);
    expect(lc.rate).toBeCloseTo(-0.03);
    for (let i = 0; i < 20; i++) lc.onSlack(2);
    expect(lc.rate).toBe(0);
  });

  it('raises the target to 4 under loss > 2 % or a recent burst (and the lead with it), back after 10 s clean', () => {
    const lc = createLeadController();
    lc.reset(0);
    const l0 = lc.lead;
    lc.setLoss({ lossPct: 3, nowMs: 0 });
    expect(lc.targetSlack).toBe(4);
    expect(lc.lead).toBe(l0 + 2);
    lc.setLoss({ lossPct: 0, burst: 2, nowMs: 1000 });
    expect(lc.lossy).toBe(true);
    lc.setLoss({ lossPct: 0, nowMs: 10999 });
    expect(lc.lossy).toBe(true);
    lc.setLoss({ lossPct: 0, nowMs: 11001 });
    expect(lc.lossy).toBe(false);
    expect(lc.lead).toBe(l0);
  });

  it('is frozen while the host is paused', () => {
    const lc = createLeadController();
    lc.reset(0);
    lc.onSlack(0); lc.onSlack(0);
    lc.freeze(true);
    const l0 = lc.lead;
    lc.update(1000);
    for (let i = 0; i < 5; i++) lc.onSlack(-1);
    expect(lc.lead).toBe(l0);
    expect(lc.frozen).toBe(true);
    lc.freeze(false);
    lc.setRtt(50);
    expect(lc.frozen).toBe(false);
  });
});
