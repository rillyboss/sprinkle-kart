/**
 * WorkerSignaling (NETWORKING.md §4.2): talks to our Cloudflare Worker `sprinkle-kart-signal`
 * over `wss://…/room/<workerRoom>?role=host|guest&peer=<selfId>&proto=1`.
 *
 * - The guest is ALWAYS the offerer to the host (no glare, no perfect negotiation needed).
 * - Trickle ICE: every local candidate is relayed at once as `{ t: 'signal', to, data }`.
 * - One ICE restart on `failed` (guest side): `refreshIce()` first (fresh TURN creds via
 *   `{ t: 'ice' }`), `pc.setConfiguration`, then an `iceRestart` offer. A host that needs a
 *   restart (TURN renewal) asks the guest with a `restart-request` signal.
 * - JSON protocol exactly as §4.2; `{ t: 'error', code }` → SignalingError.
 *
 * `data` inside a signal is ours: `{ type: 'offer'|'answer', sdp }`,
 * `{ type: 'candidate', candidate }` or `{ type: 'restart-request' }`.
 */
import { SignalingError, workerErrorToSignalingError, createListeners, isPeerId } from './types.js';

export const WORKER_PROTO = 1;
export const WORKER_JOIN_TIMEOUT_MS = 10000;
export const WORKER_ICE_TIMEOUT_MS = 5000;
export const WORKER_ICE_MIN_INTERVAL_MS = 30000;
export const WORKER_PING_MS = 25000;
export const WORKER_MAX_MSG_BYTES = 16 * 1024;
const MAX_EARLY_CANDIDATES = 32;

/**
 * `https://x.workers.dev` → `wss://x.workers.dev/room/<room>?role=…&peer=…&proto=1`.
 * @param {string} baseUrl
 * @param {{ workerRoom: string, role: string, selfId: string }} o
 */
export function workerRoomUrl(baseUrl, { workerRoom, role, selfId }) {
  const u = new URL(String(baseUrl));
  if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol === 'http:') u.protocol = 'ws:';
  if (u.protocol !== 'wss:' && u.protocol !== 'ws:') throw new SignalingError('unreachable', { kind: 'worker', detail: 'bad-url' });
  const base = u.pathname.replace(/\/+$/, '');
  u.pathname = `${base}/room/${encodeURIComponent(workerRoom)}`;
  u.search = '';
  u.hash = '';
  u.searchParams.set('role', role);
  u.searchParams.set('peer', selfId);
  u.searchParams.set('proto', String(WORKER_PROTO));
  return u.toString();
}

/**
 * @param {object} o
 * @param {string} o.baseUrl                   VITE_SIGNAL_URL (https://…)
 * @param {typeof WebSocket} [o.WebSocketImpl]
 * @param {typeof fetch} [o.fetchImpl]         (unused by the room socket; kept for the §4 signature)
 * @param {typeof RTCPeerConnection} [o.RTCPeerConnectionImpl]
 * @param {{ setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function }} [o.timers]
 * @param {() => number} [o.now]
 * @param {number} [o.joinTimeoutMs]
 * @returns {import('./types.js').SignalingTransport & Record<string, any>}
 */
