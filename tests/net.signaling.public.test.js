import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createPublicSignaling,
  parseRoleMessage,
  defaultTrysteroImporter,
  PUBLIC_FALLBACK_AFTER_MS,
  ROLE_TIMEOUT_MS,
  ROLE_ACTION,
} from '../src/net/signaling/public.js';
import { PUBLIC_TRACKERS, PUBLIC_NOSTR_RELAYS } from '../src/net/signaling/relays.js';
import { createWebRtcTransport } from '../src/net/transport/webrtc.js';
import { createFakeRtcNetwork, fakeRoomIds } from './helpers/netFakeRtc.js';
import { createFakeTrystero } from './helpers/netFakeTrystero.js';

const HOST = 'aaaaaaaaaaaaaaaa';
const G1 = 'bbbbbbbbbbbbbbbb';
const G2 = 'cccccccccccccccc';
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];

function world() {
  const net = createFakeRtcNetwork();
  const fake = createFakeTrystero({ net });
  const ids = fakeRoomIds('public');
  const machine = (role, selfId, opts = {}) => {
    const sig = createPublicSignaling({ importer: fake.importer, ...opts });
    const t = createWebRtcTransport({ signaling: sig, role, selfId });
    const events = [];
    t.onPeer((e) => events.push(e));
    const join = (extra = {}) => sig.join({ ids, role, selfId, iceServers: STUN, relayOnly: false, ...extra });
    return { sig, t, events, join };
  };
  return { net, fake, ids, machine };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

afterEach(() => vi.useRealTimers());

describe('PublicSignaling with a fake Trystero (importer injection)', () => {
  it('joins the torrent strategy first with appId, password, pinned trackers and our ICE servers', async () => {
    vi.useFakeTimers();
    const { fake, ids, machine } = world();
    const h = machine('host', HOST);
    const r = await h.join();
    expect(r.iceServers).toEqual(STUN);
    expect(fake.imports).toEqual(['@trystero-p2p/torrent']);
    expect(fake.joins).toHaveLength(1);
    const { config, roomId, strategy } = fake.joins[0];
    expect(strategy).toBe('torrent');
    expect(roomId).toBe(ids.topic);
    expect(config.appId).toBe('sprinkle-kart');
    expect(config.password).toBe(ids.password);
    expect(config.relayConfig).toEqual({ urls: [...PUBLIC_TRACKERS] });
    expect(config.rtcConfig).toEqual({ iceServers: STUN, iceTransportPolicy: 'all' });
    expect(h.sig.detail()).toBe('public-torrent');
    await h.sig.leave();
  });

  it('host and guest meet; peers are surfaced with OUR selfIds, not Trystero ids', async () => {
    vi.useFakeTimers();
    const { machine } = world();
    const h = machine('host', HOST);
    const g = machine('guest', G1);
    await h.join();
    await g.join();
    await flush();
    expect(h.t.peers()).toEqual([G1]);
    expect(g.t.peers()).toEqual([HOST]);
    const got = [];
    h.t.onMessage((p, ch, b) => got.push([p, ch, b[0]]));
    g.t.send(HOST, 'state', new Uint8Array([5]));
    await flush();
    expect(got).toEqual([[G1, 'state', 5]]);
    h.t.close();
    g.t.close();
  });

  it('closes guest ↔ guest pairs right after sk-role and never surfaces them', async () => {
    vi.useFakeTimers();
    const { net, machine } = world();
    const h = machine('host', HOST);
    const g1 = machine('guest', G1);
    const g2 = machine('guest', G2);
    const surfaced = [];
    g1.sig.onPeerConnection((p) => surfaced.push(['g1', p.peerId]));
    g2.sig.onPeerConnection((p) => surfaced.push(['g2', p.peerId]));
    await g1.join();
    await g2.join(); // the two guests meet first (mesh)
    await flush();
    await h.join();
    await flush();
    expect(surfaced.sort()).toEqual([
      ['g1', HOST],
      ['g2', HOST],
    ]);
    expect(h.t.peers().sort()).toEqual([G1, G2]);
    expect(g1.t.peers()).toEqual([HOST]);
    expect(g2.t.peers()).toEqual([HOST]);
    expect(g1.sig.stats().closedNonHost + g2.sig.stats().closedNonHost).toBeGreaterThanOrEqual(1);
    // The guest↔guest pcs are closed (only host links stay connected).
    const live = net.created.filter((p) => p.connectionState === 'connected');
    expect(live).toHaveLength(4);
    h.t.close();
    g1.t.close();
    g2.t.close();
  });

  it('no host on the trackers → after 6 s the guest (and the host) also join Nostr and meet there', async () => {
    vi.useFakeTimers();
    const { fake, machine } = world();
    fake.silent.add('torrent'); // trackers up, but nothing is delivered (flaky day)
    const h = machine('host', HOST);
    const g = machine('guest', G1);
    await h.join();
    await g.join();
    await vi.advanceTimersByTimeAsync(PUBLIC_FALLBACK_AFTER_MS - 1);
    expect(fake.imports.filter((m) => m.endsWith('nostr'))).toHaveLength(0);
    expect(g.t.peers()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    const nostrJoins = fake.joins.filter((j) => j.strategy === 'nostr');
    expect(nostrJoins).toHaveLength(2);
    for (const j of nostrJoins) {
      expect(j.config.relayConfig).toEqual({ urls: [...PUBLIC_NOSTR_RELAYS], redundancy: 6 });
      expect(j.config.appId).toBe('sprinkle-kart');
    }
    expect(g.t.peers()).toEqual([HOST]);
    expect(g.sig.detail()).toBe('public-nostr'); // settle() left the useless torrent room
    expect(h.sig.detail()).toBe('public-torrent+public-nostr');
    expect(g.sig.stats().fallbackJoined).toBe(true);
    h.t.close();
    g.t.close();
  });

  it('a guest that found the host on the trackers never joins Nostr', async () => {
    vi.useFakeTimers();
    const { fake, machine } = world();
    const h = machine('host', HOST);
    const g = machine('guest', G1);
    await h.join();
    await g.join();
    await flush();
    expect(g.t.peers()).toEqual([HOST]);
    await vi.advanceTimersByTimeAsync(PUBLIC_FALLBACK_AFTER_MS * 2);
    expect(fake.joins.filter((j) => j.strategy === 'nostr').map((j) => j.config.password)).toHaveLength(1); // host only
    expect(g.sig.detail()).toBe('public-torrent');
    h.t.close();
    g.t.close();
  });

  it('a Nostr import failure is survivable (torrent keeps going)', async () => {
    vi.useFakeTimers();
    const { fake, machine } = world();
    fake.broken.add('nostr');
    const h = machine('host', HOST);
    await h.join();
    await vi.advanceTimersByTimeAsync(PUBLIC_FALLBACK_AFTER_MS);
    expect(h.sig.detail()).toBe('public-torrent');
    expect(h.sig.stats().joinErrors).toContain('nostr import failed');
    await h.sig.leave();
  });

  it('host lock refuses new guests (pair closed), drop() closes one and blocks it until unlock', async () => {
    vi.useFakeTimers();
    const { machine } = world();
    const h = machine('host', HOST);
    const g1 = machine('guest', G1);
    const g2 = machine('guest', G2);
    const leaves = [];
    h.sig.onPeerLeave((p, info) => leaves.push([p, info.kind]));
    await h.join();
    await g1.join();
    await flush();
    h.sig.setLocked(true);
    expect(h.sig.stats().locked).toBe(true);
    await g2.join();
    await flush();
    expect(h.t.peers()).toEqual([G1]);
    expect(g2.t.peers()).toEqual([]);
    h.sig.drop(G1);
    await flush();
    expect(leaves).toEqual([[G1, 'public']]);
    expect(h.t.peers()).toEqual([]);
    // Guests cannot lock or drop.
    g1.sig.setLocked(true);
    g1.sig.drop(HOST);
    expect(g1.sig.stats().locked).toBe(false);
    h.t.close();
    g1.t.close();
    g2.t.close();
  });

  it('a locked host tells the knocking guest "locked" (so it says closed, never the NAT tips) — review #19', async () => {
    vi.useFakeTimers();
    const { machine } = world();
    const h = machine('host', HOST);
    const g = machine('guest', G1);
    const refused = [];
    g.sig.onRefused((code) => refused.push(code));
    await h.join();
    h.sig.setLocked(true);
    await g.join();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(refused).toEqual(['locked']);
    expect(h.t.peers()).toEqual([]);
    expect(g.t.peers()).toEqual([]);
    expect(parseRoleMessage({ v: 1, role: 'host', id: HOST, refused: 'locked' })).toEqual({ role: 'host', id: HOST, refused: 'locked' });
    expect(parseRoleMessage({ v: 1, role: 'guest', id: G1, refused: 'locked' })).toEqual({ role: 'guest', id: G1 });
    h.t.close();
    g.t.close();
  });

  it('a peer that never sends sk-role is closed after the role timeout', async () => {
    vi.useFakeTimers();
    const { fake, ids, machine } = world();
    const h = machine('host', HOST);
    await h.join();
    // A bare Trystero client in the same topic that never speaks our protocol.
    const mod = await fake.importer('@trystero-p2p/torrent');
    const stranger = mod.joinRoom({ appId: 'sprinkle-kart', password: ids.password, rtcConfig: {} }, ids.topic);
    await flush();
    expect(Object.keys(stranger.getPeers())).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ROLE_TIMEOUT_MS);
    expect(h.sig.stats().roleTimeouts).toBe(1);
    expect(h.t.peers()).toEqual([]);
    await stranger.leave();
    await h.sig.leave();
  });

  it('a wrong password never meets (Trystero handshake), a malformed sk-role is closed', async () => {
    vi.useFakeTimers();
    const { fake, ids, machine } = world();
    const h = machine('host', HOST);
    await h.join();
    const g = machine('guest', G1);
    await g.sig.join({ ids: { ...ids, password: 'wrong' }, role: 'guest', selfId: G1, iceServers: STUN, relayOnly: false });
    await flush();
    expect(g.t.peers()).toEqual([]);
    const mod = await fake.importer('@trystero-p2p/torrent');
    const liar = mod.joinRoom({ appId: 'sprinkle-kart', password: ids.password, rtcConfig: {} }, ids.topic);
    const act = liar.makeAction(ROLE_ACTION);
    liar.onPeerJoin = (tid) => act.send({ v: 1, role: 'guest', id: 'not-hex!' }, { target: tid });
    await flush();
    await flush();
    expect(h.t.peers()).toEqual([]);
    await liar.leave();
    h.t.close();
    g.t.close();
  });

  it('relayOnly is a parameter (iceTransportPolicy relay); setIceServers reaches later pcs', async () => {
    vi.useFakeTimers();
    const { fake, machine } = world();
    const h = machine('host', HOST);
    await h.join({ relayOnly: true });
    expect(fake.joins[0].config.rtcConfig.iceTransportPolicy).toBe('relay');
    const turn = [{ urls: 'turns:t.example.test:443', username: 'u', credential: 'c' }];
    h.sig.setIceServers(turn);
    h.sig.setIceServers([]); // ignored
    expect(fake.joins[0].config.rtcConfig.iceServers).toEqual(turn);
    expect(await h.sig.refreshIce()).toEqual(turn);
    await h.sig.leave();
  });

  it('restartIce() asks Trystero to renegotiate on the pc; unknown peers → false', async () => {
    vi.useFakeTimers();
    const { net, machine } = world();
    const h = machine('host', HOST);
    const g = machine('guest', G1);
    await h.join();
    await g.join();
    await flush();
    expect(await g.sig.restartIce(HOST)).toBe(true);
    expect(net.created.some((p) => p.restartIceCalls === 1)).toBe(true);
    expect(await g.sig.restartIce('ffffffffffffffff')).toBe(false);
    h.t.close();
    g.t.close();
  });

  it('errors: torrent import failure → unreachable; bad ids; double join', async () => {
    const { fake, ids, machine } = world();
    fake.broken.add('torrent');
    const g = machine('guest', G1);
    await expect(g.join()).rejects.toMatchObject({ name: 'SignalingError', code: 'unreachable', detail: 'import' });
    fake.broken.clear();
    const s = createPublicSignaling({ importer: fake.importer });
    await expect(s.join({ ids: {}, role: 'host', selfId: HOST, iceServers: [], relayOnly: false })).rejects.toMatchObject({ detail: 'bad-ids' });
    await s.join({ ids, role: 'host', selfId: HOST, iceServers: [], relayOnly: false });
    await expect(s.join({ ids, role: 'host', selfId: HOST, iceServers: [], relayOnly: false })).rejects.toMatchObject({ detail: 'already-joined' });
    await s.leave();
    await s.leave(); // idempotent
    const throwing = createPublicSignaling({
      importer: async () => ({
        joinRoom() {
          throw new Error('bad config');
        },
      }),
    });
    await expect(throwing.join({ ids, role: 'host', selfId: HOST, iceServers: [], relayOnly: false })).rejects.toMatchObject({ detail: 'join' });
  });

  it('leave() leaves every room and stops the fallback timer', async () => {
    vi.useFakeTimers();
    const { fake, machine } = world();
    const h = machine('host', HOST);
    await h.join();
    await h.sig.leave();
    await vi.advanceTimersByTimeAsync(PUBLIC_FALLBACK_AFTER_MS * 2);
    expect(fake.imports).toEqual(['@trystero-p2p/torrent']);
    expect([...fake.topics.values()].every((s) => s.size === 0)).toBe(true);
  });
});

describe('sk-role parsing and the default importer', () => {
  it.each([
    [{ v: 1, role: 'host', id: HOST }, { role: 'host', id: HOST }],
    [{ v: 1, role: 'guest', id: G1 }, { role: 'guest', id: G1 }],
    [{ v: 2, role: 'host', id: HOST }, null],
    [{ v: 1, role: 'boss', id: HOST }, null],
    [{ v: 1, role: 'host', id: 'short' }, null],
    [{ v: 1, role: 'host', id: HOST.toUpperCase() }, null],
    [[1, 2], null],
    ['host', null],
    [null, null],
  ])('%j → %j', (input, out) => {
    expect(parseRoleMessage(input)).toEqual(out);
  });

  it('defaultTrysteroImporter only knows the two pinned packages', async () => {
    await expect(defaultTrysteroImporter('trystero/torrent')).rejects.toThrow(/unknown/);
  });
});
