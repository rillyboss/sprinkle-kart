/**
 * The guest's estimate of the host timebase (NETWORKING.md §7.3): which host tick is being simulated
 * at a given local time. The clock offset (host wall time vs mine) comes from the clock sync
 * (`clock.hostNow(localMs)`, `clock.rttMs`); this module keeps the tick anchor.
 *
 * - `onTimebase(tb)`: a newer epoch, or a same-epoch anchor that disagrees by > 1 tick, hard-resyncs.
 * - `onPause(pauseTick)` freezes `tickAt()` at pauseTick; `onResume(resumeTick)` unfreezes AT ONCE on a
 *   provisional anchor (the host resumed one-way ago) and the resume TIMEBASE, whenever it arrives, only
 *   corrects it. (Waiting for a TIMEBASE that was lost and retransmitted froze the guest for 300+ ms and then
 *   jumped its timeline ~25 ticks — every remote kart snapped metres.)
 * - `onSnapshot(tick, epoch, recvMs)` filters (tick, arrival) pairs so a lost or late TIMEBASE is harmless:
 *   residual r = tickAt(recv) − tick − oneWayTicks; the median over the last 10 snapshots of this epoch
 *   slews the anchor by ≤ 0.25 tick per snapshot; |median| > 3 ticks for 5 snapshots in a row hard-resyncs
 *   to the snapshot-based estimate; a snapshot tick newer than tickAt() pulls the estimate forward at once.
 *
 * `tickAt(localMs)` is the host's PRESENT (fractional tick), frozen while paused.
 */
export const RESIDUAL_WINDOW = 10;
export const SLEW_PER_SNAPSHOT = 0.25;
export const HARD_RESYNC_TICKS = 3;
export const HARD_RESYNC_COUNT = 5;
export const TB_RESYNC_TICKS = 1;
export const RESUME_GRACE_MS = 500;

const epochNewer = (a, b) => { const d = (a - b) & 0xff; return d !== 0 && d < 128; };
const median = (arr) => {
  const s = [...arr].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param {{ clock: { hostNow?: (ms: number) => number, offset?: number, rttMs?: number }, tickHz?: number,
 *           resumeGraceMs?: number, oneWayMs?: () => number }} o
 */
export function createHostTimeline({ clock, tickHz = 60, resumeGraceMs = RESUME_GRACE_MS, oneWayMs } = {}) {
  const tickMs = 1000 / tickHz;
  const hostNow = (ms) => (clock?.hostNow ? clock.hostNow(ms) : ms + (clock?.offset || 0));
  const oneWay = () => (oneWayMs ? oneWayMs() : Math.max(0, (clock?.rttMs || 0) / 2));
  let known = false;
  let epoch = 0;
  let anchorTick = 0;
  let anchorHostMs = 0;
  let paused = false;
  let pauseTick = 0;
  let pendingResume = null; // { tick, localMs } until the resume TIMEBASE arrives
  let residuals = [];
  let bigRun = 0;
  const stats = { hardResyncs: 0, tbResyncs: 0, pulls: 0, slews: 0, ignored: 0 };

  const raw = (localMs) => anchorTick + ((hostNow(localMs) - anchorHostMs) / tickMs);

  function setAnchor(tick, hostMs) {
    anchorTick = tick;
    anchorHostMs = hostMs;
    known = true;
    residuals = [];
    bigRun = 0;
  }

  function tickAt(localMs) {
    if (paused) return pauseTick;
    if (pendingResume && localMs - pendingResume.localMs >= resumeGraceMs) pendingResume = null; // TIMEBASE never came
    return known ? raw(localMs) : 0;
  }

  return {
    tickAt,
    /** @param {{ epoch: number, tick: number, hostMs: number, reason?: number }} tb */
    onTimebase(tb) {
      if (!known || epochNewer(tb.epoch, epoch)) {
        epoch = tb.epoch;
        setAnchor(tb.tick, tb.hostMs);
        stats.tbResyncs++;
        if (pendingResume) pendingResume = null;
        return true;
      }
      if (tb.epoch !== epoch) { stats.ignored++; return false; } // an older epoch
      // Same epoch: where does our line put tb.tick? Compare in host time.
      const predicted = anchorTick + (tb.hostMs - anchorHostMs) / tickMs;
      if (Math.abs(predicted - tb.tick) > TB_RESYNC_TICKS) {
        setAnchor(tb.tick, tb.hostMs);
        stats.tbResyncs++;
        return true;
      }
      return false;
    },
    onPause(tick) {
      paused = true;
      pauseTick = tick;
      pendingResume = null;
    },
    onResume(tick, localMs) {
      if (!paused && !pendingResume) return;
      paused = false;
      pendingResume = { tick, localMs: localMs ?? 0 };
      // provisional: the host resumed `tick` one-way ago; the resume TIMEBASE (new epoch) replaces it
      setAnchor(tick, hostNow(localMs ?? 0) - oneWay());
    },
    /**
     * @param {number} tick snapshot tick (state after simulating it)
     * @param {number} snapEpoch
     * @param {number} recvMs local arrival time
     */
    onSnapshot(tick, snapEpoch, recvMs) {
      if (!known || paused || pendingResume || snapEpoch !== epoch) { stats.ignored++; return; }
      const expected = tick + oneWay() / tickMs;
      const est = raw(recvMs);
      if (tick > est) {
        // Impossible if the estimate were right: the host is at least at `tick` now.
        anchorTick += expected - est;
        residuals = [];
        bigRun = 0;
        stats.pulls++;
        return;
      }
      residuals.push(est - expected);
      if (residuals.length > RESIDUAL_WINDOW) residuals.shift();
      const med = median(residuals);
      if (Math.abs(med) > HARD_RESYNC_TICKS) {
        bigRun++;
        if (bigRun >= HARD_RESYNC_COUNT) {
          anchorTick += expected - est;
          residuals = [];
          bigRun = 0;
          stats.hardResyncs++;
        }
        return;
      }
      bigRun = 0;
      if (residuals.length >= 3) {
        const step = Math.max(-SLEW_PER_SNAPSHOT, Math.min(SLEW_PER_SNAPSHOT, med));
        if (step !== 0) {
          anchorTick -= step;
          residuals = residuals.map((r) => r - step);
          stats.slews++;
        }
      }
    },
    get paused() { return paused; },
    get epoch() { return epoch; },
    get known() { return known; },
    /** One-way latency in ticks (for R = T_est − oneWay − interp). */
    oneWayTicks() { return oneWay() / tickMs; },
    stats,
  };
}