export function createWorkerSignaling({
  baseUrl,
  WebSocketImpl = globalThis.WebSocket,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  timers = globalThis,
  now = () => Date.now(),
  joinTimeoutMs = WORKER_JOIN_TIMEOUT_MS,
} = /** @type {any} */ ({})) {
  const connL = createListeners();
  const leaveL = createListeners();

  /** @type {WebSocket|null} */
  let ws = null;
  let role = /** @type {'host'|'guest'} */ ('guest');
  let selfId = '';
  let hostId = null;
  let joined = false;
  let left = false;
  let locked = false;
  let relayOnly = false;
  /** @type {RTCIceServer[]} */
  let ice = [];
  let lastIceAt = -Infinity;
  /** @type {null | { resolve: Function, timer: any }} */
  let icePending = null;
  let pingTimer = null;
  /** @type {Map<string, { pc: RTCPeerConnection, pendingCands: any[], restarted: boolean }>} */
  const peers = new Map();
  /** @type {Map<string, any[]>} candidates that arrived before their offer (host) */
  const earlyCands = new Map();
  const stats = { sent: 0, received: 0, restarts: 0, errors: [] };

  function sendMsg(obj) {
    if (!ws || ws.readyState !== 1) return false;
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (text.length > WORKER_MAX_MSG_BYTES) return false;
    try {
      ws.send(text);
      stats.sent++;
      return true;
    } catch {
      return false;
    }
  }

  function signal(to, data) {
    return sendMsg({ t: 'signal', to, data });
  }

  function pcConfig() {
    return { iceServers: ice, iceTransportPolicy: relayOnly ? 'relay' : 'all' };
  }

  function removePeer(peerId, emit = true) {
    const p = peers.get(peerId);
    if (!p) return;
    peers.delete(peerId);
    earlyCands.delete(peerId);
    try {
      p.pc.close();
    } catch {
      /* ignore */
    }
    if (emit) leaveL.emit(peerId, { kind: 'worker' });
  }

  function makePc(peerId) {
    const pc = new RTCPeerConnectionImpl(pcConfig());
    const entry = { pc, pendingCands: [], restarted: false };
    peers.set(peerId, entry);
    pc.addEventListener('icecandidate', (ev) => {
      const c = /** @type {any} */ (ev).candidate;
      if (!c || !c.candidate) return;
      const json = typeof c.toJSON === 'function' ? c.toJSON() : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment };
      signal(peerId, { type: 'candidate', candidate: json });
    });
    const onState = () => {
      if (peers.get(peerId)?.pc !== pc) return;
      if ((pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') && role === 'guest' && !entry.restarted) {
        entry.restarted = true;
        restartGuest(peerId).catch(() => {});
      }
    };
    pc.addEventListener('connectionstatechange', onState);
    pc.addEventListener('iceconnectionstatechange', onState);
    return entry;
  }

  async function flushCands(entry) {
    const list = entry.pendingCands.splice(0);
    for (const c of list) {
      try {
        await entry.pc.addIceCandidate(c);
      } catch {
        /* stale candidate after a restart: ignore */
      }
    }
  }

  async function offerTo(peerId, { iceRestart = false } = {}) {
    const entry = peers.get(peerId);
    if (!entry) return false;
    const { pc } = entry;
    if (iceRestart && typeof pc.restartIce === 'function') pc.restartIce();
    const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await pc.setLocalDescription(offer);
    return signal(peerId, { type: 'offer', sdp: pc.localDescription?.sdp ?? offer.sdp });
  }

  async function restartGuest(peerId) {
    const entry = peers.get(peerId);
    if (!entry) return false;
    stats.restarts++;
    const fresh = await api.refreshIce();
    try {
      const cfg = typeof entry.pc.getConfiguration === 'function' ? entry.pc.getConfiguration() : {};
      entry.pc.setConfiguration({ ...cfg, iceServers: fresh });
    } catch {
      /* some browsers refuse identical configs; the restart still helps */
    }
    return offerTo(peerId, { iceRestart: true });
  }

  async function onSignal(from, data) {
    if (!isPeerId(from) || !data || typeof data !== 'object') return;
    if (role === 'guest' && from !== hostId) return; // guests only ever talk to the host
    let entry = peers.get(from);
    if (data.type === 'offer' && typeof data.sdp === 'string') {
      if (role !== 'host') return; // the guest is the offerer; a host offer would be glare
      if (!entry) {
        if (locked) return;
        entry = makePc(from);
        const early = earlyCands.get(from);
        earlyCands.delete(from);
        if (early) entry.pendingCands.push(...early);
        connL.emit({ peerId: from, pc: entry.pc, kind: 'worker' });
      }
      await entry.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      await flushCands(entry);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      signal(from, { type: 'answer', sdp: entry.pc.localDescription?.sdp ?? answer.sdp });
      return;
    }
    if (!entry) {
      // Trickle ICE may overtake the offer on the way through the Worker: keep a few.
      if (role === 'host' && data.type === 'candidate' && data.candidate && typeof data.candidate === 'object') {
        const list = earlyCands.get(from) ?? [];
        if (list.length < MAX_EARLY_CANDIDATES && earlyCands.size < 16) list.push(data.candidate);
        earlyCands.set(from, list);
      }
      return;
    }
    if (data.type === 'answer' && typeof data.sdp === 'string') {
      if (role !== 'guest') return;
      await entry.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await flushCands(entry);
      return;
    }
    if (data.type === 'candidate' && data.candidate && typeof data.candidate === 'object') {
      if (!entry.pc.remoteDescription) entry.pendingCands.push(data.candidate);
      else {
        try {
          await entry.pc.addIceCandidate(data.candidate);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (data.type === 'restart-request' && role === 'guest') {
      await restartGuest(from);
    }
  }

  function onMessage(raw, resolveJoin, rejectJoin) {
    stats.received++;
    if (typeof raw !== 'string') return;
    if (raw === 'pong') return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'joined': {
        if (joined) return;
        joined = true;
        if (Array.isArray(msg.iceServers) && msg.iceServers.length) ice = msg.iceServers;
        lastIceAt = now();
        hostId = role === 'host' ? selfId : isPeerId(msg.host) ? msg.host : null;
        pingTimer = timers.setInterval(() => sendMsg('ping'), WORKER_PING_MS);
        resolveJoin({ iceServers: ice, turn: !!msg.turn });
        if (role === 'guest' && hostId) {
          const entry = makePc(hostId);
          connL.emit({ peerId: hostId, pc: entry.pc, kind: 'worker' });
          offerTo(hostId).catch(() => {});
        }
        return;
      }
      case 'error': {
        const err = workerErrorToSignalingError(msg.code);
        stats.errors.push(err.code);
        if (!joined) rejectJoin(err);
        return;
      }
      case 'ice': {
        if (Array.isArray(msg.iceServers) && msg.iceServers.length) {
          ice = msg.iceServers;
          lastIceAt = now();
        }
        if (icePending) {
          timers.clearTimeout(icePending.timer);
          const p = icePending;
          icePending = null;
          p.resolve(ice);
        }
        return;
      }
      case 'peer-join':
        return; // the guest's offer creates the pc
      case 'peer-leave': {
        if (isPeerId(msg.peer)) removePeer(msg.peer);
        return;
      }
      case 'signal': {
        onSignal(msg.from, msg.data).catch(() => {});
        return;
      }
      default:
        return;
    }
  }

  const api = {
    kind: /** @type {'worker'} */ ('worker'),
    detail: () => 'worker',
    stats: () => ({ ...stats, peers: peers.size, joined, locked }),
    /** @param {import('./types.js').JoinOptions} o */
    join({ ids, role: r, selfId: me, iceServers = [], relayOnly: ro = false }) {
      if (ws) return Promise.reject(new SignalingError('unreachable', { kind: 'worker', detail: 'already-joined' }));
      if (!WebSocketImpl) return Promise.reject(new SignalingError('unreachable', { kind: 'worker', detail: 'no-websocket' }));
      role = r === 'host' ? 'host' : 'guest';
      selfId = me;
      relayOnly = !!ro;
      ice = iceServers;
      left = false;
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn, v) => {
          if (settled) return;
          settled = true;
          timers.clearTimeout(timer);
          fn(v);
        };
        const fail = (err) => {
          if (settled) return;
          done(reject, err);
          const sock = ws;
          ws = null; // a failed join may be retried with a fresh socket
          try {
            sock?.close();
          } catch {
            /* ignore */
          }
        };
        const timer = timers.setTimeout(() => fail(new SignalingError('timeout', { kind: 'worker' })), joinTimeoutMs);
        let url;
        try {
          url = workerRoomUrl(baseUrl, { workerRoom: ids.workerRoom, role, selfId });
          ws = new WebSocketImpl(url);
        } catch (e) {
          fail(e instanceof SignalingError ? e : new SignalingError('unreachable', { kind: 'worker', cause: e }));
          return;
        }
        const sock = ws;
        sock.onmessage = (ev) => onMessage(ev.data, (v) => done(resolve, v), fail);
        sock.onerror = () => {
          if (!joined) fail(new SignalingError('unreachable', { kind: 'worker' }));
        };
        sock.onclose = () => {
          if (!joined) fail(new SignalingError('unreachable', { kind: 'worker', detail: 'closed' }));
          timers.clearInterval(pingTimer);
          if (icePending) {
            const p = icePending;
            icePending = null;
            timers.clearTimeout(p.timer);
            p.resolve(ice);
          }
        };
      });
    },
    onPeerConnection: (fn) => connL.add(fn),
    onPeerLeave: (fn) => leaveL.add(fn),
    drop(peerId) {
      if (role !== 'host') return;
      sendMsg({ t: 'drop', peer: peerId });
      removePeer(peerId);
    },
    setLocked(value) {
      if (role !== 'host') return;
      locked = !!value;
      sendMsg({ t: 'lock', locked });
    },
    /** Fresh TURN creds (≤ 1 request per 30 s per socket; cached in between). */
    refreshIce() {
      if (!joined || left || !ws || ws.readyState !== 1) return Promise.resolve(ice);
      if (now() - lastIceAt < WORKER_ICE_MIN_INTERVAL_MS) return Promise.resolve(ice);
      if (icePending) return new Promise((res) => {
        const prev = icePending.resolve;
        icePending.resolve = (v) => {
          prev(v);
          res(v);
        };
      });
      return new Promise((resolve) => {
        const timer = timers.setTimeout(() => {
          icePending = null;
          resolve(ice);
        }, WORKER_ICE_TIMEOUT_MS);
        icePending = { resolve, timer };
        if (!sendMsg({ t: 'ice' })) {
          timers.clearTimeout(timer);
          icePending = null;
          resolve(ice);
        }
      });
    },
    /** ICE restart towards `peerId` (guest: new offer; host: asks the guest). */
    async restartIce(peerId) {
      if (!peers.has(peerId)) return false;
      if (role === 'guest') return restartGuest(peerId);
      return signal(peerId, { type: 'restart-request' });
    },
    async leave() {
      if (left) return;
      left = true;
      timers.clearInterval(pingTimer);
      for (const id of [...peers.keys()]) removePeer(id, false);
      try {
        ws?.close(1000, 'bye');
      } catch {
        /* ignore */
      }
      connL.clear();
      leaveL.clear();
    },
  };
  return api;
}
