/**
 * Guest input history (NETWORKING.md §9.2): the local inputs of every predicted tick, one ring of 128
 * ticks keyed by tick. It feeds three things: the INPUT sender (newest n ticks, redundantly), the
 * reconciler's replay (ticks S+1..P) and the lead controller's view of what was sent.
 *
 * Each entry holds the wire form per local seat (PlayerTickInput: analog + held buttons + press counters,
 * quantised like the wire so prediction uses exactly what the host will get) and the resolved DriveInput
 * the prediction used. `resolveLocalInputs` runs the SAME press resolver as the host's input buffer,
 * so an on-time input is resolved identically on both sides (useItem one tick per press, the hop edge).
 */
import { createPressResolver } from '../host/inputBuffer.js';

export const INPUT_HISTORY_SIZE = 128;

export function createInputHistory({ size = INPUT_HISTORY_SIZE } = {}) {
  const ring = new Array(size).fill(null);
  let newest = -Infinity;
  let oldestKept = -Infinity;
  return {
    /** @param {number} tick @param {object[]} wire PlayerTickInput per seat @param {object[]} resolved DriveInput per seat */
    put(tick, wire, resolved) {
      ring[tick % size] = { tick, wire, resolved };
      if (tick > newest) newest = tick;
    },
    get(tick) {
      const e = ring[tick % size];
      return e && e.tick === tick && tick >= oldestKept ? e : null;
    },
    /** Entries for ticks from..to (inclusive), skipping any that are missing. */
    range(from, to) {
      const out = [];
      for (let t = from; t <= to; t++) { const e = this.get(t); if (e) out.push(e); }
      return out;
    },
    /** Forget every entry before `tick` (Robo Driver hand-back, re-seed). */
    clearBefore(tick) {
      oldestKept = tick;
      for (let i = 0; i < size; i++) if (ring[i] && ring[i].tick < tick) ring[i] = null;
    },
    get newest() { return newest; },
    get size() { return ring.reduce((n, e) => n + (e ? 1 : 0), 0); },
    capacity: size,
  };
}

/**
 * Per-seat press resolution on the guest (mirrors the host's input buffer for on-time inputs).
 * @param {number} seats
 */
export function createLocalResolver(seats) {
  const resolvers = Array.from({ length: seats }, () => createPressResolver());
  return {
    /**
     * @param {number} tick
     * @param {object[]} wire PlayerTickInput per seat (quantised)
     * @returns {object[]} DriveInput per seat
     */
    resolve(tick, wire) {
      return wire.map((w, i) => {
        const r = resolvers[i];
        r.observe(w.itemCount, w.hopCount, tick);
        const d = r.dispense(tick, !!w.drift);
        return {
          steer: w.steer || 0, accel: w.accel || 0, brake: w.brake || 0, drift: d.drift, useItem: d.useItem,
          lookBack: !!w.lookBack, robo: !!w.robo, assisted: !!w.assisted,
        };
      });
    },
    /** A seat's resolver starts over (Robo Driver hand-back / reconnect): current counters = baseline. */
    rebaseline(seat, itemCount = 0, hopCount = 0, tick = -Infinity) { resolvers[seat]?.baseline(itemCount, hopCount, tick); },
    seats,
  };
}
