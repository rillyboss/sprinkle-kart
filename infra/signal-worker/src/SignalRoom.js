// SignalRoom: the signal worker's SQLite-backed Durable Object (NETWORKING.md §3, §4.2).
//
// One instance per room (idFromName(workerRoom), where workerRoom is the key-derived 'r' + 24 hex id) relays
// SDP/ICE between the host and its guests over hibernatable WebSockets. One reserved instance,
// idFromName('guard'), holds the global per-IP counters and the daily TURN mint cap (the `guard` RPC method).
// Same class for both, so the wrangler migration never changes.
//
// All rules live in the pure reducers (room.js, guard.js); this file only does I/O: sockets, storage (a tiny
// key/value table in the object's SQLite database), alarms, hashing and TURN minting.
import { DurableObject } from 'cloudflare:workers';
import {
  roomReduce, restoreRoomState, durablePart, parseRoomRequest,
} from './room.js';
import { guardReduce, createGuardState, utcDay } from './guard.js';
import {
  mintTurn, turnConfigured, stunServers, withStun, TURN_TTL_ROOM, TURN_CACHE_MS,
} from './turn.js';
import {
  errorSocketResponse, sha256Hex, randomHex, clientIp, guardStub,
} from './http.js';

const OPEN = 1; // WebSocket.READY_STATE_OPEN

