/**
 * Helpers every race-event subscriber uses, bound to one race session.
 *
 *   const h = createSessionHelpers({ humans, audio, input, hud, getCharacter });
 *   h.isHuman(kart)  h.panFor(kart)  h.deviceFor(kart)
 *   h.sfx(name, opts)  h.voice(kart, kind)  h.rumble(kart, strength, ms)  h.flash(kart, text)
 *
 * Online (NETWORKING.md §10.8) pass `allHumans` too (every human in the room, all houses):
 *   `humans` / `isHuman(kart)` keep meaning the players on THIS machine (so the ~20 presentation systems,
 *   rumble, flashes and voice lines only react to local karts, and a friend's sounds never play as "yours"),
 *   `allHumans` / `isAnyHuman(kart)` mean every human in the race (rules, scoring), and `isLocal(kart)` is
 *   "a player on this screen". Offline (no `allHumans`) every human is local, exactly as before.
 *
 * Every call is safe: audio / input / hud problems are swallowed (a sound
 * glitch must never break the race loop). main.js spreads these onto the
 * session object passed as the 2nd argument of every 'race:*' event.
 */

const humanKart = (kart) => !!kart && !kart.isCPU && kart.playerIndex !== null && kart.playerIndex !== undefined;

export function createSessionHelpers({ humans, allHumans = null, audio = null, input = null, hud = null, getCharacter = () => null }) {
  const playerIndices = humans.map((p) => p.playerIndex);
  const devices = new Map(humans.map((p) => [p.playerIndex, p.deviceId]));
  const online = Array.isArray(allHumans);
  const local = new Set(playerIndices);
  const everyone = online ? allHumans : humans;

  const isAnyHuman = humanKart;
  const isLocal = (kart) => humanKart(kart) && (!online || local.has(kart.playerIndex));
  // "a player on this screen": every human offline, only this machine's players online
  const isHuman = isLocal;

  /** Stereo pan for a player's sounds: 3–4 players pan left/right by screen column. */
  const panFor = (kart) => {
    if (humans.length < 2 || !isHuman(kart)) return 0;
    const slot = playerIndices.indexOf(kart.playerIndex);
    if (humans.length === 2) return 0;
    return slot % 2 === 0 ? -0.35 : 0.35;
  };

  const deviceFor = (kart) => (isHuman(kart) ? devices.get(kart.playerIndex) ?? null : null);

  return {
    playerIndices,
    online,
    allHumans: everyone,
    isHuman,
    isAnyHuman,
    isLocal,
    panFor,
    deviceFor,
    sfx(name, opts = {}) {
      try { audio?.sfx(name, opts); } catch { /* ignore */ }
    },
    voice(kart, kind) {
      try {
        const def = kart.charDef || getCharacter(kart.characterId);
        if (def) audio?.voice(def, kind, { pan: panFor(kart) });
      } catch { /* ignore */ }
    },
    rumble(kart, strength, ms) {
      const dev = deviceFor(kart);
      if (dev) { try { input?.rumble(dev, strength, ms); } catch { /* ignore */ } }
    },
    flash(kart, text) {
      if (isHuman(kart)) { try { hud?.flash(kart.playerIndex, text); } catch { /* ignore */ } }
    },
  };
}
