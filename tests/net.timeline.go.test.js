// The GO / rocket-start contract (NETWORKING.md §9.1, acceptance M1-9 / WS5 #4): the countdown a guest sees
// runs on its prediction timeline P, its inputs are stamped with P ticks, so a press on the guest's visible
// GO lands on host tick goTick and earns the rocket start at any RTT; a press one frame before the start
// window does not; GO on P lands on host goTick ± 1.
import { describe, it, expect } from 'vitest';
import { runNetRace } from './helpers/netHarness.js';
import { makeCountdown } from './helpers/netSim.js';
import { TUNING as T } from '../src/race/tuning.js';

const cd = makeCountdown(3);
/** First race tick whose countdown is inside the rocket-start window. */
let windowTick = 1;
while (cd.after(windowTick) > T.startBoostWindow) windowTick++;

function startRun({ rttMs, jitterMs = 0, pressTick }) {
  let guestGoTick = null;
  const r = runNetRace({
    houses: [[1]], laps: 1, seed: 21, conditions: { latencyMs: rttMs / 2, jitterMs },
    script: ({ tick }) => ({ accel: pressTick !== null && tick >= pressTick ? 1 : 0 }),
    hostOverride: () => ({ steer: 0, accel: 0, brake: 0, drift: false }),
    stopWhen: ({ driver }) => driver.tick > cd.goTick + 40,
    onGuestFrame: ({ g }) => {
      if (guestGoTick === null) {
        const go = g.events.find((x) => x.e.type === 'go');
        if (go) guestGoTick = go.tick;
      }
    },
  });
  const guestKart = r.host.houseKarts[0][0];
  const startBoost = r.host.events.some((x) => x.e.type === 'boost' && x.e.source === 'start' && x.e.kart?.id === guestKart);
  return { r, startBoost, guestGoTick, goTick: r.host.goTick, guestKart };
}

describe('GO on the guest prediction timeline', () => {
  for (const rttMs of [0, 50, 150, 250]) {
    it(`RTT ${rttMs} ms: a press on the visible GO earns the rocket start; GO on P = host goTick`, () => {
      const onGo = startRun({ rttMs, pressTick: cd.goTick });
      expect(onGo.startBoost).toBe(true);
      expect(Math.abs(onGo.guestGoTick - onGo.goTick)).toBeLessThanOrEqual(1);
      // the guest's countdown numbers came from P too (predicted) and the host copies were dropped
      const g = onGo.r.guests[0];
      const countdowns = g.events.filter((x) => x.e.type === 'countdown');
      expect(countdowns.map((x) => x.e.n)).toEqual([3, 2, 1]);
      expect(countdowns.every((x) => x.e.predicted === true)).toBe(true);
      expect(g.events.filter((x) => x.e.type === 'go')).toHaveLength(1);
      // the guest predicted its own rocket start (and did not get the host's copy on top)
      const boosts = g.events.filter((x) => x.e.type === 'boost' && x.e.source === 'start' && x.e.kart?.id === onGo.guestKart);
      expect(boosts).toHaveLength(1);
      expect(boosts[0].e.predicted).toBe(true);
    });

    it(`RTT ${rttMs} ms: a press when the window opens earns it, one frame before the window does not`, () => {
      expect(startRun({ rttMs, pressTick: windowTick }).startBoost).toBe(true);
      const early = startRun({ rttMs, pressTick: windowTick - 1 });
      expect(early.startBoost).toBe(false);
      expect(early.r.guests[0].events.some((x) => x.e.type === 'boost' && x.e.source === 'start' && x.e.kart?.id === early.guestKart)).toBe(false);
    });
  }

  it('with 20 ms jitter at 150 ms the press on GO still lands on time', () => {
    const run = startRun({ rttMs: 150, jitterMs: 20, pressTick: cd.goTick });
    expect(run.startBoost).toBe(true);
  });

  it('no press at all: no rocket start anywhere', () => {
    const run = startRun({ rttMs: 50, pressTick: null });
    expect(run.startBoost).toBe(false);
  });
});
