/**
 * Invite links (NETWORKING.md §4.2, §10.1).
 *
 *   https://rillyboss.github.io/sprinkle-kart/#join=SPRINKLE-4821~<6 base64url chars>
 *
 * One base64url character per secret sweet (index 0..63). It is a `#` fragment,
 * never a query string, so browsers never send it to GitHub Pages, trackers,
 * relays or the Worker. main.js (WS7) reads `location.hash` once at start-up,
 * clears it with `history.replaceState` (the effect `startupInvite()` returns)
 * and hands the secret to the Online flow — or, with online play off, to the
 * "ask a grown-up" screen, which never bypasses the parent gate.
 *
 * OWNER: WS6 (session, lobby & screens).
 */
import { parseRoomCode, isRoomSecret, SWEETS_COUNT } from './roomCode.js';

export const INVITE_BASE_URL = 'https://rillyboss.github.io/sprinkle-kart/';
export const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Sweet indices → '<6 chars>' (throws on a malformed secret: a bug, not user input). */
export function encodeSweets(sweets) {
  if (!Array.isArray(sweets) || sweets.length !== SWEETS_COUNT) throw new RangeError('need 6 sweets');
  return sweets.map((i) => {
    if (!Number.isInteger(i) || i < 0 || i > 63) throw new RangeError(`bad sweet ${i}`);
    return B64URL[i];
  }).join('');
}

/** '<6 chars>' → indices, or null (strict alphabet, exact length). */
export function decodeSweets(text) {
  if (typeof text !== 'string' || text.length !== SWEETS_COUNT) return null;
  const out = [];
  for (const ch of text) {
    const i = B64URL.indexOf(ch);
    if (i < 0) return null;
    out.push(i);
  }
  return out;
}

/**
 * @param {{ label: string, sweets: number[] }} secret
 * @param {string} [baseUrl] the page URL (its own hash is dropped)
 */
export function makeInviteLink(secret, baseUrl = INVITE_BASE_URL) {
  if (!isRoomSecret(secret)) throw new RangeError('not a room secret');
  const base = String(baseUrl || INVITE_BASE_URL).split('#')[0];
  return `${base}#join=${secret.label}~${encodeSweets(secret.sweets)}`;
}

/**
 * Parse an invite fragment ('#join=…'), a bare 'join=…', or a whole invite URL.
 * Forgiving of case and spaces in the label, strict on the sweets alphabet.
 * @returns {{ label: string, sweets: number[] } | null}
 */
export function parseInviteFragment(hash) {
  if (typeof hash !== 'string' || hash.length > 300) return null;
  let s = hash.trim();
  const at = s.indexOf('#');
  if (at >= 0) s = s.slice(at + 1);
  const m = /^\s*join\s*=\s*(.+)$/i.exec(s);
  if (!m) return null;
  let body = m[1];
  try { body = decodeURIComponent(body); } catch { return null; }
  const parts = body.split('~');
  if (parts.length !== 2) return null;
  const label = parseRoomCode(parts[0]);
  const sweets = decodeSweets(parts[1].replace(/\s+/g, ''));
  if (!label || !sweets) return null;
  return { label, sweets };
}

/**
 * Start-up handling of `location.hash` (pure; main.js runs the effects).
 * The fragment is read once and ALWAYS cleared when it holds a join link
 * (valid or not), so a reload or a screenshot of the address bar does not keep it.
 * @param {{ hash?: string, pathname?: string, search?: string, onlineEnabled?: boolean }} o
 * @returns {{ secret: object|null, screen: 'online-hub'|'invite-gate'|null, params: object, effects: object[] }}
 */
export function startupInvite({ hash = '', pathname = '/', search = '', onlineEnabled = false } = {}) {
  const hasJoin = /^#?\s*join\s*=/i.test(String(hash ?? '').trim());
  if (!hasJoin) return { secret: null, screen: null, params: {}, effects: [] };
  const secret = parseInviteFragment(hash);
  const effects = [{ type: 'replaceState', url: `${pathname || '/'}${search || ''}` }];
  if (!secret) return { secret: null, screen: null, params: {}, effects };
  return {
    secret,
    screen: onlineEnabled ? 'online-hub' : 'invite-gate',
    params: onlineEnabled ? { invite: secret } : { returnTo: 'title' },
    effects,
  };
}

/**
 * QR code for an invite link as an SVG string (dark modules = one path; 4-module quiet zone).
 * The encoder (`uqr`, pinned, zero dependencies) is loaded lazily, so it only
 * ships in its own chunk and is fetched when a host opens the lobby.
 * @param {string} text
 * @param {{ importer?: () => Promise<{ encode: Function }>, dark?: string, light?: string }} [o]
 */
export async function inviteQrSvg(text, { importer = () => import('uqr'), dark = '#6b3a7a', light = '#ffffff' } = {}) {
  const { encode } = await importer();
  const qr = encode(String(text), { ecc: 'M', border: 0 });
  return qrMatrixToSvg(qr.data, { dark, light });
}

/** boolean[][] (true = dark) → SVG markup. Pure. */
export function qrMatrixToSvg(matrix, { dark = '#6b3a7a', light = '#ffffff', quiet = 4 } = {}) {
  const n = matrix.length;
  const size = n + quiet * 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (matrix[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Invite QR code">`
    + `<rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

/**
 * The invite remembered in memory for this page load (never stored): after a
 * grown-up turns online on, the Online hub offers "Join" once.
 */
export function createInviteMemory() {
  let pending = null;
  return {
    remember(secret) { pending = isRoomSecret(secret) ? { label: secret.label, sweets: [...secret.sweets] } : null; },
    /** Take it (one offer only). */
    take() { const s = pending; pending = null; return s; },
    peek() { return pending; },
  };
}
