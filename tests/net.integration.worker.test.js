/**
 * Integration: WS4's browser WorkerSignaling client talking to WS3's REAL room logic
 * (infra/signal-worker/src/room.js: parseRoomRequest + roomReduce), not the spec-written fake.
 * A tiny bridge plays the Durable Object: it parses the upgrade URL, feeds join/message/leave
 * events to the reducer, delivers `sends`, fills `withIce` with STUN, and applies `close`.
 */
import { describe, it, expect } from 'vitest';
import { createWorkerSignaling, workerRoomUrl, WORKER_PROTO, WORKER_MAX_MSG_BYTES } from '../src/net/signaling/worker.js';
import { SIGNALING_ERROR_CODES, workerErrorToSignalingError, isPeerId, makePeerId } from '../src/net/signaling/types.js';
import { createWebRtcTransport } from '../src/net/transport/webrtc.js';
import {
  parseRoomRequest,
  roomReduce,
  createRoomState,
  ERROR_CODES,
  CLOSE_CODES,
  PROTO,
  MAX_MSG_BYTES,
  ROOM_CODE_RE,
  PEER_RE,
} from '../infra/signal-worker/src/room.js';
import { createFakeRtcNetwork, settle, fakeRoomIds } from './helpers/netFakeRtc.js';

const BASE = 'https://sprinkle-kart-signal.example.workers.dev';
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const HOST = '1111111111111111';
const G1 = '2222222222222222';
const G2 = '3333333333333333';

/** One Durable-Object-like room driven by the real reducer. */
function createBridge() {
  const bridge = { state: createRoomState(), sockets: new Map(), closes: [], rejected: [], clock: 1_000_000, log: [] };
  const deliver = (fn) => queueMicrotask(fn);

  function apply(r) {
    bridge.state = r.state;
    for (const s of r.sends) {
      const sock = bridge.sockets.get(s.to);
      if (!sock) continue;
      let msg = s.msg;
      if (s.withIce && typeof msg === 'object') msg = { ...msg, iceServers: STUN, turn: false };
      sock._toClient(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    if (r.ice) {
      const sock = bridge.sockets.get(r.ice.peer);
      sock?._toClient(JSON.stringify({ t: 'ice', iceServers: STUN }));
    }
    for (const c of r.close) {
      const sock = bridge.sockets.get(c.peer);
      if (!sock || (c.n !== undefined && sock.n !== c.n)) continue;
      bridge.closes.push({ peer: c.peer, code: c.code, reason: c.reason });
      deliver(() => sock._serverClose(c.code, c.reason));
    }
  }

  class BridgeWebSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      deliver(() => this._open());
    }
    _fire(type, props) {
      const h = this['on' + type];
      if (typeof h === 'function') h.call(this, { type, ...props });
    }
    _open() {
      const u = new URL(this.url.replace(/^ws/, 'http'));
      const req = parseRoomRequest(u);
      this.readyState = 1;
      this._fire('open', {});
      if (!req.ok) {
        bridge.rejected.push(req.error);
        this._toClient(JSON.stringify({ t: 'error', code: 'proto' }));
        deliver(() => deliver(() => this._serverClose(CLOSE_CODES.proto, 'proto')));
        return;
      }
      this.peer = req.peer;
      const r = roomReduce(bridge.state, { type: 'join', peer: req.peer, role: req.role, ipHash: 'ip-' + req.peer, now: bridge.clock });
      if (!r.accept) {
        bridge.state = r.state;
        bridge.rejected.push(r.error);
        this._toClient(JSON.stringify({ t: 'error', code: r.error }));
        deliver(() => deliver(() => this._serverClose(CLOSE_CODES[r.error], r.error)));
        return;
      }
      this.n = r.n;
      const old = bridge.sockets.get(req.peer);
      bridge.sockets.set(req.peer, this);
      if (old && r.close.some((c) => c.reason === 'replaced')) {
        bridge.closes.push({ peer: req.peer, code: CLOSE_CODES.replaced, reason: 'replaced' });
        deliver(() => old._serverClose(CLOSE_CODES.replaced, 'replaced'));
      }
      apply({ ...r, close: r.close.filter((c) => c.reason !== 'replaced') });
    }
    _toClient(text) {
      deliver(() => {
        if (this.readyState === 1) this._fire('message', { data: text });
      });
    }
    send(text) {
      if (this.readyState !== 1) throw new Error('InvalidStateError');
      bridge.log.push({ from: this.peer, text: String(text) });
      deliver(() => {
        if (bridge.sockets.get(this.peer) !== this) return;
        apply(roomReduce(bridge.state, { type: 'message', peer: this.peer, n: this.n, raw: String(text), now: bridge.clock }));
      });
    }
    _gone() {
      if (this.peer && bridge.sockets.get(this.peer) === this) {
        bridge.sockets.delete(this.peer);
        apply(roomReduce(bridge.state, { type: 'leave', peer: this.peer, n: this.n, now: bridge.clock }));
      }
    }
    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      deliver(() => {
        this._gone();
        this._fire('close', { code, reason });
      });
    }
    _serverClose(code, reason) {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      this._gone();
      this._fire('close', { code, reason });
    }
  }
  bridge.WebSocket = BridgeWebSocket;
  return bridge;
}

function setup() {
  const bridge = createBridge();
  const net = createFakeRtcNetwork();
  const mk = () =>
    createWorkerSignaling({ baseUrl: BASE, WebSocketImpl: bridge.WebSocket, RTCPeerConnectionImpl: net.RTCPeerConnection, now: () => bridge.clock });
  return { bridge, net, mk, ids: fakeRoomIds('integration') };
}

