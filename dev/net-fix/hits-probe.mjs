// Throwaway probe: own-kart spins on guests — locally predicted or not, and how far from the gumdrop.
import { runNetRace, percentile as pct } from '../../tests/helpers/netHarness.js';
const lat = Number(process.argv[2] || 75);
const rows = [];
let local = 0; let confirmed = 0;
for (let seed = 1; seed <= 10; seed++) {
  const spinPrev = new Map();
  const r = runNetRace({
    houses: [[1], [1], [1]], laps: 2, seed, conditions: { latencyMs: lat, jitterMs: 10, loss: 0.01 },
    onGuestFrame: ({ g, fr }) => {
      if (fr.P === undefined) return;
      for (const id of g.replica.localKartIds) {
        const k = g.replica.karts[id];
        const key = `${g.index}:${id}`;
        const was = spinPrev.get(key) || false;
        const now = k.phys.spinTime > 0;
        if (now && !was) {
          const h = g.replica.lastLocalHit;
          const fresh = h && h.kart === id && g.replica.predictedTick - h.tick < 10 && h.x !== null;
          rows.push({ local: !!fresh, d: fresh ? Math.hypot(h.x - k.render.position.x, h.z - k.render.position.z) : null });
        }
        spinPrev.set(key, now);
      }
    },
  });
  for (const g of r.guests) { local += g.replica.stats.localHits || 0; confirmed += g.replica.stats.localHitsConfirmed || 0; }
}
const ds = rows.filter((x) => x.local).map((x) => x.d);
console.log(`RTT ${lat * 2}: spins ${rows.length}, predicted locally ${ds.length}, dist to its gumdrop p50 ${pct(ds, 0.5)?.toFixed(2)} p90 ${pct(ds, 0.9)?.toFixed(2)} max ${Math.max(...ds).toFixed(2)}; local hits ${local}, host-confirmed ${confirmed}`);
