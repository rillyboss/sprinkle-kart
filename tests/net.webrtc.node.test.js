/**
 * Optional REAL WebRTC in node (NETWORKING.md §15): two WebRtcTransports over an in-process
 * signaling pair, using node-datachannel's RTCPeerConnection polyfill (libdatachannel).
 *
 * node-datachannel is deliberately NOT a dependency (a native binary must never be able to
 * break `npm ci`). To run this file locally:
 *   npm install --no-save node-datachannel@0.33.4 && npx vitest run tests/net.webrtc.node.test.js
 * Without it (the normal case, and CI) every test here is skipped with a clear message.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createWebRtcTransport, MAX_STATE_BYTES } from '../src/net/transport/webrtc.js';
import { createListeners } from '../src/net/signaling/types.js';

let Polyfill = null;
let skipReason = '';
try {
  const mod = await import(/* @vite-ignore */ 'node-datachannel' + '/polyfill');
  Polyfill = mod.RTCPeerConnection ?? mod.default?.RTCPeerConnection ?? null;
  if (!Polyfill) skipReason = 'node-datachannel/polyfill has no RTCPeerConnection export';
} catch (e) {
  skipReason = `node-datachannel not installed or its binary would not load (${String(e?.message || e).split('\n')[0]})`;
}
if (!Polyfill) console.info(`[net.webrtc.node] SKIPPED: ${skipReason}. Optional; see the header of this file.`);

const HOST = 'aaaaaaaaaaaaaaaa';
const GUEST = 'bbbbbbbbbbbbbbbb';

/**
 * In-process signaling pair: the guest offers (like WorkerSignaling), trickle ICE both ways,
 * with a placeholder negotiated channel so the offer carries SCTP.
 */
function signalingPair(Pc) {
  const mk = () => {
    const conn = createListeners();
    const leave = createListeners();
    return {
      kind: 'worker',
      conn,
      leave,
      pcs: [],
      join: async () => ({ iceServers: [] }),
      onPeerConnection: (fn) => conn.add(fn),
      onPeerLeave: (fn) => leave.add(fn),
      drop() {},
      setLocked() {},
      refreshIce: async () => [],
      leave: async () => {},
    };
  };
  const hs = mk();
  const gs = mk();
  const start = async () => {
    const gpc = new Pc({ iceServers: [] });
    const hpc = new Pc({ iceServers: [] });
    hs.pcs.push(hpc);
    gs.pcs.push(gpc);
    gpc.createDataChannel('sk-boot', { negotiated: true, id: 7 });
    gpc.onicecandidate = (e) => e.candidate && hpc.addIceCandidate(e.candidate).catch(() => {});
    hpc.onicecandidate = (e) => e.candidate && gpc.addIceCandidate(e.candidate).catch(() => {});
    hs.conn.emit({ peerId: GUEST, pc: hpc, kind: 'worker' });
    gs.conn.emit({ peerId: HOST, pc: gpc, kind: 'worker' });
    const offer = await gpc.createOffer();
    await gpc.setLocalDescription(offer);
    await hpc.setRemoteDescription(gpc.localDescription);
    const answer = await hpc.createAnswer();
    await hpc.setLocalDescription(answer);
    await gpc.setRemoteDescription(hpc.localDescription);
  };
  return { hs, gs, start };
}

const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return fn();
};

const open = [];
afterAll(async () => {
  for (const t of open) t.close();
  await new Promise((r) => setTimeout(r, 50));
});

describe.skipIf(!Polyfill)('WebRtcTransport over real node-datachannel', () => {
  async function pair() {
    const { hs, gs, start } = signalingPair(Polyfill);
    const host = createWebRtcTransport({ signaling: hs, role: 'host', selfId: HOST });
    const guest = createWebRtcTransport({ signaling: gs, role: 'guest', selfId: GUEST });
    open.push(host, guest);
    await start();
    expect(await waitFor(() => host.peers().length === 1 && guest.peers().length === 1)).toBe(true);
    return { host, guest, hs, gs };
  }

  it('negotiated channels 8 (unordered, 0 retransmits) and 9 (reliable) open on both sides', async () => {
    const { host, guest } = await pair();
    expect(host.peers()).toEqual([GUEST]);
    expect(guest.peers()).toEqual([HOST]);
    const got = [];
    host.onMessage((p, ch, b) => got.push([ch, b.length]));
    expect(guest.send(HOST, 'state', new Uint8Array(MAX_STATE_BYTES))).toBe(true);
    expect(guest.send(HOST, 'ctrl', new Uint8Array(16384))).toBe(true);
    expect(await waitFor(() => got.length === 2)).toBe(true);
    expect(got.sort()).toEqual([
      ['ctrl', 16384],
      ['state', MAX_STATE_BYTES],
    ]);
  });

  it('a burst on the unreliable channel never blocks or reorders ctrl', async () => {
    const { host, guest } = await pair();
    const ctrl = [];
    let states = 0;
    host.onMessage((p, ch, b) => {
      if (ch === 'ctrl') ctrl.push(b[0] | (b[1] << 8));
      else states++;
    });
    let skipped = 0;
    for (let i = 0; i < 400; i++) {
      if (!guest.send(HOST, 'state', new Uint8Array(1100))) skipped++;
      if (i % 4 === 0) guest.send(HOST, 'ctrl', new Uint8Array([(i / 4) & 255, (i / 4) >> 8]));
    }
    expect(await waitFor(() => ctrl.length === 100)).toBe(true);
    expect(ctrl).toEqual([...Array(100).keys()]); // every ctrl message, in order
    expect(states + skipped).toBeLessThanOrEqual(400);
    expect(guest.stats(HOST).stateSkips).toBe(skipped); // backpressure counted with a real bufferedAmount
  });

  it('stats come from real getStats without IPs', async () => {
    const { host } = await pair();
    await host.pollStats();
    const s = host.stats(GUEST);
    expect(JSON.stringify(s)).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(['host', 'srflx', 'prflx', 'relay', null]).toContain(s.candidateType);
  });
});

describe.skipIf(!!Polyfill)('WebRtcTransport over real node-datachannel (skipped)', () => {
  it('is skipped because node-datachannel is not available', () => {
    expect(skipReason).not.toBe('');
  });
});
