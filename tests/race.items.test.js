import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/data/characters.js', async () => (await import('./raceHelpers.js')).characterMock());

import { TUNING } from '../src/race/tuning.js';
import { ITEM_IDS, ITEM_INFO, rollItem, itemWeights } from '../src/race/Items.js';
import { makeRng } from '../src/race/Race.js';
import { makeRace, makeStadiumPath, humanParticipants, skipCountdown, placeKart, input } from './raceHelpers.js';

const tick = (race, n, inputs = []) => { for (let i = 0; i < n; i++) race.update(1 / 60, typeof inputs === 'function' ? inputs(i) : inputs); };

async function twoKarts(opts = {}) {
  const race = await makeRace({ participants: humanParticipants(opts.n || 2), path: makeStadiumPath(), builtTrack: { itemBoxSlots: [], boostPads: [] }, ...opts });
  skipCountdown(race);
  return race;
}

describe('item odds', () => {
  it('every item has friendly HUD info', () => {
    expect(ITEM_IDS).toHaveLength(6);
    for (const id of ITEM_IDS) expect(ITEM_INFO[id].name).toBeTruthy();
  });

  it('the leader never gets a rocket or a star; the back of the pack gets the good stuff', () => {
    const rng = makeRng(5);
    const count = (place) => {
      const c = Object.fromEntries(ITEM_IDS.map((id) => [id, 0]));
      for (let i = 0; i < 4000; i++) c[rollItem(place, 8, rng)]++;
      return c;
    };
    const first = count(1);
    const last = count(8);
    expect(first['cupcake-rocket']).toBe(0);
    expect(first['rainbow-star']).toBe(0);
    expect(first['triple-sprinkle']).toBe(0);
    expect(last['rainbow-star']).toBeGreaterThan(300);
    expect(last['triple-sprinkle']).toBeGreaterThan(first['triple-sprinkle']);
    expect(last.gumdrop).toBeLessThan(first.gumdrop);
    for (let p = 1; p <= 8; p++) {
      const w = itemWeights(p, 8);
      for (const id of ITEM_IDS) expect(w[id]).toBeGreaterThanOrEqual(0);
    }
    // a solo racer still gets items
    expect(ITEM_IDS).toContain(rollItem(1, 1, rng));
  });
});

describe('item boxes + roulette', () => {
  it('breaking a box spins the roulette ~1.2 s, then gives an item; the box pops back after 3 s', async () => {
    const race = await makeRace({ participants: humanParticipants(1), path: makeStadiumPath() });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    const box = race.itemBoxes.boxes[0];
    placeKart(race, k, box.slot.s - 1, box.slot.lateral, 0);
    race.update(1 / 60, []);
    expect(box.active).toBe(false);
    expect(k.itemRoulette).toBeGreaterThan(0.9);
    expect(k.item).toBeNull();
    expect(race.__events.some((e) => e.type === 'item-box' && e.rolling)).toBe(true);
    placeKart(race, k, box.slot.s + 40, 0, 0); // move away
    tick(race, 60);
    expect(k.item).toBeNull();
    expect(k.itemRoulette).toBeGreaterThan(0);
    tick(race, 15);
    expect(k.itemRoulette).toBe(0);
    expect(ITEM_IDS).toContain(k.item);
    const get = race.__events.find((e) => e.type === 'item-get');
    expect(get.item).toBe(k.item);
    expect(box.active).toBe(false);
    tick(race, Math.ceil(60 * (TUNING.itemBoxRespawn - 1.25)) + 2);
    expect(box.active).toBe(true);
    expect(box.mesh.visible).toBe(true);
  });

  it('holding an item means boxes break but give nothing new', async () => {
    const race = await makeRace({ participants: humanParticipants(1), path: makeStadiumPath() });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    k.item = 'gumdrop'; k.itemCharges = 1;
    const box = race.itemBoxes.boxes[0];
    placeKart(race, k, box.slot.s, box.slot.lateral, 0);
    race.update(1 / 60, []);
    expect(box.active).toBe(false);
    expect(k.itemRoulette).toBe(0);
    expect(k.item).toBe('gumdrop');
  });
});

