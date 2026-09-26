// Host event log (NETWORKING.md §6.3, §9.7): seq/tick stamping, kart ids, catalogue payloads, last 512,
// drain per snapshot interval, synthetic estimated finishes on race-complete.
import { describe, it, expect } from 'vitest';
import { createEventLog, REPLICATED_EVENT_TYPES, NO_KART, seqAfter, EVENT_LOG_CAPACITY } from '../src/net/host/eventLog.js';
import { encodeEvents, decode, EV } from './helpers/netWire.js';

const kart = (id, extra = {}) => ({ id, lapTimes: [], finishTime: null, finishEstimated: false, finished: false, ...extra });

describe('event log', () => {
  it('stamps seq (monotonic from 1) and tick, maps kart objects to ids, drains per interval', () => {
    const log = createEventLog();
    const a = kart(2);
    const b = kart(5);
    log.push(10, { type: 'bump', kart: a, other: b, strength: 0.4 });
    log.push(10, { type: 'bump', kart: a, wall: true, strength: 2 });
    let d = log.drain();
    expect(d).toEqual([
      { seq: 1, tick: 10, type: 'bump', kart: 2, other: 5, strength: 0.4 },
      { seq: 2, tick: 10, type: 'bump', kart: 2, other: NO_KART, strength: 1 },
    ]);
    expect(log.drain()).toEqual([]);
    log.push(12, { type: 'hop', kart: a });
    d = log.drain();
    expect(d.map((e) => [e.seq, e.tick, e.type])).toEqual([[3, 12, 'hop']]);
    expect(log.lastSeq).toBe(3);
  });

  it('builds every catalogue payload with ids and ms timings', () => {
    const log = createEventLog();
    const k = kart(1, { lapTimes: [41.2345], finishTime: 83.0006 });
    const other = kart(3);
    const cases = [
      [{ type: 'countdown', n: 2 }, { n: 2 }],
      [{ type: 'go' }, {}],
      [{ type: 'boost', kart: k, source: 'pad' }, { source: 'pad' }],
      [{ type: 'boost', kart: k, source: 'weird' }, { source: 'other' }],
      [{ type: 'hop', kart: k }, {}],
      [{ type: 'land', kart: k, strength: 0.4 }, {}],
      [{ type: 'bump', kart: k, other, strength: 0.25 }, { other: 3, strength: 0.25 }],
      [{ type: 'drift-start', kart: k, dir: -1 }, { dir: -1 }],
      [{ type: 'drift-level', kart: k, level: 2 }, { level: 2 }],
      [{ type: 'drift-boost', kart: k, level: 3 }, { level: 3 }],
      [{ type: 'item-box', kart: k, rolling: true }, { boxIndex: NO_KART, rolling: true }],
      [{ type: 'item-box', kart: k, boxIndex: 7, rolling: false }, { boxIndex: 7, rolling: false }],
      [{ type: 'item-get', kart: k, item: 'gumdrop' }, { item: 'gumdrop' }],
      [{ type: 'item-use', kart: k, item: 'triple-sprinkle', chargesLeft: 2 }, { item: 'triple-sprinkle', chargesLeft: 2 }],
      [{ type: 'rocket-launch', kart: k, target: other }, { rocketId: 0, target: 3 }],
      [{ type: 'rocket-launch', kart: k, target: null, rocketId: 9 }, { rocketId: 9, target: NO_KART }],
      [{ type: 'bonked', kart: k, cause: 'gumdrop', by: other }, { cause: 'gumdrop', by: 3 }],
      [{ type: 'shield-pop', kart: k, expired: true }, { cause: 'expired', by: NO_KART, expired: true }],
      [{ type: 'item-dodged', kart: k, item: 'gumdrop', by: other }, { item: 'gumdrop', by: 3 }],
      [{ type: 'item-end', kart: k, item: 'rainbow-star' }, { item: 'rainbow-star' }],
      [{ type: 'lap', kart: k, lap: 2 }, { lap: 2, lapTimeMs: 41235 }],
      [{ type: 'final-lap', kart: k }, {}],
      [{ type: 'finish', kart: k, place: 1 }, { place: 1, finishTimeMs: 83001, estimated: false }],
      [{ type: 'gumdrop-spawn', id: 4, x: 1, y: 2, z: 3, color: 2 }, { id: 4, x: 1, y: 2, z: 3, color: 2 }],
      [{ type: 'gumdrop-despawn', id: 4, why: 'bonked' }, { id: 4, why: 'bonked' }],
      [{ type: 'rocket-despawn', id: 9 }, { id: 9, why: 'gone' }],
      [{ type: 'box-respawn', boxIndex: 3 }, { boxIndex: 3 }],
      [{ type: 'battle-pop', kart: k, by: other, bubblesLeft: 1 }, { by: 3, bubblesLeft: 1 }],
      [{ type: 'battle-out', kart: k }, {}],
      [{ type: 'battle-bonus', kart: k }, {}],
      [{ type: 'robo', kart: 1, on: true }, { on: true }],
      [{ type: 'race-complete', standings: [] }, {}],
    ];
    for (const [ev, payload] of cases) {
      const [entry] = log.push(5, ev);
      const { seq, tick, type, kart: kk, ...rest } = entry;
      expect(rest, ev.type).toEqual(payload);
      expect(type).toBe(ev.type);
    }
    // every catalogue type is exercised above
    const seen = new Set(cases.map(([e]) => e.type));
    for (const t of REPLICATED_EVENT_TYPES) expect(seen.has(t), t).toBe(true);
  });

  it('does not replicate events outside the catalogue', () => {
    const log = createEventLog();
    expect(log.push(1, { type: 'keep-going', karts: [] })).toEqual([]);
    expect(log.push(1, null)).toEqual([]);
    expect(log.stats.skipped).toBe(2);
    expect(log.lastSeq).toBe(0);
  });

  it('appends a synthetic estimated finish for every kart placed by estimate on race-complete', () => {
    const log = createEventLog();
    const a = kart(0, { finished: true, finishPlace: 1, finishTime: 50 });
    const b = kart(1, { finished: true, finishPlace: 2, finishTime: 61.5, finishEstimated: true });
    const c = kart(2, { finished: true, finishPlace: 3, finishTime: 70.25, finishEstimated: true });
    log.push(100, { type: 'finish', kart: a, place: 1 });
    const out = log.push(200, { type: 'race-complete', standings: [a, b, c] });
    expect(out.map((e) => [e.type, e.kart, e.place, e.finishTimeMs, e.estimated])).toEqual([
      ['finish', 1, 2, 61500, true],
      ['finish', 2, 3, 70250, true],
      ['race-complete', NO_KART, undefined, undefined, undefined],
    ]);
    expect(log.stats.synthetic).toBe(2);
  });

  it('keeps only the last 512 entries; since(seq) returns the kept tail', () => {
    const log = createEventLog();
    for (let i = 0; i < 600; i++) log.push(i, { type: 'hop', kart: kart(0) });
    expect(log.size).toBe(EVENT_LOG_CAPACITY);
    expect(log.entries()[0].seq).toBe(89);
    expect(log.since(595).map((e) => e.seq)).toEqual([596, 597, 598, 599, 600]);
    expect(log.drain().length).toBe(512);
  });

  it('host notes (robo) go through the same log', () => {
    const log = createEventLog();
    log.note(7, 'robo', 3, { on: true });
    expect(log.drain()).toEqual([{ seq: 1, tick: 7, type: 'robo', kart: 3, on: true }]);
  });

  it('u32 sequence comparison wraps', () => {
    expect(seqAfter(2, 1)).toBe(true);
    expect(seqAfter(1, 1)).toBe(false);
    expect(seqAfter(0, 0xffffffff)).toBe(true);
    expect(seqAfter(0xffffffff, 0)).toBe(false);
    const log = createEventLog({ firstSeq: 0xfffffffe });
    for (let i = 0; i < 4; i++) log.push(i, { type: 'go' });
    expect(log.drain().map((e) => e.seq)).toEqual([0xfffffffe, 0xffffffff, 0, 1]);
    expect(log.since(0xffffffff).map((e) => e.seq)).toEqual([0, 1]);
  });

  it('round-trips through the EVENTS codec (stand-in) with ~4 B per event', () => {
    const log = createEventLog();
    const k = kart(4, { lapTimes: [30.5] });
    log.push(40, { type: 'lap', kart: k, lap: 2 });
    log.push(40, { type: 'bump', kart: k, other: kart(1), strength: 0.5 });
    log.push(41, { type: 'hop', kart: k });
    const entries = log.drain();
    const bytes = encodeEvents(entries);
    expect(bytes.length).toBe(10 + (3 + 5) + (3 + 2) + 3);
    const m = decode(bytes);
    expect(m.type).toBe(0x2c);
    expect(m.events.map((e) => [e.seq, e.tick, e.type, e.kart])).toEqual(entries.map((e) => [e.seq, e.tick, e.type, e.kart]));
    expect(m.events[0].lapTimeMs).toBe(30500);
    expect(m.events[1].strength).toBeCloseTo(0.5, 2);
    expect(EV.robo).toBe(29);
  });
});
