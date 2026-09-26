// TURN credentials: GET /ice (Check connection only) and the room's joined / ice messages.
import { describe, it, expect, beforeEach } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import worker from '../src/index.js';
import { TURN_DAILY_MINTS, TURN_TTL_ICE, TURN_TTL_ROOM, STUN_URLS } from '../src/turn.js';
import { GUARD_LIMITS, utcDay } from '../src/guard.js';
import {
  get, freshIp, join, hostedRoom, roomCode, guardStub, mockReset, mockLog, mockMode, settle, PROD_ORIGIN,
} from './helpers.js';

const urls = (iceServers) => iceServers.flatMap((s) => s.urls);
const relayUser = (iceServers) => iceServers.find((s) => s.username)?.username ?? null;
const ice = (ip, origin = PROD_ORIGIN) => get('/ice', origin ? { Origin: origin, 'CF-Connecting-IP': ip } : { 'CF-Connecting-IP': ip });

async function setGuard(state) {
  await runInDurableObject(guardStub(), (inst) => inst.kvPut('guard', state));
}
const resetGuard = () => runInDurableObject(guardStub(), (_i, s) => { s.storage.sql.exec("DELETE FROM kv WHERE k = 'guard'"); });

beforeEach(async () => {
  await mockReset();
  await resetGuard();
});

describe('GET /ice', () => {
  it('mints fresh TURN creds with ttl 900 through the TURN API, and filters :53', async () => {
    const res = await ice(freshIp());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PROD_ORIGIN);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.turn).toBe(true);
    for (const u of STUN_URLS) expect(urls(body.iceServers)).toContain(u);
    expect(urls(body.iceServers).filter((u) => /:53(\?|$)/.test(u))).toEqual([]);
    expect(relayUser(body.iceServers)).toMatch(/^mock-user-/);
    const log = await mockLog();
    expect(log).toEqual([{ keyId: 'test-turn-key-id', auth: 'Bearer test-turn-api-token', body: { ttl: TURN_TTL_ICE } }]);
    expect(TURN_TTL_ICE).toBeLessThanOrEqual(900);
  });

  it('never caches across callers', async () => {
    const a = await (await ice(freshIp())).json();
    const b = await (await ice(freshIp())).json();
    expect(relayUser(a.iceServers)).not.toBe(relayUser(b.iceServers));
    expect(await mockLog()).toHaveLength(2);
  });

  it(`is limited to ${GUARD_LIMITS.ice}/min per address`, async () => {
    const ip = freshIp();
    for (let i = 0; i < GUARD_LIMITS.ice; i++) expect((await ice(ip)).status, `call ${i}`).toBe(200);
    const over = await ice(ip);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ ok: false, error: 'rate' });
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(over.headers.get('Access-Control-Allow-Origin')).toBe(PROD_ORIGIN); // the page can read "slow down"
    expect(await mockLog()).toHaveLength(GUARD_LIMITS.ice); // the refused call minted nothing
    expect((await ice(freshIp())).status).toBe(200); // someone else is fine
  });

  it('requires an allowed Origin (a TURN mint is not for other websites)', async () => {
    for (const origin of ['https://evil.example', 'http://localhost:5174', null]) {
      const res = await ice(freshIp(), origin);
      expect(res.status, String(origin)).toBe(403);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    expect(await mockLog()).toEqual([]);
  });

  it('answers STUN only (turn false) without the secrets, and never calls the TURN API', async () => {
    const req = new Request('https://signal.test/ice', { headers: { Origin: PROD_ORIGIN, 'CF-Connecting-IP': freshIp() } });
    const body = await (await worker.fetch(req, { ...env, TURN_KEY_API_TOKEN: undefined })).json();
    expect(body).toEqual({ iceServers: [{ urls: [...STUN_URLS] }], turn: false });
    expect(await mockLog()).toEqual([]);
  });

  it('answers STUN only when the TURN API fails', async () => {
    await mockMode('fail');
    const body = await (await ice(freshIp())).json();
    expect(body).toEqual({ iceServers: [{ urls: [...STUN_URLS] }], turn: false });
  });

  it('uses one mint from the daily cap per call, and stops at the cap', async () => {
    await ice(freshIp());
    expect((await guardStub().guard('status')).mintsLeft).toBe(TURN_DAILY_MINTS - 1);
    await setGuard({ day: utcDay(Date.now()), mints: TURN_DAILY_MINTS, hits: {} });
    await mockReset();
    const body = await (await ice(freshIp())).json();
    expect(body.turn).toBe(false);
    expect(await mockLog()).toEqual([]);
    expect((await (await get('/health')).json()).turn).toBe(false);
  });
});

