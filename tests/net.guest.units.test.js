// Guest building blocks (NETWORKING.md §9.2, §9.5, §9.7): input history + local press resolution, input
// sender, snapshot buffer / Hermite / extrapolation / adaptive delay, pose smoothing, event player.
import { describe, it, expect } from 'vitest';
import { createInputHistory, createLocalResolver, INPUT_HISTORY_SIZE } from '../src/net/guest/inputHistory.js';
import { createInputSender, inputCopies } from '../src/net/guest/inputSender.js';
import {
  createSnapshotBuffer, hermite, slerpAngle, wrapAngle, createInterpDelay, createArrivalStats, sampleKartPose,
  createPoseSmoother, INTERP_MIN_MS, INTERP_MAX_MS,
} from '../src/net/guest/interpolation.js';
import { createEventPlayer, isPredictedForMe } from '../src/net/guest/eventPlayer.js';
import { createInputBuffer, NEUTRAL_TICK_INPUT } from '../src/net/host/inputBuffer.js';
import { encodeInput, decode } from './helpers/netWire.js';

const TICK = 1000 / 60;
const w = (o = {}) => ({ ...NEUTRAL_TICK_INPUT, accel: 1, ...o });

describe('input history', () => {
  it('stores 128 ticks by tick, drops overwritten ones and clears before a tick', () => {
    const h = createInputHistory();
    expect(h.capacity).toBe(INPUT_HISTORY_SIZE);
    for (let t = 1; t <= 200; t++) h.put(t, [w({ steer: t / 200 })], [{}]);
    expect(h.get(50)).toBeNull(); // overwritten by 178
    expect(h.get(178).wire[0].steer).toBeCloseTo(178 / 200);
    expect(h.range(195, 202).map((e) => e.tick)).toEqual([195, 196, 197, 198, 199, 200]);
    expect(h.newest).toBe(200);
    h.clearBefore(190);
    expect(h.get(185)).toBeNull();
    expect(h.size).toBe(11);
  });

  it('the local resolver gives the same DriveInputs as the host buffer for on-time inputs', () => {
    const lr = createLocalResolver(2);
    const buf = createInputBuffer();
    let item = 0;
    let hop = 0;
    let held = false;
    for (let t = 1; t <= 600; t++) {
      if (t % 17 === 0) item++;
      if (t % 23 === 0) { hop++; held = true; } else if (t % 23 === 9) held = false;
      const seat = [w({ steer: Math.sin(t / 30), drift: held, itemCount: item & 7, hopCount: hop & 7 }), w({ itemCount: (item * 2) & 7 })];
      const mine = lr.resolve(t, seat);
      buf.push(t, seat);
      const host = buf.take(t).inputs;
      expect(mine.map((x) => [x.steer, x.drift, x.useItem])).toEqual(host.map((x) => [x.steer, x.drift, x.useItem]));
    }
    lr.rebaseline(0, 3, 3, 700);
    expect(lr.seats).toBe(2);
  });
});

describe('input sender', () => {
  it('n = clamp(slackTarget + 4, 4, 8)', () => {
    expect([0, 2, 3, 4, 9].map(inputCopies)).toEqual([4, 6, 7, 8, 8]);
  });

  it('sends every 2nd predicted tick with the newest n ticks, newest first', () => {
    const h = createInputHistory();
    const sent = [];
    const transport = { send: (peer, ch, bytes) => { sent.push({ peer, ch, bytes }); return sent.length !== 3; } };
    const s = createInputSender({ wire: { encodeInput }, transport, hostId: () => 'H', history: h });
    for (let t = 1; t <= 10; t++) {
      h.put(t, [w({ steer: t / 10 })], [{}]);
      s.afterTick(t, { slackTarget: 2, lastSnapTick: t - 4 });
    }
    expect(sent.length).toBe(5);
    expect(sent.every((x) => x.peer === 'H' && x.ch === 'state')).toBe(true);
    const m = decode(sent[4].bytes);
    expect(m.newestTick).toBe(10);
    expect(m.ticks.map((x) => x.tick)).toEqual([10, 9, 8, 7, 6, 5]);
    expect(m.lastSnapTick).toBe(6);
    expect(decode(sent[0].bytes).ticks.map((x) => x.tick)).toEqual([2, 1]); // history shorter than n
    expect(s.stats).toMatchObject({ sent: 4, refused: 1 });
    expect(s.seq).toBe(5);
    expect(s.afterTick(99, { force: true })).toBeNull(); // nothing in history for tick 99
  });
});

