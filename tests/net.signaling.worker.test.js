import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createWorkerSignaling,
  workerRoomUrl,
  WORKER_ICE_MIN_INTERVAL_MS,
  WORKER_JOIN_TIMEOUT_MS,
  WORKER_PING_MS,
  WORKER_ICE_TIMEOUT_MS,
} from '../src/net/signaling/worker.js';
import { SignalingError } from '../src/net/signaling/types.js';
import { createWebRtcTransport } from '../src/net/transport/webrtc.js';
import { createFakeRtcNetwork, settle, fakeRoomIds } from './helpers/netFakeRtc.js';
import { createFakeWorkerServer } from './helpers/netFakeWorker.js';

const HOST = '1111111111111111';
const G1 = '2222222222222222';
const G2 = '3333333333333333';
const BASE = 'https://sprinkle-kart-signal.example.workers.dev';
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];

function setup(serverOpts = {}, netOpts = {}) {
  const server = createFakeWorkerServer(serverOpts);
  const net = createFakeRtcNetwork(netOpts);
  let clock = 1_000_000;
  const mk = (extra = {}) =>
    createWorkerSignaling({
      baseUrl: BASE,
      WebSocketImpl: server.WebSocket,
      fetchImpl: server.fetch,
      RTCPeerConnectionImpl: net.RTCPeerConnection,
      now: () => clock,
      ...extra,
    });
  return { server, net, mk, ids: fakeRoomIds('worker'), tick: (ms) => (clock += ms) };
}

const msgs = (server, pred = () => true) =>
  server.log
    .filter((l) => l.text !== 'ping')
    .map((l) => ({ ...l, msg: JSON.parse(l.text) }))
    .filter(pred);

afterEach(() => vi.useRealTimers());

describe('workerRoomUrl', () => {
  it('turns https into wss and adds role, peer and proto=1', () => {
    expect(workerRoomUrl(BASE, { workerRoom: 'rabc', role: 'guest', selfId: G1 })).toBe(
      `wss://sprinkle-kart-signal.example.workers.dev/room/rabc?role=guest&peer=${G1}&proto=1`,
    );
    expect(workerRoomUrl('http://localhost:8793/', { workerRoom: 'r1', role: 'host', selfId: HOST })).toBe(
      `ws://localhost:8793/room/r1?role=host&peer=${HOST}&proto=1`,
    );
    expect(workerRoomUrl('https://x.test/base/?q=1#h', { workerRoom: 'r 2', role: 'host', selfId: HOST })).toBe(
      `wss://x.test/base/room/r%202?role=host&peer=${HOST}&proto=1`,
    );
    expect(() => workerRoomUrl('ftp://x.test', { workerRoom: 'r', role: 'host', selfId: HOST })).toThrow(SignalingError);
  });
});

