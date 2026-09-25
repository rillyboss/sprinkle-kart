/**
 * Compatibility shim — the roster now lives in src/characters/ (one file per
 * racer, aggregated by packs in src/characters/index.js). Existing imports of
 * this module keep working; new code may import from '../characters/index.js'.
 *
 * NOTE: the race modules (src/race/*) keep importing THIS path on purpose —
 * several unit tests vi.mock('../src/data/characters.js').
 */
export { CHARACTERS, getCharacter, getSelectableCharacters, toCss } from '../characters/index.js';
