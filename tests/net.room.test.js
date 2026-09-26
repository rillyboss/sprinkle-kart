// Pure room logic of the signal worker (infra/signal-worker/src/room.js, NETWORKING.md §4.2).
// Runs in the main suite on any Node (the full Worker is tested by `npm run worker:test` on Node 22+).
import { describe, it, expect } from 'vitest';
import {
  roomReduce, createRoomState, restoreRoomState, durablePart, parseRoomRequest, messageBytes,
  PROTO, MAX_GUESTS, MAX_SOCKETS, MAX_MSG_BYTES, MSGS_PER_SEC, GUEST_JOINS_PER_MIN, JOIN_WINDOW_MS,
  ICE_REFRESH_MS, ROOM_GC_MS, MAX_BLOCKED, ERROR_CODES, CLOSE_CODES,
} from '../infra/signal-worker/src/room.js';

const H = 'aaaaaaaaaaaaaaaa';
const peer = (i) => i.toString(16).padStart(16, '0');
const T0 = 1_800_000_000_000;

/** Run events in order, returning the final state and every result. */
function run(events, state = createRoomState()) {
  const results = [];
  for (const ev of events) {
    const r = roomReduce(state, ev);
    results.push(r);
    state = r.state;
  }
  return { state, results, last: results[results.length - 1] };
}

const hostJoin = (now = T0) => ({ type: 'join', peer: H, role: 'host', ipHash: 'hh', now });
const guestJoin = (i, now = T0, ipHash = `ip${i}`) => ({ type: 'join', peer: peer(i), role: 'guest', ipHash, now });
const msg = (from, obj, now = T0) => ({ type: 'message', peer: from, raw: typeof obj === 'string' ? obj : JSON.stringify(obj), now });

function hosted(guests = 0) {
  const events = [hostJoin()];
  for (let i = 1; i <= guests; i++) events.push(guestJoin(i, T0 + i));
  return run(events).state;
}

describe('constants match NETWORKING.md §4.2 / §19', () => {
  it('has the binding limits', () => {
    expect(PROTO).toBe(1);
    expect(MAX_GUESTS).toBe(7);
    expect(MAX_SOCKETS).toBe(8);
    expect(MAX_MSG_BYTES).toBe(16 * 1024);
    expect(MSGS_PER_SEC).toBe(50);
    expect(GUEST_JOINS_PER_MIN).toBe(12);
    expect(JOIN_WINDOW_MS).toBe(60_000);
    expect(ICE_REFRESH_MS).toBe(30_000);
    expect(ROOM_GC_MS).toBe(2 * 60 * 60 * 1000);
    expect([...ERROR_CODES]).toEqual(['full', 'no-host', 'host-exists', 'locked', 'rate', 'bad-origin', 'proto']);
  });

  it('gives every error its own application close code', () => {
    const codes = Object.values(CLOSE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c >= 4000 && c <= 4999).toBe(true);
    for (const e of ERROR_CODES) expect(CLOSE_CODES[e], e).toBeTypeOf('number');
  });
});

describe('parseRoomRequest', () => {
  const url = (path) => new URL(`https://signal.test${path}`);
  const code = `r${'0123456789abcdef01234567'}`;

  it('accepts the key-derived room id with host/guest, a 16-hex peer and proto=1', () => {
    expect(parseRoomRequest(url(`/room/${code}?role=host&peer=${H}&proto=1`))).toEqual({ ok: true, code, role: 'host', peer: H });
    expect(parseRoomRequest(url(`/room/${code}?role=guest&peer=${peer(9)}&proto=1`)).role).toBe('guest');
  });

  it.each([
    `/room/SPRINKLE-4821?role=host&peer=${H}&proto=1`,
    `/room/r0123?role=host&peer=${H}&proto=1`,
    `/room/${code.toUpperCase()}?role=host&peer=${H}&proto=1`,
    `/room/guard?role=host&peer=${H}&proto=1`,
    `/room/${code}?role=spectator&peer=${H}&proto=1`,
    `/room/${code}?peer=${H}&proto=1`,
    `/room/${code}?role=host&peer=xyz&proto=1`,
    `/room/${code}?role=host&peer=${H.toUpperCase()}&proto=1`,
    `/room/${code}?role=host&peer=${H}&proto=2`,
    `/room/${code}?role=host&peer=${H}`,
  ])('refuses %s with proto', (path) => {
    expect(parseRoomRequest(url(path))).toEqual({ ok: false, error: 'proto' });
  });

  it('says not-found for other paths', () => {
    expect(parseRoomRequest(url(`/room/${code}/x?role=host&peer=${H}&proto=1`)).error).toBe('not-found');
    expect(parseRoomRequest(url('/health')).error).toBe('not-found');
  });
});

