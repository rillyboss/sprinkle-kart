/**
 * In-process fake WebRTC for the WS4 networking tests (NETWORKING.md §15): a
 * `FakeRTCPeerConnection` + `FakeDataChannel` pair that behaves like the browser API closely
 * enough to run our WebRtcTransport, WorkerSignaling and even the real Trystero 0.25.4 code
 * (offer pool, password handshake, shared peers) in node, with no sockets and no timers of its
 * own (everything is delivered on microtasks, so `await settle()` flushes a whole exchange).
 *
 * What is modelled:
 * - SDP offer/answer with implicit `setLocalDescription()`, rollback, ICE restarts (new ufrag).
 * - Trickle ICE: `icecandidate` events for host / srflx / relay candidates chosen from the
 *   pc's `iceServers` and the network's conditions (UDP blocked, TURN reachable, relay policy).
 *   Candidates carry fake private/public IPs on purpose, so tests can prove nothing leaks.
 * - Connection when an answer is applied (both sides reference each other): connectionState
 *   'connecting' → 'connected', then channels open. Negotiated channels pair by id (both sides
 *   must create them, exactly like the real thing); in-band channels appear via `ondatachannel`.
 * - Channel options (ordered / maxRetransmits / negotiated / id), `binaryType`, `bufferedAmount`
 *   with a manual `hold` mode + `release()` that fires `bufferedamountlow` across the threshold,
 *   random or scripted drops on unreliable channels, `close()` on either side.
 * - `getStats()` with a selected candidate pair (type/protocol/RTT) — and raw IPs in it.
 */

let pcSeq = 0;

const PRIVATE_IP = '192.168.1.23';
const PUBLIC_IP = '203.0.113.7';
const RELAY_IP = '198.51.100.9';
const REMOTE_IP = '198.51.100.20';
export const FAKE_IPS = Object.freeze([PRIVATE_IP, PUBLIC_IP, RELAY_IP, REMOTE_IP]);

function fire(target, type, props = {}) {
  const ev = new Event(type);
  for (const [k, v] of Object.entries(props)) Object.defineProperty(ev, k, { value: v, enumerable: true });
  const handler = target['on' + type];
  if (typeof handler === 'function') handler.call(target, ev);
  target.dispatchEvent(ev);
  return ev;
}

function domError(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}

function copyPayload(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data.slice(0);
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  throw new TypeError('FakeDataChannel.send: unsupported payload');
}

function payloadSize(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data).length;
  return data.byteLength;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.udpBlocked]   no srflx; relay only over TURN/TLS 443
 * @param {boolean} [opts.turnWorks]    TURN servers answer (default true)
 * @param {boolean} [opts.lanOnly]      STUN unreachable (no srflx) but UDP allowed
 * @param {boolean} [opts.connectable]  false = ICE checks fail ('failed' instead of 'connected')
 * @param {number}  [opts.rttMs]        RTT reported by getStats (default 42)
 * @param {(ch: FakeDataChannel, data: any) => boolean} [opts.dropUnreliable] true = lose this message
 */
