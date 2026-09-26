/**
 * Item callouts: the per-player feed, event routing (who sees what, both sides
 * of a bonk), and the widgets being registered on the HUD.
 */
import { describe, it, expect } from 'vitest';
import { createItemFeed, CALLOUT_TTL } from '../src/ui/widgets/itemFeed.js';
import itemCallouts, { calloutsForEvent, createCalloutState, withIcon } from '../src/systems/itemCallouts.js';
import { createEventBus } from '../src/game/events.js';
import { createSessionHelpers } from '../src/game/session.js';

describe('item feed', () => {
  it('shows callouts for their ttl, per player', () => {
    const f = createItemFeed();
    f.push(0, { title: 'A', tone: 'use' }, 10);
    f.push(1, { title: 'B', tone: 'oops' }, 10);
    expect(f.active(0, 10.1).map((m) => m.title)).toEqual(['A']);
    expect(f.active(1, 10.1).map((m) => m.title)).toEqual(['B']);
    expect(f.active(0, 10 + CALLOUT_TTL.use + 0.01)).toEqual([]);
    expect(f.active(1, 10 + CALLOUT_TTL.use + 0.01)).toHaveLength(1); // oops lasts longer
    expect(f.active(2, 10)).toEqual([]);
  });

  it('same key replaces instead of stacking; max caps the stack', () => {
    const f = createItemFeed({ max: 2 });
    f.push(0, { key: 'use', title: '3 left' }, 0);
    f.push(0, { key: 'use', title: '2 left' }, 0.2);
    expect(f.active(0, 0.3).map((m) => m.title)).toEqual(['2 left']);
    f.push(0, { title: 'x' }, 0.3);
    f.push(0, { title: 'y' }, 0.4);
    expect(f.active(0, 0.5).map((m) => m.title)).toEqual(['x', 'y']);
  });

  it('custom ttl, ids increase, clear, junk input and a new race clock', () => {
    const f = createItemFeed();
    const a = f.push(0, { title: 'a', ttl: 5 }, 30);
    const b = f.push(0, { title: 'b', ttl: 5 }, 30);
    expect(b.id).toBeGreaterThan(a.id);
    expect(f.active(0, 34.9)).toHaveLength(2);
    expect(f.push(null, { title: 'n' }, 0)).toBeNull();
    expect(f.push(0, null, 0)).toBeNull();
    expect(f.active(0, 0.2)).toEqual([]); // clock went back (new race): old callouts are gone
    f.push(0, { title: 'c' }, 0);
    f.push(1, { title: 'd' }, 0);
    f.clear(0);
    expect(f.size).toBe(1);
    f.clear();
    expect(f.size).toBe(0);
  });
});

describe('withIcon', () => {
  it('moves a matching trailing emoji into the icon column', () => {
    expect(withIcon('Phew! Dodged it! 😅', '😅')).toEqual({ emoji: '😅', title: 'Phew! Dodged it!' });
    expect(withIcon('Bubble saved you! 🫧', '🫧')).toEqual({ emoji: '🫧', title: 'Bubble saved you!' });
    expect(withIcon("Bonked by Lenny's Gumdrop! 💫", '🟢')).toEqual({ emoji: '🟢', title: "Bonked by Lenny's Gumdrop! 💫" });
    expect(withIcon(null, '✨')).toEqual({ emoji: '✨', title: '' });
  });
});

const human = (pi, name) => ({ playerIndex: pi, isCPU: false, name, characterId: 'rocco', charDef: { id: 'rocco' } });
const cpu = (name) => ({ playerIndex: null, isCPU: true, name, characterId: 'lenny', charDef: { id: 'lenny' } });

function session(nHumans = 2, extra = {}) {
  const humans = Array.from({ length: nHumans }, (_, i) => ({ playerIndex: i, deviceId: i ? `gp${i}` : 'kb1', characterId: 'rocco' }));
  return { ...createSessionHelpers({ humans }), humans, race: { clock: 5, items: { rockets: [] } }, ...extra };
}

