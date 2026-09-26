import { describe, it, expect } from 'vitest';
import {
  createBattle, battlePop, battleTick, battleRanking, battleWinners, battleView, battleItem, battleItemWeights,
  loopTargetAhead, clockText, timeLeft, aliveRacers,
  BATTLE_BUBBLES, BATTLE_TIME, KID_ASSIST_BONUS, HUMANS_OUT_GRACE, LAST_BOBBING_GRACE, POPS_PER_BONUS,
} from '../src/modes/battle.js';
import { makeRng } from '../src/race/Race.js';

const racers = (n, humans = 1, extra = {}) => Array.from({ length: n }, (_, i) => ({
  id: i, characterId: `r${i}`, playerIndex: i < humans ? i : null, isCPU: i >= humans, ...extra,
}));
const pop = (s, v, by = null, t) => battlePop(s, v, by, t).state;

describe('createBattle', () => {
  it('everyone starts with the same bubbles; Kid-Assist humans get a bonus bubble', () => {
    const s = createBattle([
      { id: 0, characterId: 'a', playerIndex: 0, kidAssist: true },
      { id: 1, characterId: 'b', playerIndex: 1 },
      { id: 2, characterId: 'c', playerIndex: null, isCPU: true, kidAssist: true },
    ]);
    expect(s.racers.map((r) => r.max)).toEqual([BATTLE_BUBBLES + KID_ASSIST_BONUS, BATTLE_BUBBLES, BATTLE_BUBBLES]);
    expect(s.racers.map((r) => r.bubbles)).toEqual(s.racers.map((r) => r.max));
    expect(s.racers.map((r) => r.isCPU)).toEqual([false, false, true]);
    expect(s.timeLimit).toBe(BATTLE_TIME);
    expect(s.over).toBe(null);
  });

  it('clamps odd options', () => {
    expect(createBattle(racers(2), { bubbles: 0 }).racers[0].max).toBe(1);
    expect(createBattle(racers(2), { bubbles: 50 }).racers[0].max).toBe(9);
    expect(createBattle(racers(2), { bubbles: NaN }).racers[0].max).toBe(BATTLE_BUBBLES);
    expect(createBattle(racers(2), { timeLimit: 1 }).timeLimit).toBe(10);
    expect(createBattle(racers(2), { timeLimit: 'x' }).timeLimit).toBe(BATTLE_TIME);
    expect(createBattle().racers).toEqual([]);
  });
});

describe('battlePop', () => {
  it('pops one bubble and credits the popper', () => {
    const s0 = createBattle(racers(3));
    const { state, result } = battlePop(s0, 1, 0, 5);
    expect(result).toMatchObject({ kind: 'pop', left: 2, bonus: false });
    expect(result.victim.id).toBe(1);
    expect(result.by.id).toBe(0);
    expect(state.racers[1]).toMatchObject({ bubbles: 2, popped: 1 });
    expect(state.racers[0].pops).toBe(1);
    expect(state.time).toBe(5);
    expect(s0.racers[1].bubbles).toBe(3); // pure: the old state is untouched
  });

  it('a self-pop (own gumdrop) or an unknown popper earns nothing', () => {
    let s = createBattle(racers(3));
    s = pop(s, 1, 1);
    s = pop(s, 1, 99);
    expect(s.racers[1]).toMatchObject({ bubbles: 1, pops: 0, popped: 2 });
  });

  it('the last bubble puts a racer out, in order', () => {
    let s = createBattle(racers(3), { bubbles: 1 });
    const r = battlePop(s, 2, 0, 3);
    expect(r.result.kind).toBe('out');
    s = r.state;
    expect(s.racers[2]).toMatchObject({ bubbles: 0, outAt: 3, outOrder: 1 });
    // out racers can't be popped again
    expect(battlePop(s, 2, 0).result.kind).toBe('none');
    expect(battlePop(s, 42, 0).result.kind).toBe('none');
  });

  it('every second pop earns a bubble back, never above the start', () => {
    let s = createBattle(racers(3));
    s = pop(s, 0, 1); // 0 -> 2 bubbles
    s = pop(s, 1, 0);
    expect(s.racers[0].bubbles).toBe(2);
    const r = battlePop(s, 2, 0);
    expect(r.result.bonus).toBe(true);
    expect(r.state.racers[0]).toMatchObject({ bubbles: 3, pops: 2 });
    // a full racer gets no bonus
    let t = createBattle(racers(3));
    t = pop(t, 1, 0);
    const r2 = battlePop(t, 2, 0);
    expect(r2.result.bonus).toBe(false);
    expect(r2.state.racers[0].bubbles).toBe(3);
    // bonus switched off
    let u = createBattle(racers(3), { popsPerBonus: 0 });
    u = pop(u, 0, 1);
    u = pop(pop(u, 1, 0), 2, 0);
    expect(u.racers[0].bubbles).toBe(2);
    expect(POPS_PER_BONUS).toBe(2);
  });

  it('is ignored once the battle is over', () => {
    let s = createBattle(racers(2), { bubbles: 1 });
    s = pop(s, 1, 0, 1);
    s = battleTick(s, 1 + LAST_BOBBING_GRACE);
    expect(s.over).toEqual({ reason: 'last', time: 1 + LAST_BOBBING_GRACE });
    expect(battlePop(s, 0, null).result.kind).toBe('none');
  });
});

