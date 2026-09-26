/**
 * Team Race — the rules (pure, DOM-free, unit tested).
 *
 * The family races together: every human is on Team Sprinkle, CPU buddies
 * fill it up to half the grid, and the other CPUs are Team Sparkle.
 * Every racer scores Grand Prix points for their place (15/12/10/8/6/4/2/1)
 * and the team with the most points wins. Team-mates never bonk each other
 * (their items and star power pass right through friends — see Race.friendly).
 *
 *   assignTeams(participants)          -> team id per participant (same order)
 *   scoreTeamRace(rows)                -> { totals, winner, margin, rows, mvp }
 *   liveTeamScore(karts)               -> the same from karts' current places (HUD)
 *   createTeamSeries() / teamSeriesAdd(series, result) -> the running score over several races
 *   teamResultText(result, series)     -> friendly headline for the results screen
 *
 * OWNER: showcase features & modes.
 */
import { GP_POINTS } from '../data/cups.js';

export const TEAMS = Object.freeze([
  Object.freeze({ id: 'sprinkle', name: 'Team Sprinkle', emoji: '🍭', color: '#ff5fb4', hex: 0xff5fb4 }),
  Object.freeze({ id: 'sparkle', name: 'Team Sparkle', emoji: '⭐', color: '#4fb3ff', hex: 0x4fb3ff }),
]);
export const HOME_TEAM = 'sprinkle';
export const AWAY_TEAM = 'sparkle';

export const teamInfo = (id) => TEAMS.find((t) => t.id === id) ?? TEAMS[0];
const isHuman = (p) => p && p.playerIndex !== null && p.playerIndex !== undefined && !p.isCPU;

/**
 * Humans all join Team Sprinkle; CPUs fill it up to half the grid (rounded up),
 * the rest race for Team Sparkle.
 * @param {Array<{playerIndex?: number|null, isCPU?: boolean}>} participants
 * @returns {string[]} team id per participant
 */
export function assignTeams(participants = []) {
  const list = participants || [];
  const half = Math.ceil(list.length / 2);
  let home = list.filter(isHuman).length;
  return list.map((p) => {
    if (isHuman(p)) return HOME_TEAM;
    if (home < half) { home++; return HOME_TEAM; }
    return AWAY_TEAM;
  });
}

export const placePoints = (place) => GP_POINTS[(place | 0) - 1] ?? 0;

/**
 * Score a race. `rows` = standings rows best first with `{ place, team, ... }`.
 * @returns {{ totals: {sprinkle:number, sparkle:number}, winner: 'sprinkle'|'sparkle'|null, margin: number,
 *   rows: Array<object & { points: number }>, mvp: {sprinkle: object|null, sparkle: object|null} }}
 */
export function scoreTeamRace(rows = []) {
  const totals = { [HOME_TEAM]: 0, [AWAY_TEAM]: 0 };
  const mvp = { [HOME_TEAM]: null, [AWAY_TEAM]: null };
  const scored = (rows || []).map((r, i) => {
    const place = Number.isInteger(r?.place) && r.place >= 1 ? r.place : i + 1;
    const points = placePoints(place);
    const team = r?.team === AWAY_TEAM ? AWAY_TEAM : r?.team === HOME_TEAM ? HOME_TEAM : null;
    if (team) {
      totals[team] += points;
      if (!mvp[team] || place < mvp[team].place) mvp[team] = { ...r, place, points };
    }
    return { ...r, place, points, team };
  });
  const diff = totals[HOME_TEAM] - totals[AWAY_TEAM];
  return { totals, winner: diff > 0 ? HOME_TEAM : diff < 0 ? AWAY_TEAM : null, margin: Math.abs(diff), rows: scored, mvp };
}

/** Live score from karts (`kart.team`, `kart.place`) for the HUD. */
export function liveTeamScore(karts = []) {
  const rows = [...(karts || [])]
    .filter((k) => k && k.team)
    .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
    .map((k) => ({ id: k.id, team: k.team, place: k.finished ? (k.finishPlace ?? k.place) : k.place, characterId: k.characterId, playerIndex: k.playerIndex }));
  return scoreTeamRace(rows);
}

/** The running score over several team races in a row. */
export function createTeamSeries() {
  return { races: 0, wins: { [HOME_TEAM]: 0, [AWAY_TEAM]: 0 }, ties: 0, points: { [HOME_TEAM]: 0, [AWAY_TEAM]: 0 } };
}

/** Add one race result (from scoreTeamRace) to a series (returns a new series). */
export function teamSeriesAdd(series, result) {
  const s = series && typeof series === 'object' ? series : createTeamSeries();
  const out = {
    races: (s.races | 0) + 1,
    wins: { ...createTeamSeries().wins, ...(s.wins || {}) },
    ties: (s.ties | 0),
    points: { ...createTeamSeries().points, ...(s.points || {}) },
  };
  if (!result) return out;
  if (result.winner) out.wins[result.winner] += 1;
  else out.ties += 1;
  for (const t of [HOME_TEAM, AWAY_TEAM]) out.points[t] += result.totals?.[t] ?? 0;
  return out;
}

/** Friendly headline + subline for the results screen. */
export function teamResultText(result, series = null) {
  if (!result) return { title: 'Team Race!', sub: '' };
  let title;
  if (result.winner === HOME_TEAM) title = result.margin >= 15 ? 'Team Sprinkle wins BIG! 🍭🎉' : 'Team Sprinkle wins! 🍭';
  else if (result.winner === AWAY_TEAM) title = result.margin <= 4 ? 'So close! Team Sparkle by a sprinkle ⭐' : 'Team Sparkle wins this time ⭐';
  else title = "It's a tie! Everybody's a winner 🤝";
  let sub = '';
  if (series && series.races > 1) {
    sub = `Series: 🍭 ${series.wins[HOME_TEAM]} – ${series.wins[AWAY_TEAM]} ⭐${series.ties ? ` (${series.ties} tie${series.ties === 1 ? '' : 's'})` : ''}`;
  } else if (result.winner === AWAY_TEAM) {
    sub = 'Team-mates can’t bonk each other — try a rematch!';
  }
  return { title, sub };
}
