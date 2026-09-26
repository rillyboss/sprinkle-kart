/**
 * TEMPORARY in-memory NetTransport hub for the WS5 netcode tests, standing in for WS2's
 * src/net/transport/memory.js until it lands (NETWORKING.md §4.1). Deterministic (seeded mulberry32) and
 * driven by a manual clock: `hub.advance(toMs)` delivers everything due by then.
 *
 *   const hub = createMemoryHub({ seed: 1 });
 *   const host = hub.endpoint('host', 'host'); const g = hub.endpoint('g1', 'guest'); hub.link('host', 'g1');
 *   hub.setConditions('g1', 'host', { latencyMs: 25, jitterMs: 5, loss: 0.05, burstLen: 3, reorder: 0.1, duplicate: 0.01 });
 *
 * Per directed link: latency + uniform [0, jitter] delay; loss is random (`burstLen` <= 1) or bursty: a
 * two-state Gilbert–Elliott chain whose mean burst is `burstLen` packets and whose long-run loss is `loss`
 * (`burstExact: true` gives bursts of exactly `burstLen` packets instead). `state` messages may be lost,
 * reordered (+5..40 ms) and duplicated. `ctrl` is reliable and ordered with the realistic retransmit model:
 * a lost packet is re-sent after max(RTT + 3 × 33 ms, 300 ms), doubling per repeat (cap 3 s), and everything
 * behind it waits (head-of-line). Wire bytes = payload + 93 B per packet (`overhead`) plus SACKs: one per 2
 * received DATA packets, bundled (16 B) when the receiver sent on that link within 200 ms, else 93 B alone.
 */
export const WIRE_OVERHEAD_BYTES = 93;
export const SACK_BYTES = 93;
export const SACK_BUNDLED_BYTES = 16;
export const MAX_STATE_BYTES = 1150;
export const RTO_MIN_MS = 300;
const PACKET_PAYLOAD = 1150;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_COND = Object.freeze({
  latencyMs: 0, jitterMs: 0, loss: 0, burstLen: 1, burstExact: false, duplicate: 0, reorder: 0, overhead: WIRE_OVERHEAD_BYTES,
});