describe('joining', () => {
  it('the host creates the room and gets joined (ICE filled in by the Durable Object)', () => {
    const r = roomReduce(createRoomState(), hostJoin());
    expect(r.accept).toBe(true);
    expect(r.state.host).toBe(H);
    expect(r.sends).toEqual([{ to: H, msg: { t: 'joined', you: H, host: H, peers: [], iceServers: [], turn: false }, withIce: true }]);
    expect(r.cancelGc).toBe(true);
  });

  it('a guest before any host gets no-host', () => {
    const r = roomReduce(createRoomState(), guestJoin(1));
    expect(r).toMatchObject({ accept: false, error: 'no-host' });
    expect(r.sends).toEqual([]);
  });

  it('a second host gets host-exists', () => {
    const r = roomReduce(hosted(), { ...hostJoin(), peer: peer(99) });
    expect(r).toMatchObject({ accept: false, error: 'host-exists' });
    expect(r.state.host).toBe(H);
  });

  it('a guest learns only the host; the host hears peer-join', () => {
    const r = roomReduce(hosted(1), guestJoin(2, T0 + 10));
    expect(r.accept).toBe(true);
    expect(r.sends).toEqual([
      { to: peer(2), msg: { t: 'joined', you: peer(2), host: H, peers: [], iceServers: [], turn: false }, withIce: true },
      { to: H, msg: { t: 'peer-join', peer: peer(2) } },
    ]);
  });

  it(`holds 1 host + ${MAX_GUESTS} guests; the next is full`, () => {
    const s = hosted(MAX_GUESTS);
    expect(Object.keys(s.peers)).toHaveLength(MAX_SOCKETS);
    expect(roomReduce(s, guestJoin(50, T0 + 100))).toMatchObject({ accept: false, error: 'full' });
  });

  it(`caps guest join attempts at ${GUEST_JOINS_PER_MIN} per minute per room (rejected attempts count too)`, () => {
    let s = hosted();
    for (let i = 1; i <= GUEST_JOINS_PER_MIN; i++) {
      const r = roomReduce(s, guestJoin(i, T0 + i));
      expect(r.accept, `join ${i}`).toBe(true);
      s = roomReduce(r.state, { type: 'leave', peer: peer(i), now: T0 + i }).state;
    }
    expect(roomReduce(s, guestJoin(100, T0 + 1000))).toMatchObject({ accept: false, error: 'rate' });
    // A minute later the window has moved on.
    expect(roomReduce(s, guestJoin(101, T0 + 1 + JOIN_WINDOW_MS)).accept).toBe(true);
  });

  it('a stranger hammering a locked room still counts toward the cap', () => {
    let s = run([hostJoin(), msg(H, { t: 'lock', locked: true })]).state;
    for (let i = 1; i <= GUEST_JOINS_PER_MIN; i++) {
      const r = roomReduce(s, guestJoin(i, T0 + i));
      expect(r.error).toBe('locked');
      s = r.state;
    }
    expect(roomReduce(s, guestJoin(99, T0 + 50)).error).toBe('rate');
  });

  it('the same peer id again replaces its older socket without peer-join/leave noise', () => {
    const s = hosted(1);
    const oldN = s.peers[peer(1)].n;
    const r = roomReduce(s, guestJoin(1, T0 + 50));
    expect(r.accept).toBe(true);
    expect(r.close).toEqual([{ peer: peer(1), code: CLOSE_CODES.replaced, reason: 'replaced', n: oldN }]);
    expect(r.sends.map((x) => x.msg.t)).toEqual(['joined']);
    expect(r.state.peers[peer(1)].n).toBeGreaterThan(oldN);
    // The old socket's late close is ignored.
    const late = roomReduce(r.state, { type: 'leave', peer: peer(1), n: oldN, now: T0 + 60 });
    expect(late.state.peers[peer(1)]).toBeDefined();
    expect(late.sends).toEqual([]);
  });

  it('the same peer id with the other role is proto', () => {
    expect(roomReduce(hosted(), { ...guestJoin(0), peer: H }).error).toBe('proto');
  });

  it('a host rejoining with guests present sees them in joined.peers', () => {
    let s = hosted(2);
    s = roomReduce(s, { type: 'leave', peer: H, now: T0 + 5 }).state;
    const r = roomReduce(s, { ...hostJoin(T0 + 6), peer: peer(77) });
    expect(r.sends[0].msg.peers).toEqual([peer(1), peer(2)]);
  });
});

