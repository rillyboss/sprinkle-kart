/**
 * Per-machine progression (NETWORKING.md §12, §9.6).
 *
 * Nothing is ever written to another machine's save. The host's RESULT carries
 * a HostRaceSummary (the normal RaceSummary with EVERY human, keyed by global
 * player index, + online: true); each machine runs `localizeSummary` before it
 * emits its own `race-end`, and `localizeGp` before `gp-end`, so the progress
 * engine, fun goals, records and the Sticker Book credit only this machine's
 * players and never someone else's win.
 *
 * One source of truth for counters: every stat comes from the host's per-player
 * tallies in the summary — never from events this guest predicted locally
 * (those carry `predicted: true` and feed presentation only; `isCountable`).
 *
 * OWNER: WS6 (session, lobby & screens).
 */

const clone = (v) => (v == null ? v : structuredClone(v));
const asSet = (pis) => new Set((pis ?? []).map(Number));

/** Race events that may feed a counter: never locally predicted ones (§9.6). */
export function isCountable(e) {
  return !!e && e.predicted !== true;
}

function localBattle(battle, local) {
  if (!battle || typeof battle !== 'object') return battle;
  const ranking = Array.isArray(battle.ranking) ? battle.ranking : [];
  const mine = ranking.filter((r) => !r.isCPU && local.has(r.playerIndex));
  const winners = mine.filter((r) => r.place === 1);
  return {
    ...clone(battle),
    humanWinner: winners.length ? { playerIndex: winners[0].playerIndex, characterId: winners[0].characterId } : null,
    humanPops: mine.reduce((a, r) => a + (Number(r.pops) || 0), 0),
  };
}

/**
 * @param {object} hostSummary RaceSummary from the host (all humans)
 * @param {number[]} localPis global player indices on this machine
 * @returns {object} RaceSummary for this machine: humans = local rows (host stats),
 *   winner = a LOCAL human 1st or null, totals from local humans, humanCount = all humans,
 *   online: true, unlocks: [] (a fresh collector)
 */
export function localizeSummary(hostSummary, localPis) {
  const local = asSet(localPis);
  const s = hostSummary ?? {};
  const allHumans = Array.isArray(s.humans) ? s.humans : [];
  const humans = allHumans.filter((h) => local.has(h.playerIndex)).map((h) => clone(h));
  const sum = (key) => humans.reduce((a, h) => a + (Number(h.stats?.[key]) || 0), 0);
  const winner = s.winner && local.has(s.winner.playerIndex) ? { ...s.winner } : null;
  const out = {
    ...clone(s),
    humans,
    humanCount: Math.max(Number(s.humanCount) || 0, allHumans.length),
    winner,
    totals: { itemsUsed: sum('itemsUsed'), bonksGiven: sum('bonksGiven'), miniTurbos: sum('miniTurbos') },
    unlocks: [],
    online: true,
  };
  delete out.records; // best times are each machine's own business (timingRecords fills it for local players)
  if (s.battle) out.battle = localBattle(s.battle, local);
  // Team Race: every human is on Team Sprinkle (§11), so a team win is every house's win — kept.
  return out;
}

/**
 * @param {object} gp GrandPrixResult from the host
 * @param {number[]} localPis
 * @returns {object} GrandPrixResult with humanWinner / bestHumanPlace for LOCAL humans only,
 *   races localized, unlocks: [] (a fresh collector)
 */
export function localizeGp(gp, localPis) {
  const local = asSet(localPis);
  const g = gp ?? {};
  const standings = Array.isArray(g.standings) ? g.standings : [];
  const top = standings[0] ?? null;
  const mine = standings.filter((r) => !r.isCPU && local.has(r.playerIndex));
  return {
    ...clone(g),
    races: Array.isArray(g.races) ? g.races.map((r) => localizeSummary(r, localPis)) : [],
    humanWinner: top && !top.isCPU && local.has(top.playerIndex) ? { playerIndex: top.playerIndex, characterId: top.characterId } : null,
    bestHumanPlace: mine.length ? Math.min(...mine.map((r) => r.place)) : null,
    unlocks: [],
    online: true,
  };
}
