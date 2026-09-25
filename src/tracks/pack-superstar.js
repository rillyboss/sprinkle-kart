/**
 * Superstar Cup tracks — OWNER: track builder (Superstar Cup).
 * Tracks, in cup order (see src/content/lineup.js for names, themes + unlock rules):
 *   cupcake-carnival, aurora-palace, moonbounce-base, ribbon-sky
 *
 * Add one module per track (src/tracks/<id>.js, default-exporting
 * { def, buildScenery, prepare?, buildRoadDetails? }) and list it here, e.g.
 *   import cupcakeCarnival from './cupcake-carnival.js';
 *   export default [cupcakeCarnival, ...];
 */

import cupcakeCarnival from './cupcake-carnival.js';

/** @type {import('./types.js').TrackModule[]} */
export default [cupcakeCarnival];
