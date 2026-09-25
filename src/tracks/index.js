/**
 * Track registry — aggregates every track pack (one pack per cup).
 *
 *   TRACKS                TrackDef[] in cup order (Sprinkle, Bubble, Cozy, Adventure, Superstar)
 *   getTrack(id)          TrackDef (falls back to the first track for unknown ids)
 *   findTrack(id)         TrackDef | null
 *   getTrackModule(id)    { def, buildScenery, prepare?, buildRoadDetails? } | null
 *   TRACK_PACKS           [{ id, cup, modules }]
 *
 * Nothing here should be edited to add a track: add a track module and list
 * it in YOUR cup's pack file.
 */
import ORIGINAL from './pack-original.js';
import BUBBLE from './pack-bubble.js';
import COZY from './pack-cozy.js';
import ADVENTURE from './pack-adventure.js';
import SUPERSTAR from './pack-superstar.js';

/** @typedef {import('./types.js').TrackDef} TrackDef */
/** @typedef {import('./types.js').TrackModule} TrackModule */

export const TRACK_PACKS = Object.freeze([
  { id: 'original', cup: 'sprinkle-cup', modules: ORIGINAL },
  { id: 'bubble', cup: 'bubble-cup', modules: BUBBLE },
  { id: 'cozy', cup: 'cozy-cup', modules: COZY },
  { id: 'adventure', cup: 'adventure-cup', modules: ADVENTURE },
  { id: 'superstar', cup: 'superstar-cup', modules: SUPERSTAR },
]);

/** Problems found while aggregating (tests assert this stays empty). */
export const TRACK_REGISTRY_PROBLEMS = [];

/** @type {TrackModule[]} */
export const TRACK_MODULES = (() => {
  const seen = new Set();
  const out = [];
  for (const pack of TRACK_PACKS) {
    for (const mod of pack.modules || []) {
      const def = mod?.def;
      if (!def || typeof def.id !== 'string') {
        TRACK_REGISTRY_PROBLEMS.push(`pack ${pack.id}: module without a def.id`);
        continue;
      }
      if (seen.has(def.id)) {
        TRACK_REGISTRY_PROBLEMS.push(`duplicate track id ${def.id} (pack ${pack.id})`);
        continue;
      }
      if (def.cup !== undefined && def.cup !== pack.cup) {
        TRACK_REGISTRY_PROBLEMS.push(`${def.id} says cup '${def.cup}' but is listed in pack '${pack.id}' (${pack.cup})`);
      }
      seen.add(def.id);
      out.push(def.cup === undefined ? { ...mod, def: { ...def, cup: pack.cup } } : mod);
    }
  }
  return out;
})();

/** @type {TrackDef[]} */
export const TRACKS = TRACK_MODULES.map((m) => m.def);

const BY_ID = new Map(TRACK_MODULES.map((m) => [m.def.id, m]));

/** @returns {TrackDef} the track, or the first track for unknown ids (old contract). */
export function getTrack(id) {
  return BY_ID.get(id)?.def ?? TRACKS[0];
}

/** @returns {TrackDef|null} */
export function findTrack(id) {
  return BY_ID.get(id)?.def ?? null;
}

/** @returns {TrackModule|null} */
export function getTrackModule(id) {
  return BY_ID.get(id) ?? null;
}
