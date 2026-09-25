/**
 * Adventure Cup tracks — OWNER: track builder (Adventure Cup).
 * Tracks, in cup order (see src/content/lineup.js for names, themes + unlock rules):
 *   jellybean-jungle, cocoa-canyon, lemonade-volcano, donut-downtown
 *
 * One module per track (src/tracks/<id>.js, default-exporting
 * { def, buildScenery, prepare?, buildRoadDetails? }); shared Adventure Cup
 * props live in src/tracks/props/adventure-*.js.
 */
import jellybeanJungle from './jellybean-jungle.js';

/** @type {import('./types.js').TrackModule[]} */
export default [jellybeanJungle];
