/**
 * WS7 stand-in for WS2's src/net/roomKey.js `deriveRoomIds` (NETWORKING.md §4.2 "Room key"), which has
 * not landed yet. It implements the binding algorithm exactly, so rooms made with it stay compatible
 * when WS2's module replaces it (delete this file and point src/online/stack.js at WS2's):
 *
 *   K          = PBKDF2-SHA256(password = label + '|' + sweets.join('.'), salt = 'sprinkle-kart-room-v1',
 *                              iterations = ROOM_KDF_ITERATIONS (150 000), 32 bytes)
 *   topic      = 'sk-' + hex(HMAC-SHA256(K, 'topic'))[0..20]      public signaling (Trystero room id)
 *   password   = base64url(HMAC-SHA256(K, 'pw'))                   public signaling (Trystero password)
 *   workerRoom = 'r' + hex(HMAC-SHA256(K, 'room'))[0..24]          Worker path GET /room/:code
 *
 * The label alone never yields the ids (the sweets are the secret), and the key never leaves the page.
 */

export const ROOM_KDF_SALT = 'sprinkle-kart-room-v1';
export const ROOM_KDF_ITERATIONS = 150_000;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The KDF password for a secret (pure; exported for tests). */
export function roomKeyPassword({ label, sweets }) {
  return `${String(label)}|${sweets.map((n) => n | 0).join('.')}`;
}

/**
 * @param {{ label: string, sweets: number[] }} secret
 * @param {{ subtle?: SubtleCrypto, iterations?: number }} [o] iterations is a test knob only
 * @returns {Promise<{ topic: string, password: string, workerRoom: string }>}
 */
export async function deriveRoomIds(secret, { subtle = globalThis.crypto?.subtle, iterations = ROOM_KDF_ITERATIONS } = {}) {
  if (!secret || typeof secret.label !== 'string' || !Array.isArray(secret.sweets)) throw new TypeError('deriveRoomIds: a RoomSecret is needed');
  if (!subtle) throw new Error('deriveRoomIds: crypto.subtle is not available (a secure context is needed)');
  const base = await subtle.importKey('raw', enc.encode(roomKeyPassword(secret)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(ROOM_KDF_SALT), iterations }, base, 256);
  const key = await subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = (text) => subtle.sign('HMAC', key, enc.encode(text));
  const [topic, pw, room] = await Promise.all([mac('topic'), mac('pw'), mac('room')]);
  return {
    topic: `sk-${hex(topic).slice(0, 20)}`,
    password: b64url(pw),
    workerRoom: `r${hex(room).slice(0, 24)}`,
  };
}
