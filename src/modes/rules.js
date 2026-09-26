/**
 * Race rules per game mode (pure, unit tested). The Race reads them through
 * `new Race({ ..., rules })`:
 *
 *   items            false = no item boxes on the track (karts keep any starting item)
 *   cpus             false = CPU participants are dropped (solo runs)
 *   startItem        an ItemId every HUMAN kart starts with (null = none)
 *   startItemCharges how many uses of it (only 'triple-sprinkle' has more than one)
 *   battle           true = Bubble Pop Battle: no laps, nobody finishes by driving; the
 *                    race only completes when the mode calls race.completeWith(order)
 *
 * OWNER: modes + timing workstream.
 */
/** Same list as MODES in src/game/summary.js (kept import-free so Race.js stays light). */
const MODE_IDS = ['free', 'grand-prix', 'time-trial', 'team', 'battle'];

/** Sprinkle boosts a Time Trial starts with. */
export const TIME_TRIAL_BOOSTS = 3;

export const DEFAULT_RULES = Object.freeze({ items: true, cpus: true, startItem: null, startItemCharges: 0, battle: false });

const ITEM_IDS = new Set(['sprinkle-boost', 'triple-sprinkle', 'gumdrop', 'bubble-shield', 'cupcake-rocket', 'rainbow-star']);

/**
 * Fill in defaults and repair odd values (unknown items are dropped, charges
 * are clamped to 1..9 when an item is given).
 * @param {Partial<typeof DEFAULT_RULES>} [rules]
 */
export function normalizeRules(rules = {}) {
  const r = rules && typeof rules === 'object' ? rules : {};
  const startItem = typeof r.startItem === 'string' && ITEM_IDS.has(r.startItem) ? r.startItem : null;
  let charges = 0;
  if (startItem) {
    const n = Math.round(Number(r.startItemCharges));
    charges = Number.isFinite(n) && n > 0 ? Math.min(9, n) : 1;
  }
  return Object.freeze({
    items: r.items !== false,
    cpus: r.cpus !== false,
    startItem,
    startItemCharges: charges,
    battle: r.battle === true,
  });
}

/** The rules a game mode races with. */
export function rulesForMode(mode) {
  if (mode === 'time-trial') {
    return normalizeRules({ items: false, cpus: false, startItem: 'triple-sprinkle', startItemCharges: TIME_TRIAL_BOOSTS });
  }
  if (mode === 'battle') return normalizeRules({ items: true, cpus: true, battle: true });
  return normalizeRules(DEFAULT_RULES);
}

/** A known mode id ('free' for anything else). */
export function modeId(mode) {
  return MODE_IDS.includes(mode) ? mode : 'free';
}
