/**
 * A fake in-process implementation of our Worker's client protocol (NETWORKING.md §4.2) — NOT
 * WS3's code: it is written from the spec so WorkerSignaling is tested against the contract.
 *
 * `createFakeWorkerServer(opts)` gives:
 * - `WebSocket`: a browser-shaped WebSocket class whose `/room/:code?role&peer&proto` URLs
 *   connect to the fake rooms (open/message/close/error on microtasks);
 * - `fetch`: `/health` → `{ ok, turn, version }` and `/ice` → `{ iceServers, turn }`;
 * - knobs: `down` (sockets error + close, fetch rejects), `healthOk`, `turn`, `badOrigin`,
 *   `rate`, `iceDelay`, and a `log` of every client→server message.
 */

const TURN_URLS = ['turn:turn.example.test:3478?transport=udp', 'turns:turn.example.test:443?transport=tcp', 'turn:turn.example.test:53'];

export function createFakeWorkerServer(opts = {}) {
  const server = {
    down: !!opts.down,
    healthOk: opts.healthOk !== false,
    turn: opts.turn !== false,
    badOrigin: !!opts.badOrigin,
    rate: !!opts.rate,
    silentIce: false,
    silent: !!opts.silent,
    forceError: opts.forceError ?? null,
    version: 'test-1',
    mints: 0,
    /** @type {Map<string, { host: any, guests: Map<string, any>, locked: boolean }>} */
    rooms: new Map(),
    sockets: new Set(),
    log: [],
    fetchLog: [],
    urls: [],
  };

  const deliver = (fn) => queueMicrotask(fn);
  const stun = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  const mint = () => {
    server.mints++;
    const n = server.mints;
    // The real Worker filters :53 out; the fake does too.
    return [
      ...stun,
      { urls: TURN_URLS.filter((u) => !/:53(\?|$)/.test(u)), username: `user${n}`, credential: `cred${n}` },
    ];
  };
  const roomIce = () => (server.turn ? mint() : stun);

  function toClient(sock, obj) {
    if (sock.readyState !== 1) return;
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    deliver(() => {
      if (sock.readyState !== 1) return;
      sock._fire('message', { data: text });
    });
  }

  function errorAndClose(sock, code) {
    toClient(sock, { t: 'error', code });
    deliver(() => deliver(() => sock._serverClose(4000 + 1, code)));
  }

  function onJoin(sock) {
    const u = new URL(sock.url);
    const m = /\/room\/([^/]+)$/.exec(u.pathname);
    const role = u.searchParams.get('role');
    const peer = u.searchParams.get('peer');
    const proto = u.searchParams.get('proto');
    sock.meta = { room: m ? decodeURIComponent(m[1]) : '', role, peer };
    if (server.silent) return; // socket open, never answers (join timeout)
    if (server.forceError) return errorAndClose(sock, server.forceError);
    if (server.badOrigin) return errorAndClose(sock, 'bad-origin');
    if (proto !== '1') return errorAndClose(sock, 'proto');
    if (server.rate) return errorAndClose(sock, 'rate');
    let room = server.rooms.get(sock.meta.room);
    if (role === 'host') {
      if (room && room.host) return errorAndClose(sock, 'host-exists');
      room = room ?? { host: null, guests: new Map(), locked: false };
      room.host = sock;
      server.rooms.set(sock.meta.room, room);
      toClient(sock, { t: 'joined', you: peer, host: peer, peers: [], iceServers: roomIce(), turn: server.turn });
      return;
    }
    if (!room || !room.host) return errorAndClose(sock, 'no-host');
    if (room.locked) return errorAndClose(sock, 'locked');
    if (room.guests.size >= 7) return errorAndClose(sock, 'full');
    room.guests.set(peer, sock);
    toClient(sock, { t: 'joined', you: peer, host: room.host.meta.peer, peers: [], iceServers: roomIce(), turn: server.turn });
    toClient(room.host, { t: 'peer-join', peer });
  }

  function onClientMessage(sock, text) {
    server.log.push({ from: sock.meta?.peer, role: sock.meta?.role, text });
    if (text === 'ping') return toClient(sock, 'pong');
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const room = server.rooms.get(sock.meta.room);
    if (!room) return;
    const isHost = room.host === sock;
    switch (msg.t) {
      case 'signal': {
        const target = msg.to === room.host?.meta.peer ? room.host : isHost ? room.guests.get(msg.to) : null;
        if (!target) return;
        toClient(target, { t: 'signal', from: sock.meta.peer, data: msg.data });
        return;
      }
      case 'drop': {
        if (!isHost) return;
        const g = room.guests.get(msg.peer);
        if (g) {
          room.guests.delete(msg.peer);
          g._serverClose(4003, 'dropped');
        }
        return;
      }
      case 'lock':
        if (isHost) room.locked = !!msg.locked;
        return;
      case 'ice':
        if (server.silentIce) return;
        toClient(sock, { t: 'ice', iceServers: roomIce() });
        return;
      default:
        return;
    }
  }

  function onClientGone(sock) {
    server.sockets.delete(sock);
    const room = sock.meta && server.rooms.get(sock.meta.room);
    if (!room) return;
    if (room.host === sock) {
      room.host = null;
      for (const g of room.guests.values()) toClient(g, { t: 'peer-leave', peer: sock.meta.peer });
      if (!room.guests.size) server.rooms.delete(sock.meta.room);
    } else if (room.guests.get(sock.meta.peer) === sock) {
      room.guests.delete(sock.meta.peer);
      if (room.host) toClient(room.host, { t: 'peer-leave', peer: sock.meta.peer });
    }
  }

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this.meta = null;
      server.urls.push(this.url);
      server.sockets.add(this);
      deliver(() => {
        if (this.readyState !== 0) return;
        if (server.down) {
          this.readyState = 3;
          this._fire('error', {});
          this._fire('close', { code: 1006, reason: '' });
          server.sockets.delete(this);
          return;
        }
        this.readyState = 1;
        this._fire('open', {});
        onJoin(this);
      });
    }
    _fire(type, props) {
      const h = this['on' + type];
      if (typeof h === 'function') h.call(this, { type, ...props });
    }
    send(text) {
      if (this.readyState !== 1) throw new Error('InvalidStateError');
      deliver(() => onClientMessage(this, String(text)));
    }
    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      deliver(() => {
        onClientGone(this);
        this._fire('close', { code, reason });
      });
    }
    _serverClose(code, reason) {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      onClientGone(this);
      this._fire('close', { code, reason });
    }
  }

  server.WebSocket = FakeWebSocket;
  server.fetch = async (url) => {
    server.fetchLog.push(String(url));
    if (server.down) throw new TypeError('fetch failed');
    const u = new URL(String(url));
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    if (u.pathname.endsWith('/health')) {
      if (!server.healthOk) return json(503, { ok: false });
      return json(200, { ok: true, turn: server.turn, version: server.version });
    }
    if (u.pathname.endsWith('/ice')) {
      if (server.rate) return json(429, { error: 'rate' });
      return json(200, { iceServers: roomIce(), turn: server.turn });
    }
    return json(404, {});
  };
  /** Close every socket as if the Worker restarted (after join). */
  server.dropAll = () => {
    for (const s of [...server.sockets]) s._serverClose(1012, 'restart');
  };
  return server;
}
