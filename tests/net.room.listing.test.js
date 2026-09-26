// The open-games list of the signal worker ("Games you can join", NETWORKING.md §4.2): the pure registry
// (infra/signal-worker/src/registry.js), the room reducer's listing ops (room.js) and the code → room id
// formula (codes.js). Runs in the main suite on any Node; the Worker end to end is `npm run worker:test`.
import { describe, it, expect } from 'vitest';
import {
  registryReduce, createRegistryState, cleanEntry, LISTING_TTL_MS, MAX_LISTED, LIST_LIMIT, REGISTRY_NAME,
} from '../infra/signal-worker/src/registry.js';
import {
  roomReduce, createRoomState, restoreRoomState, durablePart, parseRoomRequest, parseListing, registryOp,
} from '../infra/signal-worker/src/room.js';
import { roomIdForCode, CODE_ALPHABET, LIST_CODE_RE, ROOM_ID_SALT } from '../infra/signal-worker/src/codes.js';
import { GUARD_LIMITS } from '../infra/signal-worker/src/guard.js';

const T0 = 1_800_000_000_000;
const H = 'aaaaaaaaaaaaaaaa';
const ROOM = 'r0123456789abcdef01234567';
const G = (i) => i.toString(16).padStart(16, '0');

function run(events, state = createRoomState()) {
  const results = [];
  for (const ev of events) {
    const r = roomReduce(state, ev);
    results.push(r);
    state = r.state;
  }
  return { state, results, last: results[results.length - 1] };
}
const listing = (o = {}) => ({ code: 'CAKE', who: 'luna', players: 1, on: true, ...o });
const hostJoin = (o = {}) => ({ type: 'join', peer: H, role: 'host', ipHash: 'hh', now: T0, room: ROOM, listing: listing(), ...o });
const msg = (obj, now = T0 + 5) => ({ type: 'message', peer: H, raw: JSON.stringify(obj), now });

describe('codes: the kid-friendly code alphabet and room ids', () => {
  it('uses capital letters without I, O and Q', () => {
    expect(CODE_ALPHABET).toMatch(/^[A-Z]+$/);
    for (const c of 'IOQ01') expect(CODE_ALPHABET.includes(c)).toBe(false);
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
    expect(LIST_CODE_RE.test('CAKE')).toBe(true);
    for (const bad of ['CAK', 'CAKES', 'cake', 'COKE', 'KI1E', 'C AK']) expect(LIST_CODE_RE.test(bad)).toBe(false);
  });

  it('maps a code to a stable r + 24 hex room id (the same formula the game uses)', async () => {
    const id = await roomIdForCode('CAKE');
    expect(id).toMatch(/^r[0-9a-f]{24}$/);
    expect(await roomIdForCode('CAKE')).toBe(id);
    expect(await roomIdForCode('CAKF')).not.toBe(id);
    expect(ROOM_ID_SALT).toBe('sprinkle-kart-room-v2|');
  });
});

