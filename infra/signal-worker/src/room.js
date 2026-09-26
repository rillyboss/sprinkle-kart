// Pure room logic for the signal worker's SignalRoom Durable Object (NETWORKING.md §4.2).
//
// roomReduce(state, event) → { state, sends, close, ... } never touches the network, storage, clocks or
// crypto: the Durable Object (src/SignalRoom.js) feeds it events and carries out what it returns. That makes
// every rule here testable in plain Node (the game's root vitest suite imports this file on Node 20).
//
// A room holds at most 1 host + 7 guest sockets. The host creates it; guests need a host; the host may drop a
// guest (its salted IP hash stays blocked until the host unlocks) and lock the room. Guests only ever learn
// about the host. Raw IP addresses never reach this file: the Durable Object passes a salted hash.
//
// Open-games list (§4.2 "Games you can join"): a host may open its socket with `&code=CAKE&who=<racer id>
// &players=<n>&list=1|0`; the Durable Object checks that the code really hashes to this room before it passes
// `listing` in here. While the host is connected, wants the room listed and the room is not locked, results
// carry `registry: { op: 'put', room, entry }`, otherwise `{ op: 'remove', room }`, for the reserved 'lobby'
// instance (registry.js). The host updates the entry with `{ t: 'list', on, who?, players? }` (also its
// periodic refresh). Old games never send any of this, and old workers ignore the extra query parameters.
import { LIST_CODE_RE } from './codes.js';
import { WHO_RE, MAX_PLAYERS } from './registry.js';

export const PROTO = 1;
export const ROOM_CODE_RE = /^r[0-9a-f]{24}$/;
export const PEER_RE = /^[0-9a-f]{16}$/;

export const MAX_GUESTS = 7;
export const MAX_SOCKETS = 1 + MAX_GUESTS;
export const MAX_MSG_BYTES = 16 * 1024;
export const MSGS_PER_SEC = 50;
export const GUEST_JOINS_PER_MIN = 12;
export const JOIN_WINDOW_MS = 60_000;
export const ICE_REFRESH_MS = 30_000;
export const ROOM_GC_MS = 2 * 60 * 60 * 1000;
export const MAX_BLOCKED = 64;

/** Every `{ t: 'error', code }` the worker can send (the socket is closed right after). */
export const ERROR_CODES = Object.freeze(['full', 'no-host', 'host-exists', 'locked', 'rate', 'bad-origin', 'proto']);

/** WebSocket close codes (4000–4999 is the application range). The close reason repeats the code. */
export const CLOSE_CODES = Object.freeze({
  full: 4001,
  'no-host': 4002,
  'host-exists': 4003,
  locked: 4004,
  rate: 4005,
  'bad-origin': 4006,
  proto: 4007,
  removed: 4010, // the host dropped this guest (no error message is sent first)
  replaced: 4011, // the same peer id connected again; the older socket is closed
});

const utf8 = new TextEncoder();

/** UTF-8 size of a WebSocket message (string or binary). */
export function messageBytes(raw) {
  if (typeof raw === 'string') return utf8.encode(raw).length;
  if (raw && typeof raw.byteLength === 'number') return raw.byteLength;
  return 0;
}

/**
 * Parse `GET /room/:code?role=host|guest&peer=<16 hex>&proto=1`.
 * @param {URL} url
 * @returns {{ ok: true, code: string, role: 'host'|'guest', peer: string } | { ok: false, error: 'proto' | 'not-found' }}
 */
export function parseRoomRequest(url) {
  const m = /^\/room\/([^/]*)$/.exec(url.pathname);
  if (!m) return { ok: false, error: 'not-found' };
  const code = m[1];
  const role = url.searchParams.get('role');
  const peer = url.searchParams.get('peer');
  const proto = url.searchParams.get('proto');
  if (!ROOM_CODE_RE.test(code)) return { ok: false, error: 'proto' };
  if (role !== 'host' && role !== 'guest') return { ok: false, error: 'proto' };
  if (!PEER_RE.test(peer ?? '')) return { ok: false, error: 'proto' };
  if (proto !== String(PROTO)) return { ok: false, error: 'proto' };
  return { ok: true, code, role, peer, listing: role === 'host' ? parseListing(url.searchParams) : null };
}

/** A clean player count 1..8 (anything else → fallback). */
function playersOf(v, fallback = 1) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PLAYERS ? n : fallback;
}

