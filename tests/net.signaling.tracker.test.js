/**
 * PublicSignaling end to end in node: the REAL Trystero 0.25.4 torrent strategy (two isolated
 * copies, one per "machine", because Trystero keeps a module-level selfId) talking to
 * scripts/dev/localTracker.mjs over real WebSockets, with the fake RTCPeerConnection for the
 * media layer. Never contacts a public relay.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startLocalTracker, MiniWebSocket, encodeFrame, createFrameParser } from '../scripts/dev/localTracker.mjs';
import { createPublicSignaling } from '../src/net/signaling/public.js';
import { createWebRtcTransport } from '../src/net/transport/webrtc.js';
import { createFakeRtcNetwork, fakeRoomIds } from './helpers/netFakeRtc.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'aaaaaaaaaaaaaaaa';
const G1 = 'bbbbbbbbbbbbbbbb';
const G2 = 'cccccccccccccccc';

const waitFor = async (fn, ms = 15000, step = 20) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return fn();
};

describe('localTracker framing', () => {
  it('encodes and parses small, 16-bit, 64-bit, masked and fragmented frames', () => {
    const got = [];
    const parse = createFrameParser((m) => got.push([m.opcode, m.payload.length, m.payload.subarray(0, 3).toString()]));
    parse(encodeFrame(0x1, 'hey'));
    parse(encodeFrame(0x1, 'x'.repeat(300), true));
    const big = encodeFrame(0x2, Buffer.alloc(70000, 65));
    parse(big.subarray(0, 5)); // split across chunks
    parse(big.subarray(5));
    // fragmented text: FIN=0 text + FIN=1 continuation
    const a = encodeFrame(0x1, 'abc');
    a[0] &= 0x7f;
    const b = encodeFrame(0x0, 'def');
    parse(Buffer.concat([a, b]));
    expect(got).toEqual([
      [1, 3, 'hey'],
      [1, 300, 'xxx'],
      [2, 70000, 'AAA'],
      [1, 6, 'abc'],
    ]);
    const errs = [];
    const p2 = createFrameParser(() => {}, (e) => errs.push(e.message));
    const huge = Buffer.alloc(10);
    huge[0] = 0x82;
    huge[1] = 127;
    huge.writeBigUInt64BE(BigInt(1 << 30), 2);
    p2(huge);
    expect(errs).toEqual(['frame too large']);
  });
});

describe('localTracker protocol (MiniWebSocket client)', () => {
  let tracker;
  beforeAll(async () => {
    tracker = await startLocalTracker();
  });
  afterAll(async () => {
    await tracker.close();
  });

  const open = (url) =>
    new Promise((resolve, reject) => {
      const ws = new MiniWebSocket(url);
      ws.inbox = [];
      ws.onmessage = (e) => ws.inbox.push(JSON.parse(e.data));
      ws.onopen = () => resolve(ws);
      ws.onerror = reject;
    });

  it('forwards offers to other swarm members and answers back to the offerer', async () => {
    const a = await open(tracker.url);
    const b = await open(tracker.url);
    const hash = 'h'.repeat(20);
    a.send(JSON.stringify({ action: 'announce', info_hash: hash, peer_id: 'A', numwant: 3, offers: [] }));
    await waitFor(() => a.inbox.length === 1);
    expect(a.inbox[0]).toMatchObject({ action: 'announce', info_hash: hash, interval: 10 });
    b.send(JSON.stringify({ action: 'announce', info_hash: hash, peer_id: 'B', numwant: 3, offers: [{ offer_id: 'o1', offer: { type: 'offer', sdp: 'S' } }] }));
    await waitFor(() => a.inbox.length === 2);
    expect(a.inbox[1]).toEqual({ action: 'announce', info_hash: hash, peer_id: 'B', offer_id: 'o1', offer: { type: 'offer', sdp: 'S' } });
    a.send(JSON.stringify({ action: 'announce', info_hash: hash, peer_id: 'A', to_peer_id: 'B', offer_id: 'o1', answer: { type: 'answer', sdp: 'T' } }));
    await waitFor(() => b.inbox.some((m) => m.answer));
    expect(b.inbox.find((m) => m.answer)).toEqual({ action: 'announce', info_hash: hash, peer_id: 'A', offer_id: 'o1', answer: { type: 'answer', sdp: 'T' } });
    a.send(JSON.stringify({ action: 'scrape' }));
    await waitFor(() => a.inbox.some((m) => m.action === 'scrape'));
    a.send('not json');
    expect(tracker.stats()).toMatchObject({ offersForwarded: 1, answersForwarded: 1 });
    a.close();
    b.close();
    await waitFor(() => tracker.stats().open === 0, 3000);
    expect(tracker.stats().swarms).toBe(0);
  });

  it('answers plain HTTP with 426', async () => {
    const res = await fetch(tracker.url.replace('ws:', 'http:'));
    expect(res.status).toBe(426);
  });
});

describe('real Trystero torrent strategy ⇄ localTracker ⇄ PublicSignaling (fake RTC)', () => {
  let tracker;
  let tmp;
  let restoreWs = null;
  const src = join(ROOT, 'node_modules', '@trystero-p2p');

  /** An isolated copy of the Trystero packages = one "machine" with its own selfId. */
  function trysteroCopy(name) {
    const dir = join(tmp, name, 'node_modules', '@trystero-p2p');
    for (const p of ['core', 'torrent', 'nostr']) cpSync(join(src, p), join(dir, p), { recursive: true });
    return (spec) => {
      const pkg = spec.replace('@trystero-p2p/', '');
      if (pkg !== 'torrent' && pkg !== 'nostr') return Promise.reject(new Error(spec));
      return import(pathToFileURL(join(dir, pkg, 'dist', 'index.mjs')).href);
    };
  }

  beforeAll(async () => {
    tracker = await startLocalTracker();
    tmp = mkdtempSync(join(tmpdir(), 'sk-trystero-'));
    if (typeof globalThis.WebSocket === 'undefined') {
      globalThis.WebSocket = /** @type {any} */ (MiniWebSocket);
      restoreWs = () => delete globalThis.WebSocket;
    }
  });
  afterAll(async () => {
    await tracker.close();
    restoreWs?.();
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* Windows may hold a file briefly */
    }
  });

  it('host and two guests meet through the local tracker; guest↔guest is closed; data flows', async () => {
    expect(existsSync(join(src, 'torrent', 'dist', 'index.mjs'))).toBe(true);
    const net = createFakeRtcNetwork();
    const ids = fakeRoomIds('tracker-e2e');
    const machine = (name, role, selfId) => {
      const sig = createPublicSignaling({
        trackers: [tracker.url],
        nostrRelays: ['ws://127.0.0.1:9'], // never reached: fallback disabled below
        fallbackAfterMs: 1e9,
        importer: trysteroCopy(name),
        RTCPeerConnectionImpl: net.RTCPeerConnection,
      });
      const t = createWebRtcTransport({ signaling: sig, role, selfId });
      return { sig, t, join: () => sig.join({ ids, role, selfId, iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], relayOnly: false }) };
    };
    const h = machine('host', 'host', HOST);
    const g1 = machine('g1', 'guest', G1);
    const g2 = machine('g2', 'guest', G2);
    await h.join();
    await g1.join();
    await g2.join();
    const met = await waitFor(() => h.t.peers().length === 2 && g1.t.peers().length === 1 && g2.t.peers().length === 1, 20000);
    expect(met).toBe(true);
    expect(h.t.peers().sort()).toEqual([G1, G2]);
    expect(g1.t.peers()).toEqual([HOST]);
    expect(g2.t.peers()).toEqual([HOST]);
    // The guests also found each other on the mesh — and closed that pair.
    await waitFor(() => g1.sig.stats().closedNonHost + g2.sig.stats().closedNonHost >= 1, 5000);
    expect(g1.sig.stats().closedNonHost + g2.sig.stats().closedNonHost).toBeGreaterThanOrEqual(1);
    // Real tracker traffic happened (and nothing else was contacted).
    expect(tracker.stats().offersForwarded).toBeGreaterThan(0);
    expect(tracker.stats().answersForwarded).toBeGreaterThan(0);
    const got = [];
    h.t.onMessage((p, ch, b) => got.push([p, ch, b[0]]));
    g1.t.send(HOST, 'ctrl', new Uint8Array([0x22]));
    g2.t.send(HOST, 'state', new Uint8Array([0x01]));
    await waitFor(() => got.length === 2, 3000);
    expect(got.sort()).toEqual([
      [G1, 'ctrl', 0x22],
      [G2, 'state', 0x01],
    ]);
    for (const m of [g1, g2, h]) m.t.close();
    await Promise.all([h.sig.leave(), g1.sig.leave(), g2.sig.leave()]);
  }, 40000);
});
