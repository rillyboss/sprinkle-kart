// Convergence matrix, Free Race, RTT 50 ms (NETWORKING.md §15, acceptance M1-6 / M1-7 / M1-8, WS5 #1-3):
// loss 0 / 1 / 5 % random and 5 % in 3-packet bursts × jitter 0 / 20 ms × reorder 0 / 10 % (+ 1 % dup).
// Every guest's standings, finish places, lap times (ms) and RESULT match the host's; each event seq is
// applied exactly once; final replica states are within 4 cm; every press is applied exactly once (<= 6 ticks
// late); no remote frame-to-frame jump > 1.5 m. Houses [[2], [1]] + the host's player + 5 CPUs.
import { describe, it, expect } from 'vitest';
import { runMatrixRow } from './helpers/netHarness.js';

describe('convergence matrix: Free Race at 50 ms RTT', () => {
  it('all 16 cells converge', () => {
    const row = runMatrixRow(50);
    expect(row.cells).toHaveLength(16);
    for (const c of row.cells) {
      expect(c.problems, c.name).toEqual([]);
      expect(c.lastSeq, c.name).toBeGreaterThan(50); // a real race with real events
    }
    expect(row.contactN).toBeGreaterThan(200);
    // M1-7: own-kart reconcile error (pooled over every cell): p99 <= 0.5 m outside contact, <= 2 m inside
    expect(row.cleanP99).toBeLessThanOrEqual(0.5);
    expect(row.contactP99).toBeLessThanOrEqual(2);
  });
});
