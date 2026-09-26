/**
 * Power-up HUD logic (pure): button hints per device, the landing roulette,
 * slot / card state, pips, timer rings, rocket warnings and friendly texts.
 */
import { describe, it, expect } from 'vitest';
import {
  itemButtonLabel, pressHint, ROULETTE_TICKS, rouletteTicks, rouletteItemAt, rouletteProgress, itemSlotView,
  activeTimers, ringDashOffset, THREAT_RANGE, beepInterval, threatCloseness, bearingTo, threatsFor, edgeArrowPlacement,
  possessive, useCallout, bonkMessages, blockMessages, dodgeMessages, endMessage, threatMessage,
} from '../src/ui/widgets/itemHudLogic.js';
import { ITEM_ORDER } from '../src/race/itemCatalog.js';
import { TUNING } from '../src/race/tuning.js';

const BANNED = /\b(hit|hits|kill|killed|crash|crashed|destroy|destroyed|attack|shoot|shot|explode|explodes|dead|die|hurt|weapon|bomb|blast)\b/i;

const kart = (extra = {}) => ({
  playerIndex: 0, isCPU: false, name: 'Rocco', heading: 0, position: { x: 0, y: 0, z: 0 }, distance: 100,
  item: null, itemCharges: 0, itemRoulette: 0, phys: { shieldTime: 0, pendingItem: null }, starPower: 0, shielded: false, ...extra,
});

describe('button hints per device', () => {
  it('keyboards show their own item key', () => {
    expect(itemButtonLabel({ id: 'kb1', type: 'keyboard' })).toBe('E');
    expect(itemButtonLabel({ id: 'kb2', type: 'keyboard' })).toBe('/');
    expect(itemButtonLabel('kb1')).toBe('E');
    expect(pressHint({ id: 'kb1', type: 'keyboard' })).toBe('Press E');
  });

  it('gamepads show the shoulder button of their family', () => {
    expect(itemButtonLabel({ id: 'gp0', type: 'gamepad', kind: 'xbox' })).toBe('LB');
    expect(itemButtonLabel({ id: 'gp0', type: 'gamepad', kind: 'playstation' })).toBe('L1');
    expect(itemButtonLabel({ id: 'gp0', type: 'gamepad', kind: 'switch' })).toBe('L');
    expect(itemButtonLabel({ id: 'gp0', type: 'gamepad', kind: 'generic' })).toBe('LB');
    expect(itemButtonLabel({ id: 'virtual-1', type: 'gamepad', kind: 'virtual' })).toBe('LB');
    expect(pressHint({ id: 'gp1', type: 'gamepad', kind: 'playstation' })).toBe('Press L1');
  });

  it('prefers the labels InputManager reports, and falls back safely', () => {
    expect(itemButtonLabel({ id: 'gp0', type: 'gamepad', kind: 'xbox', labels: { item: 'Y' } })).toBe('Y');
    expect(itemButtonLabel(null)).toBe('LB');
    expect(itemButtonLabel({ type: 'keyboard' })).toBe('E');
    expect(itemButtonLabel('gp3')).toBe('LB');
  });
});

describe('roulette', () => {
  it('ticks start quick and slow down, ending on exactly ROULETTE_TICKS', () => {
    expect(rouletteTicks(0)).toBe(0);
    expect(rouletteTicks(1)).toBe(ROULETTE_TICKS);
    expect(rouletteTicks(-1)).toBe(0);
    expect(rouletteTicks(NaN)).toBe(0);
    let last = 0;
    const gaps = [];
    let lastAt = 0;
    for (let i = 1; i <= 1000; i++) {
      const p = i / 1000;
      const t = rouletteTicks(p);
      expect(t).toBeGreaterThanOrEqual(last);
      if (t > last) { gaps.push(p - lastAt); lastAt = p; }
      last = t;
    }
    expect(gaps.length).toBe(ROULETTE_TICKS);
    // slows down: the last gap is much longer than the first
    expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[1] * 3);
  });

  it('always lands on the real item (when known), cycling through all six on the way', () => {
    for (const id of ITEM_ORDER) {
      expect(rouletteItemAt(1, id)).toBe(id);
      const seen = new Set();
      for (let i = 0; i <= 100; i++) seen.add(rouletteItemAt(i / 100, id));
      expect(seen.size).toBe(6);
    }
    expect(ITEM_ORDER).toContain(rouletteItemAt(0.5, null));
    expect(ITEM_ORDER).toContain(rouletteItemAt(0.5, 'unknown'));
  });

  it('progress comes from KartState.itemRoulette (1 -> 0)', () => {
    expect(rouletteProgress(kart({ itemRoulette: 1 }))).toBe(0);
    expect(rouletteProgress(kart({ itemRoulette: 0.25 }))).toBeCloseTo(0.75);
    expect(rouletteProgress(kart())).toBe(1);
  });
});

