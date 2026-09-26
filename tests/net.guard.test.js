// Pure guard logic of the signal worker (infra/signal-worker/src/guard.js, NETWORKING.md §4.2):
// per salted-IP-hash counters (room joins 30/min, /ice 5/min) and the daily TURN mint cap.
import { describe, it, expect } from 'vitest';
import {
  guardReduce, createGuardState, utcDay, GUARD_LIMITS, GUARD_WINDOW_MS, GUARD_NAME,
} from '../infra/signal-worker/src/guard.js';
import { TURN_DAILY_MINTS } from '../infra/signal-worker/src/turn.js';

const T0 = Date.parse('2026-09-26T12:00:00Z');
const hit = (kind, key, now = T0) => ({ type: 'hit', kind, key, now });

function hits(state, n, kind, key, now = T0) {
  let s = state;
  const allows = [];
  for (let i = 0; i < n; i++) {
    const r = guardReduce(s, hit(kind, key, now + i));
    allows.push(r.allow);
    s = r.state;
  }
  return { state: s, allows };
}

describe('guard constants', () => {
  it('matches NETWORKING.md §19', () => {
    expect(GUARD_LIMITS).toEqual({ join: 30, ice: 5, rooms: 30 });
    expect(GUARD_WINDOW_MS).toBe(60_000);
    expect(TURN_DAILY_MINTS).toBe(500);
    expect(GUARD_NAME).toBe('guard');
  });

  it('the reserved name can never collide with a room id', () => {
    expect(/^r[0-9a-f]{24}$/.test(GUARD_NAME)).toBe(false);
  });
});

describe('utcDay', () => {
  it('uses the UTC calendar day', () => {
    expect(utcDay(Date.parse('2026-09-26T23:59:59Z'))).toBe('2026-09-26');
    expect(utcDay(Date.parse('2026-09-27T00:00:00Z'))).toBe('2026-09-27');
  });
});

describe('per-address counters', () => {
  it.each([['join', 30], ['ice', 5]])('%s: %i per minute, then refused with a retry time', (kind, limit) => {
    const { state, allows } = hits(createGuardState(), limit, kind, 'abc');
    expect(allows.every(Boolean)).toBe(true);
    const over = guardReduce(state, hit(kind, 'abc', T0 + 1000));
    expect(over.allow).toBe(false);
    expect(over.retryAfterMs).toBe(GUARD_WINDOW_MS - 1000);
    // After the window, allowed again.
    expect(guardReduce(over.state, hit(kind, 'abc', T0 + GUARD_WINDOW_MS)).allow).toBe(true);
  });

  it('counts addresses and kinds separately', () => {
    let { state } = hits(createGuardState(), GUARD_LIMITS.ice, 'ice', 'a');
    expect(guardReduce(state, hit('ice', 'a')).allow).toBe(false);
    expect(guardReduce(state, hit('ice', 'b')).allow).toBe(true);
    expect(guardReduce(state, hit('join', 'a')).allow).toBe(true);
    state = guardReduce(state, hit('join', 'a')).state;
    expect(Object.keys(state.hits).sort()).toEqual(['ice:a', 'join:a']);
  });

  it('refused hits do not extend the window', () => {
    let { state } = hits(createGuardState(), GUARD_LIMITS.ice, 'ice', 'a');
    for (let i = 0; i < 10; i++) state = guardReduce(state, hit('ice', 'a', T0 + 50_000 + i)).state;
    expect(guardReduce(state, hit('ice', 'a', T0 + GUARD_WINDOW_MS)).allow).toBe(true);
  });

  it('prunes expired windows so the stored state stays small', () => {
    let s = createGuardState();
    for (let i = 0; i < 100; i++) s = guardReduce(s, hit('join', `k${i}`)).state;
    expect(Object.keys(s.hits)).toHaveLength(100);
    s = guardReduce(s, hit('join', 'late', T0 + GUARD_WINDOW_MS + 1)).state;
    expect(Object.keys(s.hits)).toEqual(['join:late']);
  });

  it('refuses unknown kinds and empty keys', () => {
    expect(guardReduce(createGuardState(), hit('delete', 'a')).allow).toBe(false);
    expect(guardReduce(createGuardState(), hit('join', '')).allow).toBe(false);
    expect(guardReduce(createGuardState(), { type: 'nope', now: T0 }).allow).toBe(false);
  });
});

describe('daily TURN mint cap', () => {
  it(`allows ${TURN_DAILY_MINTS} mints per UTC day`, () => {
    let s = createGuardState();
    for (let i = 0; i < TURN_DAILY_MINTS; i++) {
      const r = guardReduce(s, { type: 'mint', now: T0 + i });
      expect(r.allow).toBe(true);
      s = r.state;
    }
    expect(s.mints).toBe(TURN_DAILY_MINTS);
    expect(guardReduce(s, { type: 'mint', now: T0 + 1e6 })).toMatchObject({ allow: false, mintsLeft: 0 });
    expect(guardReduce(s, { type: 'status', now: T0 + 1e6 }).allow).toBe(false);
  });

  it('status reports without using a mint', () => {
    let s = createGuardState();
    for (let i = 0; i < 3; i++) s = guardReduce(s, { type: 'status', now: T0 }).state;
    expect(s.mints).toBe(0);
    expect(guardReduce(s, { type: 'status', now: T0 })).toMatchObject({ allow: true, mintsLeft: TURN_DAILY_MINTS });
  });

  it('resets on a new UTC day (and forgets yesterday\'s hashed addresses: the salt rotates)', () => {
    const full = { day: '2026-09-26', mints: TURN_DAILY_MINTS, hits: { 'ice:a': { start: T0, count: 5 } } };
    const same = guardReduce(full, { type: 'status', now: Date.parse('2026-09-26T23:59:00Z') });
    expect(same).toMatchObject({ allow: false, newDay: false });
    const next = guardReduce(full, { type: 'status', now: Date.parse('2026-09-27T00:00:10Z') });
    expect(next).toMatchObject({ allow: true, newDay: true });
    expect(next.state).toEqual({ day: '2026-09-27', mints: 0, hits: {} });
  });

  it('accepts a cap override (for tests) without changing the default', () => {
    const s = { day: utcDay(T0), mints: 2, hits: {} };
    expect(guardReduce(s, { type: 'mint', now: T0, cap: 2 }).allow).toBe(false);
    expect(guardReduce(s, { type: 'mint', now: T0 }).allow).toBe(true);
  });

  it('is pure: never mutates the input state', () => {
    const s = { day: utcDay(T0), mints: 1, hits: { 'join:a': { start: T0, count: 1 } } };
    const copy = JSON.parse(JSON.stringify(s));
    guardReduce(s, { type: 'mint', now: T0 });
    guardReduce(s, hit('join', 'a', T0 + 1));
    expect(s).toEqual(copy);
  });

  it('starts from an empty state when given none', () => {
    expect(guardReduce(undefined, { type: 'mint', now: T0 })).toMatchObject({ allow: true, newDay: true });
  });
});
