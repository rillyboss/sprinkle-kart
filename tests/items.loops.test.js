/**
 * Continuous power-up sounds: roulette ticks that slow down, rocket beeps that
 * speed up (+ the rising whistle), the star tune, shield shimmer and gumdrop hints.
 */
import { describe, it, expect } from 'vitest';
import itemLoops, { stepLoops, createLoopState, whistleParams, STAR_BAR, SHIELD_HUM_EVERY, GUMDROP_HINT } from '../src/systems/itemLoops.js';
import { ROULETTE_TICKS, THREAT_RANGE } from '../src/ui/widgets/itemHudLogic.js';
import { TUNING } from '../src/race/tuning.js';
import { createEventBus } from '../src/game/events.js';

const DT = 1 / 60;
const mkKart = (extra = {}) => ({ playerIndex: 0, isCPU: false, heading: 0, position: { x: 0, y: 0, z: 0 }, distance: 1000, s: 100, lateral: 0, itemRoulette: 0, starPower: 0, shielded: false, finished: false, phys: {}, ...extra });
const mkRace = (extra = {}) => ({ state: 'racing', items: { rockets: [], gumdrops: [] }, ...extra });
const path = { delta: (a, b) => b - a };

function run(st, kart, race, seconds, opts = {}) {
  const log = [];
  const whistles = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    opts.before?.(i * DT, kart, race);
    stepLoops(st, kart, race, DT, { play: (name, o) => log.push({ name, o, t: i * DT }), whistle: (th) => whistles.push(th), path, ...opts });
  }
  return { log, whistles };
}

describe('roulette ticks', () => {
  it('play ROULETTE_TICKS ticks across one spin, slowing down', () => {
    const k = mkKart({ itemRoulette: 1 });
    const st = createLoopState();
    const { log } = run(st, k, mkRace(), TUNING.rouletteDuration, {
      before: (t, kart) => { kart.itemRoulette = Math.max(1e-6, 1 - t / TUNING.rouletteDuration); },
    });
    const ticks = log.filter((l) => l.name === 'item-roulette');
    expect(ticks.length).toBeGreaterThanOrEqual(ROULETTE_TICKS - 1);
    expect(ticks.length).toBeLessThanOrEqual(ROULETTE_TICKS);
    const gaps = ticks.slice(1).map((x, i) => x.t - ticks[i].t);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0] * 2);
    // tick pitch rises a little as it lands
    expect(ticks[ticks.length - 1].o.level).toBeGreaterThan(ticks[0].o.level);
  });

  it('no ticks without a roulette', () => {
    const { log } = run(createLoopState(), mkKart(), mkRace(), 1);
    expect(log).toEqual([]);
  });
});

describe('rocket warning', () => {
  const beepsFor = (gap) => {
    const k = mkKart();
    const rocket = { target: k, distance: k.distance - gap, mesh: { position: { x: 0, y: 0, z: -gap } } };
    const { log, whistles } = run(createLoopState(), k, mkRace({ items: { rockets: [rocket], gumdrops: [] } }), 3);
    return { beeps: log.filter((l) => l.name === 'item-threat-beep'), whistles };
  };

  it('beeps only for the target, faster when the rocket is closer', () => {
    const far = beepsFor(THREAT_RANGE - 10).beeps.length;
    const mid = beepsFor(THREAT_RANGE / 2).beeps.length;
    const near = beepsFor(10).beeps.length;
    expect(far).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(mid * 1.5);
    const other = mkKart({ playerIndex: 1 });
    const rocket = { target: mkKart(), distance: 990 };
    expect(run(createLoopState(), other, mkRace({ items: { rockets: [rocket] } }), 2).log).toEqual([]);
  });

  it('beeps are louder/brighter when close and pan toward the rocket', () => {
    const k = mkKart();
    const rocket = { target: k, distance: k.distance - 20, mesh: { position: { x: -30, y: 0, z: -5 } } }; // behind-right
    const { log } = run(createLoopState(), k, mkRace({ items: { rockets: [rocket] } }), 1);
    const beep = log.find((l) => l.name === 'item-threat-beep');
    expect(beep.o.level).toBeGreaterThan(0.8);
    expect(beep.o.pan).toBeGreaterThan(0.3);
  });

  it('the whistle follows the threat and goes quiet without one', () => {
    const { whistles } = beepsFor(40);
    expect(whistles.every((w) => w && w.gap === 40)).toBe(true);
    const k = mkKart();
    const { whistles: none } = run(createLoopState(), k, mkRace(), 0.2);
    expect(none.every((w) => w === null)).toBe(true);
    const lo = whistleParams(0);
    const hi = whistleParams(1);
    expect(hi.freq).toBeGreaterThan(lo.freq);
    expect(hi.gain).toBeGreaterThan(lo.gain);
    expect(hi.gain).toBeLessThan(0.1); // never harsh
    expect(whistleParams(NaN)).toEqual(lo);
  });

  it('everything stops when you finish', () => {
    const k = mkKart({ finished: true, itemRoulette: 0.5, starPower: 3 });
    const rocket = { target: k, distance: 990 };
    const { log, whistles } = run(createLoopState(), k, mkRace({ items: { rockets: [rocket] } }), 1);
    expect(log).toEqual([]);
    expect(whistles.every((w) => w === null)).toBe(true);
  });
});