describe('leaving and GC', () => {
  it('a guest leaving tells the host; the host leaving frees the slot', () => {
    const s = hosted(1);
    expect(roomReduce(s, { type: 'leave', peer: peer(1), now: T0 + 5 }).sends).toEqual([{ to: H, msg: { t: 'peer-leave', peer: peer(1) } }]);
    const r = roomReduce(s, { type: 'leave', peer: H, now: T0 + 5 });
    expect(r.state.host).toBeNull();
    expect(r.sends).toEqual([]); // guests are never told about peers
  });

  it('arms GC 2 h after the last socket leaves', () => {
    const r = roomReduce(hosted(), { type: 'leave', peer: H, now: T0 + 5 });
    expect(r.state.emptySince).toBe(T0 + 5);
    expect(r.gcAt).toBe(T0 + 5 + ROOM_GC_MS);
  });

  it('an early alarm re-arms; a due alarm resets the room; an occupied room ignores it', () => {
    const empty = roomReduce(hosted(), { type: 'leave', peer: H, now: T0 }).state;
    expect(roomReduce(empty, { type: 'alarm', now: T0 + 1000 })).toMatchObject({ gcAt: T0 + ROOM_GC_MS });
    const due = roomReduce(empty, { type: 'alarm', now: T0 + ROOM_GC_MS });
    expect(due.gc).toBe(true);
    expect(due.state).toEqual(createRoomState());
    const busy = roomReduce(hosted(), { type: 'alarm', now: T0 + 10 * ROOM_GC_MS });
    expect(busy.gc).toBeUndefined();
    expect(busy.gcAt).toBeUndefined();
  });

  it('a refused join into an empty room arms GC so its stored counts get cleaned', () => {
    const r = roomReduce(createRoomState(), guestJoin(1, T0));
    expect(r.gcAt).toBe(T0 + ROOM_GC_MS);
    expect(r.persist).toBe(true);
  });

  it('ignores leave for unknown peers and unknown events', () => {
    const s = hosted();
    expect(roomReduce(s, { type: 'leave', peer: peer(5), now: T0 }).state).toBe(s);
    expect(roomReduce(s, { type: 'what' }).state).toBe(s);
    expect(roomReduce(s, undefined).sends).toEqual([]);
  });
});

