/**
 * Replicated event player (NETWORKING.md §9.7). Events ride the ordered ctrl channel, snapshots the
 * unordered state channel, so an event can arrive before or after the snapshot of its tick.
 *
 * - Each seq is applied at most once (`lastSeq`; duplicates after a reconnect/RESYNC are ignored). A gap
 *   cannot happen on a reliable channel — if one shows up, `onGap` asks for a RESYNC.
 * - Own-kart events whose type this machine predicts locally (hop, land, drift-*, pad/start boost, wall
 *   bump, bumps between two of this machine's karts, self item-use; countdown/go always, they come from the
 *   prediction timeline P) are DROPPED: the guest already emitted them with `predicted: true`.
 * - Other own-kart events (item-get, bonked, lap, finish, …) are released immediately, in seq order.
 * - World/remote events are released when R >= event.tick (sound lines up with the interpolated picture),
 *   in seq order; events older than R − 1 s are released at once (never stuck behind a ctrl retransmit).
 *
 * Events are presentation only: the replica maps kart ids back to its kart objects and re-emits them
 * through the normal onEvent path.
 */
export const LATE_RELEASE_MS = 1000;

/** Self item effects the guest predicts (boost, triple, star, shield); gumdrop/rocket are host-only. */
export const PREDICTED_SELF_ITEMS = new Set(['sprinkle-boost', 'triple-sprinkle', 'rainbow-star', 'bubble-shield']);

/**
 * Is this host event a locally predicted one for one of my karts?
 * @param {object} e wire event
 * @param {(kartId: number) => boolean} isMine   kart predicted on this machine
 */
export function isPredictedForMe(e, isMine) {
  if (e.type === 'countdown' || e.type === 'go') return true;
  if (!isMine(e.kart)) return false;
  switch (e.type) {
    case 'hop': case 'land': case 'drift-start': case 'drift-level': case 'drift-boost': return true;
    case 'launch': case 'trick': case 'ring': return true; // v3.1 jumps are predicted like hops
    case 'boost': return e.source === 'start' || e.source === 'pad' || e.source === 'item' || e.source === 'trick' || e.source === 'ring';
    case 'bump': return e.other === 255 || isMine(e.other);
    case 'item-use': return PREDICTED_SELF_ITEMS.has(e.item);
    default: return false;
  }
}

/**
 * @param {object} o
 * @param {(kartId: number) => boolean} o.isMine        karts predicted on this machine (own, not Robo-driven)
 * @param {(e: object) => void} o.onEvent                released wire events (kart ids)
 * @param {(expectedSeq: number, gotSeq: number) => void} [o.onGap]
 * @param {number} [o.tickMs]
 * @param {(e: object) => void} [o.onAccept]           every seq accepted exactly once (dropped or queued)
 * @param {number} [o.firstSeq]                         the seq expected first (1 for a new race)
 */
export function createEventPlayer({ isMine, onEvent, onGap, onAccept, tickMs = 1000 / 60, firstSeq = 1 }) {
  let lastSeq = (firstSeq - 1) >>> 0; // newest seq accepted into the queues
  const world = [];
  const own = [];
  const lateTicks = LATE_RELEASE_MS / tickMs;
  const stats = { received: 0, dup: 0, dropped: 0, released: 0, gaps: 0, lateReleases: 0 };
  const after = (a, b) => { const d = (a - b) >>> 0; return d !== 0 && d < 0x80000000; };

  return {
    /** Accept one EVENTS batch's events (seq order). */
    push(events) {
      for (const e of events) {
        stats.received++;
        if (!after(e.seq, lastSeq)) { stats.dup++; continue; }
        const expected = (lastSeq + 1) >>> 0;
        if (e.seq !== expected) { stats.gaps++; onGap?.(expected, e.seq); }
        lastSeq = e.seq;
        onAccept?.(e);
        if (isPredictedForMe(e, isMine)) { stats.dropped++; continue; }
        (isMine(e.kart) ? own : world).push(e);
      }
    },
    /**
     * Release what is due at render tick R.
     * @returns {object[]} released events (also passed to onEvent)
     */
    release(renderTick) {
      const out = [];
      while (own.length) out.push(own.shift());
      while (world.length && (world[0].tick <= renderTick || world[0].tick < renderTick - lateTicks)) {
        const e = world.shift();
        if (e.tick > renderTick) stats.lateReleases++;
        out.push(e);
      }
      // anything older than R − 1 s behind a not-yet-due head is released too (in seq order)
      if (world.length && world.some((e) => e.tick < renderTick - lateTicks)) {
        let cut = 0;
        for (let i = 0; i < world.length; i++) if (world[i].tick < renderTick - lateTicks) cut = i + 1;
        for (const e of world.splice(0, cut)) { stats.lateReleases++; out.push(e); }
      }
      out.sort((a, b) => (after(a.seq, b.seq) ? 1 : -1));
      for (const e of out) { stats.released++; onEvent(e); }
      return out;
    },
    /** After a RESYNC: everything up to `seq` is known. */
    resetTo(seq) { lastSeq = seq >>> 0; world.length = 0; own.length = 0; },
    get lastSeq() { return lastSeq; },
    get pending() { return world.length + own.length; },
    stats,
  };
}
