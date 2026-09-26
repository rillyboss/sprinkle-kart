// Throwaway probe: why guests' own karts spin (host truth), RTT 150.
import { runNetRace } from '../../tests/helpers/netHarness.js';
const causes = {};
for (let seed = 1; seed <= 10; seed++) {
  const r = runNetRace({ houses: [[1], [1], [1]], laps: 2, seed, conditions: { latencyMs: 75, jitterMs: 10, loss: 0.01 } });
  const own = new Set(r.host.houseKarts.flat());
  for (const e of r.events) if (e.type === 'bonked' && own.has(e.kart)) causes[e.cause] = (causes[e.cause] || 0) + 1;
}
console.log(JSON.stringify(causes));