describe('messages', () => {
  it('relays signal host ⇄ guest and adds from', () => {
    const s = hosted(1);
    expect(roomReduce(s, msg(peer(1), { t: 'signal', to: H, data: { sdp: 'o' } })).sends)
      .toEqual([{ to: H, msg: { t: 'signal', from: peer(1), data: { sdp: 'o' } } }]);
    expect(roomReduce(s, msg(H, { t: 'signal', to: peer(1), data: 'a' })).sends)
      .toEqual([{ to: peer(1), msg: { t: 'signal', from: H, data: 'a' } }]);
  });

  it('guests may only address the host; self and unknown targets are ignored quietly', () => {
    const s = hosted(2);
    for (const to of [peer(2), peer(1), peer(55)]) {
      const r = roomReduce(s, msg(peer(1), { t: 'signal', to, data: 1 }));
      expect(r.sends, to).toEqual([]);
      expect(r.close, to).toEqual([]);
    }
  });

  it('ping → pong', () => {
    expect(roomReduce(hosted(), msg(H, 'ping')).sends).toEqual([{ to: H, msg: 'pong' }]);
  });

  it.each([
    ['malformed JSON', '{'],
    ['an array', '[]'],
    ['no type', '{"to":"x"}'],
    ['an unknown type', '{"t":"chat","text":"hello"}'],
    ['a signal with a bad target', '{"t":"signal","to":"nope","data":1}'],
    ['a signal without data', `{"t":"signal","to":"${H}"}`],
  ])('closes with proto on %s', (_l, raw) => {
    const r = roomReduce(hosted(1), msg(peer(1), raw));
    expect(r.sends).toEqual([{ to: peer(1), msg: { t: 'error', code: 'proto' } }, { to: H, msg: { t: 'peer-leave', peer: peer(1) } }]);
    expect(r.close).toEqual([{ peer: peer(1), code: CLOSE_CODES.proto, reason: 'proto', n: expect.any(Number) }]);
    expect(r.state.peers[peer(1)]).toBeUndefined();
  });

  it('closes with proto on binary and on messages over 16 KiB (UTF-8 bytes)', () => {
    const s = hosted(1);
    expect(roomReduce(s, { type: 'message', peer: peer(1), raw: new Uint8Array(4).buffer, now: T0 }).close[0].reason).toBe('proto');
    const big = JSON.stringify({ t: 'signal', to: H, data: 'é'.repeat(MAX_MSG_BYTES / 2) }); // 2 bytes per é
    expect(big.length).toBeLessThan(MAX_MSG_BYTES + 100);
    expect(messageBytes(big)).toBeGreaterThan(MAX_MSG_BYTES);
    expect(roomReduce(s, msg(peer(1), big)).close[0].reason).toBe('proto');
    const ok = JSON.stringify({ t: 'signal', to: H, data: 'x'.repeat(MAX_MSG_BYTES - 200) });
    expect(roomReduce(s, msg(peer(1), ok)).sends[0].to).toBe(H);
  });

  it(`allows ${MSGS_PER_SEC} messages per second per socket, then closes with rate`, () => {
    let s = hosted(1);
    for (let i = 0; i < MSGS_PER_SEC; i++) {
      const r = roomReduce(s, msg(peer(1), 'ping', T0 + 10 + i));
      expect(r.close, `msg ${i}`).toEqual([]);
      s = r.state;
    }
    const over = roomReduce(s, msg(peer(1), 'ping', T0 + 500));
    expect(over.sends[0]).toEqual({ to: peer(1), msg: { t: 'error', code: 'rate' } });
    expect(over.close[0].code).toBe(CLOSE_CODES.rate);
    // The window restarts after a second.
    expect(roomReduce(s, msg(peer(1), 'ping', T0 + 10 + 1000)).close).toEqual([]);
  });

  it('messages from an unknown or replaced socket are ignored', () => {
    const s = hosted(1);
    expect(roomReduce(s, msg(peer(9), 'ping')).sends).toEqual([]);
    expect(roomReduce(s, { ...msg(peer(1), 'ping'), n: 999 }).sends).toEqual([]);
  });

  it('ice: one mint per 30 s per socket; faster asks are answered without minting', () => {
    let s = hosted(1);
    let r = roomReduce(s, msg(peer(1), { t: 'ice' }, T0 + ICE_REFRESH_MS + 5));
    expect(r.ice).toEqual({ peer: peer(1), mint: true });
    s = r.state;
    r = roomReduce(s, msg(peer(1), { t: 'ice' }, T0 + ICE_REFRESH_MS + 10));
    expect(r.ice).toEqual({ peer: peer(1), mint: false });
    r = roomReduce(r.state, msg(peer(1), { t: 'ice' }, T0 + 2 * ICE_REFRESH_MS + 5));
    expect(r.ice.mint).toBe(true);
  });

  it('ice right after joining does not mint again (joined already carried creds)', () => {
    expect(roomReduce(hosted(1), msg(peer(1), { t: 'ice' }, T0 + 1000)).ice.mint).toBe(false);
  });
});

