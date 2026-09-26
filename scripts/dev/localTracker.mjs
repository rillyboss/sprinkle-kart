#!/usr/bin/env node
/**
 * localTracker.mjs — a minimal WebTorrent-tracker WebSocket relay for tests and the online e2e
 * (NETWORKING.md §15): Trystero's torrent strategy talks to it exactly like to
 * wss://tracker.openwebtorrent.com, so tests NEVER touch real public relays.
 *
 * Zero dependencies (node:http + node:crypto, a hand-written RFC 6455 framer), so it runs
 * on any Node ≥ 18 without installing `ws`.
 *
 *   node scripts/dev/localTracker.mjs [--port 8000] [--host 127.0.0.1]
 *   → prints "localTracker listening on ws://127.0.0.1:8000"; use it with
 *     ?signal=public&relays=ws://127.0.0.1:8000 on a localhost/dev build.
 *
 * Tracker protocol (the subset WebTorrent/Trystero use):
 *   C→T { action:'announce', info_hash, peer_id, numwant, offers:[{ offer_id, offer }] }
 *       → reply { action:'announce', interval, info_hash, complete, incomplete } and forward
 *         each offer to one other peer of the swarm as { action, info_hash, peer_id, offer_id, offer }
 *   C→T { action:'announce', info_hash, peer_id, to_peer_id, offer_id, answer }
 *       → forwarded to `to_peer_id` as { action, info_hash, peer_id, offer_id, answer }
 *   C→T { action:'scrape' } → { action:'scrape', files:{} }
 *
 * Also exports `MiniWebSocket`, a tiny browser-shaped WebSocket client (for Node < 22, which has
 * no global WebSocket) used by the node tests.
 */
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 20; // 1 MiB is plenty for SDP offers

/** Encode one unfragmented frame. */
export function encodeFrame(opcode, payload, mask = false) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  if (!mask) return Buffer.concat([header, data]);
  header[1] |= 0x80;
  const key = crypto.randomBytes(4);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ key[i & 3];
  return Buffer.concat([header, key, masked]);
}

/**
 * Incremental frame parser: feed Buffers, get { opcode, payload } messages (reassembles
 * continuation frames; unmasks client frames).
 */
export function createFrameParser(onMessage, onError = () => {}) {
  let buf = Buffer.alloc(0);
  let fragOpcode = 0;
  let frags = [];
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return onError(new Error('frame too large'));
        len = Number(big);
        off = 10;
      }
      if (len > MAX_FRAME) return onError(new Error('frame too large'));
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const key = buf.subarray(off, off + 4);
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i & 3];
        payload = out;
      } else payload = Buffer.from(payload);
      buf = buf.subarray(need);
      if (opcode === 0x0) {
        frags.push(payload);
        if (fin) {
          onMessage({ opcode: fragOpcode, payload: Buffer.concat(frags) });
          frags = [];
        }
      } else if (opcode === 0x1 || opcode === 0x2) {
        if (fin) onMessage({ opcode, payload });
        else {
          fragOpcode = opcode;
          frags = [payload];
        }
      } else onMessage({ opcode, payload }); // control frames
    }
  };
}

/**
 * Start the tracker.
 * @param {{ port?: number, host?: string, interval?: number, log?: (s: string) => void }} [o]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, stats: () => object }>}
 */
