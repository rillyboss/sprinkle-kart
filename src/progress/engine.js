/**
 * The unlock rule engine — PURE functions over a progress object (the shape
 * in ./schema.js). No storage, no DOM: src/progress/progress.js applies them
 * to the saved progress and src/systems/progressUnlocks.js feeds them events.
 *
 *   applyRaceSummary(p, summary)          record one finished race (Free Race / Grand Prix / Time Trial)
 *   applyGrandPrix(p, gp)                 record a finished Grand Prix cup ('gp-end')
 *   ruleProgress(rule, p)                 { current, target, done, ratio } for any UnlockRule
 *   isRuleMet(rule, p)
 *   evaluateUnlocks(p, entries)           [{ kind, id }] entries whose rule is met but not yet earned
 *   nextUnlock(p, entries)                the closest-to-done locked entry (results teaser)
 *
 * Counting rules (ARCHITECTURE.md §9): a "race" is a Free Race or Grand Prix
 * race (not a Time Trial); counters are shared by the family, so a race counts
 * ONCE however many humans reached the goal (ANY human's result counts);
 * wins / top-3 ignore estimated finishes. Item / bonk / turbo counters add up
 * every human's tally (they are per-action, not per-race).
 *
 * Every apply* function MUTATES and returns `p` (callers pass a fresh merged
 * copy — see progress.js `update()`), so tests can chain them.
 */
import { LINEUP_CUPS, LINEUP_CHARACTERS, LINEUP_TRACKS } from '../content/lineup.js';
import { emptyTrackStats, emptyRacerStats, emptyStats } from './schema.js';

/** Which TrackStats counter a rule `result` reads. */
export const RESULT_FIELD = Object.freeze({ win: 'wins', top3: 'top3', finish: 'finishes' });

const num = (v) => (Number.isFinite(v) ? v : 0);
const cupTrackIds = (cupId) => LINEUP_CUPS.find((c) => c.id === cupId)?.trackIds ?? [];

function ensure(p) {
  p.stats = p.stats && typeof p.stats === 'object' ? p.stats : emptyStats();
  for (const k of ['tracks', 'cups', 'trophies', 'records', 'racers']) if (!p[k] || typeof p[k] !== 'object') p[k] = {};
  if (!Array.isArray(p.unlocked)) p.unlocked = [];
  if (!Number.isFinite(p.wins)) p.wins = 0;
  return p;
}
const bump = (p, key, n = 1) => { p.stats[key] = num(p.stats[key]) + n; };
const trackOf = (p, id) => (p.tracks[id] = { ...emptyTrackStats(), ...(p.tracks[id] || {}) });
const racerOf = (p, id) => (p.racers[id] = { ...emptyRacerStats(), ...(p.racers[id] || {}) });

/** Per-human tallies from a summary row (null-safe; `fallback` = the system's own event tally). */
function tallyOf(h, fallback) {
  const s = h?.stats || fallback || {};
  const levels = Array.isArray(s.driftBoosts) ? s.driftBoosts : [0, 0, 0];
  return {
    itemsUsed: num(s.itemsUsed),
    bonksGiven: num(s.bonksGiven),
    bonked: num(s.bonked),
    miniTurbos: num(s.miniTurbos),
    levels: [num(levels[0]), num(levels[1]), num(levels[2])],
    boosts: num(s.boosts),
    itemBoxes: num(s.itemBoxes),
  };
}

const realPlace = (h) => (Number.isInteger(h.place) && h.place >= 1 ? h.place : null);
const wonBy = (h) => !!h.finished && !h.estimated && realPlace(h) === 1;
const top3By = (h) => !!h.finished && !h.estimated && realPlace(h) !== null && realPlace(h) <= 3;

/**
 * Record one completed race from its RaceSummary (§6).
 * @param {object} p progress (mutated)
 * @param {object} summary RaceSummary
 * @param {{ tallies?: (playerIndex:number) => object|null }} [opts] fallback per-human counters
 *   when the summary carries no `stats` (the system's own event tally)
 * @returns {object} p
 */
