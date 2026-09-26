// Origin matching and TURN helpers of the signal worker (infra/signal-worker/src/{origin,turn}.js), in the
// main suite on any Node. The Worker-level behaviour is covered by `npm run worker:test`.
import { describe, it, expect, vi } from 'vitest';
import { parseAllowedOrigins, isOriginAllowed, corsHeaders } from '../infra/signal-worker/src/origin.js';
import {
  mintTurn, filterPort53, isPort53, turnConfigured, turnEndpoint, withStun, stunServers, turnOnly,
  STUN_URLS, TURN_TTL_ROOM, TURN_TTL_ICE, TURN_CACHE_MS, TURN_DAILY_MINTS, DEFAULT_TURN_API_BASE,
} from '../infra/signal-worker/src/turn.js';

const PROD = 'https://rillyboss.github.io,http://localhost:5173';
const DEV = 'http://localhost:*,http://127.0.0.1:*';

describe('isOriginAllowed: production value', () => {
  it.each(['https://rillyboss.github.io', 'http://localhost:5173'])('allows %s', (o) => {
    expect(isOriginAllowed(o, PROD)).toBe(true);
  });

  it.each([
    'http://localhost:5174', 'http://127.0.0.1:5173', 'http://rillyboss.github.io', 'https://rillyboss.github.io:8443',
    'https://evil.example', 'https://rillyboss.github.io.evil.example', 'https://RILLYBOSS.github.io',
    'https://rillyboss.github.io/', 'https://rillyboss.github.io/sprinkle-kart', 'null', '', undefined, null,
    'file://', 'chrome-extension://abc',
  ])('refuses %s', (o) => {
    expect(isOriginAllowed(o, PROD)).toBe(false);
  });
});

