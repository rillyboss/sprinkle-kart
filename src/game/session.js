/**
 * Helpers every race-event subscriber uses, bound to one race session.
 *
 *   const h = createSessionHelpers({ humans, audio, input, hud, getCharacter });
 *   h.isHuman(kart)  h.panFor(kart)  h.deviceFor(kart)
 *   h.sfx(name, opts)  h.voice(kart, kind)  h.rumble(kart, strength, ms)  h.flash(kart, text)
 *
 * Every call is safe: audio / input / hud problems are swallowed (a sound
 * glitch must never break the race loop). main.js spreads these onto the
 * session object passed as the 2nd argument of every 'race:*' event.
 */

export function createSessionHelpers({ humans, audio = null, input = null, hud = null, getCharacter = () => null }) {
  const playerIndices = humans.map((p) => p.playerIndex);
  const devices = new Map(humans.map((p) => [p.playerIndex, p.deviceId]));

  const isHuman = (kart) => !!kart && !kart.isCPU && kart.playerIndex !== null && kart.playerIndex !== undefined;

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
    isHuman,
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
