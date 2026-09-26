/**
 * TEMPORARY clock-offset estimator standing in for WS2's src/net/clock.js `createClockSync` until it lands
 * (NETWORKING.md §7.3 "Offset"): NTP-style 4-timestamp PING/PONG, the last 16 samples, samples within 1 σ of
 * the median RTT weighted by 1/rtt, jitter = EWMA(1/8) of |rtt − rttPrev|, ready after 5 samples, slewed
 * ≤ 2 ms per second once ready, hard re-sync after 8 samples disagreeing by > 50 ms.
 *
 * Interface used by WS5 (src/net/guest/hostTimeline.js, guestDriver): hostNow(localMs), rttMs, jitterMs, ready.
 */
export function createClockSync({ now = () => performance.now(), window = 16, slewMsPerSec = 2 } = {}) {
  const samples = [];
  let offset = 0;
  let target = 0;
  let ready = false;
  let rttMs = 0;
  let jitterMs = 0;
  let prevRtt = null;
  let lastUpdate = null;
  let disagree = 0;
  let pingId = 0;
  const sent = new Map();

  function estimate() {
    const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b);
    const med = rtts[Math.floor(rtts.length / 2)];
    const mean = rtts.reduce((a, b) => a + b, 0) / rtts.length;
    const sd = Math.sqrt(rtts.reduce((a, b) => a + (b - mean) ** 2, 0) / rtts.length);
    const keep = samples.filter((s) => Math.abs(s.rtt - med) <= sd + 1e-9);
    let wsum = 0;
    let osum = 0;
    for (const s of keep) { const w = 1 / Math.max(1, s.rtt); wsum += w; osum += w * s.offset; }
    return { offset: osum / wsum, rtt: keep.reduce((a, s) => a + s.rtt, 0) / keep.length };
  }

  return {
    /** A PING to send ({ id, t0 }). */
    makePing() {
      pingId = (pingId + 1) & 0xffff;
      const t0 = now();
      sent.set(pingId, t0);
      if (sent.size > 32) sent.delete(sent.keys().next().value);
      return { id: pingId, t0 };
    },
    /** A PONG arrived at local time t3. */
    onPong({ id, t0, t1, t2 }, t3 = now()) {
      if (sent.has(id)) sent.delete(id);
      const rtt = Math.max(0, (t3 - t0) - (t2 - t1));
      const off = ((t1 - t0) + (t2 - t3)) / 2;
      samples.push({ rtt, offset: off });
      if (samples.length > window) samples.shift();
      if (prevRtt !== null) jitterMs += (Math.abs(rtt - prevRtt) - jitterMs) / 8;
      prevRtt = rtt;
      const est = estimate();
      target = est.offset;
      rttMs = est.rtt;
      if (!ready) {
        offset = target;
        if (samples.length >= 5) ready = true;
      } else if (Math.abs(target - offset) > 50) {
        disagree++;
        if (disagree >= 8) { offset = target; disagree = 0; }
      } else {
        disagree = 0;
        const dt = lastUpdate === null ? 0 : Math.max(0, (t3 - lastUpdate) / 1000);
        const step = slewMsPerSec * dt;
        offset += Math.max(-step, Math.min(step, target - offset));
      }
      lastUpdate = t3;
    },
    /** Host wall time for a local time. */
    hostNow(localMs = now()) { return localMs + offset; },
    get offset() { return offset; },
    get rttMs() { return rttMs; },
    get jitterMs() { return jitterMs; },
    get ready() { return ready; },
    get samples() { return samples.length; },
  };
}
