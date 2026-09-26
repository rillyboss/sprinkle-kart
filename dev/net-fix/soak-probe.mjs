// Throwaway probe (not a test): which soak-lite race shows a remote jump, and what the lead did.
import { runNetRace, convergenceProblems } from '../../tests/helpers/netHarness.js';

const TRACKS = ['gumdrop-meadow', 'cotton-candy-castle', 'cupcake-carnival', 'starlight-galaxy', 'mermaid-lagoon'];
const only = process.argv[2] ? Number(process.argv[2]) : null;
for (let i = 0; i < 10; i++) {
  if (only !== null && i !== only) continue;
  const pauses = i === 2 || i === 7 ? [{ atMs: 12000, ms: 30000 }] : [];
  const r = runNetRace({
    track: TRACKS[i % TRACKS.length], houses: [[2], [1]], laps: 1, seed: 100 + i, clockOffsets: [23456.5, 34567.25],
    conditions: { latencyMs: 75, jitterMs: 20, loss: 0.03 }, pauses,
  });
  const problems = convergenceProblems(r, { rttMs: 150, contact: false });
  const g = r.guests[0];
  const big = g.metrics.jumps.filter((j) => j.d > 5).map((j) => ({ t: Math.round(j.t), kart: j.kart, d: +j.d.toFixed(2), handover: j.handover }));
  console.log(i, JSON.stringify(problems), 'lead max', Math.max(...g.metrics.leadLog.map((x) => x.lead)).toFixed(1), JSON.stringify(g.metrics.stats.leadJumps), JSON.stringify(big.slice(0, 5)));
}
