/**
 * Character registry — aggregates every racer pack.
 *
 *   CHARACTERS               CharacterDef[] in menu order (original, then pack A, then pack B)
 *   getCharacter(id)         CharacterDef | null
 *   getSelectableCharacters(isUnlockedFn)   unlocked ones only (locked hidden unless earned)
 *   getCharacterEntry(id)    { def, build } | null (build = the racer's model builder)
 *   CHARACTER_PACKS          [{ id, entries }]
 *
 * Nothing here should be edited to add racers: add a racer file and list it
 * in YOUR pack file (pack-a.js / pack-b.js).
 */
import ORIGINAL from './pack-original.js';
import PACK_A from './pack-a.js';
import PACK_B from './pack-b.js';

/** @typedef {import('./types.js').CharacterDef} CharacterDef */
/** @typedef {import('./types.js').CharacterEntry} CharacterEntry */

export const CHARACTER_PACKS = Object.freeze([
  { id: 'original', entries: ORIGINAL },
  { id: 'a', entries: PACK_A },
  { id: 'b', entries: PACK_B },
]);

/**
 * Registry problems found while aggregating (duplicate ids, entries without a
 * def). Tests assert this is empty; the game skips bad entries instead of
 * crashing so one broken racer never stops the family from playing.
 */
export const CHARACTER_REGISTRY_PROBLEMS = [];

/** @type {CharacterEntry[]} */
export const CHARACTER_ENTRIES = (() => {
  const seen = new Set();
  const out = [];
  for (const pack of CHARACTER_PACKS) {
    for (const entry of pack.entries || []) {
      const def = entry?.def;
      if (!def || typeof def.id !== 'string') {
        CHARACTER_REGISTRY_PROBLEMS.push(`pack ${pack.id}: entry without a def.id`);
        continue;
      }
      if (seen.has(def.id)) {
        CHARACTER_REGISTRY_PROBLEMS.push(`duplicate character id ${def.id} (pack ${pack.id})`);
        continue;
      }
      if (def.pack !== undefined && def.pack !== pack.id) {
        CHARACTER_REGISTRY_PROBLEMS.push(`${def.id} says pack '${def.pack}' but is listed in pack '${pack.id}'`);
      }
      seen.add(def.id);
      out.push({ def: def.pack === undefined ? { ...def, pack: pack.id } : def, build: entry.build });
    }
  }
  return out;
})();

/** @type {CharacterDef[]} */
export const CHARACTERS = CHARACTER_ENTRIES.map((e) => e.def);

const BY_ID = new Map(CHARACTER_ENTRIES.map((e) => [e.def.id, e]));

/**
 * Look up a character by id.
 * @param {string} id
 * @returns {CharacterDef|null} null for unknown ids
 */
export function getCharacter(id) {
  return BY_ID.get(id)?.def ?? null;
}

/** @returns {CharacterEntry|null} */
export function getCharacterEntry(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * Characters a player may pick right now. Locked characters are hidden unless
 * `isUnlockedFn(id)` says they have been earned. Without a function, every
 * locked character stays hidden.
 * @param {(id:string)=>boolean} [isUnlockedFn]
 * @returns {CharacterDef[]}
 */
export function getSelectableCharacters(isUnlockedFn) {
  return CHARACTERS.filter((c) => {
    if (!c.locked) return true;
    try {
      return typeof isUnlockedFn === 'function' && !!isUnlockedFn(c.id);
    } catch {
      return false;
    }
  });
}

/** Convert a 0xRRGGBB number to a CSS '#rrggbb' string (handy for UI). */
export function toCss(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6);
}
