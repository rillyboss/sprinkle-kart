import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createWebRtcTransport,
  summarizeStats,
  STATE_CHANNEL,
  CTRL_CHANNEL,
  MAX_STATE_BYTES,
  MAX_CTRL_BYTES,
  WIRE_OVERHEAD_BYTES,
  WIRE_OVERHEAD_TURN_BYTES,
  CTRL_QUEUE_HIGH,
  CTRL_LOW_THRESHOLD,
  TURN_RENEW_AFTER_MS,
  ICE_CONNECT_TIMEOUT_MS,
  FAILED_GRACE_MS,
} from '../src/net/transport/webrtc.js';
import { createListeners } from '../src/net/signaling/types.js';
import { createFakeRtcNetwork, settle, connectPair, FAKE_IPS } from './helpers/netFakeRtc.js';

/** Minimal scripted SignalingTransport: the test decides when a pc shows up. */
function fakeSignaling(kind = 'worker') {
  const conn = createListeners();
  const leave = createListeners();
  const sig = {
    kind,
    settled: [],
    refreshCalls: 0,
    restartCalls: [],
    left: 0,
    fresh: [{ urls: 'turn:turn.example.test:3478', username: 'u2', credential: 'c2' }],
    join: async () => ({ iceServers: [] }),
    onPeerConnection: (fn) => conn.add(fn),
    onPeerLeave: (fn) => leave.add(fn),
    drop() {},
    setLocked() {},
    async refreshIce() {
      sig.refreshCalls++;
      return sig.fresh;
    },
    async restartIce(peerId) {
      sig.restartCalls.push(peerId);
      return true;
    },
    settle(peerId, pc, k) {
      sig.settled.push({ peerId, k });
    },
    async leave() {
      sig.left++;
    },
    emit: (peerId, pc, k = kind) => conn.emit({ peerId, pc, kind: k }),
    emitLeave: (peerId, info) => leave.emit(peerId, info),
  };
  return sig;
}

const HOST = 'aaaaaaaaaaaaaaaa';
const GUEST = 'bbbbbbbbbbbbbbbb';

