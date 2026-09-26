/**
 * Bubble Pop Battle arenas — a tiny registry of their own. Arenas are built
 * with the normal track kit (makeTrack + buildTrack(def, path, { module })) but
 * they are NOT race tracks: they are not in src/tracks/ (so the lineup, the cups,
 * the track select and the race-track tests never see them) and they have no unlock.
 *
 * To add an arena: write `src/modes/arenas/<id>.js` exporting `{ def, buildScenery }`
 * (def from makeTrack with `arena: true`, `laps: 1`, width 22-28, a short loop
 * 350-650 long) and list it below. tests/battle.arenas.test.js checks every entry.
 *
 * OWNER: showcase features & modes.
 */
import bubbleBath from './bubble-bath.js';
import gumballGarden from './gumball-garden.js';

/** @type {Array<{ def: object, buildScenery: Function }>} in menu order */
export const ARENAS = Object.freeze([bubbleBath, gumballGarden]);

/** Arena module by id (null when unknown). */
export function getArena(id) {
  return ARENAS.find((a) => a.def.id === id) ?? null;
}

/** The arena after `id` (wrapping), for "Another arena!". */
export function nextArenaId(id) {
  const i = ARENAS.findIndex((a) => a.def.id === id);
  return ARENAS[(i + 1) % ARENAS.length].def.id;
}

/** A known arena id, else the first arena's. */
export function arenaIdOr(id) {
  return getArena(id)?.def.id ?? ARENAS[0].def.id;
}
