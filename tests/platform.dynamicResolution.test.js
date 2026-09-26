// Mobile platform: dynamic resolution controller (hysteresis, bounds, probe backoff) and the frame cap.
import { describe, it, expect } from 'vitest';
import { createDynamicResolution, createFrameCap } from '../src/platform/dynamicResolution.js';

/** Feed `seconds` worth of frames of `ms` each; returns how many changes happened. */
const feed = (dr, ms, seconds) => {
  let changes = 0;
  for (let t = 0; t < seconds * 1000; t += ms) if (dr.sample(ms)) changes++;
  return changes;
};

describe('createDynamicResolution', () => {
  it('starts at max and drops a step after sustained slow frames', () => {
    const dr = createDynamicResolution({ min: 0.5, max: 1, targetFps: 60 });
    expect(dr.scale).toBe(1);
    feed(dr, 16.7, 2);
    expect(dr.scale).toBe(1);
    feed(dr, 33, 1.2);
    expect(dr.scale).toBe(0.9);
  });
  it('never leaves [min, max]', () => {
    const dr = createDynamicResolution({ min: 0.6, max: 1, targetFps: 60 });
    feed(dr, 50, 30);
    expect(dr.scale).toBe(0.6);
    feed(dr, 8, 400);
    expect(dr.scale).toBe(1);
  });
  it('a dead band between on-budget and slow changes nothing (no breathing)', () => {
    const dr = createDynamicResolution({ min: 0.5, max: 1, targetFps: 60, start: 0.8 });
    const band = (1000 / 60) * 1.18;
    expect(feed(dr, band, 60)).toBe(0);
    expect(dr.scale).toBe(0.8);
  });
  it('goes up only in careful half steps after holding the budget', () => {
    const dr = createDynamicResolution({ min: 0.5, max: 1, targetFps: 60, start: 0.7, upAfter: 3 });
    feed(dr, 16.7, 2.5);
    expect(dr.scale).toBe(0.7);
    feed(dr, 16.7, 1);
    expect(dr.scale).toBe(0.75);
  });
  it('a probe up that turns slow doubles the wait before the next probe (no ping-pong)', () => {
    const dr = createDynamicResolution({ min: 0.5, max: 1, targetFps: 60, start: 0.7, upAfter: 3, maxUpAfter: 12 });
    feed(dr, 16.7, 3.2); // probe up to 0.75
    expect(dr.scale).toBe(0.75);
    feed(dr, 30, 2.5); // too slow at 0.75 → back down, wait longer
    expect(dr.scale).toBe(0.65);
    expect(dr.upWait).toBe(6);
    feed(dr, 16.7, 5);
    expect(dr.scale).toBe(0.65); // still waiting
    feed(dr, 16.7, 2.5);
    expect(dr.scale).toBe(0.7);
    feed(dr, 30, 2.5);
    expect(dr.upWait).toBe(12);
    feed(dr, 30, 2.5);
    expect(dr.upWait).toBe(12); // capped
  });
  it('ignores spikes (tab switch, GC) and junk', () => {
    const dr = createDynamicResolution({ min: 0.5, max: 1 });
    for (let i = 0; i < 50; i++) expect(dr.sample(900)).toBe(false);
    expect(dr.sample(NaN)).toBe(false);
    expect(dr.sample(-3)).toBe(false);
    expect(dr.scale).toBe(1);
  });
  it('min === max means off', () => {
    const dr = createDynamicResolution({ min: 1, max: 1 });
    expect(dr.enabled).toBe(false);
    expect(feed(dr, 100, 10)).toBe(0);
  });
  it('cooldown after a change, reset and a new target', () => {
    const dr = createDynamicResolution({ min: 0.5, max: 1, targetFps: 60, cooldown: 1 });
    feed(dr, 40, 0.6);
    expect(dr.scale).toBe(0.9);
    feed(dr, 40, 0.9); // inside the cooldown
    expect(dr.scale).toBe(0.9);
    expect(dr.changes).toBe(1);
    dr.reset();
    expect(dr.scale).toBe(1);
    dr.setTarget(30);
    expect(dr.budget).toBeCloseTo(33.33, 1);
    feed(dr, 33, 5);
    expect(dr.scale).toBe(1); // 30 fps is on target now
  });
  it('bad bounds are sorted out', () => {
    const dr = createDynamicResolution({ min: 0.9, max: 0.4 });
    expect(dr.min).toBe(0.4);
    expect(dr.max).toBe(0.4);
    expect(createDynamicResolution({ min: 0.01, max: 1 }).min).toBe(0.25);
  });
});

describe('createFrameCap', () => {
  const run = (cap, hz, seconds) => {
    let n = 0;
    const step = 1000 / hz;
    for (let t = 0; t < seconds * 1000; t += step) if (cap.shouldRender(t + (Math.sin(t) * 1.5))) n++;
    return n;
  };
  it('60 or more means no cap', () => {
    const cap = createFrameCap(60);
    expect(cap.fps).toBe(0);
    expect(run(cap, 120, 1)).toBe(120);
  });
  it('30 on a 60 Hz screen renders every other frame despite jitter', () => {
    expect(run(createFrameCap(30), 60, 2)).toBeGreaterThanOrEqual(59);
    expect(run(createFrameCap(30), 60, 2)).toBeLessThanOrEqual(61);
  });
  it('30 on a 120 Hz screen', () => {
    const n = run(createFrameCap(30), 120, 2);
    expect(n).toBeGreaterThanOrEqual(59);
    expect(n).toBeLessThanOrEqual(61);
  });
  it('can be changed and never falls far behind after a stall', () => {
    const cap = createFrameCap(60);
    cap.set(30);
    expect(cap.fps).toBeCloseTo(30);
    expect(cap.shouldRender(0)).toBe(true);
    expect(cap.shouldRender(5000)).toBe(true);
    expect(cap.shouldRender(5016)).toBe(false);
    expect(cap.shouldRender(5033)).toBe(true);
    cap.set(120);
    expect(cap.shouldRender(5034)).toBe(true);
  });
});
