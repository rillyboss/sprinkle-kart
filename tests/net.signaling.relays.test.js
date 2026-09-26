import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PUBLIC_TRACKERS,
  PUBLIC_NOSTR_RELAYS,
  PUBLIC_STUN_URLS,
  NOSTR_REDUNDANCY,
  TRYSTERO_APP_ID,
  TRYSTERO_VERSION,
  publicIceServers,
  parseRelayList,
} from '../src/net/signaling/relays.js';
import {
  SignalingError,
  SIGNALING_ERROR_CODES,
  workerErrorToSignalingError,
  isSignalingError,
  createListeners,
  isPeerId,
  makePeerId,
} from '../src/net/signaling/types.js';

describe('relays.js (NETWORKING.md §3 pinned lists)', () => {
  it('pins the three live WebTorrent trackers in order', () => {
    expect([...PUBLIC_TRACKERS]).toEqual([
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.webtorrent.dev',
      'wss://open.ftorrent.com',
    ]);
  });

  it('pins the five Nostr relays and redundancy 6', () => {
    expect([...PUBLIC_NOSTR_RELAYS]).toEqual([
      'wss://nos.lol',
      'wss://relay.damus.io',
      'wss://purplerelay.com',
      'wss://yabu.me/v2',
      'wss://nostr.data.haus',
    ]);
    expect(NOSTR_REDUNDANCY).toBe(6);
  });

  it('uses only the two public STUN servers and returns fresh copies', () => {
    expect([...PUBLIC_STUN_URLS]).toEqual(['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']);
    const a = publicIceServers();
    a.push({ urls: 'turn:x' });
    expect(publicIceServers()).toHaveLength(2);
    expect(Object.isFrozen(PUBLIC_TRACKERS) && Object.isFrozen(PUBLIC_NOSTR_RELAYS)).toBe(true);
  });

  it('every service named here is named in NETWORKING.md §3 when the doc is present', () => {
    let doc = '';
    try {
      doc = readFileSync(new URL('../NETWORKING.md', import.meta.url), 'utf8');
    } catch {
      return; // design doc not merged into this branch yet
    }
    for (const url of [...PUBLIC_TRACKERS, ...PUBLIC_NOSTR_RELAYS]) expect(doc).toContain(url);
    expect(doc).toContain('stun.cloudflare.com');
    expect(doc).toContain('stun.l.google.com');
  });

  it('matches the pinned Trystero packages in package.json (exact 0.25.4, runtime deps)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(TRYSTERO_VERSION).toBe('0.25.4');
    expect(pkg.dependencies['@trystero-p2p/torrent']).toBe('0.25.4');
    expect(pkg.dependencies['@trystero-p2p/nostr']).toBe('0.25.4');
    expect(pkg.dependencies.trystero).toBeUndefined();
    expect(pkg.dependencies['node-datachannel']).toBeUndefined();
    expect(pkg.devDependencies?.['node-datachannel']).toBeUndefined();
    expect(TRYSTERO_APP_ID).toBe('sprinkle-kart');
  });

  it('parseRelayList keeps ws/wss urls only (dev override)', () => {
    expect(parseRelayList('ws://localhost:8000, wss://a.example/x ,http://bad,  ,javascript:alert(1)')).toEqual([
      'ws://localhost:8000',
      'wss://a.example/x',
    ]);
    expect(parseRelayList('http://nope')).toBeNull();
    expect(parseRelayList('')).toBeNull();
    expect(parseRelayList(null)).toBeNull();
    expect(parseRelayList(Array(20).fill('ws://a').join(','))).toHaveLength(8);
  });
});

describe('signaling types', () => {
  it('SignalingError keeps binding codes and folds unknown ones into unreachable', () => {
    for (const code of SIGNALING_ERROR_CODES) {
      const e = new SignalingError(code);
      expect(e.code).toBe(code);
      expect(e).toBeInstanceOf(Error);
      expect(isSignalingError(e)).toBe(true);
    }
    const odd = new SignalingError('weird');
    expect(odd.code).toBe('unreachable');
    expect(odd.detail).toBe('weird');
    expect(isSignalingError(new Error('x'))).toBe(false);
    expect(isSignalingError(null)).toBe(false);
  });

  it('maps every Worker error code (§4.2) to a SignalingError', () => {
    const table = {
      full: 'full',
      'no-host': 'no-host',
      'host-exists': 'host-exists',
      locked: 'locked',
      rate: 'rate',
      'bad-origin': 'bad-origin',
      proto: 'unreachable',
      mystery: 'unreachable',
    };
    for (const [w, s] of Object.entries(table)) {
      const e = workerErrorToSignalingError(w);
      expect(e.code).toBe(s);
      expect(e.kind).toBe('worker');
    }
    expect(workerErrorToSignalingError('proto').detail).toBe('proto');
    expect(workerErrorToSignalingError(42).code).toBe('unreachable');
  });

  it('createListeners isolates throwing listeners and unsubscribes', () => {
    const l = createListeners();
    const seen = [];
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    l.add(() => {
      throw new Error('boom');
    });
    const off = l.add((x) => seen.push(x));
    l.emit(1);
    off();
    l.emit(2);
    expect(seen).toEqual([1]);
    expect(err).toHaveBeenCalled();
    expect(l.size).toBe(1);
    l.clear();
    expect(l.size).toBe(0);
    err.mockRestore();
  });

  it('peer ids are 16 hex chars', () => {
    const id = makePeerId();
    expect(isPeerId(id)).toBe(true);
    let i = 0;
    expect(makePeerId(() => (i++ % 16) / 16)).toMatch(/^[0-9a-f]{16}$/);
    expect(isPeerId('ABC')).toBe(false);
    expect(isPeerId(12)).toBe(false);
  });
});