describe('star tune, shield shimmer, gumdrop hint', () => {
  it('the star tune plays bar after bar while invincible, numbered for the melody', () => {
    const k = mkKart({ starPower: TUNING.starDuration });
    const { log } = run(createLoopState(), k, mkRace(), STAR_BAR * 6.5, { before: (t, kart) => { kart.starPower = TUNING.starDuration - t; } });
    const bars = log.filter((l) => l.name === 'item-star-loop');
    expect(bars.length).toBeGreaterThanOrEqual(6);
    expect(bars.length).toBeLessThanOrEqual(7);
    expect(bars.map((b) => b.o.n)).toEqual(bars.map((_, i) => i));
    expect(bars[0].t).toBeLessThan(0.05); // starts right away
  });

  it('the star tune stops when the star ends', () => {
    const k = mkKart({ starPower: 0.2 });
    const { log } = run(createLoopState(), k, mkRace(), 2, { before: (t, kart) => { kart.starPower = Math.max(0, 0.2 - t); } });
    expect(log.filter((l) => l.name === 'item-star-loop').length).toBe(1);
  });

  it('a soft shimmer every few seconds while shielded', () => {
    const k = mkKart({ shielded: true });
    const { log } = run(createLoopState(), k, mkRace(), SHIELD_HUM_EVERY * 3 + 0.1);
    expect(log.filter((l) => l.name === 'item-shield-hum')).toHaveLength(3);
  });

  it('a gumdrop on your line ahead gives ONE warning boing', () => {
    const k = mkKart({ s: 100, lateral: 1 });
    const mine = { owner: k, s: 125, lateral: 1 };
    const theirs = { owner: {}, s: 125, lateral: 2 };
    const offLine = { owner: {}, s: 125, lateral: 1 + GUMDROP_HINT.lateral + 1 };
    const tooFar = { owner: {}, s: 100 + GUMDROP_HINT.max + 10, lateral: 1 };
    const { log } = run(createLoopState(), k, mkRace({ items: { rockets: [], gumdrops: [mine, theirs, offLine, tooFar] } }), 1);
    expect(log.filter((l) => l.name === 'item-gumdrop-wobble')).toHaveLength(1);
  });
});

describe('item-loops system', () => {
  it('drives the loops from race-frame through session.sfx, and is silent while paused', () => {
    const bus = createEventBus({ onError: (e) => { throw e; } });
    const off = itemLoops.install(bus, {});
    const k = mkKart({ starPower: 5 });
    const log = [];
    let paused = false;
    const s = {
      humans: [{ playerIndex: 0 }],
      race: { ...mkRace(), getPlayerKart: () => k, path },
      sfx: (name) => log.push(name),
      panFor: () => 0,
      get paused() { return paused; },
      resultsShown: false,
    };
    bus.emit('race-start', {}, s);
    bus.emit('race-frame', DT, s);
    expect(log).toContain('item-star-loop');
    log.length = 0;
    paused = true;
    for (let i = 0; i < 120; i++) bus.emit('race-frame', DT, s);
    expect(log).toEqual([]);
    bus.emit('race-exit', {}, s);
    off();
  });
});
