/**
 * PublicSignaling (NETWORKING.md §4.2): zero-setup matchmaking over other people's public
 * infrastructure via Trystero 0.25.4 — WebTorrent trackers first, Nostr relays added after
 * 6 s without a host. Both packages are loaded lazily with `import()` (they end up in their own
 * chunks; nothing is downloaded until a player opens Online).
 *
 * Trystero is a mesh, so every pair of machines in the topic connects. Each side sends a tiny
 * `sk-role` action ({ v, role, id }) on join; a pair where one side is not the host (guest ↔
 * guest) is closed at once and never surfaced. Trystero's own peer ids are per-module and
 * random; we surface OUR app-level selfId (from `sk-role`) so a guest has one id on every
 * matchmaker. The RTCPeerConnection handed out is Trystero's own (via `room.getPeers()`); the
 * WebRtcTransport adds the negotiated channels 8/9 on it (Trystero's "data" channel is ignored).
 */
import { SignalingError, createListeners, isPeerId } from './types.js';
import {
  PUBLIC_TRACKERS,
  PUBLIC_NOSTR_RELAYS,
  NOSTR_REDUNDANCY,
  TRYSTERO_APP_ID,
  TRYSTERO_TORRENT_MODULE,
  TRYSTERO_NOSTR_MODULE,
} from './relays.js';

export const PUBLIC_FALLBACK_AFTER_MS = 6000;
export const ROLE_ACTION = 'sk-role';
export const ROLE_TIMEOUT_MS = 8000;
/** A locked host tells a knocking guest "closed" on the role channel, then closes the pair this much later. */
export const REFUSE_CLOSE_MS = 600;
const ROLE_VERSION = 1;

/**
 * Default importer: literal specifiers so Vite code-splits each strategy into its own chunk.
 * (A variable `import(m)` would not be bundled; `trystero/<strategy>` subpaths now throw.)
 * @param {string} m
 */
export function defaultTrysteroImporter(m) {
  if (m === TRYSTERO_TORRENT_MODULE) return import('@trystero-p2p/torrent');
  if (m === TRYSTERO_NOSTR_MODULE) return import('@trystero-p2p/nostr');
  return Promise.reject(new Error(`unknown signaling module ${m}`));
}

/**
 * Validate an incoming `sk-role` payload. A host may add `refused: 'locked'` (its room is closed): the guest
 * then shows "The host's room is closed for now 🔒" instead of waiting for a connection that never comes.
 * @param {unknown} data
 * @returns {{ role: 'host'|'guest', id: string, refused?: 'locked' } | null}
 */
export function parseRoleMessage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = /** @type {any} */ (data);
  if (d.v !== ROLE_VERSION) return null;
  if (d.role !== 'host' && d.role !== 'guest') return null;
  if (!isPeerId(d.id)) return null;
  return d.role === 'host' && d.refused === 'locked' ? { role: d.role, id: d.id, refused: 'locked' } : { role: d.role, id: d.id };
}

/**
 * @param {object} [o]
 * @param {string[]} [o.trackers]
 * @param {string[]} [o.nostrRelays]
 * @param {number} [o.fallbackAfterMs]
 * @param {(m: string) => Promise<any>} [o.importer]
 * @param {typeof RTCPeerConnection} [o.RTCPeerConnectionImpl]  passed to Trystero as rtcPolyfill
 * @param {{ setTimeout: Function, clearTimeout: Function }} [o.timers]
 * @param {number} [o.roleTimeoutMs]
 * @returns {import('./types.js').SignalingTransport & Record<string, any>}
 */
