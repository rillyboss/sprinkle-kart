/**
 * A race can never go on forever: if the only human stops pressing the gas
 * (a little one wandered off), once every CPU is home the racers cheer
 * "Keep going, you can do it!" and the race wraps up CPUS_DONE_GRACE seconds
 * later with estimated places (src/race/Race.js _checkComplete).
 */
import { describe, it, expect } from 'vitest';
import { runCpuRace } from './helpers/raceHarness.js';
import { CPUS_DONE_GRACE, FINISH_GRACE, aiDriveInput } from '../src/race/Race.js';
import { createFakeBus } from './helpers/fakeBus.js';
import raceFlow from '../src/systems/raceFlowReactions.js';

const idle = () => ({ accel: 0, brake: 0, steer: 0, drift: false, useItem: false });

describe('the only human never finishes', () => {
  it('ends the race CPUS_DONE_GRACE seconds after the last CPU finishes, with the human placed last (estimated)', () => {
    const r = runCpuRace('gumdrop-meadow', { laps: 1, humans: 1, inputs: () => [idle()], maxSeconds: 600 });
    expect(r.finished).toBe(true);
    const keep = r.events.filter((e) => e.type === 'keep-going');
    expect(keep).toHaveLength(1); // cheered once, not every frame
    expect(keep[0].seconds).toBe(CPUS_DONE_GRACE);
    expect(keep[0].karts.map((k) => k.playerIndex)).toEqual([0]);
    const me = r.standings.find((s) => s.playerIndex === 0);
    expect(me.estimated).toBe(true);
    expect(me.place).toBe(8);
    expect(r.standings.filter((s) => s.isCPU).every((s) => !s.estimated)).toBe(true);
    // wrapped up right after the grace, not later
    const lastCpu = Math.max(...r.race.karts.filter((k) => k.isCPU).map((k) => k.finishTime));
    expect(r.race.allCpusDoneTime).toBeCloseTo(lastCpu, 0);
    expect(r.raceTime - r.race.allCpusDoneTime).toBeGreaterThanOrEqual(CPUS_DONE_GRACE - 0.05);
    expect(r.raceTime - r.race.allCpusDoneTime).toBeLessThan(CPUS_DONE_GRACE + 0.2);
    expect(r.events.filter((e) => e.type === 'race-complete')).toHaveLength(1);
  });

  it('a human who finishes normally never hears "keep going"', () => {
    const r = runCpuRace('gumdrop-meadow', { laps: 1, humans: 1, easyDrive: true, maxSeconds: 600 });
    expect(r.finished).toBe(true);
    const me = r.standings.find((s) => s.playerIndex === 0);
    if (me.place < 8) expect(r.eventCounts['keep-going'] ?? 0).toBe(0);
    expect(me.estimated).toBe(false);
  });

  it('with two humans where one finished, the usual FINISH_GRACE still decides first', () => {
    // P1 drives (autodrive through the human path), P2 sits still
    const r = runCpuRace('gumdrop-meadow', {
      laps: 1, humans: 2,
      inputs: (race) => {
        const p1 = race.karts.find((k) => k.playerIndex === 0);
        return [aiDriveInput(race, p1, race.lastDt), idle()];
      },
      maxSeconds: 900,
    });
    expect(r.finished).toBe(true);
    const p2 = r.standings.find((s) => s.playerIndex === 1);
    expect(p2.estimated).toBe(true);
    const bound = Math.min(
      r.race.firstHumanFinishTime !== null ? r.race.firstHumanFinishTime + FINISH_GRACE : Infinity,
      r.race.allCpusDoneTime !== null ? r.race.allCpusDoneTime + CPUS_DONE_GRACE : Infinity,
    );
    expect(Number.isFinite(bound)).toBe(true);
    expect(r.raceTime).toBeLessThan(bound + 0.2);
  });

  it('a solo run with no CPUs is not ended by the CPU rule', () => {
    const r = runCpuRace('gumdrop-meadow', { laps: 1, humans: 1, characters: ['rocco'], inputs: () => [idle()], maxSeconds: 120 });
    expect(r.eventCounts['keep-going'] ?? 0).toBe(0);
    expect(r.race.allCpusDoneTime).toBe(null);
  });
});

describe('race-flow reactions', () => {
  it('flashes a friendly "Keep going" to each human still driving', () => {
    const bus = createFakeBus();
    const flashes = [];
    const off = raceFlow.install(bus, {});
    const human = { playerIndex: 0, isCPU: false };
    const cpu = { playerIndex: null, isCPU: true };
    const session = { isHuman: (k) => !k.isCPU, flash: (k, text) => flashes.push([k, text]) };
    bus.emit('race:keep-going', { type: 'keep-going', karts: [human, cpu], seconds: CPUS_DONE_GRACE }, session);
    expect(flashes).toEqual([[human, 'Keep going, you can do it! 💪']]);
    bus.emit('race:keep-going', { type: 'keep-going' }, session); // no karts: nothing, no error
    expect(flashes).toHaveLength(1);
    expect(bus.errors).toEqual([]);
    off();
  });
});
