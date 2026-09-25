/**
 * Grand Prix cups (4 races each). Ids, names and track lists come from the
 * binding lineup (src/content/lineup.js). Helpers only ever return tracks that
 * are actually registered, so a cup whose tracks are still being built simply
 * shows fewer (or no) tracks instead of breaking anything.
 */
import { LINEUP_CUPS } from '../content/lineup.js';
import { TRACKS } from '../tracks/index.js';

/** Grand Prix points for 1st..8th. */
export const GP_POINTS = Object.freeze([15, 12, 10, 8, 6, 4, 2, 1]);

/** Points for a finishing place (1-based); 0 outside the table. */
export function pointsForPlace(place) {
  return GP_POINTS[(place | 0) - 1] ?? 0;
}

/**
 * @typedef {{id:string, name:string, emoji:string, trackIds:string[]}} CupDef
 * @type {CupDef[]}
 */
export const CUPS = LINEUP_CUPS.map((c) => Object.freeze({ ...c, trackIds: Object.freeze([...c.trackIds]) }));

const BY_ID = new Map(CUPS.map((c) => [c.id, c]));

/** @returns {CupDef|null} */
export function getCup(id) {
  return BY_ID.get(id) ?? null;
}

/** The cup a track belongs to (by the lineup), or null. */
export function cupOfTrack(trackId) {
  return CUPS.find((c) => c.trackIds.includes(trackId)) ?? null;
}

/**
 * The registered TrackDefs of a cup, in cup order (unregistered ids skipped).
 * @param {string} cupId
 * @param {Array<{id:string}>} [tracks] registry to look in (default: all registered tracks)
 */
export function cupTracks(cupId, tracks = TRACKS) {
  const cup = getCup(cupId);
  if (!cup) return [];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return cup.trackIds.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Tracks grouped by cup for menus: [{ cup, tracks }] in cup order, skipping
 * empty cups. Tracks that belong to no cup go in a trailing group with
 * `cup: null` (e.g. a work-in-progress track).
 * @param {Array<{id:string}>} [tracks]
 */
export function groupTracksByCup(tracks = TRACKS) {
  const groups = [];
  const placed = new Set();
  for (const cup of CUPS) {
    const list = cupTracks(cup.id, tracks);
    list.forEach((t) => placed.add(t.id));
    if (list.length) groups.push({ cup, tracks: list });
  }
  const rest = tracks.filter((t) => !placed.has(t.id));
  if (rest.length) groups.push({ cup: null, tracks: rest });
  return groups;
}

/** Cups that have all 4 of their tracks registered (ready for a Grand Prix). */
export function completeCups(tracks = TRACKS) {
  return CUPS.filter((c) => cupTracks(c.id, tracks).length === c.trackIds.length);
}

/**
 * Default Grand Prix availability: a cup is playable when every one of its
 * tracks is registered and available (see src/progress/access.js isAvailable).
 * (Modes/progression may refine this.)
 * @param {CupDef} cup
 * @param {(trackDef:object)=>boolean} isTrackAvailable
 */
export function isCupPlayable(cup, isTrackAvailable, tracks = TRACKS) {
  const list = cupTracks(cup.id, tracks);
  return list.length === cup.trackIds.length && list.every((t) => { try { return !!isTrackAvailable(t); } catch { return false; } });
}

/**
 * Grand Prix scoring — the ONE shared definition of the 'gp-race-end' / 'gp-end'
 * payload (GrandPrixResult, see src/game/events.js). Modes builds it after each
 * GP race; progression reads it on 'gp-end'.
 *
 * Racers are matched across races by player (humans) or by character (CPUs).
 * Ties on points go to more 1st places, then the better place in the latest race.
 *
 * @param {string} cupId
 * @param {Array<{standings: Array<{characterId:string, playerIndex:number|null, isCPU:boolean, place:number}>}>} races
 *   RaceSummary of every race run so far, in order
 * @param {{raceCount?: number}} [opts]
 * @returns {import('../game/events.js').GrandPrixResult}
 */
export function scoreGrandPrix(cupId, races = [], { raceCount } = {}) {
  const total = raceCount ?? getCup(cupId)?.trackIds.length ?? 4;
  const rows = new Map();
  races.forEach((summary, ri) => {
    for (const s of summary?.standings || []) {
      const human = s.playerIndex !== null && s.playerIndex !== undefined && !s.isCPU;
      const key = human ? `p${s.playerIndex}` : `c:${s.characterId}`;
      let row = rows.get(key);
      if (!row) {
        row = { characterId: s.characterId, playerIndex: human ? s.playerIndex : null, isCPU: !human, points: 0, place: 0, racePoints: new Array(races.length).fill(0), wins: 0, last: 99 };
        rows.set(key, row);
      }
      row.characterId = s.characterId;
      const pts = pointsForPlace(s.place);
      row.racePoints[ri] = pts;
      row.points += pts;
      if (s.place === 1) row.wins += 1;
      if (ri === races.length - 1) row.last = s.place;
    }
  });
  const sorted = [...rows.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.last - b.last);
  sorted.forEach((r, i) => { r.place = i + 1; });
  const standings = sorted.map(({ wins, last, ...r }) => r);
  const humans = standings.filter((r) => !r.isCPU);
  const top = standings[0];
  return {
    cupId,
    raceIndex: Math.max(0, races.length - 1),
    raceCount: total,
    finished: races.length >= total,
    races: [...races],
    standings,
    humanWinner: top && !top.isCPU ? { playerIndex: top.playerIndex, characterId: top.characterId } : null,
    bestHumanPlace: humans.length ? humans[0].place : null,
    unlocks: [],
  };
}