export function startLocalTracker({ port = 0, host = '127.0.0.1', interval = 10, log = () => {} } = {}) {
  /** @type {Map<string, Map<string, any>>} info_hash → peer_id → socket */
  const swarms = new Map();
  const sockets = new Set();
  const counters = { connections: 0, announces: 0, offersForwarded: 0, answersForwarded: 0 };

  const server = http.createServer((req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' });
    res.end('localTracker: WebSocket only\n');
  });

  function send(sock, obj) {
    if (sock.destroyed || sock._closing) return;
    sock.write(encodeFrame(0x1, JSON.stringify(obj)));
  }

  function leaveAll(sock) {
    for (const [hash, peers] of swarms) {
      for (const [pid, s] of peers) if (s === sock) peers.delete(pid);
      if (!peers.size) swarms.delete(hash);
    }
  }

  function onJson(sock, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.action === 'scrape') return send(sock, { action: 'scrape', files: {} });
    if (msg.action !== 'announce' || typeof msg.info_hash !== 'string' || typeof msg.peer_id !== 'string') return;
    counters.announces++;
    const hash = msg.info_hash;
    const peers = swarms.get(hash) ?? new Map();
    swarms.set(hash, peers);
    if (msg.event === 'stopped') {
      peers.delete(msg.peer_id);
      return;
    }
    peers.set(msg.peer_id, sock);
    sock._peerIds.add(msg.peer_id);
    if (msg.answer && typeof msg.to_peer_id === 'string') {
      const to = peers.get(msg.to_peer_id);
      if (to) {
        counters.answersForwarded++;
        send(to, { action: 'announce', info_hash: hash, peer_id: msg.peer_id, offer_id: msg.offer_id, answer: msg.answer });
      }
      return;
    }
    send(sock, { action: 'announce', interval, info_hash: hash, complete: 0, incomplete: peers.size });
    if (Array.isArray(msg.offers) && msg.offers.length) {
      const others = [...peers.entries()].filter(([pid, s]) => pid !== msg.peer_id && s !== sock);
      const n = Math.min(others.length, msg.offers.length, Number(msg.numwant) || msg.offers.length);
      for (let i = 0; i < n; i++) {
        const [, target] = others[i];
        const o = msg.offers[i];
        if (!o || !o.offer) continue;
        counters.offersForwarded++;
        send(target, { action: 'announce', info_hash: hash, peer_id: msg.peer_id, offer_id: o.offer_id, offer: o.offer });
      }
    }
  }

  server.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
      sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    sock.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
    sock.setNoDelay(true);
    sock._peerIds = new Set();
    sockets.add(sock);
    counters.connections++;
    log(`connect (${sockets.size} open)`);
    const parse = createFrameParser(
      ({ opcode, payload }) => {
        if (opcode === 0x1) {
          let msg;
          try {
            msg = JSON.parse(payload.toString('utf8'));
          } catch {
            return;
          }
          onJson(sock, msg);
        } else if (opcode === 0x8) {
          if (!sock._closing) sock.write(encodeFrame(0x8, payload.subarray(0, 2)));
          sock._closing = true;
          sock.end();
        } else if (opcode === 0x9) sock.write(encodeFrame(0xa, payload));
      },
      () => sock.destroy(),
    );
    sock.on('data', parse);
    const gone = () => {
      sockets.delete(sock);
      leaveAll(sock);
    };
    sock.on('close', gone);
    sock.on('error', gone);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      const url = `ws://${host}:${actual}`;
      resolve({
        url,
        port: actual,
        stats: () => ({ ...counters, open: sockets.size, swarms: swarms.size }),
        close: () =>
          new Promise((res) => {
            for (const s of sockets) s.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

/**
 * Minimal browser-shaped WebSocket client (text frames only; enough for trackers and relays).
 * Used where Node has no global WebSocket (Node < 22).
 */
export class MiniWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    this.url = String(url);
    this.readyState = 0;
    this.binaryType = 'blob';
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    const u = new URL(this.url);
    const secure = u.protocol === 'wss:';
    const port = Number(u.port) || (secure ? 443 : 80);
    const key = crypto.randomBytes(16).toString('base64');
    const sock = secure ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port });
    this._sock = sock;
    let handshaken = false;
    let head = Buffer.alloc(0);
    const parse = createFrameParser(({ opcode, payload }) => {
      if (opcode === 0x1) this._fire('message', { data: payload.toString('utf8') });
      else if (opcode === 0x2) this._fire('message', { data: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length) });
      else if (opcode === 0x8) {
        if (this.readyState === 1) sock.write(encodeFrame(0x8, payload.subarray(0, 2), true));
        this._finish(payload.length >= 2 ? payload.readUInt16BE(0) : 1005);
      } else if (opcode === 0x9) sock.write(encodeFrame(0xa, payload, true));
    });
    sock.on(secure ? 'secureConnect' : 'connect', () => {
      sock.write(
        [
          `GET ${u.pathname || '/'}${u.search} HTTP/1.1`,
          `Host: ${u.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
      );
    });
    sock.on('data', (chunk) => {
      if (handshaken) return parse(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      const status = head.subarray(0, end).toString('latin1');
      const expect = crypto.createHash('sha1').update(key + GUID).digest('base64');
      if (!/^HTTP\/1\.1 101/.test(status) || !status.includes(expect)) {
        this._fire('error', {});
        sock.destroy();
        return;
      }
      handshaken = true;
      this.readyState = 1;
      this._fire('open', {});
      const rest = head.subarray(end + 4);
      if (rest.length) parse(rest);
    });
    sock.on('error', () => {
      if (this.readyState < 2) this._fire('error', {});
    });
    sock.on('close', () => this._finish(1006));
  }
  _fire(type, props) {
    const h = this['on' + type];
    if (typeof h === 'function') h.call(this, { type, target: this, ...props });
  }
  _finish(code) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    try {
      this._sock.destroy();
    } catch {
      /* ignore */
    }
    this._fire('close', { code, reason: '', wasClean: code === 1000 });
  }
  send(data) {
    if (this.readyState !== 1) throw new Error('InvalidStateError: not open');
    this._sock.write(encodeFrame(typeof data === 'string' ? 0x1 : 0x2, typeof data === 'string' ? data : Buffer.from(data), true));
  }
  close(code = 1000) {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code, 0);
    try {
      this._sock.write(encodeFrame(0x8, b, true));
    } catch {
      /* ignore */
    }
    setTimeout(() => this._finish(code), 50).unref?.();
  }
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : dflt;
  };
  const port = Number(arg('--port', process.env.TRACKER_PORT || 8000));
  const host = arg('--host', '127.0.0.1');
  startLocalTracker({ port, host, log: (s) => console.log(`[localTracker] ${s}`) }).then((t) => {
    console.log(`localTracker listening on ${t.url}`);
    const stop = () => t.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}
