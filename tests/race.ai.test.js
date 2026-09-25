import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/data/characters.js', async () => (await import('./raceHelpers.js')).characterMock());

import { aiDriveInput } from '../src/race/Race.js';
import { computeRacingLine, racingLineAt, turnAhead, CpuBrain } from '../src/race/AI.js';
import { wrapAngle } from '../src/race/Kart.js';
import {
  makeRace, makeStadiumPath, humanParticipants, cpuParticipants, skipCountdown, placeKart, input, runRace,
} from './raceHelpers.js';

describe('racing line', () => {
  it('hugs the inside of bends and stays on the road', () => {
    const path = makeStadiumPath();
    const line = computeRacingLine(path);
    let maxAbs = 0;
    let insideCount = 0;
    let bendCount = 0;
    for (let s = 0; s < path.length; s += 5) {
      const lat = racingLineAt(line, s);
      maxAbs = Math.max(maxAbs, Math.abs(lat));
      const bend = turnAhead(path, s - 5, 25);
      if (Math.abs(bend) > 0.4) {
        bendCount++;
        // right turn (bend < 0) => inside is +lateral
        if (Math.sign(lat) === -Math.sign(bend)) insideCount++;
      }
    }
    expect(maxAbs).toBeLessThanOrEqual(path.halfWidth * 0.6 + 1e-6);
    expect(maxAbs).toBeGreaterThan(2);
    expect(bendCount).toBeGreaterThan(10);
    expect(insideCount / bendCount).toBeGreaterThan(0.8);
  });
});

