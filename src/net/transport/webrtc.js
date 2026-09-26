/**
 * WebRtcTransport (NETWORKING.md §4.1): the browser implementation of NetTransport.
 *
 * For every RTCPeerConnection a SignalingTransport yields, it creates two NEGOTIATED data
 * channels on both sides (no renegotiation, so it also works on Trystero's own connection):
 *
 *   sk-state  { negotiated: true, id: 8, ordered: false, maxRetransmits: 0 }  INPUT/SNAPSHOT/PING/PONG
 *   sk-ctrl   { negotiated: true, id: 9, ordered: true }                       everything else
 *
 * A peer is joined when BOTH are open. Latency-first backpressure on `state`: a send is
 * skipped (false, counted in `stateSkips`) when `bufferedAmount > max(1024, 4 × the big state
 * message)`, where "big" is a slowly decaying max of recent sizes (a snapshot), so a 27-byte PONG
 * in between never shrinks the room to ~2 snapshots (net review #11). `ctrl` queues above 64 KiB and drains on `bufferedamountlow` (threshold 16 KiB).
 * `stats()` polls getStats every 5 s and keeps only the selected pair's candidate TYPE, whether
 * it is relayed, and the RTT: never an address or port (screens get shared).
 *
 * Dual matchmaker rule (§4.2): several connections for the same remote selfId may be pending
 * (a guest tries the Worker and public signaling); the first whose two channels open wins, the
 * others are closed, and any later duplicate is closed at once. The winner is reported to the
 * signaling (`settle`) so a guest can leave the other matchmaker.
 */
import { createListeners } from '../signaling/types.js';

// §19 constants. WS2's src/net/constants.js is the eventual home; these are local copies
// (tests/net.webrtc.test.js asserts they match once that file exists).
export const MAX_STATE_BYTES = 1150;
export const MAX_CTRL_BYTES = 16384;
export const WIRE_OVERHEAD_BYTES = 93;
export const WIRE_OVERHEAD_TURN_BYTES = 97;
export const STATE_CHANNEL = Object.freeze({ label: 'sk-state', init: Object.freeze({ negotiated: true, id: 8, ordered: false, maxRetransmits: 0 }) });
export const CTRL_CHANNEL = Object.freeze({ label: 'sk-ctrl', init: Object.freeze({ negotiated: true, id: 9, ordered: true }) });
export const STATE_BUFFER_MIN = 1024;
/** Room on the state channel, in "big" state messages (snapshots), before a send is skipped. */
export const STATE_BUFFER_MESSAGES = 4;
/** Per state send, the remembered big message size decays by this factor (it follows a smaller snapshot). */
export const STATE_BIG_DECAY = 0.995;
export const CTRL_QUEUE_HIGH = 64 * 1024;
export const CTRL_LOW_THRESHOLD = 16 * 1024;
export const CTRL_QUEUE_MAX_BYTES = 1024 * 1024;
export const STATS_INTERVAL_MS = 5000;
export const ICE_CONNECT_TIMEOUT_MS = 15000;
export const FAILED_GRACE_MS = 10000;
export const TURN_RENEW_AFTER_MS = 20 * 60 * 1000;

/**
 * NetTransport — local copy of WS2's JSDoc (src/net/transport/types.js) until it merges.
 * @typedef {'state'|'ctrl'} Channel
 * @typedef {object} PeerStats
 * @property {number|null} rttMs
 * @property {number} bufferedCtrl
 * @property {number} bufferedState
 * @property {boolean|null} relayed
 * @property {number} bytesIn
 * @property {number} bytesOut
 * @property {number} wireBytesIn
 * @property {number} wireBytesOut
 * @property {number} packetsIn
 * @property {number} packetsOut
 * @property {number} stateSkips
 * @property {string|null} candidateType   'host' | 'srflx' | 'prflx' | 'relay' (never an address)
 * @typedef {object} NetTransport
 * @property {string} selfId
 * @property {'host'|'guest'} role
 * @property {() => string[]} peers
 * @property {(peerId: string, ch: Channel, bytes: Uint8Array) => boolean} send
 * @property {(ch: Channel, bytes: Uint8Array, except?: string) => void} broadcast
 * @property {(fn: (peerId: string, ch: Channel, bytes: Uint8Array) => void) => () => void} onMessage
 * @property {(fn: (ev: { type: 'join'|'leave', peerId: string, reason?: string }) => void) => () => void} onPeer
 * @property {(peerId: string) => PeerStats} stats
 * @property {(peerId: string, reason?: string) => void} disconnect
 * @property {() => void} close
 */