describe('battleTick / ending', () => {
  it('last one bobbing ends it after a short grace', () => {
    let s = createBattle(racers(3, 3), { bubbles: 1 });
    s = pop(s, 1, 0, 10);
    expect(battleTick(s, 11).over).toBe(null);
    s = pop(s, 2, 0, 12);
    expect(s.endReason).toBe('last');
    expect(battleTick(s, 12.5).over).toBe(null);
    s = battleTick(s, 12 + LAST_BOBBING_GRACE);
    expect(s.over.reason).toBe('last');
    expect(battleWinners(s).map((r) => r.id)).toEqual([0]);
  });

  it('when every human is out the battle wraps up (CPUs keep going only a moment)', () => {
    let s = createBattle(racers(4, 1), { bubbles: 1 });
    s = pop(s, 0, 2, 20);
    expect(s.endReason).toBe('humans-out');
    s = battleTick(s, 20 + HUMANS_OUT_GRACE - 0.1);
    expect(s.over).toBe(null);
    s = battleTick(s, 20 + HUMANS_OUT_GRACE);
    expect(s.over.reason).toBe('humans-out');
    expect(battleRanking(s).at(-1).id).toBe(0);
  });

  it('CPU-only battles (no humans) are not ended by "humans-out"', () => {
    let s = createBattle(racers(3, 0), { bubbles: 1 });
    s = pop(s, 0, 1, 1);
    s = battleTick(s, 30);
    expect(s.over).toBe(null);
  });

  it('the timer ends it; the clock never runs backwards', () => {
    let s = createBattle(racers(3), { timeLimit: 60 });
    s = battleTick(s, 30);
    expect(timeLeft(s)).toBe(30);
    s = battleTick(s, 10);
    expect(s.time).toBe(30);
    s = battleTick(s, 60);
    expect(s.over).toEqual({ reason: 'time', time: 60 });
    expect(battleTick(s, 70)).toBe(s);
  });

  it('a one-racer battle only ends on time', () => {
    let s = createBattle(racers(1));
    s = battleTick(s, 50);
    expect(s.over).toBe(null);
  });
});

describe('battleRanking', () => {
  it('survivors by bubbles, then pops, then fewer lost; then the out racers, last out first', () => {
    let s = createBattle(racers(5, 1));
    s = pop(s, 1, 0); // 1: 2 bubbles
    s = pop(s, 2, 3); // 2: 2 bubbles, 3 has 1 pop
    s = pop(s, 4, 3); s = pop(s, 4, 3); s = pop(s, 4, 3); // 4 out; 3 got a bonus at 2 pops (already full)
    s = pop(s, 0, 1); s = pop(s, 0, 1); s = pop(s, 0, 2); // 0 out
    const rows = battleRanking(s);
    expect(rows.map((r) => r.id)).toEqual([3, 1, 2, 0, 4]);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.out)).toEqual([false, false, false, true, true]);
  });

  it('exact ties share a place', () => {
    const s = createBattle(racers(3));
    const rows = battleRanking(s);
    expect(rows.map((r) => r.place)).toEqual([1, 1, 1]);
    expect(battleWinners(s)).toHaveLength(3);
  });

  it('aliveRacers lists who is still bobbing', () => {
    let s = createBattle(racers(3), { bubbles: 1 });
    s = pop(s, 0, 1);
    expect(aliveRacers(s).map((r) => r.id)).toEqual([1, 2]);
  });
});

