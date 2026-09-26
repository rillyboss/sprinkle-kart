/**
 * Invite links (NETWORKING.md §10.1).
 *
 *   https://rillyboss.github.io/sprinkle-kart/?join=CAKE
 *
 * Opening one starts the game and hops straight into that room's lobby (no presses). main.js reads the
 * address once at start-up and removes `join` from it with `history.replaceState` (the effect
 * `startupInvite()` returns), so a reload does not knock again. With online play turned off on that machine
 * (Settings → Grown-ups) the "online play is off" screen shows instead.
 *
 * OWNER: online session & screens.
 */
import { parseRoomCode, isRoomCode } from './roomCode.js';

export const INVITE_BASE_URL = 'https://rillyboss.github.io/sprinkle-kart/';

/**
 * @param {string} code  a room code like 'CAKE'
 * @param {string} [baseUrl] the page URL (its own query and hash are dropped)
 */
export function makeInviteLink(code, baseUrl = INVITE_BASE_URL) {
  if (!isRoomCode(code)) throw new RangeError('not a room code');
  const base = String(baseUrl || INVITE_BASE_URL).split('#')[0].split('?')[0];
  return `${base}?join=${code}`;
}

/**
 * The room code in an invite: a whole link, '?join=CAKE', '#join=CAKE' or a bare 'join=CAKE'.
 * Forgiving of case and spaces. @returns {string|null}
 */
export function parseInviteCode(text) {
  if (typeof text !== 'string' || text.length > 400) return null;
  const m = /(?:^|[?#&\s])join\s*=\s*([^&#\s]{1,24})/i.exec(text.trim());
  if (!m) return null;
  let body = m[1];
  try { body = decodeURIComponent(body); } catch { return null; }
  return parseRoomCode(body);
}

/** `search` without its join parameter ('' when nothing is left). */
function searchWithoutJoin(search) {
  try {
    const q = new URLSearchParams(search || '');
    q.delete('join');
    const s = q.toString();
    return s ? `?${s}` : '';
  } catch {
    return '';
  }
}

/**
 * Start-up handling of an invite (pure; main.js runs the effects). The `join` parameter is read once and
 * always removed from the address bar when present (valid or not).
 * @param {{ search?: string, hash?: string, pathname?: string, onlineOn?: boolean }} o
 * @returns {{ code: string|null, join: boolean, screen: 'invite-gate'|null, params: object, effects: object[] }}
 */
export function startupInvite({ search = '', hash = '', pathname = '/', onlineOn = true } = {}) {
  const none = { code: null, join: false, screen: null, params: {}, effects: [] };
  const inSearch = /[?&]join=/i.test(String(search ?? ''));
  const inHash = /^#?\s*join\s*=/i.test(String(hash ?? '').trim());
  if (!inSearch && !inHash) return none;
  const code = (inSearch ? parseInviteCode(search) : null) ?? (inHash ? parseInviteCode(hash) : null);
  const effects = [{ type: 'replaceState', url: `${pathname || '/'}${searchWithoutJoin(search)}` }];
  if (!code) return { ...none, effects };
  if (!onlineOn) return { code, join: false, screen: 'invite-gate', params: { returnTo: 'title', code }, effects };
  return { code, join: true, screen: null, params: {}, effects };
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
 * The invite remembered in memory for this page load (never stored): after a grown-up turns online play
 * back on, the Online hub offers "Join CAKE" once.
 */
export function createInviteMemory() {
  let pending = null;
  return {
    remember(code) { pending = isRoomCode(code) ? code : null; },
    /** Take it (one offer only). */
    take() { const s = pending; pending = null; return s; },
    peek() { return pending; },
  };
}
