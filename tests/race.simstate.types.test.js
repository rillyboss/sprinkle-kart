// P0 contract (NETWORKING.md §8.4 / §16.0): the SimState shape shared by the sim-core and wire workstreams.
import { describe, it, expect } from 'vitest';
import {
  SIM_STATE_SHAPE, RACE_STATES, checkSimStateShape, makeSimStateFixture,
} from '../src/race/simState.types.js';
import { createKart } from '../src/race/Kart.js';
import { createBattle } from '../src/modes/battle.js';
import { TUNING } from '../src/race/tuning.js';

const clone = (o) => structuredClone(o);

describe('makeSimStateFixture', () => {
  it('is valid for the default and every option combination', () => {
    for (const karts of [1, 2, 8]) {
      for (const battle of [false, true]) {
        for (const state of RACE_STATES) {
          const s = makeSimStateFixture({ karts, gumdrops: 24, rockets: 8, battle, state });
          expect(checkSimStateShape(s), `${karts} ${battle} ${state}`).toEqual([]);
        }
      }
    }
  });

  it('is deterministic per seed and differs between seeds', () => {
    expect(makeSimStateFixture({ seed: 7 })).toEqual(makeSimStateFixture({ seed: 7 }));
    expect(makeSimStateFixture({ seed: 7 })).not.toEqual(makeSimStateFixture({ seed: 8 }));
  });

  it('is plain data (structuredClone round-trips it exactly)', () => {
    const s = makeSimStateFixture({ gumdrops: 3, rockets: 2, battle: true });
    expect(clone(s)).toEqual(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('carries the requested entity counts with unique ids and the next id after them', () => {
    const s = makeSimStateFixture({ gumdrops: 24, rockets: 8 });
    expect(s.gumdrops).toHaveLength(24);
    expect(s.rockets).toHaveLength(8);
    const ids = [...s.gumdrops, ...s.rockets].map((e) => e.id);
    expect(new Set(ids).size).toBe(32);
    expect(s.nextEntityId).toBe(Math.max(...ids) + 1);
  });

  it('includes a shield longer than 7.97 s so codecs must not saturate it (review finding 7)', () => {
    const s = makeSimStateFixture();
    const maxShield = Math.max(...s.karts.map((k) => k.phys.shieldTime));
    expect(maxShield).toBeGreaterThan(7.97);
    expect(maxShield).toBeLessThanOrEqual(TUNING.shieldDuration);
  });

  it('kart ids equal their index and grid slots are a permutation', () => {
    const s = makeSimStateFixture({ karts: 8 });
    s.karts.forEach((k, i) => expect(k.id).toBe(i));
    expect(s.karts.map((k) => k.gridSlot).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('checkSimStateShape', () => {
  const base = () => makeSimStateFixture({ gumdrops: 2, rockets: 1, battle: true });

  it('reports a missing field with its path', () => {
    const s = base();
    delete s.karts[3].phys.shieldTime;
    expect(checkSimStateShape(s)).toEqual(['state.karts[3].phys.shieldTime: missing']);
  });

  it('reports unknown fields (so private additions cannot sneak onto the wire)', () => {
    const s = base();
    s.karts[0].secretSauce = 1;
    expect(checkSimStateShape(s)).toEqual(['state.karts[0].secretSauce: unknown field']);
  });

  it('rejects kart object references where kart ids belong', () => {
    const s = base();
    s.starOn = [s.karts[1]];
    expect(checkSimStateShape(s)).toContain('state.starOn: expected an array of kart ids');
  });

  it('rejects out-of-range kart ids and duplicate entity ids', () => {
    const s = base();
    s.gumdrops[0].near = [99];
    s.rockets[0].id = s.gumdrops[1].id;
    const problems = checkSimStateShape(s);
    expect(problems).toContain('state.gumdrops[0].near: expected an array of kart ids');
    expect(problems).toContain('state: gumdrop and rocket entity ids must be unique together');
  });

  it('rejects NaN / Infinity, bad race states, wrong kart order and non-null where null is not allowed', () => {
    const s = base();
    s.karts[0].speed = NaN;
    s.state = 'paused';
    s.karts[2].id = 5;
    s.rng = null;
    const problems = checkSimStateShape(s);
    expect(problems).toContain('state.karts[0].speed: expected a finite number');
    expect(problems).toContain('state.state: expected one of countdown/racing/finished');
    expect(problems).toContain('state.karts[2].id: must equal its index (2)');
    expect(problems).toContain('state.rng: must not be null');
  });

  it('checks box arrays and battle racers', () => {
    const s = base();
    s.boxes.respawn.pop();
    s.battle.racers[0].bubbles = 1.5;
    const problems = checkSimStateShape(s);
    expect(problems).toContain('state.boxes: expected { active: bool[], respawn: number[] } of equal length');
    expect(problems).toContain('state.battle.racers[0].bubbles: expected an integer');
  });

  it('rejects non-objects without throwing', () => {
    for (const v of [null, undefined, 3, 'x', []]) {
      expect(checkSimStateShape(v)).toEqual(['state: expected an object']);
    }
  });
});

describe('the contract matches the live simulation objects', () => {
  it('KartPhysSim lists every kart.phys field of createKart except the unused bumpCooldowns', () => {
    const path = {
      wrap: (s) => s, positionAt: () => ({ x: 0, y: 0, z: 0 }), headingAt: () => 0, delta: (a, b) => b - a,
      halfWidth: 6,
    };
    const kart = createKart({ id: 0, participant: { characterId: 'x', playerIndex: 0 }, charDef: null,
      speedClass: 'zippy', lapsTotal: 3, path, gridS: -7, gridLat: 0 });
    const live = Object.keys(kart.phys).filter((k) => k !== 'bumpCooldowns');
    const contract = Object.keys(SIM_STATE_SHAPE.phys);
    // frameStartX/Z are set by Race before the first sub-step; assist moves off the AI.js WeakMap (WS1).
    const planned = ['frameStartX', 'frameStartZ', 'assist'];
    expect(contract.filter((k) => !planned.includes(k)).sort()).toEqual(live.sort());
  });

  it('KartSim covers the hot kart fields read outside the sim (audit B §6)', () => {
    for (const f of ['position', 'heading', 'speed', 'velocity', 's', 'lateral', 'lap', 'place', 'finished',
      'finishTime', 'finishPlace', 'finishEstimated', 'lapTimes', 'item', 'itemCharges', 'itemRoulette',
      'boosting', 'spinning', 'shielded', 'drifting', 'driftLevel', 'starPower', 'offRoad', 'wrongWay',
      'battleOut']) {
      expect(SIM_STATE_SHAPE.kart, f).toHaveProperty(f);
    }
  });

  it('BattleSim mirrors createBattle() state (minus per-racer identity copied from the kart)', () => {
    const b = createBattle([{ id: 0, characterId: 'x', playerIndex: 0, isCPU: false }]);
    expect(Object.keys(SIM_STATE_SHAPE.battle).sort()).toEqual(Object.keys(b).sort());
    const racerKeys = Object.keys(b.racers[0]).filter((k) => !['characterId', 'playerIndex', 'isCPU'].includes(k));
    expect(Object.keys(SIM_STATE_SHAPE.battleRacer).sort()).toEqual(racerKeys.sort());
  });
});