async function makePair(netOpts = {}, extra = {}) {
  const net = createFakeRtcNetwork(netOpts);
  const hs = fakeSignaling();
  const gs = fakeSignaling();
  const host = createWebRtcTransport({ signaling: hs, role: 'host', selfId: HOST, ...extra });
  const guest = createWebRtcTransport({ signaling: gs, role: 'guest', selfId: GUEST, ...extra });
  const events = { host: [], guest: [] };
  host.onPeer((e) => events.host.push(e));
  guest.onPeer((e) => events.guest.push(e));
  const link = async (cfg = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }) => {
    const gpc = new net.RTCPeerConnection(cfg);
    const hpc = new net.RTCPeerConnection(cfg);
    gs.emit(HOST, gpc);
    hs.emit(GUEST, hpc);
    await connectPair(gpc, hpc);
    return { gpc, hpc };
  };
  return { net, hs, gs, host, guest, events, link };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WebRtcTransport: channels and join', () => {
  it('creates negotiated sk-state (id 8, unordered, 0 retransmits) and sk-ctrl (id 9, reliable) with arraybuffer', async () => {
    const { host, guest, link } = await makePair();
    const { gpc, hpc } = await link();
    for (const pc of [gpc, hpc]) {
      const state = pc.channels.find((c) => c.label === 'sk-state');
      const ctrl = pc.channels.find((c) => c.label === 'sk-ctrl');
      expect(state).toMatchObject({ negotiated: true, id: 8, ordered: false, maxRetransmits: 0, binaryType: 'arraybuffer' });
      expect(ctrl).toMatchObject({ negotiated: true, id: 9, ordered: true, maxRetransmits: null, binaryType: 'arraybuffer' });
      expect(ctrl.bufferedAmountLowThreshold).toBe(CTRL_LOW_THRESHOLD);
      expect(state.readyState).toBe('open');
    }
    expect(STATE_CHANNEL.init).toEqual({ negotiated: true, id: 8, ordered: false, maxRetransmits: 0 });
    expect(CTRL_CHANNEL.init).toEqual({ negotiated: true, id: 9, ordered: true });
    expect(host.peers()).toEqual([GUEST]);
    expect(guest.peers()).toEqual([HOST]);
    host.close();
    guest.close();
  });

  it('joins only when BOTH channels are open', async () => {
    const net = createFakeRtcNetwork();
    const hs = fakeSignaling();
    const gs = fakeSignaling();
    const host = createWebRtcTransport({ signaling: hs, role: 'host', selfId: HOST });
    const joins = [];
    host.onPeer((e) => joins.push(e));
    const gpc = new net.RTCPeerConnection({});
    const hpc = new net.RTCPeerConnection({});
    hs.emit(GUEST, hpc);
    // The remote side only creates channel 8 (a broken/old client): 9 never opens.
    gpc.createDataChannel('sk-state', { negotiated: true, id: 8, ordered: false, maxRetransmits: 0 });
    await connectPair(gpc, hpc);
    expect(hpc.channels.find((c) => c.id === 8).readyState).toBe('open');
    expect(hpc.channels.find((c) => c.id === 9).readyState).toBe('connecting');
    expect(joins).toEqual([]);
    expect(host.peers()).toEqual([]);
    // Now channel 9 appears on the remote: join fires.
    gpc.createDataChannel('sk-ctrl', { negotiated: true, id: 9, ordered: true });
    await settle();
    expect(joins).toEqual([{ type: 'join', peerId: GUEST }]);
    host.close();
  });

  it('delivers bytes both ways on both channels as Uint8Array', async () => {
    const { host, guest, link } = await makePair();
    await link();
    const got = [];
    host.onMessage((p, ch, b) => got.push(['host', p, ch, [...b]]));
    guest.onMessage((p, ch, b) => got.push(['guest', p, ch, [...b]]));
    expect(guest.send(HOST, 'state', new Uint8Array([1, 2, 3]))).toBe(true);
    expect(guest.send(HOST, 'ctrl', new Uint8Array([0x20, 9]))).toBe(true);
    host.broadcast('state', new Uint8Array([7]));
    await settle();
    expect(got).toEqual([
      ['host', GUEST, 'state', [1, 2, 3]],
      ['host', GUEST, 'ctrl', [0x20, 9]],
      ['guest', HOST, 'state', [7]],
    ]);
    host.close();
    guest.close();
  });

  it('send never throws and returns false for unknown peers, bad channels, bad payloads and oversize', async () => {
    const { host, guest, link } = await makePair();
    await link();
    expect(host.send('nobody', 'state', new Uint8Array(1))).toBe(false);
    expect(host.send(GUEST, 'video', new Uint8Array(1))).toBe(false);
    expect(host.send(GUEST, 'state', /** @type {any} */ ('text'))).toBe(false);
    expect(host.send(GUEST, 'state', new Uint8Array(0))).toBe(false);
    expect(host.send(GUEST, 'state', new Uint8Array(MAX_STATE_BYTES + 1))).toBe(false);
    expect(host.send(GUEST, 'state', new Uint8Array(MAX_STATE_BYTES))).toBe(true);
    expect(host.send(GUEST, 'ctrl', new Uint8Array(MAX_CTRL_BYTES + 1))).toBe(false);
    const s = host.stats(GUEST);
    expect(s.stateOversize).toBe(2);
    expect(s.ctrlOversize).toBe(1);
    host.close();
    expect(host.send(GUEST, 'ctrl', new Uint8Array(1))).toBe(false);
    guest.close();
  });

  it('drops incoming strings and oversize messages instead of surfacing them', async () => {
    const { host, guest, link } = await makePair();
    const { gpc } = await link();
    const got = [];
    host.onMessage((...a) => got.push(a));
    const st = gpc.channels.find((c) => c.id === 8);
    st.send('not binary');
    st.send(new Uint8Array(MAX_STATE_BYTES + 10));
    await settle();
    expect(got).toEqual([]);
    expect(host.stats(GUEST).dropsIn).toBe(2);
    host.close();
    guest.close();
  });
});

