/**
 * HTTP side of our Worker (NETWORKING.md §3, §4.2): `GET /health` → `{ ok, turn, version }` and
 * `GET /ice` → ICE servers incl. short-lived Cloudflare TURN creds. `/ice` exists ONLY for the
 * Check connection screen (rate-limited 5/min per IP, ttl 900 s); rooms get their TURN creds
 * inside the WebSocket `joined` message instead.
 */
import { publicIceServers } from './relays.js';

export const HEALTH_TIMEOUT_MS = 4000;
export const ICE_FETCH_TIMEOUT_MS = 5000;

/** `https://x.dev/` + 'ice' → `https://x.dev/ice` (keeps a base path). */
export function endpointUrl(signalUrl, path) {
  const u = new URL(String(signalUrl));
  if (u.protocol === 'wss:') u.protocol = 'https:';
  else if (u.protocol === 'ws:') u.protocol = 'http:';
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/${path}`;
  u.search = '';
  u.hash = '';
  return u.toString();
}

const ICE_URL = /^(stun|stuns|turn|turns):[^\s]+$/i;
/** Browsers refuse port 53 for TURN (Cloudflare docs): filter such URLs out. */
const PORT_53 = /:53(\?|$)/;

/**
 * Keep only well-formed ICE servers: string/array `urls` with stun/turn schemes, no :53,
 * string credentials. Anything else is dropped.
 * @param {unknown} list
 * @returns {RTCIceServer[]}
 */
export function sanitizeIceServers(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(0, 16)) {
    if (!s || typeof s !== 'object') continue;
    const raw = Array.isArray(s.urls) ? s.urls : [s.urls];
    const urls = raw.filter((u) => typeof u === 'string' && ICE_URL.test(u) && !PORT_53.test(u)).slice(0, 8);
    if (!urls.length) continue;
    const server = { urls: urls.length === 1 && !Array.isArray(s.urls) ? urls[0] : urls };
    if (typeof s.username === 'string') server.username = s.username;
    if (typeof s.credential === 'string') server.credential = s.credential;
    out.push(server);
  }
  return out;
}

/** true when at least one server is a TURN server with credentials. */
export function hasTurn(list) {
  return (list || []).some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => /^turns?:/i.test(u)) && typeof s.username === 'string' && typeof s.credential === 'string';
  });
}

async function getJson(url, { fetchImpl, timeoutMs }) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl?.abort();
      reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([fetchImpl(url, { method: 'GET', signal: ctrl?.signal, headers: { accept: 'application/json' } }), timeout]);
    const body = await Promise.race([res.json().catch(() => null), timeout]);
    return { status: res.status, ok: !!res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET /health`. Never throws.
 * @returns {Promise<{ ok: boolean, turn: boolean, version: string|null, ms: number|null, reason?: string }>}
 */
export async function fetchHealth({ signalUrl, fetchImpl = globalThis.fetch, timeoutMs = HEALTH_TIMEOUT_MS, now = () => Date.now() } = /** @type {any} */ ({})) {
  if (!signalUrl || typeof fetchImpl !== 'function') return { ok: false, turn: false, version: null, ms: null, reason: 'no-worker' };
  const t0 = now();
  try {
    const r = await getJson(endpointUrl(signalUrl, 'health'), { fetchImpl, timeoutMs });
    const ms = Math.max(0, now() - t0);
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    if (!r.ok || b.ok !== true) return { ok: false, turn: false, version: null, ms, reason: `http-${r.status}` };
    return { ok: true, turn: b.turn === true, version: typeof b.version === 'string' ? b.version.slice(0, 40) : null, ms };
  } catch (e) {
    return { ok: false, turn: false, version: null, ms: null, reason: e?.code === 'timeout' ? 'timeout' : 'unreachable' };
  }
}

/**
 * `GET /ice` (Check connection only). Never throws: without a Worker, or when it is down or
 * rate-limited, the answer is public STUN with `turn: false` and a `reason`.
 * @param {{ signalUrl?: string|null, fetchImpl?: typeof fetch, timeoutMs?: number }} o
 * @returns {Promise<{ iceServers: RTCIceServer[], turn: boolean, reason?: string }>}
 */
export async function fetchIceServers({ signalUrl, fetchImpl = globalThis.fetch, timeoutMs = ICE_FETCH_TIMEOUT_MS } = {}) {
  if (!signalUrl || typeof fetchImpl !== 'function') return { iceServers: publicIceServers(), turn: false, reason: 'no-worker' };
  try {
    const r = await getJson(endpointUrl(signalUrl, 'ice'), { fetchImpl, timeoutMs });
    if (r.status === 429) return { iceServers: publicIceServers(), turn: false, reason: 'rate' };
    if (!r.ok || !r.body) return { iceServers: publicIceServers(), turn: false, reason: `http-${r.status}` };
    const iceServers = sanitizeIceServers(r.body.iceServers);
    if (!iceServers.length) return { iceServers: publicIceServers(), turn: false, reason: 'empty' };
    return { iceServers, turn: hasTurn(iceServers) };
  } catch (e) {
    return { iceServers: publicIceServers(), turn: false, reason: e?.code === 'timeout' ? 'timeout' : 'unreachable' };
  }
}
