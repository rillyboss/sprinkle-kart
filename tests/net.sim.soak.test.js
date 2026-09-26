// Soak-lite (WS5 acceptance #10; the long browser/GP soak is WS8's tests/net.soak.test.js): 10 Free Races at
// 150 ms / 3 % loss / 20 ms jitter with two 30 s "Pause everyone" snack breaks. Every race converges (identical
// results, every event once, final state within 4 cm), buffers stay bounded, and the clock offset estimate
// never drifts.
import { describe, it, expect } from 'vitest';
import { runNetRace, convergenceProblems } from './helpers/netHarness.js';

const TRACKS = ['gumdrop-meadow', 'cotton-candy-castle', 'cupcake-carnival', 'starlight-galaxy', 'mermaid-lagoon'];

describe('soak-lite: 10 Free Races with two 30 s pauses', () => {
  it('no divergence, bounded buffers, no clock drift', () => {
    const offsets = [23456.5, 34567.25];
    const HOST_OFFSET = 1000.5; // the harness host clock = t + 1000.5
    const report = [];
    for (let i = 0; i < 10; i++) {
      const pauses = i === 2 || i === 7 ? [{ atMs: 12000, ms: 30000 }] : [];
      const r = runNetRace({
        track: TRACKS[i % TRACKS.length], houses: [[2], [1]], laps: 1, seed: 100 + i, clockOffsets: offsets,
        conditions: { latencyMs: 75, jitterMs: 20, loss: 0.03 }, pauses,
      });
      const problems = convergenceProblems(r, { rttMs: 150, contact: false });
      expect(problems, `race ${i}`).toEqual([]);
      expect(r.finishedAt, `race ${i}`).not.toBeNull();
      if (pauses.length) expect(r.metrics.pauseLog.filter((p) => p.reason === 0)).toHaveLength(2);
      // bounded buffers everywhere
      const hs = r.metrics.hostStats;
      expect(hs.eventLogSize).toBeLessThanOrEqual(512);
      for (const h of Object.values(hs.houses)) expect(h.buffer.occupancy).toBeLessThanOrEqual(64);
      r.guests.forEach((g, gi) => {
        expect(g.metrics.bufferSize).toBeLessThanOrEqual(32);
        expect(g.metrics.historySize).toBeLessThanOrEqual(128);
        expect(g.metrics.pendingEvents).toBeLessThanOrEqual(8);
        expect(g.replica.acceptedSeqs.length).toBe(r.lastSeq);
        // clock offset: estimated host − guest vs the truth (the harness knows both clocks)
        const truth = HOST_OFFSET - offsets[gi];
        const est = g.metrics.stats.clock;
        expect(est.ready).toBe(true);
        report.push({ race: i, guest: gi, offsetErr: Math.abs(est.offset - truth) });
      });
    }
    // symmetric jitter keeps the NTP offset estimate within a few ms of the truth, race after race
    for (const x of report) expect(x.offsetErr, `race ${x.race} guest ${x.guest}`).toBeLessThan(15);
  });
});
