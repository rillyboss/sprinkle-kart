/**
 * The online "stack": the one place where the running game picks its wire codec, sim hooks, clock sync
 * and room-key derivation for the WS5 netcode (createHostDriver / ReplicaRace / createGuestDriver take
 * them as injected options).
 *
 * WS1 PR (a) (captureSimState / predictTick / fixed tick) and WS2 (codec / messages / clock / roomKey)
 * are not on main yet, so these point at the WS7 copies in ./standins/ — byte-identical to the WS5 test
 * stand-ins the netcode's convergence matrix was proven with. When WS1 / WS2 merge, change the imports
 * below (and delete ./standins/); nothing else in the game needs to change.
 *
 * OWNER: WS7 (online game integration).
 */
import * as wire from './standins/wire.js';
import { captureSimState, predictTick, makeCountdown, raceTick } from './standins/sim.js';
import { createClockSync } from './standins/clockSync.js';
import { deriveRoomIds } from './standins/roomKey.js';

/** Countdown of every online race (the Race's 3-2-1). */
export const COUNTDOWN_SECONDS = 3;

/**
 * @typedef {object} NetStack
 * @property {object} wire                 encode* / decode / quantizeInput / MSG / createFragmenter …
 * @property {(race, tick) => object} capture
 * @property {Function} predictTick
 * @property {(seconds?: number) => { goTick: number, after: (r: number) => number }} makeCountdown
 * @property {(race, inputs) => void} tickRace
 * @property {(o?: object) => object} createClockSync
 * @property {(secret) => Promise<{ topic: string, password: string, workerRoom: string }>} deriveRoomIds
 */

/** @type {NetStack} */
export const netStack = Object.freeze({
  wire: wire.wire,
  capture: captureSimState,
  predictTick,
  makeCountdown,
  tickRace: raceTick,
  createClockSync,
  deriveRoomIds,
});
