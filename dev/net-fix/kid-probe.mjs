// Throwaway probe: correction percentiles for Kid-Assist guests vs plain guests (same script).
import { runNetRace, percentile } from '../../tests/helpers/netHarness.js';

const script = ({ tick }) => ({ steer: Math.sin(tick / 25) * 0.6, accel: 1, brake: 0 });
for (const lat of [25, 75]) {
  for (const easy of [false, true]) {
    for (const seed of [5, 6, 7]) {
      const r = runNetRace({ houses: [[1]], laps: 1, seed, conditions: { latencyMs: lat, jitterMs: 5 }, easyGuests: easy, script, maxSeconds: 40 });
      const c = r.guests[0].metrics.reconcile;
      console.log(`rtt ${lat * 2} easy ${easy} seed ${seed}: all p99 ${percentile(c.all.map((x) => x.err), 0.99).toFixed(3)} clean p99 ${c.cleanP99.toFixed(3)} contact p99 ${c.contactP99.toFixed(3)} n ${c.all.length}`);
    }
  }
}
