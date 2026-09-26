/**
 * Host snapshotter (NETWORKING.md §6.1 SNAPSHOT, §9.4). After every `snapshotEvery`-th tick (2 → 30 Hz)
 * the host captures ONE SimState, the codec encodes the shared body once and appends each house's small
 * tail (lastInputTick ack, inputSlack, owner block for that house's own karts).
 *
 * Backpressure (§4.1): a snapshot the transport refused (`send` → false, state channel full) is a skip.
 * When skips happened in more than 10 of a guest's last 30 intervals, that guest drops to 15 Hz (every
 * 2nd interval); 60 clean intervals in a row restore 30 Hz. Interpolation adapts by itself (§9.5).
 */

export const SNAPSHOT_EVERY = 2;
export const SKIP_WINDOW = 30;
export const SKIP_HALVE_AT = 10; // more than this many skipped intervals in the window → 15 Hz
export const CLEAN_RESTORE = 60;

/**
 * Per-guest 30/15 Hz rate control.
 */
export function createRateControl({ window = SKIP_WINDOW, halveAt = SKIP_HALVE_AT, restoreAfter = CLEAN_RESTORE } = {}) {
  const history = [];
  let halved = false;
  let clean = 0;
  let interval = 0;
  const stats = { sent: 0, skipped: 0, halvings: 0, restores: 0, idle: 0 };
  return {
    /** Should this snapshot interval be sent? (false every 2nd interval while halved) */
    shouldSend() {
      interval++;
      if (halved && interval % 2 === 1) { stats.idle++; return false; }
      return true;
    },
    /** Result of one attempted send. */
    record(sent) {
      history.push(!sent);
      if (history.length > window) history.shift();
      if (sent) { stats.sent++; clean++; } else { stats.skipped++; clean = 0; }
      const skips = history.reduce((n, s) => n + (s ? 1 : 0), 0);
      if (!halved && skips > halveAt) { halved = true; clean = 0; stats.halvings++; }
      else if (halved && clean >= restoreAfter) { halved = false; history.length = 0; stats.restores++; }
    },
    get halved() { return halved; },
    get hz() { return halved ? 15 : 30; },
    stats,
  };
}

/**
 * @param {object} o
 * @param {object} o.wire                   { encodeSnapshot(simState, { epoch, flags, houseTail }) }
 * @param {(race: object, tick: number) => object} o.capture   SimState of the race after `tick`
 * @param {number} [o.snapshotEvery]
 */
export function createSnapshotter({ wire, capture, snapshotEvery = SNAPSHOT_EVERY }) {
  const rates = new Map();
  let lastState = null;
  const stats = { captures: 0, encodes: 0, maxBytes: 0, totalBytes: 0 };
  const rateFor = (houseId) => {
    let r = rates.get(houseId);
    if (!r) { r = createRateControl(); rates.set(houseId, r); }
    return r;
  };
  return {
    snapshotEvery,
    /** Is `tick` a snapshot tick? */
    due(tick) { return tick % snapshotEvery === 0; },
    /** Capture the shared state once for this tick. */
    capture(race, tick) {
      lastState = capture(race, tick);
      lastState.tick = tick;
      stats.captures++;
      return lastState;
    },
    /**
     * Bytes for one house (null when that guest is on 15 Hz and this interval is skipped).
     * @param {object} state from capture()
     * @param {string|number} houseId
     * @param {{ epoch: number, flags?: object, lastInputTick: number, inputSlack: number, owner: number[] }} tail
     */
    encodeFor(state, houseId, { epoch, flags = {}, lastInputTick, inputSlack, owner }) {
      if (!rateFor(houseId).shouldSend()) return null;
      const bytes = wire.encodeSnapshot(state, { epoch, flags, houseTail: { lastInputTick, inputSlack, owner } });
      stats.encodes++;
      stats.maxBytes = Math.max(stats.maxBytes, bytes.length);
      stats.totalBytes += bytes.length;
      return bytes;
    },
    /** Report whether the transport accepted it (false = skipped by backpressure). */
    sent(houseId, ok) { rateFor(houseId).record(ok); },
    rate(houseId) { return rateFor(houseId); },
    forget(houseId) { rates.delete(houseId); },
    get lastState() { return lastState; },
    stats,
  };
}
