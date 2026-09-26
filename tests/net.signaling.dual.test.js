import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  chooseSignaling,
  signalingSchedule,
  resolveSignalConfig,
  createDualSignaling,
  createSignaling,
  openOnline,
  waitForPeer,
  GUEST_PUBLIC_DELAY_MS,
} from '../src/net/signaling/index.js';
import { createWorkerSignaling } from '../src/net/signaling/worker.js';
import { createPublicSignaling } from '../src/net/signaling/public.js';
import { fetchHealth } from '../src/net/signaling/ice.js';
import { createWebRtcTransport } from '../src/net/transport/webrtc.js';
import { createListeners } from '../src/net/signaling/types.js';
import { createFakeRtcNetwork, fakeRoomIds } from './helpers/netFakeRtc.js';
import { createFakeWorkerServer } from './helpers/netFakeWorker.js';
import { createFakeTrystero } from './helpers/netFakeTrystero.js';

const HOST = 'aaaaaaaaaaaaaaaa';
const G1 = 'bbbbbbbbbbbbbbbb';
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const SIGNAL_URL = 'https://sprinkle-kart-signal.example.workers.dev';

afterEach(() => vi.useRealTimers());

describe('chooseSignaling / schedule / dev override', () => {
  it('Worker build → worker then public; public build → public only', () => {
    expect(chooseSignaling({ signalUrl: SIGNAL_URL, health: { ok: true } })).toEqual(['worker', 'public']);
    expect(chooseSignaling({ signalUrl: SIGNAL_URL, health: { ok: false } })).toEqual(['worker', 'public']);
    expect(chooseSignaling({ signalUrl: null })).toEqual(['public']);
    expect(chooseSignaling({})).toEqual(['public']);
  });

  it('host starts everything at once; a guest adds public 4 s later, or at once when /health failed', () => {
    const kinds = ['worker', 'public'];
    expect(signalingSchedule({ kinds, role: 'host', health: { ok: true } })).toEqual({ worker: 0, public: 0 });
    expect(signalingSchedule({ kinds, role: 'guest', health: { ok: true } })).toEqual({ worker: 0, public: GUEST_PUBLIC_DELAY_MS });
    expect(signalingSchedule({ kinds, role: 'guest', health: null })).toEqual({ worker: 0, public: 4000 });
    expect(signalingSchedule({ kinds, role: 'guest', health: { ok: false } })).toEqual({ worker: 0, public: 0 });
    expect(signalingSchedule({ kinds: ['public'], role: 'guest', health: null })).toEqual({ public: 0 });
  });

  it('?signal= overrides work only on localhost / dev builds', () => {
    const env = SIGNAL_URL;
    expect(resolveSignalConfig({ envSignalUrl: env, search: '', hostname: 'rillyboss.github.io' })).toEqual({ signalUrl: env, forced: null, relays: null });
    expect(resolveSignalConfig({ envSignalUrl: env, search: '?signal=public&relays=ws://127.0.0.1:8000', hostname: 'rillyboss.github.io' })).toEqual({
      signalUrl: env,
      forced: null,
      relays: null,
    });
    expect(resolveSignalConfig({ envSignalUrl: env, search: '?signal=public&relays=ws://127.0.0.1:8000', hostname: 'localhost' })).toEqual({
      signalUrl: null,
      forced: 'public',
      relays: ['ws://127.0.0.1:8000'],
    });
    expect(resolveSignalConfig({ search: '?signal=worker&signalUrl=http://127.0.0.1:8793/', hostname: '127.0.0.1' })).toEqual({
      signalUrl: 'http://127.0.0.1:8793',
      forced: 'worker',
      relays: null,
    });
    expect(resolveSignalConfig({ search: '?signal=worker&signalUrl=javascript:alert(1)', dev: true })).toEqual({ signalUrl: null, forced: null, relays: null });
    expect(resolveSignalConfig({ envSignalUrl: env, search: '?signal=worker', dev: true })).toEqual({ signalUrl: env, forced: 'worker', relays: null });
    expect(resolveSignalConfig({ envSignalUrl: '  ', search: '?signal=nope', dev: true })).toEqual({ signalUrl: null, forced: null, relays: null });
    expect(resolveSignalConfig()).toEqual({ signalUrl: null, forced: null, relays: null });
  });
});

