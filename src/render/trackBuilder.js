/**
 * Compatibility shim — the track builder is now split into:
 *   src/tracks/core.js        generic road/curbs/fences/arch/pads/sky/lights/ground (buildTrack)
 *   src/tracks/sceneryKit.js  reusable props (trees, lollipops, towers, sparkles, ...)
 *   src/tracks/<id>.js        each track's own data + buildScenery(ctx)
 *   src/tracks/pathTools.js   rng, road index, terrain, item slots, boost pads
 */
export { buildTrack } from '../tracks/core.js';
export { FENCE_OFFSET, SKY_RADIUS, TREE_CAMERA_CLEARANCE } from '../tracks/constants.js';
export {
  makeRng, seedFromString, createPathIndex, createTerrain, computeItemBoxSlots, computeBoostPads,
} from '../tracks/pathTools.js';
