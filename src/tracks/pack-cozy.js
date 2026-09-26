/**
 * Cozy Cup tracks — OWNER: Tracks — Cozy Cup.
 * Tracks, in cup order (see src/content/lineup.js for names, themes + unlock rules):
 *   pumpkin-patch, teacup-garden, peppermint-village, pillow-fort
 * Shared Cozy props live in src/tracks/props/cozy-*.js; songs in src/audio/songs/<id>.js.
 */
import pumpkinPatch from './pumpkin-patch.js';
import teacupGarden from './teacup-garden.js';
import peppermintVillage from './peppermint-village.js';
import pillowFort from './pillow-fort.js';

/** @type {import('./types.js').TrackModule[]} */
export default [pumpkinPatch, teacupGarden, peppermintVillage, pillowFort];
