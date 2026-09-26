/**
 * Integration (net wave 3): the localhost-only dev override (?signal=public&relays=… / ?signal=worker)
 * must keep dev and e2e builds on this machine — no Nostr fallback to public relays, and the
 * Check connection screen probes the overridden matchmaker instead of the real trackers / STUN.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPublicSignaling, PUBLIC_FALLBACK_AFTER_MS } from '../src/net/signaling/public.js';
import { createSignaling, resolveSignalConfig } from '../src/net/signaling/index.js';
import { PUBLIC_TRACKERS, publicIceServers } from '../src/net/signaling/relays.js';
import { runConnectionCheck } from '../src/net/diagnose.js';
import { checkOptionsFor, resolveScreenSignal, runCheck } from '../src/ui/screens/checkConnection.js';
import { createFakeRtcNetwork, fakeRoomIds } from './helpers/netFakeRtc.js';
import { createFakeTrystero } from './helpers/netFakeTrystero.js';

const HOST = 'aaaaaaaaaaaaaaaa';
const LOCAL = ['ws://127.0.0.1:8000'];

afterEach(() => vi.useRealTimers());

/** A peer connection that records its config and finishes gathering with no candidates. */
function gatheringPc(configs) {
  return class extends EventTarget {
    constructor(cfg) { super(); configs.push(cfg); this.iceGatheringState = 'new'; }
    createDataChannel() { return {}; }
    async createOffer() { return { type: 'offer', sdp: '' }; }
    async setLocalDescription() {
      setTimeout(() => {
        this.iceGatheringState = 'complete';
        const ev = new Event('icecandidate');
        ev.candidate = null;
        this.dispatchEvent(ev);
      }, 0);
    }
    close() {}
  };
}

describe('public signaling without Nostr relays (local-only)', () => {
  it('an empty nostrRelays list never schedules or joins the Nostr fallback', async () => {
    vi.useFakeTimers();
    const net = createFakeRtcNetwork();
    const fake = createFakeTrystero({ net });
    const sig = createPublicSignaling({ importer: fake.importer, trackers: LOCAL, nostrRelays: [] });
    await sig.join({ ids: fakeRoomIds('public'), role: 'host', selfId: HOST, iceServers: [], relayOnly: false });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(PUBLIC_FALLBACK_AFTER_MS * 3);
    expect(fake.imports.filter((m) => m.endsWith('nostr'))).toHaveLength(0);
    expect(fake.joins.map((j) => j.strategy)).toEqual(['torrent']);
    expect(fake.joins[0].config.relayConfig).toEqual({ urls: LOCAL });
    expect(sig.stats().fallbackJoined).toBeFalsy();
    await sig.leave();
  });

  it('the default (no override) still falls back to Nostr after the delay', async () => {
    vi.useFakeTimers();
    const net = createFakeRtcNetwork();
    const fake = createFakeTrystero({ net });
    const sig = createPublicSignaling({ importer: fake.importer });
    await sig.join({ ids: fakeRoomIds('public'), role: 'host', selfId: HOST, iceServers: [], relayOnly: false });
    await vi.advanceTimersByTimeAsync(PUBLIC_FALLBACK_AFTER_MS);
    expect(fake.joins.map((j) => j.strategy)).toEqual(['torrent', 'nostr']);
    await sig.leave();
  });

  it('createSignaling with a relay override (the room flows path) never reaches Nostr', async () => {
    vi.useFakeTimers();
    const imports = [];
    const joins = [];
    const importer = async (m) => {
      imports.push(m);
      return {
        joinRoom(cfg) {
          joins.push(cfg.relayConfig.urls);
          return { makeAction: () => [() => {}, () => {}], getPeers: () => ({}), onPeerJoin() {}, onPeerLeave() {}, leave: async () => {} };
        },
      };
    };
    const s = await createSignaling({ signalUrl: null, forced: 'public', relays: LOCAL, deps: { importer } });
    await s.join({ ids: fakeRoomIds('public'), role: 'host', selfId: HOST, iceServers: [], relayOnly: false }).catch(() => {});
    await vi.advanceTimersByTimeAsync(PUBLIC_FALLBACK_AFTER_MS * 3);
    expect(imports.some((m) => m.endsWith('nostr'))).toBe(false);
    for (const urls of joins) expect(urls).toEqual(LOCAL);
    await s.leave();
  });
});