describe('WorkerSignaling against a fake §4.2 server', () => {
  it('host and guest meet: joined carries TURN iceServers, the guest offers, the host answers, ICE trickles, channels open', async () => {
    const { server, net, mk, ids } = setup();
    const hs = mk();
    const gs = mk();
    const hostT = createWebRtcTransport({ signaling: hs, role: 'host', selfId: HOST });
    const guestT = createWebRtcTransport({ signaling: gs, role: 'guest', selfId: G1 });
    const joins = [];
    hostT.onPeer((e) => joins.push(['host', e.type, e.peerId]));
    guestT.onPeer((e) => joins.push(['guest', e.type, e.peerId]));

    const h = await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    expect(h.iceServers.some((s) => JSON.stringify(s.urls).includes('turns:'))).toBe(true);
    expect(JSON.stringify(h.iceServers)).not.toContain(':53');
    expect(server.urls[0]).toBe(`wss://sprinkle-kart-signal.example.workers.dev/room/${ids.workerRoom}?role=host&peer=${HOST}&proto=1`);
    const g = await gs.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false });
    expect(g.iceServers[1].username).toBe('user2'); // a fresh mint per socket, never shared
    await settle(200);

    expect(joins).toEqual([
      ['guest', 'join', HOST],
      ['host', 'join', G1],
    ]);
    const signals = msgs(server, (l) => l.msg.t === 'signal');
    const offers = signals.filter((l) => l.msg.data.type === 'offer');
    const answers = signals.filter((l) => l.msg.data.type === 'answer');
    expect(offers.map((l) => l.from)).toEqual([G1]); // the guest is always the offerer
    expect(offers[0].msg.to).toBe(HOST);
    expect(answers.map((l) => l.from)).toEqual([HOST]);
    const cands = signals.filter((l) => l.msg.data.type === 'candidate');
    expect(new Set(cands.map((l) => l.from))).toEqual(new Set([HOST, G1]));
    // The pcs use the Worker's TURN servers, and each pc got the other side's candidates.
    const [gpc, hpc] = net.created;
    expect(gpc.config.iceServers).toEqual(g.iceServers);
    expect(hpc.config.iceServers).toEqual(h.iceServers);
    expect(gpc.config.iceTransportPolicy).toBe('all');
    expect(hpc.addedCandidates.length).toBeGreaterThan(0);
    expect(gpc.addedCandidates.length).toBeGreaterThan(0);
    // Data flows on the negotiated channels.
    const got = [];
    hostT.onMessage((p, ch, b) => got.push([p, ch, b[0]]));
    guestT.send(HOST, 'ctrl', new Uint8Array([0x21]));
    await settle();
    expect(got).toEqual([[G1, 'ctrl', 0x21]]);
    expect(hs.stats()).toMatchObject({ joined: true, peers: 1 });
    hostT.close();
    guestT.close();
  });

  it('relayOnly is a parameter: pcs get iceTransportPolicy relay', async () => {
    const { net, mk, ids } = setup();
    const hs = mk();
    const gs = mk();
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: true });
    await gs.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: true });
    await settle(100);
    expect(net.created.map((p) => p.config.iceTransportPolicy)).toEqual(['relay', 'relay']);
    await hs.leave();
    await gs.leave();
  });

  it('falls back to the caller iceServers when joined has none (no TURN set up)', async () => {
    const { mk, ids } = setup({ turn: false });
    const hs = mk();
    const r = await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    expect(r.iceServers).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);
    await hs.leave();
  });

  it('ICE restart: on failed the guest refreshes ICE, sets the configuration and sends one iceRestart offer', async () => {
    const { server, net, mk, ids, tick } = setup();
    const hs = mk();
    const gs = mk();
    const hostT = createWebRtcTransport({ signaling: hs, role: 'host', selfId: HOST });
    const guestT = createWebRtcTransport({ signaling: gs, role: 'guest', selfId: G1 });
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    await gs.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false });
    await settle(200);
    const [gpc] = net.created;
    tick(WORKER_ICE_MIN_INTERVAL_MS + 1);
    const mintsBefore = server.mints;
    net.fail(gpc);
    await settle(300);
    expect(msgs(server, (l) => l.msg.t === 'ice').map((l) => l.from)).toEqual([G1]);
    expect(server.mints).toBe(mintsBefore + 1);
    expect(gpc.restarts).toBe(1);
    expect(gpc.restartIceCalls).toBe(1);
    expect(gpc.config.iceServers[1].username).toBe(`user${server.mints}`);
    const offers = msgs(server, (l) => l.msg.t === 'signal' && l.msg.data.type === 'offer');
    expect(offers).toHaveLength(2);
    expect(offers[1].msg.data.sdp).toContain(`a=ice-ufrag:u${gpc.id}r1`);
    expect(gpc.connectionState).toBe('connected');
    expect(hostT.peers()).toEqual([G1]);
    expect(gs.stats().restarts).toBe(1);
    // Only ONE restart per pc: a second failure is left to the transport's grace timer.
    net.fail(gpc);
    await settle(300);
    expect(gpc.restarts).toBe(1);
    hostT.close();
    guestT.close();
  });

  it('refreshIce() is rate-limited to 1 per 30 s per socket and times out to the cached servers', async () => {
    vi.useFakeTimers();
    const { server, mk, ids, tick } = setup();
    const hs = mk({ timers: globalThis });
    const first = (await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false })).iceServers;
    expect(await hs.refreshIce()).toBe(first); // right after joined: cached
    tick(WORKER_ICE_MIN_INTERVAL_MS);
    const p1 = hs.refreshIce();
    const p2 = hs.refreshIce(); // concurrent callers share one request
    await vi.advanceTimersByTimeAsync(0);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    expect(a[1].username).toBe('user2');
    expect(msgs(server, (l) => l.msg.t === 'ice')).toHaveLength(1);
    // A silent Worker: fall back to the cached servers after 5 s.
    server.silentIce = true;
    tick(WORKER_ICE_MIN_INTERVAL_MS);
    const p3 = hs.refreshIce();
    await vi.advanceTimersByTimeAsync(WORKER_ICE_TIMEOUT_MS);
    expect(await p3).toBe(a);
    await hs.leave();
    // After leave: resolves with the last servers without a socket.
    expect(await hs.refreshIce()).toBe(a);
  });

  it('host restartIce() sends a restart-request and the guest restarts', async () => {
    const { server, net, mk, ids, tick } = setup();
    const hs = mk();
    const gs = mk();
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    await gs.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false });
    await settle(200);
    tick(WORKER_ICE_MIN_INTERVAL_MS + 1);
    expect(await hs.restartIce(G1)).toBe(true);
    await settle(300);
    expect(msgs(server, (l) => l.msg.t === 'signal' && l.msg.data.type === 'restart-request').map((l) => l.from)).toEqual([HOST]);
    expect(net.created[0].restarts).toBe(1);
    expect(await hs.restartIce('ffffffffffffffff')).toBe(false);
    await hs.leave();
    await gs.leave();
  });

  it('drop(): tells the Worker, closes the pc and emits onPeerLeave', async () => {
    const { server, net, mk, ids } = setup();
    const hs = mk();
    const gs = mk();
    const leaves = [];
    const gLeaves = [];
    hs.onPeerLeave((p, info) => leaves.push([p, info.kind]));
    gs.onPeerLeave((p) => gLeaves.push(p));
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    await gs.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false });
    await settle(200);
    hs.drop(G1);
    await settle(50);
    expect(msgs(server, (l) => l.msg.t === 'drop').map((l) => l.msg)).toEqual([{ t: 'drop', peer: G1 }]);
    expect(leaves).toEqual([[G1, 'worker']]);
    expect(net.created[1].connectionState).toBe('closed');
    // guests cannot drop or lock
    gs.drop(HOST);
    gs.setLocked(true);
    await settle(20);
    expect(msgs(server, (l) => l.from === G1 && (l.msg.t === 'drop' || l.msg.t === 'lock'))).toEqual([]);
    await hs.leave();
    await gs.leave();
  });

  it('setLocked(true) refuses new guests with "locked"; unlocking lets them in again', async () => {
    const { mk, ids } = setup();
    const hs = mk();
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    hs.setLocked(true);
    await settle(20);
    const g = mk();
    await expect(g.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false })).rejects.toMatchObject({ code: 'locked', kind: 'worker' });
    hs.setLocked(false);
    await settle(20);
    await expect(g.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false })).resolves.toBeTruthy();
    await hs.leave();
    await g.leave();
  });

  it('host leaving → the guest gets onPeerLeave(host); the guest leaving → the host does', async () => {
    const { mk, ids } = setup();
    const hs = mk();
    const gs = mk();
    const hl = [];
    const gl = [];
    hs.onPeerLeave((p) => hl.push(p));
    gs.onPeerLeave((p) => gl.push(p));
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    await gs.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false });
    await settle(200);
    await gs.leave();
    await settle(30);
    expect(hl).toEqual([G1]);
    const gs2 = mk();
    gs2.onPeerLeave((p) => gl.push(p));
    await gs2.join({ ids, role: 'guest', selfId: G2, iceServers: STUN, relayOnly: false });
    await settle(200);
    await hs.leave();
    await settle(30);
    expect(gl).toEqual([HOST]);
    await gs2.leave();
  });

  it('ignores junk: non-JSON, unknown types, signals from strangers, offers sent to a guest', async () => {
    const { server, net, mk, ids } = setup();
    const hs = mk();
    const gs = mk();
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    await gs.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false });
    await settle(200);
    const gsock = [...server.sockets].find((s) => s.meta.peer === G1);
    const push = (data) => gsock._fire('message', { data });
    push('not json');
    push('"a string"');
    push(JSON.stringify({ t: 'mystery' }));
    push(JSON.stringify({ t: 'signal', from: G2, data: { type: 'offer', sdp: 'x' } })); // not the host
    push(JSON.stringify({ t: 'signal', from: HOST, data: { type: 'offer', sdp: 'x' } })); // host never offers
    push(JSON.stringify({ t: 'signal', from: 'bad id', data: {} }));
    push(JSON.stringify({ t: 'error', code: 'rate' })); // after joined: logged only
    await settle(50);
    expect(net.created).toHaveLength(2);
    expect(gs.stats().errors).toEqual(['rate']);
    await hs.leave();
    await gs.leave();
  });

  it('never sends a message over 16 KiB (an absurd SDP is dropped, not sent)', async () => {
    const { server, net, ids } = setup();
    class HugeSdpPc extends net.RTCPeerConnection {
      async createOffer(o) {
        const offer = await super.createOffer(o);
        return { type: 'offer', sdp: offer.sdp + 'a=x-pad:' + 'x'.repeat(17000) };
      }
    }
    const mkS = (Impl) => createWorkerSignaling({ baseUrl: BASE, WebSocketImpl: server.WebSocket, RTCPeerConnectionImpl: Impl });
    const hs = mkS(net.RTCPeerConnection);
    const gs = mkS(HugeSdpPc);
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    await gs.join({ ids, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false });
    await settle(100);
    expect(server.log.every((l) => l.text.length <= 16 * 1024)).toBe(true);
    expect(msgs(server, (l) => l.msg.t === 'signal' && l.msg.data.type === 'offer')).toEqual([]);
    await hs.leave();
    await gs.leave();
  });

  it('keeps the socket alive with "ping" every 25 s (pong is ignored)', async () => {
    vi.useFakeTimers();
    const { server, mk, ids } = setup();
    const hs = mk({ timers: globalThis });
    await hs.join({ ids, role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    await vi.advanceTimersByTimeAsync(WORKER_PING_MS * 2);
    expect(server.log.filter((l) => l.text === 'ping')).toHaveLength(2);
    await hs.leave();
    await vi.advanceTimersByTimeAsync(WORKER_PING_MS * 2);
    expect(server.log.filter((l) => l.text === 'ping')).toHaveLength(2);
  });
});

