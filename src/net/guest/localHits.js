/**
 * Local gumdrop hits for a guest's OWN predicted karts (NETWORKING.md §9.8, net review #12).
 *
 * The host decides every bonk. A guest's own kart is drawn at P (ahead of the host), so when the host's
 * "bonked" arrived the kart had already rolled 3–8 m past the gumdrop the kid saw ("I didn't touch it!").
 * Gumdrops are static, so the guest can tell from the newest snapshot exactly when its predicted kart
 * overlaps one: it applies the same bonk (bonkKart: star = immune, a shield pops, otherwise a twirl) at
 * that very tick, hides the gumdrop, and plays the bonk right there. The host's own "bonked" for that kart
 * is then a duplicate and is dropped; if the host disagrees (someone else got there first), the next
 * reconcile simply corrects it.
 *
 * Same test as the host's ItemSystem (swept distance from the tick's start, same level, T.gumdropRadius),
 * run after the tick's two sub-steps like Race.update runs items after stepping. Rockets stay host-only.
 */
import { bonkKart, sweptDistSq } from '../../race/Kart.js';
import { TUNING as T } from '../../race/tuning.js';

/**
 * @param {object[]} karts   this machine's predicted karts
 * @param {{ gumdrops: Array<{ id: number, x: number, y: number, z: number }>, consumed: Set<number>,
 *           skip?: (g: object) => boolean }} hazards
 * @param {(e: object) => void} emit
 * @returns {number} hits
 */
export function predictGumdropHits(karts, hazards, emit = () => {}) {
  const list = hazards?.gumdrops;
  if (!list?.length) return 0;
  const r2 = T.gumdropRadius * T.gumdropRadius;
  let hits = 0;
  for (const k of karts) {
    if (k.battleOut || k.finished) continue; // a finished kart is the host's CPU brain's: leave it to the host
    for (const g of list) {
      if (hazards.consumed.has(g.id) || hazards.skip?.(g)) continue;
      if (Math.abs(k.position.y - g.y) >= 2.5) continue;
      if (sweptDistSq(k, g.x, g.z) >= r2) continue;
      hazards.consumed.add(g.id);
      const res = bonkKart(k);
      if (res === 'bonked') emit({ type: 'bonked', kart: k, cause: 'gumdrop', by: null, gumdrop: g.id });
      else if (res === 'blocked') emit({ type: 'shield-pop', kart: k, cause: 'gumdrop', by: null, gumdrop: g.id });
      hits++;
      break;
    }
  }
  return hits;
}
