/**
 * Item catalog + "what does the player see and hear" cue table.
 * OWNER: power-up clarity workstream. Pure data / functions (no THREE, no DOM),
 * shared by the race item system, the HUD widgets, the item guide screen and
 * the item sound systems, so every part of the game describes an item the
 * same way.
 *
 * Every item EVENT maps to exactly one 3D/HUD effect (`fx`) and one sound
 * (`sfx`) via cueFor(event, item). tests/items.cues.test.js checks that every
 * event an item can have has both, that each sfx name is in the SFX book and
 * that each fx name is implemented by one of the FX registries below.
 */

/** @typedef {'sprinkle-boost'|'triple-sprinkle'|'gumdrop'|'bubble-shield'|'cupcake-rocket'|'rainbow-star'} ItemId */

export const ITEM_ORDER = Object.freeze([
  'sprinkle-boost', 'triple-sprinkle', 'gumdrop', 'bubble-shield', 'cupcake-rocket', 'rainbow-star',
]);

/**
 * name / emoji / colour for UI; `kind` groups behaviour; `guide` is the one
 * friendly Item Guide sentence; `tip` a tiny extra hint; `call` the big
 * callout on use.
 */
export const ITEM_CATALOG = Object.freeze({
  'sprinkle-boost': Object.freeze({
    name: 'Sprinkle Boost', emoji: '🍬', color: '#ff7ac8', kind: 'boost',
    guide: 'A sugary zoom! Your kart shoots forward on a rainbow flame.',
    tip: 'Great for catching up or cutting across a bend.',
    call: 'Zoom zoom!',
  }),
  'triple-sprinkle': Object.freeze({
    name: 'Triple Sprinkle', emoji: '🍭', color: '#ffb347', kind: 'boost', charges: 3,
    guide: 'Three zooms in a row! Watch the three dots count them down.',
    tip: 'Press again for the next zoom.',
    call: 'Triple zoom!',
  }),
  gumdrop: Object.freeze({
    name: 'Gumdrop', emoji: '🟢', color: '#6fdc6f', kind: 'drop',
    guide: 'Plop a jiggly gumdrop behind you. Anyone who rolls over it does a happy twirl!',
    tip: 'Look for the glowing ring on the road so you can steer around them.',
    call: 'Plop!',
  }),
  'bubble-shield': Object.freeze({
    name: 'Bubble Shield', emoji: '🫧', color: '#7fd8ff', kind: 'shield',
    guide: 'A shiny bubble hugs your kart and blocks one bonk.',
    tip: 'The ring by your item shows how long it lasts.',
    call: 'Bubble up!',
  }),
  'cupcake-rocket': Object.freeze({
    name: 'Cupcake Rocket', emoji: '🧁', color: '#ff9ecf', kind: 'throw',
    guide: 'A flying cupcake zooms after the racer just ahead of you. Boop!',
    tip: 'If one is chasing you, a warning arrow shows where it is. A bubble blocks it!',
    call: 'Off it goes!',
  }),
  'rainbow-star': Object.freeze({
    name: 'Rainbow Star', emoji: '🌟', color: '#ffe066', kind: 'power',
    guide: 'Sparkle super-fast in every colour! Nothing can bonk you, and bumping friends twirls them.',
    tip: 'Listen for the twinkly tune. It lasts while the ring is full.',
    call: 'Superstar!',
  }),
});

/** Bonk causes used by the race (Items.bonk / Race star bumps) -> ItemId. */
export const CAUSE_ITEM = Object.freeze({ gumdrop: 'gumdrop', 'cupcake-rocket': 'cupcake-rocket', rocket: 'cupcake-rocket', star: 'rainbow-star' });

/** @returns {ItemId|null} */
export function itemForCause(cause) {
  return CAUSE_ITEM[cause] ?? (ITEM_CATALOG[cause] ? cause : null);
}

export function itemName(id) {
  return ITEM_CATALOG[id]?.name ?? 'Surprise';
}

export function itemEmoji(id) {
  return ITEM_CATALOG[id]?.emoji ?? '🎁';
}

/**
 * Item events, in the order a player meets them.
 *   box-hit   drove through an item box          roulette  the slot spins (one tick)
 *   reveal    the roulette lands ("ta-da!")      use       pressed the item button
 *   active    the item's effect is running       end       the effect is over
 *   impact    the item bonked someone            blocked   a bubble shield stopped it
 *   dodged    it missed / fizzled near someone
 */
export const ITEM_EVENTS = Object.freeze(['box-hit', 'roulette', 'reveal', 'use', 'active', 'end', 'impact', 'blocked', 'dodged']);

