/**
 * Power-up clarity: every item event has a visual (fx) and a sound (sfx), each
 * item sounds different, and every name in the cue table is really implemented.
 */
import { describe, it, expect } from 'vitest';
import {
  ITEM_ORDER, ITEM_CATALOG, ITEM_EVENTS, cueFor, eventsFor, allCuePairs, itemForCause, itemName, itemEmoji,
  THREAT_CUE, SCORE_CUE, effectFraction,
} from '../src/race/itemCatalog.js';
import { ITEM_IDS, ITEM_INFO, FX_PROVIDES as ITEMS_FX } from '../src/race/Items.js';
import { FX_PROVIDES as BOX_FX } from '../src/race/ItemBoxes.js';
import { FX_PROVIDES as KART_FX } from '../src/race/KartFx.js';
import { FX_PROVIDES as POWERUP_FX } from '../src/fx/powerupEffects.js';
import { HUD_FX_PROVIDES } from '../src/ui/widgets/itemHudLogic.js';
import { BURST_KINDS } from '../src/race/itemBursts.js';
import { SFX, SFX_OWNERS } from '../src/audio/sfx.js';
import itemsPack, { ITEM_SFX_NAMES } from '../src/audio/sfx/items.js';
import { ITEM_ICONS } from '../src/ui/hudLogic.js';

const ALL_FX = new Set([...ITEMS_FX, ...BOX_FX, ...KART_FX, ...POWERUP_FX, ...HUD_FX_PROVIDES]);

describe('item catalog', () => {
  it('lists exactly the six contract items, in one order everywhere', () => {
    expect(ITEM_ORDER).toEqual(['sprinkle-boost', 'triple-sprinkle', 'gumdrop', 'bubble-shield', 'cupcake-rocket', 'rainbow-star']);
    expect(ITEM_IDS).toEqual([...ITEM_ORDER]);
    expect(Object.keys(ITEM_ICONS).sort()).toEqual([...ITEM_ORDER].sort());
  });

  it('every item has a name, emoji, colour, guide sentence, tip and callout', () => {
    for (const id of ITEM_ORDER) {
      const c = ITEM_CATALOG[id];
      expect(c.name.length, id).toBeGreaterThan(3);
      expect(c.emoji, id).toMatch(/\p{Extended_Pictographic}/u);
      expect(c.color, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.guide.length, id).toBeGreaterThan(20);
      expect(c.guide.length, id).toBeLessThan(120);
      expect(c.tip.length, id).toBeGreaterThan(10);
      expect(c.call.length, id).toBeGreaterThan(2);
      expect(ITEM_INFO[id]).toEqual({ name: c.name, emoji: c.emoji, color: c.color });
    }
  });

  it('every item looks different in the HUD (distinct emoji + colour)', () => {
    const emojis = ITEM_ORDER.map((id) => ITEM_CATALOG[id].emoji);
    const colors = ITEM_ORDER.map((id) => ITEM_CATALOG[id].color);
    expect(new Set(emojis).size).toBe(6);
    expect(new Set(colors).size).toBe(6);
  });

  it('maps bonk causes (incl. the race\'s "star" and legacy "rocket") to items', () => {
    expect(itemForCause('gumdrop')).toBe('gumdrop');
    expect(itemForCause('cupcake-rocket')).toBe('cupcake-rocket');
    expect(itemForCause('rocket')).toBe('cupcake-rocket');
    expect(itemForCause('star')).toBe('rainbow-star');
    expect(itemForCause('bubble-shield')).toBe('bubble-shield');
    expect(itemForCause('test')).toBeNull();
    expect(itemName('nope')).toBe('Surprise');
    expect(itemEmoji('nope')).toBe('🎁');
  });

  it('effectFraction clamps and survives junk', () => {
    expect(effectFraction(9, 18)).toBe(0.5);
    expect(effectFraction(30, 18)).toBe(1);
    expect(effectFraction(-1, 18)).toBe(0);
    expect(effectFraction(NaN, 18)).toBe(0);
    expect(effectFraction(5, 0)).toBe(0);
  });
});

