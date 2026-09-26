// Throwaway probe: one unconfirmed local hit in detail (seed 5, gumdrop 32 at ~tick 1747).
import { runNetRace } from '../../tests/helpers/netHarness.js';

const SEED = Number(process.argv[2] || 5);
const GD = Number(process.argv[3] || 32);
const TICK = Number(process.argv[4] || 1747);
let hit = null;
const hostLog = [];
const r = runNetRace({
  houses: [[1], [1], [1]], laps: 2, seed: SEED, conditions: { latencyMs: 75, jitterMs: 10, loss: 0.01 },
  onGuestFrame: ({ g }) => { const h = g.replica.lastLocalHit; if (h && h.gumdrop === GD && !hit) hit = { ...h, gi: g.index, lead: g.driver.lead.lead }; },
  onHostTick: ({ tick, race }) => {
    if (Math.abs(tick - TICK) > 40) return;
    const g = race.items.gumdrops.find((x) => x.id === GD || x.entityId === GD);
    hostLog.push({ tick, n: race.items.gumdrops.length, has: !!g, karts: hit ? race.karts[hit.kart].position.clone() : null });
  },
});
console.log('local hit', JSON.stringify(hit));
const ids = r.host.race.items.gumdrops;
void ids;
if (hit) {
  for (const h of hostLog.filter((x, i) => i % 4 === 0)) {
    const d = h.karts ? Math.hypot(h.karts.x - hit.x, h.karts.z - hit.z) : null;
    console.log(h.tick, 'gumdrops', h.n, 'host kart→gumdrop', d?.toFixed(2));
  }
}
console.log(JSON.stringify(r.events.filter((e) => Math.abs(e.tick - TICK) < 60 && ['bonked', 'shield-pop', 'item-dodged', 'gumdrop-despawn', 'item-use'].includes(e.type)).map((e) => ({ t: e.tick, type: e.type, kart: e.kart, cause: e.cause, id: e.id, why: e.why }))));