describe('battleView + clock', () => {
  it('gives the HUD a clock, bubbles per racer and a hurry flag', () => {
    let s = createBattle(racers(3), { timeLimit: 60 });
    s = pop(s, 1, 0);
    let v = battleView(s);
    expect(v).toMatchObject({ timeLeft: 60, clock: '1:00', hurry: false, alive: 3, total: 3, over: false });
    expect(v.racers[1]).toMatchObject({ id: 1, bubbles: 2, max: 3, out: false });
    s = battleTick(s, 50);
    v = battleView(s);
    expect(v.hurry).toBe(true);
    expect(v.clock).toBe('0:10');
  });

  it('clockText rounds up to whole seconds', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(0.2)).toBe('0:01');
    expect(clockText(59.01)).toBe('1:00');
    expect(clockText(125)).toBe('2:05');
    expect(clockText(-3)).toBe('0:00');
    expect(clockText(NaN)).toBe('0:00');
  });
});

describe('battle items', () => {
  it('fewer bubbles = more shields and stars, poppers always likely', () => {
    const full = battleItemWeights(3, 3);
    const last = battleItemWeights(1, 3);
    expect(last['bubble-shield']).toBeGreaterThan(full['bubble-shield']);
    expect(last['rainbow-star']).toBeGreaterThan(full['rainbow-star']);
    expect(full.gumdrop + full['cupcake-rocket']).toBeGreaterThan(full['sprinkle-boost'] + full['triple-sprinkle']);
    for (const w of Object.values(battleItemWeights(NaN, 0))) expect(Number.isFinite(w) && w > 0).toBe(true);
  });

  it('battleItem only returns real items and follows the weights', () => {
    const rng = makeRng(4);
    const counts = {};
    for (let i = 0; i < 4000; i++) {
      const id = battleItem(3, 3, rng);
      counts[id] = (counts[id] || 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['bubble-shield', 'cupcake-rocket', 'gumdrop', 'rainbow-star', 'sprinkle-boost', 'triple-sprinkle']);
    expect(counts.gumdrop).toBeGreaterThan(counts['rainbow-star']);
    expect(battleItem(3, 3, () => 0.999999)).toBe('rainbow-star');
    expect(battleItem(3, 3, () => 0)).toBe('sprinkle-boost');
  });
});

describe('loopTargetAhead (rockets on a loop arena)', () => {
  const L = 500;
  const k = (id, s, distance = s, extra = {}) => ({ id, s, distance, ...extra });

  it('picks the nearest kart ahead along the loop, wrapping past the start line', () => {
    const me = k(0, 480, 1480);
    const a = k(1, 20, 2020); // 40 ahead across the line (a lap "ahead" in distance)
    const b = k(2, 200, 200);
    const r = loopTargetAhead(me, [me, a, b], L);
    expect(r.target).toBe(a);
    // the rocket starts 2.5 in front of the thrower; its distance is in the target's frame
    expect(a.distance - r.distance).toBeCloseTo(40 - 2.5, 6);
  });

  it('skips out karts, the thrower and team-mates; a kart right alongside counts as a full loop away', () => {
    const me = k(0, 100);
    const beside = k(1, 101);
    const out = k(2, 120, 120, { battleOut: true });
    const pal = k(3, 130);
    const far = k(4, 300);
    const r = loopTargetAhead(me, [me, beside, out, pal, far], L, { skip: (x) => x === pal });
    expect(r.target).toBe(far);
    const r2 = loopTargetAhead(me, [me, beside], L);
    expect(r2.target).toBe(beside);
    expect(beside.distance - r2.distance).toBeCloseTo(L + 1 - 2.5, 6);
  });

  it('null when nobody is left or the loop is bad', () => {
    const solo = k(0, 1);
    expect(loopTargetAhead(solo, [solo], L)).toBe(null);
    expect(loopTargetAhead(null, [], L)).toBe(null);
    expect(loopTargetAhead(k(0, 1), [k(1, 5)], 0)).toBe(null);
  });
});