export function createFakeRtcNetwork(opts = {}) {
  const net = {
    udpBlocked: !!opts.udpBlocked,
    turnWorks: opts.turnWorks !== false,
    lanOnly: !!opts.lanOnly,
    connectable: opts.connectable !== false,
    rttMs: opts.rttMs ?? 42,
    dropUnreliable: opts.dropUnreliable ?? null,
    /** @type {Map<number, FakeRTCPeerConnection>} */
    pcs: new Map(),
    /** @type {FakeRTCPeerConnection[]} */
    created: [],
    log: [],
    deliver(fn) {
      queueMicrotask(fn);
    },
    /** Candidate list a pc with this configuration would gather on this network. */
    gather(pc) {
      const cfg = pc.config || {};
      const servers = (cfg.iceServers || []).flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).map((u) => ({ u: String(u), s })));
      const relayOnly = cfg.iceTransportPolicy === 'relay';
      const hasStun = servers.some(({ u }) => /^stun:/.test(u));
      const turns = servers.filter(({ u, s }) => /^turns?:/.test(u) && s.username && s.credential);
      const out = [];
      const port = 50000 + pc.id;
      if (!relayOnly) {
        out.push({ type: 'host', protocol: 'udp', line: `candidate:1 1 udp 2122260223 ${PRIVATE_IP} ${port} typ host generation 0` });
        if (hasStun && !net.udpBlocked && !net.lanOnly)
          out.push({
            type: 'srflx',
            protocol: 'udp',
            line: `candidate:2 1 udp 1686052607 ${PUBLIC_IP} ${port + 1000} typ srflx raddr ${PRIVATE_IP} rport ${port} generation 0`,
          });
      }
      if (net.turnWorks) {
        const usable = turns.filter(({ u }) => !net.udpBlocked || /^turns:|transport=tcp/.test(u));
        if (usable.length) {
          const tls = usable.some(({ u }) => /^turns:/.test(u));
          out.push({
            type: 'relay',
            protocol: 'udp',
            relayProtocol: net.udpBlocked ? (tls ? 'tls' : 'tcp') : 'udp',
            line: `candidate:3 1 udp 41885439 ${RELAY_IP} 3478 typ relay raddr ${PUBLIC_IP} rport ${port} generation 0`,
          });
        }
      }
      return out;
    },
    /** Selected pair type for a connected pc (best candidate both could use). */
    pairType(pc) {
      const types = net.gather(pc).map((c) => c.type);
      if (types.includes('relay') && (pc.config?.iceTransportPolicy === 'relay' || net.udpBlocked)) return 'relay';
      if (types.includes('srflx')) return 'srflx';
      if (types.includes('host') && !net.udpBlocked) return 'host';
      if (types.includes('relay')) return 'relay';
      return null;
    },
    connected() {
      return net.created.filter((p) => p.connectionState === 'connected');
    },
    /** Force ICE failure on a pc and its peer (simulates a NAT rebinding / expired relay). */
    fail(pc) {
      for (const p of [pc, pc._remote].filter(Boolean)) p._setConn('failed');
    },
  };

  class FakeDataChannel extends EventTarget {
    constructor(pc, label, init = {}) {
      super();
      this._pc = pc;
      this.label = label;
      this.negotiated = !!init.negotiated;
      this.ordered = init.ordered !== false;
      this.maxRetransmits = init.maxRetransmits ?? null;
      this.maxPacketLifeTime = init.maxPacketLifeTime ?? null;
      if (this.maxRetransmits !== null && this.maxPacketLifeTime !== null)
        throw domError('SyntaxError', 'maxRetransmits and maxPacketLifeTime are exclusive');
      this.protocol = init.protocol ?? '';
      this.id = init.id ?? null;
      this.readyState = 'connecting';
      this.binaryType = 'blob';
      this.bufferedAmount = 0;
      this.bufferedAmountLowThreshold = 0;
      this.onopen = this.onclose = this.onmessage = this.onerror = this.onbufferedamountlow = null;
      /** @type {FakeDataChannel|null} */
      this.peer = null;
      /** every payload passed to send() (after the open check) */
      this.sent = [];
      /** manual buffering: when true, sends pile up in `pending` until release() */
      this.hold = false;
      this.pending = [];
      this.dropped = 0;
    }
    get reliable() {
      return this.ordered && this.maxRetransmits === null && this.maxPacketLifeTime === null;
    }
    send(data) {
      if (this.readyState !== 'open') throw domError('InvalidStateError', `channel ${this.label} is ${this.readyState}`);
      const payload = copyPayload(data);
      this.sent.push(payload);
      if (this.hold || this.pending.length) {
        this.pending.push(payload);
        this.bufferedAmount += payloadSize(payload);
        return;
      }
      this._transmit(payload);
    }
    _transmit(payload) {
      if (!this.reliable && net.dropUnreliable && net.dropUnreliable(this, payload)) {
        this.dropped++;
        return;
      }
      const peer = this.peer;
      net.deliver(() => peer && peer._receive(payload));
    }
    /** Deliver up to `bytes` of held data (all by default), firing bufferedamountlow. */
    release(bytes = Infinity) {
      let budget = bytes;
      while (this.pending.length && budget > 0) {
        const p = this.pending.shift();
        const size = payloadSize(p);
        budget -= size;
        const before = this.bufferedAmount;
        this.bufferedAmount = Math.max(0, this.bufferedAmount - size);
        this._transmit(p);
        if (before > this.bufferedAmountLowThreshold && this.bufferedAmount <= this.bufferedAmountLowThreshold)
          fire(this, 'bufferedamountlow');
      }
    }
    /** Set bufferedAmount directly (fires bufferedamountlow when it drops across the threshold). */
    setBuffered(n) {
      const before = this.bufferedAmount;
      this.bufferedAmount = n;
      if (before > this.bufferedAmountLowThreshold && n <= this.bufferedAmountLowThreshold) fire(this, 'bufferedamountlow');
    }
    _receive(payload) {
      if (this.readyState !== 'open') return;
      let data = payload;
      if (typeof data !== 'string' && this.binaryType === 'blob') data = { blob: true, size: data.byteLength };
      fire(this, 'message', { data });
    }
    _open() {
      if (this.readyState !== 'connecting') return;
      this.readyState = 'open';
      fire(this, 'open');
    }
    close() {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed';
      fire(this, 'close');
      const peer = this.peer;
      this.peer = null;
      if (peer && peer.readyState !== 'closed') net.deliver(() => peer.close());
    }
  }

  class FakeRTCPeerConnection extends EventTarget {
    constructor(config = {}) {
      super();
      this.id = ++pcSeq;
      this.config = { ...config };
      this.signalingState = 'stable';
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      this.iceGatheringState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
      this.currentLocalDescription = null;
      this.currentRemoteDescription = null;
      this._prevLocal = null;
      this._ufrag = `u${this.id}r0`;
      this._gatheredFor = null;
      this.restarts = 0;
      this.restartIceCalls = 0;
      this.configHistory = [{ ...config }];
      /** @type {FakeDataChannel[]} */
      this.channels = [];
      this._autoId = 0;
      /** @type {FakeRTCPeerConnection|null} */
      this._remote = null;
      this.addedCandidates = [];
      this.onicecandidate = this.onconnectionstatechange = this.oniceconnectionstatechange = null;
      this.onicegatheringstatechange = this.ondatachannel = this.onnegotiationneeded = null;
      this.onsignalingstatechange = this.ontrack = null;
      net.pcs.set(this.id, this);
      net.created.push(this);
    }
    get closed() {
      return this.connectionState === 'closed';
    }
    getConfiguration() {
      return { ...this.config };
    }
    setConfiguration(cfg) {
      if (this.closed) throw domError('InvalidStateError', 'closed');
      this.config = { ...this.config, ...cfg };
      this.configHistory.push({ ...cfg });
    }
    createDataChannel(label, init = {}) {
      if (this.closed) throw domError('InvalidStateError', 'closed');
      const ch = new FakeDataChannel(this, label, init);
      if (!ch.negotiated) {
        while (this.channels.some((c) => c.id === this._autoId)) this._autoId++;
        ch.id = this._autoId++;
      }
      this.channels.push(ch);
      if (this.connectionState === 'connected') net.deliver(() => this._linkChannel(ch));
      return ch;
    }
    _sdp(type) {
      return [
        'v=0',
        `o=- ${this.id} 2 IN IP4 127.0.0.1`,
        's=-',
        `a=fake-pc:${this.id}`,
        `a=ice-ufrag:${this._ufrag}`,
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        `a=setup:${type === 'offer' ? 'actpass' : 'active'}`,
        '',
      ].join('\r\n');
    }
    async createOffer(o = {}) {
      await Promise.resolve();
      if (this.closed) throw domError('InvalidStateError', 'closed');
      if (o.iceRestart || this._restartPending) this._newUfrag();
      return { type: 'offer', sdp: this._sdp('offer') };
    }
    async createAnswer() {
      await Promise.resolve();
      if (this.closed) throw domError('InvalidStateError', 'closed');
      if (this.signalingState !== 'have-remote-offer') throw domError('InvalidStateError', 'no remote offer');
      return { type: 'answer', sdp: this._sdp('answer') };
    }
    _newUfrag() {
      this.restarts++;
      this._restartPending = false;
      this._ufrag = `u${this.id}r${this.restarts}`;
    }
    restartIce() {
      this.restartIceCalls++;
      this._restartPending = true;
    }
    async setLocalDescription(desc) {
      await Promise.resolve();
      if (this.closed) throw domError('InvalidStateError', 'closed');
      if (desc && desc.type === 'rollback') {
        this.localDescription = this._prevLocal;
        this._setSignaling('stable');
        return;
      }
      let type = desc?.type;
      if (!type) type = this.signalingState === 'have-remote-offer' ? 'answer' : 'offer';
      if (type === 'offer' && this._restartPending) this._newUfrag();
      const sdp = desc?.sdp || this._sdp(type);
      this._prevLocal = this.localDescription;
      this.localDescription = { type, sdp };
      this.currentLocalDescription = this.localDescription;
      this._setSignaling(type === 'offer' ? 'have-local-offer' : 'stable');
      this._gather();
      if (type === 'answer') this._maybeConnect();
    }
    async setRemoteDescription(desc) {
      await Promise.resolve();
      if (this.closed) throw domError('InvalidStateError', 'closed');
      if (!desc || !desc.sdp) throw new TypeError('bad description');
      const m = /a=fake-pc:(\d+)/.exec(desc.sdp);
      const remote = m ? net.pcs.get(Number(m[1])) : null;
      if (!remote) throw domError('OperationError', 'unknown remote description');
      if (desc.type === 'offer' && this.signalingState === 'have-local-offer') throw domError('InvalidStateError', 'glare');
      this._remote = remote;
      this.remoteDescription = { type: desc.type, sdp: desc.sdp };
      this.currentRemoteDescription = this.remoteDescription;
      this._setSignaling(desc.type === 'offer' ? 'have-remote-offer' : 'stable');
      if (desc.type === 'answer') this._maybeConnect();
    }
    async addIceCandidate(c) {
      await Promise.resolve();
      if (this.closed) throw domError('InvalidStateError', 'closed');
      if (c && c.candidate && !this.remoteDescription) throw domError('InvalidStateError', 'no remote description');
      this.addedCandidates.push(c ?? null);
    }
    _setSignaling(s) {
      if (this.signalingState === s) return;
      this.signalingState = s;
      fire(this, 'signalingstatechange');
    }
    _setConn(state) {
      if (this.connectionState === state || this.closed) return;
      this.connectionState = state;
      const ice = state === 'connected' ? 'connected' : state === 'connecting' ? 'checking' : state;
      this.iceConnectionState = ice;
      fire(this, 'iceconnectionstatechange');
      fire(this, 'connectionstatechange');
    }
    _gather() {
      if (this._gatheredFor === this._ufrag) return;
      this._gatheredFor = this._ufrag;
      const ufrag = this._ufrag;
      this.iceGatheringState = 'gathering';
      fire(this, 'icegatheringstatechange');
      const cands = net.gather(this);
      const lines = cands.map((c) => 'a=' + c.line);
      if (this.localDescription) this.localDescription = { ...this.localDescription, sdp: this.localDescription.sdp + lines.join('\r\n') + (lines.length ? '\r\n' : '') };
      net.deliver(() => {
        if (this.closed) return;
        for (const c of cands) {
          const candidate = {
            candidate: c.line,
            sdpMid: '0',
            sdpMLineIndex: 0,
            usernameFragment: ufrag,
            type: c.type,
            protocol: c.protocol,
            relayProtocol: c.relayProtocol,
            toJSON() {
              return { candidate: c.line, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: ufrag };
            },
          };
          fire(this, 'icecandidate', { candidate });
        }
        fire(this, 'icecandidate', { candidate: null });
        this.iceGatheringState = 'complete';
        fire(this, 'icegatheringstatechange');
      });
    }
    _maybeConnect() {
      const a = this;
      const b = this._remote;
      if (!b || b._remote !== a || b.closed) return;
      if (!a.localDescription || !a.remoteDescription || !b.localDescription || !b.remoteDescription) return;
      if (a.signalingState !== 'stable' || b.signalingState !== 'stable') return;
      net.deliver(() => {
        if (a.closed || b.closed) return;
        if (!net.connectable || !net.pairType(a) || !net.pairType(b)) {
          a._setConn('failed');
          b._setConn('failed');
          return;
        }
        const reconnect = a.connectionState === 'connected' && b.connectionState === 'connected';
        if (!reconnect) {
          for (const p of [a, b]) if (p.connectionState !== 'connected') p._setConn('connecting');
        }
        net.deliver(() => {
          if (a.closed || b.closed) return;
          a._setConn('connected');
          b._setConn('connected');
          a._selected = net.pairType(a);
          b._selected = net.pairType(b);
          for (const ch of [...a.channels]) a._linkChannel(ch);
          for (const ch of [...b.channels]) b._linkChannel(ch);
        });
      });
    }
    _linkChannel(ch) {
      const other = this._remote;
      if (!other || ch.peer || ch.readyState !== 'connecting' || this.connectionState !== 'connected') return;
      let twin;
      if (ch.negotiated) {
        twin = other.channels.find((c) => c.negotiated && c.id === ch.id && !c.peer && c.readyState === 'connecting');
        if (!twin) return; // stays 'connecting' until the other side creates the same id
      } else {
        twin = new FakeDataChannel(other, ch.label, {
          ordered: ch.ordered,
          maxRetransmits: ch.maxRetransmits ?? undefined,
          maxPacketLifeTime: ch.maxPacketLifeTime ?? undefined,
          protocol: ch.protocol,
          id: ch.id,
        });
        other.channels.push(twin);
      }
      ch.peer = twin;
      twin.peer = ch;
      if (!ch.negotiated) fire(other, 'datachannel', { channel: twin });
      ch._open();
      twin._open();
    }
    async getStats() {
      await Promise.resolve();
      const report = new Map();
      const type = this._selected ?? null;
      const relayProto = net.udpBlocked ? 'tls' : 'udp';
      report.set('T1', { id: 'T1', type: 'transport', selectedCandidatePairId: type ? 'CP1' : undefined });
      if (type) {
        const bytesSent = this.channels.reduce((n, c) => n + c.sent.reduce((m, p) => m + payloadSize(p), 0), 0);
        report.set('CP1', {
          id: 'CP1',
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          selected: true,
          localCandidateId: 'L1',
          remoteCandidateId: 'R1',
          currentRoundTripTime: net.rttMs / 1000,
          bytesSent,
        });
        report.set('L1', {
          id: 'L1',
          type: 'local-candidate',
          candidateType: type,
          address: type === 'relay' ? RELAY_IP : PUBLIC_IP,
          ip: type === 'relay' ? RELAY_IP : PUBLIC_IP,
          port: 50000 + this.id,
          protocol: 'udp',
          relayProtocol: type === 'relay' ? relayProto : undefined,
          url: type === 'relay' ? `turns:turn.example.test:443?transport=tcp` : undefined,
        });
        report.set('R1', { id: 'R1', type: 'remote-candidate', candidateType: 'srflx', address: REMOTE_IP, ip: REMOTE_IP, port: 61000 });
      }
      return report;
    }
    getSenders() {
      return [];
    }
    getReceivers() {
      return [];
    }
    addTrack() {
      throw domError('NotSupportedError', 'no media in fake pc');
    }
    close() {
      if (this.closed) return;
      this.signalingState = 'closed';
      this.connectionState = 'closed';
      this.iceConnectionState = 'closed';
      for (const ch of [...this.channels]) if (ch.readyState !== 'closed') {
        ch.readyState = 'closed';
        const peer = ch.peer;
        ch.peer = null;
        if (peer) net.deliver(() => peer.close());
      }
      const remote = this._remote;
      if (remote && !remote.closed && remote._remote === this) net.deliver(() => remote._setConn('disconnected'));
    }
  }

  net.RTCPeerConnection = FakeRTCPeerConnection;
  net.FakeDataChannel = FakeDataChannel;
  return net;
}

/** Let every queued microtask chain run (fake RTC, fake sockets and async signaling). */
export async function settle(rounds = 60) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** Connect two fake pcs directly (offer from a, answer from b) — for transport-only tests. */
export async function connectPair(a, b) {
  const offer = await a.createOffer();
  await a.setLocalDescription(offer);
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);
  await settle();
}

/** Stand-in for WS2's deriveRoomIds (same shape, NOT the real KDF). */
export function fakeRoomIds(tag = 'test') {
  const hex = (n) => [...Array(n)].map((_, i) => ((tag.charCodeAt(i % tag.length) + i * 7) % 16).toString(16)).join('');
  return { topic: 'sk-' + hex(20), password: 'pw_' + tag + '_' + hex(12), workerRoom: 'r' + hex(24) };
}
