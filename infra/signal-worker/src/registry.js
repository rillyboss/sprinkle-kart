// Pure logic for the open-games list (NETWORKING.md §4.2 "Games you can join"): the reserved SignalRoom
// instance named 'lobby' keeps one small entry per listed room, and GET /rooms reads them.
//
// A room is listed only while its host is connected, the host wants it listed and the room is not locked
// (the room's own Durable Object decides that and sends put / remove here). Entries carry no free text: the
// 4-letter code, the host P1's racer id (checked against a pattern here and against the game's racer list
// by the game) and a player count. Every entry expires LISTING_TTL_MS after its last refresh (the host's
// game refreshes it every couple of minutes), so a host that vanished without a goodbye drops off the list
// on its own.
import { LIST_CODE_RE } from './codes.js';

export const REGISTRY_NAME = 'lobby';
export const LISTING_TTL_MS = 10 * 60 * 1000;
export const MAX_LISTED = 64;
export const LIST_LIMIT = 12;
export const WHO_RE = /^[a-z0-9-]{1,24}$/;
export const MAX_PLAYERS = 8;

export function createRegistryState() {
  return { rooms: {} };
}

/** A clean listing entry, or null when anything is off. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.code !== 'string' || !LIST_CODE_RE.test(e.code)) return null;
  const who = typeof e.who === 'string' && WHO_RE.test(e.who) ? e.who : null;
  const n = Number(e.players);
  const players = Number.isInteger(n) && n >= 1 && n <= MAX_PLAYERS ? n : 1;
  return { code: e.code, who, players };
}

function prune(rooms, now) {
  const out = {};
  for (const [room, e] of Object.entries(rooms)) if (now - e.updated < LISTING_TTL_MS) out[room] = { ...e };
  return out;
}

/**
 * @param {ReturnType<typeof createRegistryState>} state
 * @param {{ type: 'put', room: string, entry: object, now: number }
 *       | { type: 'remove', room: string, now: number }
 *       | { type: 'list', now: number }} ev
 * @returns {{ state: object, changed: boolean, rooms?: Array<{ code: string, who: string|null, players: number, ageS: number }> }}
 */
export function registryReduce(state, ev) {
  const now = Number(ev?.now) || 0;
  const before = state?.rooms ?? {};
  const rooms = prune(before, now);
  let changed = Object.keys(rooms).length !== Object.keys(before).length;
  switch (ev?.type) {
    case 'put': {
      const entry = cleanEntry(ev.entry);
      if (!entry || typeof ev.room !== 'string') return { state: { rooms }, changed };
      const prev = rooms[ev.room];
      rooms[ev.room] = { ...entry, created: prev?.created ?? now, updated: now };
      const ids = Object.keys(rooms);
      if (ids.length > MAX_LISTED) {
        ids.sort((a, b) => rooms[a].updated - rooms[b].updated);
        for (const id of ids.slice(0, ids.length - MAX_LISTED)) delete rooms[id];
      }
      return { state: { rooms }, changed: true };
    }
    case 'remove':
      if (rooms[ev.room]) { delete rooms[ev.room]; changed = true; }
      return { state: { rooms }, changed };
    case 'list': {
      const list = Object.values(rooms)
        .sort((a, b) => b.created - a.created)
        .slice(0, LIST_LIMIT)
        .map((e) => ({ code: e.code, who: e.who, players: e.players, ageS: Math.max(0, Math.round((now - e.created) / 1000)) }));
      return { state: { rooms }, changed, rooms: list };
    }
    default:
      return { state: { rooms }, changed };
  }
}
