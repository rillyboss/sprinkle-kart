/**
 * Character pack B — OWNER: character builder B.
 * Racers (see src/content/lineup.js for names + unlock rules), in menu order:
 *   luna, bleep, puff, prince-ribbit, marina, lulu
 *
 * One file per racer (src/characters/<id>.js, default-exporting { def, build }).
 */
import luna from './luna.js';
import bleep from './bleep.js';
import puff from './puff.js';
import princeRibbit from './prince-ribbit.js';
import marina from './marina.js';
import lulu from './lulu.js';

/** @type {import('./types.js').CharacterEntry[]} */
export default [luna, bleep, puff, princeRibbit, marina, lulu];