export function applyRaceSummary(p, summary, { tallies = null } = {}) {
  ensure(p);
  if (!summary || typeof summary !== 'object') return p;
  const humans = Array.isArray(summary.humans) ? summary.humans : [];
  if (!humans.length) return p;
  const trackId = typeof summary.trackId === 'string' ? summary.trackId : null;
  const finishers = humans.filter((h) => h.finished);

  // Per-action counters: every human's tally adds up (a Time Trial counts too — turbos are turbos).
  for (const h of humans) {
    const t = tallyOf(h, tallies ? tallies(h.playerIndex) : null);
    bump(p, 'itemsUsed', t.itemsUsed);
    bump(p, 'bonksGiven', t.bonksGiven);
    bump(p, 'bonked', t.bonked);
    bump(p, 'miniTurbos', t.miniTurbos);
    bump(p, 'miniTurbos1', t.levels[0]);
    bump(p, 'miniTurbos2', t.levels[1]);
    bump(p, 'miniTurbos3', t.levels[2]);
    bump(p, 'boosts', t.boosts);
    bump(p, 'itemBoxes', t.itemBoxes);
  }

  // Bubble Pop Battle is not a race (no finish line): only the per-action counters count.
  // A How to Play practice race (solo, no CPUs) is not a real race either.
  if (summary.mode === 'battle' || summary.mode === 'tutorial') return p;

  if (summary.mode === 'time-trial') {
    if (finishers.length) {
      bump(p, 'timeTrialsFinished');
      if (trackId) trackOf(p, trackId).timeTrials += 1;
    }
    return p;
  }

  if (!finishers.length) return p; // nobody crossed the line: only the item counters count
  bump(p, 'racesFinished');
  bump(p, 'racesPlayed', finishers.length);
  const won = humans.some(wonBy);
  const podium = humans.some(top3By);
  if (won) bump(p, 'wins');
  if (podium) bump(p, 'podiums');
  if ((summary.humanCount ?? humans.length) >= 2) bump(p, 'multiplayerRaces');
  if (finishers.some((h) => h.kidAssist)) bump(p, 'kidAssistFinishes');

  if (trackId) {
    const t = trackOf(p, trackId);
    t.finishes += 1;
    if (won) t.wins += 1;
    if (podium) t.top3 += 1;
    const places = humans.filter((h) => h.finished && !h.estimated).map(realPlace).filter((x) => x !== null);
    if (places.length) t.bestPlace = t.bestPlace === null ? Math.min(...places) : Math.min(t.bestPlace, ...places);
    // Legacy trophy counters (title screen, track cards).
    if (won) {
      p.wins += 1;
      p.trophies[trackId] = num(p.trophies[trackId]) + 1;
    }
  }

  for (const h of finishers) {
    if (typeof h.characterId !== 'string') continue;
    const r = racerOf(p, h.characterId);
    r.races += 1;
    if (wonBy(h)) r.wins += 1;
    if (top3By(h)) r.podiums += 1;
  }
  return p;
}

/**
 * Record a finished Grand Prix ('gp-end' GrandPrixResult).
 * @returns {object} p
 */
export function applyGrandPrix(p, gp) {
  ensure(p);
  if (!gp || typeof gp.cupId !== 'string' || gp.finished === false) return p;
  bump(p, 'grandPrixFinished');
  // A family-built "My Cup" (modes/myCup.js MY_CUP_ID) counts as a finished
  // Grand Prix, but only the real cups give cup trophies / "win a cup" unlocks.
  if (gp.cupId === 'my-cup') return p;
  const c = (p.cups[gp.cupId] = { bestPlace: null, wins: 0, finished: 0, ...(p.cups[gp.cupId] || {}) });
  c.finished = num(c.finished) + 1;
  const best = Number.isInteger(gp.bestHumanPlace) && gp.bestHumanPlace >= 1 ? gp.bestHumanPlace : null;
  if (best !== null) c.bestPlace = c.bestPlace === null ? best : Math.min(c.bestPlace, best);
  if (gp.humanWinner) {
    bump(p, 'cupsWon');
    c.wins = num(c.wins) + 1;
    c.bestPlace = 1;
  }
  return p;
}

/**
 * How far along an UnlockRule is. `null` rule = always done.
 * @returns {{ current: number, target: number, done: boolean, ratio: number }}
 */