describe('event -> fx / sfx cue table', () => {
  it('every item has box-hit, roulette, reveal, use and active cues', () => {
    for (const id of ITEM_ORDER) {
      const ev = eventsFor(id);
      for (const e of ['box-hit', 'roulette', 'reveal', 'use', 'active']) expect(ev, `${id} ${e}`).toContain(e);
      for (const e of ev) expect(ITEM_EVENTS).toContain(e);
    }
    expect(eventsFor('nope')).toEqual([]);
  });

  it('things that can bonk have impact cues; things that can be blocked have block cues', () => {
    for (const id of ['gumdrop', 'cupcake-rocket', 'rainbow-star']) expect(eventsFor(id), id).toContain('impact');
    for (const id of ['gumdrop', 'cupcake-rocket']) {
      expect(eventsFor(id), id).toContain('blocked');
      expect(eventsFor(id), id).toContain('dodged');
    }
    for (const id of ['bubble-shield', 'rainbow-star', 'sprinkle-boost', 'triple-sprinkle', 'cupcake-rocket', 'gumdrop']) {
      expect(eventsFor(id), id).toContain('end');
    }
  });

  it('EVERY item event has an fx and an sfx, and both are implemented', () => {
    const pairs = allCuePairs();
    expect(pairs.length).toBeGreaterThan(35);
    for (const [event, item] of pairs) {
      const cue = cueFor(event, item);
      expect(cue, `${event}/${item}`).toBeTruthy();
      expect(typeof cue.fx, `${event}/${item} fx`).toBe('string');
      expect(typeof cue.sfx, `${event}/${item} sfx`).toBe('string');
      expect(ALL_FX.has(cue.fx), `${event}/${item}: fx "${cue.fx}" has no implementation`).toBe(true);
      expect(typeof SFX[cue.sfx], `${event}/${item}: sfx "${cue.sfx}" is not in the SFX book`).toBe('function');
    }
    for (const cue of [THREAT_CUE, SCORE_CUE]) {
      expect(ALL_FX.has(cue.fx)).toBe(true);
      expect(typeof SFX[cue.sfx]).toBe('function');
    }
  });

  it('each item USE sounds different, and each impact sounds different', () => {
    const uses = ITEM_ORDER.map((id) => cueFor('use', id).sfx);
    expect(new Set(uses).size).toBe(6);
    const impacts = ['gumdrop', 'cupcake-rocket', 'star'].map((c) => cueFor('impact', c).sfx);
    expect(new Set(impacts).size).toBe(3);
    expect(cueFor('blocked', 'gumdrop').sfx).toBe(cueFor('blocked', 'cupcake-rocket').sfx);
    expect(uses).not.toContain(cueFor('blocked', 'gumdrop').sfx);
  });

  it('important cues duck the music a little (never to silence)', () => {
    for (const [event, item] of allCuePairs()) {
      const { duck } = cueFor(event, item);
      if (duck === undefined) continue;
      expect(duck, `${event}/${item}`).toBeGreaterThanOrEqual(0.4);
      expect(duck, `${event}/${item}`).toBeLessThan(1);
    }
    expect(cueFor('impact', 'gumdrop').duck).toBeDefined();
    expect(cueFor('blocked', 'cupcake-rocket').duck).toBeDefined();
    expect(cueFor('roulette').duck).toBeUndefined(); // ticks never duck
  });

  it('shared cues are item independent; unknown events give null', () => {
    expect(cueFor('box-hit', 'gumdrop')).toBe(cueFor('box-hit', 'rainbow-star'));
    expect(cueFor('reveal')).toEqual({ fx: 'hud-reveal', sfx: 'item-get' });
    expect(cueFor('impact', 'bubble-shield')).toBeNull();
    expect(cueFor('wobble', 'gumdrop')).toBeNull();
  });

  it('the 3D burst kinds cover the burst fx names used by the items', () => {
    for (const fx of ['box-pop', 'star-burst', 'bubble-pop', 'dodge-sparkle', 'gumdrop-plop', 'gumdrop-poof', 'rocket-launch', 'rocket-fizzle', 'rocket-trail', 'star-fade']) {
      expect(BURST_KINDS[fx], fx).toBeTruthy();
    }
  });
});

describe('items sound pack', () => {
  it('restyles only the built-ins it owns, and adds item-* names', () => {
    expect(itemsPack.override).toBe(true);
    for (const name of ITEM_SFX_NAMES) {
      const builtIn = SFX_OWNERS.items.includes(name);
      expect(builtIn || name.startsWith('item-'), name).toBe(true);
      expect(SFX[name], name).toBe(itemsPack.recipes[name]);
    }
    for (const owned of SFX_OWNERS.items) expect(ITEM_SFX_NAMES, owned).toContain(owned);
    // driving's boost stays driving's
    expect(ITEM_SFX_NAMES).not.toContain('boost');
  });
});
