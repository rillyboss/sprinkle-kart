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
 *     racers: {[characterId]: { races, wins, podiums }},   // per-racer tallies (v2)
 *     settings: { music, sfx, kidAssistDefault },           // v2, kept by "reset progress"
 *
 * TrackStats: { finishes, wins, top3, bestPlace (1-8 | null), timeTrials } — Free Race + Grand Prix races.
 */

import { migrateIdList, migrateIdKeys } from '../content/idAliases.js';

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
  // --- v2 detail counters (Collection / Sticker Book totals; valid in 'stat' rules too) ---
  'miniTurbos1',        // level-1 (blue) drift turbos by humans
  'miniTurbos2',        // level-2 (orange) drift turbos by humans
  'miniTurbos3',        // level-3 (rainbow) drift turbos by humans
  'itemBoxes',          // item boxes popped by humans
  'boosts',             // boosts enjoyed by humans (pads, sprinkles, rocket starts ...)
  'bonked',             // times a human got spun into a happy twirl
  'racesPlayed',        // human race slots played (a 2-player race counts 2)
  'recordsSet',         // new best race / lap times saved via submitRecord()
]);

/** @typedef {{[K in typeof STAT_KEYS[number]]: number}} Stats */

export function emptyStats() {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
}

/**
 * Player settings (saved alongside progress, kept by "reset progress").
 *   music, sfx          0..1 volumes (AudioManager.setVolume)
 *   kidAssistDefault    new players join with Kid-Assist on
 *   onlineOff           "Turn off online play" (NETWORKING.md §1 rule 1): online play is ON by default; a
 *                       grown-up may switch it off in Settings → Grown-ups (switching it back on needs the gate)
 *   relayOnly           "Use the relay for game traffic" (iceTransportPolicy 'relay'; needs our relay)
 * (Older saves' `onlineEnabled` / `approvalGate` are simply dropped.)
 */
export function defaultSettings() {
  return { music: 0.7, sfx: 0.85, kidAssistDefault: false, onlineOff: false, relayOnly: false };
}

/** The online settings; only a real `true` turns one on (hand-edited saves can't sneak "yes" in). */
export const ONLINE_SETTING_KEYS = Object.freeze(['onlineOff', 'relayOnly']);

/** Is online play available on this machine? (on unless a grown-up turned it off) */
export function isOnlineOn(settings) {
  return settings?.onlineOff !== true;
}

/** Per-racer tallies (any human who raced as that character). */
export function emptyRacerStats() {
  return { races: 0, wins: 0, podiums: 0 };
}

/** Per-track tallies (Free Race + Grand Prix races; Time Trials only bump `timeTrials`). */
export function emptyTrackStats() {
  return { finishes: 0, wins: 0, top3: 0, bestPlace: null, timeTrials: 0 };
}

export function emptyProgress() {
  return {
    unlocked: [], wins: 0, trophies: {}, stats: emptyStats(), tracks: {}, cups: {}, records: {},
    racers: {}, settings: defaultSettings(), unlockAll: false,
  };
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
  out.unlocked = Array.isArray(saved.unlocked) ? migrateIdList(saved.unlocked.filter((id) => typeof id === 'string')) : [];
  out.wins = Number.isFinite(saved.wins) ? saved.wins : 0;
  for (const k of ['trophies', 'tracks', 'cups', 'records', 'racers']) out[k] = isPlainObject(saved[k]) ? { ...saved[k] } : {};
  out.tracks = migrateIdKeys(mergeEntries(out.tracks, emptyTrackStats), addTallies);
  out.racers = migrateIdKeys(mergeEntries(out.racers, emptyRacerStats), addTallies);
  for (const k of ['trophies', 'records']) out[k] = migrateIdKeys(out[k]);
  out.cups = mergeEntries(out.cups, () => ({ bestPlace: null, wins: 0, finished: 0 }));
  out.stats = emptyStats();
  if (isPlainObject(saved.stats)) {
    for (const [k, v] of Object.entries(saved.stats)) if (Number.isFinite(v)) out.stats[k] = v;
  }
  out.settings = defaultSettings();
  if (isPlainObject(saved.settings)) {
    const st = saved.settings;
    for (const k of ['music', 'sfx']) if (Number.isFinite(st[k])) out.settings[k] = Math.max(0, Math.min(1, st[k]));
    if (typeof st.kidAssistDefault === 'boolean') out.settings.kidAssistDefault = st.kidAssistDefault;
    for (const k of ONLINE_SETTING_KEYS) out.settings[k] = st[k] === true;
  }
  out.unlocked = [...new Set(out.unlocked)];
  out.unlockAll = saved.unlockAll === true;
  return out;
}

/** Combine two tallies of the same racer/track (a renamed id met its new id): counts add, best place is the best. */
function addTallies(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === 'bestPlace') out[k] = a[k] == null ? v : v == null ? a[k] : Math.min(a[k], v);
    else if (Number.isFinite(v) && Number.isFinite(a[k])) out[k] = a[k] + v;
  }
  return out;
}

/**
 * Merge every entry of a {id: tallies} map over its empty shape: numeric
 * counters keep finite values (others -> 0), `bestPlace` keeps a positive
 * integer or null. Non-object entries are dropped.
 */
function mergeEntries(map, empty) {
  const out = {};
  for (const [id, v] of Object.entries(map)) {
    if (!isPlainObject(v)) continue;
    const e = { ...v, ...empty() };
    for (const [k, def] of Object.entries(empty())) {
      if (k === 'bestPlace') e[k] = Number.isInteger(v[k]) && v[k] >= 1 ? v[k] : null;
      else if (typeof def === 'number') e[k] = Number.isFinite(v[k]) ? v[k] : 0;
    }
    out[id] = e;
  }
  return out;
}
