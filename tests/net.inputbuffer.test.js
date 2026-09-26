// Host input buffer (NETWORKING.md §9.3, acceptance M1-11 / WS5 #7): one case per table row, the
// press resolver, and 10 000 presses under 5 % bursty loss.
import { describe, it, expect } from 'vitest';
import {
  createInputBuffer, createPressResolver, SLACK_MISSING, NEUTRAL_TICK_INPUT,
} from '../src/net/host/inputBuffer.js';

const inp = (o = {}) => ({ ...NEUTRAL_TICK_INPUT, accel: 1, ...o });

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

describe('press resolver', () => {
  it('first observation is the baseline (no press); deltas queue one press per tick', () => {
    const r = createPressResolver();
    expect(r.observe(5, 2, 1)).toEqual({ item: 0, hop: 0 });
    expect(r.hasBaseline).toBe(true);
    expect(r.observe(7, 2, 2)).toEqual({ item: 2, hop: 0 });
    expect(r.dispense(2, false).useItem).toBe(true);
    expect(r.dispense(3, false).useItem).toBe(true);
    expect(r.dispense(4, false).useItem).toBe(false);
  });

  it('ignores stale stamps (counters are cumulative) and wraps mod 8', () => {
    const r = createPressResolver();
    r.observe(6, 0, 10);
    expect(r.observe(1, 0, 12)).toEqual({ item: 3, hop: 0 }); // 6 → 7 → 0 → 1
    expect(r.observe(7, 0, 11)).toEqual({ item: 0, hop: 0 }); // older stamp: no information
    expect(r.pending).toEqual({ item: 3, hop: 0 });
  });

  it('turns a hop press into a drift edge; while held it releases first so the edge lands next tick', () => {
    const r = createPressResolver();
    r.observe(0, 0, 1);
    expect(r.dispense(1, true).drift).toBe(false); // held but never pressed: no edge
    r.observe(0, 1, 2);
    expect(r.dispense(2, true)).toMatchObject({ drift: true, hopPress: true });
    expect(r.dispense(3, true).drift).toBe(true); // still held
    r.observe(0, 2, 4); // a second press while the button still reads "down" (lost release)
    expect(r.dispense(4, true)).toMatchObject({ drift: false, hopPress: false });
    expect(r.dispense(5, true)).toMatchObject({ drift: true, hopPress: true });
    expect(r.dispense(6, false).drift).toBe(false);
  });

  it('drops presses older than 250 ms', () => {
    const r = createPressResolver();
    r.observe(0, 0, 0);
    r.observe(3, 0, 10);
    expect(r.dispense(10, false).useItem).toBe(true);
    expect(r.dispense(26, false).useItem).toBe(false); // 16 ticks after the stamp (> 15 = 250 ms)
    expect(r.stats.stalePresses).toBe(2);
  });

  it('reset() forgets the baseline and baseline() clears the queue', () => {
    const r = createPressResolver();
    r.observe(0, 0, 0);
    r.observe(2, 1, 1);
    r.baseline(4, 4, 2);
    expect(r.pending).toEqual({ item: 0, hop: 0 });
    r.reset();
    expect(r.hasBaseline).toBe(false);
    expect(r.observe(7, 7, 3)).toEqual({ item: 0, hop: 0 });
  });
});

