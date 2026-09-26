// GET /room/:code: the WebSocket signaling protocol of NETWORKING.md §4.2, end to end through the Worker and
// the SignalRoom Durable Object (hibernation API) in the real Workers runtime.
import { describe, it, expect, beforeEach } from 'vitest';
import { runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import {
  CLOSE_CODES, MAX_GUESTS, GUEST_JOINS_PER_MIN, MAX_MSG_BYTES, MSGS_PER_SEC, ROOM_GC_MS,
} from '../src/room.js';
import { STUN_URLS } from '../src/turn.js';
import {
  roomCode, peerId, freshIp, connect, join, hostedRoom, roomStub, mockReset, settle, get, PROD_ORIGIN,
} from './helpers.js';

const expectError = async (client, code) => {
  // A refused join's first message is the error; a joined socket that misbehaves gets it as a later message.
  const msg = client.first && client.first.t !== 'joined' ? client.first : await client.next();
  expect(msg).toEqual({ t: 'error', code });
  const closed = await client.closed();
  expect(closed.code).toBe(CLOSE_CODES[code]);
  expect(closed.reason).toBe(code);
};

const allUrls = (iceServers) => iceServers.flatMap((s) => s.urls);

describe('room lifecycle', () => {
  beforeEach(mockReset);

  it('the host creates the room and gets joined with STUN + TURN', async () => {
    const code = roomCode();
    const host = await join(code, { role: 'host' });
    expect(host.first).toMatchObject({ t: 'joined', you: host.peer, host: host.peer, peers: [], turn: true });
    const urls = allUrls(host.first.iceServers);
    for (const u of STUN_URLS) expect(urls).toContain(u);
    expect(urls.some((u) => u.startsWith('turn:'))).toBe(true);
    expect(urls.some((u) => u.startsWith('turns:'))).toBe(true);
    expect(urls.filter((u) => /:53(\?|$)/.test(u))).toEqual([]);
    const relay = host.first.iceServers.find((s) => s.username);
    expect(relay.credential).toMatch(/^mock-cred-/);
  });

  it('a guest before any host gets no-host', async () => {
    const g = await join(roomCode(), { role: 'guest' });
    await expectError(g, 'no-host');
  });

  it('a second host gets host-exists; the first host is unaffected', async () => {
    const { code, host } = await hostedRoom();
    const h2 = await join(code, { role: 'host' });
    await expectError(h2, 'host-exists');
    host.send('ping');
    expect(await host.next()).toBe('pong');
  });

  it('guests learn only about the host; the host hears peer-join and peer-leave', async () => {
    const { host, guests: [a, b] } = await hostedRoom(2);
    expect(a.first).toMatchObject({ t: 'joined', you: a.peer, host: host.peer, peers: [], turn: true });
    expect(b.first.peers).toEqual([]);
    b.close();
    expect(await host.next()).toEqual({ t: 'peer-leave', peer: b.peer });
    expect(await a.maybeNext()).toBeNull(); // guests are never told about other guests
  });

  it('relays signals host ⇄ guest, and a guest can only address the host', async () => {
    const { host, guests: [a, b] } = await hostedRoom(2);
    a.send({ t: 'signal', to: host.peer, data: { sdp: 'offer-a' } });
    expect(await host.next()).toEqual({ t: 'signal', from: a.peer, data: { sdp: 'offer-a' } });
    host.send({ t: 'signal', to: a.peer, data: { sdp: 'answer-a' } });
    expect(await a.next()).toEqual({ t: 'signal', from: host.peer, data: { sdp: 'answer-a' } });
    a.send({ t: 'signal', to: b.peer, data: 'sneaky' }); // guest → guest: dropped
    a.send({ t: 'signal', to: a.peer, data: 'self' }); // to self: dropped
    a.send({ t: 'signal', to: peerId(), data: 'gone' }); // unknown (just left): dropped, not an error
    expect(await b.maybeNext()).toBeNull();
    expect(await a.maybeNext()).toBeNull();
    a.send('ping');
    expect(await a.next()).toBe('pong'); // still connected
  });

  it('a host leaving frees the slot; a new host sees the waiting guests', async () => {
    const { code, host, guests: [a] } = await hostedRoom(1);
    host.close();
    await settle(50);
    const h2 = await join(code, { role: 'host' });
    expect(h2.first).toMatchObject({ t: 'joined', host: h2.peer, peers: [a.peer] });
  });

  it('the same peer id reconnecting replaces its old socket', async () => {
    const { code, host, guests: [a] } = await hostedRoom(1);
    const again = await join(code, { role: 'guest', peer: a.peer });
    expect(again.first).toMatchObject({ t: 'joined', you: a.peer });
    expect((await a.closed()).code).toBe(CLOSE_CODES.replaced);
    expect(await host.maybeNext()).toBeNull(); // no spurious peer-leave / peer-join for a replacement
    again.send({ t: 'signal', to: host.peer, data: 1 });
    expect(await host.next()).toEqual({ t: 'signal', from: a.peer, data: 1 });
  });

  it('answers ping with pong (auto-response)', async () => {
    const { host } = await hostedRoom();
    host.send('ping');
    expect(await host.next()).toBe('pong');
  });
});

describe('caps and limits', () => {
  beforeEach(mockReset);

  it(`holds 1 host + ${MAX_GUESTS} guests; the next guest gets full`, async () => {
    const { code, guests } = await hostedRoom(MAX_GUESTS);
    expect(guests).toHaveLength(MAX_GUESTS);
    const extra = await join(code, { role: 'guest' });
    await expectError(extra, 'full');
    guests[0].close();
    await settle(50);
    const late = await join(code, { role: 'guest' });
    expect(late.first.t).toBe('joined');
  });

  it(`caps guest joins at ${GUEST_JOINS_PER_MIN}/min per room, even with a forged allowed Origin`, async () => {
    const code = roomCode();
    const host = await join(code, { role: 'host' });
    expect(host.first.t).toBe('joined');
    // A script forging Origin: https://rillyboss.github.io, from many different addresses (so no global cap).
    for (let i = 0; i < GUEST_JOINS_PER_MIN; i++) {
      const g = await join(code, { role: 'guest', ip: freshIp(), origin: 'https://rillyboss.github.io' });
      expect(g.first.t, `join ${i}`).toBe('joined');
      g.close();
      await settle(10);
    }
    const over = await join(code, { role: 'guest', ip: freshIp(), origin: 'https://rillyboss.github.io' });
    await expectError(over, 'rate');
  });

  it(`closes a socket that sends more than ${MSGS_PER_SEC} messages a second with rate`, async () => {
    const { host, guests: [a] } = await hostedRoom(1);
    for (let i = 0; i < MSGS_PER_SEC + 5; i++) a.send({ t: 'signal', to: host.peer, data: i });
    let msg;
    do msg = await a.next(); while (msg.t !== 'error');
    expect(msg).toEqual({ t: 'error', code: 'rate' });
    expect((await a.closed()).code).toBe(CLOSE_CODES.rate);
    let relayed = 0;
    for (;;) {
      const m = await host.next();
      if (m.t === 'peer-leave') break;
      relayed += 1;
    }
    expect(relayed).toBe(MSGS_PER_SEC);
  });

  it(`refuses messages over ${MAX_MSG_BYTES / 1024} KiB with proto`, async () => {
    const { host, guests: [a] } = await hostedRoom(1);
    a.send({ t: 'signal', to: host.peer, data: 'x'.repeat(MAX_MSG_BYTES - 100) }); // just under: fine
    expect((await host.next()).from).toBe(a.peer);
    a.send({ t: 'signal', to: host.peer, data: 'x'.repeat(MAX_MSG_BYTES) });
    await expectError(a, 'proto');
  });

  it.each([
    ['malformed JSON', '{nope'],
    ['a JSON array', '[1,2]'],
    ['an unknown type', JSON.stringify({ t: 'chat', text: 'hi' })],
    ['a signal without data', JSON.stringify({ t: 'signal', to: '0123456789abcdef' })],
  ])('closes with proto on %s', async (_label, raw) => {
    const { guests: [a] } = await hostedRoom(1);
    a.send(raw);
    await expectError(a, 'proto');
  });

  it('closes with proto on a binary message', async () => {
    const { guests: [a] } = await hostedRoom(1);
    a.ws.send(new Uint8Array([1, 2, 3]));
    await expectError(a, 'proto');
  });

  it.each([
    ['a bad proto version', 'role=host&peer=0123456789abcdef&proto=2'],
    ['a missing proto', 'role=host&peer=0123456789abcdef'],
    ['a bad role', 'role=admin&peer=0123456789abcdef&proto=1'],
    ['a short peer id', 'role=host&peer=abc&proto=1'],
    ['an uppercase peer id', 'role=host&peer=0123456789ABCDEF&proto=1'],
  ])('refuses %s with proto', async (_label, query) => {
    const c = await connect(roomCode(), { query });
    await expectError(c, 'proto');
  });

  it.each([
    ['a spoken label', 'SPRINKLE-4821'],
    ['the guard name', 'guard'],
    ['too short', 'r0123'],
    ['uppercase hex', `r${'A'.repeat(24)}`],
  ])('refuses a room code that is %s', async (_label, code) => {
    const c = await connect(code, { role: 'host' });
    await expectError(c, 'proto');
  });

  it('answers a plain (non-WebSocket) request with 426', async () => {
    const res = await get(`/room/${roomCode()}?role=host&peer=0123456789abcdef&proto=1`, { Origin: PROD_ORIGIN });
    expect(res.status).toBe(426);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    await res.arrayBuffer();
  });
});

describe('drop and lock', () => {
  beforeEach(mockReset);

  it('drop closes the guest, tells the host, and blocks that address until unlock', async () => {
    const { code, host, guests: [a] } = await hostedRoom(1);
    host.send({ t: 'drop', peer: a.peer });
    const closed = await a.closed();
    expect(closed.code).toBe(CLOSE_CODES.removed);
    expect(await host.next()).toEqual({ t: 'peer-leave', peer: a.peer });
    expect(await host.maybeNext()).toBeNull(); // exactly one peer-leave

    // The removed house reloads (new peer id, same address): refused while blocked.
    const back = await join(code, { role: 'guest', ip: a.ip });
    await expectError(back, 'locked');
    // Someone else (another address) may still join while the room is unlocked.
    const other = await join(code, { role: 'guest' });
    expect(other.first.t).toBe('joined');
    await host.next(); // peer-join

    // Unlock clears the blocks.
    host.send({ t: 'lock', locked: true });
    host.send({ t: 'lock', locked: false });
    await settle();
    const again = await join(code, { role: 'guest', ip: a.ip });
    expect(again.first.t).toBe('joined');
  });

  it('lock refuses every new guest; unlock accepts again', async () => {
    const { code, host } = await hostedRoom();
    host.send({ t: 'lock', locked: true });
    await settle();
    await expectError(await join(code, { role: 'guest' }), 'locked');
    host.send({ t: 'lock', locked: false });
    await settle();
    expect((await join(code, { role: 'guest' })).first.t).toBe('joined');
  });

  it('the block survives the room being empty for a while (stored, not in memory)', async () => {
    const { code, host, guests: [a] } = await hostedRoom(1);
    host.send({ t: 'drop', peer: a.peer });
    await a.closed();
    await host.next();
    host.close();
    await settle(50);
    const h2 = await join(code, { role: 'host' });
    expect(h2.first.t).toBe('joined');
    await expectError(await join(code, { role: 'guest', ip: a.ip }), 'locked');
  });

  it.each([
    ['drop', (p) => ({ t: 'drop', peer: p })],
    ['lock', () => ({ t: 'lock', locked: true })],
  ])('a guest sending %s is closed with proto', async (_label, make) => {
    const { host, guests: [a, b] } = await hostedRoom(2);
    a.send(make(b.peer));
    await expectError(a, 'proto');
    expect(await host.next()).toEqual({ t: 'peer-leave', peer: a.peer });
    b.send('ping');
    expect(await b.next()).toBe('pong');
  });

  it('dropping the host itself or an unknown peer does nothing', async () => {
    const { host, guests: [a] } = await hostedRoom(1);
    host.send({ t: 'drop', peer: host.peer });
    host.send({ t: 'drop', peer: peerId() });
    host.send('ping');
    expect(await host.next()).toBe('pong');
    a.send('ping');
    expect(await a.next()).toBe('pong');
  });
});

describe('room GC alarm', () => {
  it('schedules GC 2 h after the last socket leaves, and cancels it when someone joins', async () => {
    const { code, host } = await hostedRoom();
    const stub = roomStub(code);
    expect(await runInDurableObject(stub, (_i, s) => s.storage.getAlarm())).toBeNull();
    const before = Date.now();
    host.close();
    await settle(50);
    const alarm = await runInDurableObject(stub, (_i, s) => s.storage.getAlarm());
    expect(alarm).toBeGreaterThanOrEqual(before + ROOM_GC_MS - 1000);
    expect(alarm).toBeLessThanOrEqual(Date.now() + ROOM_GC_MS + 1000);
    const h2 = await join(code, { role: 'host' });
    expect(h2.first.t).toBe('joined');
    expect(await runInDurableObject(stub, (_i, s) => s.storage.getAlarm())).toBeNull();
  });

  it('an early alarm keeps the room; a due alarm deletes everything', async () => {
    const { code, host, guests: [a] } = await hostedRoom(1);
    host.send({ t: 'drop', peer: a.peer });
    await a.closed();
    await host.next();
    host.close();
    await settle(50);
    const stub = roomStub(code);
    // Early (the room emptied just now): nothing is deleted, the alarm is re-armed.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const kept = await runInDurableObject(stub, (inst) => inst.kvGet('room'));
    expect(kept.blocked).toHaveLength(1);
    expect(await runInDurableObject(stub, (_i, s) => s.storage.getAlarm())).not.toBeNull();
    // Pretend the room has been empty for 2 h.
    await runInDurableObject(stub, (inst) => {
      inst.kvPut('room', { ...inst.kvGet('room'), emptySince: Date.now() - ROOM_GC_MS - 1 });
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const rows = await runInDurableObject(stub, (_i, s) => s.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kv'").toArray());
    const left = rows.length
      ? await runInDurableObject(stub, (_i, s) => s.storage.sql.exec('SELECT k FROM kv').toArray())
      : [];
    expect(left).toEqual([]);
    expect(await runInDurableObject(stub, (_i, s) => s.storage.getAlarm())).toBeNull();
    // The removed address is forgiven in a brand-new room with the same id.
    const h2 = await join(code, { role: 'host' });
    expect(h2.first.t).toBe('joined');
    expect((await join(code, { role: 'guest', ip: a.ip })).first.t).toBe('joined');
  });

  it('a guest knocking on an empty room leaves no data behind (GC is armed)', async () => {
    const code = roomCode();
    await expectError(await join(code, { role: 'guest' }), 'no-host');
    expect(await runInDurableObject(roomStub(code), (_i, s) => s.storage.getAlarm())).not.toBeNull();
  });
});

describe('privacy', () => {
  it('never stores a raw IP address in the room', async () => {
    const ip = '203.0.113.77';
    const { code, host } = await hostedRoom();
    const g = await join(code, { role: 'guest', ip });
    await host.next();
    host.send({ t: 'drop', peer: g.peer });
    await g.closed();
    await host.next();
    const dump = await runInDurableObject(roomStub(code), (_i, s) => JSON.stringify(s.storage.sql.exec('SELECT k, v FROM kv').toArray()));
    expect(dump).not.toContain(ip);
    expect(dump).toMatch(/"blocked\\":\[\\"[0-9a-f]{32}\\"\]/);
  });
});