describe('isOriginAllowed: dev wildcard', () => {
  it.each(['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5625', 'http://127.0.0.1:4173', 'http://localhost'])(
    'allows %s',
    (o) => expect(isOriginAllowed(o, DEV)).toBe(true),
  );

  it.each(['https://localhost:5174', 'http://evil.localhost:5174', 'http://localhost.evil.example:1', 'http://192.168.1.2:5173', 'https://rillyboss.github.io'])(
    'refuses %s',
    (o) => expect(isOriginAllowed(o, DEV)).toBe(false),
  );

  it('only honours :* for localhost and 127.0.0.1; every other wildcard is ignored', () => {
    expect(parseAllowedOrigins('https://*.github.io,https://rillyboss.github.io:*,*,http://*:*,http://0.0.0.0:*')).toEqual([]);
    expect(parseAllowedOrigins(DEV)).toEqual([
      { kind: 'any-port', protocol: 'http:', hostname: 'localhost' },
      { kind: 'any-port', protocol: 'http:', hostname: '127.0.0.1' },
    ]);
    expect(isOriginAllowed('https://evil.github.io', 'https://*.github.io')).toBe(false);
    expect(isOriginAllowed('https://rillyboss.github.io', 'https://rillyboss.github.io:*')).toBe(false);
  });

  it('parses spaces and empty entries, and exact entries', () => {
    expect(parseAllowedOrigins(' https://a.example , ,http://localhost:5173 ')).toEqual([
      { kind: 'exact', origin: 'https://a.example' },
      { kind: 'exact', origin: 'http://localhost:5173' },
    ]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('corsHeaders', () => {
  it('echoes an allowed origin with Vary: Origin', () => {
    expect(corsHeaders('https://rillyboss.github.io', PROD)).toEqual({
      'Access-Control-Allow-Origin': 'https://rillyboss.github.io',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    });
  });

  it('is empty for anything else (never a * wildcard)', () => {
    expect(corsHeaders('https://evil.example', PROD)).toEqual({});
    expect(corsHeaders(null, PROD)).toEqual({});
  });
});

describe('TURN helpers', () => {
  it('has the binding TTLs, cache and cap', () => {
    expect(TURN_TTL_ROOM).toBe(1800);
    expect(TURN_TTL_ICE).toBe(900);
    expect(TURN_CACHE_MS).toBe(5 * 60 * 1000);
    expect(TURN_DAILY_MINTS).toBe(500);
    expect(DEFAULT_TURN_API_BASE).toBe('https://rtc.live.cloudflare.com');
    expect([...STUN_URLS]).toEqual(['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']);
  });

  it('recognises :53 URLs', () => {
    for (const u of ['turn:turn.cloudflare.com:53?transport=udp', 'stun:stun.cloudflare.com:53', 'turns:x:53?transport=tcp']) expect(isPort53(u), u).toBe(true);
    for (const u of ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turn:x:5353', 'turn:x:530']) expect(isPort53(u), u).toBe(false);
  });

  it('filters :53 URLs and drops servers left empty, keeping credentials', () => {
    expect(filterPort53([
      { urls: ['stun:a:3478', 'stun:a:53'] },
      { urls: 'turn:b:53?transport=udp', username: 'u', credential: 'c' },
      { urls: ['turn:b:3478?transport=udp', 'turn:b:53?transport=udp'], username: 'u', credential: 'c' },
      null, 'junk', { urls: [42] },
    ])).toEqual([
      { urls: ['stun:a:3478'] },
      { urls: ['turn:b:3478?transport=udp'], username: 'u', credential: 'c' },
    ]);
    expect(filterPort53(undefined)).toEqual([]);
  });

  it('turnOnly keeps credentialed servers; withStun prepends public STUN', () => {
    const relay = { urls: ['turn:b:3478'], username: 'u', credential: 'c' };
    expect(turnOnly([{ urls: ['stun:a'] }, relay])).toEqual([relay]);
    expect(withStun([relay])).toEqual([...stunServers(), relay]);
    expect(withStun()).toEqual(stunServers());
  });

  it('needs both secrets, non-empty', () => {
    expect(turnConfigured({ TURN_KEY_ID: 'k', TURN_KEY_API_TOKEN: 't' })).toBe(true);
    for (const env of [{}, { TURN_KEY_ID: 'k' }, { TURN_KEY_API_TOKEN: 't' }, { TURN_KEY_ID: ' ', TURN_KEY_API_TOKEN: 't' }, null]) {
      expect(turnConfigured(env)).toBe(false);
    }
  });

  it('builds the Cloudflare generate-ice-servers endpoint from TURN_API_BASE', () => {
    expect(turnEndpoint({ TURN_KEY_ID: 'abc' })).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/abc/credentials/generate-ice-servers');
    expect(turnEndpoint({ TURN_KEY_ID: 'a/b', TURN_API_BASE: 'http://127.0.0.1:9/' })).toBe('http://127.0.0.1:9/v1/turn/keys/a%2Fb/credentials/generate-ice-servers');
  });
});

describe('mintTurn (injected fetch)', () => {
  const env = { TURN_KEY_ID: 'key-1', TURN_KEY_API_TOKEN: 'tok-1', TURN_API_BASE: 'http://mock' };
  const answer = {
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' },
    ],
  };
  const okFetch = () => vi.fn(async () => ({ ok: true, status: 201, json: async () => answer }));

  it('POSTs {ttl} with the Bearer token and returns filtered relay servers', async () => {
    const f = okFetch();
    const servers = await mintTurn(env, { ttl: 1800, fetchImpl: f });
    expect(servers).toEqual([{ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' }]);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://mock/v1/turn/keys/key-1/credentials/generate-ice-servers');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(init.body)).toEqual({ ttl: 1800 });
  });

  it('refuses ttl above 1800 or not a positive integer, and missing secrets', async () => {
    for (const ttl of [1801, 86400, 0, -5, 1.5, undefined]) await expect(mintTurn(env, { ttl, fetchImpl: okFetch() }), String(ttl)).rejects.toThrow();
    await expect(mintTurn({ TURN_KEY_ID: 'k' }, { ttl: 900, fetchImpl: okFetch() })).rejects.toThrow();
  });

  it('throws on an HTTP failure or an answer without relay servers', async () => {
    await expect(mintTurn(env, { ttl: 900, fetchImpl: async () => ({ ok: false, status: 401 }) })).rejects.toThrow('401');
    await expect(mintTurn(env, { ttl: 900, fetchImpl: async () => ({ ok: true, json: async () => ({ iceServers: [{ urls: ['stun:x:3478'] }] }) }) })).rejects.toThrow();
    await expect(mintTurn(env, { ttl: 900, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) })).rejects.toThrow();
  });
});
