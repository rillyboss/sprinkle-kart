/**
 * Host event log (NETWORKING.md §6.3, §9.7). Wraps `race.onEvent`: every race event is stamped with a
 * monotonic `seq` (u32, per race) and the host `tick`, its kart references are mapped to kart ids
 * (255 = none / wall) and its payload is reduced to the replicated catalogue. The last 512 entries are
 * kept (for EVENTS batches and a later RESYNC); `drain()` returns what was added since the previous
 * drain (one EVENTS batch per snapshot interval).
 *
 * Wire form of an entry (what `encodeEvents` receives):
 *   { seq, tick, type, kart, ...payload }   e.g. { seq: 12, tick: 431, type: 'bump', kart: 3, other: 255, strength: 0.4 }
 *
 * Events outside the catalogue (e.g. 'keep-going') are not replicated (counted in `stats.skipped`).
 * On 'race-complete' the log appends a synthetic `finish { estimated: true }` for every kart the race
 * placed by estimate (the Race emits no 'finish' for those), so guests learn every finish place/time
 * from the reliable stream.
 */

export const EVENT_LOG_CAPACITY = 512;
export const NO_KART = 255;

/** The replicated catalogue (§6.3) → payload builder. `id(k)` maps a kart object/id to its id (255 = none). */
const CATALOGUE = {
  countdown: (e) => ({ n: e.n | 0 }),
  go: () => ({}),
  boost: (e) => ({ source: ['start', 'pad', 'item', 'trick', 'ring'].includes(e.source) ? e.source : 'other' }),
  hop: () => ({}),
  land: (e) => ({ strength: clamp01(e.strength ?? 0.5), air: !!e.air, trick: !!e.trick }),
  'drift-start': (e) => ({ dir: Math.sign(e.dir || 0) }),
  'drift-level': (e) => ({ level: e.level | 0 }),
  'drift-boost': (e) => ({ level: e.level | 0 }),
  bump: (e, id) => ({ other: e.wall ? NO_KART : id(e.other), strength: clamp01(e.strength) }),
  'item-box': (e) => ({ boxIndex: Number.isInteger(e.boxIndex) ? e.boxIndex : NO_KART, rolling: !!e.rolling }),
  'item-get': (e) => ({ item: e.item ?? null }),
  'item-use': (e) => ({ item: e.item ?? null, chargesLeft: e.chargesLeft | 0 }),
  'rocket-launch': (e, id) => ({ rocketId: Number.isInteger(e.rocketId) ? e.rocketId : 0, target: id(e.target) }),
  bonked: (e, id) => ({ cause: e.cause ?? 'other', by: id(e.by) }),
  'shield-pop': (e, id) => ({ cause: e.cause ?? (e.expired ? 'expired' : 'other'), by: id(e.by), expired: !!e.expired }),
  'item-dodged': (e, id) => ({ item: e.item ?? null, by: id(e.by) }),
  'item-end': (e) => ({ item: e.item ?? null }),
  lap: (e) => ({ lap: e.lap | 0, lapTimeMs: msOf(lastLapTime(e.kart)) }),
  'final-lap': () => ({}),
  finish: (e) => ({ place: e.place | 0, finishTimeMs: msOf(e.kart?.finishTime), estimated: !!(e.estimated ?? e.kart?.finishEstimated) }),
  'race-complete': () => ({}),
  'gumdrop-spawn': (e) => ({ id: e.id | 0, x: e.x ?? 0, y: e.y ?? 0, z: e.z ?? 0, color: e.color | 0 }),
  'gumdrop-despawn': (e) => ({ id: e.id | 0, why: e.why ?? 'popped' }),
  'rocket-despawn': (e) => ({ id: e.id | 0, why: e.why ?? 'gone' }),
  'box-respawn': (e) => ({ boxIndex: e.boxIndex | 0 }),
  'battle-pop': (e, id) => ({ by: id(e.by), bubblesLeft: e.bubblesLeft | 0 }),
  'battle-out': () => ({}),
  'battle-bonus': () => ({}),
  robo: (e) => ({ on: !!e.on }),
  launch: (e) => ({ jump: Number.isInteger(e.jump) ? e.jump : NO_KART }),
  trick: (e) => ({ kind: e.kind | 0 }),
  ring: (e) => ({ ring: Number.isInteger(e.ring) ? e.ring : NO_KART }),
};

