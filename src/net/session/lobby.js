/**
 * LobbyState — host-owned, sent to guests in LOBBY (NETWORKING.md §10.3).
 *
 *   { v: 1, label: 'SPRINKLE-4821', phase, locked, capacity: 8,
 *     houses: [{ houseId, emoji, isHost, net: 'ok'|'wobbly'|'asleep', rttMs,
 *                players: [{ globalPi, seat, characterId|null, paintId, easyDrive, ready }] }],
 *     hostChoice: { mode, trackId, cupId, arenaId, speedClass, laps } }
 *
 * The secret sweets are NEVER in LobbyState (guests already know them; the host
 * screen reads them locally), and neither are peer ids or the approval queue.
 * Global player index 0..7 is assigned by the host in join order (lowest free
 * index) and kept for the whole session; it decides nothing about the grid.
 *
 * `lobbyReduce(lobby, action) → { lobby, effects }`. Effects the host session
 * carries out: { type: 'setLocked', locked } (every matchmaker),
 * { type: 'drop', peerId, houseId } (close that house's connection) and
 * { type: 'refused', reason } (nothing changed; for the caller / tests).
 *
 * LOBBY sends are coalesced to ≤ 4/s per guest and never sent during a race:
 * `createLobbyCoalescer()` below.
 *
 * OWNER: WS6 (session, lobby & screens).
 */
import { MAX_LOCAL_PLAYERS, MAX_HUMANS, SPEED_CLASSES, DEFAULT_LAPS } from '../../config.js';
import { ONLINE_MODES } from './modes.js';

export const LOBBY_VERSION = 1;
export const MAX_HOUSES = 8;
/** House emoji by houseId (the host is 🏰). */
export const HOUSE_EMOJI = Object.freeze(['🏰', '🏡', '🏠', '⛺', '🏯', '🎪', '🗼', '🛸']);
export const LOBBY_PHASES = Object.freeze(['lobby', 'mode', 'characters', 'course', 'loading', 'race', 'results', 'standings', 'ceremony']);
export const NET_STATES = Object.freeze(['ok', 'wobbly', 'asleep']);
export const LOBBY_SEND_INTERVAL_MS = 250; // ≤ 4 LOBBY sends per second per guest

export function defaultHostChoice() {
  return { mode: 'free', trackId: null, cupId: null, arenaId: null, speedClass: 'zippy', laps: DEFAULT_LAPS };
}

/** @returns {object} an empty lobby for a label (the host house joins with `house-join`). */
export function createLobby({ label = '', capacity = MAX_HUMANS } = {}) {
  return {
    v: LOBBY_VERSION,
    label: String(label),
    phase: 'lobby',
    locked: false,
    capacity: Math.max(1, Math.min(MAX_HUMANS, capacity | 0 || MAX_HUMANS)),
    houses: [],
    hostChoice: defaultHostChoice(),
  };
}

/* ---------------- queries ---------------- */

/** Every player, sorted by global index, with its house id. */
export function allPlayers(lobby) {
  const list = [];
  for (const h of lobby?.houses ?? []) for (const p of h.players) list.push({ ...p, houseId: h.houseId });
  return list.sort((a, b) => a.globalPi - b.globalPi);
}

export const humanCount = (lobby) => allPlayers(lobby).length;
export const seatsLeft = (lobby) => Math.max(0, (lobby?.capacity ?? MAX_HUMANS) - humanCount(lobby));
export const getHouse = (lobby, houseId) => lobby?.houses?.find((h) => h.houseId === houseId) ?? null;
export const hostHouse = (lobby) => lobby?.houses?.find((h) => h.isHost) ?? null;

/** House of a global player index (null if none). */
export function houseOfPi(lobby, globalPi) {
  return lobby?.houses?.find((h) => h.players.some((p) => p.globalPi === globalPi)) ?? null;
}

/** Global indices of one house, in seat order. */
export function housePis(lobby, houseId) {
  const h = getHouse(lobby, houseId);
  return h ? [...h.players].sort((a, b) => a.seat - b.seat).map((p) => p.globalPi) : [];
}

/** Everyone picked a racer and pressed ready (at least one player). */
export function lobbyAllReady(lobby) {
  const ps = allPlayers(lobby);
  return ps.length > 0 && ps.every((p) => p.ready && typeof p.characterId === 'string');
}

/* ---------------- helpers ---------------- */

const out = (lobby, effects = []) => ({ lobby, effects });
const refused = (lobby, reason) => out(lobby, [{ type: 'refused', reason }]);

function lowestFree(used, max) {
  for (let i = 0; i < max; i++) if (!used.has(i)) return i;
  return -1;
}

const freePi = (lobby) => lowestFree(new Set(allPlayers(lobby).map((p) => p.globalPi)), MAX_HUMANS);
const freeHouseId = (lobby) => lowestFree(new Set(lobby.houses.map((h) => h.houseId)), MAX_HOUSES);

