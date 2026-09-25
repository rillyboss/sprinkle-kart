/**
 * Shared JSDoc types for track modules (no runtime code). See ARCHITECTURE.md.
 *
 * @typedef {import('../progress/schema.js').UnlockRule} UnlockRule
 *
 * @typedef {Object} TrackDef
 * @property {string} id              kebab-case, unique across ALL content
 * @property {string} name
 * @property {string} subtitle
 * @property {number} laps
 * @property {number} width           road width (16..22)
 * @property {number} previewColor    menu card colour
 * @property {string} cup             cup id (src/data/cups.js)
 * @property {UnlockRule|null} unlock
 * @property {number[][]} controlPoints  closed loop [x,y,z] in race order (from makeTrack)
 * @property {object} theme           colours + music + builder extras (ARCHITECTURE.md → theme fields)
 * @property {number[]} itemBoxRows   fractions of the lap
 * @property {{at:number, lateral:number}[]} boostPads
 * @property {object} scenery         builder hints: terrain, hills, bridges, basin, fence, arch, center, ...
 *
 * @typedef {Object} TrackModule      what a track module default-exports
 * @property {TrackDef} def
 * @property {(ctx: object) => void} buildScenery
 * @property {(args: {def: TrackDef, path: object, index: object}) => TrackDef} [prepare]
 *           derive scenery data before terrain is made (return a NEW def)
 * @property {(ctx: object) => void} [buildRoadDetails]  extra road decoration drawn before fences
 */
export {};