describe('WebRtcTransport: backpressure', () => {
  it('skips a state send when bufferedAmount > max(1024, 2 × last state message) and counts stateSkips', async () => {
    const { host, guest, link } = await makePair();
    const { hpc } = await link();
    const st = hpc.channels.find((c) => c.id === 8);
    // First message 700 B → limit becomes max(1024, 1400) = 1400.
    expect(host.send(GUEST, 'state', new Uint8Array(700))).toBe(true);
    st.bufferedAmount = 1400;
    expect(host.send(GUEST, 'state', new Uint8Array(700))).toBe(true); // == limit is fine
    st.bufferedAmount = 1401;
    expect(host.send(GUEST, 'state', new Uint8Array(700))).toBe(false);
    expect(host.send(GUEST, 'state', new Uint8Array(700))).toBe(false);
    expect(host.stats(GUEST).stateSkips).toBe(2);
    // Small messages: the floor is 1024 B.
    expect(host.send(GUEST, 'state', new Uint8Array(0))).toBe(false); // empty never sent
    st.bufferedAmount = 0;
    expect(host.send(GUEST, 'state', new Uint8Array(100))).toBe(true);
    st.bufferedAmount = 1024;
    expect(host.send(GUEST, 'state', new Uint8Array(100))).toBe(true);
    st.bufferedAmount = 1025;
    expect(host.send(GUEST, 'state', new Uint8Array(100))).toBe(false);
    expect(host.stats(GUEST).stateSkips).toBe(3);
    expect(host.stats(GUEST).bufferedState).toBe(1025);
    host.close();
    guest.close();
  });

  it('queues ctrl above 64 KiB and drains in order on bufferedamountlow (16 KiB threshold)', async () => {
    const { host, guest, link } = await makePair();
    const { hpc } = await link();
    const ctrl = hpc.channels.find((c) => c.id === 9);
    const got = [];
    guest.onMessage((p, ch, b) => got.push(b[0]));
    ctrl.hold = true; // simulate a congested association: nothing leaves until release()
    const big = (tag) => {
      const b = new Uint8Array(16000);
      b[0] = tag;
      return b;
    };
    for (let i = 1; i <= 5; i++) expect(host.send(GUEST, 'ctrl', big(i))).toBe(true); // 80 000 B buffered
    expect(ctrl.bufferedAmount).toBe(80000);
    expect(ctrl.bufferedAmount).toBeGreaterThan(CTRL_QUEUE_HIGH);
    // Now above the high-water mark: further sends queue in the transport, not in SCTP.
    expect(host.send(GUEST, 'ctrl', big(6))).toBe(true);
    expect(host.send(GUEST, 'ctrl', big(7))).toBe(true);
    expect(ctrl.sent).toHaveLength(5);
    const s = host.stats(GUEST);
    expect(s.ctrlQueued).toBe(2);
    expect(s.bufferedCtrl).toBe(80000 + 32000);
    // Draining down to the 16 KiB threshold fires bufferedamountlow → the queue flushes.
    ctrl.hold = false;
    ctrl.release(16000 * 4); // 80 000 → 16 000 (<= 16 384): event fires
    await settle();
    expect(ctrl.sent).toHaveLength(7);
    ctrl.release();
    await settle();
    expect(got).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Even when bufferedAmount is low, a non-empty queue keeps order (no overtaking).
    host.close();
    guest.close();
  });

  it('refuses ctrl sends once the transport-side queue holds 1 MiB', async () => {
    const { host, guest, link } = await makePair();
    const { hpc } = await link();
    const ctrl = hpc.channels.find((c) => c.id === 9);
    ctrl.bufferedAmount = CTRL_QUEUE_HIGH + 1;
    let accepted = 0;
    for (let i = 0; i < 80; i++) if (host.send(GUEST, 'ctrl', new Uint8Array(16000))) accepted++;
    expect(accepted).toBe(65); // 65 × 16 000 = 1 040 000 ≤ 1 MiB; the 66th would overflow
    host.close();
    guest.close();
  });
});

