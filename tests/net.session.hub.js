/**
 * A tiny in-memory "room" for session sims: one host endpoint + guest endpoints
 * that speak the NetTransport subset the session wrappers use (send / onMessage /
 * onPeer / disconnect). Messages queue up and `flush()` delivers them in order,
 * so tests step the conversation deterministically. (WS2's MemoryTransport with
 * loss / latency is for the netcode sims; sessions only need ordered ctrl.)
 */
export function createSessionHub() {
  const endpoints = new Map();
  const queue = [];
  const links = new Set(); // 'host|guest'
  let hostId = null;
  const log = [];

  function endpoint(selfId, role) {
    const msgFns = new Set();
    const peerFns = new Set();
    const ep = {
      selfId,
      role,
      sent: [],
      peers: () => [...links].filter((l) => l.split('|').includes(selfId)).map((l) => l.split('|').find((x) => x !== selfId)),
      send(to, ch, bytes) {
        if (![...links].some((l) => l === `${selfId}|${to}` || l === `${to}|${selfId}`)) return false;
        ep.sent.push({ to, ch, bytes });
        queue.push({ from: selfId, to, ch, bytes });
        return true;
      },
      broadcast(ch, bytes) { for (const p of ep.peers()) ep.send(p, ch, bytes); },
      onMessage(fn) { msgFns.add(fn); return () => msgFns.delete(fn); },
      onPeer(fn) { peerFns.add(fn); return () => peerFns.delete(fn); },
      // like a real channel close: everything already sent still arrives, then the link goes
      disconnect(peerId) { queue.push({ cut: role === 'host' ? peerId : selfId }); },
      close() {},
      _deliver(from, ch, bytes) { for (const fn of [...msgFns]) fn(from, ch, bytes); },
      _peer(type, peerId) { for (const fn of [...peerFns]) fn({ type, peerId }); },
    };
    endpoints.set(selfId, ep);
    return ep;
  }

  function cut(guestId) {
    const key = `${hostId}|${guestId}`;
    if (!links.delete(key)) return;
    log.push(['cut', guestId]);
    // drop anything still queued between them (the connection is gone)
    for (let i = queue.length - 1; i >= 0; i--) {
      const m = queue[i];
      if ((m.from === guestId && m.to === hostId) || (m.from === hostId && m.to === guestId)) queue.splice(i, 1);
    }
    endpoints.get(hostId)?._peer('leave', guestId);
    endpoints.get(guestId)?._peer('leave', hostId);
  }

  return {
    log,
    host(id = 'host0000host0000') { hostId = id; return endpoint(id, 'host'); },
    guest(id) { return endpoint(id, 'guest'); },
    connect(guestId) {
      links.add(`${hostId}|${guestId}`);
      endpoints.get(hostId)._peer('join', guestId);
      endpoints.get(guestId)._peer('join', hostId);
    },
    cut,
    /** Deliver queued messages (and whatever they cause) until quiet. */
    flush(max = 10_000) {
      let n = 0;
      while (queue.length && n++ < max) {
        const m = queue.shift();
        if (m.cut) { cut(m.cut); continue; }
        if (!links.has(`${hostId}|${m.from === hostId ? m.to : m.from}`)) continue;
        endpoints.get(m.to)?._deliver(m.from, m.ch, m.bytes);
      }
      return n;
    },
    get pending() { return queue.length; },
  };
}