function newPlayer(globalPi, seat, { easyDrive = false } = {}) {
  return { globalPi, seat, characterId: null, paintId: 'original', easyDrive: !!easyDrive, ready: false };
}

function withHouse(lobby, houseId, fn) {
  return { ...lobby, houses: lobby.houses.map((h) => (h.houseId === houseId ? fn(h) : h)) };
}

function seatList(players) {
  if (Array.isArray(players)) return players.map((p) => ({ easyDrive: !!p?.easyDrive }));
  const n = Math.max(0, Math.min(MAX_LOCAL_PLAYERS, Number(players) | 0));
  return Array.from({ length: n }, () => ({ easyDrive: false }));
}

function addHouse(lobby, a) {
  if (lobby.houses.length >= MAX_HOUSES) return refused(lobby, 'full');
  if (a.isHost && hostHouse(lobby)) return refused(lobby, 'host-exists');
  const seats = seatList(a.players ?? 1);
  if (seats.length > seatsLeft(lobby)) return refused(lobby, 'full');
  let houseId = Number.isInteger(a.houseId) ? a.houseId : freeHouseId(lobby);
  if (houseId < 0 || houseId >= MAX_HOUSES || getHouse(lobby, houseId)) houseId = freeHouseId(lobby);
  if (houseId < 0) return refused(lobby, 'full');
  let next = lobby;
  const players = [];
  for (let seat = 0; seat < seats.length; seat++) {
    const probe = { ...next, houses: [...next.houses, { houseId, players }] };
    const pi = freePi(probe);
    players.push(newPlayer(pi, seat, seats[seat]));
  }
  const house = {
    houseId,
    emoji: HOUSE_EMOJI[houseId],
    isHost: !!a.isHost,
    net: 'ok',
    rttMs: 0,
    players,
  };
  next = { ...lobby, houses: [...lobby.houses, house].sort((x, y) => x.houseId - y.houseId) };
  return out(next);
}

function sanitizeChoice(prev, patch = {}) {
  const c = { ...prev };
  if (patch.mode !== undefined && ONLINE_MODES.includes(patch.mode)) c.mode = patch.mode;
  for (const k of ['trackId', 'cupId', 'arenaId']) {
    if (patch[k] === null || (typeof patch[k] === 'string' && patch[k].length <= 64)) c[k] = patch[k];
  }
  if (patch.speedClass !== undefined && Object.hasOwn(SPEED_CLASSES, patch.speedClass)) c.speedClass = patch.speedClass;
  if (Number.isInteger(patch.laps) && patch.laps >= 1 && patch.laps <= 9) c.laps = patch.laps;
  if (Array.isArray(patch.customTrackIds)) c.customTrackIds = patch.customTrackIds.filter((t) => typeof t === 'string').slice(0, 8);
  return c;
}

const unready = (lobby) => ({
  ...lobby,
  houses: lobby.houses.map((h) => ({ ...h, players: h.players.map((p) => (p.ready ? { ...p, ready: false } : p)) })),
});

/* ---------------- reducer ---------------- */

/**
 * @param {object} lobby LobbyState
 * @param {{ type: string } & Record<string, any>} a action
 * @returns {{ lobby: object, effects: object[] }}
 */
