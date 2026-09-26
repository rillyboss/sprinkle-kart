/**
 * Online emotes (NETWORKING.md §10.7): the 8 preset emotes are the only way friends "talk" (no free text,
 * ever). The lobby screen draws the bubbles on the house cards; this system plays the soft chime for every
 * emote in the room ('net-emote' on the bus, emitted by the online glue for local and remote emotes) and
 * keeps a short log for tests / the debug overlay. Emotes are rate limited by the session (1 per 1.5 s per
 * player), so the chime never floods. In-race emotes are milestone M3.
 *
 * OWNER: WS7 (online game integration).
 */

/** The 8 presets (ids 0..7), the same order as WS6's LOBBY_EMOTES / WS2's emotes table. */
export const EMOTES = Object.freeze([
  ['👋', 'Hi!'], ['😄', 'Hee hee'], ['🎉', 'Yay!'], ['👍', 'Nice!'], ['😮', 'Whoa!'], ['💖', 'Love it'], ['🍭', 'Sweet!'], ['🐢', 'Wait for me!'],
]);

/** Emoji + words for an emote id, or null for anything that is not a preset (never shown). */
export function emoteView(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 0 || n >= EMOTES.length) return null;
  const [emoji, text] = EMOTES[n];
  return { id: n, emoji, text };
}

export const EMOTE_LOG_SIZE = 16;

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'net-emotes',
  order: 60,
  install(bus, app) {
    const log = [];
    if (app?.game) app.game.netEmotes = log;
    const off = bus.on('net-emote', (e) => {
      const view = emoteView(e?.emote);
      if (!view) return;
      log.push({ globalPi: Number(e.globalPi) | 0, emote: view.id, local: !!e.local });
      if (log.length > EMOTE_LOG_SIZE) log.shift();
      try { app.audio?.sfx?.('bubble', { volume: e.local ? 0.5 : 0.35 }); } catch { /* audio is optional */ }
    });
    return () => off();
  },
};
