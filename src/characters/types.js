/**
 * Shared JSDoc types for racer modules (no runtime code).
 *
 * @typedef {import('../progress/schema.js').UnlockRule} UnlockRule
 *
 * @typedef {Object} CharacterDef
 * @property {string} id           kebab-case, unique across ALL content (characters and tracks)
 * @property {string} name
 * @property {string} tagline
 * @property {string} personality
 * @property {{primary:number, secondary:number, accent:number, kart:number}} colors
 * @property {{speed:number, accel:number, handling:number, weight:number}} stats  whole numbers 1..5, total 11..14
 * @property {{pitch:number, style:'giggle'|'hoho'|'yay'|'boing'|'hum'}} voice
 * @property {boolean} locked      true iff `unlock` is not null
 * @property {UnlockRule|null} unlock  how to earn this racer (plain data, see src/content/lineup.js)
 * @property {'original'|'a'|'b'} pack
 * @property {'she'|'he'|'they'} [pronoun]  for friendly lines ("She can race with you now!"); default 'they'
 * @property {string} emoji
 * @property {{select:string, win:string, oops:string}} quotes
 * @property {string} [unlockHint]  optional override for the locked-tile hint (default: describeUnlock(unlock))
 * @property {{height?:number, lookHeight?:number}} [camera]  chase-camera nudge for tall hats/hair
 *
 * @typedef {Object} CharacterEntry  what a racer module default-exports
 * @property {CharacterDef} def
 * @property {(kit: import('./parts.js').Kit, rig: object, def: CharacterDef) => void} build
 */
export {};