export const REPLICATED_EVENT_TYPES = Object.freeze(Object.keys(CATALOGUE));

function clamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function msOf(sec) {
  return Number.isFinite(sec) ? Math.max(0, Math.round(sec * 1000)) : 0;
}
function lastLapTime(kart) {
  const t = kart?.lapTimes;
  return Array.isArray(t) && t.length ? t[t.length - 1] : null;
}
function kartIdOf(k) {
  if (k === null || k === undefined) return NO_KART;
  if (typeof k === 'number') return Number.isInteger(k) && k >= 0 && k < 255 ? k : NO_KART;
  return Number.isInteger(k.id) && k.id >= 0 && k.id < 255 ? k.id : NO_KART;
}

/**
 * @param {{ capacity?: number, firstSeq?: number }} [o]
 */
export function createEventLog({ capacity = EVENT_LOG_CAPACITY, firstSeq = 1 } = {}) {
  const entries = [];
  let nextSeq = firstSeq >>> 0;
  let drained = nextSeq; // seq of the first entry not yet drained
  const finishedIds = new Set();
  const stats = { pushed: 0, skipped: 0, synthetic: 0, byType: {} };

  function append(tick, type, kart, payload) {
    const entry = { seq: nextSeq, tick, type, kart, ...payload };
    nextSeq = (nextSeq + 1) >>> 0;
    entries.push(entry);
    if (entries.length > capacity) entries.shift();
    stats.pushed++;
    stats.byType[type] = (stats.byType[type] || 0) + 1;
    return entry;
  }

  /**
   * Record one race event at host tick `tick`.
   * @returns {object[]} the entries appended (0, 1, or more for race-complete)
   */
  function push(tick, e) {
    const build = e && CATALOGUE[e.type];
    if (!build) { stats.skipped++; return []; }
    const kart = kartIdOf(e.kart);
    const out = [];
    if (e.type === 'finish' && kart !== NO_KART) finishedIds.add(kart);
    if (e.type === 'race-complete' && Array.isArray(e.standings)) {
      for (const k of e.standings) {
        const id = kartIdOf(k);
        if (id === NO_KART || finishedIds.has(id) || !k.finished) continue;
        finishedIds.add(id);
        stats.synthetic++;
        out.push(append(tick, 'finish', id, { place: k.finishPlace | 0, finishTimeMs: msOf(k.finishTime), estimated: !!k.finishEstimated }));
      }
    }
    out.push(append(tick, e.type, kart, build(e, kartIdOf)));
    return out;
  }

  return {
    push,
    /** A host-generated event (e.g. robo on/off) that did not come from the Race. */
    note(tick, type, kart, payload = {}) { return push(tick, { type, kart, ...payload }); },
    /** Entries added since the previous drain (in seq order). */
    drain() {
      const out = entries.filter((x) => seqAfterOrEq(x.seq, drained));
      drained = nextSeq;
      return out;
    },
    /** Kept entries with seq > `seq` (for a RESYNC / catch-up). */
    since(seq) { return entries.filter((x) => seqAfter(x.seq, seq)); },
    get lastSeq() { return (nextSeq - 1) >>> 0; },
    get size() { return entries.length; },
    entries() { return entries.slice(); },
    stats,
  };
}

/** u32 sequence comparison with wrap-around (a after b). */
export function seqAfter(a, b) {
  const d = (a - b) >>> 0;
  return d !== 0 && d < 0x80000000;
}
function seqAfterOrEq(a, b) {
  return a === b || seqAfter(a, b);
}