/** A full little world: fake Worker + fake Trystero + fake RTC, machines on either build. */
function world(serverOpts = {}) {
  const server = createFakeWorkerServer(serverOpts);
  const net = createFakeRtcNetwork();
  const fake = createFakeTrystero({ net });
  const ids = fakeRoomIds('dual');
  const machine = async (role, selfId, { build = 'worker', health, guestPublicDelayMs } = {}) => {
    const h = health !== undefined ? health : build === 'worker' ? await fetchHealth({ signalUrl: SIGNAL_URL, fetchImpl: server.fetch }) : null;
    const signaling = await createSignaling({
      signalUrl: build === 'worker' ? SIGNAL_URL : null,
      health: h,
      deps: {
        WebSocketImpl: server.WebSocket,
        fetchImpl: server.fetch,
        RTCPeerConnectionImpl: net.RTCPeerConnection,
        importer: fake.importer,
        ...(guestPublicDelayMs !== undefined ? { guestPublicDelayMs } : {}),
      },
    });
    const t = createWebRtcTransport({ signaling, role, selfId });
    return { signaling, t, health: h, join: () => signaling.join({ ids, role, selfId, iceServers: STUN, relayOnly: false }) };
  };
  return { server, net, fake, ids, machine };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('dual matchmaker end to end (fake Worker + fake Trystero)', () => {
  it('host on a Worker build (worker + public) meets a guest on an old public-only build — over public', async () => {
    vi.useFakeTimers();
    const { machine } = world();
    const host = await machine('host', HOST, { build: 'worker' });
    const guest = await machine('guest', G1, { build: 'public' });
    await host.join();
    expect(host.signaling.states()).toEqual({ worker: 'joined', public: 'joined' });
    await guest.join();
    await flush();
    expect(host.t.peers()).toEqual([G1]);
    expect(guest.t.peers()).toEqual([HOST]);
    expect(host.t.debug()[0].kind).toBe('public');
    expect(guest.signaling.kinds()).toEqual(['public']);
    host.t.close();
    guest.t.close();
  });

  it('Worker /health down → public on both sides (guest starts public at once)', async () => {
    vi.useFakeTimers();
    const { server, fake, machine } = world({ down: true });
    const host = await machine('host', HOST);
    const guest = await machine('guest', G1);
    expect(host.health.ok).toBe(false);
    await host.join();
    expect(host.signaling.states()).toEqual({ worker: 'failed', public: 'joined' });
    await guest.join();
    await flush();
    expect(fake.joins.filter((j) => j.strategy === 'torrent')).toHaveLength(2); // no 4 s wait
    expect(host.t.peers()).toEqual([G1]);
    expect(guest.t.peers()).toEqual([HOST]);
    expect(server.rooms.size).toBe(0);
    host.t.close();
    guest.t.close();
  });

  it('both on the Worker build: they meet on the Worker; the guest never starts public', async () => {
    vi.useFakeTimers();
    const { fake, machine } = world();
    const host = await machine('host', HOST);
    const guest = await machine('guest', G1);
    await host.join();
    await guest.join();
    await flush();
    expect(guest.t.peers()).toEqual([HOST]);
    expect(guest.t.debug()[0].kind).toBe('worker');
    expect(guest.signaling.states()).toEqual({ worker: 'joined', public: 'left' });
    await vi.advanceTimersByTimeAsync(GUEST_PUBLIC_DELAY_MS * 3);
    expect(fake.joins.filter((j) => j.strategy === 'torrent')).toHaveLength(1); // the host's public room only
    expect(guest.signaling.detail()).toBe('worker');
    host.t.close();
    guest.t.close();
  });

  it('duplicate connection per selfId: both paths connect, the host keeps ONE and closes the other', async () => {
    vi.useFakeTimers();
    const { net, machine } = world();
    const host = await machine('host', HOST);
    const guest = await machine('guest', G1, { health: { ok: false } }); // public starts at once too
    const hostJoins = [];
    host.t.onPeer((e) => hostJoins.push(e.type));
    await host.join();
    await guest.join();
    await flush();
    await flush();
    expect(host.t.peers()).toEqual([G1]);
    expect(guest.t.peers()).toEqual([HOST]);
    expect(hostJoins).toEqual(['join']);
    const winner = guest.t.debug()[0].kind;
    // Exactly one host↔guest pair carries open game channels; every other pc is closed or idle.
    const withGame = net.created.filter((p) => p.channels.some((c) => c.id === 8 && c.readyState === 'open'));
    expect(withGame).toHaveLength(2);
    expect(withGame[0]._remote).toBe(withGame[1]);
    // The guest left the losing matchmaker.
    const states = guest.signaling.states();
    expect(states[winner]).toBe('joined');
    expect(states[winner === 'worker' ? 'public' : 'worker']).toBe('left');
    host.t.close();
    guest.t.close();
  });

  it('the Worker does not know the room (host on an old build) → the guest tries public right away', async () => {
    vi.useFakeTimers();
    const { fake, machine } = world();
    const host = await machine('host', HOST, { build: 'public' });
    const guest = await machine('guest', G1, { build: 'worker' });
    await host.join();
    await guest.join();
    await flush();
    expect(fake.joins.filter((j) => j.strategy === 'torrent')).toHaveLength(2);
    expect(guest.t.peers()).toEqual([HOST]);
    expect(guest.signaling.states()).toEqual({ worker: 'failed', public: 'joined' });
    host.t.close();
    guest.t.close();
  });

  it('a locked room on the Worker is final: the guest gets "locked" and never knocks on public', async () => {
    vi.useFakeTimers();
    const { fake, machine } = world();
    const host = await machine('host', HOST);
    await host.join();
    host.signaling.setLocked(true);
    await flush();
    const guest = await machine('guest', G1);
    const p = guest.join().catch((e) => e);
    await vi.advanceTimersByTimeAsync(GUEST_PUBLIC_DELAY_MS * 2);
    expect((await p).code).toBe('locked');
    expect(fake.joins.filter((j) => j.strategy === 'torrent')).toHaveLength(1);
    host.t.close();
    guest.t.close();
  });
});

/** Scripted SignalingTransport for composite unit tests. */
function scripted(kind, behaviour) {
  const conn = createListeners();
  const leave = createListeners();
  const s = {
    kind,
    calls: [],
    joinOpts: null,
    join: async (o) => {
      s.calls.push('join');
      s.joinOpts = o;
      return behaviour(o);
    },
    onPeerConnection: (fn) => conn.add(fn),
    onPeerLeave: (fn) => leave.add(fn),
    drop: (p) => s.calls.push(`drop:${p}`),
    setLocked: (l) => s.calls.push(`lock:${l}`),
    refreshIce: async () => {
      s.calls.push('refresh');
      return [{ urls: `stun:${kind}` }];
    },
    restartIce: async (p) => {
      s.calls.push(`restart:${p}`);
      return true;
    },
    setIceServers: (l) => s.calls.push(`ice:${l.length}`),
    settle: (p) => s.calls.push(`settle:${p}`),
    leave: async () => s.calls.push('leave'),
    detail: () => `${kind}-x`,
    emit: (p) => conn.emit(p),
    emitLeave: (p) => leave.emit(p),
  };
  return s;
}

describe('createDualSignaling (composite)', () => {
  it('host: resolves on the first success, passes the Worker TURN servers to public, fans out drop/lock', async () => {
    const turn = [{ urls: 'turn:t', username: 'u', credential: 'c' }];
    const w = scripted('worker', async () => ({ iceServers: turn }));
    const p = scripted('public', async (o) => ({ iceServers: o.iceServers }));
    const d = createDualSignaling({ transports: { worker: w, public: p }, kinds: ['worker', 'public'] });
    const r = await d.join({ ids: fakeRoomIds(), role: 'host', selfId: HOST, iceServers: STUN, relayOnly: true });
    await Promise.resolve();
    expect(r.iceServers).toEqual(turn);
    expect(p.calls).toContain('ice:1');
    expect(p.joinOpts.relayOnly).toBe(true);
    d.drop(G1);
    d.setLocked(true);
    expect(w.calls).toEqual(expect.arrayContaining([`drop:${G1}`, 'lock:true']));
    expect(p.calls).toEqual(expect.arrayContaining([`drop:${G1}`, 'lock:true']));
    expect(await d.refreshIce()).toEqual([{ urls: 'stun:worker' }]);
    expect(d.detail()).toBe('worker-x+public-x');
    // restartIce goes to the matchmaker that owns the peer's live connection.
    d.settle(G1, {}, 'public');
    expect(p.calls).toContain(`settle:${G1}`);
    expect(w.calls).not.toContain('leave'); // the host never leaves a matchmaker on settle
    await d.restartIce(G1);
    expect(p.calls).toContain(`restart:${G1}`);
    // Forwarded events carry their kind.
    const seen = [];
    d.onPeerConnection((x) => seen.push(x.kind));
    d.onPeerLeave((id, info) => seen.push(`${id}:${info.kind}`));
    w.emit({ peerId: G1, pc: {} });
    p.emitLeave(G1);
    expect(seen).toEqual(['worker', `${G1}:public`]);
    await d.leave();
    expect(w.calls.at(-1)).toBe('leave');
    await d.leave();
  });

  it('rejects with the most useful error when every matchmaker fails', async () => {
    const { SignalingError } = await import('../src/net/signaling/types.js');
    const w = scripted('worker', async () => {
      throw new SignalingError('no-host');
    });
    const p = scripted('public', async () => {
      throw new SignalingError('unreachable');
    });
    const d = createDualSignaling({ transports: { worker: w, public: p }, kinds: ['worker', 'public'], health: { ok: true } });
    await expect(d.join({ ids: fakeRoomIds(), role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false })).rejects.toMatchObject({ code: 'no-host' });
    const plain = scripted('public', async () => {
      throw new Error('weird');
    });
    const d2 = createDualSignaling({ transports: { public: plain }, kinds: ['public'] });
    await expect(d2.join({ ids: fakeRoomIds(), role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false })).rejects.toMatchObject({ code: 'unreachable' });
    expect(() => createDualSignaling({ transports: {}, kinds: ['worker'] })).toThrow();
    // With nothing joined, refreshIce falls back to public STUN.
    expect((await d2.refreshIce())[0].urls).toMatch(/^stun:/);
    expect(await d2.restartIce(G1)).toBe(false);
  });

  it('a guest whose Worker join is slow still adds public after 4 s', async () => {
    vi.useFakeTimers();
    let release;
    const w = scripted('worker', () => new Promise((r) => (release = r)));
    const p = scripted('public', async (o) => ({ iceServers: o.iceServers }));
    const d = createDualSignaling({ transports: { worker: w, public: p }, kinds: ['worker', 'public'], health: { ok: true } });
    const joined = d.join({ ids: fakeRoomIds(), role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false });
    await vi.advanceTimersByTimeAsync(GUEST_PUBLIC_DELAY_MS - 1);
    expect(p.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.calls).toEqual(['join']);
    expect((await joined).iceServers).toEqual(STUN);
    // The Worker finally answers after the guest left it: it is left immediately.
    d.settle(HOST, {}, 'public');
    await vi.advanceTimersByTimeAsync(0);
    release({ iceServers: STUN });
    await vi.advanceTimersByTimeAsync(0);
    expect(d.states().worker).toBe('left');
  });
});

describe('openOnline / waitForPeer / createSignaling', () => {
  it('openOnline subscribes the transport before join and returns it; a failed join closes it', async () => {
    const w = scripted('worker', async () => ({ iceServers: STUN }));
    const d = createDualSignaling({ transports: { worker: w }, kinds: ['worker'] });
    const { transport, joined } = await openOnline({ role: 'host', selfId: HOST, ids: fakeRoomIds(), deps: { signaling: d } });
    expect(joined.iceServers).toEqual(STUN);
    expect(transport.role).toBe('host');
    expect(w.joinOpts.iceServers[0].urls).toMatch(/^stun:/);
    transport.close();
    const { SignalingError } = await import('../src/net/signaling/types.js');
    const bad = createDualSignaling({
      transports: {
        worker: scripted('worker', async () => {
          throw new SignalingError('full');
        }),
      },
      kinds: ['worker'],
    });
    await expect(openOnline({ role: 'guest', selfId: G1, ids: fakeRoomIds(), deps: { signaling: bad } })).rejects.toMatchObject({ code: 'full' });
  });

  it('waitForPeer resolves on join, rejects with no-host on timeout', async () => {
    vi.useFakeTimers();
    const peers = [];
    const l = createListeners();
    const t = { peers: () => peers, onPeer: (fn) => l.add(fn) };
    const p = waitForPeer(t, { timeoutMs: 1000 });
    l.emit({ type: 'leave', peerId: 'x' });
    l.emit({ type: 'join', peerId: HOST });
    expect(await p).toBe(HOST);
    const q = waitForPeer(t, { timeoutMs: 1000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await q).code).toBe('no-host');
    peers.push(HOST);
    expect(await waitForPeer(t)).toBe(HOST);
  });

  it('createSignaling builds worker+public, forced single kinds, and passes relays as trackers', async () => {
    const both = await createSignaling({ signalUrl: SIGNAL_URL, deps: { importer: async () => ({}) } });
    expect(both.kinds()).toEqual(['worker', 'public']);
    const onlyPublic = await createSignaling({ signalUrl: null });
    expect(onlyPublic.kinds()).toEqual(['public']);
    const forcedWorker = await createSignaling({ signalUrl: SIGNAL_URL, forced: 'worker' });
    expect(forcedWorker.kinds()).toEqual(['worker']);
    const seen = [];
    const forcedPublic = await createSignaling({
      signalUrl: null,
      forced: 'public',
      relays: ['ws://127.0.0.1:8000'],
      deps: {
        importer: async () => ({
          joinRoom(cfg) {
            seen.push(cfg.relayConfig.urls);
            return { makeAction: () => ({}), getPeers: () => ({}), leave: async () => {} };
          },
        }),
        fallbackAfterMs: 1e9,
      },
    });
    await forcedPublic.join({ ids: fakeRoomIds(), role: 'host', selfId: HOST, iceServers: STUN, relayOnly: false });
    expect(seen).toEqual([['ws://127.0.0.1:8000']]);
    await forcedPublic.leave();
    // worker kind without a URL is skipped rather than broken
    const noUrl = await createSignaling({ signalUrl: null, forced: 'public' });
    expect(noUrl.kinds()).toEqual(['public']);
    expect(createWorkerSignaling).toBeTypeOf('function');
    expect(createPublicSignaling).toBeTypeOf('function');
  });
});
