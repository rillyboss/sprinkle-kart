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