describe('WebRtcTransport: stats (never IPs)', () => {
  it('reports relayed + candidateType + RTT from getStats, and wire bytes = payload + 93', async () => {
    const { host, guest, link } = await makePair({ rttMs: 37 });
    await link();
    await host.pollStats();
    host.send(GUEST, 'state', new Uint8Array(100));
    host.send(GUEST, 'ctrl', new Uint8Array(50));
    await settle();
    const s = host.stats(GUEST);
    expect(s).toMatchObject({ candidateType: 'srflx', relayed: false, rttMs: 37, bytesOut: 150, packetsOut: 2 });
    expect(s.wireBytesOut).toBe(150 + 2 * WIRE_OVERHEAD_BYTES);
    const g = guest.stats(HOST);
    expect(g).toMatchObject({ bytesIn: 150, packetsIn: 2, wireBytesIn: 150 + 2 * 93 });
    const text = JSON.stringify([s, g, host.debug()]);
    for (const ip of FAKE_IPS) expect(text).not.toContain(ip);
    expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(text).not.toContain('turn.example');
    host.close();
    guest.close();
  });

  it('uses the TURN overhead once the pair is relayed', async () => {
    const { host, guest, link } = await makePair({ udpBlocked: true });
    await link({ iceServers: [{ urls: 'turns:turn.example.test:443?transport=tcp', username: 'u', credential: 'c' }] });
    await host.pollStats();
    host.send(GUEST, 'state', new Uint8Array(10));
    expect(host.stats(GUEST)).toMatchObject({ relayed: true, candidateType: 'relay', wireBytesOut: 10 + WIRE_OVERHEAD_TURN_BYTES });
    host.close();
    guest.close();
  });

  it('polls getStats every 5 s', async () => {
    vi.useFakeTimers();
    const { host, guest, link } = await makePair();
    const { hpc } = await link();
    const spy = vi.spyOn(hpc, 'getStats');
    await vi.advanceTimersByTimeAsync(5000);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(spy).toHaveBeenCalledTimes(3);
    host.close();
    guest.close();
  });

  it('summarizeStats keeps only type, relay flag and RTT from any report shape', () => {
    const rep = new Map([
      ['T', { id: 'T', type: 'transport', selectedCandidatePairId: 'P' }],
      ['P', { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', currentRoundTripTime: 0.0555 }],
      ['L', { id: 'L', type: 'local-candidate', candidateType: 'host', address: '10.0.0.2', port: 1 }],
      ['R', { id: 'R', type: 'remote-candidate', candidateType: 'relay', address: '1.2.3.4' }],
    ]);
    expect(summarizeStats(rep)).toEqual({ candidateType: 'host', relayed: true, rttMs: 56 });
    // Firefox-style: no transport entry, a 'selected' pair; object and array reports.
    const ff = {
      a: { id: 'a', type: 'candidate-pair', selected: true, localCandidateId: 'l', remoteCandidateId: 'r' },
      l: { id: 'l', type: 'local-candidate', candidateType: 'relay', ip: '9.9.9.9' },
    };
    expect(summarizeStats(ff)).toEqual({ candidateType: 'relay', relayed: true, rttMs: null });
    expect(summarizeStats(Object.values(ff))).toEqual({ candidateType: 'relay', relayed: true, rttMs: null });
    expect(summarizeStats(null)).toEqual({ candidateType: null, relayed: null, rttMs: null });
    expect(summarizeStats(new Map())).toEqual({ candidateType: null, relayed: null, rttMs: null });
    // An unknown candidate type is not echoed back (it could be anything).
    const weird = new Map([
      ['P', { id: 'P', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L' }],
      ['L', { id: 'L', type: 'local-candidate', candidateType: '10.1.1.1' }],
    ]);
    expect(summarizeStats(weird)).toEqual({ candidateType: null, relayed: null, rttMs: null });
  });

  it('stats() for an unknown peer is all zeros / nulls', () => {
    const t = createWebRtcTransport({ signaling: fakeSignaling(), role: 'host', selfId: HOST });
    expect(t.stats('zzz')).toMatchObject({ rttMs: null, relayed: null, bytesIn: 0, stateSkips: 0, candidateType: null });
    t.close();
  });
});

describe('WebRtcTransport: leaves, duplicates, failures', () => {
  it('emits leave when the remote closes and when disconnect() is called', async () => {
    const { host, guest, events, link } = await makePair();
    await link();
    guest.disconnect(HOST, 'bye'); // the remote machine closes its side
    await settle();
    expect(events.guest.at(-1)).toEqual({ type: 'leave', peerId: HOST, reason: 'bye' });
    expect(events.host).toEqual([
      { type: 'join', peerId: GUEST },
      { type: 'leave', peerId: GUEST, reason: 'channel-closed' },
    ]);
    expect(host.peers()).toEqual([]);
    await link();
    host.disconnect(GUEST, 'removed');
    await settle();
    expect(events.host.at(-1)).toEqual({ type: 'leave', peerId: GUEST, reason: 'removed' });
    expect(events.guest.filter((e) => e.type === 'leave')).toHaveLength(2);
    host.close();
    guest.close();
  });

  it('first pc with both channels open wins; the other pending pc to the same peer is closed; settle() reports the winner', async () => {
    const net = createFakeRtcNetwork();
    const gs = fakeSignaling('worker');
    const hsW = fakeSignaling('worker');
    const guest = createWebRtcTransport({ signaling: gs, role: 'guest', selfId: GUEST });
    const host = createWebRtcTransport({ signaling: hsW, role: 'host', selfId: HOST });
    const hostJoins = [];
    host.onPeer((e) => hostJoins.push(e));
    // Two paths: 'worker' pcs and 'public' pcs, both pending.
    const gW = new net.RTCPeerConnection({});
    const hW = new net.RTCPeerConnection({});
    const gP = new net.RTCPeerConnection({});
    const hP = new net.RTCPeerConnection({});
    gs.emit(HOST, gW, 'worker');
    gs.emit(HOST, gP, 'public');
    hsW.emit(GUEST, hW, 'worker');
    hsW.emit(GUEST, hP, 'public');
    await connectPair(gP, hP); // public opens first
    expect(guest.peers()).toEqual([HOST]);
    expect(gs.settled).toEqual([{ peerId: HOST, k: 'public' }]);
    expect(gW.connectionState).toBe('closed');
    expect(hW.connectionState).toBe('closed');
    expect(hostJoins).toEqual([{ type: 'join', peerId: GUEST }]);
    // A late duplicate for a joined peer is closed at once.
    const late = new net.RTCPeerConnection({});
    hsW.emit(GUEST, late, 'worker');
    expect(late.connectionState).toBe('closed');
    // A leave from the matchmaker that does NOT own the live connection is ignored.
    hsW.emitLeave(GUEST, { kind: 'worker' });
    expect(host.peers()).toEqual([GUEST]);
    hsW.emitLeave(GUEST, { kind: 'public' });
    expect(host.peers()).toEqual([]);
    host.close();
    guest.close();
  });

  it('ICE timeout (15 s) closes a pc that never opens and reports onFailure', async () => {
    vi.useFakeTimers();
    const net = createFakeRtcNetwork({ connectable: false });
    const sig = fakeSignaling();
    const t = createWebRtcTransport({ signaling: sig, role: 'guest', selfId: GUEST });
    const fails = [];
    t.onFailure((f) => fails.push(f));
    const pc = new net.RTCPeerConnection({});
    sig.emit(HOST, pc);
    await vi.advanceTimersByTimeAsync(ICE_CONNECT_TIMEOUT_MS - 1);
    expect(fails).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fails).toEqual([{ peerId: HOST, reason: 'ice-timeout' }]);
    expect(pc.connectionState).toBe('closed');
    t.close();
  });

  it('a joined pc that stays failed for 10 s is dropped; recovering in time keeps it', async () => {
    vi.useFakeTimers();
    const { net, host, guest, events, link } = await makePair();
    const { hpc } = await link();
    net.fail(hpc);
    await vi.advanceTimersByTimeAsync(FAILED_GRACE_MS - 100);
    hpc._setConn('connected');
    hpc._remote._setConn('connected');
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.peers()).toEqual([GUEST]);
    net.fail(hpc);
    await vi.advanceTimersByTimeAsync(FAILED_GRACE_MS);
    expect(events.host.at(-1)).toEqual({ type: 'leave', peerId: GUEST, reason: 'failed' });
    host.close();
    guest.close();
  });

  it('ignores pcs for itself, empty ids, and pcs that arrive after close()', async () => {
    const net = createFakeRtcNetwork();
    const sig = fakeSignaling();
    const t = createWebRtcTransport({ signaling: sig, role: 'host', selfId: HOST });
    const own = new net.RTCPeerConnection({});
    sig.emit(HOST, own);
    sig.emit('', new net.RTCPeerConnection({}));
    expect(own.channels).toHaveLength(0);
    t.close();
    await settle();
    expect(sig.left).toBe(1);
    const after = new net.RTCPeerConnection({});
    sig.emit(GUEST, after); // listener removed on close: nothing happens
    expect(after.channels).toHaveLength(0);
    t.close(); // idempotent
  });

  it('a pc whose createDataChannel throws is closed and reported', async () => {
    const sig = fakeSignaling();
    const t = createWebRtcTransport({ signaling: sig, role: 'host', selfId: HOST });
    const fails = [];
    t.onFailure((f) => fails.push(f));
    let closedPc = false;
    const pc = {
      createDataChannel() {
        throw new Error('nope');
      },
      close() {
        closedPc = true;
      },
    };
    sig.emit(GUEST, pc);
    expect(closedPc).toBe(true);
    expect(fails).toEqual([{ peerId: GUEST, reason: 'channel-error' }]);
    t.close();
  });

  it('rejects bad construction', () => {
    expect(() => createWebRtcTransport({ signaling: fakeSignaling(), role: 'boss', selfId: HOST })).toThrow();
    expect(() => createWebRtcTransport({ role: 'host', selfId: HOST })).toThrow();
  });
});

describe('WebRtcTransport: TURN renewal', () => {
  it('renews only relayed pcs, only after 20 min since the last mint, with setConfiguration + ICE restart', async () => {
    let clock = 0;
    const { host, guest, hs, link } = await makePair({ udpBlocked: true }, { now: () => clock });
    const { hpc } = await link({ iceServers: [{ urls: 'turns:turn.example.test:443?transport=tcp', username: 'u', credential: 'c' }] });
    clock = TURN_RENEW_AFTER_MS - 1;
    expect(await host.renewIceIfRelayed()).toBe(0);
    expect(hs.refreshCalls).toBe(0);
    clock = TURN_RENEW_AFTER_MS;
    expect(await host.renewIceIfRelayed()).toBe(1);
    expect(hs.refreshCalls).toBe(1);
    expect(hs.restartCalls).toEqual([GUEST]);
    expect(hpc.getConfiguration().iceServers).toEqual(hs.fresh);
    expect(host.lastIceMintAt).toBe(TURN_RENEW_AFTER_MS);
    expect(host.iceServers).toEqual(hs.fresh);
    // Right after a renewal nothing happens until another 20 min pass.
    clock += 60_000;
    expect(await host.renewIceIfRelayed()).toBe(0);
    expect(await host.renewIceIfRelayed({ force: true })).toBe(1);
    host.close();
    guest.close();
  });

  it('does nothing for direct (srflx) pairs or when refreshIce fails', async () => {
    let clock = 0;
    const { host, guest, hs, link } = await makePair({}, { now: () => clock });
    await link();
    clock = TURN_RENEW_AFTER_MS * 2;
    expect(await host.renewIceIfRelayed()).toBe(0);
    expect(hs.refreshCalls).toBe(0);
    host.close();
    guest.close();
    const r = await makePair({ udpBlocked: true }, { now: () => clock });
    await r.link({ iceServers: [{ urls: 'turns:t.example.test:443', username: 'u', credential: 'c' }] });
    r.hs.refreshIce = async () => {
      throw new Error('down');
    };
    expect(await r.host.renewIceIfRelayed({ force: true })).toBe(0);
    r.hs.refreshIce = async () => [];
    expect(await r.host.renewIceIfRelayed({ force: true })).toBe(0);
    r.host.close();
    r.guest.close();
  });
});

describe('constants match WS2 src/net/constants.js when it exists', () => {
  it('MAX_STATE_BYTES / MAX_CTRL_BYTES / WIRE_OVERHEAD_BYTES', async () => {
    let c = null;
    try {
      c = await import(/* @vite-ignore */ '../src/net/' + 'constants.js');
    } catch {
      return; // WS2 not merged yet
    }
    if (c.MAX_STATE_BYTES !== undefined) expect(c.MAX_STATE_BYTES).toBe(MAX_STATE_BYTES);
    if (c.MAX_CTRL_BYTES !== undefined) expect(c.MAX_CTRL_BYTES).toBe(MAX_CTRL_BYTES);
    if (c.WIRE_OVERHEAD_BYTES !== undefined) expect(c.WIRE_OVERHEAD_BYTES).toBe(WIRE_OVERHEAD_BYTES);
    if (c.WIRE_OVERHEAD_TURN_BYTES !== undefined) expect(c.WIRE_OVERHEAD_TURN_BYTES).toBe(WIRE_OVERHEAD_TURN_BYTES);
  });
});