export function createMemoryHub({ seed = 1, start = 0 } = {}) {
  const rnd = mulberry(seed);
  let now = start;
  const endpoints = new Map();
  const links = new Map(); // `${from}>${to}` → link state
  const queue = []; // { at, seq, fn }
  let qseq = 0;

  const schedule = (at, fn) => {
    // sorted by (at, seq): binary search for the insertion point
    const e = { at, seq: qseq++, fn };
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (queue[mid].at <= at) lo = mid + 1; else hi = mid; }
    queue.splice(lo, 0, e);
  };

  function linkState(from, to) {
    const key = `${from}>${to}`;
    let l = links.get(key);
    if (!l) {
      l = {
        from, to, cond: { ...DEFAULT_COND }, bad: false, burstLeft: 0, cool: false,
        ctrlSeq: 0, ctrlNext: 0, ctrlReady: new Map(), lastSentAt: -Infinity, rxPackets: 0, lastDeliverAt: -Infinity,
        stats: { bytesOut: 0, wireBytesOut: 0, packetsOut: 0, sackBytesOut: 0, lost: 0, dup: 0, reordered: 0, retransmits: 0, stateSkips: 0, oversize: 0, ctrlMessages: 0, ctrlWireBytes: 0, ctrlBytes: 0 },
        buffered: 0,
      };
      links.set(key, l);
    }
    return l;
  }

  function lost(l) {
    const c = l.cond;
    if (!(c.loss > 0)) return false;
    if (c.burstExact && c.burstLen > 1) {
      if (l.burstLeft > 0) { l.burstLeft--; if (!l.burstLeft) l.cool = true; return true; }
      if (l.cool) { l.cool = false; return false; }
      const startP = c.loss / c.burstLen / Math.max(1e-9, 1 - c.loss - c.loss / c.burstLen);
      if (rnd() < startP) { l.burstLeft = c.burstLen - 1; return true; }
      return false;
    }
    if (c.burstLen > 1) {
      const pBG = 1 / c.burstLen;
      const pGB = (c.loss * pBG) / (1 - c.loss);
      l.bad = l.bad ? rnd() >= pBG : rnd() < pGB;
      return l.bad;
    }
    return rnd() < c.loss;
  }

  const delay = (l) => l.cond.latencyMs + (l.cond.jitterMs > 0 ? rnd() * l.cond.jitterMs : 0);

  /** Count one outgoing DATA packet (wire bytes) and let the receiver SACK it. */
  function countPacket(l, payload) {
    l.stats.packetsOut++;
    l.stats.bytesOut += payload;
    l.stats.wireBytesOut += payload + l.cond.overhead;
    l.lastSentAt = now;
  }
  function sackFor(l) {
    // the receiver acknowledges every 2nd DATA packet on the reverse link
    l.rxPackets++;
    if (l.rxPackets % 2) return;
    const back = linkState(l.to, l.from);
    const bundled = now - back.lastSentAt <= 200;
    const bytes = bundled ? SACK_BUNDLED_BYTES : SACK_BYTES;
    back.stats.sackBytesOut += bytes;
    back.stats.wireBytesOut += bytes;
    if (!bundled) back.stats.packetsOut++;
  }

  function deliver(to, from, ch, bytes) {
    const ep = endpoints.get(to);
    if (!ep || ep.closed || !ep.links.has(from)) return;
    ep.stats(from); // ensure stats object
    ep._in(from, ch, bytes);
  }

  function sendState(l, bytes) {
    countPacket(l, bytes.length);
    if (lost(l)) { l.stats.lost++; return; }
    let at = now + delay(l);
    if (l.cond.reorder > 0 && rnd() < l.cond.reorder) { at += 5 + rnd() * 35; l.stats.reordered++; }
    const copy = bytes.slice();
    schedule(at, () => { sackFor(l); deliver(l.to, l.from, 'state', copy); });
    if (l.cond.duplicate > 0 && rnd() < l.cond.duplicate) {
      l.stats.dup++;
      schedule(at + 1 + rnd() * 10, () => deliver(l.to, l.from, 'state', copy));
    }
  }

  function sendCtrl(l, bytes) {
    const seq = l.ctrlSeq++;
    const nPackets = Math.max(1, Math.ceil(bytes.length / PACKET_PAYLOAD));
    l.stats.ctrlMessages++;
    l.stats.ctrlBytes += bytes.length;
    l.stats.ctrlWireBytes += bytes.length + nPackets * l.cond.overhead;
    const copy = bytes.slice();
    const msg = { seq, bytes: copy, left: nPackets, arrivedAt: 0 };
    const rtt = 2 * l.cond.latencyMs + l.cond.jitterMs;
    for (let i = 0; i < nPackets; i++) {
      const size = i < nPackets - 1 ? PACKET_PAYLOAD : bytes.length - PACKET_PAYLOAD * (nPackets - 1);
      const attempt = (k, sendAt) => {
        const doSend = () => {
          countPacket(l, size);
          if (k > 0) l.stats.retransmits++;
          if (lost(l)) {
            l.stats.lost++;
            const rto = Math.min(3000, Math.max(rtt + 3 * 33, RTO_MIN_MS) * 2 ** k);
            attempt(k + 1, now + rto);
            return;
          }
          const at = now + delay(l);
          schedule(at, () => {
            sackFor(l);
            msg.left--;
            if (msg.left === 0) { l.ctrlReady.set(seq, msg); flushCtrl(l); }
          });
        };
        if (sendAt <= now) doSend(); else schedule(sendAt, doSend);
      };
      attempt(0, now);
    }
  }

  function flushCtrl(l) {
    while (l.ctrlReady.has(l.ctrlNext)) {
      const m = l.ctrlReady.get(l.ctrlNext);
      l.ctrlReady.delete(l.ctrlNext);
      l.ctrlNext++;
      deliver(l.to, l.from, 'ctrl', m.bytes);
    }
  }

  function endpoint(selfId, role = 'guest') {
    const msgFns = new Set();
    const peerFns = new Set();
    const ep = {
      selfId, role, closed: false, links: new Set(), _stats: new Map(),
      peers: () => [...ep.links],
      send(peerId, ch, bytes) {
        if (ep.closed || !ep.links.has(peerId) || !(bytes instanceof Uint8Array)) return false;
        const l = linkState(selfId, peerId);
        if (ch === 'state') {
          if (bytes.length > MAX_STATE_BYTES) { l.stats.oversize++; return false; }
          if (l.buffered > 0) { l.stats.stateSkips++; return false; }
          sendState(l, bytes);
        } else sendCtrl(l, bytes);
        return true;
      },
      broadcast(ch, bytes, except) { for (const p of ep.links) if (p !== except) ep.send(p, ch, bytes); },
      onMessage(fn) { msgFns.add(fn); return () => msgFns.delete(fn); },
      onPeer(fn) { peerFns.add(fn); return () => peerFns.delete(fn); },
      stats(peerId) {
        const out = linkState(selfId, peerId);
        const inn = linkState(peerId, selfId);
        return {
          rttMs: 2 * (out.cond.latencyMs + inn.cond.latencyMs) / 2,
          bufferedCtrl: 0, bufferedState: out.buffered, relayed: false,
          bytesIn: inn.stats.bytesOut, bytesOut: out.stats.bytesOut,
          wireBytesIn: inn.stats.wireBytesOut, wireBytesOut: out.stats.wireBytesOut,
          packetsIn: inn.stats.packetsOut, packetsOut: out.stats.packetsOut, stateSkips: out.stats.stateSkips,
          candidateType: 'host',
        };
      },
      disconnect(peerId, reason = 'kick') {
        if (!ep.links.delete(peerId)) return;
        const other = endpoints.get(peerId);
        other?.links.delete(selfId);
        for (const fn of peerFns) fn({ type: 'leave', peerId, reason });
        other?._peer({ type: 'leave', peerId: selfId, reason });
      },
      close() { for (const p of [...ep.links]) ep.disconnect(p, 'closed'); ep.closed = true; },
      _in(from, ch, bytes) { for (const fn of msgFns) fn(from, ch, bytes); },
      _peer(ev) { for (const fn of peerFns) fn(ev); },
    };
    endpoints.set(selfId, ep);
    return ep;
  }

  return {
    endpoint,
    link(a, b) {
      const A = endpoints.get(a); const B = endpoints.get(b);
      A.links.add(b); B.links.add(a);
      A._peer({ type: 'join', peerId: b }); B._peer({ type: 'join', peerId: a });
    },
    setConditions(from, to, cond) { Object.assign(linkState(from, to).cond, cond); },
    /** Both directions at once (RTT = 2 × latencyMs). */
    setPath(a, b, cond) { this.setConditions(a, b, cond); this.setConditions(b, a, cond); },
    /** Pretend `from`'s state channel to `to` holds this many bytes (backpressure tests). */
    setBuffered(from, to, n) { linkState(from, to).buffered = n; },
    /** Deliver everything due at or before `toMs`, in time order. */
    advance(toMs) {
      while (queue.length && queue[0].at <= toMs) {
        const e = queue.shift();
        now = Math.max(now, e.at);
        e.fn();
      }
      now = Math.max(now, toMs);
    },
    get now() { return now; },
    /** Time of the next scheduled delivery (Infinity when idle). */
    get nextAt() { return queue.length ? queue[0].at : Infinity; },
    linkStats(from, to) { return { ...linkState(from, to).stats }; },
    get pending() { return queue.length; },
  };
}