const CANDIDATE_TYPES = new Set(['host', 'srflx', 'prflx', 'relay']);

/**
 * Reduce a getStats() report to what we are allowed to show: the selected pair's local
 * candidate type, whether it is relayed, and the RTT. Addresses, ports and URLs are dropped.
 * @param {Map<string, any>|Iterable<[string, any]>|Record<string, any>|null|undefined} report
 * @returns {{ candidateType: string|null, relayed: boolean|null, rttMs: number|null }}
 */
export function summarizeStats(report) {
  const out = { candidateType: null, relayed: null, rttMs: null };
  if (!report) return out;
  /** @type {Map<string, any>} */
  const byId = new Map();
  /** @type {[string, any][]} */
  let entries = [];
  if (Array.isArray(report)) entries = report.map((v, i) => [String(i), v]);
  else if (typeof report.forEach === 'function') report.forEach((v, k) => entries.push([k, v]));
  else entries = Object.entries(report);
  for (const [k, v] of entries) if (v && typeof v === 'object') byId.set(v.id ?? k, v);
  let pair = null;
  for (const s of byId.values()) {
    if (s.type === 'transport' && s.selectedCandidatePairId && byId.get(s.selectedCandidatePairId)) {
      pair = byId.get(s.selectedCandidatePairId);
      break;
    }
  }
  if (!pair) {
    for (const s of byId.values()) {
      if (s.type === 'candidate-pair' && (s.selected || (s.nominated && s.state === 'succeeded'))) {
        pair = s;
        break;
      }
    }
  }
  if (!pair) return out;
  const local = byId.get(pair.localCandidateId);
  const t = local && typeof local.candidateType === 'string' && CANDIDATE_TYPES.has(local.candidateType) ? local.candidateType : null;
  const remote = byId.get(pair.remoteCandidateId);
  const rt = remote && remote.candidateType === 'relay';
  out.candidateType = t;
  out.relayed = t ? t === 'relay' || !!rt : null;
  if (typeof pair.currentRoundTripTime === 'number' && Number.isFinite(pair.currentRoundTripTime))
    out.rttMs = Math.round(pair.currentRoundTripTime * 1000);
  return out;
}

/**
 * @param {object} o
 * @param {import('../signaling/types.js').SignalingTransport & { settle?: Function }} o.signaling
 * @param {'host'|'guest'} o.role
 * @param {string} o.selfId
 * @param {RTCIceServer[]} [o.iceServers]  the servers the pcs were built with (for TURN renewal)
 * @param {typeof RTCPeerConnection} [o.RTCPeerConnectionImpl]  unused directly (signaling builds pcs); kept for symmetry/tests
 * @param {() => number} [o.now]
 * @param {{ setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function }} [o.timers]
 * @param {number} [o.statsIntervalMs]
 * @param {number} [o.iceTimeoutMs]
 * @returns {NetTransport & { onFailure: Function, renewIceIfRelayed: Function, pollStats: Function, debug: Function }}
 */
