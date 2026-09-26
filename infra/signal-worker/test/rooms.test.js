// GET /rooms: the open-games list ("Games you can join", NETWORKING.md §4.2) end to end through the Worker,
// a room's Durable Object and the reserved 'lobby' instance, in the real Workers runtime.
import { describe, it, expect, beforeEach } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { roomIdForCode } from '../src/codes.js';
import {
  join, peerId, freshIp, get, PROD_ORIGIN, mockReset, settle,
} from './helpers.js';

const lobbyStub = () => env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName('lobby'));

async function resetLobby() {
  await runInDurableObject(lobbyStub(), async (_inst, state) => {
    state.storage.sql.exec("DELETE FROM kv WHERE k = 'registry'");
  });
}

async function listRooms(ip = freshIp()) {
  const res = await get('/rooms', { Origin: PROD_ORIGIN, 'CF-Connecting-IP': ip });
  expect(res.status).toBe(200);
  return (await res.json()).rooms;
}

/** Host a room for `code` with listing parameters. */
async function hostListed(code, extra = '') {
  const room = await roomIdForCode(code);
  const peer = peerId();
  const host = await join(room, { role: 'host', peer, query: `role=host&peer=${peer}&proto=1&code=${code}${extra}` });
  expect(host.first).toMatchObject({ t: 'joined', list: true });
  await settle();
  return { room, host };
}

describe('GET /rooms', () => {
  beforeEach(async () => {
    await mockReset();
    await resetLobby();
  });

  it('lists a hosted room with its code, racer and player count, with CORS for allowed origins', async () => {
    await hostListed('CAKE', '&who=luna&players=2');
    const res = await get('/rooms', { Origin: PROD_ORIGIN, 'CF-Connecting-IP': freshIp() });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PROD_ORIGIN);
    const { rooms } = await res.json();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ code: 'CAKE', who: 'luna', players: 2 });
  });

  it('drops the room when the host leaves, hides it on lock and on { t: "list", on: false }', async () => {
    const { host } = await hostListed('BUNS');
    expect((await listRooms()).map((r) => r.code)).toEqual(['BUNS']);
    host.send({ t: 'lock', locked: true });
    await settle();
    expect(await listRooms()).toEqual([]);
    host.send({ t: 'lock', locked: false });
    await settle();
    expect((await listRooms()).map((r) => r.code)).toEqual(['BUNS']);
    host.send({ t: 'list', on: false });
    await settle();
    expect(await listRooms()).toEqual([]);
    host.send({ t: 'list', on: true, players: 4 });
    await settle();
    expect((await listRooms())[0]).toMatchObject({ code: 'BUNS', players: 4 });
    host.close();
    await settle(80);
    expect(await listRooms()).toEqual([]);
  });

  it('a code that does not belong to the room is never listed', async () => {
    const other = await roomIdForCode('MUFF');
    const peer = peerId();
    const host = await join(other, { role: 'host', peer, query: `role=host&peer=${peer}&proto=1&code=CAKE` });
    expect(host.first.t).toBe('joined');
    await settle();
    expect(await listRooms()).toEqual([]);
  });

  it('a hidden room (list=0) and a room without a code stay off the list', async () => {
    await hostListed('TART', '&list=0');
    const plain = await join(await roomIdForCode('PUDS'), { role: 'host' });
    expect(plain.first.t).toBe('joined');
    await settle();
    expect(await listRooms()).toEqual([]);
  });

  it('is rate-limited per IP and refuses other origins', async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++) await listRooms(ip);
    const res = await get('/rooms', { Origin: PROD_ORIGIN, 'CF-Connecting-IP': ip });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    const bad = await get('/rooms', { Origin: 'https://evil.example', 'CF-Connecting-IP': freshIp() });
    expect(bad.status).toBe(403);
  });
});
