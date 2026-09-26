/**
 * Session message plumbing shared by hostSession / guestSession.
 *
 * The session reducers speak LOGICAL ctrl messages `{ type: 'HELLO'|'WELCOME'|…, …fields }`
 * (NETWORKING.md §6.2). Turning them into bytes is WS2's codec (`encodeCtrl` /
 * `decodeCtrl` + `validate`); until that is wired in, `jsonEncode` / `jsonDecode`
 * below are a stand-in (type name + JSON) so the session runs end to end in tests.
 * The online flow (WS7) passes the real codec as `encode` / `decode`.
 *
 * Also: the build identity this machine announces in HELLO / WELCOME and the
 * default version check (`compatible`: ok iff proto AND content are equal, §7.2).
 *
 * OWNER: WS6 (session, lobby & screens).
 */

/** The session-level ctrl messages (§6.2). */
export const SESSION_MESSAGES = Object.freeze(['HELLO', 'WELCOME', 'REJECT', 'BYE', 'LOBBY', 'INTENT', 'EMOTE', 'KICK', 'PHASE', 'CHOICE', 'KEEP']);
/**
 * Session heartbeat (§7.4): while a room is open each side sends a tiny KEEP on ctrl whenever it has sent
 * nothing else to that peer for this long, so a quiet lobby, a slow approval or a host lingering on the track
 * screen never looks like a house that went to sleep.
 */
export const KEEPALIVE_MS = 1000;
export const REJECT_REASONS = Object.freeze(['version', 'full', 'declined', 'locked', 'in-race-full', 'removed', 'host-leaving']);
export const INTENT_KINDS = Object.freeze(['seat-join', 'seat-leave', 'pick', 'ready', 'unready']);
/** BYE reasons (u8 on the wire). */
export const BYE = Object.freeze({ leaving: 0, hostEnding: 1, removed: 2 });
export const EMOTE_COUNT = 8;
export const EMOTE_INTERVAL_MS = 1500;
export const PROTOCOL = 1;
export const TICK_HZ = 60;

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

/** Stand-in encoder: UTF-8 JSON of the logical message. */
export function jsonEncode(msg) {
  return enc.encode(JSON.stringify(msg));
}

/** Stand-in decoder: bytes → a logical session message or null (never throws). */
export function jsonDecode(bytes) {
  try {
    const obj = JSON.parse(dec.decode(bytes));
    return obj && typeof obj === 'object' && SESSION_MESSAGES.includes(obj.type) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * This build's identity (§7.2). WS2's version.js provides the real
 * `PROTOCOL_VERSION` / `BUILD_ID` / `contentHash()`; callers pass them in.
 */
export function buildIdentity({ proto = PROTOCOL, build = 'dev', content = 0 } = {}) {
  return { proto: Number(proto) | 0, build: String(build).slice(0, 40), content: Number(content) >>> 0 };
}

/** Default version check: ok iff proto and content are equal (a different build is fine). */
export function compatible(mine, theirs) {
  if (!theirs || typeof theirs !== 'object') return { ok: false, reason: 'version' };
  const ok = Number(mine?.proto) === Number(theirs.proto) && (Number(mine?.content) >>> 0) === (Number(theirs.content) >>> 0);
  return ok ? { ok: true, reason: null } : { ok: false, reason: 'version' };
}

/** 32 lowercase hex chars (a 128-bit reconnect token) from crypto. */
export function randomToken() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const isToken = (t) => typeof t === 'string' && /^[0-9a-f]{32}$/.test(t);