export function createWebRtcTransport({
  signaling,
  role,
  selfId,
  iceServers = [],
  now = () => Date.now(),
  timers = globalThis,
  statsIntervalMs = STATS_INTERVAL_MS,
  iceTimeoutMs = ICE_CONNECT_TIMEOUT_MS,
} = /** @type {any} */ ({})) {
  if (role !== 'host' && role !== 'guest') throw new TypeError('createWebRtcTransport: role must be host or guest');
  if (!signaling || typeof signaling.onPeerConnection !== 'function') throw new TypeError('createWebRtcTransport: signaling required');

  const msgListeners = createListeners();
  const peerListeners = createListeners();
  const failListeners = createListeners();

  /** @type {Map<string, Conn>} joined connection per remote selfId */
  const joined = new Map();
  /** @type {Set<Conn>} every live connection (pending + joined) */
  const conns = new Set();
  /** @type {Map<string, Conn>} guest: the connection the channels were created on */
  const committed = new Map();
  let closed = false;
  let lastMintAt = now();
  let currentIce = iceServers;
  const unsubs = [];

  /**
   * @typedef {object} Conn
   * @property {string} peerId
   * @property {RTCPeerConnection} pc
   * @property {string|undefined} kind
   * @property {RTCDataChannel|null} state   null until channels are attached
   * @property {RTCDataChannel|null} ctrl
   * @property {boolean} isJoined
   * @property {boolean} dead
   * @property {Uint8Array[]} ctrlQueue
   * @property {number} ctrlQueueBytes
   * @property {number} lastStateBytes
   * @property {any} iceTimer
   * @property {any} failTimer
   * @property {any} statsTimer
   * @property {PeerStats} s
   */

  const emptyStats = () => ({
    rttMs: null,
    bufferedCtrl: 0,
    bufferedState: 0,
    relayed: null,
    bytesIn: 0,
    bytesOut: 0,
    wireBytesIn: 0,
    wireBytesOut: 0,
    packetsIn: 0,
    packetsOut: 0,
    stateSkips: 0,
    candidateType: null,
    // extra counters (debug overlay)
    stateOversize: 0,
    ctrlOversize: 0,
    ctrlQueued: 0,
    dropsIn: 0,
  });

  const overhead = (c) => (c.s.relayed ? WIRE_OVERHEAD_TURN_BYTES : WIRE_OVERHEAD_BYTES);

  function countOut(c, n) {
    c.s.bytesOut += n;
    c.s.wireBytesOut += n + overhead(c);
    c.s.packetsOut++;
  }

  function onIncoming(c, chName, ev) {
    if (closed || c.dead || !c.isJoined) return;
    const data = ev.data;
    let bytes;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else {
      c.s.dropsIn++;
      return;
    }
    const cap = chName === 'state' ? MAX_STATE_BYTES : MAX_CTRL_BYTES;
    if (bytes.length === 0 || bytes.length > cap) {
      c.s.dropsIn++;
      return;
    }
    c.s.bytesIn += bytes.length;
    c.s.wireBytesIn += bytes.length + overhead(c);
    c.s.packetsIn++;
    msgListeners.emit(c.peerId, chName, bytes);
  }

  function flushCtrl(c) {
    while (c.ctrl && c.ctrlQueue.length && !c.dead && c.ctrl.readyState === 'open' && c.ctrl.bufferedAmount <= CTRL_QUEUE_HIGH) {
      const bytes = c.ctrlQueue.shift();
      c.ctrlQueueBytes -= bytes.length;
      try {
        c.ctrl.send(bytes);
        countOut(c, bytes.length);
      } catch {
        c.ctrlQueue.length = 0;
        c.ctrlQueueBytes = 0;
        return;
      }
    }
  }

  function tryJoin(c) {
    if (c.dead || c.isJoined || closed || !c.state || !c.ctrl) return;
    if (c.state.readyState !== 'open' || c.ctrl.readyState !== 'open') return;
    const existing = joined.get(c.peerId);
    if (existing && existing !== c) {
      // A duplicate for an already-joined peer: keep the first, close this one.
      destroy(c, 'duplicate', false);
      return;
    }
    c.isJoined = true;
    timers.clearTimeout(c.iceTimer);
    c.iceTimer = null;
    joined.set(c.peerId, c);
    // First to open wins: close every other pending connection to the same peer.
    for (const other of [...conns]) if (other !== c && other.peerId === c.peerId) destroy(other, 'duplicate', false);
    try {
      signaling.settle?.(c.peerId, c.pc, c.kind);
    } catch {
      /* settle is best effort */
    }
    c.statsTimer = timers.setInterval(() => pollOne(c), statsIntervalMs);
    pollOne(c);
    peerListeners.emit({ type: 'join', peerId: c.peerId });
  }

  function destroy(c, reason, emit = true) {
    if (c.dead) return;
    c.dead = true;
    conns.delete(c);
    timers.clearTimeout(c.iceTimer);
    timers.clearTimeout(c.failTimer);
    if (c.statsTimer) timers.clearInterval(c.statsTimer);
    c.ctrlQueue.length = 0;
    for (const ch of [c.state, c.ctrl]) {
      try {
        ch?.close();
      } catch {
        /* already closed */
      }
    }
    try {
      c.pc.close();
    } catch {
      /* already closed */
    }
    const wasJoined = c.isJoined;
    if (joined.get(c.peerId) === c) joined.delete(c.peerId);
    if (committed.get(c.peerId) === c) committed.delete(c.peerId);
    if (wasJoined && emit) peerListeners.emit({ type: 'leave', peerId: c.peerId, reason });
    else if (!wasJoined && emit && reason !== 'duplicate' && reason !== 'closed') {
      // Never joined: tell the session why (ICE timeout / failed), unless another pending
      // connection to the same peer is still trying.
      const stillTrying = [...conns].some((o) => o.peerId === c.peerId);
      if (!stillTrying && !joined.has(c.peerId)) failListeners.emit({ peerId: c.peerId, reason });
    }
    if (!wasJoined && !closed) maybeCommit(c.peerId);
  }

  const isConnected = (pc) => pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed';

  function onConnState(c) {
    if (c.dead) return;
    const st = c.pc.connectionState;
    const ice = c.pc.iceConnectionState;
    if (st === 'closed' || ice === 'closed') {
      destroy(c, c.isJoined ? 'closed-remote' : 'failed');
      return;
    }
    if (st === 'failed' || ice === 'failed' || st === 'disconnected' || ice === 'disconnected') {
      // WorkerSignaling restarts ICE on 'failed' (guest side); give it time before giving up.
      if (!c.failTimer) c.failTimer = timers.setTimeout(() => destroy(c, 'failed'), FAILED_GRACE_MS);
      return;
    }
    if (isConnected(c.pc)) {
      timers.clearTimeout(c.failTimer);
      c.failTimer = null;
      if (!c.state) maybeCommit(c.peerId);
    }
  }

  /** Create the two negotiated channels on this connection and wire them up. */
  function attachChannels(c) {
    if (c.state || c.dead) return true;
    let state;
    let ctrl;
    try {
      state = c.pc.createDataChannel(STATE_CHANNEL.label, { ...STATE_CHANNEL.init });
      ctrl = c.pc.createDataChannel(CTRL_CHANNEL.label, { ...CTRL_CHANNEL.init });
    } catch {
      destroy(c, 'channel-error', false);
      failListeners.emit({ peerId: c.peerId, reason: 'channel-error' });
      return false;
    }
    state.binaryType = 'arraybuffer';
    ctrl.binaryType = 'arraybuffer';
    ctrl.bufferedAmountLowThreshold = CTRL_LOW_THRESHOLD;
    c.state = state;
    c.ctrl = ctrl;
    const join = () => tryJoin(c);
    state.addEventListener('open', join);
    ctrl.addEventListener('open', join);
    const lost = () => {
      if (!c.dead) destroy(c, c.isJoined ? 'channel-closed' : 'failed');
    };
    state.addEventListener('close', lost);
    ctrl.addEventListener('close', lost);
    state.addEventListener('message', (ev) => onIncoming(c, 'state', ev));
    ctrl.addEventListener('message', (ev) => onIncoming(c, 'ctrl', ev));
    ctrl.addEventListener('bufferedamountlow', () => flushCtrl(c));
    tryJoin(c); // channels may already be open (connection surfaced late)
    return true;
  }

  /**
   * Guest only: the GUEST decides which connection to the host is used, by creating the
   * negotiated channels on exactly one of them (negotiated channels open only when both sides
   * create the same id). The first pc whose ICE/DTLS connects is committed; if it dies before
   * joining, the next connected one is. So the host can never pick a different winner.
   */
  function maybeCommit(peerId) {
    if (role !== 'guest' || closed || joined.has(peerId)) return;
    const cur = committed.get(peerId);
    if (cur && !cur.dead) return;
    const next = [...conns].find((o) => o.peerId === peerId && !o.dead && isConnected(o.pc));
    if (!next) return;
    committed.set(peerId, next);
    attachChannels(next);
  }

  function addConnection({ peerId, pc, kind }) {
    if (closed) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      return;
    }
    if (typeof peerId !== 'string' || !peerId || peerId === selfId || !pc) return;
    if (joined.has(peerId)) {
      // Late duplicate (e.g. the other matchmaker found the same machine again): close it.
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      return;
    }
    for (const other of conns) if (other.pc === pc) return; // same pc surfaced twice
    /** @type {Conn} */
    const c = {
      peerId,
      pc,
      kind,
      state: null,
      ctrl: null,
      isJoined: false,
      dead: false,
      ctrlQueue: [],
      ctrlQueueBytes: 0,
      lastStateBytes: 0,
      iceTimer: null,
      failTimer: null,
      statsTimer: null,
      s: emptyStats(),
    };
    conns.add(c);
    const cs = () => onConnState(c);
    pc.addEventListener?.('connectionstatechange', cs);
    pc.addEventListener?.('iceconnectionstatechange', cs);
    c.iceTimer = timers.setTimeout(() => {
      if (!c.isJoined) destroy(c, 'ice-timeout');
    }, iceTimeoutMs);
    // Host: channels at once on every pc (ready for whichever one the guest commits to).
    if (role === 'host') attachChannels(c);
    else maybeCommit(peerId);
  }

  function onSignalLeave(peerId, info) {
    const c = joined.get(peerId);
    // Only the matchmaker that owns the live connection may end it.
    if (c && info && info.kind && c.kind && info.kind !== c.kind) return;
    if (c) destroy(c, 'left');
    for (const p of [...conns]) if (p.peerId === peerId && (!info?.kind || !p.kind || p.kind === info.kind)) destroy(p, 'left', false);
  }

  unsubs.push(signaling.onPeerConnection(addConnection));
  if (typeof signaling.onPeerLeave === 'function') unsubs.push(signaling.onPeerLeave(onSignalLeave));

  async function pollOne(c) {
    if (c.dead || typeof c.pc.getStats !== 'function') return;
    try {
      const sum = summarizeStats(await c.pc.getStats());
      if (c.dead) return;
      c.s.candidateType = sum.candidateType;
      c.s.relayed = sum.relayed;
      if (sum.rttMs !== null) c.s.rttMs = sum.rttMs;
    } catch {
      /* stats are best effort */
    }
  }

  /** @type {NetTransport & Record<string, any>} */
  const transport = {
    selfId,
    role,
    peers: () => [...joined.keys()],
    send(peerId, ch, bytes) {
      try {
        if (closed) return false;
        const c = joined.get(peerId);
        if (!c || c.dead || !(bytes instanceof Uint8Array)) return false;
        if (ch === 'state') {
          if (bytes.length > MAX_STATE_BYTES || bytes.length === 0) {
            c.s.stateOversize++;
            return false;
          }
          if (c.state.readyState !== 'open') return false;
          c.bigStateBytes = Math.max(bytes.length, (c.bigStateBytes || 0) * STATE_BIG_DECAY);
          const limit = Math.max(STATE_BUFFER_MIN, STATE_BUFFER_MESSAGES * c.bigStateBytes);
          if (c.state.bufferedAmount > limit) {
            c.s.stateSkips++;
            return false;
          }
          c.state.send(bytes);
          c.lastStateBytes = bytes.length;
          countOut(c, bytes.length);
          return true;
        }
        if (ch === 'ctrl') {
          if (bytes.length > MAX_CTRL_BYTES || bytes.length === 0) {
            c.s.ctrlOversize++;
            return false;
          }
          if (c.ctrl.readyState !== 'open') return false;
          if (c.ctrlQueue.length || c.ctrl.bufferedAmount > CTRL_QUEUE_HIGH) {
            if (c.ctrlQueueBytes + bytes.length > CTRL_QUEUE_MAX_BYTES) return false;
            c.ctrlQueue.push(bytes.slice());
            c.ctrlQueueBytes += bytes.length;
            c.s.ctrlQueued++;
            return true;
          }
          c.ctrl.send(bytes);
          countOut(c, bytes.length);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    broadcast(ch, bytes, except) {
      for (const id of [...joined.keys()]) if (id !== except) transport.send(id, ch, bytes);
    },
    onMessage: (fn) => msgListeners.add(fn),
    onPeer: (fn) => peerListeners.add(fn),
    /** Extra (not in NetTransport): connection attempts that never joined. */
    onFailure: (fn) => failListeners.add(fn),
    stats(peerId) {
      const c = joined.get(peerId) ?? [...conns].find((x) => x.peerId === peerId);
      if (!c) return emptyStats();
      c.s.bufferedCtrl = (c.ctrl?.bufferedAmount || 0) + c.ctrlQueueBytes;
      c.s.bufferedState = c.state?.bufferedAmount || 0;
      return { ...c.s };
    },
    /** Poll getStats now for every joined peer (tests / Check connection). */
    async pollStats() {
      await Promise.all([...joined.values()].map(pollOne));
    },
    /** Which matchmaker carried each joined peer (debug overlay). */
    debug() {
      return [...joined.values()].map((c) => ({ peerId: c.peerId, kind: c.kind ?? null, candidateType: c.s.candidateType, relayed: c.s.relayed }));
    },
    disconnect(peerId, reason = 'removed') {
      for (const c of [...conns]) if (c.peerId === peerId) destroy(c, reason, c.isJoined);
    },
    /**
     * TURN renewal (§4.2): when a joined peer's selected pair is `relay` and the last mint is
     * ≥ 20 min old, fetch fresh creds (`signaling.refreshIce()`), apply them with
     * `pc.setConfiguration` and ICE-restart that pc. Call ONLY between races (the session
     * knows when; a race is < 10 min, so this never has to happen mid-race).
     * @param {{ force?: boolean }} [o]
     * @returns {Promise<number>} how many connections were renewed
     */
    async renewIceIfRelayed({ force = false } = {}) {
      if (closed) return 0;
      await transport.pollStats();
      const relayed = [...joined.values()].filter((c) => c.s.relayed === true && !c.dead);
      if (!relayed.length) return 0;
      if (!force && now() - lastMintAt < TURN_RENEW_AFTER_MS) return 0;
      let fresh;
      try {
        fresh = await signaling.refreshIce();
      } catch {
        return 0;
      }
      if (!Array.isArray(fresh) || !fresh.length) return 0;
      lastMintAt = now();
      currentIce = fresh;
      let n = 0;
      for (const c of relayed) {
        if (c.dead) continue;
        try {
          const cfg = typeof c.pc.getConfiguration === 'function' ? c.pc.getConfiguration() : {};
          c.pc.setConfiguration({ ...cfg, iceServers: fresh });
          if (typeof signaling.restartIce === 'function') await signaling.restartIce(c.peerId);
          else c.pc.restartIce?.();
          n++;
        } catch {
          /* keep the old allocation; the next call retries */
        }
      }
      return n;
    },
    /** When the current ICE servers were minted (ms, `now()` clock). */
    get lastIceMintAt() {
      return lastMintAt;
    },
    get iceServers() {
      return currentIce;
    },
    close() {
      if (closed) return;
      for (const c of [...conns]) destroy(c, 'closed', c.isJoined);
      closed = true;
      for (const u of unsubs) u();
      msgListeners.clear();
      Promise.resolve()
        .then(() => signaling.leave?.())
        .catch(() => {});
    },
  };
  return transport;
}
