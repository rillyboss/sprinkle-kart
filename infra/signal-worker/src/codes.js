// Kid-friendly room codes (NETWORKING.md §4.2 "Room codes"): 4 big letters like "CAKE".
//
// The game turns a code into the Worker room id with the SAME formula (src/net/session/roomCode.js
// `workerRoomFor`; the main test suite checks both agree), so the Worker can check that a host's
// `?code=` really belongs to the room it opened before it lists the room under "Games you can join".
// Pure except for `roomIdForCode` (crypto.subtle SHA-256, which the Workers runtime and Node both have).

/** The code alphabet: capital letters without the look-alikes I and O (and Q, which kids read as O). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export const CODE_LENGTH = 4;
export const LIST_CODE_RE = /^[ABCDEFGHJKLMNPRSTUVWXYZ]{4}$/;
/** Salt of the room id formula. Changing it moves every room: never change it without a protocol bump. */
export const ROOM_ID_SALT = 'sprinkle-kart-room-v2|';

/** Lowercase hex SHA-256 of a string. */
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 'CAKE' → the Worker room id 'r' + 24 hex (what GET /room/:code carries). */
export async function roomIdForCode(code) {
  return `r${(await sha256Hex(ROOM_ID_SALT + code)).slice(0, 24)}`;
}
