// Throwaway probe: local gumdrop hits the host never confirmed (mispredictions), with host-side detail.
import { runNetRace } from '../../tests/helpers/netHarness.js';

const lat = Number(process.argv[2] || 75);
let hits = 0;
let wrong = 0;
const why = [];
for (let seed = 1; seed <= 10; seed++) {
  const local = [];
  const hostAt = new Map(); // tick → { karts: [[x,z]], gumdrops: Map(id → [x,z]) }
  const r = runNetRace({
    houses: [[1], [1], [1]], laps: 2, seed, conditions: { latencyMs: lat, jitterMs: 10, loss: 0.01 },
    onGuestFrame: ({ g }) => { const h = g.replica.lastLocalHit; if (h && !h.logged) { h.logged = true; local.push({ ...h, gi: g.index }); } },
    onHostTick: ({ tick, race, driver }) => {
      const snap = driver.stats && null;
      void snap;
      hostAt.set(tick, { karts: race.karts.map((k) => [k.position.x, k.position.z]), n: race.items.gumdrops.length, gd: race.items.gumdrops.map((g) => [g.position.x, g.position.z]) });
      if (hostAt.size > 20000) hostAt.delete(hostAt.keys().next().value);
    },
  });
  for (const h of local) {
    hits++;
    const hostEv = r.events.filter((e) => e.kart === h.kart && ['bonked', 'shield-pop', 'item-dodged'].includes(e.type) && Math.abs(e.tick - h.tick) < 60);
    if (hostEv.length) continue;
    wrong++;
    const at = hostAt.get(h.tick);
    const kp = at?.karts[h.kart];
    const exists = at?.gd.some(([x, z]) => Math.hypot(x - h.x, z - h.z) < 0.2);
    const minD = [];
    for (let t = h.tick - 10; t <= h.tick + 10; t++) { const a = hostAt.get(t); if (a) minD.push(Math.hypot(a.karts[h.kart][0] - h.x, a.karts[h.kart][1] - h.z)); }
    const byOther = r.events.filter((e) => ['bonked', 'shield-pop'].includes(e.type) && e.cause === 'gumdrop' && Math.abs(e.tick - h.tick) < 90).map((e) => ({ t: e.tick, kart: e.kart }));
    why.push({ seed, tick: h.tick, onHost: exists, hostKartDist: kp ? Math.hypot(kp[0] - h.x, kp[1] - h.z).toFixed(2) : null, minHostDist: Math.min(...minD).toFixed(2), byOther });
  }
}
console.log(`RTT ${lat * 2}: local hits ${hits}, not confirmed by the host ${wrong}`);
for (const w of why) console.log(JSON.stringify(w));
