/**
 * SignalingTransport contract (NETWORKING.md §4.2) + the one error type every matchmaker uses.
 *
 * A SignalingTransport finds the other machines of a room and hands out one connected-or-
 * connecting `RTCPeerConnection` per remote peer. It never sends game data: the WebRtcTransport
 * (src/net/transport/webrtc.js) adds the two negotiated data channels on top.
 *
 * @typedef {object} RoomIds         // deriveRoomIds(secret) in src/net/roomKey.js (WS2)
 * @property {string} topic          public path: Trystero room id 'sk-' + 20 hex
 * @property {string} password       public path: Trystero password (base64url, 32 B)
 * @property {string} workerRoom     Worker path: the `:code` of GET /room/:code ('r' + 24 hex)
 *
 * @typedef {'host'|'guest'} Role
 *
 * @typedef {object} JoinOptions
 * @property {RoomIds} ids
 * @property {Role} role
 * @property {string} selfId            our app-level peer id (16 hex), the same on every matchmaker
 * @property {RTCIceServer[]} iceServers
 * @property {boolean} relayOnly        PARAMETER (the session reads settings; signaling never does)
 *
 * @typedef {object} SignalingTransport
 * @property {'public'|'worker'} kind
 * @property {(o: JoinOptions) => Promise<{ iceServers: RTCIceServer[] }>} join
 *           rejects with SignalingError
 * @property {(fn: (p: { peerId: string, pc: RTCPeerConnection }) => void) => () => void} onPeerConnection
 * @property {(fn: (peerId: string) => void) => () => void} onPeerLeave
 * @property {(peerId: string) => void} drop          host only: close this peer's signaling + pc
 * @property {(locked: boolean) => void} setLocked    host only: refuse / accept new guests
 * @property {() => Promise<RTCIceServer[]>} refreshIce  worker: fresh TURN creds; public: STUN
 * @property {() => Promise<void>} leave
 * @property {(peerId: string) => Promise<boolean>} [restartIce]  guest-side ICE restart hook
 *           (the WebRtcTransport calls it when a pc fails or for TURN renewal)
 * @property {() => string} [detail]  e.g. 'public-torrent' | 'public-nostr' | 'worker' (debug overlay)
 */

/** Every code a matchmaker may reject `join()` with (binding, §4.2). */
export const SIGNALING_ERROR_CODES = Object.freeze([
  'unreachable',
  'no-host',
  'host-exists',
  'full',
  'locked',
  'rate',
  'bad-origin',
  'timeout',
]);

export class SignalingError extends Error {
  /**
   * @param {string} code one of SIGNALING_ERROR_CODES (anything else becomes 'unreachable')
   * @param {{ detail?: string, kind?: string, cause?: unknown }} [info]
   */
  constructor(code, info = {}) {
    const safe = SIGNALING_ERROR_CODES.includes(code) ? code : 'unreachable';
    super(`signaling: ${safe}${info.detail ? ` (${info.detail})` : ''}`);
    this.name = 'SignalingError';
    /** @type {string} */
    this.code = safe;
    /** Raw code/reason from the matchmaker (e.g. the Worker's 'proto'), for logs only. */
    this.detail = info.detail ?? (safe === code ? undefined : String(code));
    this.kind = info.kind;
    if (info.cause !== undefined) this.cause = info.cause;
  }
}

/**
 * Worker `{ t: 'error', code }` → SignalingError code. The Worker's 'proto' (old/new build
 * talking to the other) has no code of its own in §4.2: it surfaces as 'unreachable' with
 * `detail: 'proto'`, so the screen can add "ask everyone to refresh 🔄".
 * @param {unknown} code
 */
export function workerErrorToSignalingError(code) {
  const raw = typeof code === 'string' ? code : 'unknown';
  if (SIGNALING_ERROR_CODES.includes(raw)) return new SignalingError(raw, { kind: 'worker' });
  return new SignalingError('unreachable', { kind: 'worker', detail: raw });
}

/** @param {unknown} e */
export function isSignalingError(e) {
  return e instanceof SignalingError || (!!e && typeof e === 'object' && /** @type {any} */ (e).name === 'SignalingError');
}

/**
 * Tiny listener set used by every transport (never throws out of a listener).
 * @template {any[]} A
 */
export function createListeners() {
  /** @type {Set<(...args: A) => void>} */
  const set = new Set();
  return {
    /** @param {(...args: A) => void} fn */
    add(fn) {
      set.add(fn);
      return () => set.delete(fn);
    },
    /** @param {A} args */
    emit(...args) {
      for (const fn of [...set]) {
        try {
          fn(...args);
        } catch (err) {
          // A broken listener must not break signaling for everyone else.
          console.error('sprinkle-kart net listener error', err);
        }
      }
    },
    get size() {
      return set.size;
    },
    clear() {
      set.clear();
    },
  };
}

const HEX16 = /^[0-9a-f]{16}$/;
/** App-level peer ids are 16 lowercase hex chars (random per session). */
export function isPeerId(id) {
  return typeof id === 'string' && HEX16.test(id);
}

/** @param {() => number} [rand] */
export function makePeerId(rand) {
  const bytes = new Uint8Array(8);
  if (!rand && globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 8; i++) bytes[i] = Math.floor((rand ?? Math.random)() * 256) & 255;
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
