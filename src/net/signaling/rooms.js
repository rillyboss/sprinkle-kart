/**
 * "Games you can join" (NETWORKING.md §4.2, §10.1): reads our Worker's open-games list, GET /rooms.
 *
 * `fetchOpenRooms({ signalUrl })` → `{ supported, rooms }`:
 *   - supported: false  → no Worker in this build (public signaling only), or the family's Worker is older
 *                         and has no /rooms yet (they run `npm run worker:deploy` once to get it), or it
 *                         could not be reached. The Join screen then simply hides the list: codes and invite
 *                         links still work.
 *   - rooms             → [{ code: 'CAKE', who: 'luna'|null, players: 1..8, ageS }], checked here: a code
 *                         must be 4 letters of the code alphabet, `who` a racer id pattern (the screen shows
 *                         the racer's name only when this game knows that racer), never free text.
 *
 * OWNER: online session & screens.
 */
import { isRoomCode } from '../session/roomCode.js';

/** How often the Join screen asks again while it is open (the Worker allows 30 asks a minute). */
export const ROOMS_POLL_MS = 4000;
export const ROOMS_TIMEOUT_MS = 5000;
const WHO_RE = /^[a-z0-9-]{1,24}$/;

/** Clean one list entry (null = drop it). */
export function cleanRoom(r) {
  if (!r || typeof r !== 'object' || !isRoomCode(r.code)) return null;
  const n = Number(r.players);
  const age = Number(r.ageS);
  return {
    code: r.code,
    who: typeof r.who === 'string' && WHO_RE.test(r.who) ? r.who : null,
    players: Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1,
    ageS: Number.isFinite(age) && age >= 0 ? Math.round(age) : 0,
  };
}

/** `https://x.workers.dev` (or ws/wss) → `https://x.workers.dev/rooms`; null for anything else. */
export function roomsUrl(signalUrl) {
  if (typeof signalUrl !== 'string' || !signalUrl) return null;
  try {
    const u = new URL(signalUrl);
    if (u.protocol === 'wss:') u.protocol = 'https:';
    else if (u.protocol === 'ws:') u.protocol = 'http:';
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.pathname = `${u.pathname.replace(/\/+$/, '')}/rooms`;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * @param {{ signalUrl?: string|null, fetchImpl?: typeof fetch, timeoutMs?: number, timers?: object }} o
 * @returns {Promise<{ supported: boolean, rooms: Array<{ code: string, who: string|null, players: number, ageS: number }> }>}
 */
export async function fetchOpenRooms({ signalUrl = null, fetchImpl = globalThis.fetch, timeoutMs = ROOMS_TIMEOUT_MS, timers = globalThis } = {}) {
  const url = roomsUrl(signalUrl);
  const none = { supported: false, rooms: [] };
  if (!url || typeof fetchImpl !== 'function') return none;
  let timer = null;
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctl) timer = timers.setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetchImpl(url, { method: 'GET', cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) });
    if (!res || !res.ok) {
      // 429 = asked too often: the list exists, just show the last one we had
      if (res?.status === 429) return { supported: true, rooms: null };
      return none; // an older worker answers 404 here
    }
    const body = await res.json();
    if (!body || !Array.isArray(body.rooms)) return none;
    return { supported: true, rooms: body.rooms.map(cleanRoom).filter(Boolean).slice(0, 12) };
  } catch {
    return none; // offline, CORS on an old worker, a timeout …
  } finally {
    if (timer !== null) timers.clearTimeout(timer);
  }
}