describe('interpolation', () => {
  const snap = (tick, x, vx = 30, extra = {}) => ({
    tick, flags: {}, karts: [{ id: 0, position: [x, 1, 0], velocity: [vx, 0, 0], heading: 0.1 * tick, rec: 1 }], ...extra,
  });

  it('snapshot buffer: sorted insert, dup/reorder handling, prune and bracket', () => {
    const b = createSnapshotBuffer({ capacity: 4 });
    expect(b.bracket(5)).toEqual({ a: null, b: null, t: 0 });
    expect(b.insert(snap(10, 0))).toBe(true);
    expect(b.insert(snap(14, 0))).toBe(true);
    expect(b.insert(snap(12, 0))).toBe(true); // reordered
    expect(b.insert(snap(12, 0))).toBe(false); // duplicate
    expect(b.bracket(13)).toMatchObject({ a: { tick: 12 }, b: { tick: 14 }, t: 0.5 });
    expect(b.bracket(20)).toMatchObject({ a: { tick: 14 }, b: null });
    expect(b.bracket(3)).toMatchObject({ a: null, b: { tick: 10 } });
    b.insert(snap(16, 0));
    b.insert(snap(18, 0));
    expect(b.size).toBe(4);
    expect(b.oldest.tick).toBe(12);
    expect(b.insert(snap(2, 0))).toBe(false); // too old for a full buffer
    b.prune(17);
    expect(b.oldest.tick).toBe(16);
    expect(b.newest.tick).toBe(18);
    expect(b.stats).toMatchObject({ dup: 1, old: 1 });
  });

  it('Hermite hits both ends with the right slopes; slerp takes the short way round', () => {
    expect(hermite(0, 30, 1, 30, 0, 1 / 30)).toBe(0);
    expect(hermite(0, 30, 1, 30, 1, 1 / 30)).toBeCloseTo(1, 12);
    expect(hermite(0, 30, 1, 30, 0.5, 1 / 30)).toBeCloseTo(0.5, 12); // constant velocity = linear
    expect(slerpAngle(3, -3, 0.5)).toBeCloseTo(wrapAngle(Math.PI), 6);
    expect(Math.abs(slerpAngle(3, -3, 0.5))).toBeGreaterThan(3);
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI, 9);
  });

  it('samples a kart by Hermite between snapshots, extrapolates up to 250 ms, then freezes', () => {
    const b = createSnapshotBuffer();
    b.insert(snap(10, 0));
    b.insert(snap(12, 1));
    const mid = sampleKartPose(b, 0, 11);
    expect(mid.mode).toBe('interp');
    expect(mid.x).toBeCloseTo(0.5, 6);
    const ex = sampleKartPose(b, 0, 12 + 6); // 100 ms past the newest
    expect(ex.mode).toBe('extrap');
    expect(ex.x).toBeCloseTo(1 + 30 * 0.1, 6);
    const fr = sampleKartPose(b, 0, 12 + 60);
    expect(fr.mode).toBe('frozen');
    expect(fr.x).toBeCloseTo(1 + 30 * 0.25, 6);
    expect(sampleKartPose(b, 0, 5).mode).toBe('early');
    expect(sampleKartPose(b, 3, 11)).toBeNull();
    expect(sampleKartPose(createSnapshotBuffer(), 0, 11)).toBeNull();
    const tp = createSnapshotBuffer();
    tp.insert(snap(10, 0));
    tp.insert(snap(12, 50, 30, { flags: { teleport: true } }));
    expect(sampleKartPose(tp, 0, 11).x).toBe(50);
  });

  it('adaptive delay: 2 × interval + 2 × jitter + loss allowance + a frame, clamped 70..150, slewing 1 ms per 100 ms', () => {
    const d = createInterpDelay();
    expect(d.ms).toBe(100);
    d.update(100, { intervalMs: 33.3, jitterMs: 0, lossPct: 0 });
    expect(d.ms).toBe(99);
    expect(d.target).toBeCloseTo(2 * 33.3 + 1000 / 60, 6);
    for (let i = 0; i < 100; i++) d.update(100, { intervalMs: 33.3, jitterMs: 0 });
    expect(d.ms).toBeCloseTo(d.target, 6);
    for (let i = 0; i < 200; i++) d.update(100, { intervalMs: 66.7, jitterMs: 30, lossPct: 5 });
    expect(d.ms).toBe(INTERP_MAX_MS);
    for (let i = 0; i < 200; i++) d.update(100, { intervalMs: 10, jitterMs: 0 });
    expect(d.ms).toBe(INTERP_MIN_MS);
  });

  it('arrival stats: interval from the smallest tick gap, jitter from arrival spread, loss and bursts', () => {
    const a = createArrivalStats();
    let x = 0;
    for (let k = 2; k <= 400; k += 2) {
      if (k % 40 === 0 || k === 200 || k === 202) continue; // some loss + a burst of 3 (198→204)
      a.onSnapshot(k, k * TICK + 50 + ((x = (x * 7 + 3) % 11)));
    }
    expect(a.intervalMs).toBeCloseTo(2 * TICK, 6);
    expect(a.jitterMs).toBeGreaterThan(2);
    expect(a.jitterMs).toBeLessThan(10);
    expect(a.lossPct).toBeGreaterThan(1);
    a.onSnapshot(410, 410 * TICK + 50);
    expect(a.lastBurst).toBe(5); // 398 → 410: 400..408 missing
  });

  it('pose smoother: a target that pops (frozen → interpolated, a reshaped curve) is blended, smooth motion is not touched', () => {
    const s = createPoseSmoother();
    const pose = (x, vx = 30, extra = {}) => ({ x, y: 0, z: 0, heading: 0, vx, vz: 0, mode: 'interp', ...extra });
    // steady 30 m/s: drawn = target
    let x = 0;
    for (let i = 0; i < 10; i++) { x += 0.5; expect(s.step(pose(x), 1000 / 60).x).toBeCloseTo(x, 9); }
    expect(s.stats.pops).toBe(0);
    // the target jumps back 1 m (new data after an extrapolation): the drawn pose keeps going smoothly
    const before = s.step(pose(x + 0.5), 1000 / 60).x;
    const q = s.step(pose(x + 1 - 1), 1000 / 60);
    expect(Math.abs(q.x - (before + 0.5))).toBeLessThan(1e-6); // continued at 30 m/s, no pop
    expect(s.offset).toBeCloseTo(1, 6);
    expect(s.stats.pops).toBe(1);
    let t = x;
    for (let i = 0; i < 60; i++) { t += 0.5; s.step(pose(t), 1000 / 60); }
    expect(s.offset).toBeLessThan(0.01); // decays with τ = 100 ms
    const far = s.step(pose(t + 50), 1000 / 60);
    expect(far.x).toBeCloseTo(t + 50, 6); // > 8 m: snap
    const tp = s.step(pose(9), 1000 / 60, { teleport: true });
    expect(tp.x).toBe(9);
    expect(s.step(null, 16)).toBe(tp);
    // a heading pop is blended too
    s.step({ ...pose(9.5), heading: 1 }, 1000 / 60);
    expect(s.stats.snaps).toBe(2);
    s.reset();
    expect(s.offset).toBe(0);
  });
});