export function lobbyReduce(lobby, a) {
  switch (a?.type) {
    case 'house-join':
    case 'house-approve':
      return addHouse(lobby, a);

    case 'house-leave': {
      const h = getHouse(lobby, a.houseId);
      if (!h || h.isHost) return refused(lobby, 'no-house');
      return out({ ...lobby, houses: lobby.houses.filter((x) => x !== h) });
    }

    case 'house-remove': {
      const h = getHouse(lobby, a.houseId);
      if (!h || h.isHost) return refused(lobby, 'no-house');
      // Removing a house locks the room in the same step (§1 rule 5, §10.9): a reload of that
      // house gets a new peer id but meets a locked room.
      const next = { ...lobby, locked: true, houses: lobby.houses.filter((x) => x !== h) };
      return out(next, [
        { type: 'setLocked', locked: true },
        { type: 'drop', peerId: a.peerId ?? null, houseId: h.houseId },
      ]);
    }

    case 'seat-join': {
      const h = getHouse(lobby, a.houseId);
      if (!h) return refused(lobby, 'no-house');
      if (h.players.length >= MAX_LOCAL_PLAYERS || seatsLeft(lobby) <= 0) return refused(lobby, 'full');
      const used = new Set(h.players.map((p) => p.seat));
      let seat = Number.isInteger(a.seat) && a.seat >= 0 && a.seat < MAX_LOCAL_PLAYERS && !used.has(a.seat) ? a.seat : lowestFree(used, MAX_LOCAL_PLAYERS);
      if (seat < 0) return refused(lobby, 'full');
      const pi = freePi(lobby);
      return out(withHouse(lobby, h.houseId, (x) => ({
        ...x,
        players: [...x.players, newPlayer(pi, seat, a)].sort((p, q) => p.seat - q.seat),
      })));
    }

    case 'seat-leave': {
      const h = getHouse(lobby, a.houseId);
      if (!h || !h.players.some((p) => p.seat === a.seat)) return refused(lobby, 'no-seat');
      return out(withHouse(lobby, h.houseId, (x) => ({ ...x, players: x.players.filter((p) => p.seat !== a.seat) })));
    }

    case 'pick': {
      const h = getHouse(lobby, a.houseId);
      if (!h || !h.players.some((p) => p.seat === a.seat)) return refused(lobby, 'no-seat');
      if (a.characterId !== null && (typeof a.characterId !== 'string' || a.characterId.length > 64)) return refused(lobby, 'bad-pick');
      return out(withHouse(lobby, h.houseId, (x) => ({
        ...x,
        players: x.players.map((p) => (p.seat !== a.seat ? p : {
          ...p,
          characterId: a.characterId,
          paintId: typeof a.paintId === 'string' && a.paintId.length <= 64 ? a.paintId : p.paintId,
          easyDrive: typeof a.easyDrive === 'boolean' ? a.easyDrive : p.easyDrive,
        })),
      })));
    }

    case 'ready': {
      const h = getHouse(lobby, a.houseId);
      const p0 = h?.players.find((p) => p.seat === a.seat);
      if (!p0) return refused(lobby, 'no-seat');
      const ready = a.ready !== false;
      if (ready && typeof p0.characterId !== 'string') return refused(lobby, 'no-racer');
      return out(withHouse(lobby, h.houseId, (x) => ({ ...x, players: x.players.map((p) => (p.seat === a.seat ? { ...p, ready } : p)) })));
    }

    case 'lock':
      if (lobby.locked) return out(lobby);
      return out({ ...lobby, locked: true }, [{ type: 'setLocked', locked: true }]);

    case 'unlock':
      if (!lobby.locked) return out(lobby);
      return out({ ...lobby, locked: false }, [{ type: 'setLocked', locked: false }]);

    case 'choice':
      return out({ ...lobby, hostChoice: sanitizeChoice(lobby.hostChoice, a.patch ?? {}) });

    case 'phase': {
      if (!LOBBY_PHASES.includes(a.phase)) return refused(lobby, 'bad-phase');
      const next = { ...lobby, phase: a.phase };
      return out(a.phase === 'lobby' || a.phase === 'characters' ? unready(next) : next);
    }

    case 'net': {
      const h = getHouse(lobby, a.houseId);
      if (!h || !NET_STATES.includes(a.net)) return refused(lobby, 'no-house');
      const rttMs = Number.isFinite(a.rttMs) ? Math.max(0, Math.min(65535, Math.round(a.rttMs))) : h.rttMs;
      if (h.net === a.net && h.rttMs === rttMs) return out(lobby);
      return out(withHouse(lobby, h.houseId, (x) => ({ ...x, net: a.net, rttMs })));
    }

    default:
      return refused(lobby, 'unknown');
  }
}

/* ---------------- LOBBY send coalescing (≤ 4/s per guest, never mid-race) ---------------- */

/**
 * Per-guest coalescer: `change(now)` marks the lobby dirty and says whether to
 * send right now; `tick(now)` says whether a pending change may go out;
 * `setRacing(on)` holds everything while a race runs (in-race lobby changes
 * wait for results). Changes within LOBBY_SEND_INTERVAL_MS merge into one send.
 */
export function createLobbyCoalescer({ intervalMs = LOBBY_SEND_INTERVAL_MS } = {}) {
  let last = -Infinity;
  let dirty = false;
  let racing = false;
  const due = (now) => dirty && !racing && now - last >= intervalMs;
  const take = (now) => { last = now; dirty = false; return true; };
  return {
    change(now) { dirty = true; return due(now) ? take(now) : false; },
    tick(now) { return due(now) ? take(now) : false; },
    setRacing(on) { racing = !!on; },
    get pending() { return dirty; },
    get racing() { return racing; },
  };
}

/** A plain copy of the lobby for the wire (never carries secrets or peer ids by construction). */
export function lobbyForWire(lobby) {
  return {
    v: lobby.v,
    label: lobby.label,
    phase: lobby.phase,
    locked: !!lobby.locked,
    capacity: lobby.capacity,
    houses: lobby.houses.map((h) => ({
      houseId: h.houseId,
      emoji: h.emoji,
      isHost: !!h.isHost,
      net: h.net,
      rttMs: h.rttMs,
      players: h.players.map((p) => ({
        globalPi: p.globalPi, seat: p.seat, characterId: p.characterId, paintId: p.paintId, easyDrive: !!p.easyDrive, ready: !!p.ready,
      })),
    })),
    hostChoice: { ...lobby.hostChoice },
  };
}