describe('CPU brain', () => {
  it('aiDriveInput returns a valid DriveInput and can drive a human kart round a whole race', async () => {
    const race = await makeRace({ participants: humanParticipants(2), laps: 1 });
    const frames = runRace(race, {
      maxSeconds: 120,
      inputs: (r) => {
        const out = [];
        for (const k of r.karts) {
          const inp = aiDriveInput(r, k);
          for (const key of ['steer', 'accel', 'brake']) expect(Number.isFinite(inp[key])).toBe(true);
          expect(inp.steer).toBeGreaterThanOrEqual(-1);
          expect(inp.steer).toBeLessThanOrEqual(1);
          expect(typeof inp.drift).toBe('boolean');
          expect(typeof inp.useItem).toBe('boolean');
          out[k.playerIndex] = inp;
        }
        return out;
      },
    });
    expect(race.state).toBe('finished');
    for (const k of race.karts) expect(k.finishEstimated).toBeFalsy();
    expect(frames / 60).toBeLessThan(90);
  });

  it('rubber-bands gently: slows down when far ahead of the humans, speeds up when far behind', async () => {
    const race = await makeRace({ participants: [...humanParticipants(1), ...cpuParticipants(3).slice(1)] });
    skipCountdown(race);
    const [human, cpuA, cpuB] = race.karts;
    placeKart(race, human, 200, 0);
    placeKart(race, cpuA, 450, 0); // way ahead
    placeKart(race, cpuB, 20, 0); // way behind
    const ahead = race.brains.get(cpuA).rubberBand(race);
    const behind = race.brains.get(cpuB).rubberBand(race);
    expect(ahead).toBeLessThan(race.brains.get(cpuA).baseMult);
    expect(behind).toBeGreaterThan(race.brains.get(cpuB).baseMult);
    expect(ahead).toBeGreaterThan(0.7); // gentle
    expect(behind).toBeLessThan(1.15);
  });

  it('skill varies by speed class', async () => {
    const cozy = await makeRace({ speedClass: 'cozy' });
    const zoomy = await makeRace({ speedClass: 'zoomy' });
    const avg = (race) => [...race.brains.values()].reduce((a, b) => a + b.skill, 0) / race.brains.size;
    expect(avg(zoomy)).toBeGreaterThan(avg(cozy) + 0.2);
    const skills = [...zoomy.brains.values()].map((b) => b.skill);
    expect(Math.max(...skills) - Math.min(...skills)).toBeGreaterThan(0.02); // varied per driver
  });

  it('recovers when pointed at the wall or the wrong way', async () => {
    for (const offset of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const race = await makeRace({ participants: cpuParticipants(1), path: makeStadiumPath() });
      skipCountdown(race);
      const k = race.karts[0];
      placeKart(race, k, 60, offset === Math.PI ? 0 : Math.sign(offset) * -8, 0, offset);
      const d0 = k.distance;
      for (let i = 0; i < 60 * 8; i++) race.update(1 / 60, []);
      expect(k.distance - d0).toBeGreaterThan(60);
      expect(Math.abs(wrapAngle(k.heading - race.path.headingAt(k.s)))).toBeLessThan(0.8);
    }
  });

  it('skilled CPUs usually steer around gumdrops in their lane', async () => {
    let dodged = 0;
    const trials = 8;
    // trial -1 is a control: the CPU decides never to dodge, so it must get bonked
    for (let t = -1; t < trials; t++) {
      const race = await makeRace({
        participants: [...cpuParticipants(1), ...humanParticipants(1).map((p) => ({ ...p, characterId: 'lenny' }))],
        path: makeStadiumPath(), builtTrack: { itemBoxSlots: [], boostPads: [] }, seed: 100 + t,
      });
      skipCountdown(race);
      const [cpu, human] = race.karts;
      race.brains.get(cpu).skill = 1;
      if (t < 0) race.brains.get(cpu).rng = () => 0.999;
      placeKart(race, cpu, 10, 0, 25);
      race.update(1 / 60, []);
      // drop a gumdrop right on the CPU's current line, 30 units ahead
      placeKart(race, human, cpu.s + 32.6, cpu.lateral, 0);
      race.items.dropGumdrop(human);
      placeKart(race, human, cpu.s + 300, 0, 0);
      for (let i = 0; i < 120; i++) race.update(1 / 60, []);
      const bonked = race.__events.some((e) => e.type === 'bonked' && e.kart === cpu);
      if (t < 0) expect(bonked).toBe(true);
      else if (!bonked) dodged++;
    }
    expect(dodged).toBeGreaterThanOrEqual(5);
  });

  it('CPU drivers use every kind of item at sensible moments', async () => {
    const race = await makeRace({ participants: [...humanParticipants(1), ...cpuParticipants(4).slice(1)], path: makeStadiumPath() });
    skipCountdown(race);
    const cpu = race.karts[1];
    const used = new Set();
    for (const item of ['sprinkle-boost', 'gumdrop', 'bubble-shield', 'cupcake-rocket', 'rainbow-star', 'triple-sprinkle']) {
      cpu.item = item;
      cpu.itemCharges = item === 'triple-sprinkle' ? 3 : 1;
      for (let i = 0; i < 60 * 12 && cpu.item === item; i++) race.update(1 / 60, []);
      if (cpu.item !== item || cpu.itemCharges < (item === 'triple-sprinkle' ? 3 : 1)) used.add(item);
    }
    expect(used.size).toBe(6);
  });

  it('a CPU brain can be created standalone for any kart', async () => {
    const race = await makeRace({ participants: humanParticipants(1) });
    const brain = new CpuBrain(race.karts[0], { skill: 0.5, rng: () => 0.5 });
    const inp = brain.think(race, 1 / 60);
    expect(inp).toMatchObject({ steer: 0, brake: 0, drift: false, useItem: false });
  });
});

describe('easyDrive', () => {
  it('auto-accelerates and steers itself round a lap with no input', async () => {
    const race = await makeRace({ participants: humanParticipants(1, { easyDrive: true }), laps: 1 });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    let offRoad = 0;
    let frames = 0;
    while (!k.finished && frames < 60 * 90) {
      race.update(1 / 60, [input()]);
      if (k.offRoad) offRoad++;
      frames++;
    }
    expect(k.finished).toBe(true);
    expect(offRoad / frames).toBeLessThan(0.05);
  });

  it('still lets the player steer and brake', async () => {
    const race = await makeRace({ participants: humanParticipants(1, { easyDrive: true }), path: makeStadiumPath() });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 20);
    for (let i = 0; i < 30; i++) race.update(1 / 60, [input({ steer: 1 })]);
    expect(k.lateral).toBeGreaterThan(1.5);
    for (let i = 0; i < 120; i++) race.update(1 / 60, [input({ brake: 1 })]);
    expect(k.speed).toBeLessThan(1);
  });
});