describe('event player', () => {
  const mine = new Set([2, 3]);
  const isMine = (k) => mine.has(k);

  it('knows which own-kart events are predicted locally (and always drops countdown/go)', () => {
    const P = (e) => isPredictedForMe(e, isMine);
    expect(P({ type: 'countdown', kart: 255 })).toBe(true);
    expect(P({ type: 'go', kart: 255 })).toBe(true);
    for (const type of ['hop', 'land', 'drift-start', 'drift-level', 'drift-boost']) expect(P({ type, kart: 2 }), type).toBe(true);
    expect(P({ type: 'hop', kart: 5 })).toBe(false);
    expect(P({ type: 'boost', kart: 2, source: 'pad' })).toBe(true);
    expect(P({ type: 'boost', kart: 2, source: 'other' })).toBe(false);
    expect(P({ type: 'bump', kart: 2, other: 255 })).toBe(true);
    expect(P({ type: 'bump', kart: 2, other: 3 })).toBe(true);
    expect(P({ type: 'bump', kart: 2, other: 6 })).toBe(false);
    expect(P({ type: 'item-use', kart: 3, item: 'bubble-shield' })).toBe(true);
    expect(P({ type: 'item-use', kart: 3, item: 'gumdrop' })).toBe(false);
    expect(P({ type: 'item-get', kart: 3, item: 'gumdrop' })).toBe(false);
  });

  it('applies each seq once, releases own events at once and world events when R reaches their tick, in seq order', () => {
    const out = [];
    const gaps = [];
    const p = createEventPlayer({ isMine, onEvent: (e) => out.push(e.seq), onGap: (a, b) => gaps.push([a, b]) });
    p.push([
      { seq: 1, tick: 100, type: 'item-box', kart: 5 },
      { seq: 2, tick: 101, type: 'item-get', kart: 2 },
      { seq: 3, tick: 101, type: 'hop', kart: 2 }, // predicted: dropped
      { seq: 4, tick: 104, type: 'bonked', kart: 6 },
    ]);
    p.push([{ seq: 2, tick: 101, type: 'item-get', kart: 2 }]); // duplicate
    expect(p.release(99)).toHaveLength(1);
    expect(out).toEqual([2]);
    p.release(100);
    expect(out).toEqual([2, 1]);
    p.release(103);
    expect(out).toEqual([2, 1]);
    p.release(104);
    expect(out).toEqual([2, 1, 4]);
    expect(p.stats).toMatchObject({ dup: 1, dropped: 1, gaps: 0 });
    expect(p.lastSeq).toBe(4);
    p.push([{ seq: 7, tick: 110, type: 'lap', kart: 5 }]);
    expect(gaps).toEqual([[5, 7]]);
    expect(p.pending).toBe(1);
    p.resetTo(20);
    expect(p.pending).toBe(0);
    p.push([{ seq: 20, tick: 1, type: 'lap', kart: 5 }]);
    expect(p.stats.dup).toBe(2);
  });

  it('releases events older than R − 1 s at once (never stuck behind a late ctrl packet)', () => {
    const out = [];
    const p = createEventPlayer({ isMine, onEvent: (e) => out.push(e) });
    p.push([{ seq: 1, tick: 100, type: 'lap', kart: 5 }, { seq: 2, tick: 101, type: 'bonked', kart: 6 }]);
    p.release(100 + 61);
    expect(out.map((e) => e.seq)).toEqual([1, 2]);
  });
});
