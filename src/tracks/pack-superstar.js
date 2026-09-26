/**
 * Superstar Cup tracks — OWNER: track builder (Superstar Cup).
 * Tracks, in cup order (see src/content/lineup.js for names, themes + unlock rules):
 *   cupcake-carnival, aurora-palace, moonbounce-base, ribbon-sky
 *
 * One module per track (src/tracks/<id>.js, default-exporting
 * { def, buildScenery, prepare?, buildRoadDetails? }); shared props live in
 * src/tracks/props/superstar-kit.js and each track's song in src/audio/songs/<id>.js.
 */
import cupcakeCarnival from './cupcake-carnival.js';
import auroraPalace from './aurora-palace.js';
import moonbounceBase from './moonbounce-base.js';
import ribbonSky from './ribbon-sky.js';

/** @type {import('./types.js').TrackModule[]} */
export default [cupcakeCarnival, auroraPalace, moonbounceBase, ribbonSky];