describe('input buffer: §9.3 table rows', () => {
  it('row 1: input for T present → used on time (analog exact)', () => {
    const b = createInputBuffer();
    expect(b.push(1, [inp({ steer: 0.5, brake: 0.2, lookBack: true, assisted: true })])).toBe('stored');
    const r = b.take(1);
    expect(r.status).toBe('on-time');
    expect(r.inputs[0]).toEqual({ steer: 0.5, accel: 1, brake: 0.2, drift: false, useItem: false, lookBack: true, robo: false, assisted: true });
    expect(b.lastConsumed).toBe(1);
  });

  it('duplicates are ignored, far-future ticks refused, empty pushes ignored', () => {
    const b = createInputBuffer({ size: 64 });
    b.push(3, [inp()]);
    expect(b.push(3, [inp({ steer: 1 })])).toBe('dup');
    expect(b.push(200, [inp()])).toBe('future');
    expect(b.push(4, [])).toBe('dup');
    expect(b.stats.dup).toBe(1);
  });

  it('row 2: missing and last input <= 250 ms old → repeated with press counters unchanged (no new press)', () => {
    const b = createInputBuffer();
    b.push(1, [inp({ steer: -0.4, drift: false, itemCount: 0 })]);
    b.take(1);
    b.push(2, [inp({ steer: -0.4, drift: true, itemCount: 1, hopCount: 1 })]);
    const on = b.take(2);
    expect(on.inputs[0]).toMatchObject({ useItem: true, drift: true });
    for (let t = 3; t <= 17; t++) {
      const r = b.take(t);
      expect(r.status).toBe('repeated');
      expect(r.coasting).toBe(false);
      expect(r.inputs[0]).toMatchObject({ steer: -0.4, accel: 1, useItem: false, drift: true });
    }
  });

  it('row 3: an input that arrives after its tick was simulated → analog dropped, press deltas queued (late, never lost)', () => {
    const b = createInputBuffer();
    b.push(1, [inp({ steer: 0.1 })]);
    b.take(1);
    b.take(2); // tick 2 missing → repeated
    expect(b.push(2, [inp({ steer: 0.9, itemCount: 1 })])).toBe('late');
    const r = b.take(3);
    expect(r.status).toBe('repeated');
    expect(r.inputs[0].steer).toBeCloseTo(0.1); // the late analog is never used
    expect(r.inputs[0].useItem).toBe(true); // but the press still happens (1 tick late)
    expect(b.stats.late).toBe(1);
  });

  it('row 4: a counter delta of 2+ (double tap) → presses on 2 consecutive ticks; queued presses older than 250 ms dropped', () => {
    const b = createInputBuffer();
    b.push(1, [inp({ itemCount: 0 })]);
    b.take(1);
    b.push(2, [inp({ itemCount: 2 })]); // double tap within one tick (triple boost!)
    b.push(3, [inp({ itemCount: 2 })]);
    b.push(4, [inp({ itemCount: 2 })]);
    const used = [b.take(2), b.take(3), b.take(4)].map((r) => r.inputs[0].useItem);
    expect(used).toEqual([true, true, false]);
    // very late presses are dropped instead of surprising the player
    const c = createInputBuffer();
    c.push(1, [inp()]);
    c.take(1);
    for (let t = 2; t <= 40; t++) c.take(t);
    c.push(20, [inp({ itemCount: 3 })]); // arrives at host tick 40, stamped 20: 20 ticks > 250 ms
    c.push(41, [inp({ itemCount: 3 })]);
    expect(c.take(41).inputs[0].useItem).toBe(false);
  });

  it('row 5: counters wrap mod 8 against the last SEEN value', () => {
    const b = createInputBuffer();
    b.push(1, [inp({ itemCount: 6 })]);
    b.take(1);
    b.push(2, [inp({ itemCount: 1 })]); // 3 presses across the wrap
    const got = [];
    for (let t = 2; t <= 6; t++) { if (t > 2) b.push(t, [inp({ itemCount: 1 })]); got.push(b.take(t).inputs[0].useItem); }
    expect(got).toEqual([true, true, true, false, false]);
  });

  it('row 6: missing > 250 ms → steer eases to 0 over 0.25 s while accel is held (coast)', () => {
    const b = createInputBuffer();
    b.push(1, [inp({ steer: 1, accel: 0.8 })]);
    b.take(1);
    const steer = [];
    for (let t = 2; t <= 40; t++) {
      const r = b.take(t);
      expect(r.status).toBe('repeated');
      expect(r.inputs[0].accel).toBe(0.8);
      steer.push(r.inputs[0].steer);
    }
    expect(steer.slice(0, 15).every((s) => s === 1)).toBe(true); // ≤ 250 ms: held
    expect(steer[16]).toBeLessThan(1);
    for (let i = 16; i < steer.length; i++) expect(steer[i]).toBeLessThanOrEqual(steer[i - 1]);
    expect(steer.at(-1)).toBe(0); // eased to 0 by 0.5 s
  });

  it('row 7: missing > 1.5 s → Robo Driver (and within 1.6 s); the robo bit → Robo Driver at once', () => {
    const b = createInputBuffer();
    b.push(1, [inp()]);
    b.take(1);
    let roboAt = null;
    for (let t = 2; t <= 200 && roboAt === null; t++) if (b.take(t).status === 'robo') roboAt = t;
    expect((roboAt - 1) / 60).toBeGreaterThan(1.5);
    expect((roboAt - 1) / 60).toBeLessThanOrEqual(1.6);
    expect(b.robo).toBe(true);
    const c = createInputBuffer();
    c.push(1, [inp()]);
    c.take(1);
    c.push(2, [inp({ robo: true })]);
    const r = c.take(2);
    expect(r.status).toBe('robo');
    expect(r.roboChanged).toBe(true);
    expect(r.inputs[0].robo).toBe(true);
  });

  it('row 8: inputs resume after Robo Driver → baseline with no press, control back on that very tick', () => {
    const b = createInputBuffer();
    b.push(1, [inp({ itemCount: 0, hopCount: 0 })]);
    b.take(1);
    for (let t = 2; t <= 120; t++) b.take(t); // 2 s outage → robo
    expect(b.robo).toBe(true);
    // meanwhile the guest pressed item 3× and is holding drift: none of that may fire now
    b.push(121, [inp({ itemCount: 3, hopCount: 2, drift: true, steer: 0.7 })]);
    const r = b.take(121);
    expect(r.status).toBe('on-time');
    expect(r.roboChanged).toBe(true);
    expect(r.inputs[0]).toMatchObject({ steer: 0.7, useItem: false, drift: false, robo: false });
    b.push(122, [inp({ itemCount: 3, hopCount: 2, drift: true })]);
    expect(b.take(122).inputs[0]).toMatchObject({ useItem: false, drift: false }); // still held: no phantom hop
    b.push(123, [inp({ itemCount: 4, hopCount: 3, drift: true })]);
    expect(b.take(123).inputs[0]).toMatchObject({ useItem: true, drift: true });
  });

  it('row 8b: rebaseline() (HELLO / RESYNC / reconnect) clears queued presses; no phantom press after it', () => {
    const b = createInputBuffer();
    b.push(1, [inp({ itemCount: 0 })]);
    b.take(1);
    b.push(2, [inp({ itemCount: 2 })]);
    expect(b.take(2).inputs[0].useItem).toBe(true);
    b.rebaseline(); // one press still queued, and the counters jump after the reconnect
    b.push(3, [inp({ itemCount: 6 })]);
    expect(b.take(3).inputs[0].useItem).toBe(false);
    b.push(4, [inp({ itemCount: 6 })]);
    expect(b.take(4).inputs[0].useItem).toBe(false);
    expect(b.stats.rebaselines).toBe(1);
  });

  it('host-forced Robo Driver (house asleep) and hand-back via setRobo(false) → rebaseline', () => {
    const b = createInputBuffer();
    b.push(1, [inp({ itemCount: 1 })]);
    b.take(1);
    b.setRobo(true);
    b.push(2, [inp({ itemCount: 2 })]);
    expect(b.take(2).status).toBe('robo');
    b.setRobo(false);
    b.setRobo(false); // idempotent
    b.push(3, [inp({ itemCount: 5 })]);
    const r = b.take(3);
    expect(r.status).toBe('on-time');
    expect(r.inputs[0].useItem).toBe(false);
  });

  it('before the first input arrives the kart waits (neutral, repeated) instead of calling Robo Driver', () => {
    const b = createInputBuffer();
    const r = b.take(1);
    expect(r.status).toBe('repeated');
    expect(r.inputs[0]).toMatchObject({ accel: 0, steer: 0, useItem: false });
    for (let t = 2; t <= 80; t++) expect(b.take(t).status).toBe('repeated');
  });

  it('slack(): ticks early at first arrival, SLACK_MISSING when it never arrived in time', () => {
    const b = createInputBuffer();
    b.push(5, [inp()]); // lastConsumed 0 → needed at tick 5: 4 ticks early
    b.push(5, [inp()]);
    expect(b.slack(5)).toBe(4);
    expect(b.slack(6)).toBe(SLACK_MISSING);
    for (let t = 1; t <= 5; t++) b.take(t);
    b.push(6, [inp()]);
    expect(b.slack(6)).toBe(0);
  });

  it('keeps several local players of one house apart (seat order)', () => {
    const b = createInputBuffer();
    b.push(1, [inp({ steer: -1 }), inp({ steer: 1, itemCount: 0 })]);
    b.take(1);
    b.push(2, [inp({ steer: -1 }), inp({ steer: 1, itemCount: 1 })]);
    const r = b.take(2);
    expect(r.inputs.map((i) => [i.steer, i.useItem])).toEqual([[-1, false], [1, true]]);
    expect(b.pending()).toEqual([{ item: 0, hop: 0 }, { item: 0, hop: 0 }]);
    expect(b.occupancy).toBe(0);
  });
});