/**
 * The host's optional listing parameters: `code` (4 letters), `who` (racer id), `players`, `list` ('0' = hidden).
 * @param {URLSearchParams} q
 * @returns {{ code: string, who: string|null, players: number, on: boolean } | null}
 */
export function parseListing(q) {
  const code = q.get('code');
  if (!code || !LIST_CODE_RE.test(code)) return null;
  const who = q.get('who');
  return { code, who: who && WHO_RE.test(who) ? who : null, players: playersOf(q.get('players')), on: q.get('list') !== '0' };
}

/** A fresh, empty room. */
export function createRoomState() {
  return {
    host: null, // host peer id
    peers: {}, // peerId → { role, ipHash, n, win: { start, count }, lastIce }
    locked: false,
    blocked: [], // salted IP hashes refused until unlock
    joins: [], // timestamps of recent guest join attempts (per-room cap)
    n: 0, // join counter; tells a replaced socket's late close apart from the current one
    emptySince: null, // when the last socket left (null while anyone is connected)
    room: null, // this room's id ('r' + 24 hex), learned from the first join (for the open-games list)
    listing: null, // { code, who, players, on } while a listing-capable host is here
  };
}

/** The part of a room that must survive hibernation (peers are rebuilt from the sockets). */
export function durablePart(state) {
  return {
    locked: state.locked,
    blocked: [...state.blocked],
    joins: [...state.joins],
    n: state.n,
    emptySince: state.emptySince,
    room: state.room ?? null,
    listing: state.listing ? { ...state.listing } : null,
  };
}

/**
 * Rebuild a room from its stored durable part plus the attachments of its open sockets.
 * @param {ReturnType<typeof durablePart> | null | undefined} durable
 * @param {Array<{ peer: string, role: 'host'|'guest', ipHash: string, n: number }>} sockets
 */
export function restoreRoomState(durable, sockets = []) {
  const s = createRoomState();
  if (durable) {
    s.locked = !!durable.locked;
    s.blocked = Array.isArray(durable.blocked) ? [...durable.blocked] : [];
    s.joins = Array.isArray(durable.joins) ? [...durable.joins] : [];
    s.n = Number.isFinite(durable.n) ? durable.n : 0;
    s.emptySince = durable.emptySince ?? null;
    s.room = typeof durable.room === 'string' && ROOM_CODE_RE.test(durable.room) ? durable.room : null;
    s.listing = durable.listing && LIST_CODE_RE.test(durable.listing.code ?? '') ? { ...durable.listing } : null;
  }
  for (const a of sockets) {
    if (!a || a.gone || !PEER_RE.test(a.peer ?? '') || (a.role !== 'host' && a.role !== 'guest')) continue;
    const prev = s.peers[a.peer];
    if (prev && prev.n >= (a.n ?? 0)) continue; // a replaced (older) socket of the same peer
    if (a.role === 'host') {
      if (s.host && s.host !== a.peer) continue; // cannot happen; keep the first host
      s.host = a.peer;
    }
    s.peers[a.peer] = { role: a.role, ipHash: a.ipHash ?? '', n: a.n ?? 0, win: { start: 0, count: 0 }, lastIce: -Infinity };
    s.n = Math.max(s.n, a.n ?? 0);
  }
  if (Object.keys(s.peers).length) s.emptySince = null;
  if (!s.host) s.listing = null;
  return s;
}

/** What the open-games list should say about this room now (null = nothing to tell it). */
export function registryOp(state) {
  if (!state.room) return null;
  const l = state.listing;
  if (state.host && l && l.on && !state.locked) {
    return { op: 'put', room: state.room, entry: { code: l.code, who: l.who, players: l.players } };
  }
  return { op: 'remove', room: state.room };
}

function clone(state) {
  const peers = {};
  for (const [id, p] of Object.entries(state.peers)) peers[id] = { ...p, win: { ...p.win } };
  return {
    ...state, peers, blocked: [...state.blocked], joins: [...state.joins], listing: state.listing ? { ...state.listing } : null,
  };
}

function guestIds(state) {
  return Object.keys(state.peers).filter((id) => state.peers[id].role === 'guest');
}

function result(state, extra = {}) {
  return { state, sends: [], close: [], ...extra };
}

/** Error for a connected peer: `{ t: 'error', code }`, then close with the matching code. */
function errorAndClose(state, peer, code, now) {
  const r = result(state, { persist: true });
  r.sends.push({ to: peer, msg: { t: 'error', code } });
  r.close.push({ peer, code: CLOSE_CODES[code], reason: code, n: state.peers[peer]?.n });
  removePeer(r, peer, now);
  return r;
}

