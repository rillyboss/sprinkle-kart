/**
 * HUD toast lanes (Candy Arcade, family feedback: "the in game events can completely block the view
 * of the player"). Every in-race event popup — Hud.flash ("Mini-Turbo!", "Lap 2!"), item callouts,
 * the rocket warning — is a small toast in the viewport's edge-column lane: max 2 at once (the oldest
 * retires early), ~1.5 s each, one pinned warning on top, never mid-screen.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installFakeDom, fakeElement } from './helpers/fakeOverlayDom.js';
import {
  createLaneModel, createToastLane, laneFor, toastFromText, toneForText, toToast,
  LANE_MAX, LANE_TTL, LANE_TTL_MAX,
} from '../src/ui/kit/toastLane.js';
import { Hud, MAX_FLASHES, hudFontSize, itemHtml } from '../src/ui/Hud.js';
import { itemCalloutWidget, calloutToast, threatToast, CALLOUT_TONES } from '../src/ui/widgets/itemWidgets.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('lane model', () => {
  it('keeps at most LANE_MAX toasts; a newer one retires the oldest', () => {
    const m = createLaneModel();
    expect(LANE_MAX).toBe(2);
    m.push({ title: 'a' }, 0);
    m.push({ title: 'b' }, 0.1);
    const r = m.push({ title: 'c' }, 0.2);
    expect(r.dropped).toEqual([1]);
    expect(m.visible().map((t) => t.msg.title)).toEqual(['c', 'b']); // newest first
  });

  it('expires toasts after their ttl (default ~1.5 s, capped)', () => {
    const m = createLaneModel();
    m.push({ title: 'a' }, 0);
    m.push({ title: 'long', ttl: 99 }, 0);
    expect(m.expire(LANE_TTL - 0.01)).toEqual([]);
    expect(m.expire(LANE_TTL)).toEqual([1]);
    expect(m.size).toBe(1);
    expect(m.expire(LANE_TTL_MAX)).toEqual([2]);
    const short = createLaneModel({ ttl: 0.1 });
    short.push({ title: 'x' }, 0);
    expect(short.expire(0.39)).toEqual([]); // floor 0.4 s so a toast can be read
    expect(short.expire(0.4)).toHaveLength(1);
  });

  it('the same key refreshes in place instead of stacking (drift spam)', () => {
    const m = createLaneModel();
    const a = m.push({ title: 'Mini-Turbo!', key: 'drift' }, 0);
    const b = m.push({ title: 'Super Turbo!', key: 'drift' }, 1);
    expect(b.refreshed).toBe(true);
    expect(b.id).toBe(a.id);
    expect(m.size).toBe(1);
    expect(m.visible()[0].msg.title).toBe('Super Turbo!');
    expect(m.expire(1 + LANE_TTL - 0.01)).toEqual([]); // timer restarted
  });

  it('one pinned toast, not counted in the max', () => {
    const m = createLaneModel();
    expect(m.pin('rocket', { title: 'Rocket coming!' })).toBe(true);
    expect(m.pin('rocket', { title: 'Rocket coming!' })).toBe(false); // unchanged
    m.push({ title: 'a' }, 0);
    m.push({ title: 'b' }, 0);
    expect(m.size).toBe(2);
    expect(m.pinned.key).toBe('rocket');
    expect(m.unpin('other')).toBe(false);
    expect(m.unpin('rocket')).toBe(true);
    expect(m.unpin('rocket')).toBe(false);
    m.pin('x', { title: 'x' });
    expect(m.clear()).toHaveLength(2);
    expect(m.pinned).toBe(null);
  });
});

describe('legacy flash text -> toast', () => {
  it('moves the emoji to an SVG icon chip when the kit has one', () => {
    expect(toastFromText('Lap 2! 🍭')).toEqual({ title: 'Lap 2!', iconName: 'lollipop', emoji: '', tone: 'sky' });
    expect(toastFromText('📸 Photo finish!')).toMatchObject({ title: 'Photo finish!', iconName: 'camera', tone: 'lemon' });
    expect(toastFromText('Rocket Start! 🚀')).toMatchObject({ iconName: 'rocket', tone: 'raspberry' });
    expect(toastFromText('Keep going, you can do it! 💪')).toMatchObject({ iconName: 'heart', tone: 'mint' });
  });
  it('keeps an unknown emoji as the chip, and plain text as is', () => {
    expect(toastFromText('Hi there 🦄')).toMatchObject({ title: 'Hi there', iconName: '', emoji: '🦄' });
    expect(toastFromText('Plain')).toMatchObject({ title: 'Plain', iconName: '', emoji: '' });
    expect(toastFromText('🦄')).toMatchObject({ title: '🦄' });
    expect(toastFromText(null).title).toBe('');
  });
  it('tones by words', () => {
    expect(toneForText('FINAL lap')).toBe('sky');
    expect(toneForText('New record!')).toBe('lemon');
    expect(toneForText('Bonked!')).toBe('raspberry');
  });
  it('toToast normalizes objects (emoji -> icon, unknown icon dropped)', () => {
    expect(toToast({ title: 't', emoji: '🏆' })).toMatchObject({ iconName: 'trophy', emoji: '' });
    expect(toToast({ title: 't', iconName: 'nope' }).iconName).toBe('');
    expect(toToast({ title: 't', emoji: '🦄' })).toMatchObject({ emoji: '🦄' });
  });
});

describe('DOM lane', () => {
  it('mirrors the model: newest on top, leavers removed, registered for laneFor()', () => {
    vi.useFakeTimers();
    installFakeDom();
    const vp = fakeElement('div');
    const col = fakeElement('div');
    let now = 0;
    const lane = createToastLane(col, { now: () => now, register: vp });
    expect(laneFor(vp)).toBe(lane);
    expect(laneFor(null)).toBe(null);
    const list = col.querySelector('.ck-hudlane-list');
    lane.push('Mini-Turbo! 🔥');
    lane.push({ title: 'Gumdrop!', iconName: 'gumdrop', tone: 'mint' });
    lane.push('Lap 2! 🍭');
    vi.advanceTimersByTime(200);
    expect(list.childElementCount).toBe(2);
    expect(list.children[0].innerHTML).toContain('Lap 2!');
    expect(list.children[0].innerHTML).toContain('ck-icon-lollipop');
    expect(list.children[1].innerHTML).toContain('ck-toast--mint');
    now = 5;
    lane.update();
    vi.advanceTimersByTime(200);
    expect(list.childElementCount).toBe(0);
    lane.pin('rocket', { title: 'Rocket coming!', iconName: 'cupcake-rocket', tone: 'alert' });
    expect(col.querySelector('.ck-hudlane-pin').childElementCount).toBe(1);
    lane.unpin('rocket');
    vi.advanceTimersByTime(200);
    expect(col.querySelector('.ck-hudlane-pin').childElementCount).toBe(0);
    lane.destroy();
    expect(laneFor(vp)).toBe(null);
  });

  it('a refreshed key swaps its node in place', () => {
    vi.useFakeTimers();
    installFakeDom();
    const col = fakeElement('div');
    const lane = createToastLane(col, { now: () => 0 });
    lane.push({ title: 'one', key: 'k' });
    lane.push({ title: 'two', key: 'k' });
    const list = col.querySelector('.ck-hudlane-list');
    expect(list.childElementCount).toBe(1);
    expect(list.children[0].innerHTML).toContain('two');
    expect(list.children[0].className).toContain('is-bump');
  });

  it('works headless (model only)', () => {
    const lane = createToastLane(null);
    lane.push('x', 0);
    expect(lane.model.size).toBe(1);
    expect(lane.update(10)).toHaveLength(1);
    lane.pin('a', { title: 'a' });
    lane.unpin('a');
    lane.clear();
    lane.destroy();
  });
});

function makeHud(rects) {
  const doc = installFakeDom();
  doc.querySelectorAll = () => [];
  doc.head = fakeElement('head');
  doc.createTextNode = (t) => ({ textContent: t, nodeType: 3, children: [], classList: { contains: () => false } });
  const make = doc.createElement;
  doc.createElement = (t) => { const n = make(t); n.append = (...c) => c.forEach((x) => n.appendChild(x)); n.getContext = () => null; return n; };
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  const root = fakeElement('div');
  const hud = new Hud(root);
  hud.layout(rects);
  return hud;
}

describe('Hud toasts', () => {
  it('Hud.flash goes to that player\'s lane (max 2), toast() takes objects, unknown players are ignored', () => {
    vi.useFakeTimers();
    const hud = makeHud([{ playerIndex: 0, x: 0, y: 0, w: 640, h: 360 }, { playerIndex: 1, x: 640, y: 0, w: 640, h: 360 }]);
    expect(MAX_FLASHES).toBe(LANE_MAX);
    for (const t of ['Mini-Turbo! 💙', 'Lap 2! 🍭', 'Super Turbo! 🧡']) hud.flash(0, t);
    const vp = hud.vps.get(0);
    expect(vp.lane.model.visible().map((t) => t.msg.title)).toEqual(['Super Turbo!', 'Lap 2!']);
    expect(hud.vps.get(1).lane.model.size).toBe(0);
    expect(hud.toast(1, { title: 'Hi', iconName: 'star', tone: 'lemon' })).toBeTypeOf('number');
    expect(hud.flash(3, 'nobody')).toBe(null);
    // the lane lives in the edge column with the pre-built widget zones
    const edge = vp.node.querySelector('.sk-edgecol');
    expect(edge.querySelector('.ck-hudlane')).toBeTruthy();
    expect(edge.querySelector('.sk-wzone-under-cluster')).toBeTruthy();
    expect(edge.querySelector('.sk-wzone-callout')).toBeTruthy();
    expect(vp.node.querySelector('.sk-flashes')).toBe(null); // no more mid-screen flash band
    hud.reset();
    expect(vp.lane.model.size).toBe(0);
    hud.layout([{ playerIndex: 1, x: 0, y: 0, w: 1280, h: 720 }]); // P1 leaves: its lane is destroyed
    expect(laneFor(vp.node)).toBe(null);
    hud.dispose();
  });

  it('HUD font size scales with the viewport (1p ≈ 27 px at 720p, 4p ≈ 13 px), clamped', () => {
    expect(hudFontSize(1280, 720)).toBeCloseTo(26.67, 1);
    expect(hudFontSize(640, 360)).toBeCloseTo(13.33, 1);
    expect(hudFontSize(100, 100)).toBe(11);
    expect(hudFontSize(4000, 3000)).toBe(36);
    expect(hudFontSize(-5, 10)).toBe(11);
  });

  it('item slot shows SVG item stickers (no emoji) and the Triple Sprinkle charges', () => {
    expect(itemHtml('gumdrop')).toContain('ck-icon-gumdrop');
    expect(itemHtml('triple-sprinkle', { total: 3, left: 2 })).toContain('×2');
    expect(itemHtml('nope')).toBe('');
    expect(itemHtml('cupcake-rocket')).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('item callouts in the lane', () => {
  it('calloutToast maps feed tones + item emoji to kit tones + icons, ttl within the lane limits', () => {
    expect(CALLOUT_TONES.good).toBe('mint');
    expect(calloutToast({ id: 1, emoji: '🧁', title: 'Cupcake Rocket!', sub: 'Zooming after Lenny!', tone: 'use', at: 0, until: 1.8 }))
      .toEqual({ title: 'Cupcake Rocket!', sub: 'Zooming after Lenny!', iconName: 'cupcake-rocket', emoji: '', tone: 'raspberry', ttl: 1.8 });
    expect(calloutToast({ emoji: '🦄', title: 'x', tone: 'weird', at: 0, until: 9 })).toMatchObject({ emoji: '🦄', tone: 'raspberry', ttl: LANE_TTL_MAX });
    expect(calloutToast({ title: 'x' }).ttl).toBeUndefined();
    expect(calloutToast(null).title).toBe('');
    expect(threatToast({ closeness: 0.9 })).toMatchObject({ title: 'Rocket coming!', sub: 'Here it comes!', iconName: 'cupcake-rocket', tone: 'alert' });
  });

  it('pushes each feed callout once into the Hud lane and pins / unpins the rocket warning', () => {
    vi.useFakeTimers();
    installFakeDom();
    const vp = fakeElement('div');
    const col = fakeElement('div');
    const lane = createToastLane(col, { now: () => 0, register: vp });
    const msgs = [{ id: 1, emoji: '🍬', title: 'Sprinkle Boost!', tone: 'use', at: 0, until: 1.5 }];
    const state = { feed: { active: () => msgs } };
    const w = itemCalloutWidget(state).create(fakeElement('div'), 0, vp);
    const kart = { distance: 100, name: 'Me' };
    const rocket = { target: kart, owner: { name: 'Lenny' }, distance: 95 };
    w.update(kart, { clock: 0, items: { rockets: [rocket] } });
    w.update(kart, { clock: 0.1, items: { rockets: [rocket] } });
    expect(lane.model.size).toBe(1);
    expect(lane.model.pinned?.key).toBe('rocket');
    msgs.push({ id: 2, emoji: '🫧', title: 'Bubble blocked it!', tone: 'block', at: 0.2, until: 1.6 });
    w.update(kart, { clock: 0.2, items: { rockets: [] } });
    expect(lane.model.size).toBe(2);
    expect(lane.model.pinned).toBe(null);
    w.reset();
    w.destroy();
  });

  it('makes its own lane when the viewport has none', () => {
    vi.useFakeTimers();
    installFakeDom();
    const box = fakeElement('div');
    const state = { feed: { active: () => [{ id: 7, emoji: '🌟', title: 'Star power!', tone: 'good', at: 0, until: 1 }] } };
    const w = itemCalloutWidget(state).create(box, 0, fakeElement('div'));
    w.update({ distance: 0 }, { clock: 0, items: { rockets: [] } });
    expect(box.querySelector('.ck-hudlane')).toBeTruthy();
    w.update({ distance: 0 }, { clock: 5, items: { rockets: [] } });
    w.destroy();
    expect(box.querySelector('.ck-hudlane')).toBe(null);
  });
});
