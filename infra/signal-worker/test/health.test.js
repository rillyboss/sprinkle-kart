// GET /health: shape, TURN flag, CORS scope, method and route handling.
import { describe, it, expect, beforeEach } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import worker from '../src/index.js';
import { VERSION } from '../src/http.js';
import { TURN_DAILY_MINTS } from '../src/turn.js';
import { utcDay } from '../src/guard.js';
import {
  get, guardStub, PROD_ORIGIN, mockReset,
} from './helpers.js';

async function resetGuard() {
  await runInDurableObject(guardStub(), async (_inst, state) => {
    state.storage.sql.exec("DELETE FROM kv WHERE k = 'guard'");
  });
}

async function setMints(n) {
  await runInDurableObject(guardStub(), async (inst) => {
    inst.kvPut('guard', { day: utcDay(Date.now()), mints: n, hits: {} });
  });
}

/** Call the Worker's fetch handler directly with a modified env (e.g. secrets missing). */
function fetchWith(envPatch, path, headers = {}) {
  return worker.fetch(new Request(`https://signal.test${path}`, { headers }), { ...env, ...envPatch });
}

describe('GET /health', () => {
  beforeEach(async () => {
    await resetGuard();
    await mockReset();
  });

  it('answers { ok, turn, version } and nothing else', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['ok', 'turn', 'version']);
    expect(body).toEqual({ ok: true, turn: true, version: VERSION });
    expect(typeof body.version).toBe('string');
  });

  it('turn is true only when BOTH secrets are set', async () => {
    for (const patch of [
      { TURN_KEY_ID: undefined },
      { TURN_KEY_API_TOKEN: undefined },
      { TURN_KEY_ID: undefined, TURN_KEY_API_TOKEN: undefined },
      { TURN_KEY_ID: '', TURN_KEY_API_TOKEN: 'x' },
      { TURN_KEY_ID: '   ' },
    ]) {
      const body = await (await fetchWith(patch, '/health')).json();
      expect(body, JSON.stringify(patch)).toEqual({ ok: true, turn: false, version: VERSION });
    }
    expect((await (await fetchWith({}, '/health')).json()).turn).toBe(true);
  });

  it('turn flips to false when the daily mint cap is reached, and back on a new UTC day', async () => {
    await setMints(TURN_DAILY_MINTS - 1);
    expect((await (await get('/health')).json()).turn).toBe(true);
    await setMints(TURN_DAILY_MINTS);
    expect((await (await get('/health')).json()).turn).toBe(false);
    // Yesterday's full cap does not count today.
    await runInDurableObject(guardStub(), async (inst) => {
      inst.kvPut('guard', { day: '2000-01-01', mints: TURN_DAILY_MINTS, hits: {} });
    });
    expect((await (await get('/health')).json()).turn).toBe(true);
  });

  it('checking /health never uses up a mint', async () => {
    for (let i = 0; i < 5; i++) await get('/health');
    const left = await guardStub().guard('status');
    expect(left.mintsLeft).toBe(TURN_DAILY_MINTS);
  });

  it('sends CORS headers only to allowed origins', async () => {
    const ok = await get('/health', { Origin: PROD_ORIGIN });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(PROD_ORIGIN);
    expect(ok.headers.get('Vary')).toBe('Origin');
    const dev = await get('/health', { Origin: 'http://localhost:5173' });
    expect(dev.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    for (const origin of ['https://evil.example', 'http://localhost:5174', 'https://rillyboss.github.io.evil.example', 'null']) {
      const res = await get('/health', { Origin: origin });
      expect(res.status, origin).toBe(200); // still answers (curl-friendly), just without CORS
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBeNull();
    }
    expect((await get('/health')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers a CORS preflight for allowed origins only', async () => {
    const pre = await get('/health', { Origin: PROD_ORIGIN, 'Access-Control-Request-Method': 'GET' }, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(PROD_ORIGIN);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    const bad = await get('/health', { Origin: 'https://evil.example' }, { method: 'OPTIONS' });
    expect(bad.status).toBe(204);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('refuses other methods and unknown paths, without CORS', async () => {
    const post = await get('/health', { Origin: PROD_ORIGIN }, { method: 'POST' });
    expect(post.status).toBe(405);
    for (const path of ['/', '/nope', '/healthz', '/room', '/ice/extra']) {
      const res = await get(path, { Origin: PROD_ORIGIN });
      expect(res.status, path).toBe(404);
      expect(res.headers.get('Access-Control-Allow-Origin'), path).toBeNull();
    }
  });
});
