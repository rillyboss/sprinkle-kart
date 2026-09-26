/**
 * Input lead controller (NETWORKING.md §9.2). The guest predicts at P = T_est + lead so its input for
 * tick T reaches the host a little BEFORE the host simulates T. The host reports `inputSlack` in every
 * snapshot (how many ticks early the input for that tick arrived; −128 = it never arrived in time).
 *
 * - Target slack 2 ticks (inputs travel in pairs at 30 Hz, so never 1), raised to 4 when measured loss
 *   is > 2 % or a burst of >= 2 lost packets was seen in the last 10 s.
 * - Time dilation: the predicted clock runs up to ±3 % faster/slower to hold slack in [target−1, target+1].
 * - Slack < 0 for 3 snapshots in a row → lead += 2 ticks at once; slack > target + 4 for 10 snapshots →
 *   lead −= 2 at once. After a jump, reports that cannot yet reflect it (one round trip) are ignored.
 * - Frozen while the host is paused.
 */
export const LEAD_TARGET_SLACK = 2;
export const LEAD_TARGET_SLACK_LOSSY = 4;
export const LEAD_DILATION = 0.03;
export const LOSS_RAISE_PCT = 2;
export const BURST_MEMORY_MS = 10000;

/**
 * @param {{ tickMs?: number, targetSlack?: number, lossySlack?: number, dilation?: number, minLead?: number, maxLead?: number }} [o]
 */
export function createLeadController({
  tickMs = 1000 / 60, targetSlack = LEAD_TARGET_SLACK, lossySlack = LEAD_TARGET_SLACK_LOSSY, dilation = LEAD_DILATION,
  minLead = 1, maxLead = 60,
} = {}) {
  let lead = targetSlack + 1;
  let rate = 0; // -dilation..+dilation
  let frozen = false;
  let lossy = false;
  let lastBurstMs = -Infinity;
  let neg = 0;
  let high = 0;
  let cooldown = 0;
  let slackAvg = null;
  let rttTicks = 0;
  const stats = { jumpsUp: 0, jumpsDown: 0, reports: 0, missing: 0 };

  const target = () => (lossy ? lossySlack : targetSlack);
  const clampLead = () => { lead = Math.max(minLead, Math.min(maxLead, lead)); };

  return {
    /** Start from the round trip: lead ≈ RTT/2 + target slack + 1 tick. */
    reset(rttMs = 0) {
      rttTicks = rttMs / tickMs;
      lead = Math.ceil(rttTicks / 2) + target() + 1;
      clampLead();
      neg = 0; high = 0; cooldown = 0; slackAvg = null; rate = 0;
    },
    /** Loss/burst measurements (from snapshot seq gaps). */
    setLoss({ lossPct = 0, burst = 0, nowMs = 0 } = {}) {
      if (burst >= 2) lastBurstMs = nowMs;
      const was = lossy;
      lossy = lossPct > LOSS_RAISE_PCT || nowMs - lastBurstMs < BURST_MEMORY_MS;
      if (lossy && !was) lead += lossySlack - targetSlack; // make room at once for the bigger target
      else if (!lossy && was) lead -= lossySlack - targetSlack;
      clampLead();
    },
    setRtt(rttMs) { rttTicks = rttMs / tickMs; },
    /** One snapshot's inputSlack report (−128 = missing). */
    onSlack(slack) {
      if (frozen) return;
      stats.reports++;
      if (cooldown > 0) { cooldown--; return; }
      const s = slack <= -128 ? -1 : slack;
      if (slack <= -128) stats.missing++;
      slackAvg = slackAvg === null ? s : slackAvg + (s - slackAvg) * 0.25;
      const t = target();
      const settle = Math.ceil((rttTicks + 4) / 2) + 1; // snapshots before a change is visible
      if (s < 0) { neg++; high = 0; } else if (s > t + 4) { high++; neg = 0; } else { neg = 0; high = 0; }
      if (neg >= 3) { lead += 2; neg = 0; cooldown = settle; slackAvg = null; stats.jumpsUp++; }
      else if (high >= 10) { lead -= 2; high = 0; cooldown = settle; slackAvg = null; stats.jumpsDown++; }
      clampLead();
      if (slackAvg === null) { rate = 0; return; }
      rate = slackAvg < t - 1 ? dilation : slackAvg > t + 1 ? -dilation : 0;
    },
    /** Advance by `dtTicks` of local time: dilation moves the lead gradually. */
    update(dtTicks) {
      if (frozen || !rate) return;
      lead += rate * dtTicks;
      clampLead();
    },
    freeze(on) { frozen = !!on; if (frozen) rate = 0; },
    get lead() { return lead; },
    get rate() { return rate; },
    get targetSlack() { return target(); },
    get lossy() { return lossy; },
    get frozen() { return frozen; },
    stats,
  };
}