describe('registry (the reserved "lobby" instance)', () => {
  it('lists put rooms newest first with age in seconds, and forgets removed ones', () => {
    expect(REGISTRY_NAME).toBe('lobby');
    let s = createRegistryState();
    s = registryReduce(s, { type: 'put', room: 'ra', entry: { code: 'CAKE', who: 'luna', players: 2 }, now: T0 }).state;
    s = registryReduce(s, { type: 'put', room: 'rb', entry: { code: 'BUNS', who: null, players: 1 }, now: T0 + 1000 }).state;
    const l = registryReduce(s, { type: 'list', now: T0 + 5000 });
    expect(l.rooms).toEqual([
      { code: 'BUNS', who: null, players: 1, ageS: 4 },
      { code: 'CAKE', who: 'luna', players: 2, ageS: 5 },
    ]);
    s = registryReduce(s, { type: 'remove', room: 'ra', now: T0 + 6000 }).state;
    expect(registryReduce(s, { type: 'list', now: T0 + 6000 }).rooms.map((r) => r.code)).toEqual(['BUNS']);
  });

  it('a refresh keeps the created time; an entry expires LISTING_TTL_MS after its last refresh', () => {
    let s = registryReduce(createRegistryState(), { type: 'put', room: 'ra', entry: { code: 'CAKE', players: 1 }, now: T0 }).state;
    s = registryReduce(s, { type: 'put', room: 'ra', entry: { code: 'CAKE', players: 3 }, now: T0 + LISTING_TTL_MS - 1 }).state;
    expect(s.rooms.ra.created).toBe(T0);
    expect(registryReduce(s, { type: 'list', now: T0 + LISTING_TTL_MS + 10 }).rooms).toEqual([{ code: 'CAKE', who: null, players: 3, ageS: Math.round((LISTING_TTL_MS + 10) / 1000) }]);
    const gone = registryReduce(s, { type: 'list', now: T0 + 2 * LISTING_TTL_MS });
    expect(gone.rooms).toEqual([]);
    expect(gone.changed).toBe(true); // the expired entry is pruned from storage too
  });

  it('never stores free text: bad codes are refused, bad racer ids and counts are cleaned', () => {
    expect(cleanEntry({ code: 'cake' })).toBeNull();
    expect(cleanEntry({ code: 'COOL' })).toBeNull();
    expect(cleanEntry({ code: 'CAKE', who: 'Hello there!', players: 99 })).toEqual({ code: 'CAKE', who: null, players: 1 });
    expect(cleanEntry({ code: 'CAKE', who: 'mint-bun', players: 4 })).toEqual({ code: 'CAKE', who: 'mint-bun', players: 4 });
    const r = registryReduce(createRegistryState(), { type: 'put', room: 'ra', entry: { code: '<b>' }, now: T0 });
    expect(r.state.rooms).toEqual({});
  });

  it('keeps at most MAX_LISTED rooms and lists at most LIST_LIMIT', () => {
    let s = createRegistryState();
    for (let i = 0; i < MAX_LISTED + 5; i++) {
      s = registryReduce(s, { type: 'put', room: `r${i}`, entry: { code: 'CAKE', players: 1 }, now: T0 + i }).state;
    }
    expect(Object.keys(s.rooms)).toHaveLength(MAX_LISTED);
    expect(s.rooms.r0).toBeUndefined(); // the stalest went first
    expect(registryReduce(s, { type: 'list', now: T0 + 100 }).rooms).toHaveLength(LIST_LIMIT);
  });

  it('GET /rooms has its own per-IP limit in the guard', () => {
    expect(GUARD_LIMITS.rooms).toBe(30);
  });
});

