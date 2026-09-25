/**
 * Progress schema — the shape of saved progress, the stats counters the
 * progression engine fills in, and the UnlockRule data format.
 *
 * OWNER: progression/unlocks workstream (see ARCHITECTURE.md). Other modules
 * read these shapes; only src/progress/* writes saved progress.
 *
 * Saved progress (localStorage key 'sprinkle-kart-progress-v1', one JSON object;
 * every field optional on load — always merge over `emptyProgress()`):
 *
 *   {
 *     unlocked: string[],          // content ids earned (characters AND tracks; ids never collide)
 *     wins: number,                // legacy: human 1st places (kept for the title-screen trophy count)
 *     trophies: {[trackId]: n},    // legacy: human 1st places per track
 *     stats: Stats,                // lifetime counters, see STAT_KEYS
 *     tracks: {[trackId]: TrackStats},
 *     cups: {[cupId]: { bestPlace: number|null, wins: number }},
 *     records: {[trackId]: { bestRace: number|null, bestLap: number|null }},  // seconds (modes+timing)
 *     unlockAll: boolean,          // parent gate "unlock everything"
 *   }
 *
 * TrackStats: { finishes, wins, top3, bestPlace (1-8 | null) } — Free Race + Grand Prix races.
 */

/**
 * Lifetime counters. "Race" = a Free Race or Grand Prix race (NOT a Time Trial).
 * Counted once per race for the humans in it (any human's result counts, it is
 * a shared family save).
 */
export const STAT_KEYS = Object.freeze([
  'racesFinished',      // races where at least one human crossed the line
  'wins',               // races a human won (1st, not an estimated finish)
  'podiums',            // races where a human finished top 3
  'itemsUsed',          // items used by humans ('race:item-use' events)
  'bonksGiven',         // racers bonked by a human's item/star ('race:bonked' with a human `by`, not self)
  'miniTurbos',         // drift boosts of any level by humans ('race:drift-boost', level >= 1)
  'timeTrialsFinished', // Time Trials finished
  'multiplayerRaces',   // races finished with 2+ human players
  'kidAssistFinishes',  // races finished by a human with Kid-Assist on
  'grandPrixFinished',  // Grand Prix cups completed (all 4 races)
  'cupsWon',            // Grand Prix cups won (1st overall on points)
]);

/** @typedef {{[K in typeof STAT_KEYS[number]]: number}} Stats */

export function emptyStats() {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
}

export function emptyProgress() {
  return { unlocked: [], wins: 0, trophies: {}, stats: emptyStats(), tracks: {}, cups: {}, records: {}, unlockAll: false };
}

/**
 * UnlockRule — plain JSON data on CharacterDef.unlock / TrackDef.unlock (null = unlocked from the start).
 *
 *   { type: 'stat', stat: StatKey, count: n }                    lifetime counter reaches n
 *   { type: 'track', trackId, result: 'win'|'top3'|'finish' }    that result on one track
 *   { type: 'cup-track', cupId, result: 'win'|'top3'|'finish' }  that result on ANY track of a cup
 *   { type: 'distinct-tracks', result: 'win'|'top3'|'finish', count: n }  that result on n different tracks
 *
 * @typedef {{type:'stat', stat:string, count:number}
 *   | {type:'track', trackId:string, result:'win'|'top3'|'finish'}
 *   | {type:'cup-track', cupId:string, result:'win'|'top3'|'finish'}
 *   | {type:'distinct-tracks', result:'win'|'top3'|'finish', count:number}} UnlockRule
 */
export const UNLOCK_RULE_TYPES = Object.freeze(['stat', 'track', 'cup-track', 'distinct-tracks']);
export const UNLOCK_RESULTS = Object.freeze(['win', 'top3', 'finish']);

/** Structural check of an UnlockRule (null is valid = always unlocked). */
export function isValidUnlockRule(rule) {
  if (rule === null) return true;
  if (!rule || typeof rule !== 'object') return false;
  const posInt = (n) => Number.isInteger(n) && n >= 1;
  switch (rule.type) {
    case 'stat': return STAT_KEYS.includes(rule.stat) && posInt(rule.count);
    case 'track': return typeof rule.trackId === 'string' && UNLOCK_RESULTS.includes(rule.result);
    case 'cup-track': return typeof rule.cupId === 'string' && UNLOCK_RESULTS.includes(rule.result);
    case 'distinct-tracks': return UNLOCK_RESULTS.includes(rule.result) && posInt(rule.count);
    default: return false;
  }
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Merge a saved (possibly older / partial / hand-edited) progress object over
 * emptyProgress(): `stats` is merged key by key (new STAT_KEYS start at 0, junk
 * values are dropped), map fields fall back to {} and `unlocked` to [] when
 * their saved value has the wrong type. Unknown top-level keys are kept.
 * @param {unknown} saved
 */
export function mergeProgress(saved) {
  const base = emptyProgress();
  if (!isPlainObject(saved)) return base;
  const out = { ...base, ...saved };
  out.unlocked = Array.isArray(saved.unlocked) ? saved.unlocked.filter((id) => typeof id === 'string') : [];
  out.wins = Number.isFinite(saved.wins) ? saved.wins : 0;
  for (const k of ['trophies', 'tracks', 'cups', 'records']) out[k] = isPlainObject(saved[k]) ? { ...saved[k] } : {};
  out.stats = emptyStats();
  if (isPlainObject(saved.stats)) {
    for (const [k, v] of Object.entries(saved.stats)) if (Number.isFinite(v)) out.stats[k] = v;
  }
  out.unlockAll = saved.unlockAll === true;
  return out;
}