describe('WorkerSignaling error codes → SignalingError', () => {
  const join = (s, ids, role, selfId) => s.join({ ids, role, selfId, iceServers: STUN, relayOnly: false });

  it('host-exists, no-host, full', async () => {
    const { mk, ids } = setup();
    await expect(join(mk(), ids, 'guest', G1)).rejects.toMatchObject({ name: 'SignalingError', code: 'no-host' });
    const hs = mk();
    await join(hs, ids, 'host', HOST);
    await expect(join(mk(), ids, 'host', 'aaaaaaaaaaaaaaaa')).rejects.toMatchObject({ code: 'host-exists' });
    const guests = [];
    for (let i = 0; i < 7; i++) {
      const g = mk();
      guests.push(g);
      await join(g, ids, 'guest', `${i}`.repeat(16));
    }
    await expect(join(mk(), ids, 'guest', 'eeeeeeeeeeeeeeee')).rejects.toMatchObject({ code: 'full' });
    for (const g of guests) await g.leave();
    await hs.leave();
  });

  it.each([
    ['rate', { rate: true }, 'rate'],
    ['bad-origin', { badOrigin: true }, 'bad-origin'],
    ['proto', { forceError: 'proto' }, 'unreachable'],
    ['locked', { forceError: 'locked' }, 'locked'],
    ['unknown', { forceError: 'teapot' }, 'unreachable'],
  ])('%s', async (_name, opts, code) => {
    const { mk, ids } = setup(opts);
    const err = await join(mk(), ids, 'host', HOST).catch((e) => e);
    expect(err).toBeInstanceOf(SignalingError);
    expect(err.code).toBe(code);
    if (_name === 'proto') expect(err.detail).toBe('proto');
  });

  it('Worker down → unreachable; a failed join can be retried', async () => {
    const { server, mk, ids } = setup({ down: true });
    const s = mk();
    await expect(join(s, ids, 'host', HOST)).rejects.toMatchObject({ code: 'unreachable' });
    server.down = false;
    await expect(join(s, ids, 'host', HOST)).resolves.toBeTruthy();
    await expect(join(s, ids, 'host', HOST)).rejects.toMatchObject({ detail: 'already-joined' });
    await s.leave();
  });

  it('a Worker that never answers → timeout after 10 s', async () => {
    vi.useFakeTimers();
    const { mk, ids } = setup({ silent: true });
    const s = mk({ timers: globalThis });
    const p = join(s, ids, 'guest', G1).catch((e) => e);
    await vi.advanceTimersByTimeAsync(WORKER_JOIN_TIMEOUT_MS);
    expect((await p).code).toBe('timeout');
  });

  it('no WebSocket implementation / a constructor that throws → unreachable', async () => {
    const ids = fakeRoomIds('x');
    const s1 = createWorkerSignaling({ baseUrl: BASE, WebSocketImpl: null });
    await expect(join(s1, ids, 'host', HOST)).rejects.toMatchObject({ code: 'unreachable', detail: 'no-websocket' });
    const s2 = createWorkerSignaling({
      baseUrl: BASE,
      WebSocketImpl: class {
        constructor() {
          throw new Error('blocked');
        }
      },
    });
    await expect(join(s2, ids, 'host', HOST)).rejects.toMatchObject({ code: 'unreachable' });
    const s3 = createWorkerSignaling({ baseUrl: 'ftp://nope', WebSocketImpl: class {} });
    await expect(join(s3, ids, 'host', HOST)).rejects.toMatchObject({ code: 'unreachable', detail: 'bad-url' });
  });
});
