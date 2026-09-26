// Input lead after an upload-only outage (net review #7): Wi-Fi upload loss is often one-way. Before the fix
// every −128 ("the host has nothing for that tick") counted as late and the lead ratcheted up ~6 ticks a second
// (28.7 after a 3 s outage, still 25 two seconds later), so the guest predicted 0.5–0.9 s ahead and replayed
// 30–55 ticks per snapshot. Now −128 is no information, late inputs are reported as real negative slack, and a
// lead far above target comes down by half the excess per jump.
import { describe, it, expect } from 'vitest';
import { runNetRace } from './helpers/netHarness.js';
import { createInputBuffer, SLACK_MISSING, LATE_REPORT_TICKS } from '../src/net/host/inputBuffer.js';

const P = () => [{ steer: 0, accel: 1, brake: 0, drift: false, itemCount: 0, hopCount: 0, robo: false }];

describe('host input buffer slack', () => {
  it('on time → positive slack; late → real negative slack for a few ticks; silence → SLACK_MISSING', () => {
    const b = createInputBuffer();
    b.push(12, P(12));
    b.take(10);
    expect(b.slack(12)).toBeGreaterThan(0);
    b.take(11); b.take(12); b.take(13); b.take(14);
    // nothing for 15: silence
    b.take(15);
    expect(b.slack(15)).toBe(SLACK_MISSING);
    // tick 14's input arrives after 15 was simulated: 2 ticks late
    b.push(14, P(14));
    expect(b.slack(16)).toBe(-2);
    for (let t = 16; t <= 15 + LATE_REPORT_TICKS; t++) b.take(t);
    expect(b.slack(15 + LATE_REPORT_TICKS)).toBe(-2);
    b.take(16 + LATE_REPORT_TICKS);
    expect(b.slack(17 + LATE_REPORT_TICKS)).toBe(SLACK_MISSING);
  });
});

function outageRun({ ms, both = false }) {
  const r = runNetRace({
    houses: [[1]], laps: 2, seed: 5, conditions: { latencyMs: 25, jitterMs: 5 },
    outages: [{ guest: 0, atMs: 20000, ms, both }], maxSeconds: 60,
  });
  const log = r.guests[0].metrics.leadLog.filter((x) => !x.paused);
  const at = (t) => log.find((x) => x.t >= t);
  const before = at(19000);
  const inOutage = log.filter((x) => x.t >= 20000 && x.t <= 20000 + ms);
  const after = (s) => at(20000 + ms + s * 1000);
  return { r, before, inOutage, after, max: Math.max(...log.map((x) => x.lead)) };
}

describe('lead after an upload-only outage (review #7)', () => {
  it('3 s guest→host outage: no ratchet during it, back within target + 2 within 3 s', () => {
    const o = outageRun({ ms: 3000 });
    expect(o.before).toBeTruthy();
    const base = o.before.lead;
    expect(Math.max(...o.inOutage.map((x) => x.lead))).toBeLessThanOrEqual(base + 2.5);
    const back = o.after(3);
    expect(back.lead).toBeLessThanOrEqual(base + 2);
    expect(o.max).toBeLessThan(base + 6);
    expect(o.r.guests[0].metrics.stats.leadJumps.jumpsUp).toBeLessThanOrEqual(1);
  });

  it('6 s outage: the lead never balloons (was 58 ticks), and the same outage both ways leaves it alone', () => {
    const one = outageRun({ ms: 6000 });
    expect(one.max).toBeLessThan(one.before.lead + 6);
    expect(one.after(3).lead).toBeLessThanOrEqual(one.before.lead + 2);
    const both = outageRun({ ms: 3000, both: true });
    // both ways the snapshots stop too: that is a burst, so the lossy target (+2) holds for 10 s — no ratchet
    expect(both.after(3).lead).toBeLessThanOrEqual(both.before.lead + 2 + 2.5);
    expect(both.r.guests[0].metrics.stats.leadJumps.jumpsUp).toBeLessThanOrEqual(1);
  });
});
