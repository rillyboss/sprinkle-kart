import { describe, it, expect, vi, afterEach } from 'vitest';
import { runConnectionCheck, describeCheck, parseCandidate, gatherCandidateTypes, SLOW_MS } from '../src/net/diagnose.js';
import { createFakeRtcNetwork, FAKE_IPS } from './helpers/netFakeRtc.js';
import { createFakeWorkerServer } from './helpers/netFakeWorker.js';

const SIGNAL_URL = 'https://sprinkle-kart-signal.example.workers.dev';
const TRACKERS = ['wss://tracker-a.test', 'wss://tracker-b.test', 'wss://tracker-c.test'];

/** Fake tracker sockets: urls in `up` open, others error. Never a real network. */
function fakeTrackerSockets(up = new Set(TRACKERS)) {
  const opened = [];
  return class {
    constructor(url) {
      this.url = url;
      opened.push(url);
      queueMicrotask(() => (up.has(url) ? this.onopen?.({}) : this.onerror?.({})));
    }
    close() {}
    static opened = opened;
  };
}

const BANNED = /\b(hit|kill|crash|destroy|die|dead|fail|failed|failure|error|blocked|broken|attack|hate|stupid|scary)\b/i;
const IPV4 = /\b\d{1,3}(\.\d{1,3}){3}\b/;

function assertSafe(desc, raw) {
  const text = JSON.stringify(desc);
  for (const ip of FAKE_IPS) expect(text).not.toContain(ip);
  expect(text).not.toMatch(IPV4);
  expect(text).not.toMatch(/turn\.example|username|credential|user\d|cred\d/);
  for (const row of desc.rows) {
    expect(row.text).not.toMatch(BANNED);
    expect(row.grownUps.startsWith('For grown-ups: ')).toBe(true);
  }
  expect(desc.hint).not.toMatch(BANNED);
  if (raw) {
    const rawText = JSON.stringify(raw);
    for (const ip of FAKE_IPS) expect(rawText).not.toContain(ip);
    expect(rawText).not.toMatch(IPV4);
  }
}