describe('callout routing', () => {
  const titles = (state, pi) => state.feed.active(pi, 5.01).map((m) => m.title);

  it('using an item: a big callout for that player only (CPUs get none)', () => {
    const st = createCalloutState();
    const s = session();
    calloutsForEvent(st, 'item-use', { kart: human(0, 'Rocco'), item: 'bubble-shield' }, s);
    calloutsForEvent(st, 'item-use', { kart: cpu('Lenny'), item: 'gumdrop' }, s);
    expect(titles(st, 0)).toEqual(['Bubble Shield!']);
    expect(titles(st, 1)).toEqual([]);
  });

  it('a rocket callout names its target', () => {
    const st = createCalloutState();
    const me = human(0, 'Rocco');
    const s = session(1, { race: { clock: 5, items: { rockets: [{ owner: me, target: cpu('Lenny') }] } } });
    calloutsForEvent(st, 'item-use', { kart: me, item: 'cupcake-rocket' }, s);
    expect(st.feed.active(0, 5.01)[0]).toMatchObject({ title: 'Cupcake Rocket!', sub: 'Zooming after Lenny!', emoji: '🧁' });
  });

  it('Triple Sprinkle counts down in ONE callout', () => {
    const st = createCalloutState();
    const s = session(1);
    const me = human(0, 'Rocco');
    calloutsForEvent(st, 'item-use', { kart: me, item: 'triple-sprinkle', chargesLeft: 2 }, s);
    calloutsForEvent(st, 'item-use', { kart: me, item: 'triple-sprinkle', chargesLeft: 1 }, s);
    const list = st.feed.active(0, 5.01);
    expect(list).toHaveLength(1);
    expect(list[0].sub).toBe('1 more to go!');
  });

  it('a bonk between two humans shows both sides', () => {
    const st = createCalloutState();
    const s = session(2);
    const a = human(0, 'Rocco');
    const b = human(1, 'Captain Crumbs');
    calloutsForEvent(st, 'bonked', { kart: a, by: b, cause: 'gumdrop' }, s);
    expect(st.feed.active(0, 5.01)[0]).toMatchObject({ tone: 'oops', emoji: '🟢', title: "Bonked by Captain Crumbs' Gumdrop! 💫" });
    expect(st.feed.active(1, 5.01)[0]).toMatchObject({ tone: 'good', emoji: '🎯', title: 'You bonked Rocco!' });
  });

  it('a CPU bonking you still names the CPU; you bonking a CPU still cheers', () => {
    const st = createCalloutState();
    const s = session(1);
    const me = human(0, 'Rocco');
    calloutsForEvent(st, 'bonked', { kart: me, by: cpu('Lenny'), cause: 'cupcake-rocket' }, s);
    expect(titles(st, 0)).toEqual(["Bonked by Lenny's Cupcake Rocket! 💫"]);
    const st2 = createCalloutState();
    calloutsForEvent(st2, 'bonked', { kart: cpu('Lenny'), by: me, cause: 'star' }, s);
    expect(titles(st2, 0)).toEqual(['You twirled Lenny!']);
  });

  it('shield blocks (both sides) and shield expiry', () => {
    const st = createCalloutState();
    const s = session(2);
    const a = human(0, 'Rocco');
    const b = human(1, 'Lenny');
    calloutsForEvent(st, 'shield-pop', { kart: a, by: b, cause: 'cupcake-rocket' }, s);
    expect(titles(st, 0)).toEqual(["Bubble blocked Lenny's Cupcake Rocket!"]);
    expect(titles(st, 1)).toEqual(["Rocco's bubble blocked it!"]);
    const st2 = createCalloutState();
    calloutsForEvent(st2, 'shield-pop', { kart: a, expired: true }, s);
    expect(titles(st2, 0)).toEqual(['Bubble popped!']);
  });

  it('dodges and effect endings', () => {
    const st = createCalloutState();
    const s = session(2);
    const a = human(0, 'Rocco');
    const b = human(1, 'Lenny');
    calloutsForEvent(st, 'item-dodged', { kart: a, by: b, item: 'gumdrop' }, s);
    expect(titles(st, 0)).toEqual(['Phew! Dodged the Gumdrop!']);
    expect(titles(st, 1)).toEqual(['Rocco dodged your Gumdrop!']);
    const st2 = createCalloutState();
    calloutsForEvent(st2, 'item-end', { kart: a, item: 'rainbow-star' }, s);
    calloutsForEvent(st2, 'item-end', { kart: a, item: 'sprinkle-boost' }, s); // boosts end quietly
    expect(titles(st2, 0)).toEqual(['Star power all done']);
    calloutsForEvent(st2, 'lap', { kart: a }, s); // unrelated events are ignored
    expect(titles(st2, 0)).toHaveLength(1);
  });
});

describe('item-callouts system', () => {
  it('registers the three power-up widgets in their reserved zones and removes them on uninstall', () => {
    const added = [];
    const removed = [];
    const hud = { addWidget(def) { added.push(def); return () => removed.push(def.id); } };
    const bus = createEventBus({ onError: (e) => { throw e; } });
    const off = itemCallouts.install(bus, { hud, input: { getDevice: (id) => ({ id, type: 'gamepad', kind: 'playstation' }) } });
    expect(added.map((d) => [d.id, d.anchor])).toEqual([['item-card', 'under-cluster'], ['item-callout', 'callout'], ['item-edge', undefined]]);
    off();
    expect(removed).toEqual(['item-card', 'item-callout', 'item-edge']);
  });

  it('works without a HUD (tests / headless) and routes race events', () => {
    const bus = createEventBus({ onError: (e) => { throw e; } });
    const off = itemCallouts.install(bus, {});
    const s = session(1);
    expect(() => {
      bus.emit('race-start', { humans: s.humans }, s);
      bus.emit('race:item-use', { type: 'item-use', kart: human(0, 'Rocco'), item: 'gumdrop' }, s);
      bus.emit('race:bonked', { type: 'bonked', kart: human(0, 'Rocco'), by: cpu('Lenny'), cause: 'gumdrop' }, s);
      bus.emit('race-exit', {}, s);
    }).not.toThrow();
    off();
  });
});
