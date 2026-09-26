/**
 * Character reactions: what a racer says in their speech bubble, and when.
 * Pure logic (no DOM, no audio) used by src/systems/characterReactions.js.
 * OWNER: showcase presentation.
 *
 *   lineFor('overtake', charDef, rng, { rival: 'Lenny' })  -> 'Beep beep, Lenny!'
 *   const q = createBubbleQueue();  q.offer('bonked', 'Hmph!', now);  q.current(now)
 *   const t = createPlaceTracker(); t.update(place, now) -> 'up' | 'down' | null
 *
 * Tone: silly and kind. Nobody is ever "hit" — karts get bonked, boop'd and
 * spun into happy twirls.
 */

/** Generic lines per reaction kind ({name} = the other racer's short name). */
export const REACTION_LINES = Object.freeze({
  go: ["Let's zoom!", 'Wheee, here we go!', 'Vroom vroom!', 'Sprinkles, activate!', 'Ready, set, SNACK! I mean GO!'],
  overtake: ['Beep beep, {name}!', 'Zoom! See you, {name}!', 'Coming through!', 'Wheee! Passing!', 'Excuse me, {name}!', 'Tee-hee, bye {name}!'],
  overtaken: ['Hey, wait for me!', 'Ooh, {name} is speedy!', "I'll catch up!", 'Not so fast, {name}!'],
  bonked: ['Hmph!', 'Aww, my kart!', 'Wobble wobble!', 'Hey! No fair!', 'Oof, dizzy!'],
  giggle: ['...hehe, that was fun!', 'Tee-hee! Again!', 'Hehe, twirly!', 'Okay, that was silly!'],
  bonker: ['Oopsie, {name}!', 'Boop! Sorry, {name}!', 'Tee-hee, gotcha {name}!', 'Twirl time, {name}!'],
  star: ['Sparkle power!', "I'm a rainbow!", 'Shiny shiny!'],
  'rainbow-turbo': ['Rainbow turbo!', 'Whoooosh!', 'Zoomy zoom!'],
  'final-lap': ["Last lap! Let's gooo!", 'One more lap!', 'Final lap, full sprinkles!'],
  'finish-win': ['I won! Yay!', 'Number one!', 'Sweet victory!'],
  podium: ['On the podium!', 'Medal time!', 'Shiny medal for me!'],
  finish: ['Yay, I finished!', 'What a race!', 'Woo-hoo!', 'That was sweet!'],
});

/**
 * How important each kind is: a higher priority replaces a lower bubble right
 * away; equal or lower waits for the cooldown.
 */
export const REACTION_PRIORITY = Object.freeze({
  overtaken: 0.5,
  go: 1,
  overtake: 1,
  star: 1.2,
  'rainbow-turbo': 1.2,
  'final-lap': 1.3,
  bonker: 1.5,
  bonked: 2,
  giggle: 2,
  podium: 3,
  finish: 3,
  'finish-win': 3,
});

/** The voice line (src/audio/voice.js kind) that goes with a bubble, if any. */
export const REACTION_VOICE = Object.freeze({
  overtake: 'yay',
  giggle: 'select',
  bonker: 'select',
});