describe('Check connection follows the resolved signal config', () => {
  it('checkOptionsFor: no signal → build URL only; relay override → local trackers and no public STUN', () => {
    expect(checkOptionsFor({ signalUrl: 'https://w.example' })).toEqual({ signalUrl: 'https://w.example' });
    expect(checkOptionsFor({ signalUrl: 'https://w.example', signal: { signalUrl: null, forced: 'public', relays: LOCAL } }))
      .toEqual({ signalUrl: null, trackers: LOCAL, iceServers: [] });
    expect(checkOptionsFor({ signal: { signalUrl: 'http://127.0.0.1:8811', forced: 'worker', relays: null } }))
      .toEqual({ signalUrl: 'http://127.0.0.1:8811' });
    // ?signal=public without relays = the real public path (a deliberate choice): defaults stay.
    expect(checkOptionsFor({ signal: { signalUrl: null, forced: 'public', relays: null } })).toEqual({ signalUrl: null });
  });

  it('resolveScreenSignal reads the localhost override like the rooms do, and ignores it elsewhere', async () => {
    const local = await resolveScreenSignal({ envSignalUrl: null, dev: false, location: { search: '?signal=public&relays=ws://127.0.0.1:8000', hostname: 'localhost' } });
    expect(local).toEqual(resolveSignalConfig({ envSignalUrl: null, search: '?signal=public&relays=ws://127.0.0.1:8000', hostname: 'localhost' }));
    expect(local.forced).toBe('public');
    expect(local.relays).toEqual(LOCAL);
    const prod = await resolveScreenSignal({ envSignalUrl: 'https://sig.example', dev: false, location: { search: '?signal=public&relays=ws://127.0.0.1:8000', hostname: 'rillyboss.github.io' } });
    expect(prod).toEqual({ signalUrl: 'https://sig.example', forced: null, relays: null });
    expect(await resolveScreenSignal({ importer: async () => { throw new Error('offline'); } })).toBeNull();
  });

  it('runCheck with a relay override probes only the local tracker and gathers without public STUN', async () => {
    const sockets = [];
    const configs = [];
    class WS {
      constructor(url) { sockets.push(url); setTimeout(() => this.onopen?.(), 0); }
      close() {}
    }
    const PC = gatheringPc(configs);
    const desc = await runCheck({
      signal: { signalUrl: null, forced: 'public', relays: LOCAL },
      importer: async () => {
        const m = await import('../src/net/diagnose.js');
        return { describeCheck: m.describeCheck, runConnectionCheck: (o) => m.runConnectionCheck({ ...o, WebSocketImpl: WS, RTCPeerConnectionImpl: PC, fetchImpl: () => { throw new Error('no fetch'); }, gatherTimeoutMs: 200 }) };
      },
    });
    expect(sockets).toEqual(LOCAL);
    for (const url of PUBLIC_TRACKERS) expect(sockets).not.toContain(url);
    expect(configs.length).toBeGreaterThan(0);
    for (const c of configs) expect(c.iceServers).toEqual([]);
    expect(desc.rows.length).toBe(3);
  });

  it('runConnectionCheck defaults to public STUN when no iceServers are passed', async () => {
    const configs = [];
    const PC = gatheringPc(configs);
    await runConnectionCheck({ signalUrl: null, trackers: [], RTCPeerConnectionImpl: PC, WebSocketImpl: undefined, gatherTimeoutMs: 100 });
    expect(configs[0].iceServers).toEqual(publicIceServers());
  });
});
