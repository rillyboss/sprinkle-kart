// Origin checks on /room/:code (browsers don't apply CORS to WebSocket upgrades) and the dev wildcard.
import { describe, it, expect, inject } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';
import { CLOSE_CODES } from '../src/room.js';
import {
  roomCode, peerId, freshIp, connect, wrapSocket, PROD_ORIGIN,
} from './helpers.js';

async function expectBadOrigin(client) {
  expect(await client.next()).toEqual({ t: 'error', code: 'bad-origin' });
  expect((await client.closed()).code).toBe(CLOSE_CODES['bad-origin']);
}

/** Open a room socket through the Worker's fetch handler with a different ALLOWED_ORIGINS. */
async function connectWith(allowed, origin, role = 'host') {
  const req = new Request(`https://signal.test/room/${roomCode()}?role=${role}&peer=${peerId()}&proto=1`, {
    headers: { Upgrade: 'websocket', Origin: origin, 'CF-Connecting-IP': freshIp() },
  });
  const res = await worker.fetch(req, { ...env, ALLOWED_ORIGINS: allowed });
  expect(res.status).toBe(101);
  return wrapSocket(res.webSocket);
}

describe('production ALLOWED_ORIGINS', () => {
  it('is exactly the binding value from wrangler.toml', () => {
    expect(inject('prodAllowedOrigins')).toBe('https://rillyboss.github.io,http://localhost:5173');
    expect(env.ALLOWED_ORIGINS).toBe(inject('prodAllowedOrigins'));
  });

  it('accepts the Pages origin and the default Vite dev origin', async () => {
    for (const origin of [PROD_ORIGIN, 'http://localhost:5173']) {
      const host = await connect(roomCode(), { role: 'host', origin });
      expect((await host.next()).t, origin).toBe('joined');
      host.close();
    }
  });

  it.each([
    ['another website', 'https://evil.example'],
    ['another localhost port (dev wildcard is NOT in production)', 'http://localhost:5174'],
    ['127.0.0.1 (not listed in production)', 'http://127.0.0.1:5173'],
    ['a look-alike host', 'https://rillyboss.github.io.evil.example'],
    ['http instead of https', 'http://rillyboss.github.io'],
    ['a path on the origin', 'https://rillyboss.github.io/sprinkle-kart'],
    ['the opaque origin', 'null'],
  ])('rejects %s with bad-origin', async (_label, origin) => {
    await expectBadOrigin(await connect(roomCode(), { role: 'host', origin }));
  });

  it('rejects a missing Origin with bad-origin', async () => {
    await expectBadOrigin(await connect(roomCode(), { role: 'host', origin: null }));
  });

  it('sends no CORS headers on /room', async () => {
    const c = await connect(roomCode(), { role: 'host' });
    expect(c.res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const bad = await connect(roomCode(), { role: 'host', origin: 'https://evil.example' });
    expect(bad.res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('local dev ALLOWED_ORIGINS (.dev.vars.example)', () => {
  const dev = inject('devAllowedOrigins');

  it('is the any-port localhost / 127.0.0.1 value', () => {
    expect(dev).toBe('http://localhost:*,http://127.0.0.1:*');
  });

  it.each(['http://localhost:5174', 'http://localhost:5625', 'http://127.0.0.1:4173', 'http://localhost:8792'])(
    'accepts %s',
    async (origin) => {
      const c = await connectWith(dev, origin);
      expect((await c.next()).t).toBe('joined');
      c.close();
    },
  );

  it.each([
    'https://rillyboss.github.io', // not in the dev value
    'https://localhost:5174', // wrong scheme for the wildcard
    'http://evil.localhost:5174',
    'http://localhost.evil.example:5174',
    'http://192.168.1.20:5173',
  ])('rejects %s', async (origin) => {
    await expectBadOrigin(await connectWith(dev, origin));
  });

  it('ignores a wildcard for any other host', async () => {
    await expectBadOrigin(await connectWith('https://*.github.io,https://rillyboss.github.io:*,*', 'https://rillyboss.github.io'));
    await expectBadOrigin(await connectWith('https://*.github.io', 'https://evil.github.io'));
  });
});
