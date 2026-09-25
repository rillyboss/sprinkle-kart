/**
 * Compatibility shim — tracks now live in src/tracks/ (one module per track,
 * aggregated per cup by src/tracks/index.js; layout DSL in src/tracks/layout.js).
 */
export { TRACKS, getTrack, findTrack } from '../tracks/index.js';
export { runLayout } from '../tracks/layout.js';