export function createPublicSignaling({
  trackers = [...PUBLIC_TRACKERS],
  nostrRelays = [...PUBLIC_NOSTR_RELAYS],
  fallbackAfterMs = PUBLIC_FALLBACK_AFTER_MS,
  importer = defaultTrysteroImporter,
  RTCPeerConnectionImpl,
  timers = globalThis,
  roleTimeoutMs = ROLE_TIMEOUT_MS,
} = {}) {
  const connL = createListeners();
  const leaveL = createListeners();
  const refusedL = createListeners();

  /**
   * @typedef {object} Sub
   * @property {'torrent'|'nostr'} name
   * @property {any} room
   * @property {Map<string, string>} map      trystero peer id → app selfId
   * @property {Map<string, any>} pending     trystero peer id → role timeout
   * @property {Set<string>} blocked          trystero ids we closed (non-host pairs)
   * @property {boolean} left
   */
  /** @type {Sub[]} */
  const subs = [];
  let joinedOpts = null;
  let role = 'guest';
  let selfId = '';
  let locked = false;
  let left = false;
  let hostId = null;
  let fallbackTimer = null;
  const dropped = new Set();
  /** Shared by every Trystero config so setIceServers() reaches pcs created later. */
  const rtcConfig = { iceServers: /** @type {RTCIceServer[]} */ ([]), iceTransportPolicy: 'all' };
  const log = { closedNonHost: 0, roleTimeouts: 0, joinErrors: [], fallbackJoined: false };

  function closeTid(sub, tid) {
    const t = sub.pending.get(tid);
    if (t) timers.clearTimeout(t);
    sub.pending.delete(tid);
    let pc = null;
    try {
      pc = sub.room.getPeers()[tid] ?? null;
    } catch {
      pc = null;
    }
    try {
      pc?.close();
    } catch {
      /* ignore */
    }
  }

  function onRole(sub, tid, data) {
    if (sub.left || left) return;
    const t = sub.pending.get(tid);
    if (t) timers.clearTimeout(t);
    sub.pending.delete(tid);
    const msg = parseRoleMessage(data);
    if (role === 'guest' && msg?.refused && msg.id !== selfId) {
      // the host is here but its room is locked: say so (never the NAT tips)
      sub.map.delete(tid);
      closeTid(sub, tid);
      refusedL.emit(msg.refused);
      return;
    }
    if (sub.map.has(tid)) return;
    if (!msg || msg.id === selfId) {
      closeTid(sub, tid);
      return;
    }
    const pair = (role === 'host' && msg.role === 'guest') || (role === 'guest' && msg.role === 'host');
    if (!pair) {
      // Trystero's mesh also links guest ↔ guest: we only ever want the star.
      log.closedNonHost++;
      sub.blocked.add(tid);
      closeTid(sub, tid);
      return;
    }
    if (role === 'host' && (locked || dropped.has(msg.id))) {
      try {
        Promise.resolve(sub.action?.send({ v: ROLE_VERSION, role: 'host', id: selfId, refused: 'locked' }, { target: tid })).catch(() => {});
      } catch {
        /* ignore */
      }
      timers.setTimeout(() => closeTid(sub, tid), REFUSE_CLOSE_MS);
      return;
    }
    if (role === 'guest') {
      if (hostId && hostId !== msg.id) {
        closeTid(sub, tid); // one host per room
        return;
      }
      hostId = msg.id;
      if (fallbackTimer && sub.name === 'torrent') {
        timers.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    }
    let pc = null;
    try {
      pc = sub.room.getPeers()[tid] ?? null;
    } catch {
      pc = null;
    }
    if (!pc) return;
    sub.map.set(tid, msg.id);
    connL.emit({ peerId: msg.id, pc, kind: 'public', via: sub.name });
  }

  function joinSub(name, mod, relayConfig) {
    const cfg = {
      appId: TRYSTERO_APP_ID,
      password: joinedOpts.ids.password,
      relayConfig,
      rtcConfig,
      ...(RTCPeerConnectionImpl ? { rtcPolyfill: RTCPeerConnectionImpl } : {}),
    };
    const room = mod.joinRoom(cfg, joinedOpts.ids.topic, {
      onJoinError: (e) => log.joinErrors.push(String(e?.error ?? 'join error').slice(0, 80)),
    });
    /** @type {Sub} */
    const sub = { name, room, map: new Map(), pending: new Map(), blocked: new Set(), left: false };
    subs.push(sub);
    const action = room.makeAction(ROLE_ACTION);
    sub.action = action;
    action.onMessage = (data, ctx) => onRole(sub, ctx?.peerId, data);
    room.onPeerJoin = (tid) => {
      if (sub.left || left) return;
      if (sub.blocked.has(tid)) {
        closeTid(sub, tid);
        return;
      }
      sub.pending.set(
        tid,
        timers.setTimeout(() => {
          if (!sub.map.has(tid)) {
            log.roleTimeouts++;
            closeTid(sub, tid);
          }
        }, roleTimeoutMs),
      );
      Promise.resolve(action.send({ v: ROLE_VERSION, role, id: selfId }, { target: tid })).catch(() => {});
    };
    room.onPeerLeave = (tid) => {
      const t = sub.pending.get(tid);
      if (t) timers.clearTimeout(t);
      sub.pending.delete(tid);
      const pid = sub.map.get(tid);
      if (!pid) return;
      sub.map.delete(tid);
      if (role === 'guest' && pid === hostId && !subs.some((s) => [...s.map.values()].includes(pid))) hostId = null;
      leaveL.emit(pid, { kind: 'public', via: name });
    };
    return sub;
  }

  async function leaveSub(sub) {
    if (sub.left) return;
    sub.left = true;
    for (const t of sub.pending.values()) timers.clearTimeout(t);
    sub.pending.clear();
    const idx = subs.indexOf(sub);
    if (idx >= 0) subs.splice(idx, 1);
    try {
      await sub.room.leave();
    } catch {
      /* ignore */
    }
  }

  async function startNostr() {
    fallbackTimer = null;
    if (!nostrRelays.length) return; // dev override (local trackers only): never touch public relays
    if (left || subs.some((s) => s.name === 'nostr')) return;
    if (role === 'guest' && hostId) return;
    let mod;
    try {
      mod = await importer(TRYSTERO_NOSTR_MODULE);
    } catch {
      log.joinErrors.push('nostr import failed');
      return;
    }
    if (left || (role === 'guest' && hostId)) return;
    log.fallbackJoined = true;
    joinSub('nostr', mod, { urls: [...nostrRelays], redundancy: NOSTR_REDUNDANCY });
  }

  const api = {
    kind: /** @type {'public'} */ ('public'),
    detail: () => (subs.length ? subs.map((s) => `public-${s.name}`).join('+') : 'public'),
    stats: () => ({ ...log, rooms: subs.map((s) => s.name), peers: subs.reduce((n, s) => n + s.map.size, 0), locked }),
    /** @param {import('./types.js').JoinOptions} o */
    async join({ ids, role: r, selfId: me, iceServers = [], relayOnly = false }) {
      if (joinedOpts) throw new SignalingError('unreachable', { kind: 'public', detail: 'already-joined' });
      if (!ids || typeof ids.topic !== 'string' || typeof ids.password !== 'string') throw new SignalingError('unreachable', { kind: 'public', detail: 'bad-ids' });
      role = r === 'host' ? 'host' : 'guest';
      selfId = me;
      left = false;
      rtcConfig.iceServers = [...iceServers];
      rtcConfig.iceTransportPolicy = relayOnly ? 'relay' : 'all';
      let mod;
      try {
        mod = await importer(TRYSTERO_TORRENT_MODULE);
      } catch (e) {
        throw new SignalingError('unreachable', { kind: 'public', detail: 'import', cause: e });
      }
      if (left) throw new SignalingError('unreachable', { kind: 'public', detail: 'left' });
      joinedOpts = { ids, role, selfId };
      try {
        joinSub('torrent', mod, { urls: [...trackers] });
      } catch (e) {
        joinedOpts = null;
        throw new SignalingError('unreachable', { kind: 'public', detail: 'join', cause: e });
      }
      // Hosts always add Nostr after the delay (guests that fall back must find them there);
      // guests only when no host answered on the trackers.
      if (nostrRelays.length) {
        fallbackTimer = timers.setTimeout(() => {
          startNostr();
        }, fallbackAfterMs);
      }
      return { iceServers: rtcConfig.iceServers };
    },
    onPeerConnection: (fn) => connL.add(fn),
    onPeerLeave: (fn) => leaveL.add(fn),
    /** Guest: the host answered but its room is locked (`fn('locked')`). */
    onRefused: (fn) => refusedL.add(fn),
    drop(peerId) {
      if (role !== 'host') return;
      dropped.add(peerId);
      let found = false;
      for (const sub of subs)
        for (const [tid, pid] of [...sub.map]) {
          if (pid !== peerId) continue;
          sub.map.delete(tid);
          closeTid(sub, tid);
          found = true;
        }
      if (found) leaveL.emit(peerId, { kind: 'public' });
    },
    setLocked(value) {
      if (role !== 'host') return;
      locked = !!value;
      if (!locked) dropped.clear();
    },
    /** Public signaling has no TURN of its own: the current (STUN or Worker-given) servers. */
    async refreshIce() {
      return rtcConfig.iceServers;
    },
    /** Dual matchmaker: hand Trystero better ICE servers (Worker TURN) for pcs created later. */
    setIceServers(list) {
      if (Array.isArray(list) && list.length) rtcConfig.iceServers = [...list];
    },
    async restartIce(peerId) {
      for (const sub of subs)
        for (const [tid, pid] of sub.map) {
          if (pid !== peerId) continue;
          const pc = sub.room.getPeers()[tid];
          if (pc && typeof pc.restartIce === 'function') {
            pc.restartIce(); // Trystero renegotiates over its own data channel
            return true;
          }
        }
      return false;
    },
    /**
     * The WebRtcTransport reports the connection that won: a guest keeps only that
     * sub-matchmaker (torrent or nostr) and stops the Nostr fallback timer.
     */
    settle(peerId, pc) {
      if (role !== 'guest') return;
      if (fallbackTimer) {
        timers.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      const owner = subs.find((s) => {
        for (const [tid, pid] of s.map) if (pid === peerId && s.room.getPeers()[tid] === pc) return true;
        return false;
      });
      if (!owner) return;
      for (const s of [...subs]) if (s !== owner) leaveSub(s);
    },
    async leave() {
      if (left) return;
      left = true;
      if (fallbackTimer) timers.clearTimeout(fallbackTimer);
      fallbackTimer = null;
      await Promise.all([...subs].map(leaveSub));
      joinedOpts = null;
      hostId = null;
      connL.clear();
      leaveL.clear();
      refusedL.clear();
    },
  };
  return api;
}
