/**
 * Which modes the Online menu offers (NETWORKING.md §10.1, §11, §16.2).
 * One list, extended per milestone; the menu never shows a mode whose
 * milestone is not done.
 *
 * OWNER: WS6 (session, lobby & screens).
 */

/** Modes each milestone turns on (cumulative). */
export const ONLINE_MODES_BY_MILESTONE = Object.freeze({
  M1: Object.freeze(['free']),
  M2: Object.freeze(['free', 'grand-prix']),
  M3: Object.freeze(['free', 'grand-prix', 'team', 'battle']),
});

/** The milestone this build ships. */
export const ONLINE_MILESTONE = 'M1';

/** Modes the Online menu shows right now. */
export const ONLINE_MODES = ONLINE_MODES_BY_MILESTONE[ONLINE_MILESTONE];

/** Modes that stay local forever (§11): solo / ghost / date based. */
export const LOCAL_ONLY_MODES = Object.freeze(['time-trial', 'daily', 'tutorial']);

/** @param {string} mode */
export function isOnlineMode(mode, modes = ONLINE_MODES) {
  return typeof mode === 'string' && modes.includes(mode);
}
