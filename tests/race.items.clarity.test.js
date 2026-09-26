/**
 * Race-level power-up clarity: the new item events (item-end, item-dodged,
 * chargesLeft), the 3D bursts each event spawns, the rocket target reticle,
 * the gumdrop road ring and clean disposal.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/data/characters.js', async () => (await import('./raceHelpers.js')).characterMock());

import * as THREE from 'three';
import { TUNING } from '../src/race/tuning.js';
import { DODGE_NEAR, ROCKET_DODGE_RANGE, GUMDROP_SCALE } from '../src/race/Items.js';
import { BurstField, BURST_KINDS } from '../src/race/itemBursts.js';
import { makeRace, makeStadiumPath, humanParticipants, skipCountdown, placeKart, input } from './raceHelpers.js';

const tick = (race, n, inputs = []) => { for (let i = 0; i < n; i++) race.update(1 / 60, typeof inputs === 'function' ? inputs(i) : inputs); };
const events = (race, type) => race.__events.filter((e) => e.type === type);

async function karts(n = 2, opts = {}) {
  const race = await makeRace({ participants: humanParticipants(n), path: makeStadiumPath(), builtTrack: { itemBoxSlots: [], boostPads: [] }, ...opts });
  skipCountdown(race);
  return race;
}

describe('item-use / item-end events', () => {
  it('item-use tells how many Triple Sprinkle charges are left', async () => {
    const race = await karts();
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 20);
    k.item = 'triple-sprinkle'; k.itemCharges = 3;
    for (let i = 0; i < 3; i++) { race.update(1 / 60, [input({ accel: 1, useItem: true })]); tick(race, 3); }
    expect(events(race, 'item-use').map((e) => e.chargesLeft)).toEqual([2, 1, 0]);
  });

  it('a sprinkle boost ends with item-end once the boost burns out', async () => {
    const race = await karts();
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 20);
    k.item = 'sprinkle-boost'; k.itemCharges = 1;
    race.update(1 / 60, [input({ accel: 1, useItem: true })]);
    expect(events(race, 'item-end')).toHaveLength(0);
    tick(race, Math.ceil(60 * (TUNING.itemBoost + 0.3)), [input({ accel: 1 })]);
    const end = events(race, 'item-end');
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ kart: k, item: 'sprinkle-boost' });
  });

  it('the Rainbow Star ends with item-end + a rainbow sparkle burst', async () => {
    const race = await karts();
    const k = race.getPlayerKart(0);
    placeKart(race, k, 20, 0, 10);
    k.item = 'rainbow-star'; k.itemCharges = 1;
    race.update(1 / 60, [input({ accel: 1, useItem: true })]);
    tick(race, Math.ceil(60 * (TUNING.starDuration - 0.5)));
    expect(events(race, 'item-end').filter((e) => e.item === 'rainbow-star')).toHaveLength(0);
    tick(race, 60);
    expect(events(race, 'item-end').filter((e) => e.item === 'rainbow-star')).toHaveLength(1);
    expect(race.items.bursts.emitted['star-fade']).toBe(1);
  });

  it('an old gumdrop poofs away with item-end (owner = dropper)', async () => {
    const race = await karts();
    const [a] = race.karts;
    placeKart(race, a, 100, 0, 0);
    a.item = 'gumdrop'; a.itemCharges = 1;
    race.update(1 / 60, [input({ useItem: true })]);
    race.items.gumdrops[0].age = TUNING.gumdropLife - 0.01;
    tick(race, 3);
    expect(race.items.gumdrops).toHaveLength(0);
    expect(events(race, 'item-end')).toEqual([expect.objectContaining({ kart: a, item: 'gumdrop' })]);
  });
});

describe('dodges', () => {
  it('passing close by a gumdrop without touching it = one item-dodged', async () => {
    const race = await karts();
    const [a, b] = race.karts;
    placeKart(race, a, 300, 0, 0);
    placeKart(race, b, 60, 0, 0);
    const g = race.items.dropGumdrop(a);
    // b drives past it a little to the side (inside DODGE_NEAR, outside the bonk radius)
    const lat = g.lateral + (TUNING.gumdropRadius + DODGE_NEAR) / 2;
    for (let s = g.s - 10; s < g.s + 12; s += 0.5) {
      placeKart(race, b, s, lat, 20);
      race.update(1 / 60, []);
    }
    const d = events(race, 'item-dodged');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kart: b, item: 'gumdrop', by: a });
    expect(events(race, 'bonked')).toHaveLength(0);
    expect(race.items.bursts.emitted['dodge-sparkle']).toBe(1);
  });

  it('a kart far away from the gumdrop does not "dodge" it', async () => {
    const race = await karts();
    const [a, b] = race.karts;
    placeKart(race, a, 300, 0, 0);
    const g = race.items.dropGumdrop(a);
    for (let s = g.s - 10; s < g.s + 12; s += 0.5) { placeKart(race, b, s, g.lateral + 8, 20); race.update(1 / 60, []); }
    expect(events(race, 'item-dodged')).toHaveLength(0);
  });

  it('a rocket that fizzles right behind its target counts as dodged', async () => {
    const race = await karts(2);
    const [a, b] = race.karts;
    placeKart(race, a, 40, 0, 0);
    placeKart(race, b, 140, 0, 0);
    race.update(1 / 60, []);
    const r = race.items.launchRocket(a);
    expect(r.target).toBe(b);
    r.distance = b.distance - 20;
    r.life = 0.001;
    race.update(1 / 60, []);
    expect(race.items.rockets).toHaveLength(0);
    expect(events(race, 'item-dodged')).toEqual([expect.objectContaining({ kart: b, item: 'cupcake-rocket', by: a })]);
    expect(events(race, 'item-end')).toEqual([expect.objectContaining({ kart: a, item: 'cupcake-rocket' })]);
  });

  it('...but not when it fizzles miles away', async () => {
    const race = await karts(2);
    const [a, b] = race.karts;
    placeKart(race, a, 40, 0, 0);
    placeKart(race, b, 300, 0, 0);
    race.update(1 / 60, []);
    const r = race.items.launchRocket(a);
    r.distance = b.distance - (ROCKET_DODGE_RANGE + 50);
    r.life = 0.001;
    race.update(1 / 60, []);
    expect(events(race, 'item-dodged')).toHaveLength(0);
  });

  it('star power shrugs off a bonk: item-dodged with star:true', async () => {
    const race = await karts();
    const [a, b] = race.karts;
    placeKart(race, a, 40, 0, 0);
    a.starPower = 3;
    expect(race.items.bonk(a, 'cupcake-rocket', b)).toBe('immune');
    expect(events(race, 'item-dodged')).toEqual([expect.objectContaining({ kart: a, item: 'cupcake-rocket', by: b, star: true })]);
    // a second bonk while already twirling is quietly immune (no dodge spam)
    a.starPower = 0;
    race.items.bonk(a, 'gumdrop', b);
    race.items.bonk(a, 'gumdrop', b);
    expect(events(race, 'item-dodged')).toHaveLength(1);
  });
});

describe('3D bursts for every hit / block / box', () => {
  it('bonk -> star burst, block -> bubble pop (and a ring)', async () => {
    const race = await karts();
    const [a, b] = race.karts;
    placeKart(race, a, 40, 0, 20);
    race.items.bonk(a, 'gumdrop', b);
    expect(race.items.bursts.emitted['star-burst']).toBe(1);
    expect(race.items.bursts.live).toBeGreaterThan(5);
    placeKart(race, b, 80, 0, 20);
    b.shielded = true; b.phys.shieldTime = 5;
    race.items.bonk(b, 'cupcake-rocket', a);
    expect(race.items.bursts.emitted['bubble-pop']).toBe(1);
    expect(race.items.bursts.rings.some((r) => r.busy)).toBe(true);
    tick(race, 90);
    expect(race.items.bursts.live).toBe(0); // every particle recycled
    expect(race.items.bursts.rings.every((r) => !r.busy)).toBe(true);
  });

  it('item boxes pop with confetti when broken and sparkle when they come back', async () => {
    const race = await makeRace({ participants: humanParticipants(1), path: makeStadiumPath() });
    skipCountdown(race);
    const k = race.getPlayerKart(0);
    const box = race.itemBoxes.boxes[0];
    placeKart(race, k, box.slot.s - 1, box.slot.lateral, 10);
    race.update(1 / 60, []);
    expect(box.active).toBe(false);
    expect(race.itemBoxes.bursts.emitted['box-pop']).toBe(1);
    placeKart(race, k, box.slot.s + 60, 0, 0);
    tick(race, Math.ceil(60 * TUNING.itemBoxRespawn) + 2);
    expect(box.active).toBe(true);
    expect(race.itemBoxes.bursts.emitted.respawn).toBeGreaterThanOrEqual(1);
  });

  it('item boxes bob higher and carry a halo + glow so they read as collectable', async () => {
    const race = await makeRace({ participants: humanParticipants(1), path: makeStadiumPath() });
    const b = race.itemBoxes.boxes[0];
    expect(b.mesh.getObjectByName('halo')).toBeTruthy();
    expect(b.mesh.getObjectByName('glow')).toBeTruthy();
    const ys = [];
    for (let i = 0; i < 180; i++) { race.itemBoxes.update(1 / 60, [], null); ys.push(b.mesh.position.y); }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5);
  });

  it('a rocket leaves a sprinkle trail and shows a reticle on its target', async () => {
    const race = await karts(2);
    const [a, b] = race.karts;
    placeKart(race, a, 40, 0, 0);
    placeKart(race, b, 140, 0, 0);
    race.update(1 / 60, []);
    const r = race.items.launchRocket(a);
    tick(race, 10);
    expect(race.items.bursts.emitted['rocket-trail']).toBeGreaterThan(3);
    expect(r.reticle.visible).toBe(true);
    const d = new THREE.Vector3().subVectors(r.reticle.position, b.position);
    expect(Math.hypot(d.x, d.z)).toBeLessThan(0.01);
    r.target = null;
    tick(race, 1);
    expect(r.reticle.visible).toBe(false);
  });

  it('gumdrops are big, jiggle, and sit on a glowing ring on the road', async () => {
    const race = await karts();
    const [a] = race.karts;
    placeKart(race, a, 100, 0, 0);
    const g = race.items.dropGumdrop(a);
    expect(g.ring).toBeTruthy();
    expect(g.ring.parent).toBe(g.mesh);
    expect(race.items.bursts.emitted['gumdrop-plop']).toBe(1);
    const sy = [];
    for (let i = 0; i < 120; i++) { race.items.update(1 / 60, []); sy.push(g.jelly.scale.y); }
    expect(Math.max(...sy)).toBeGreaterThan(GUMDROP_SCALE);
    expect(Math.min(...sy)).toBeLessThan(GUMDROP_SCALE);
    expect(sy.every(Number.isFinite)).toBe(true);
  });
});

describe('BurstField', () => {
  it('pools particles: bursts past capacity are clipped, never throw, and recycle', () => {
    const parent = new THREE.Group();
    const f = new BurstField(parent);
    let total = 0;
    for (let i = 0; i < 60; i++) total += f.emit('box-pop', { x: i, y: 1, z: 0 });
    expect(total).toBeLessThanOrEqual(840);
    expect(f.live).toBe(total);
    expect(f.emit('nope', { x: 0, y: 0, z: 0 })).toBe(0);
    expect(f.emit('box-pop', null)).toBe(0);
    for (let i = 0; i < 120; i++) f.update(1 / 60);
    expect(f.live).toBe(0);
    expect(f.emit('star-burst', { x: 0, y: 0, z: 0 })).toBe(BURST_KINDS['star-burst'].count);
    const m = f.meshes.star.instanceMatrix.array;
    f.update(1 / 60);
    expect(Array.from(m).every(Number.isFinite)).toBe(true);
    f.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('carries bursts along with a moving kart (dir)', () => {
    const f = new BurstField(new THREE.Group());
    f.emit('bubble-pop', { x: 0, y: 1, z: 0 }, { dir: { x: 0, z: 30 } });
    for (let i = 0; i < 10; i++) f.update(1 / 60);
    const zs = f.parts.blob.map((p) => p.z);
    expect(zs.reduce((a, b) => a + b, 0) / zs.length).toBeGreaterThan(3);
  });
});

describe('cleanup', () => {
  it('rockets, reticles, gumdrops and bursts all leave the scene on dispose', async () => {
    const race = await karts(2);
    const [a, b] = race.karts;
    placeKart(race, a, 40, 0, 0);
    placeKart(race, b, 140, 0, 0);
    race.update(1 / 60, []);
    race.items.launchRocket(a);
    race.items.dropGumdrop(b);
    race.items.bonk(b, 'gumdrop', a);
    tick(race, 2);
    race.dispose();
    expect(race.__scene.children).toHaveLength(0);
  });
});