export class SignalRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ensureTable();
    // "ping" → "pong" without waking a hibernated object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    /** Per-peer message-rate windows and last ICE mint (in memory; they reset harmlessly on hibernation). */
    this.eph = new Map();
    /** This room's TURN servers { servers, at }; memory only, never shared with another room. */
    this.iceCache = null;
    this.icePending = null;
  }

  // ---- storage -----------------------------------------------------------------------------------------

  ensureTable() {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  kvGet(k) {
    const row = this.ctx.storage.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray()[0];
    return row ? JSON.parse(row.v) : null;
  }

  kvPut(k, v) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', k, JSON.stringify(v));
  }

  // ---- guard (the instance named 'guard') --------------------------------------------------------------

  /** Today's salt for hashing IPs in the guard (rotated every UTC day, so hashes can't be linked across days). */
  dailySalt(now) {
    const day = utcDay(now);
    const cur = this.kvGet('salt');
    if (cur && cur.day === day) return cur.salt;
    const salt = randomHex();
    this.kvPut('salt', { day, salt });
    return salt;
  }

  /**
   * Global limits (RPC). op: 'join' | 'ice' (per salted IP hash), 'mint' (take one TURN mint from today's
   * cap) or 'status' (is TURN still under today's cap?).
   * @returns {Promise<{ allow: boolean, retryAfterMs?: number, mintsLeft?: number }>}
   */
  async guard(op, ip = '') {
    const now = Date.now();
    let event;
    if (op === 'join' || op === 'ice') {
      const key = await sha256Hex(this.dailySalt(now) + String(ip));
      event = { type: 'hit', kind: op, key, now };
    } else if (op === 'mint' || op === 'status') {
      event = { type: op, now };
    } else {
      return { allow: false };
    }
    // Read after the await so two calls can never overwrite each other's counts.
    const r = guardReduce(this.kvGet('guard') ?? createGuardState(), event);
    if (op !== 'status' || r.newDay) this.kvPut('guard', r.state);
    const out = { allow: r.allow };
    if (r.retryAfterMs !== undefined) out.retryAfterMs = r.retryAfterMs;
    if (r.mintsLeft !== undefined) out.mintsLeft = r.mintsLeft;
    return out;
  }

  // ---- room --------------------------------------------------------------------------------------------

  openSockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === OPEN);
  }

  /** The socket for a peer: a specific join number `n`, or else the newest one. */
  socketFor(peer, n) {
    let best = null;
    let bestN = -1;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || a.peer !== peer) continue;
      if (n !== undefined) {
        if (a.n === n) return ws;
      } else if (a.n > bestN) {
        best = ws;
        bestN = a.n;
      }
    }
    return best;
  }

  /** The room as the reducer sees it. `closing` is a socket whose close event is being handled. */
  roomState(closing) {
    const sockets = this.openSockets();
    if (closing && !sockets.includes(closing)) sockets.push(closing);
    const s = restoreRoomState(this.kvGet('room'), sockets.map((ws) => ws.deserializeAttachment()));
    for (const [peer, p] of Object.entries(s.peers)) {
      const e = this.eph.get(peer);
      if (e && e.n === p.n) {
        p.win = { ...e.win };
        p.lastIce = e.lastIce;
      }
    }
    return s;
  }

  async roomIpHash(ip) {
    let salt = this.kvGet('roomSalt');
    if (!salt) {
      salt = randomHex();
      this.kvPut('roomSalt', salt);
    }
    return sha256Hex(salt + String(ip));
  }

  send(ws, msg) {
    try {
      ws?.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } catch {
      // the socket went away; its close event cleans up
    }
  }

  /** Carry out a reducer result (except `withIce` sends, which the caller handles). */
  async apply(r) {
    this.eph = new Map(Object.entries(r.state.peers).map(([id, p]) => [id, { n: p.n, win: { ...p.win }, lastIce: p.lastIce }]));
    if (r.gc) {
      this.iceCache = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.ensureTable(); // deleteAll drops the table; this object may be used again right away
      return;
    }
    if (r.persist) this.kvPut('room', durablePart(r.state));
    for (const s of r.sends) if (!s.withIce) this.send(this.socketFor(s.to), s.msg);
    for (const c of r.close) {
      const ws = this.socketFor(c.peer, c.n);
      try {
        // Mark it gone first, so its close event (or a restore) never counts it as in the room again.
        const a = ws?.deserializeAttachment();
        if (a) ws.serializeAttachment({ ...a, gone: true });
        ws?.close(c.code, c.reason);
      } catch {
        // already closing
      }
    }
    if (r.cancelGc) await this.ctx.storage.deleteAlarm();
    if (r.gcAt !== undefined) await this.ctx.storage.setAlarm(r.gcAt);
  }

  /** STUN + this room's TURN servers (cached ≤ 5 min in this object only). `mint: false` never mints. */
  async roomIce({ mint = true } = {}) {
    const now = Date.now();
    if (this.iceCache && now - this.iceCache.at < TURN_CACHE_MS) {
      return { iceServers: withStun(this.iceCache.servers), turn: true };
    }
    if (!mint || !turnConfigured(this.env)) return { iceServers: stunServers(), turn: false };
    if (!this.icePending) {
      this.icePending = (async () => {
        try {
          const g = await guardStub(this.env).guard('mint');
          if (!g.allow) return null;
          const servers = await mintTurn(this.env, { ttl: TURN_TTL_ROOM });
          this.iceCache = { servers, at: Date.now() };
          return servers;
        } catch {
          return null;
        } finally {
          this.icePending = null;
        }
      })();
    }
    const servers = await this.icePending;
    return servers ? { iceServers: withStun(servers), turn: true } : { iceServers: stunServers(), turn: false };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const p = parseRoomRequest(url);
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('Upgrade to a WebSocket', { status: 426 });
    }
    if (!p.ok) return errorSocketResponse('proto');

    const ipHash = await this.roomIpHash(clientIp(request));
    const now = Date.now();
    const r = roomReduce(this.roomState(), { type: 'join', peer: p.peer, role: p.role, ipHash, now });
    if (!r.accept) {
      await this.apply(r);
      return errorSocketResponse(r.error);
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [p.peer]);
    server.serializeAttachment({ peer: p.peer, role: p.role, ipHash, n: r.n });
    await this.apply(r);
    const ice = await this.roomIce();
    for (const s of r.sends) if (s.withIce) this.send(server, { ...s.msg, ...ice });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment();
    if (!a) return;
    const r = roomReduce(this.roomState(), { type: 'message', peer: a.peer, n: a.n, raw, now: Date.now() });
    await this.apply(r);
    if (r.ice) {
      const ice = await this.roomIce({ mint: r.ice.mint });
      this.send(this.socketFor(r.ice.peer), { t: 'ice', ...ice });
    }
  }

  async webSocketClose(ws, code, reason) {
    const a = ws.deserializeAttachment();
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // already closed
    }
    if (!a) return;
    await this.apply(roomReduce(this.roomState(ws), { type: 'leave', peer: a.peer, n: a.n, now: Date.now() }));
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws, 1011, 'error');
  }

  async alarm() {
    await this.apply(roomReduce(this.roomState(), { type: 'alarm', now: Date.now() }));
  }
}