/** Short friendly name: "Captain Crumbs" -> "Crumbs", "Rocco Ravioli" -> "Rocco". */
const TITLES = new Set(['princess', 'prince', 'captain', 'baby', 'the']);
const SHORT_NAMES = { 'cotton-candy-girl': 'Cotton Candy' };
export function shortName(def) {
  if (!def) return 'friend';
  if (typeof def.shortName === 'string' && def.shortName) return def.shortName;
  if (SHORT_NAMES[def.id]) return SHORT_NAMES[def.id];
  const words = String(def.name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = words.find((w) => !TITLES.has(w.toLowerCase()));
  return first || words[0] || 'friend';
}

/** A character's own quote for some kinds (CharacterDef.quotes). */
function ownQuote(kind, def) {
  const q = def?.quotes;
  if (!q) return null;
  if (kind === 'finish-win') return q.win || null;
  if (kind === 'bonked') return q.oops || null;
  if (kind === 'go') return q.select || null;
  return null;
}

/**
 * Pick a line for a reaction.
 * @param {string} kind a REACTION_LINES key
 * @param {object} charDef who is talking (their own quotes are used about half the time)
 * @param {() => number} [rng]
 * @param {{ rival?: string }} [vars]
 * @returns {string|null}
 */
export function lineFor(kind, charDef, rng = Math.random, { rival = 'friend' } = {}) {
  const pool = REACTION_LINES[kind];
  if (!pool) return null;
  const own = ownQuote(kind, charDef);
  const r = rng();
  let line;
  if (own && (kind === 'finish-win' ? r < 0.75 : r < 0.5)) line = own;
  else line = pool[Math.floor(rng() * pool.length) % pool.length];
  return line.replace(/\{name\}/g, rival || 'friend');
}

/**
 * One player's speech bubble: at most one line at a time, a cooldown between
 * chatter, important lines (bonks, finishing) can interrupt, and follow-ups
 * (the giggle after a pout) are scheduled.
 */
export function createBubbleQueue({ cooldown = 3.2, duration = 2.3 } = {}) {
  let shown = null; // { kind, text, at, until, priority, id }
  let lastAt = -Infinity;
  let pending = []; // { kind, text, at, priority }
  let nextId = 1;

  const show = (kind, text, now, priority, dur = duration) => {
    shown = { kind, text, at: now, until: now + dur, priority, id: nextId++ };
    lastAt = now;
    return shown;
  };

  return {
    /**
     * Offer a line. Returns the bubble if it is shown now, else null.
     * @param {string} kind
     * @param {string} text
     * @param {number} now seconds (any monotonic clock)
     * @param {{ priority?: number, duration?: number }} [opts]
     */
    offer(kind, text, now, { priority = REACTION_PRIORITY[kind] ?? 1, duration: dur = duration } = {}) {
      if (!text || !Number.isFinite(now)) return null;
      const busy = shown && now < shown.until;
      if (busy) {
        if (priority > shown.priority) return show(kind, text, now, priority, dur);
        return null;
      }
      if (priority < 2 && now - lastAt < cooldown) return null;
      return show(kind, text, now, priority, dur);
    },
    /** Show a line at a later time (replaces nothing until then). */
    schedule(kind, text, at, { priority = REACTION_PRIORITY[kind] ?? 1 } = {}) {
      if (!text || !Number.isFinite(at)) return;
      pending.push({ kind, text, at, priority });
      pending.sort((a, b) => a.at - b.at);
    },
    /** Advance time: fires due follow-ups. Returns the bubble on screen (or null). */
    update(now) {
      while (pending.length && pending[0].at <= now) {
        const p = pending.shift();
        // A follow-up always gets its moment (it continues the line before it).
        show(p.kind, p.text, Math.max(now, p.at), p.priority);
      }
      if (shown && now >= shown.until) shown = null;
      return shown;
    },
    current(now) {
      return shown && now < shown.until ? shown : null;
    },
    /** Pending follow-ups (for tests / debugging). */
    get pending() { return pending.slice(); },
    clear() { shown = null; pending = []; lastAt = -Infinity; },
  };
}

/**
 * Notices real overtakes: a place change only counts once it has held for
 * `hold` seconds (two karts side by side swap places every frame).
 */
export function createPlaceTracker({ hold = 0.45 } = {}) {
  let confirmed = null;
  let candidate = null;
  let since = 0;
  return {
    /** @returns {'up'|'down'|null} 'up' = gained a place (smaller number). */
    update(place, now) {
      if (!Number.isFinite(place) || !Number.isFinite(now)) return null;
      if (confirmed === null) { confirmed = place; candidate = place; since = now; return null; }
      if (place !== candidate) { candidate = place; since = now; }
      if (candidate !== confirmed && now - since >= hold) {
        const dir = candidate < confirmed ? 'up' : 'down';
        confirmed = candidate;
        return dir;
      }
      return null;
    },
    get place() { return confirmed; },
    reset() { confirmed = null; candidate = null; since = 0; },
  };
}
