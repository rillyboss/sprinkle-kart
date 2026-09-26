/**
 * HUD lanes (play-test finding): the drift "Mini-Turbo!" flash and an item
 * callout ("Gumdrop! Plop!") were drawn on top of each other, and a stack of
 * item callouts grew up over the race timer's LAP split. Now:
 *  - Hud.flash keeps at most MAX_FLASHES per player (the oldest retires early)
 *  - the item-callout stack only uses the room between the kart and the
 *    lowest of the timer zone / flash lane (fitCallouts + calloutCeiling)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installFakeDom, fakeElement } from './helpers/fakeDom.js';
import { fitCallouts, calloutCeiling, CALLOUT_GAP, CALLOUT_BOTTOM } from '../src/ui/widgets/itemWidgets.js';
import { Hud, MAX_FLASHES } from '../src/ui/Hud.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('fitCallouts', () => {
  it('everything shows when there is room', () => {
    expect(fitCallouts([40, 40], 200)).toEqual([false, false]);
  });
  it('older callouts that would poke over the timer hide; the newest always shows', () => {
    expect(fitCallouts([40, 40, 40], 100)).toEqual([true, false, false]); // 2 x (40 + gap) fit in 100
    expect(fitCallouts([40, 40], 30)).toEqual([true, false]); // no room at all: still the newest
  });
  it('the pinned rocket warning takes its space first', () => {
    expect(fitCallouts([40, 40], 100, 50)).toEqual([true, false]);
    expect(fitCallouts([40, 40], 100 + 2 * CALLOUT_GAP + 40, 50)).toEqual([false, false]);
  });
  it('empty input is fine', () => {
    expect(fitCallouts([], 100)).toEqual([]);
  });
});

describe('calloutCeiling', () => {
  const vp = ({ timerBottom = 0, flashes = [] } = {}) => ({
    querySelector: (sel) => {
      if (sel === '.sk-wzone-top-center') return timerBottom ? { offsetTop: 10, offsetHeight: timerBottom - 10 } : null;
      if (sel === '.sk-flashes') return { offsetTop: 100, children: flashes.map(([top, h]) => ({ offsetTop: top, offsetHeight: h })) };
      return null;
    },
  });
  it('is the bottom of the race timer when no flash shows', () => {
    expect(calloutCeiling(vp({ timerBottom: 80 }))).toBe(80);
  });
  it('is the bottom of the flash lane while a Mini-Turbo / Lap flash shows', () => {
    expect(calloutCeiling(vp({ timerBottom: 80, flashes: [[0, 40], [30, 40]] }))).toBe(170);
  });
  it('is safe without a viewport', () => {
    expect(calloutCeiling(null)).toBe(0);
    expect(calloutCeiling({})).toBe(0);
  });
  it('a 4-player viewport (360 px) still leaves room for one callout under the timer', () => {
    const room = CALLOUT_BOTTOM * 360 - calloutCeiling(vp({ timerBottom: 70 })) - CALLOUT_GAP;
    expect(room).toBeGreaterThan(40);
  });
});

describe('Hud.flash', () => {
  it(`keeps at most ${MAX_FLASHES} flashes per player and re-stacks them from the top`, () => {
    vi.useFakeTimers();
    installFakeDom();
    const box = fakeElement('div');
    const hud = { vps: new Map([[0, { refs: { flashes: box } }]]) };
    for (const t of ['Mini-Turbo! 💙', 'Lap 2! 🍭', 'Super Turbo! 🧡']) Hud.prototype.flash.call(hud, 0, t);
    expect(box.childElementCount).toBe(MAX_FLASHES);
    expect(box.children.map((c) => c.style.getPropertyValue('--k'))).toEqual([0, 1]);
    Hud.prototype.flash.call(hud, 3, 'nobody'); // no such viewport: ignored
    vi.advanceTimersByTime(1500);
    expect(box.childElementCount).toBe(0);
  });
});
