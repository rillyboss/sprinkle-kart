// Sprinkle Kart signal worker: entry point (NETWORKING.md §3, §4.2; setup in docs/INFRA_SETUP.md).
//
//   GET /health       → { ok, turn, version }   (CORS for allowed origins)
//   GET /ice          → { iceServers, turn }    (Check connection only: 5/min per IP, TURN ttl 900 s; CORS)
//   GET /room/:code   → WebSocket signaling in the room's Durable Object (Origin checked here, no CORS)
//
// The game uses this worker only when it was built with VITE_SIGNAL_URL; otherwise it uses public signaling.
import { SignalRoom } from './SignalRoom.js';
import { corsHeaders, isOriginAllowed } from './origin.js';
import { parseRoomRequest } from './room.js';
import {
  mintTurn, turnConfigured, stunServers, withStun, TURN_TTL_ICE,
} from './turn.js';
import {
  json, errorSocketResponse, clientIp, guardStub, VERSION,
} from './http.js';

export { SignalRoom };

async function health(env, cors) {
  let turn = false;
  if (turnConfigured(env)) {
    try {
      turn = (await guardStub(env).guard('status')).allow === true;
    } catch {
      turn = false;
    }
  }
  return json({ ok: true, turn, version: VERSION }, 200, cors);
}

async function ice(request, env, cors) {
  const origin = request.headers.get('Origin');
  if (!isOriginAllowed(origin, env.ALLOWED_ORIGINS)) return json({ ok: false, error: 'bad-origin' }, 403);
  const guard = guardStub(env);
  const hit = await guard.guard('ice', clientIp(request));
  if (!hit.allow) {
    const retry = String(Math.max(1, Math.ceil((hit.retryAfterMs ?? 60_000) / 1000)));
    return json({ ok: false, error: 'rate' }, 429, { ...cors, 'Retry-After': retry });
  }
  let iceServers = stunServers();
  let turn = false;
  if (turnConfigured(env) && (await guard.guard('mint')).allow) {
    try {
      // Fresh credentials for every caller: /ice never caches across callers.
      iceServers = withStun(await mintTurn(env, { ttl: TURN_TTL_ICE }));
      turn = true;
    } catch {
      // TURN API trouble: answer with STUN only (the Check connection screen shows "relay not available").
    }
  }
  return json({ iceServers, turn }, 200, cors);
}

async function room(request, env, url) {
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('Upgrade to a WebSocket', { status: 426 });
  }
  // Browsers don't apply CORS to WebSocket upgrades, so the worker checks Origin itself.
  if (!isOriginAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) return errorSocketResponse('bad-origin');
  const p = parseRoomRequest(url);
  if (!p.ok) return errorSocketResponse('proto');
  // A forged Origin gets this far, so the real limits are here (global) and in the room (per room).
  const hit = await guardStub(env).guard('join', clientIp(request));
  if (!hit.allow) return errorSocketResponse('rate');
  return env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(p.code)).fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === '/health' || pathname === '/ice') {
      const cors = corsHeaders(request.headers.get('Origin'), env.ALLOWED_ORIGINS);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405, cors);
      return pathname === '/health' ? health(env, cors) : ice(request, env, cors);
    }
    if (pathname.startsWith('/room/')) {
      if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405);
      return room(request, env, url);
    }
    return json({ ok: false, error: 'not-found' }, 404);
  },
};