describe('room TURN credentials', () => {
  it('mint with ttl 1800 once per room and are reused inside that room only', async () => {
    const one = await hostedRoom(2);
    const two = await hostedRoom(1);
    const log = await mockLog();
    expect(log).toHaveLength(2); // one mint per room, however many sockets
    for (const entry of log) expect(entry.body).toEqual({ ttl: TURN_TTL_ROOM });
    expect(TURN_TTL_ROOM).toBeLessThanOrEqual(1800);
    const u1 = relayUser(one.host.first.iceServers);
    expect(relayUser(one.guests[0].first.iceServers)).toBe(u1);
    expect(relayUser(one.guests[1].first.iceServers)).toBe(u1);
    const u2 = relayUser(two.host.first.iceServers);
    expect(u2).not.toBe(u1); // never shared across rooms
    expect(relayUser(two.guests[0].first.iceServers)).toBe(u2);
  });

  it('a guest refused by a host-less room never receives TURN', async () => {
    const g = await join(roomCode(), { role: 'guest' });
    expect(g.first).toEqual({ t: 'error', code: 'no-host' });
    expect(await mockLog()).toEqual([]);
  });

  it('rooms get STUN only (turn false) once the daily cap is reached', async () => {
    await setGuard({ day: utcDay(Date.now()), mints: TURN_DAILY_MINTS, hits: {} });
    const { host, guests: [g] } = await hostedRoom(1);
    expect(host.first).toMatchObject({ turn: false, iceServers: [{ urls: [...STUN_URLS] }] });
    expect(g.first.turn).toBe(false);
    expect(await mockLog()).toEqual([]);
  });

  it('rooms get STUN only when the TURN API fails, and can still signal', async () => {
    await mockMode('fail');
    const { host, guests: [g] } = await hostedRoom(1);
    expect(host.first.turn).toBe(false);
    g.send({ t: 'signal', to: host.peer, data: 'hi' });
    expect(await host.next()).toEqual({ t: 'signal', from: g.peer, data: 'hi' });
  });

  it('{ t: "ice" } answers with the room creds; a second ask within 30 s never mints', async () => {
    const { host } = await hostedRoom();
    host.send({ t: 'ice' });
    const a = await host.next();
    expect(a.t).toBe('ice');
    expect(a.turn).toBe(true);
    expect(relayUser(a.iceServers)).toBe(relayUser(host.first.iceServers));
    expect(urls(a.iceServers).filter((u) => /:53(\?|$)/.test(u))).toEqual([]);
    host.send({ t: 'ice' });
    const b = await host.next();
    expect(b.t).toBe('ice');
    expect(await mockLog()).toHaveLength(1);
  });

  it('{ t: "ice" } mints again once the 5-minute room cache has expired (and the 30 s gap passed)', async () => {
    const { code, host } = await hostedRoom();
    const stub = env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(code));
    await runInDurableObject(stub, (inst) => {
      inst.iceCache.at -= 5 * 60 * 1000 + 1;
      for (const e of inst.eph.values()) e.lastIce -= 31_000;
    });
    host.send({ t: 'ice' });
    const fresh = await host.next();
    expect(fresh.turn).toBe(true);
    expect(relayUser(fresh.iceServers)).not.toBe(relayUser(host.first.iceServers));
    expect(await mockLog()).toHaveLength(2);
  });

  it('an ice ask inside 30 s with an expired cache gets STUN only (no mint)', async () => {
    const { code, host } = await hostedRoom();
    const stub = env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(code));
    await runInDurableObject(stub, (inst) => { inst.iceCache = null; });
    host.send({ t: 'ice' });
    expect(await host.next()).toEqual({ t: 'ice', iceServers: [{ urls: [...STUN_URLS] }], turn: false });
    expect(await mockLog()).toHaveLength(1);
  });
});

describe('global guard', () => {
  it(`caps room joins at ${GUARD_LIMITS.join}/min per address across rooms, even with a forged Origin`, async () => {
    const ip = freshIp();
    for (let i = 0; i < GUARD_LIMITS.join; i++) {
      const h = await join(roomCode(), { role: 'host', ip, origin: PROD_ORIGIN });
      expect(h.first.t, `join ${i}`).toBe('joined');
      h.close();
    }
    const over = await join(roomCode(), { role: 'host', ip, origin: PROD_ORIGIN });
    expect(over.first).toEqual({ t: 'error', code: 'rate' });
    const other = await join(roomCode(), { role: 'host', ip: freshIp() });
    expect(other.first.t).toBe('joined');
    await settle();
  });

  it('stores only salted hashes, never raw addresses', async () => {
    const ip = '203.0.113.99';
    await join(roomCode(), { role: 'host', ip });
    await ice(ip);
    const dump = await runInDurableObject(guardStub(), (_i, s) => JSON.stringify(s.storage.sql.exec('SELECT k, v FROM kv').toArray()));
    expect(dump).not.toContain(ip);
    expect(dump).toMatch(/join:[0-9a-f]{32}/);
    expect(dump).toMatch(/ice:[0-9a-f]{32}/);
  });

  it('rotates the hashing salt every UTC day', async () => {
    const salt1 = await runInDurableObject(guardStub(), (inst) => inst.dailySalt(Date.parse('2026-09-26T10:00:00Z')));
    const same = await runInDurableObject(guardStub(), (inst) => inst.dailySalt(Date.parse('2026-09-26T23:59:00Z')));
    const salt2 = await runInDurableObject(guardStub(), (inst) => inst.dailySalt(Date.parse('2026-09-27T00:01:00Z')));
    expect(same).toBe(salt1);
    expect(salt2).not.toBe(salt1);
    expect(salt1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuses unknown guard operations', async () => {
    expect(await guardStub().guard('delete-everything', '1.2.3.4')).toEqual({ allow: false });
  });
});
