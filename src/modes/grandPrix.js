/**
 * Grand Prix session (pure reducer, unit tested). One cup = 4 races with the
 * same racers; points come from scoreGrandPrix() (src/data/cups.js), which
 * also builds the 'gp-race-end' / 'gp-end' payload.
 *
 *   let gp = createGrandPrix({ cupId, trackIds, cpuIds });
 *   setup = gpRaceSetup(gp, baseSetup);           // RaceSetup for the current race
 *   gp = gpRecordRace(gp, summary);               // after race-end -> phase 'standings' | 'done'
 *   gp.result                                     // GrandPrixResult so far
 *   gp = gpNextRace(gp);                          // -> phase 'racing' on the next track
 *
 * OWNER: modes + timing workstream.
 */
import { scoreGrandPrix, getCup, cupTracks, isCupPlayable, GP_POINTS } from '../data/cups.js';

/**
 * @param {object} o
 * @param {string} o.cupId
 * @param {string[]} o.trackIds the cup's tracks in order
 * @param {string[]} [o.cpuIds] CPU racers, fixed for the whole cup
 */
export function createGrandPrix({ cupId, trackIds, cpuIds = [] }) {
  if (!trackIds?.length) throw new Error(`[gp] cup "${cupId}" has no tracks`);
  return Object.freeze({
    cupId,
    trackIds: Object.freeze([...trackIds]),
    cpuIds: Object.freeze([...cpuIds]),
    raceIndex: 0,
    summaries: Object.freeze([]),
    result: null,
    phase: 'racing',
  });
}

export const gpTrackId = (gp) => gp.trackIds[gp.raceIndex] ?? null;
export const gpRaceCount = (gp) => gp.trackIds.length;
export const gpIsLastRace = (gp) => gp.raceIndex >= gp.trackIds.length - 1;

/**
 * CPU grid order for the current race: after race 1 the CPU points leader
 * starts on pole (index 0), the others follow by points (humans always start
 * at the back, see buildParticipants).
 */
export function gpCpuGrid(gp) {
  if (!gp.result) return [...gp.cpuIds];
  const pts = new Map(gp.result.standings.filter((r) => r.isCPU).map((r) => [r.characterId, r.points]));
  return [...gp.cpuIds].map((id, i) => ({ id, i, p: pts.get(id) ?? 0 }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.id);
}

/** RaceSetup for the current race from the cup's base setup (players, speed class). */
export function gpRaceSetup(gp, base, { laps = null } = {}) {
  return {
    ...base,
    mode: 'grand-prix',
    cupId: gp.cupId,
    trackId: gpTrackId(gp),
    laps,
    cpuIds: gpCpuGrid(gp),
    gpRace: gp.raceIndex,
  };
}

/** Add a finished race; scores the cup so far. */
export function gpRecordRace(gp, summary) {
  if (gp.phase !== 'racing' || !summary) return gp;
  const summaries = [...gp.summaries, summary];
  const result = scoreGrandPrix(gp.cupId, summaries, { raceCount: gp.trackIds.length });
  return Object.freeze({
    ...gp,
    summaries: Object.freeze(summaries),
    result,
    phase: result.finished ? 'done' : 'standings',
  });
}

/** On to the next race (from the standings screen). */
export function gpNextRace(gp) {
  if (gp.phase !== 'standings') return gp;
  return Object.freeze({ ...gp, raceIndex: gp.raceIndex + 1, phase: 'racing' });
}

/* ---------------- standings screen helpers ---------------- */

/**
 * Rows for the standings tally: every racer with points before and after the
 * latest race, the old and new rank, and the points just earned.
 * @param {import('../game/events.js').GrandPrixResult} result
 */
export function standingsTally(result) {
  const last = Math.max(0, (result?.races?.length ?? 1) - 1);
  const rows = (result?.standings ?? []).map((r) => {
    const gained = r.racePoints?.[last] ?? 0;
    return { ...r, before: r.points - gained, after: r.points, gained };
  });
  const byBefore = [...rows].sort((a, b) => b.before - a.before || a.place - b.place);
  const oldRank = new Map(byBefore.map((r, i) => [r, i]));
  return rows.map((r, i) => ({ ...r, fromIndex: oldRank.get(r), toIndex: i }));
}

/** Ease-out count-up used by the tally animation: value at time t of dur seconds. */
export function tallyValue(from, to, t, dur = 1.2) {
  if (!(dur > 0) || t >= dur) return to;
  if (t <= 0) return from;
  const k = 1 - (1 - t / dur) ** 3;
  return Math.round(from + (to - from) * k);
}

/** 'gold' | 'silver' | 'bronze' | null for a final GP place. */
export function trophyFor(place) {
  return ['gold', 'silver', 'bronze'][(place | 0) - 1] ?? null;
}

/** The top three for the trophy podium, in podium display order (2nd, 1st, 3rd). */
export function podiumOrder(standings = []) {
  const top = standings.slice(0, 3);
  return [top[1], top[0], top[2]].filter(Boolean);
}

/** Headline for the trophy ceremony. */
export function ceremonyHeadline(result, nameOf = (id) => id, cupName = 'the cup') {
  const top = result?.standings?.[0];
  if (!top) return 'What a Grand Prix! 🎉';
  if (!top.isCPU) return `P${top.playerIndex + 1} ${nameOf(top.characterId)} wins ${cupName}! 🏆`;
  const best = result.bestHumanPlace;
  if (best === 2) return 'Silver cup! So shiny! 🥈';
  if (best === 3) return 'Bronze cup! Hooray! 🥉';
  return `${nameOf(top.characterId)} wins ${cupName}! What a party! 🎉`;
}

/* ---------------- cup select helpers ---------------- */

/**
 * Cup cards for the cup-select screen.
 * @param {object[]} cups CUPS
 * @param {object[]} tracks registry (TrackDefs)
 * @param {(trackDef)=>boolean} isTrackLocked
 * @returns {Array<{ cup, tracks: Array<{def, locked}>, playable: boolean, missing: number, firstLocked: object|null }>}
 */
export function cupCards(cups, tracks, isTrackLocked) {
  return cups.map((cup) => {
    const list = cupTracks(cup.id, tracks);
    const items = list.map((def) => ({ def, locked: (() => { try { return !!isTrackLocked(def); } catch { return true; } })() }));
    const playable = isCupPlayable(cup, (t) => !isTrackLocked(t), tracks);
    return {
      cup,
      tracks: items,
      playable,
      missing: cup.trackIds.length - list.length,
      firstLocked: items.find((t) => t.locked)?.def ?? null,
    };
  });
}

export { GP_POINTS, getCup };