describe('room reducer: listing ops', () => {
  it('parses the host listing parameters (guests never list)', () => {
    const u = (q) => new URL(`https://w.test/room/${ROOM}?role=host&peer=${H}&proto=1${q}`);
    expect(parseRoomRequest(u('&code=CAKE&who=luna&players=3')).listing).toEqual({ code: 'CAKE', who: 'luna', players: 3, on: true });
    expect(parseRoomRequest(u('&code=CAKE&list=0')).listing).toEqual({ code: 'CAKE', who: null, players: 1, on: false });
    expect(parseRoomRequest(u('&code=cake')).listing).toBeNull();
    expect(parseRoomRequest(u('&code=CAKE&who=%3Cscript%3E&players=12')).listing).toEqual({ code: 'CAKE', who: null, players: 1, on: true });
    expect(parseRoomRequest(new URL(`https://w.test/room/${ROOM}?role=guest&peer=${H}&proto=1&code=CAKE`)).listing).toBeNull();
    expect(parseListing(new URLSearchParams(''))).toBeNull();
  });

  it('a listing host puts the room on the list; joined says the worker can list', () => {
    const { last } = run([hostJoin()]);
    expect(last.registry).toEqual({ op: 'put', room: ROOM, entry: { code: 'CAKE', who: 'luna', players: 1 } });
    expect(last.sends[0].msg.list).toBe(true);
  });

  it('a hidden room or an old host without a code is never listed', () => {
    expect(run([hostJoin({ listing: listing({ on: false }) })]).last.registry).toEqual({ op: 'remove', room: ROOM });
    expect(run([hostJoin({ listing: null })]).last.registry).toBeUndefined();
  });

  it('guests joining and leaving do not touch the list; the host leaving removes it', () => {
    const r = run([hostJoin(), { type: 'join', peer: G(1), role: 'guest', ipHash: 'g', now: T0 + 1 }, { type: 'leave', peer: G(1), now: T0 + 2 }]);
    expect(r.results[1].registry).toBeUndefined();
    expect(r.results[2].registry).toBeUndefined();
    const left = roomReduce(r.state, { type: 'leave', peer: H, now: T0 + 3 });
    expect(left.registry).toEqual({ op: 'remove', room: ROOM });
    expect(left.state.listing).toBeNull();
  });

  it('lock removes the room from the list and unlock puts it back', () => {
    const { state } = run([hostJoin()]);
    const locked = roomReduce(state, msg({ t: 'lock', locked: true }));
    expect(locked.registry).toEqual({ op: 'remove', room: ROOM });
    const open = roomReduce(locked.state, msg({ t: 'lock', locked: false }, T0 + 6));
    expect(open.registry).toMatchObject({ op: 'put', room: ROOM });
  });

  it('{ t: "list" } shows / hides the room and updates the racer and player count', () => {
    const { state } = run([hostJoin()]);
    const hide = roomReduce(state, msg({ t: 'list', on: false }));
    expect(hide.registry).toEqual({ op: 'remove', room: ROOM });
    const show = roomReduce(hide.state, msg({ t: 'list', on: true, who: 'mint-bun', players: 3 }, T0 + 6));
    expect(show.registry).toEqual({ op: 'put', room: ROOM, entry: { code: 'CAKE', who: 'mint-bun', players: 3 } });
    const junk = roomReduce(show.state, msg({ t: 'list', on: true, who: 'NOT OK', players: 50 }, T0 + 7));
    expect(junk.registry.entry).toEqual({ code: 'CAKE', who: 'mint-bun', players: 3 });
  });

  it('{ t: "list" } from a guest or without a boolean is a protocol error; without a listing it is ignored', () => {
    const { state } = run([hostJoin(), { type: 'join', peer: G(1), role: 'guest', ipHash: 'g', now: T0 + 1 }]);
    const g = roomReduce(state, { type: 'message', peer: G(1), raw: JSON.stringify({ t: 'list', on: true }), now: T0 + 2 });
    expect(g.sends).toContainEqual({ to: G(1), msg: { t: 'error', code: 'proto' } });
    const bad = roomReduce(state, msg({ t: 'list', on: 'yes' }));
    expect(bad.sends).toContainEqual({ to: H, msg: { t: 'error', code: 'proto' } });
    expect(bad.registry).toEqual({ op: 'remove', room: ROOM }); // the host went: off the list
    const plain = run([hostJoin({ listing: null })]).state;
    expect(roomReduce(plain, msg({ t: 'list', on: true })).registry).toBeUndefined();
  });

  it('the listing survives hibernation, but only while a host is connected', () => {
    const { state } = run([hostJoin()]);
    const d = durablePart(state);
    expect(d.room).toBe(ROOM);
    expect(d.listing).toEqual(listing());
    expect(restoreRoomState(d, [{ peer: H, role: 'host', ipHash: 'hh', n: 1 }]).listing).toEqual(listing());
    expect(restoreRoomState(d, []).listing).toBeNull();
    expect(registryOp(restoreRoomState(d, []))).toEqual({ op: 'remove', room: ROOM });
  });
});