/** Remove a peer and tell the host when a guest left. Mutates r.state (already a clone). */
function removePeer(r, peer, now) {
  const s = r.state;
  const p = s.peers[peer];
  if (!p) return;
  delete s.peers[peer];
  if (p.role === 'host') {
    s.host = null;
    const hadListing = !!s.listing;
    s.listing = null;
    if (hadListing) r.registry = registryOp(s);
  } else if (s.host) r.sends.push({ to: s.host, msg: { t: 'peer-leave', peer } });
  if (!Object.keys(s.peers).length) {
    s.emptySince = now ?? s.emptySince ?? 0;
    r.gcAt = s.emptySince + ROOM_GC_MS;
  }
}

function join(state, ev) {
  const { peer, role, ipHash, now } = ev;
  const s = clone(state);
  const reject = (error) => {
    const r = result(s, { accept: false, error, persist: true });
    if (!Object.keys(s.peers).length) {
      // Nobody is here (e.g. a guest before any host): make sure the stored join counts get cleaned up too.
      s.emptySince = s.emptySince ?? now;
      r.gcAt = s.emptySince + ROOM_GC_MS;
    }
    return r;
  };

  if (role === 'guest') {
    // Every guest attempt counts, accepted or not, so a stranger hammering a room hits the cap quickly.
    s.joins = s.joins.filter((t) => now - t < JOIN_WINDOW_MS);
    s.joins.push(now);
    if (!s.host) return reject('no-host');
    if (s.joins.length > GUEST_JOINS_PER_MIN) return reject('rate');
    if (s.locked || s.blocked.includes(ipHash)) return reject('locked');
  } else if (s.host && s.host !== peer) {
    return reject('host-exists');
  }

  const r = result(s, { accept: true, persist: true });
  const existing = s.peers[peer];
  if (existing) {
    if (existing.role !== role) return reject('proto');
    // Same peer id again (a page that reconnected before its old socket timed out): replace the old socket.
    r.close.push({ peer, code: CLOSE_CODES.replaced, reason: 'replaced', n: existing.n });
    delete s.peers[peer];
    if (role === 'host') s.host = null;
  } else if (role === 'guest' && guestIds(s).length >= MAX_GUESTS) {
    return reject('full');
  }

  s.n += 1;
  s.peers[peer] = { role, ipHash, n: s.n, win: { start: now, count: 0 }, lastIce: now };
  s.emptySince = null;
  r.n = s.n;
  r.cancelGc = true;
  if (typeof ev.room === 'string' && ROOM_CODE_RE.test(ev.room)) s.room = ev.room;
  if (role === 'host') {
    s.host = peer;
    const hadListing = !!s.listing;
    s.listing = ev.listing ? { ...ev.listing } : null;
    if (s.listing || hadListing) r.registry = registryOp(s);
  }
  const peers = role === 'host' ? guestIds(s) : [];
  // iceServers/turn are filled in by the Durable Object (STUN + this room's TURN creds). `list: true` tells a
  // host that this worker keeps the open-games list (so it may send { t: 'list' }).
  r.sends.push({ to: peer, msg: { t: 'joined', you: peer, host: s.host, peers, iceServers: [], turn: false, list: true }, withIce: true });
  if (role === 'guest' && !existing) r.sends.push({ to: s.host, msg: { t: 'peer-join', peer } });
  return r;
}

function leave(state, ev) {
  const p = state.peers[ev.peer];
  if (!p || (ev.n !== undefined && p.n !== ev.n)) return result(state); // unknown, or an old replaced socket
  const r = result(clone(state), { persist: true });
  removePeer(r, ev.peer, ev.now);
  return r;
}

