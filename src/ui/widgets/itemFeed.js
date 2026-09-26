/**
 * Per-player queue of friendly item callouts ("🧁 Cupcake Rocket!",
 * "Bonked by Lenny's Gumdrop! 💫"). Pure (no DOM): the item callout widget
 * reads it every frame, the item-callouts system writes to it from race
 * events. Time is the race clock (seconds), so callouts freeze while paused.
 * OWNER: power-up clarity workstream.
 */

/** How long each kind of callout stays up (seconds). */
export const CALLOUT_TTL = Object.freeze({ use: 1.5, good: 2.1, oops: 2.3, info: 1.7, block: 2.1 });

/**
 * @param {{max?: number}} [opts] max callouts shown at once per player
 */
export function createItemFeed({ max = 2 } = {}) {
  const byPlayer = new Map(); // pi -> [{ id, key, tone, emoji, title, sub, at, until }]
  let seq = 0;
  const list = (pi) => {
    let l = byPlayer.get(pi);
    if (!l) byPlayer.set(pi, (l = []));
    return l;
  };
  return {
    /**
     * Show a callout for one player. A message with the same `key` replaces the
     * old one (e.g. the Triple Sprinkle countdown) instead of stacking.
     * @returns {object} the stored message
     */
    push(pi, msg, now) {
      if (pi === null || pi === undefined || !msg) return null;
      const tone = msg.tone ?? 'info';
      const ttl = Number.isFinite(msg.ttl) ? msg.ttl : (CALLOUT_TTL[tone] ?? 1.8);
      const t = Number.isFinite(now) ? now : 0;
      const l = list(pi);
      if (msg.key) {
        const i = l.findIndex((m) => m.key === msg.key);
        if (i >= 0) l.splice(i, 1);
      }
      const m = { id: ++seq, key: msg.key ?? null, tone, emoji: msg.emoji ?? '', title: String(msg.title ?? ''), sub: msg.sub ? String(msg.sub) : '', color: msg.color ?? null, at: t, until: t + ttl };
      l.push(m);
      while (l.length > max) l.shift();
      return m;
    },
    /** Live callouts for a player at time `now`, oldest first. */
    active(pi, now) {
      const l = byPlayer.get(pi);
      if (!l) return [];
      for (let i = l.length - 1; i >= 0; i--) if (!(l[i].until > now) || l[i].at > now + 1) l.splice(i, 1);
      return l.slice();
    },
    clear(pi) {
      if (pi === undefined) byPlayer.clear();
      else byPlayer.delete(pi);
    },
    get size() { let n = 0; for (const l of byPlayer.values()) n += l.length; return n; },
  };
}