describe('item slot + card', () => {
  it('empty / rolling / ready / spinning', () => {
    expect(itemSlotView(kart()).state).toBe('empty');
    const r = itemSlotView(kart({ itemRoulette: 0.02, phys: { pendingItem: 'gumdrop' } }));
    expect(r.state).toBe('rolling');
    expect(r.hint).toBeNull();
    const nearlyDone = itemSlotView(kart({ itemRoulette: 1e-6, phys: { pendingItem: 'gumdrop' } }));
    expect(nearlyDone.item).toBe('gumdrop');
    const ready = itemSlotView(kart({ item: 'cupcake-rocket', itemCharges: 1 }), { id: 'kb1', type: 'keyboard' });
    expect(ready).toMatchObject({ state: 'ready', item: 'cupcake-rocket', name: 'Cupcake Rocket', emoji: '🧁', hint: 'Press E', pips: null });
    const sp = itemSlotView(kart({ item: 'gumdrop', itemCharges: 1, spinning: true }), { id: 'gp0', kind: 'xbox' });
    expect(sp.state).toBe('spinning');
    expect(sp.hint).not.toMatch(/Press/);
  });

  it('the hint follows THAT player\'s device', () => {
    const k = kart({ item: 'gumdrop', itemCharges: 1 });
    expect(itemSlotView(k, { id: 'kb2', type: 'keyboard' }).hint).toBe('Press /');
    expect(itemSlotView(k, { id: 'gp1', type: 'gamepad', kind: 'switch' }).hint).toBe('Press L');
    expect(itemSlotView(k, null).hint).toBe('Press LB');
  });

  it('Triple Sprinkle shows 3 pips counting down', () => {
    for (const [charges, left] of [[3, 3], [2, 2], [1, 1], [9, 3], [undefined, 3]]) {
      const v = itemSlotView(kart({ item: 'triple-sprinkle', itemCharges: charges }));
      expect(v.pips).toEqual({ total: 3, left });
    }
    for (const id of ITEM_ORDER.filter((x) => x !== 'triple-sprinkle')) {
      expect(itemSlotView(kart({ item: id, itemCharges: 1 })).pips, id).toBeNull();
    }
  });

  it('ignores unknown item ids', () => {
    expect(itemSlotView(kart({ item: 'banana' })).state).toBe('empty');
  });
});

describe('timer rings', () => {
  it('shield and star show shrinking rings with the time left', () => {
    expect(activeTimers(kart(), TUNING)).toEqual([]);
    const k = kart({ starPower: TUNING.starDuration / 2, shielded: true, phys: { shieldTime: TUNING.shieldDuration } });
    const t = activeTimers(k, TUNING);
    expect(t.map((x) => x.item)).toEqual(['rainbow-star', 'bubble-shield']);
    expect(t[0].frac).toBeCloseTo(0.5);
    expect(t[1].frac).toBe(1);
    expect(t.every((x) => !x.ending)).toBe(true);
    const ending = activeTimers(kart({ starPower: 1, shielded: true, phys: { shieldTime: 2 } }), TUNING);
    expect(ending.every((x) => x.ending)).toBe(true);
  });

  it('a shield with no time left reads as an empty ring, never NaN', () => {
    const t = activeTimers(kart({ shielded: true, phys: {} }), TUNING);
    expect(t[0].frac).toBe(0);
  });

  it('ring dash offsets', () => {
    expect(ringDashOffset(1, 100)).toBe(0);
    expect(ringDashOffset(0, 100)).toBe(100);
    expect(ringDashOffset(0.25, 100)).toBe(75);
    expect(ringDashOffset(NaN, 100)).toBe(100);
    expect(ringDashOffset(2, 100)).toBe(0);
  });
});