/** Events every item shares (not item specific). */
const SHARED_CUES = {
  'box-hit': { fx: 'box-pop', sfx: 'item-box-pop' },
  roulette: { fx: 'hud-roulette', sfx: 'item-roulette' },
  reveal: { fx: 'hud-reveal', sfx: 'item-get' },
};

/** Per-item cues. Only the events that can happen for that item are listed. */
const ITEM_CUES = {
  'sprinkle-boost': {
    use: { fx: 'hud-callout', sfx: 'item-use-sprinkle', duck: 0.75 },
    active: { fx: 'rainbow-flame', sfx: 'boost' },
    end: { fx: 'flame-fade', sfx: 'item-boost-end' },
  },
  'triple-sprinkle': {
    use: { fx: 'hud-pips', sfx: 'item-use-triple', duck: 0.75 },
    active: { fx: 'rainbow-flame', sfx: 'boost' },
    end: { fx: 'flame-fade', sfx: 'item-boost-end' },
  },
  gumdrop: {
    use: { fx: 'gumdrop-plop', sfx: 'gumdrop', duck: 0.75 },
    active: { fx: 'gumdrop-glow-ring', sfx: 'item-gumdrop-wobble' },
    impact: { fx: 'star-burst', sfx: 'item-bonk-gumdrop', duck: 0.55 },
    blocked: { fx: 'bubble-pop', sfx: 'item-shield-block', duck: 0.6 },
    dodged: { fx: 'dodge-sparkle', sfx: 'item-dodge' },
    end: { fx: 'gumdrop-poof', sfx: 'item-gumdrop-poof' },
  },
  'bubble-shield': {
    use: { fx: 'shield-bubble', sfx: 'bubble', duck: 0.75 },
    active: { fx: 'hud-timer-ring', sfx: 'item-shield-hum' },
    blocked: { fx: 'bubble-pop', sfx: 'item-shield-block', duck: 0.6 },
    end: { fx: 'bubble-fade', sfx: 'item-shield-fade' },
  },
  'cupcake-rocket': {
    use: { fx: 'rocket-launch', sfx: 'rocket', duck: 0.7 },
    active: { fx: 'rocket-trail', sfx: 'item-rocket-whistle' },
    impact: { fx: 'star-burst', sfx: 'item-bonk-rocket', duck: 0.55 },
    blocked: { fx: 'bubble-pop', sfx: 'item-shield-block', duck: 0.6 },
    dodged: { fx: 'dodge-sparkle', sfx: 'item-dodge' },
    end: { fx: 'rocket-fizzle', sfx: 'item-rocket-fizzle' },
  },
  'rainbow-star': {
    use: { fx: 'star-aura', sfx: 'star', duck: 0.6 },
    active: { fx: 'star-aura', sfx: 'item-star-loop' },
    impact: { fx: 'star-burst', sfx: 'item-bonk-star', duck: 0.6 },
    end: { fx: 'star-fade', sfx: 'item-star-end' },
  },
};

/** What the racer who landed a bonk sees / hears ("You bonked Lenny! 🎯" + a happy ding). */
export const SCORE_CUE = Object.freeze({ fx: 'hud-callout', sfx: 'item-bonk-score' });

/** The threat warning a rocket target gets (HUD arrow + beeps). */
export const THREAT_CUE = Object.freeze({ fx: 'hud-threat', sfx: 'item-threat-beep' });

/** @returns {string[]} the events that can happen for `item` (shared + specific). */
export function eventsFor(item) {
  const own = ITEM_CUES[item];
  if (!own) return [];
  return ITEM_EVENTS.filter((e) => SHARED_CUES[e] || own[e]);
}

/**
 * @param {string} event one of ITEM_EVENTS
 * @param {string} [item] ItemId (or a bonk cause such as 'star')
 * @returns {{fx:string, sfx:string, duck?:number}|null}
 */
export function cueFor(event, item) {
  if (SHARED_CUES[event]) return SHARED_CUES[event];
  const id = itemForCause(item);
  return (id && ITEM_CUES[id]?.[event]) || null;
}

/** Every [event, item] pair the game can produce. */
export function allCuePairs() {
  const out = [];
  for (const item of ITEM_ORDER) for (const e of eventsFor(item)) out.push([e, item]);
  return out;
}

/** Durations (seconds) of timed effects, read from the tuning table by callers. */
export function effectFraction(remaining, total) {
  if (!(total > 0) || !Number.isFinite(remaining)) return 0;
  return Math.max(0, Math.min(1, remaining / total));
}