async function check(opts) {
  const net = opts.net ?? createFakeRtcNetwork(opts.netOpts);
  const server = opts.server ?? createFakeWorkerServer(opts.serverOpts);
  const raw = await runConnectionCheck({
    signalUrl: opts.signalUrl === undefined ? SIGNAL_URL : opts.signalUrl,
    fetchImpl: server.fetch,
    RTCPeerConnectionImpl: net.RTCPeerConnection,
    WebSocketImpl: opts.WebSocketImpl ?? fakeTrackerSockets(),
    trackers: TRACKERS,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const desc = describeCheck(raw);
  assertSafe(desc, raw);
  return { raw, desc, server, net };
}

afterEach(() => vi.useRealTimers());

describe('Check connection: runConnectionCheck + describeCheck', () => {
  it('Worker build, everything fine: server ✅, direct ✅, relay ✅', async () => {
    const { raw, desc, server } = await check({});
    expect(raw.matchmaker).toMatchObject({ kind: 'worker', status: 'reachable', workerOk: true, turnConfigured: true, trackers: null });
    expect(raw.direct).toMatchObject({ status: 'yes', types: ['host', 'srflx'] });
    expect(raw.relay).toMatchObject({ status: 'ready', turn: true, types: ['relay'] });
    expect(server.fetchLog).toEqual([`${SIGNAL_URL}/health`, `${SIGNAL_URL}/ice`]);
    expect(desc.rows.map((r) => [r.id, r.icon])).toEqual([
      ['matchmaker', '✅'],
      ['direct', '✅'],
      ['relay', '✅'],
    ]);
    expect(desc.matchmaker.text).toContain('Sprinkle Kart server');
    expect(desc.direct.text).toContain('Direct connection works');
    expect(desc.relay.text).toContain('Relay ready');
    expect(desc.direct.grownUps).toContain('candidate types host, srflx');
    expect(desc.ok).toBe(true);
    expect(desc.hint).toMatch(/ready to race/);
  });

  it('UDP blocked (school Chromebook): Direct ❌ "Relay needed", Relay ✅ via TURN over TLS 443', async () => {
    const { raw, desc } = await check({ netOpts: { udpBlocked: true } });
    expect(raw.direct.status).toBe('no');
    expect(raw.direct.types).not.toContain('srflx');
    expect(desc.direct.icon).toBe('❌');
    expect(desc.direct.text).toContain('Relay needed');
    expect(raw.relay.status).toBe('ready');
    expect(raw.relay.relayProtocols).toEqual(['tls']);
    expect(desc.relay.icon).toBe('✅');
    expect(desc.relay.grownUps).toContain('relay over tls');
    expect(desc.ok).toBe(true);
  });

  it('UDP blocked on a public-only build: Direct ❌ Relay needed, Relay not set up, hint points at the grown-up setup', async () => {
    const { raw, desc } = await check({ signalUrl: null, netOpts: { udpBlocked: true } });
    expect(raw.matchmaker).toMatchObject({ kind: 'public', status: 'reachable', trackers: { reachable: 3, total: 3 } });
    expect(desc.matchmaker.text).toContain('Public relays');
    expect(desc.direct.text).toContain('Relay needed');
    expect(raw.relay).toMatchObject({ status: 'not-set-up', reason: 'no-worker' });
    expect(desc.relay.icon).toBe('⚠️');
    expect(desc.relay.grownUps).toContain('INFRA_SETUP');
    expect(desc.ok).toBe(false);
    expect(desc.hint).toMatch(/grown-up/);
  });

  it('STUN unreachable (host candidates only): Relay needed, grown-ups learn same-network still works', async () => {
    const { raw, desc } = await check({ netOpts: { lanOnly: true } });
    expect(raw.direct).toMatchObject({ status: 'no', types: ['host'], stunMs: null });
    expect(desc.direct.icon).toBe('❌');
    expect(desc.direct.text).toContain('Relay needed');
    expect(desc.direct.grownUps).toContain('only same-network (host) connections work');
  });

  it('Worker napping: public relays take over (⚠️) and the relay row says napping', async () => {
    const { raw, desc } = await check({ serverOpts: { down: true } });
    expect(raw.matchmaker).toMatchObject({ kind: 'public', workerOk: false, status: 'reachable', trackers: { reachable: 3 } });
    expect(desc.matchmaker.icon).toBe('⚠️');
    expect(desc.matchmaker.text).toContain('Server napping, using public relays');
    expect(raw.relay.status).toBe('napping');
    expect(desc.relay.text).toContain('napping');
  });

  it('Worker without TURN secrets: relay not set up; /ice rate-limited: relay busy', async () => {
    const a = await check({ serverOpts: { turn: false } });
    expect(a.raw.matchmaker.turnConfigured).toBe(false);
    expect(a.desc.matchmaker.grownUps).toContain('relay not configured');
    expect(a.raw.relay.status).toBe('not-set-up');
    const server = createFakeWorkerServer();
    const origFetch = server.fetch;
    server.fetch = async (url) => (String(url).endsWith('/ice') ? { ok: false, status: 429, json: async () => ({}) } : origFetch(url));
    const b = await check({ server });
    expect(b.raw.relay.status).toBe('busy');
    expect(b.desc.relay.text).toContain('busy');
  });

  it('TURN configured but no relay candidate gathers: ❌ relay cannot get through', async () => {
    const { raw, desc } = await check({ netOpts: { turnWorks: false } });
    expect(raw.relay.status).toBe('unreachable');
    expect(desc.relay.icon).toBe('❌');
    expect(desc.ok).toBe(true); // direct still works
  });

  it('nothing reachable: matchmaker ❌ and a gentle hint', async () => {
    const { raw, desc } = await check({ serverOpts: { down: true }, WebSocketImpl: fakeTrackerSockets(new Set()) });
    expect(raw.matchmaker.status).toBe('unreachable');
    expect(desc.matchmaker.icon).toBe('❌');
    expect(desc.ok).toBe(false);
    expect(desc.hint).toMatch(/another network/);
  });

  it('slow server (> 1.5 s) is ⚠️; slow trackers too', async () => {
    let t = 0;
    const now = () => (t += SLOW_MS + 1);
    const a = await check({ now });
    expect(a.raw.matchmaker.status).toBe('slow');
    expect(a.desc.matchmaker.icon).toBe('⚠️');
    t = 0;
    const b = await check({ signalUrl: null, now });
    expect(b.raw.matchmaker.status).toBe('slow');
    expect(b.desc.matchmaker.text).toContain('a bit slow');
  });

  it('no WebRTC in this browser', async () => {
    const server = createFakeWorkerServer();
    const raw = await runConnectionCheck({ signalUrl: null, fetchImpl: server.fetch, RTCPeerConnectionImpl: undefined, WebSocketImpl: fakeTrackerSockets(), trackers: TRACKERS });
    expect(raw.direct.status).toBe('no-webrtc');
    const desc = describeCheck(raw);
    expect(desc.direct.icon).toBe('❌');
    assertSafe(desc, raw);
  });

  it('never shows an IP even when the gatherer and stats are full of them', async () => {
    const { desc } = await check({});
    const all = desc.rows.map((r) => r.text + r.grownUps).join('\n');
    expect(all).not.toMatch(IPV4);
    // describeCheck on junk input stays safe and complete
    const junk = describeCheck(/** @type {any} */ ({}));
    expect(junk.rows).toHaveLength(3);
    assertSafe(junk);
  });
});

describe('candidate helpers', () => {
  it('parseCandidate keeps the type and protocol only', () => {
    expect(parseCandidate('candidate:1 1 udp 2122260223 192.168.1.23 50001 typ host generation 0')).toEqual({ type: 'host', protocol: 'udp' });
    expect(parseCandidate('a=candidate:2 1 TCP 1 203.0.113.7 9 typ srflx raddr 0.0.0.0 rport 0 tcptype active')).toEqual({ type: 'srflx', protocol: 'tcp' });
    expect(parseCandidate('candidate:3 1 udp 1 198.51.100.9 3478 typ relay')).toEqual({ type: 'relay', protocol: 'udp' });
    expect(parseCandidate('garbage')).toBeNull();
    expect(parseCandidate(null)).toBeNull();
  });

  it('gatherCandidateTypes times out instead of hanging, and survives a throwing constructor', async () => {
    vi.useFakeTimers();
    class Silent extends EventTarget {
      createDataChannel() {}
      async createOffer() {
        return { type: 'offer', sdp: '' };
      }
      async setLocalDescription() {}
      close() {}
    }
    const p = gatherCandidateTypes({ RTCPeerConnectionImpl: Silent, config: {}, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ types: [], timedOut: true });
    const Throws = class {
      constructor() {
        throw new Error('bad config');
      }
    };
    expect(await gatherCandidateTypes({ RTCPeerConnectionImpl: Throws, config: {} })).toMatchObject({ error: 'config' });
    class OfferFails extends Silent {
      async createOffer() {
        throw new Error('nope');
      }
    }
    expect(await gatherCandidateTypes({ RTCPeerConnectionImpl: OfferFails, config: {}, timeoutMs: 1000 })).toMatchObject({ error: 'offer' });
  });
});
