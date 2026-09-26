// Small runtime helpers shared by the Worker entry and the Durable Object.
import { CLOSE_CODES } from './room.js';
import { GUARD_NAME } from './guard.js';
import { REGISTRY_NAME } from './registry.js';

/** Worker version reported by GET /health. Bump when the worker's behaviour changes. */
export const VERSION = '1.1.0';

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/**
 * Answer a WebSocket upgrade with `{ t: 'error', code }` and a close, so the browser can read the reason
 * (a refused upgrade would only show a generic failure).
 */
export function errorSocketResponse(code) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.send(JSON.stringify({ t: 'error', code }));
  server.close(CLOSE_CODES[code] ?? 1008, code);
  return new Response(null, { status: 101, webSocket: client });
}

/** Lowercase hex SHA-256 of a string (first `chars` hex digits). */
export async function sha256Hex(text, chars = 32) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, chars);
}

/** 16 random bytes as hex (a salt). */
export function randomHex(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The caller's IP as Cloudflare reports it. Only ever hashed with a salt; never stored or logged. */
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/** The global guard: the reserved SignalRoom instance named 'guard'. */
export function guardStub(env) {
  return env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(GUARD_NAME));
}

/** The open-games list: the reserved SignalRoom instance named 'lobby'. */
export function registryStub(env) {
  return env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(REGISTRY_NAME));
}
