// Cloudflare Realtime TURN credentials (NETWORKING.md §3, §4.2).
//
// The worker mints short-lived relay credentials with two secrets set by a grown-up (docs/INFRA_SETUP.md
// step 6): TURN_KEY_ID and TURN_KEY_API_TOKEN. Secrets are never in the repo. The API base is the
// TURN_API_BASE var (https://rtc.live.cloudflare.com in wrangler.toml; tests point it at a local mock).
// This module has no Cloudflare imports: `fetchImpl` is injected, so it runs in plain Node too.

/** Room sockets get 30-minute credentials (renewed between races with { t: 'ice' }). */
export const TURN_TTL_ROOM = 1800;
/** GET /ice (Check connection only) gets 15-minute credentials. */
export const TURN_TTL_ICE = 900;
/** A room's Durable Object reuses its credentials for at most 5 minutes (never across rooms). */
export const TURN_CACHE_MS = 5 * 60 * 1000;
/** Mints per UTC day, counted by the guard; after that /health.turn is false and rooms get STUN only. */
export const TURN_DAILY_MINTS = 500;
export const TURN_TIMEOUT_MS = 5000;
export const DEFAULT_TURN_API_BASE = 'https://rtc.live.cloudflare.com';

/** Public STUN that every answer includes (the same servers the game uses without the worker). */
export const STUN_URLS = Object.freeze(['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']);

export function stunServers() {
  return [{ urls: [...STUN_URLS] }];
}

/** Both secrets present (non-empty)? */
export function turnConfigured(env) {
  return !!(env && typeof env.TURN_KEY_ID === 'string' && env.TURN_KEY_ID.trim()
    && typeof env.TURN_KEY_API_TOKEN === 'string' && env.TURN_KEY_API_TOKEN.trim());
}

/** True for an ICE URL on port 53 (browsers block it), e.g. 'turn:turn.cloudflare.com:53?transport=udp'. */
export function isPort53(url) {
  return /^(stun|stuns|turn|turns):[^?]*:53(\?|$)/i.test(String(url));
}

/** Drop every :53 URL, and any server left with no URLs. Keeps username/credential. */
export function filterPort53(iceServers) {
  const out = [];
  for (const s of Array.isArray(iceServers) ? iceServers : []) {
    if (!s || typeof s !== 'object') continue;
    const list = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === 'string' && !isPort53(u));
    if (!list.length) continue;
    const server = { urls: list };
    if (typeof s.username === 'string') server.username = s.username;
    if (typeof s.credential === 'string') server.credential = s.credential;
    out.push(server);
  }
  return out;
}

/** Only the servers that carry credentials (the TURN part of Cloudflare's answer). */
export function turnOnly(iceServers) {
  return iceServers.filter((s) => s.username && s.credential);
}

/** STUN + the given TURN servers. */
export function withStun(turnServers = []) {
  return [...stunServers(), ...turnServers];
}

export function turnEndpoint(env) {
  const base = String(env?.TURN_API_BASE || DEFAULT_TURN_API_BASE).replace(/\/+$/, '');
  return `${base}/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`;
}

/**
 * Mint TURN credentials. Resolves with the filtered TURN servers (no STUN), or throws.
 * @param {object} env  TURN_KEY_ID, TURN_KEY_API_TOKEN, TURN_API_BASE
 * @param {{ ttl: number, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
export async function mintTurn(env, { ttl, fetchImpl = fetch, timeoutMs = TURN_TIMEOUT_MS }) {
  if (!turnConfigured(env)) throw new Error('turn not configured');
  if (!(Number.isInteger(ttl) && ttl > 0 && ttl <= TURN_TTL_ROOM)) throw new Error(`bad ttl ${ttl}`);
  const res = await fetchImpl(turnEndpoint(env), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl }),
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`turn api ${res.status}`);
  const body = await res.json();
  const servers = turnOnly(filterPort53(body?.iceServers));
  if (!servers.length) throw new Error('turn api returned no relay servers');
  return servers;
}