/**
 * A little tick-level model of the guest → host input path: the guest predicts `lead` ticks ahead,
 * sends every 2nd tick with the newest `n` ticks, packets take `oneWay` ticks, a loss model eats some.
 */
function runPressModel({ presses = 10000, lossFn, oneWay = 4, slack = 2, n = 6, seed = 1, holdDrift = false }) {
  const rnd = mulberry(seed);
  const buf = createInputBuffer();
  const lead = oneWay + slack;
  let item = 0;
  let hop = 0;
  const history = new Map();
  const pressTicks = { item: [], hop: [] };
  const applied = { item: [], hop: [] };
  const inflight = [];
  let host = 0;
  let pressed = 0;
  let nextPress = 40; // after the first inputs reached the host (they set the baseline)
  let drift = false;
  let guestTick = 0;
  let lastPressAt = 0;
  while (pressed < presses || host < lastPressAt + 30) {
    // guest predicts the next tick(s) so that guestTick = host + lead
    while (guestTick < host + lead) {
      guestTick++;
      if (pressed < presses && guestTick >= nextPress) {
        if (rnd() < 0.5) { item++; pressTicks.item.push(guestTick); } else { hop++; pressTicks.hop.push(guestTick); drift = true; }
        pressed++;
        lastPressAt = guestTick;
        nextPress = guestTick + 2 + Math.floor(rnd() * 12); // sometimes 2 ticks apart (double tap)
      } else if (!holdDrift) drift = false;
      history.set(guestTick, { ...NEUTRAL_TICK_INPUT, accel: 1, drift, itemCount: item & 7, hopCount: hop & 7 });
      if (guestTick % 2 === 0) {
        const ticks = [];
        for (let t = guestTick; t > guestTick - n && t > 0; t--) ticks.push(t);
        if (!lossFn()) inflight.push({ at: host + oneWay, ticks: ticks.map((t) => [t, history.get(t)]) });
      }
    }
    host++;
    for (let i = inflight.length - 1; i >= 0; i--) {
      if (inflight[i].at <= host - 1) { for (const [t, x] of inflight[i].ticks) buf.push(t, [x]); inflight.splice(i, 1); }
    }
    const r = buf.take(host);
    if (r.presses[0]?.item) applied.item.push(host);
    if (r.presses[0]?.hop) applied.hop.push(host);
  }
  return { pressTicks, applied, buf };
}

