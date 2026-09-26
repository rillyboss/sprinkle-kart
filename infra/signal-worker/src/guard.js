// Pure logic for the global guard (NETWORKING.md §4.2): the reserved SignalRoom instance named 'guard'.
//
// Abuse limits live in a Durable Object, not in isolate memory, because a Worker runs in many isolates and
// colos at once. The guard counts, per salted IP hash (SHA-256 of a daily-rotated salt + the IP; raw IPs are
// never stored): room joins (30/min), GET /ice calls (5/min) and GET /rooms calls (30/min). It also counts TURN credential mints per UTC
// day (TURN_DAILY_MINTS). guardReduce is pure; the Durable Object stores its state and does the hashing.
import { TURN_DAILY_MINTS } from './turn.js';

export const GUARD_WINDOW_MS = 60_000;
/** Allowed hits per GUARD_WINDOW_MS per salted IP hash. */
export const GUARD_LIMITS = Object.freeze({ join: 30, ice: 5, rooms: 30 });
export const GUARD_NAME = 'guard';

/** 'YYYY-MM-DD' for a ms timestamp, in UTC. */
export function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export function createGuardState() {
  return { day: null, mints: 0, hits: {} };
}

function rollDay(state, now) {
  const day = utcDay(now);
  if (state.day === day) return { state, newDay: false };
  // A new UTC day: the mint count resets, and the salt rotates, so yesterday's hashes mean nothing any more.
  return { state: { day, mints: 0, hits: {} }, newDay: true };
}

function prune(hits, now) {
  const out = {};
  for (const [k, w] of Object.entries(hits)) if (now - w.start < GUARD_WINDOW_MS) out[k] = { ...w };
  return out;
}

/**
 * @param {ReturnType<typeof createGuardState>} state
 * @param {{ type: 'hit', kind: 'join'|'ice'|'rooms', key: string, now: number }
 *       | { type: 'mint', now: number, cap?: number }
 *       | { type: 'status', now: number, cap?: number }} event
 * @returns {{ state: object, allow: boolean, newDay: boolean, retryAfterMs?: number, mintsLeft?: number }}
 */
export function guardReduce(state, event) {
  const now = event?.now ?? 0;
  const rolled = rollDay(state ?? createGuardState(), now);
  const s = { ...rolled.state, hits: prune(rolled.state.hits, now) };
  const base = { newDay: rolled.newDay };
  const cap = event?.cap ?? TURN_DAILY_MINTS;

  switch (event?.type) {
    case 'hit': {
      const limit = GUARD_LIMITS[event.kind];
      if (!limit || typeof event.key !== 'string' || !event.key) return { ...base, state: s, allow: false };
      const k = `${event.kind}:${event.key}`;
      const w = s.hits[k] ?? { start: now, count: 0 };
      if (w.count >= limit) {
        s.hits[k] = w;
        return { ...base, state: s, allow: false, retryAfterMs: Math.max(0, w.start + GUARD_WINDOW_MS - now) };
      }
      s.hits[k] = { start: w.start, count: w.count + 1 };
      return { ...base, state: s, allow: true };
    }
    case 'mint': {
      if (s.mints >= cap) return { ...base, state: s, allow: false, mintsLeft: 0 };
      s.mints += 1;
      return { ...base, state: s, allow: true, mintsLeft: cap - s.mints };
    }
    case 'status':
      return { ...base, state: s, allow: s.mints < cap, mintsLeft: Math.max(0, cap - s.mints) };
    default:
      return { ...base, state: s, allow: false };
  }
}