describe('rocket warnings', () => {
  it('only the TARGET gets a warning, closest rocket first', () => {
    const me = kart({ distance: 500 });
    const other = kart({ playerIndex: 1, distance: 520 });
    const owner = kart({ playerIndex: null, isCPU: true, name: 'Lenny', distance: 300 });
    const far = { target: me, owner, distance: 360, mesh: { position: { x: 0, y: 0, z: -140 } } };
    const near = { target: me, owner, distance: 470, mesh: { position: { x: 0, y: 0, z: -30 } } };
    const notMine = { target: other, owner, distance: 490, mesh: { position: { x: 0, y: 0, z: -10 } } };
    const list = threatsFor(me, [far, notMine, near]);
    expect(list.map((t) => t.rocket)).toEqual([near, far]);
    expect(list[0].gap).toBe(30);
    expect(list[0].from).toBe('Lenny');
    expect(threatsFor(other, [far, near])).toEqual([]);
    expect(threatsFor(me, null)).toEqual([]);
    expect(threatsFor(null, [near])).toEqual([]);
  });

  it('ignores rockets out of range, overshot ones, and your own', () => {
    const me = kart({ distance: 1000 });
    expect(threatsFor(me, [{ target: me, distance: 1000 - THREAT_RANGE - 1 }])).toEqual([]);
    expect(threatsFor(me, [{ target: me, distance: 1010 }])).toEqual([]);
    expect(threatsFor(me, [{ target: me, owner: me, distance: 990 }])).toEqual([]);
    expect(threatsFor(me, [{ target: me, distance: 1002 }])[0].gap).toBe(0); // right on top of you
  });

  it('beeps get faster as the rocket closes in', () => {
    let prev = Infinity;
    for (let gap = THREAT_RANGE; gap >= 0; gap -= 5) {
      const b = beepInterval(gap);
      expect(b).toBeLessThanOrEqual(prev);
      prev = b;
    }
    expect(beepInterval(THREAT_RANGE)).toBeCloseTo(0.9);
    expect(beepInterval(0)).toBeCloseTo(0.12);
    expect(beepInterval(9999)).toBeCloseTo(0.9);
    expect(beepInterval(NaN)).toBe(0.9);
    expect(threatCloseness(0)).toBe(1);
    expect(threatCloseness(THREAT_RANGE)).toBe(0);
    expect(threatCloseness(THREAT_RANGE / 2)).toBeCloseTo(0.5);
  });

  it('bearing: ahead 0, right +90°, behind 180° (ARCHITECTURE heading convention)', () => {
    const k = kart({ heading: 0 }); // forward +Z, right -X
    expect(bearingTo(k, { x: 0, z: 10 })).toBeCloseTo(0);
    expect(bearingTo(k, { x: -10, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(bearingTo(k, { x: 10, z: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(bearingTo(k, { x: 0, z: -10 }))).toBeCloseTo(Math.PI);
    const turned = kart({ heading: Math.PI / 2 }); // forward +X
    expect(bearingTo(turned, { x: 10, z: 0 })).toBeCloseTo(0);
    expect(Math.abs(bearingTo(turned, { x: -10, z: 0 }))).toBeCloseTo(Math.PI);
  });

  it('the edge arrow sits on the matching edge and points at the rocket', () => {
    const behind = edgeArrowPlacement(Math.PI);
    expect(behind.x).toBeCloseTo(0.5);
    expect(behind.y).toBeGreaterThan(0.85);
    expect(behind.rot).toBeCloseTo(180);
    const right = edgeArrowPlacement(Math.PI / 2);
    expect(right.x).toBeGreaterThan(0.85);
    expect(right.y).toBeCloseTo(0.5);
    const backLeft = edgeArrowPlacement(-Math.PI * 0.8);
    expect(backLeft.x).toBeLessThan(0.5);
    expect(backLeft.y).toBeGreaterThan(0.5);
    for (let b = -Math.PI; b <= Math.PI; b += 0.2) {
      const p = edgeArrowPlacement(b);
      expect(p.x).toBeGreaterThanOrEqual(0.07);
      expect(p.x).toBeLessThanOrEqual(0.93);
      expect(p.y).toBeGreaterThanOrEqual(0.11);
      expect(p.y).toBeLessThanOrEqual(0.89);
    }
    expect(Number.isFinite(edgeArrowPlacement(NaN).x)).toBe(true);
  });

  it('warning text', () => {
    expect(threatMessage({ closeness: 0.2, from: 'Lenny' })).toMatchObject({ emoji: '🧁', title: 'Rocket coming!', sub: 'Sent from Lenny' });
    expect(threatMessage({ closeness: 0.9 }).sub).toBe('Here it comes!');
  });
});

describe('friendly two-sided texts', () => {
  const crumbs = { name: 'Captain Crumbs' };
  const lenny = { name: 'Lenny' };

  it('possessives', () => {
    expect(possessive('Lenny')).toBe("Lenny's");
    expect(possessive('Captain Crumbs')).toBe("Captain Crumbs'");
    expect(possessive('')).toBe("Someone's");
  });

  it('bonks name who did it, on both sides', () => {
    expect(bonkMessages({ kart: lenny, by: crumbs, cause: 'gumdrop' })).toEqual({
      victim: "Bonked by Captain Crumbs' Gumdrop! 💫", bonker: 'You bonked Lenny! 🎯',
    });
    expect(bonkMessages({ kart: crumbs, by: lenny, cause: 'cupcake-rocket' }).victim).toBe("Bonked by Lenny's Cupcake Rocket! 💫");
    expect(bonkMessages({ kart: lenny, by: crumbs, cause: 'star' })).toEqual({
      victim: "Twirled by Captain Crumbs' Rainbow Star! 🌈", bonker: 'You twirled Lenny! 🌟',
    });
    // your own gumdrop: no finger-pointing
    expect(bonkMessages({ kart: lenny, by: lenny, cause: 'gumdrop' })).toEqual({ victim: 'Oopsie, a Gumdrop! 💫', bonker: null });
    expect(bonkMessages({ kart: lenny, cause: 'test' }).bonker).toBeNull();
  });

  it('blocks, dodges and endings', () => {
    expect(blockMessages({ kart: lenny, by: crumbs, cause: 'cupcake-rocket' })).toEqual({
      victim: "Bubble blocked Captain Crumbs' Cupcake Rocket! 🫧", bonker: "Lenny's bubble blocked it! 🫧",
    });
    expect(blockMessages({ kart: lenny, cause: 'gumdrop' }).victim).toBe('Bubble saved you! 🫧');
    expect(dodgeMessages({ kart: lenny, by: crumbs, item: 'gumdrop' })).toEqual({
      victim: 'Phew! Dodged the Gumdrop! 😅', bonker: 'Lenny dodged your Gumdrop! 😮',
    });
    expect(dodgeMessages({ kart: lenny, by: crumbs, item: 'cupcake-rocket' }).victim).toBe('Phew! The rocket missed! 😅');
    expect(dodgeMessages({ kart: lenny, by: crumbs, item: 'cupcake-rocket', star: true }).victim).toMatch(/Star power/);
    expect(endMessage('bubble-shield')).toMatch(/Bubble/);
    expect(endMessage('rainbow-star')).toMatch(/Star/);
    expect(endMessage('gumdrop')).toBeNull();
  });

  it('use callouts for every item', () => {
    for (const id of ITEM_ORDER) {
      const c = useCallout(id);
      expect(c.title, id).toMatch(/!$/);
      expect(c.emoji.length).toBeGreaterThan(0);
    }
    expect(useCallout('triple-sprinkle', { chargesLeft: 2 }).sub).toBe('2 more to go!');
    expect(useCallout('triple-sprinkle', { chargesLeft: 0 }).sub).toBe('Last zoom!');
    expect(useCallout('cupcake-rocket', { target: lenny }).sub).toBe('Zooming after Lenny!');
    expect(useCallout('cupcake-rocket').sub).toBe('Zooming ahead!');
    expect(useCallout('banana')).toBeNull();
  });

  it('every text a kid can read is friendly (no violence words)', () => {
    const texts = [];
    for (const cause of ['gumdrop', 'cupcake-rocket', 'star']) {
      const m = bonkMessages({ kart: lenny, by: crumbs, cause });
      texts.push(m.victim, m.bonker);
      const b = blockMessages({ kart: lenny, by: crumbs, cause });
      texts.push(b.victim, b.bonker);
    }
    for (const item of ITEM_ORDER) {
      const d = dodgeMessages({ kart: lenny, by: crumbs, item });
      texts.push(d.victim, d.bonker, useCallout(item).title, useCallout(item).sub, endMessage(item));
    }
    texts.push(threatMessage({ closeness: 0.9 }).title, threatMessage({ closeness: 0.9 }).sub);
    for (const t of texts.filter(Boolean)) expect(t).not.toMatch(BANNED);
  });
});
