/**
 * Guest INPUT sender (NETWORKING.md §6.1 0x01, §9.2): right after every 2nd predicted tick (30 Hz) it
 * sends the newest n = clamp(slackTarget + 4, 4, 8) ticks of every local seat, newest first. Only copies
 * that can still reach the host before it simulates their tick are worth sending, and the press counters
 * make the redundancy safe.
 */
export const INPUT_EVERY = 2;

export const inputCopies = (slackTarget) => Math.max(4, Math.min(8, Math.round(slackTarget) + 4));

/**
 * @param {object} o
 * @param {object} o.wire          { encodeInput }
 * @param {object} o.transport     NetTransport (guest side)
 * @param {() => string} o.hostId  the host's peer id
 * @param {object} o.history       createInputHistory()
 * @param {number} [o.every]
 */
export function createInputSender({ wire, transport, hostId, history, every = INPUT_EVERY }) {
  let seq = 0;
  let sinceSend = 0;
  const stats = { sent: 0, refused: 0, bytes: 0, maxBytes: 0 };
  return {
    /**
     * Call after predicting tick `tick`. Sends when `every` ticks were predicted since the last send.
     * @param {number} tick newest predicted tick
     * @param {{ slackTarget: number, lastSnapTick: number, force?: boolean }} o
     * @returns {Uint8Array|null} the bytes sent (null = not this tick)
     */
    afterTick(tick, { slackTarget = 2, lastSnapTick = 0, force = false } = {}) {
      sinceSend++;
      if (!force && sinceSend < every) return null;
      sinceSend = 0;
      const n = inputCopies(slackTarget);
      const ticks = [];
      for (let t = tick; t > tick - n; t--) {
        const e = history.get(t);
        if (!e) break;
        ticks.push({ tick: t, players: e.wire });
      }
      if (!ticks.length) return null;
      seq = (seq + 1) & 0xffff;
      const bytes = wire.encodeInput({ seq, newestTick: tick, lastSnapTick, ticks });
      const ok = transport.send(hostId(), 'state', bytes);
      if (ok) stats.sent++; else stats.refused++;
      stats.bytes += bytes.length;
      stats.maxBytes = Math.max(stats.maxBytes, bytes.length);
      return bytes;
    },
    get seq() { return seq; },
    stats,
  };
}