export function ruleProgress(rule, p) {
  const out = (current, target) => {
    const t = Math.max(1, target | 0);
    const c = Math.max(0, Math.min(t, Math.floor(num(current))));
    return { current: c, target: t, done: c >= t, ratio: c / t };
  };
  if (!rule) return out(1, 1);
  const tracks = p?.tracks || {};
  const has = (id, result) => num(tracks[id]?.[RESULT_FIELD[result]]) >= 1;
  switch (rule.type) {
    case 'stat': return out(p?.stats?.[rule.stat], rule.count ?? 1);
    case 'track': return out(RESULT_FIELD[rule.result] && has(rule.trackId, rule.result) ? 1 : 0, 1);
    case 'cup-track': return out(RESULT_FIELD[rule.result] && cupTrackIds(rule.cupId).some((id) => has(id, rule.result)) ? 1 : 0, 1);
    case 'distinct-tracks': {
      if (!RESULT_FIELD[rule.result]) return out(0, rule.count ?? 1);
      const n = Object.keys(tracks).filter((id) => has(id, rule.result)).length;
      return out(n, rule.count ?? 1);
    }
    default: return out(0, 1); // unknown rule: never unlocks by play (a parent can still unlock all)
  }
}

export const isRuleMet = (rule, p) => ruleProgress(rule, p).done;

/**
 * Unlockable content entries, in celebration order: characters, then tracks.
 * Default = the whole binding lineup; the race system passes the REGISTERED
 * content so nothing that is not built yet is "unlocked" silently.
 * @returns {{kind:'character'|'track', id:string, unlock:object|null}[]}
 */
export function lineupEntries() {
  return [
    ...LINEUP_CHARACTERS.map((c) => ({ kind: 'character', id: c.id, unlock: c.unlock })),
    ...LINEUP_TRACKS.map((t) => ({ kind: 'track', id: t.id, unlock: t.unlock })),
  ];
}

/** Content defs (registry CharacterDef / TrackDef) -> engine entries (lineup rule when the def has none). */
export function entriesFrom(characters = [], tracks = []) {
  const rule = (d, list) => (d.unlock !== undefined ? d.unlock : list.find((x) => x.id === d.id)?.unlock ?? null);
  return [
    ...characters.filter((d) => d && !d.placeholder).map((d) => ({ kind: 'character', id: d.id, unlock: rule(d, LINEUP_CHARACTERS) })),
    ...tracks.filter((d) => d && !d.placeholder).map((d) => ({ kind: 'track', id: d.id, unlock: rule(d, LINEUP_TRACKS) })),
  ];
}

/**
 * Entries whose rule is met but that are not yet earned (`p.unlocked`).
 * Free content (no rule) is never "unlocked". Idempotent: once the ids are
 * added to `p.unlocked`, a second call returns [].
 * @returns {{kind:'character'|'track', id:string}[]}
 */
export function evaluateUnlocks(p, entries = lineupEntries()) {
  const earned = new Set(p?.unlocked || []);
  const out = [];
  for (const e of entries) {
    if (!e?.unlock || earned.has(e.id)) continue;
    if (isRuleMet(e.unlock, p)) {
      out.push({ kind: e.kind, id: e.id });
      earned.add(e.id);
    }
  }
  return out;
}

/**
 * The locked entry closest to being earned (biggest ratio, then fewest steps
 * left, then lineup order) — for the results "Next unlock" teaser.
 * Returns null when everything is earned (or unlockAll is on).
 * @returns {{kind, id, unlock, progress: ReturnType<typeof ruleProgress>} | null}
 */
export function nextUnlock(p, entries = lineupEntries()) {
  if (p?.unlockAll) return null;
  const earned = new Set(p?.unlocked || []);
  let best = null;
  entries.forEach((e, order) => {
    if (!e?.unlock || earned.has(e.id)) return;
    const pr = ruleProgress(e.unlock, p);
    if (pr.done) return; // about to unlock anyway
    const left = pr.target - pr.current;
    const better = !best || pr.ratio > best.progress.ratio
      || (pr.ratio === best.progress.ratio && (left < best.left || (left === best.left && order < best.order)));
    if (better) best = { kind: e.kind, id: e.id, unlock: e.unlock, progress: pr, left, order };
  });
  if (!best) return null;
  const { left, order, ...rest } = best;
  return rest;
}

/** "1/3" style counter text, or '' for yes/no rules (target 1). */
export function progressCount(pr) {
  return pr && pr.target > 1 ? `${pr.current}/${pr.target}` : '';
}
