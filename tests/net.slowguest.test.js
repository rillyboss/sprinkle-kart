// A very slow guest (net review #14): below ~5 fps a frame spans more ticks than the replica predicts at once.
// Those ticks used to get no input at all, so the host repeated a stale input for most of the race (2110 of
// 2785 ticks in the swiftshader e2e). The replica now records (and sends) an input for up to a second of
// skipped ticks and predicts the newest ones; the next snapshot's replay catches the kart up.
import { describe, it, expect } from 'vitest';
import { runNetRace, convergenceProblems } from './helpers/netHarness.js';
import { MAX_PREDICT_TICKS, MAX_FILL_TICKS } from '../src/net/guest/replicaRace.js';

function slow(fps) {
  const r = runNetRace({ houses: [[1]], laps: 1, seed: 5, conditions: { latencyMs: 25, jitterMs: 5 }, guestFrameMs: 1000 / fps });
  const counts = Object.values(r.metrics.hostStats.houses)[0].statusCounts;
  const total = counts['on-time'] + counts.repeated + counts.robo;
  return { r, counts, repeatedShare: counts.repeated / total, roboShare: counts.robo / total };
}

describe('slow guests still drive every tick', () => {
  it('limits: predict up to MAX_PREDICT_TICKS a frame, record up to MAX_FILL_TICKS more', () => {
    expect(MAX_PREDICT_TICKS).toBeGreaterThanOrEqual(20);
    expect(MAX_FILL_TICKS).toBeGreaterThanOrEqual(36);
  });

  for (const fps of [5, 2]) {
    it(`${fps} fps guest: the host rarely repeats a stale input, results converge`, () => {
      const s = slow(fps);
      expect(s.repeatedShare).toBeLessThan(0.1);
      expect(s.roboShare).toBeLessThan(0.05);
      // identical results / events everywhere; at 2 fps the prediction itself is coarse (one stick sample per
      // half second), so only the drawing-quality numbers are left out there
      const skip = fps < 3 ? /jump|reconcile/ : /jump/;
      expect(convergenceProblems(s.r, { rttMs: 50, contact: false }).filter((p) => !skip.test(p))).toEqual([]);
      if (fps < 3) expect(s.r.guests[0].replica.stats.filled ?? 0).toBeGreaterThan(100);
    });
  }
});
