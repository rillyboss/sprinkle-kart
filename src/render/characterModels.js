/**
 * Compatibility shim — kart models are now assembled by src/characters/model.js
 * from each racer's own module (src/characters/<id>.js) and the shared parts
 * library (src/characters/parts.js).
 *
 *   buildKartModel(charDef) -> { group, update(dt, state), dispose(), characterId, triangles, head }
 */
import { modelledCharacterIds } from '../characters/model.js';

export { buildKartModel } from '../characters/model.js';

/** Ids that have a hand-built model (anything else gets the generic racer). */
export const MODELLED_CHARACTER_IDS = Object.freeze(modelledCharacterIds());
