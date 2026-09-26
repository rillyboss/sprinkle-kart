/**
 * Guest driver (NETWORKING.md §7.3, §9.1, §9.2): glues the host timeline, the lead controller, the
 * ReplicaRace and the INPUT sender to the transport.
 *
 *   frame(dt)   T_est = timeline.tickAt(now); P = T_est + lead; R = T_est − oneWay − interpDelay;
 *               the replica predicts up to P (sampling each local seat once per predicted tick) and draws
 *               remote things at R; INPUT goes out after every 2nd predicted tick; PING at 2 Hz.
 *   onMessage   SNAPSHOT → timeline filter + lead (inputSlack) + loss stats + replica; EVENTS → replica;
 *               TIMEBASE / PAUSE → timeline (and the lead freezes while paused); START → replica timing;
 *               PONG → clock sync; FRAG → reassembly, then dispatch; JSON ctrl (RESULT, …) → onCtrl.
 */
import { createLeadController } from './leadController.js';
import { createInputSender } from './inputSender.js';

export const PING_INTERVAL_MS = 500; // 2 Hz in race
export const WARMUP_PINGS = 8; // the handshake's clock-sync warm-up (�7.1), 50 ms apart
const WARMUP_INTERVAL_MS = 50;
export const R_SLEW = 0.1; // the remote clock runs 0.9..1.1× local time while it catches its target
export const R_SNAP_TICKS = 20;

/**
 * @param {object} o
 * @param {import('./replicaRace.js').ReplicaRace} o.replica
 * @param {object} o.transport          NetTransport (guest)
 * @param {object} o.clock              clock sync: makePing(), onPong(m, t3), hostNow(ms), rttMs, ready
 * @param {object} o.timeline           createHostTimeline()
 * @param {Array<{ kartId: number, sample: (tick: number) => object }>} o.localSeats   seat order
 * @param {object} o.wire
 * @param {() => string} [o.hostId]
 * @param {() => number} [o.now]
 * @param {(m: object) => void} [o.onCtrl]
 */
export function createGuestDriver({
  replica, transport, clock, timeline, localSeats = [], wire, hostId = () => transport.peers()[0], now = () => performance.now(),
  onCtrl = null, lead = createLeadController(),
}) {
  const sender = createInputSender({ wire, transport, hostId, history: replica.history });
  const reassembler = wire.createReassembler ? wire.createReassembler() : null;
  const tickMs = 1000 / 60;
  let lastPing = -Infinity;
  let lastSnapTick = 0;
  let started = false;
  let leadReset = false;
  let lastSlackTick = -1;
  let lastResult = null;
  let pings = 0;
  let renderTick = null;
  let lastSlack = null;
  const stats = { snapshots: 0, events: 0, timebases: 0, pauses: 0, pongs: 0, frags: 0, bad: 0, inputsSent: 0, ctrl: 0 };
  const sampleAll = (tick) => localSeats.map((s) => s.sample(tick));

  function handle(peerId, m) {
    const M = wire.MSG;
    const t = now();
    switch (m.type) {
      case M.SNAPSHOT: {
        stats.snapshots++;
        timeline.onSnapshot(m.tick, m.epoch, t);
        if (m.tick > lastSlackTick) {
          lastSlackTick = m.tick;
          lastSlack = m.inputSlack;
          lead.onSlack(m.inputSlack);
        }
        lastSnapTick = Math.max(lastSnapTick, m.tick);
        replica.onSnapshot(m, t);
        lead.setLoss({ lossPct: replica.arrivals.lossPct, burst: replica.arrivals.lastBurst, nowMs: t });
        break;
      }
      case M.EVENTS: stats.events++; replica.onEvents(m); break;
      case M.TIMEBASE: stats.timebases++; timeline.onTimebase(m); break;
      case M.PAUSE:
        stats.pauses++;
        if (m.paused) timeline.onPause(m.tick); else timeline.onResume(m.tick, t);
        lead.freeze(m.paused);
        break;
      case M.START: started = true; replica.setStart(m); break;
      case M.PONG:
        stats.pongs++;
        clock.onPong(m, t);
        lead.setRtt(clock.rttMs);
        if (!leadReset && clock.ready) { leadReset = true; lead.reset(clock.rttMs); }
        break;
      case M.FRAG: {
        stats.frags++;
        const whole = reassembler?.push(m, t);
        if (whole) { const inner = wire.decode(whole); if (inner) handle(peerId, inner); else stats.bad++; }
        break;
      }
      default:
        stats.ctrl++;
        if (m.type === M.RESULT) lastResult = m;
        onCtrl?.(m);
    }
  }

  return {
    frame(dt) {
      const t = now();
      if (t - lastPing >= (pings < WARMUP_PINGS ? WARMUP_INTERVAL_MS : PING_INTERVAL_MS)) {
        lastPing = t;
        pings++;
        const p = clock.makePing();
        transport.send(hostId(), 'state', wire.encodeCtrl(wire.MSG.PING, p));
      }
      if (!started || !timeline.known) { replica.present(1, dt); return { ticks: [] }; }
      const T = timeline.tickAt(t);
      if (!timeline.paused) lead.update(dt * 60);
      const P = T + lead.lead;
      // The remote timeline is a smooth clock: it advances with local time and slews ≤ 10 % toward its target,
      // so clock-offset / RTT estimate updates never make remote karts hop (a far-off target snaps).
      const desiredR = T - timeline.oneWayTicks() - replica.interpDelayMs / tickMs;
      if (renderTick === null || Math.abs(desiredR - renderTick) > R_SNAP_TICKS) renderTick = desiredR;
      else if (timeline.paused) renderTick = Math.min(renderTick, desiredR);
      else {
        const step = dt * 60;
        renderTick += step;
        renderTick += Math.max(-R_SLEW * step, Math.min(R_SLEW * step, desiredR - renderTick));
      }
      const R = renderTick;
      // The host skipped or starved while we kept predicting: our timeline was far ahead of the host's.
      if (replica.predictedTick - Math.floor(P) > R_SNAP_TICKS) replica.rewind(Math.floor(P));
      const ticks = replica.frame(dt, sampleAll, { P, R });
      for (const tick of ticks) {
        const b = sender.afterTick(tick, { slackTarget: lead.targetSlack, lastSnapTick });
        if (b) stats.inputsSent++;
      }
      const alpha = P - Math.floor(P);
      replica.present(ticks.length ? Math.min(1, alpha + 1e-9) : 1, dt);
      return { ticks, P, R, T };
    },
    onMessage(peerId, ch, bytes) {
      const m = wire.decode(bytes);
      if (!m) { stats.bad++; return; }
      handle(peerId, m);
    },
    stats() {
      return {
        ...stats, lead: lead.lead, targetSlack: lead.targetSlack, lastSlack, leadJumps: { ...lead.stats },
        interpDelayMs: replica.interpDelayMs, epoch: timeline.epoch, paused: timeline.paused, sender: { ...sender.stats },
        reconcileP50: replica.reconciler.percentile(0.5), reconcileP99: replica.reconciler.percentile(0.99),
        lastEventSeq: replica.events.lastSeq, clock: { rttMs: clock.rttMs, jitterMs: clock.jitterMs, ready: clock.ready },
      };
    },
    get lead() { return lead; },
    get lastSlack() { return lastSlack; },
    get sender() { return sender; },
    get lastResult() { return lastResult; },
    dispose() { replica.dispose?.(); },
  };
}