describe('WS3 worker ⇄ WS4 client: static contract', () => {
  it('protocol version, message cap and id formats agree', () => {
    expect(WORKER_PROTO).toBe(PROTO);
    expect(WORKER_MAX_MSG_BYTES).toBe(MAX_MSG_BYTES);
    const id = makePeerId();
    expect(isPeerId(id)).toBe(true);
    expect(PEER_RE.test(id)).toBe(true);
    expect(ROOM_CODE_RE.test(fakeRoomIds('x').workerRoom)).toBe(true);
  });

  it('the URL the client builds is accepted by the worker parser', () => {
    const { workerRoom } = fakeRoomIds('url');
    for (const role of ['host', 'guest']) {
      const url = workerRoomUrl(BASE, { workerRoom, role, selfId: HOST });
      const r = parseRoomRequest(new URL(url.replace(/^wss/, 'https')));
      expect(r).toEqual({ ok: true, code: workerRoom, role, peer: HOST });
    }
  });

  it('every worker error code maps to a known SignalingError code (proto → unreachable/proto)', () => {
    for (const code of ERROR_CODES) {
      const err = workerErrorToSignalingError(code);
      expect(SIGNALING_ERROR_CODES).toContain(err.code);
      if (code === 'proto') expect(err).toMatchObject({ code: 'unreachable', detail: 'proto' });
      else expect(err.code).toBe(code);
    }
  });
});

describe('WS3 worker ⇄ WS4 client: live rooms through the real reducer', () => {
  it('host + guest meet, the guest offers, the host answers, data flows on the channels', async () => {
    const { bridge, mk, ids } = setup();
    const hs = mk();
    const gs = mk();
    const hostT = createWebRtcTransport({ signaling: hs, role: 'host', selfId: HOST });
    const guestT = createWebRtcTransport({ signaling: gs, role: 'guest', selfId: G1 });
    const h = await hs.join({ ids, role: 'host', selfId: HOST, iceServers: [], relayOnly: false });
    expect(h.iceServers).toEqual(STUN);
    await gs.join({ ids, role: 'guest', selfId: G1, iceServers: [], relayOnly: false });
    await settle(300);
    const signals = bridge.log.filter((l) => l.text !== 'ping').map((l) => ({ from: l.from, msg: JSON.parse(l.text) }));
    expect(signals.filter((s) => s.msg.data?.type === 'offer').map((s) => s.from)).toEqual([G1]);
    expect(signals.filter((s) => s.msg.data?.type === 'answer').map((s) => s.from)).toEqual([HOST]);
    const got = [];
    hostT.onMessage((p, ch, b) => got.push([p, ch, b[0]]));
    guestT.send(HOST, 'ctrl', new Uint8Array([0x42]));
    await settle();
    expect(got).toEqual([[G1, 'ctrl', 0x42]]);
    expect(bridge.closes).toEqual([]); // the worker never objected to anything the client sent
    hostT.close();
    guestT.close();
    await settle();
  });

  it('a guest with no host is refused with no-host', async () => {
    const { mk, ids } = setup();
    await expect(mk().join({ ids, role: 'guest', selfId: G1, iceServers: STUN })).rejects.toMatchObject({ code: 'no-host' });
  });

  it('a second host is refused with host-exists', async () => {
    const { mk, ids } = setup();
    await mk().join({ ids, role: 'host', selfId: HOST, iceServers: STUN });
    await expect(mk().join({ ids, role: 'host', selfId: G2, iceServers: STUN })).rejects.toMatchObject({ code: 'host-exists' });
  });

  it('lock refuses new guests; drop removes a guest with close 4010 and bars their house', async () => {
    const { bridge, mk, ids } = setup();
    const hs = mk();
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN });
    const g1 = mk();
    await g1.join({ ids, role: 'guest', selfId: G1, iceServers: STUN });
    await settle(100);
    hs.drop(G1);
    await settle(100);
    expect(bridge.closes).toContainEqual({ peer: G1, code: CLOSE_CODES.removed, reason: 'removed' });
    // The same house tries again → locked.
    await expect(mk().join({ ids, role: 'guest', selfId: G1, iceServers: STUN })).rejects.toMatchObject({ code: 'locked' });
    hs.setLocked(true);
    await settle(50);
    await expect(mk().join({ ids, role: 'guest', selfId: G2, iceServers: STUN })).rejects.toMatchObject({ code: 'locked' });
    await hs.leave();
  });

  it('refreshIce is answered with {t:ice} by the worker', async () => {
    const { bridge, mk, ids } = setup();
    const hs = mk();
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: [] });
    bridge.clock += 31_000;
    const ice = await hs.refreshIce();
    expect(ice).toEqual(STUN);
    expect(bridge.log.map((l) => l.text)).toContain('{"t":"ice"}');
    expect(bridge.closes).toEqual([]);
    await hs.leave();
  });

  it('a malformed room id is refused as proto → unreachable (detail proto)', async () => {
    const { mk } = setup();
    await expect(
      mk().join({ ids: { ...fakeRoomIds('bad'), workerRoom: 'NOT-A-ROOM' }, role: 'host', selfId: HOST, iceServers: STUN }),
    ).rejects.toMatchObject({ code: 'unreachable', detail: 'proto' });
  });
});
