/**
 * Renamed content ids — old saved id -> current id.
 *
 * When a racer or track is renamed, its old id stays in families' saves
 * (unlock list, per-racer tallies, paints, record holders, ghosts). Every
 * store loader runs its ids through `migrateId()` so nothing earned is lost.
 * Pure, DOM-free and idempotent: migrating twice changes nothing.
 *
 * v2.0.1: the blueberry ghost got her own original name, Peekaberry.
 *
 * OWNER: architect (shared, append-only — never remove an alias).
 */

/** @type {Readonly<Record<string, string>>} */
export const ID_ALIASES = Object.freeze({
  'boo-berry': 'peekaberry',
});

/** The current id for a (possibly old) saved id. Non-strings pass through untouched. */
export function migrateId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ID_ALIASES, id) ? ID_ALIASES[id] : id;
}

/** An id list with old ids renamed and duplicates removed (order kept). */
export function migrateIdList(list) {
  if (!Array.isArray(list)) return list;
  return [...new Set(list.map(migrateId))];
}

/**
 * A copy of an {id: value} map with old keys renamed. When both the old and
 * the new key exist, `combine(current, old)` decides (default: keep current).
 */
export function migrateIdKeys(map, combine = (cur) => cur) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
  const out = {};
  // current ids first, so an old alias never overwrites a newer value
  for (const [k, v] of Object.entries(map)) if (migrateId(k) === k) out[k] = v;
  for (const [k, v] of Object.entries(map)) {
    const to = migrateId(k);
    if (to === k) continue;
    out[to] = Object.prototype.hasOwnProperty.call(out, to) ? combine(out[to], v) : v;
  }
  return out;
}