describe('item effects', () => {
  it('sprinkle-boost: a zoomy burst', async () => {
    const race = await twoKarts();
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 20);
    k.item = 'sprinkle-boost'; k.itemCharges = 1;
    race.update(1 / 60, [input({ accel: 1, useItem: true })]);
    expect(k.item).toBeNull();
    expect(k.boosting).toBe(true);
    tick(race, 40, [input({ accel: 1 })]);
    expect(k.speed).toBeGreaterThan(k.stats.maxSpeed * 1.1);
    const use = race.__events.find((e) => e.type === 'item-use');
    expect(use.item).toBe('sprinkle-boost');
  });

  it('triple-sprinkle: three separate boosts', async () => {
    const race = await twoKarts();
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 20);
    k.item = 'triple-sprinkle'; k.itemCharges = 3;
    for (let n = 3; n >= 1; n--) {
      expect(k.item).toBe('triple-sprinkle');
      expect(k.itemCharges).toBe(n);
      race.update(1 / 60, [input({ accel: 1, useItem: true })]);
      expect(k.boosting).toBe(true);
      tick(race, 5, [input({ accel: 1 })]);
    }
    expect(k.item).toBeNull();
    expect(race.__events.filter((e) => e.type === 'item-use' && e.item === 'triple-sprinkle')).toHaveLength(3);
  });

  it('gumdrop: dropped behind, wobbles whoever drives over it (then they recover)', async () => {
    const race = await twoKarts();
    const [a, b] = race.karts;
    placeKart(race, a, 100, 0, 0);
    placeKart(race, b, 70, 0, 0);
    a.item = 'gumdrop'; a.itemCharges = 1;
    race.update(1 / 60, [input({ useItem: true }), input()]);
    expect(race.items.gumdrops).toHaveLength(1);
    const g = race.items.gumdrops[0];
    expect(race.path.delta(g.s, a.s)).toBeGreaterThan(1.5); // behind the dropper
    // the owner sitting on top of it does not trip on it
    tick(race, 10);
    expect(a.spinning).toBe(false);
    // b drives into it
    let spun = false;
    for (let i = 0; i < 180 && !spun; i++) {
      race.update(1 / 60, [input(), input({ accel: 1 })]);
      spun = b.spinning;
    }
    expect(spun).toBe(true);
    expect(race.items.gumdrops).toHaveLength(0);
    const bonk = race.__events.find((e) => e.type === 'bonked');
    expect(bonk.kart).toBe(b);
    expect(bonk.cause).toBe('gumdrop');
    expect(bonk.by).toBe(a);
    // the happy twirl is visual; b recovers after ~1.2 s and can drive again
    placeKart(race, a, 300, 0, 0); // move the dropper out of b's way
    tick(race, Math.ceil(60 * TUNING.spinDuration) + 2, [input(), input({ accel: 1 })]);
    expect(b.spinning).toBe(false);
    expect(b.phys.spinAngle).toBe(0);
    tick(race, 60, [input(), input({ accel: 1 })]);
    expect(b.speed).toBeGreaterThan(10);
  });

  it('bonks cost a bit of speed but never stop you dead', async () => {
    const race = await twoKarts();
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 30);
    race.items.bonk(k, 'test');
    expect(k.spinning).toBe(true);
    expect(k.speed).toBeCloseTo(30 * TUNING.bonkSpeedKeep, 0);
    // a second bonk while twirling does nothing extra
    expect(race.items.bonk(k, 'test')).toBe('immune');
  });

  it('bubble-shield: blocks exactly one bonk', async () => {
    const race = await twoKarts();
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 20);
    k.item = 'bubble-shield'; k.itemCharges = 1;
    race.update(1 / 60, [input({ useItem: true })]);
    expect(k.shielded).toBe(true);
    expect(race.items.bonk(k, 'test')).toBe('blocked');
    expect(k.shielded).toBe(false);
    expect(k.spinning).toBe(false);
    expect(race.__events.some((e) => e.type === 'shield-pop')).toBe(true);
    expect(race.items.bonk(k, 'test')).toBe('bonked');
  });

  it('cupcake-rocket: flies along the track and gently homes in on the kart ahead', async () => {
    const race = await twoKarts({ n: 3 });
    const [a, b, c] = race.karts;
    placeKart(race, a, 40, -4, 20);
    placeKart(race, b, 140, 5, 20); // directly ahead of a in the standings (2nd)
    placeKart(race, c, 230, 0, 20); // leader
    race.update(1 / 60, []);
    expect(a.place).toBe(3);
    expect(b.place).toBe(2);
    a.item = 'cupcake-rocket'; a.itemCharges = 1;
    race.update(1 / 60, [input({ accel: 1, useItem: true }), input({ accel: 0.6 }), input({ accel: 0.6 })]);
    expect(race.items.rockets).toHaveLength(1);
    expect(race.items.rockets[0].target).toBe(b);
    let bonked = null;
    for (let i = 0; i < 60 * 6 && !bonked; i++) {
      race.update(1 / 60, [input({ accel: 1 }), input({ accel: 0.6 }), input({ accel: 0.6 })]);
      bonked = race.__events.find((e) => e.type === 'bonked');
    }
    expect(bonked).toBeTruthy();
    expect(bonked.kart).toBe(b);
    expect(bonked.cause).toBe('cupcake-rocket');
    expect(c.spinning).toBe(false);
    expect(race.items.rockets).toHaveLength(0);
  });

  it('cupcake-rocket from 1st place just flies ahead and fizzles', async () => {
    const race = await twoKarts();
    const [a, b] = race.karts;
    placeKart(race, a, 100, 0, 0);
    placeKart(race, b, 20, 0, 0);
    race.update(1 / 60, []);
    a.item = 'cupcake-rocket'; a.itemCharges = 1;
    race.update(1 / 60, [input({ useItem: true }), input()]);
    expect(race.items.rockets[0].target).toBeNull();
    tick(race, 60 * (TUNING.rocketLife + 0.5));
    expect(race.items.rockets).toHaveLength(0);
    expect(a.spinning).toBe(false);
  });

  it('rainbow-star: sparkly speed, immune to bonks, and bumping twirls others', async () => {
    const race = await twoKarts();
    const [a, b] = race.karts;
    placeKart(race, a, 40, -1, 20);
    placeKart(race, b, 55, 0, 5);
    a.item = 'rainbow-star'; a.itemCharges = 1;
    race.update(1 / 60, [input({ accel: 1, useItem: true }), input()]);
    expect(a.starPower).toBeGreaterThan(TUNING.starDuration - 0.1);
    expect(race.items.bonk(a, 'test')).toBe('immune');
    expect(a.spinning).toBe(false);
    let bumped = false;
    for (let i = 0; i < 120 && !bumped; i++) {
      race.update(1 / 60, [input({ accel: 1 }), input()]);
      bumped = b.spinning;
    }
    expect(bumped).toBe(true);
    expect(a.spinning).toBe(false);
    expect(race.__events.find((e) => e.type === 'bonked').cause).toBe('star');
    tick(race, 60 * TUNING.starDuration);
    expect(a.starPower).toBe(0);
  });

  it('star power ignores off-road slowdown', async () => {
    const race = await twoKarts();
    const [a, b] = race.karts;
    const hw = race.path.halfWidth;
    placeKart(race, a, 20, hw + 2, 25);
    placeKart(race, b, 20, -hw - 2, 25);
    a.starPower = 5;
    tick(race, 90, [input({ accel: 1 }), input({ accel: 1 })]);
    expect(a.offRoad && b.offRoad).toBe(true);
    expect(a.speed).toBeGreaterThan(b.speed * 1.5);
  });

  it('item meshes are added to the scene and removed on dispose', async () => {
    const race = await twoKarts();
    const [a] = race.karts;
    placeKart(race, a, 100, 0, 0);
    a.item = 'gumdrop'; a.itemCharges = 1;
    race.update(1 / 60, [input({ useItem: true })]);
    expect(race.items.root.children.length).toBeGreaterThan(0);
    race.dispose();
    expect(race.__scene.children).toHaveLength(0);
  });
});
