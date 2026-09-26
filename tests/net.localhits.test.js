// Local gumdrop hits (NETWORKING.md §9.8, net review #12): a guest's own kart is drawn at P, ahead of the host,
// so the host's "bonked" used to arrive when the kart was already 3–8 m past the gumdrop the kid saw. When the
// gumdrop is uncontested (no other kart near it in the snapshot) and not possibly our own fresh drop, the guest
// bonks its predicted kart at the very tick it touches it, hides the gumdrop, and drops the host's duplicate.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { predictGumdropHits } from '../src/net/guest/localHits.js';
import { ReplicaRace, LOCAL_HIT_CONTEST_M, LOCAL_HIT_GRACE_TICKS } from '../src/net/guest/replicaRace.js';
import { createKart } from '../src/race/Kart.js';
import { TUNING as T } from '../src/race/tuning.js';
import { quantizeInput } from './helpers/netWire.js';
import { predictTick, makeCountdown } from './helpers/netSim.js';
import { predictTick as gamePredictTick } from '../src/online/standins/sim.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';
import { getCharacter } from '../src/characters/index.js';

const { def, path } = trackFixture('gumdrop-meadow');

function kartAt(x, z, id = 0) {
  const cid = defaultRacerIds(1)[0];
  const k = createKart({ id, participant: { characterId: cid, playerIndex: 0 }, charDef: getCharacter(cid), speedClass: 'zippy', lapsTotal: 3, path, gridS: 10, gridLat: 0 });
  k.position.set(x, 0, z);
  k.heading = 0;
  k.phys.frameStartX = x;
  k.phys.frameStartZ = z - 1; // moved 1 m this tick
  return k;
}

describe('predictGumdropHits (same test as the host ItemSystem)', () => {
  it('a touch bonks (twirl, speed cut) and consumes the gumdrop; a far one or another level does nothing', () => {
    const k = kartAt(0, 0);
    k.speed = 20;
    const emitted = [];
    const hz = { gumdrops: [{ id: 7, x: 0.5, y: 0, z: -0.5 }, { id: 8, x: 30, y: 0, z: 0 }, { id: 9, x: 0, y: 5, z: 0 }], consumed: new Set() };
    expect(predictGumdropHits([k], hz, (e) => emitted.push(e))).toBe(1);
    expect(k.spinning).toBe(true);
    expect(k.phys.spinTime).toBe(T.spinDuration);
    expect(k.speed).toBeCloseTo(20 * T.bonkSpeedKeep);
    expect([...hz.consumed]).toEqual([7]);
    expect(emitted).toEqual([{ type: 'bonked', kart: k, cause: 'gumdrop', by: null, gumdrop: 7 }]);
    expect(predictGumdropHits([k], hz, () => {})).toBe(0); // consumed, and the others are out of reach
  });

  it('a shield pops instead, star power is immune (the gumdrop is still used up), skip() and finished karts are left alone', () => {
    const shielded = kartAt(0, 0);
    shielded.shielded = true;
    const e1 = [];
    predictGumdropHits([shielded], { gumdrops: [{ id: 1, x: 0, y: 0, z: 0 }], consumed: new Set() }, (e) => e1.push(e.type));
    expect(e1).toEqual(['shield-pop']);
    expect(shielded.spinning).toBe(false);
    const star = kartAt(0, 0);
    star.starPower = 3;
    const hz = { gumdrops: [{ id: 2, x: 0, y: 0, z: 0 }], consumed: new Set() };
    const e2 = [];
    predictGumdropHits([star], hz, (e) => e2.push(e));
    expect(e2).toEqual([]);
    expect(hz.consumed.has(2)).toBe(true);
    const skipped = kartAt(0, 0);
    expect(predictGumdropHits([skipped], { gumdrops: [{ id: 3, x: 0, y: 0, z: 0 }], consumed: new Set(), skip: () => true })).toBe(0);
    const done = kartAt(0, 0);
    done.finished = true;
    expect(predictGumdropHits([done], { gumdrops: [{ id: 4, x: 0, y: 0, z: 0 }], consumed: new Set() })).toBe(0);
  });

  it('both predictTick copies (game stand-in and test stand-in) run it after the tick', () => {
    for (const pt of [predictTick, gamePredictTick]) {
      const k = kartAt(0, 0);
      const s = path.positionAt(40, 0, new THREE.Vector3());
      k.position.copy(s);
      k.s = 40;
      const ctx = {
        path, boostPads: [], gameplay: undefined, tick: 400, startTick: 1, goTick: 181, lapsTotal: 3,
        hazards: { gumdrops: [{ id: 5, x: s.x, y: s.y, z: s.z }], consumed: new Set() },
      };
      const out = [];
      pt([k], [{ steer: 0, accel: 1, brake: 0, drift: false }], { ...ctx, emit: (e) => out.push(e.type) });
      expect(out).toContain('bonked');
      expect(k.spinning).toBe(true);
    }
  });
});