describe('drop and lock', () => {
  it('drop closes the guest, tells the host once, and blocks the salted IP hash', () => {
    const s = hosted(2);
    const r = roomReduce(s, msg(H, { t: 'drop', peer: peer(1) }));
    expect(r.close).toEqual([{ peer: peer(1), code: CLOSE_CODES.removed, reason: 'removed', n: s.peers[peer(1)].n }]);
    expect(r.sends).toEqual([{ to: H, msg: { t: 'peer-leave', peer: peer(1) } }]);
    expect(r.state.blocked).toEqual(['ip1']);
    expect(r.persist).toBe(true);
    // Its late close event does nothing more.
    expect(roomReduce(r.state, { type: 'leave', peer: peer(1), now: T0 }).sends).toEqual([]);
    // Same address, new peer id → locked; another address may join.
    expect(roomReduce(r.state, guestJoin(20, T0 + 5, 'ip1')).error).toBe('locked');
    expect(roomReduce(r.state, guestJoin(21, T0 + 5, 'ip21')).accept).toBe(true);
  });

  it('lock refuses new guests; unlock accepts again and clears the IP blocks', () => {
    let s = run([hostJoin(), guestJoin(1, T0 + 1), msg(H, { t: 'drop', peer: peer(1) }, T0 + 2), msg(H, { t: 'lock', locked: true }, T0 + 3)]).state;
    expect(s.locked).toBe(true);
    expect(roomReduce(s, guestJoin(2, T0 + 4)).error).toBe('locked');
    s = roomReduce(s, msg(H, { t: 'lock', locked: false }, T0 + 5)).state;
    expect(s.locked).toBe(false);
    expect(s.blocked).toEqual([]);
    expect(roomReduce(s, guestJoin(3, T0 + 6, 'ip1')).accept).toBe(true);
  });

  it('only the host may drop or lock (a guest trying is closed with proto)', () => {
    const s = hosted(2);
    for (const m of [{ t: 'drop', peer: peer(2) }, { t: 'lock', locked: true }]) {
      const r = roomReduce(s, msg(peer(1), m));
      expect(r.close[0]).toMatchObject({ peer: peer(1), reason: 'proto' });
      expect(r.state.blocked).toEqual([]);
      expect(r.state.locked).toBe(false);
    }
    expect(roomReduce(s, msg(H, { t: 'lock', locked: 'yes' })).close[0].reason).toBe('proto');
    expect(roomReduce(s, msg(H, { t: 'drop' })).close[0].reason).toBe('proto');
  });

  it('dropping the host or an unknown peer changes nothing', () => {
    const s = hosted(1);
    for (const p of [H, peer(40)]) {
      const r = roomReduce(s, msg(H, { t: 'drop', peer: p }));
      expect(r.close).toEqual([]);
      expect(r.state.blocked).toEqual([]);
    }
  });

  it(`keeps at most ${MAX_BLOCKED} blocked hashes`, () => {
    let s = hosted();
    for (let i = 1; i <= MAX_BLOCKED + 5; i++) {
      s = roomReduce(s, guestJoin(i, T0 + i * JOIN_WINDOW_MS)).state;
      s = roomReduce(s, msg(H, { t: 'drop', peer: peer(i) }, T0 + i * JOIN_WINDOW_MS)).state;
    }
    expect(s.blocked).toHaveLength(MAX_BLOCKED);
    expect(s.blocked[s.blocked.length - 1]).toBe(`ip${MAX_BLOCKED + 5}`);
  });
});

describe('hibernation: durable part and restore', () => {
  it('stores locks, blocks, join counts and the join counter; peers come back from socket attachments', () => {
    const s = run([hostJoin(), guestJoin(1, T0 + 1), guestJoin(2, T0 + 2, 'bad'), msg(H, { t: 'drop', peer: peer(2) }, T0 + 3)]).state;
    const d = durablePart(s);
    expect(d).toEqual({ locked: false, blocked: ['bad'], joins: [T0 + 1, T0 + 2], n: 3, emptySince: null });
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    const back = restoreRoomState(d, [
      { peer: H, role: 'host', ipHash: 'hh', n: 1 },
      { peer: peer(1), role: 'guest', ipHash: 'ip1', n: 2 },
      { peer: peer(2), role: 'guest', ipHash: 'bad', n: 3, gone: true }, // dropped, still closing
    ]);
    expect(back.host).toBe(H);
    expect(Object.keys(back.peers).sort()).toEqual([H, peer(1)].sort());
    expect(back.blocked).toEqual(['bad']);
    expect(back.emptySince).toBeNull();
  });

  it('keeps the newest socket of a peer and skips junk attachments', () => {
    const back = restoreRoomState(null, [
      { peer: peer(1), role: 'guest', ipHash: 'a', n: 5 },
      { peer: peer(1), role: 'guest', ipHash: 'a', n: 3 },
      null,
      { peer: 'nope', role: 'guest', n: 9 },
      { peer: peer(2), role: 'admin', n: 9 },
    ]);
    expect(Object.keys(back.peers)).toEqual([peer(1)]);
    expect(back.peers[peer(1)].n).toBe(5);
    expect(back.n).toBe(5);
    expect(back.host).toBeNull();
  });

  it('never keeps raw addresses: the reducer only ever sees the hash it is given', () => {
    const s = run([hostJoin(), guestJoin(1, T0 + 1, 'f'.repeat(32)), msg(H, { t: 'drop', peer: peer(1) })]).state;
    expect(JSON.stringify(durablePart(s))).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