function parseJson(raw) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function message(state, ev) {
  const { peer, raw, now } = ev;
  const p = state.peers[peer];
  if (!p || (ev.n !== undefined && p.n !== ev.n)) return result(state);
  const s = clone(state);
  const me = s.peers[peer];

  // Per-socket rate: ≤ 50 messages in any 1 s window (fixed window, restarted by the first message after it).
  if (now - me.win.start >= 1000) me.win = { start: now, count: 0 };
  me.win.count += 1;
  if (me.win.count > MSGS_PER_SEC) return errorAndClose(s, peer, 'rate', now);

  if (typeof raw !== 'string') return errorAndClose(s, peer, 'proto', now);
  if (messageBytes(raw) > MAX_MSG_BYTES) return errorAndClose(s, peer, 'proto', now);
  if (raw === 'ping') {
    const r = result(s);
    r.sends.push({ to: peer, msg: 'pong' });
    return r;
  }
  const msg = parseJson(raw);
  if (!msg || typeof msg.t !== 'string') return errorAndClose(s, peer, 'proto', now);
  const isHost = s.host === peer;

  switch (msg.t) {
    case 'signal': {
      if (typeof msg.to !== 'string' || !PEER_RE.test(msg.to) || msg.data === undefined) return errorAndClose(s, peer, 'proto', now);
      const r = result(s);
      // A target that just left is normal (races with peer-leave), so an unknown target is ignored, not an error.
      if (msg.to === peer || !s.peers[msg.to]) return r;
      if (!isHost && msg.to !== s.host) return r; // guests may only address the host
      r.sends.push({ to: msg.to, msg: { t: 'signal', from: peer, data: msg.data } });
      return r;
    }
    case 'drop': {
      if (!isHost || typeof msg.peer !== 'string') return errorAndClose(s, peer, 'proto', now);
      const target = s.peers[msg.peer];
      const r = result(s, { persist: true });
      if (!target || target.role !== 'guest') return r;
      if (target.ipHash && !s.blocked.includes(target.ipHash)) {
        s.blocked.push(target.ipHash);
        if (s.blocked.length > MAX_BLOCKED) s.blocked.shift();
      }
      r.close.push({ peer: msg.peer, code: CLOSE_CODES.removed, reason: 'removed', n: target.n });
      removePeer(r, msg.peer, now);
      return r;
    }
    case 'lock': {
      if (!isHost || typeof msg.locked !== 'boolean') return errorAndClose(s, peer, 'proto', now);
      s.locked = msg.locked;
      if (!msg.locked) s.blocked = []; // unlocking forgives removed houses
      const r = result(s, { persist: true });
      if (s.listing) r.registry = registryOp(s);
      return r;
    }
    case 'list': {
      if (!isHost || typeof msg.on !== 'boolean') return errorAndClose(s, peer, 'proto', now);
      if (!s.listing) return result(s); // this host never gave a (checked) code: nothing to list
      s.listing.on = msg.on;
      if (msg.who === null || (typeof msg.who === 'string' && WHO_RE.test(msg.who))) s.listing.who = msg.who;
      if (msg.players !== undefined) s.listing.players = playersOf(msg.players, s.listing.players);
      return result(s, { persist: true, registry: registryOp(s) });
    }
    case 'ice': {
      // ≤ 1 fresh set per 30 s per socket; a faster ask still gets an answer, but never causes a new mint.
      const mint = now - me.lastIce >= ICE_REFRESH_MS;
      if (mint) me.lastIce = now;
      return result(s, { ice: { peer, mint } });
    }
    default:
      return errorAndClose(s, peer, 'proto', now);
  }
}

function alarm(state, ev) {
  if (Object.keys(state.peers).length) return result(state);
  const since = state.emptySince ?? ev.now;
  if (ev.now - since >= ROOM_GC_MS) return result(createRoomState(), { gc: true });
  return result(state, { gcAt: since + ROOM_GC_MS });
}

/**
 * The room reducer.
 * @param {ReturnType<typeof createRoomState>} state
 * @param {{ type: 'join', peer: string, role: 'host'|'guest', ipHash: string, now: number, room?: string,
 *           listing?: { code: string, who: string|null, players: number, on: boolean } | null }
 *       | { type: 'leave', peer: string, n?: number, now: number }
 *       | { type: 'message', peer: string, n?: number, raw: string | ArrayBuffer, now: number }
 *       | { type: 'alarm', now: number }} event
 * @returns {{ state: object, sends: Array<{ to: string, msg: object | string, withIce?: boolean }>,
 *   close: Array<{ peer: string, code: number, reason: string, n?: number }>, accept?: boolean, error?: string,
 *   n?: number, ice?: { peer: string, mint: boolean }, persist?: boolean, gc?: boolean, gcAt?: number,
 *   cancelGc?: boolean, registry?: { op: 'put'|'remove', room: string, entry?: object } | null }}
 */
export function roomReduce(state, event) {
  switch (event?.type) {
    case 'join': return join(state, event);
    case 'leave': return leave(state, event);
    case 'message': return message(state, event);
    case 'alarm': return alarm(state, event);
    default: return result(state);
  }
}
