/**
 * Everything main.js needs for online play, in ONE lazily loaded chunk (`import('./online/index.js')`),
 * fetched only once the family opens Online (NETWORKING.md §1 rule 1).
 *
 * OWNER: WS7 (online game integration).
 */
export { netStack } from './stack.js';
export * from './netRace.js';
export * from './onlineFlow.js';
export { netKartBuilder, createBoxView, createItemView } from './views.js';
export { ReplicaRace } from '../net/guest/replicaRace.js';
export { createTickPump } from '../net/tickPump.js';
export { jsonEncode } from '../net/session/wire.js';
export { housePis } from '../net/session/lobby.js';
export { RACING_PHASES } from '../net/session/hostSession.js';
export { unknownSetupIds } from '../net/version.js';
export { TEXT, signalingErrorText } from '../net/session/texts.js';
export { resolveSignalConfig } from '../net/signaling/index.js';
export { fetchOpenRooms, ROOMS_POLL_MS } from '../net/signaling/rooms.js';
export { createDebugOverlay, shouldShowNetDebug } from '../net/debugOverlay.js';
