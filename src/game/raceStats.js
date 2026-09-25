/**
 * Per-race counters for each human player, collected from Race events.
 * Pure (no DOM / THREE) so it is unit tested; main.js feeds every Race event
 * into `onEvent` and puts `forPlayer()` results into the race-end summary.
 *
 * Counters (per human playerIndex):
 *   itemsUsed    'item-use' by that player
 *   bonksGiven   'bonked' where `by` is that player's kart and not the bonked kart itself
 *   bonked       times that player's kart was bonked
 *   miniTurbos   'drift-boost' with level >= 1 (any turbo level)
 *   driftBoosts  [level1, level2, level3] counts
 *   boosts       'boost' events (pads, sprinkles, rocket start, ...)
 *   itemBoxes    'item-box' pickups
 *   bumps        kart-kart bumps involving that player
 */

const isHumanKart = (k) => !!k && !k.isCPU && k.playerIndex !== null && k.playerIndex !== undefined;

export function emptyPlayerStats() {
  return { itemsUsed: 0, bonksGiven: 0, bonked: 0, miniTurbos: 0, driftBoosts: [0, 0, 0], boosts: 0, itemBoxes: 0, bumps: 0 };
}

export function createRaceStats() {
  const byPlayer = new Map();
  const get = (kart) => {
    const pi = kart.playerIndex;
    let s = byPlayer.get(pi);
    if (!s) byPlayer.set(pi, (s = emptyPlayerStats()));
    return s;
  };
  return {
    /** Feed one Race event ({ type, kart, ... }). */
    onEvent(e) {
      if (!e) return;
      const k = e.kart;
      switch (e.type) {
        case 'item-use': if (isHumanKart(k)) get(k).itemsUsed++; break;
        case 'bonked':
          if (isHumanKart(k)) get(k).bonked++;
          if (isHumanKart(e.by) && e.by !== k) get(e.by).bonksGiven++;
          break;
        case 'drift-boost':
          if (isHumanKart(k) && e.level >= 1) {
            const s = get(k);
            s.miniTurbos++;
            s.driftBoosts[Math.min(3, e.level | 0) - 1]++;
          }
          break;
        case 'boost': if (isHumanKart(k)) get(k).boosts++; break;
        case 'item-box': if (isHumanKart(k)) get(k).itemBoxes++; break;
        case 'bump':
          if (isHumanKart(k)) get(k).bumps++;
          if (isHumanKart(e.other)) get(e.other).bumps++;
          break;
        default: break;
      }
    },
    /** A copy of one player's counters (zeros if they did nothing). */
    forPlayer(playerIndex) {
      const s = byPlayer.get(playerIndex);
      return s ? { ...s, driftBoosts: [...s.driftBoosts] } : emptyPlayerStats();
    },
  };
}