function gilbertElliott({ loss, burstLen, rnd }) {
  // two-state model: mean burst `burstLen`, long-run loss `loss`
  const pBG = 1 / burstLen;
  const pGB = (loss * pBG) / (1 - loss);
  let bad = false;
  return () => {
    bad = bad ? rnd() >= pBG : rnd() < pGB;
    return bad;
  };
}

/** Bursts of exactly `burstLen` packets, always followed by at least one delivered packet. */
function fixedBursts({ loss, burstLen, rnd }) {
  let left = 0;
  let cool = false;
  const start = loss / burstLen / (1 - loss - loss / burstLen);
  return () => {
    if (left > 0) { left--; if (!left) cool = true; return true; }
    if (cool) { cool = false; return false; }
    if (rnd() < start) { left = burstLen - 1; return true; }
    return false;
  };
}

function lateness(pressTicks, applied) {
  expect(applied.length).toBe(pressTicks.length); // each press exactly once
  return pressTicks.map((t, i) => applied[i] - t);
}

describe('input buffer: presses under bursty loss (M1-11)', () => {
  it('10 000 presses (item + hop) under 5 % loss in 3-packet bursts: each applied exactly once, <= 6 ticks late', () => {
    const rnd = mulberry(99);
    const { pressTicks, applied } = runPressModel({ presses: 10000, lossFn: fixedBursts({ loss: 0.05, burstLen: 3, rnd }), seed: 5, slack: 4, n: 8 }); // the lead controller's target under bursts
    const late = [...lateness(pressTicks.item, applied.item), ...lateness(pressTicks.hop, applied.hop)];
    expect(late.length).toBe(10000);
    expect(Math.min(...late)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...late)).toBeLessThanOrEqual(6);
    expect(late.filter((l) => l > 0).length).toBeGreaterThan(0); // the loss really bit
    expect(late.filter((l) => l > 0).length / late.length).toBeLessThan(0.05);
  });

  it('under Gilbert–Elliott loss (5 %, mean burst 3) every press is still applied exactly once, p99 <= 6 ticks late', () => {
    const rnd = mulberry(3);
    const { pressTicks, applied, buf } = runPressModel({ presses: 10000, lossFn: gilbertElliott({ loss: 0.05, burstLen: 3, rnd }), seed: 8, slack: 4, n: 8 });
    const late = [...lateness(pressTicks.item, applied.item), ...lateness(pressTicks.hop, applied.hop)].sort((a, b) => a - b);
    expect(late[Math.floor(late.length * 0.99)]).toBeLessThanOrEqual(8);
    expect(late[Math.floor(late.length * 0.95)]).toBeLessThanOrEqual(2);
    expect(buf.stats.stalePresses ?? 0).toBe(0);
  });

  it('with no loss every press lands exactly on its tick', () => {
    const { pressTicks, applied } = runPressModel({ presses: 2000, lossFn: () => false, seed: 2 });
    expect(lateness(pressTicks.item, applied.item).every((l) => l === 0)).toBe(true);
    expect(lateness(pressTicks.hop, applied.hop).every((l) => l === 0)).toBe(true);
  });

  it('a drift tap (1–2 ticks) lost in a burst still produces the hop on the host', () => {
    const b = createInputBuffer();
    const x = (tick, o) => [tick, [inp(o)]];
    b.push(...x(1, { hopCount: 0 }));
    b.take(1);
    // ticks 2-3 (the tap) are lost; tick 4 arrives with the counter already bumped and the button up
    b.take(2);
    b.take(3);
    b.push(...x(4, { hopCount: 1, drift: false }));
    const r = b.take(4);
    expect(r.presses[0].hop).toBe(true);
    expect(r.inputs[0].drift).toBe(true);
    b.push(...x(5, { hopCount: 1, drift: false }));
    expect(b.take(5).inputs[0].drift).toBe(false);
  });
});