describe('ReplicaRace local hits: only uncontested, never a maybe-own fresh drop, host duplicate dropped', () => {
  const cd = makeCountdown(3);
  const ids = defaultRacerIds(3);
  const participants = [{ characterId: ids[0], playerIndex: null }, { characterId: ids[1], playerIndex: null }, { characterId: ids[2], playerIndex: 0 }];
  const make = () => new ReplicaRace({
    scene: new THREE.Scene(), trackDef: def, path, setup: { participants, laps: 2, startTick: 1, goTick: cd.goTick }, localKartIds: [2],
    predictTick, countdownAfter: cd.after, quantize: quantizeInput, buildKartModel: stubKartModel(),
  });
  const snapWith = (r, tick, gumdrops, cpuAt) => ({
    tick, epoch: 0, flags: {}, owner: [], gumdrops, rockets: [], boxes: [],
    karts: r.karts.map((k, i) => ({ position: i === 0 && cpuAt ? cpuAt : [k.position.x + 500, 0, k.position.z + 500] })),
  });

  it('contested (another kart within LOCAL_HIT_CONTEST_M of it in the snapshot) → left to the host', () => {
    const r = make();
    const g = { id: 11, x: 0, y: 0, z: 0 };
    expect(r._contested(snapWith(r, 100, [g], [3, 0, 0])).has(11)).toBe(true);
    expect(r._contested(snapWith(r, 100, [g], [LOCAL_HIT_CONTEST_M + 1, 0, 0])).has(11)).toBe(false);
    expect(r._contested(null).size).toBe(0);
    r.dispose();
  });

  it('a gumdrop that first shows up right behind our kart waits out the owner grace; one ahead of us does not', () => {
    const r = make();
    const me = r.karts[2];
    const fx = Math.sin(me.heading);
    const fz = Math.cos(me.heading);
    const behind = { id: 21, x: me.position.x - fx * 4, y: 0, z: me.position.z - fz * 4 };
    const ahead = { id: 22, x: me.position.x + fx * 6, y: 0, z: me.position.z + fz * 6 };
    r._trackGumdrops(snapWith(r, 100, [behind, ahead]));
    r.predictedTick = 110;
    const hz = r._hazards(new Set(), snapWith(r, 100, [behind, ahead]));
    expect(hz.skip(behind)).toBe(true);
    expect(hz.skip(ahead)).toBe(false);
    r.predictedTick = 100 + LOCAL_HIT_GRACE_TICKS;
    expect(hz.skip(behind)).toBe(false);
    r.dispose();
  });

  it('the host\'s bonk for a kart we already bonked locally is dropped (one twirl, one sound)', () => {
    const r = make();
    const seen = [];
    r.onEvent = (e) => seen.push(e.type);
    r._localBonks.set(2, [300]);
    r._releaseEvent({ seq: 1, tick: 305, type: 'bonked', kart: 2, cause: 'gumdrop', by: 0 });
    expect(seen).toEqual([]);
    expect(r.stats.localHitsConfirmed).toBe(1);
    r._releaseEvent({ seq: 2, tick: 900, type: 'bonked', kart: 2, cause: 'gumdrop', by: 0 }); // a new one: played
    r._releaseEvent({ seq: 3, tick: 905, type: 'bonked', kart: 2, cause: 'cupcake-rocket', by: 0 });
    expect(seen).toEqual(['bonked', 'bonked']);
    r.dispose();
  });
});
