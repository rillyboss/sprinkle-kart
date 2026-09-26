import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchIceServers, fetchHealth, sanitizeIceServers, hasTurn, endpointUrl } from '../src/net/signaling/ice.js';
import { createFakeWorkerServer } from './helpers/netFakeWorker.js';

const URL_ = 'https://sprinkle-kart-signal.example.workers.dev';

afterEach(() => vi.useRealTimers());

describe('ice.js', () => {
  it('endpointUrl keeps a base path and maps ws(s) to http(s)', () => {
    expect(endpointUrl(URL_, 'ice')).toBe(`${URL_}/ice`);
    expect(endpointUrl('http://localhost:8793/', 'health')).toBe('http://localhost:8793/health');
    expect(endpointUrl('wss://x.test/sig/?a=1#b', 'ice')).toBe('https://x.test/sig/ice');
    expect(endpointUrl('ws://x.test', 'ice')).toBe('http://x.test/ice');
  });

  it('fetchIceServers returns TURN creds from GET /ice (with :53 filtered)', async () => {
    const server = createFakeWorkerServer();
    const r = await fetchIceServers({ signalUrl: URL_, fetchImpl: server.fetch });
    expect(r.turn).toBe(true);
    expect(server.fetchLog).toEqual([`${URL_}/ice`]);
    expect(JSON.stringify(r.iceServers)).not.toMatch(/:53\b/);
    expect(r.iceServers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith('turns:')))).toBe(true);
  });

  it('without a Worker, when down, rate-limited, empty or slow: public STUN and turn=false (never throws)', async () => {
    const stun = (r) => r.iceServers.every((s) => String(s.urls).startsWith('stun:'));
    const none = await fetchIceServers({ signalUrl: null });
    expect(none).toMatchObject({ turn: false, reason: 'no-worker' });
    expect(stun(none)).toBe(true);
    const down = createFakeWorkerServer({ down: true });
    expect(await fetchIceServers({ signalUrl: URL_, fetchImpl: down.fetch })).toMatchObject({ turn: false, reason: 'unreachable' });
    const rate = createFakeWorkerServer({ rate: true });
    expect(await fetchIceServers({ signalUrl: URL_, fetchImpl: rate.fetch })).toMatchObject({ turn: false, reason: 'rate' });
    const noTurn = createFakeWorkerServer({ turn: false });
    const nt = await fetchIceServers({ signalUrl: URL_, fetchImpl: noTurn.fetch });
    expect(nt.turn).toBe(false);
    expect(stun(nt)).toBe(true);
    const http500 = async () => ({ ok: false, status: 500, json: async () => ({}) });
    expect(await fetchIceServers({ signalUrl: URL_, fetchImpl: http500 })).toMatchObject({ reason: 'http-500' });
    const junk = async () => ({ ok: true, status: 200, json: async () => ({ iceServers: [{ urls: 'http://evil' }] }) });
    expect(await fetchIceServers({ signalUrl: URL_, fetchImpl: junk })).toMatchObject({ reason: 'empty', turn: false });
    vi.useFakeTimers();
    const slow = () => new Promise(() => {});
    const p = fetchIceServers({ signalUrl: URL_, fetchImpl: slow, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ reason: 'timeout', turn: false });
  });

  it('fetchHealth reports { ok, turn, version } and its latency; failures are ok:false with a reason', async () => {
    let t = 0;
    const now = () => (t += 25);
    const server = createFakeWorkerServer();
    expect(await fetchHealth({ signalUrl: URL_, fetchImpl: server.fetch, now })).toEqual({ ok: true, turn: true, version: 'test-1', ms: 25 });
    expect(await fetchHealth({ signalUrl: null })).toMatchObject({ ok: false, reason: 'no-worker' });
    expect(await fetchHealth({ signalUrl: URL_, fetchImpl: createFakeWorkerServer({ healthOk: false }).fetch })).toMatchObject({ ok: false, reason: 'http-503' });
    expect(await fetchHealth({ signalUrl: URL_, fetchImpl: createFakeWorkerServer({ down: true }).fetch })).toMatchObject({ ok: false, reason: 'unreachable' });
    const weird = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, turn: 'yes', version: 7 }) });
    expect(await fetchHealth({ signalUrl: URL_, fetchImpl: weird })).toMatchObject({ ok: true, turn: false, version: null });
    const badJson = async () => ({ ok: true, status: 200, json: async () => { throw new Error('x'); } });
    expect(await fetchHealth({ signalUrl: URL_, fetchImpl: badJson })).toMatchObject({ ok: false });
    vi.useFakeTimers();
    const p = fetchHealth({ signalUrl: URL_, fetchImpl: () => new Promise(() => {}), timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('sanitizeIceServers keeps only stun/turn urls with string creds; hasTurn needs creds', () => {
    const out = sanitizeIceServers([
      { urls: 'stun:a.test:3478' },
      { urls: ['turn:b.test:3478', 'turn:b.test:53', 'https://nope'], username: 'u', credential: 'c' },
      { urls: 'turn:c.test:53' },
      { urls: 'turns:d.test:443', username: 5, credential: {} },
      null,
      'str',
      { urls: 42 },
    ]);
    expect(out).toEqual([
      { urls: 'stun:a.test:3478' },
      { urls: ['turn:b.test:3478'], username: 'u', credential: 'c' },
      { urls: 'turns:d.test:443' },
    ]);
    expect(sanitizeIceServers('x')).toEqual([]);
    expect(hasTurn(out)).toBe(true);
    expect(hasTurn([{ urls: 'turns:d.test:443' }])).toBe(false);
    expect(hasTurn(null)).toBe(false);
  });
});
