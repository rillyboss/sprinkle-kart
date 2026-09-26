// Touch controls — layout rects, TouchDevice → DriveInput, InputManager external devices,
// pointer routing, installation, menu gestures, click attribution, settings reducer.
import { describe, it, expect, vi } from 'vitest';
import { InputManager } from '../src/input/InputManager.js';
import {
  computeTouchLayout, layoutControlSet, touchSafeRects, touchZones, centerKeepout, rectsOverlap,
  hitControl, inSteerZone, zoneAt, unitFor, MIN_TAP,
} from '../src/input/touch/touchLayout.js';
import { TouchDevice, makeHaptics, TOUCH_LABELS } from '../src/input/touch/TouchDevice.js';
import { TouchPointerRouter } from '../src/input/touch/pointerRouter.js';
import { installTouchInput, isTouchCapable, touchDeviceName } from '../src/input/touch/installTouch.js';
import { createTouchSettingsStore } from '../src/input/touch/touchSettings.js';
import { MenuGestureController, CLICK_SUPPRESS_MS } from '../src/input/touch/menuGestures.js';
import { clickDevice } from '../src/input/touch/clickDevice.js';
import {
  createTouchSettingsState, touchSettingsReduce, visibleRows, rowValueText, TOUCH_ROWS, TOUCH_ROW_TEXT,
} from '../src/input/touch/touchSettingsState.js';
import { setTouchRuntime, getTouchRuntime, getTouchSafeRects, touchUiWanted } from '../src/input/touch/touchRuntime.js';
import { deviceIcon } from '../src/ui/hudLogic.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
class FakeTarget {
  constructor() { this.l = new Map(); }
  addEventListener(t, fn) { if (!this.l.has(t)) this.l.set(t, new Set()); this.l.get(t).add(fn); }
  removeEventListener(t, fn) { this.l.get(t)?.delete(fn); }
  dispatch(t, props = {}) { for (const fn of this.l.get(t) ?? []) fn({ type: t, preventDefault() {}, ...props }); }
  count(t) { return this.l.get(t)?.size ?? 0; }
}
function makeInput() {
  let t = 1000;
  const target = new FakeTarget();
  const input = new InputManager(target, { getGamepads: () => [], now: () => t });
  return { input, target, tick: (ms = 16) => { t += ms; input.update(); } };
}

const PHONE = { width: 844, height: 390 };
const TABLET = { width: 1194, height: 834 };
const PORTRAIT = { width: 390, height: 844 };
const STYLES = ['joystick', 'buttons', 'tilt'];

describe('touch layout', () => {
  const visible = (set) => set.controls;
  for (const [name, scr] of Object.entries({ PHONE, TABLET, PORTRAIT })) {
    for (const style of STYLES) {
      for (const autoGas of [true, false]) {
        for (const leftHanded of [false, true]) {
          it(`${name} ${style} autoGas=${autoGas} leftHanded=${leftHanded}: inside, big enough, no overlaps, road centre free`, () => {
            const lay = computeTouchLayout({ ...scr, settings: { style, autoGas, leftHanded }, safe: { left: 44, right: 44, bottom: 21 } });
            const set = lay.players[0];
            const keep = centerKeepout(set.zone);
            const cs = visible(set);
            for (const c of cs) {
              expect(c.x, c.id).toBeGreaterThanOrEqual(-0.5);
              expect(c.y, c.id).toBeGreaterThanOrEqual(-0.5);
              expect(c.x + c.w, c.id).toBeLessThanOrEqual(scr.width + 0.5);
              expect(c.y + c.h, c.id).toBeLessThanOrEqual(scr.height + 0.5);
              expect(Math.min(c.w, c.h), c.id).toBeGreaterThanOrEqual(MIN_TAP - 0.01);
              if (c.id !== 'pause') expect(rectsOverlap(c, keep), `${c.id} covers the road`).toBe(false);
            }
            for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
              expect(rectsOverlap(cs[i], cs[j]), `${cs[i].id} × ${cs[j].id}`).toBe(false);
            }
            const ids = cs.map((c) => c.id);
            expect(ids).toContain('item');
            expect(ids).toContain('drift');
            expect(ids).toContain('brake');
            expect(ids).toContain('pause');
            expect(ids.includes('gas')).toBe(!autoGas);
            expect(ids.includes('stick')).toBe(style === 'joystick');
            expect(ids.includes('left') && ids.includes('right')).toBe(style === 'buttons');
            expect(ids.includes('recenter')).toBe(style === 'tilt');
          });
        }
      }
    }
  }
  it('safe-area insets push controls in from the edges', () => {
    const a = layoutControlSet({ x: 0, y: 0, ...{ w: 844, h: 390 } }, {}, {});
    const b = layoutControlSet({ x: 0, y: 0, w: 844, h: 390 }, {}, { left: 47, right: 47, bottom: 21 });
    const item = (s) => s.controls.find((c) => c.id === 'item');
    const stick = (s) => s.controls.find((c) => c.id === 'stick');
    expect(item(b).x + item(b).w).toBeLessThanOrEqual(844 - 47);
    expect(item(b).x).toBeLessThan(item(a).x);
    expect(stick(b).x).toBeGreaterThan(stick(a).x);
    expect(item(b).y).toBeLessThan(item(a).y);
  });
  it('left-handed mirrors the set', () => {
    const r = layoutControlSet({ x: 0, y: 0, w: 844, h: 390 }, { leftHanded: false });
    const l = layoutControlSet({ x: 0, y: 0, w: 844, h: 390 }, { leftHanded: true });
    const ri = r.controls.find((c) => c.id === 'item');
    const li = l.controls.find((c) => c.id === 'item');
    expect(li.cx).toBeCloseTo(844 - ri.cx);
    expect(l.steerZone.x).toBeGreaterThan(400);
    expect(r.steerZone.x).toBe(0);
  });
  it('size setting scales the buttons', () => {
    const z = { x: 0, y: 0, w: 1194, h: 834 };
    expect(unitFor(z, 'large')).toBeGreaterThan(unitFor(z, 'medium'));
    expect(unitFor(z, 'small')).toBeLessThan(unitFor(z, 'medium'));
  });
  it('tablet buttons are bigger than phone buttons', () => {
    const p = computeTouchLayout({ ...PHONE }).players[0].controls.find((c) => c.id === 'item');
    const t = computeTouchLayout({ ...TABLET }).players[0].controls.find((c) => c.id === 'item');
    expect(t.w).toBeGreaterThan(p.w);
  });
  it('two touch players: left / right halves, each with a full set', () => {
    expect(touchZones(2, 1194, 834)).toEqual([{ x: 0, y: 0, w: 597, h: 834 }, { x: 597, y: 0, w: 597, h: 834 }]);
    const lay = computeTouchLayout({ ...TABLET, players: 2, safe: { left: 20, right: 20 } });
    expect(lay.players).toHaveLength(2);
    const [a, b] = lay.players;
    for (const c of a.controls) expect(c.x + c.w).toBeLessThanOrEqual(597 + 0.5);
    for (const c of b.controls) expect(c.x).toBeGreaterThanOrEqual(597 - 0.5);
    expect(zoneAt(lay, 100, 400)).toBe(0);
    expect(zoneAt(lay, 900, 400)).toBe(1);
    expect(zoneAt(lay, -5, 400)).toBe(-1);
    const rects = touchSafeRects(lay);
    expect(rects.some((r) => r.player === 1 && r.id === 'item')).toBe(true);
    expect(rects.every((r) => ['id', 'player', 'x', 'y', 'w', 'h'].every((k) => k in r))).toBe(true);
  });
  it('hitControl: circles with slop, boxes, misses; inSteerZone', () => {
    const set = layoutControlSet({ x: 0, y: 0, w: 844, h: 390 }, { style: 'buttons' });
    const item = set.controls.find((c) => c.id === 'item');
    expect(hitControl(set, item.cx, item.cy).id).toBe('item');
    expect(hitControl(set, item.cx + item.r + 3, item.cy).id).toBe('item');
    expect(hitControl(set, 422, 100)).toBe(null);
    const left = set.controls.find((c) => c.id === 'left');
    expect(hitControl(set, left.cx, left.cy).id).toBe('left');
    expect(inSteerZone(set, 20, 380)).toBe(true);
    expect(inSteerZone(set, 800, 380)).toBe(false);
    expect(inSteerZone(null, 0, 0)).toBe(false);
    expect(touchSafeRects(null)).toEqual([]);
  });
});

describe('TouchDevice → gamepad-shaped frame', () => {
  it('auto-gas drives forward with no finger down; brake overrides', () => {
    const d = new TouchDevice();
    let f = d.read();
    expect(f.accel).toBe(1);
    expect(f.brake).toBe(0);
    d.press('brake');
    f = d.read();
    expect(f.accel).toBe(0);
    expect(f.brake).toBe(1);
  });
  it('manual gas needs the GO button', () => {
    const d = new TouchDevice({ settings: { autoGas: false } });
    expect(d.read().accel).toBe(0);
    d.press('gas');
    expect(d.read().accel).toBe(1);
    d.release('gas');
    expect(d.read().accel).toBe(0);
  });
  it('steering priority: buttons > stick > tilt (tilt only in tilt style)', () => {
    const d = new TouchDevice({ settings: { style: 'tilt' } });
    d.setTiltSteer(0.4);
    expect(d.steer()).toBe(0.4);
    d.setStickSteer(-0.7);
    expect(d.steer()).toBe(-0.7);
    d.press('right');
    expect(d.steer()).toBe(1);
    d.press('left');
    expect(d.steer()).toBe(0);
    d.release('right');
    expect(d.steer()).toBe(-1);
    d.releaseAll();
    d.setSettings({ style: 'joystick' });
    expect(d.steer()).toBe(0); // tilt ignored outside tilt style
    d.setStickSteer(5);
    expect(d.steer()).toBe(1);
    d.setStickSteer(NaN);
    expect(d.steer()).toBe(0);
  });
  it('taps and menu events last one frame; unknown names ignored', () => {
    const d = new TouchDevice();
    d.tap('item');
    d.tap('rocket');
    d.menu('right');
    d.menu('explode');
    d.press('nope');
    const f = d.read();
    expect([...f.taps].sort()).toEqual(['item', 'right']);
    expect(d.read().taps.size).toBe(0);
    d.press('drift'); d.press('lookBack');
    expect(d.read().held).toEqual({ drift: true, lookBack: true });
  });
  it('rumble → vibrate, scaled, respects the haptics setting', () => {
    const calls = [];
    const d = new TouchDevice();
    d.rumble(1, 100); // no haptics fn yet
    d.haptics = (ms) => calls.push(ms);
    d.rumble(1, 100);
    d.rumble(0, 100);
    d.rumble(1, 5000);
    expect(calls).toEqual([100, 50, 400]);
    d.setSettings({ haptics: false });
    d.rumble(1, 100);
    expect(calls).toHaveLength(3);
    d.setSettings({ haptics: true });
    d.haptics = () => { throw new Error('nope'); };
    expect(() => d.rumble()).not.toThrow();
  });
  it('makeHaptics wraps navigator.vibrate', () => {
    expect(makeHaptics(undefined)).toBe(null);
    expect(makeHaptics({})).toBe(null);
    const nav = { vibrate: vi.fn() };
    makeHaptics(nav)(30);
    expect(nav.vibrate).toHaveBeenCalledWith(30);
    expect(() => makeHaptics({ vibrate() { throw new Error('x'); } })(1)).not.toThrow();
  });
});

describe('InputManager external devices', () => {
  it('a touch device behaves like a pad: DriveInput, item edge, pause, menu events', () => {
    const { input, tick } = makeInput();
    const dev = new TouchDevice({ id: 'touch1' });
    const events = [];
    input.onDeviceChange((e) => events.push(`${e.type}:${e.deviceId}`));
    const pub = input.addExternalDevice('touch1', { read: () => dev.read() }, { name: 'Touch screen', icon: '👆', labels: TOUCH_LABELS, pointerType: 'touch' });
    expect(pub).toMatchObject({ id: 'touch1', type: 'touch', kind: 'touch', icon: '👆', connected: true });
    expect(events).toEqual(['connected:touch1']);
    dev.setStickSteer(0.5);
    dev.tap('item');
    tick();
    let di = input.getDriveInput('touch1');
    expect(di).toMatchObject({ steer: 0.5, accel: 1, brake: 0, drift: false, useItem: true });
    tick();
    di = input.getDriveInput('touch1');
    expect(di.useItem).toBe(false); // edge lasts one update
    dev.tap('pause');
    tick();
    expect(input.isPausePressed('touch1')).toBe(true);
    expect(input.getPauseDevice()).toBe('touch1');
    input.consumeMenuEvents();
    dev.menu('right');
    dev.menu('toggle');
    tick();
    expect(input.consumeMenuEvents()).toEqual([{ deviceId: 'touch1', action: 'toggle' }, { deviceId: 'touch1', action: 'right' }]);
  });
  it('orders devices keyboards → gamepads → touch → virtual and exposes the icon', () => {
    const { input } = makeInput();
    input.addVirtualDevice('bot');
    input.addExternalDevice('touch1', { read: () => null });
    expect(input.getDevices().map((d) => d.id)).toEqual(['kb1', 'kb2', 'touch1', 'bot']);
    expect(input.getDevice('kb1').icon).toBeUndefined();
  });
  it('validates ids / sources, replaces an external device, refuses real ids', () => {
    const { input } = makeInput();
    expect(() => input.addExternalDevice('', { read() {} })).toThrow();
    expect(() => input.addExternalDevice('t', {})).toThrow();
    expect(() => input.addExternalDevice('kb1', { read() {} })).toThrow();
    input.addExternalDevice('t', { read: () => null }, { name: 'A' });
    input.addExternalDevice('t', { read: () => null }, { name: 'B' });
    expect(input.getDevice('t').name).toBe('B');
  });
  it('a throwing or empty source gives a neutral frame', () => {
    const { input, tick } = makeInput();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    input.addExternalDevice('t', { read() { throw new Error('boom'); } });
    input.addExternalDevice('u', { read: () => 42 });
    tick();
    expect(input.getDriveInput('t')).toMatchObject({ steer: 0, accel: 0 });
    expect(input.getDriveInput('u')).toMatchObject({ steer: 0, accel: 0 });
    err.mockRestore();
  });
  it('remove: disconnected event, queued events dropped, neutral input', () => {
    const { input, tick } = makeInput();
    const dev = new TouchDevice({ id: 'touch1' });
    input.addExternalDevice('touch1', { read: () => dev.read() });
    const events = [];
    input.onDeviceChange((e) => events.push(e.type));
    dev.menu('confirm');
    tick();
    input.removeExternalDevice('touch1');
    input.removeExternalDevice('touch1');
    input.removeExternalDevice('kb1'); // not external: ignored
    expect(events).toEqual(['disconnected']);
    expect(input.consumeMenuEvents()).toEqual([]);
    expect(input.getDriveInput('touch1').accel).toBe(0);
    expect(input.isConnected('kb1')).toBe(true);
  });
  it('rumble reaches the touch source (not keyboards)', () => {
    const { input } = makeInput();
    const rumble = vi.fn();
    input.addExternalDevice('touch1', { read: () => null, rumble });
    input.rumble('touch1', 0.8, 120);
    expect(rumble).toHaveBeenCalledWith(0.8, 120);
    input.rumble('touch1', 0, 120);
    input.rumble('kb1', 1, 100);
    input.setRumbleEnabled(false);
    input.rumble('touch1', 1, 100);
    expect(rumble).toHaveBeenCalledTimes(1);
    input.setRumbleEnabled(true);
    input.addExternalDevice('t2', { read: () => null, rumble() { throw new Error('x'); } });
    expect(() => input.rumble('t2', 1, 50)).not.toThrow();
  });
  it('remembers the last pointer type; pointerDevice picks a free matching device', () => {
    const { input, target } = makeInput();
    expect(input.pointerDevice()).toBe(null);
    input.addExternalDevice('touch1', { read: () => null }, { pointerType: 'touch' });
    input.addExternalDevice('touch2', { read: () => null }, { pointerType: 'touch' });
    target.dispatch('pointerdown', { pointerType: 'mouse' });
    expect(input.lastPointerType).toBe('mouse');
    expect(input.pointerDevice()).toBe(null);
    target.dispatch('pointerdown', { pointerType: 'touch' });
    expect(input.pointerDevice()).toBe('touch1');
    expect(input.pointerDevice(['touch1'])).toBe('touch2');
    expect(input.pointerDevice(['touch1', 'touch2'])).toBe(null);
    target.dispatch('pointerdown', { pointerType: 'mouse' });
    target.dispatch('touchend', {});
    expect(input.lastPointerType).toBe('touch');
    target.dispatch('pointerdown', {}); // no type: unchanged
    expect(input.lastPointerType).toBe('touch');
  });
});

describe('clickDevice (menu clicks → touch player)', () => {
  it('mouse clicks keep the keyboard fallback', () => {
    const { input, target } = makeInput();
    input.addExternalDevice('touch1', { read: () => null }, { type: 'touch', pointerType: 'touch' });
    target.dispatch('pointerdown', { pointerType: 'mouse' });
    expect(clickDevice(input, [], 'kb1')).toBe('kb1');
  });
  it('a tap picks the touch device, and a tap with every touch seat taken is ignored', () => {
    const { input, target } = makeInput();
    input.addExternalDevice('touch1', { read: () => null }, { type: 'touch', pointerType: 'touch' });
    target.dispatch('pointerdown', { pointerType: 'touch' });
    expect(clickDevice(input, [], 'kb1')).toBe('touch1');
    expect(clickDevice(input, ['touch1'], 'kb2')).toBe(null);
  });
  it('no touch devices, no input or a throwing input fall back', () => {
    const { input, target } = makeInput();
    target.dispatch('pointerdown', { pointerType: 'touch' });
    expect(clickDevice(input, [], 'kb1')).toBe('kb1');
    expect(clickDevice(null, [], 'kb2')).toBe('kb2');
    expect(clickDevice({ pointerDevice() { throw new Error('x'); }, lastPointerType: 'touch', getDevices() { throw new Error('y'); } }, [], 'kb1')).toBe('kb1');
  });
  it('the join slot shows the touch icon', () => {
    expect(deviceIcon('touch1', [{ id: 'touch1', type: 'touch', icon: '👆' }])).toBe('👆');
    expect(deviceIcon('kb1', [])).toBe('⌨️');
  });
});

describe('TouchPointerRouter (multi-touch → presses)', () => {
  const setup = (settings = {}, players = 1, scr = PHONE) => {
    const devs = [new TouchDevice({ id: 'touch1', settings }), new TouchDevice({ id: 'touch2', settings })];
    const onRecenter = vi.fn();
    const r = new TouchPointerRouter({ onRecenter, onPress: () => { throw new Error('optional'); } });
    const lay = computeTouchLayout({ ...scr, settings, players });
    r.setLayout(lay, devs.slice(0, players).map((d) => ({ deviceId: d.id, device: d })));
    const ctl = (id, set = 0) => lay.players[set].controls.find((c) => c.id === id);
    return { r, lay, devs, ctl, onRecenter };
  };
  it('floating stick: thumb lands anywhere in the steer zone, drag steers, lift recentres', () => {
    const { r, devs } = setup();
    expect(r.down(1, 150, 250, 0)).toBe('stick');
    r.move(1, 200, 250); // within the radius: the base stays put
    expect(devs[0].read().steer).toBeGreaterThan(0.5);
    const v = r.view()[0];
    expect(v.stick.active).toBe(true);
    expect(v.stick.origin).toEqual({ x: 150, y: 250 });
    r.up(1);
    expect(devs[0].read().steer).toBe(0);
    expect(r.view()[0].stick.active).toBe(false);
  });
  it('steer + drift + item at once (three thumbs)', () => {
    const { r, devs, ctl } = setup();
    r.down(1, 100, 300, 0);
    r.move(1, 20, 300);
    const hop = ctl('drift');
    const item = ctl('item');
    expect(r.down(2, hop.cx, hop.cy, 0)).toBe('drift');
    expect(r.down(3, item.cx, item.cy, 0)).toBe('item');
    const f = devs[0].read();
    expect(f.steer).toBeLessThan(-0.8);
    expect(f.held.drift).toBe(true);
    expect(f.taps.has('item')).toBe(true);
    expect(r.view()[0].pressed.has('item')).toBe(true);
    r.up(3);
    expect(r.view()[0].pressed.has('item')).toBe(false);
    r.up(2);
    expect(devs[0].read().held.drift).toBe(false);
  });
  it('pause is a tap; misses and dead space do nothing', () => {
    const { r, devs, ctl } = setup();
    const p = ctl('pause');
    r.down(1, p.cx, p.cy, 0);
    expect(devs[0].read().taps.has('pause')).toBe(true);
    expect(r.down(2, 422, 120, 0)).toBe(null); // top middle, not a control
    expect(r.down(3, -10, -10, 0)).toBe(null);
    r.move(99, 1, 1);
    r.up(99);
  });
  it('the same pointer id reused without an up releases the old press first', () => {
    const { r, devs, ctl } = setup({ autoGas: false });
    const gas = ctl('gas');
    r.down(1, gas.cx, gas.cy, 0);
    expect(devs[0].read().accel).toBe(1);
    r.down(1, 422, 120, 0);
    expect(devs[0].read().accel).toBe(0);
  });
  it('buttons style: forgiving steer zone and sliding between ◀ and ▶', () => {
    const { r, devs, ctl } = setup({ style: 'buttons' });
    const L = ctl('left');
    const R = ctl('right');
    expect(r.down(1, L.cx, L.cy, 0)).toBe('left');
    expect(devs[0].read().steer).toBe(-1);
    r.move(1, R.cx, R.cy);
    expect(devs[0].read().steer).toBe(1);
    expect(r.view()[0].pressed.has('right')).toBe(true);
    r.up(1);
    expect(devs[0].read().steer).toBe(0);
    // a miss above the buttons still steers towards the nearer one
    expect(r.down(2, L.cx, L.y - 40, 0)).toBe('left');
    r.up(2);
    // two thumbs on ◀: releasing one keeps it held
    r.down(3, L.cx, L.cy, 0);
    r.down(4, L.cx + 5, L.cy, 0);
    r.up(3);
    expect(devs[0].read().steer).toBe(-1);
    r.up(4);
    expect(devs[0].read().steer).toBe(0);
  });
  it('tilt style: steer zone ignored, recenter calls back', () => {
    const { r, ctl, onRecenter } = setup({ style: 'tilt' });
    expect(r.down(1, 150, 250, 0)).toBe(null);
    const c = ctl('recenter');
    expect(r.down(2, c.cx, c.cy, 0)).toBe('recenter');
    expect(onRecenter).toHaveBeenCalledWith('touch1');
    r.up(2);
  });
  it('two touch players: each half drives its own device', () => {
    const { r, devs, ctl } = setup({}, 2, TABLET);
    r.down(1, 60, 700, 0);
    r.move(1, 200, 700);
    const item2 = ctl('item', 1);
    r.down(2, item2.cx, item2.cy, 0);
    const f1 = devs[0].read();
    const f2 = devs[1].read();
    expect(f1.steer).toBeGreaterThan(0.5);
    expect(f1.taps.has('item')).toBe(false);
    expect(f2.steer).toBe(0);
    expect(f2.taps.has('item')).toBe(true);
  });
  it('a set without a device ignores touches; cancelAll releases everything', () => {
    const r = new TouchPointerRouter();
    r.setLayout(computeTouchLayout({ ...PHONE }), []);
    expect(r.down(1, 100, 300, 0)).toBe(null);
    const { r: r2, devs, ctl } = setup({ autoGas: false });
    const gas = ctl('gas');
    r2.down(1, gas.cx, gas.cy, 0);
    r2.down(2, 100, 300, 0);
    r2.cancelAll();
    expect(devs[0].read().accel).toBe(0);
    expect(r2.owners.size).toBe(0);
  });
});

describe('installTouchInput', () => {
  const coarse = (on) => ({ matchMedia: () => ({ matches: on }), navigator: { maxTouchPoints: on ? 5 : 0 }, ...new FakeTarget(), addEventListener: FakeTarget.prototype.addEventListener, removeEventListener: FakeTarget.prototype.removeEventListener, l: new Map() });
  it('isTouchCapable: coarse pointer, force, fallbacks', () => {
    expect(isTouchCapable(null)).toBe(false);
    expect(isTouchCapable(null, true)).toBe(true);
    expect(isTouchCapable(coarse(true))).toBe(true);
    expect(isTouchCapable(coarse(false))).toBe(false);
    expect(isTouchCapable({ navigator: { maxTouchPoints: 2 } })).toBe(true);
    expect(isTouchCapable({ matchMedia() { throw new Error('x'); }, navigator: {} })).toBe(false);
  });
  it('registers touch1 right away on a phone/tablet', () => {
    const { input } = makeInput();
    const touch = installTouchInput(input, { win: coarse(true), store: createTouchSettingsStore(memStorage()) });
    expect(touch.capable).toBe(true);
    expect(touch.registered).toBe(true);
    expect(input.getDevice('touch1')).toMatchObject({ type: 'touch', icon: '👆', name: 'Touch screen' });
    expect(input.getDevice('touch2')).toBe(null);
    expect(touch.isTouchDevice('touch1')).toBe(true);
    expect(touch.device('nope')).toBe(null);
    touch.dispose();
    expect(input.getDevice('touch1')).toBe(null);
  });
  it('on a desktop it waits for the first TOUCH press', () => {
    const { input } = makeInput();
    const win = coarse(false);
    const touch = installTouchInput(input, { win, store: createTouchSettingsStore(memStorage()) });
    expect(input.getDevice('touch1')).toBe(null);
    for (const fn of win.l.get('pointerdown')) fn({ pointerType: 'mouse' });
    expect(input.getDevice('touch1')).toBe(null);
    for (const fn of [...win.l.get('pointerdown')]) fn({ pointerType: 'touch' });
    expect(input.getDevice('touch1')).not.toBe(null);
    touch.dispose();
  });
  it('the two-players setting adds / removes touch2 and renames the sides', () => {
    const { input } = makeInput();
    const store = createTouchSettingsStore(memStorage());
    const touch = installTouchInput(input, { win: coarse(true), store });
    store.set({ twoPlayers: true });
    expect(input.getDevice('touch2')).toMatchObject({ name: 'Touch (right side)' });
    expect(input.getDevice('touch1').name).toBe('Touch (left side)');
    store.set({ twoPlayers: false });
    expect(input.getDevice('touch2')).toBe(null);
    expect(input.getDevice('touch1').name).toBe('Touch screen');
    store.set({ autoGas: false });
    expect(touch.device('touch1').settings.autoGas).toBe(false);
    expect(touchDeviceName('touch1', false)).toBe('Touch screen');
    touch.dispose();
  });
  it('settings reach the DriveInput (auto-gas off → no gas)', () => {
    const { input, tick } = makeInput();
    const store = createTouchSettingsStore(memStorage());
    const touch = installTouchInput(input, { win: coarse(true), store });
    tick();
    expect(input.getDriveInput('touch1').accel).toBe(1);
    store.set({ autoGas: false });
    tick();
    expect(input.getDriveInput('touch1').accel).toBe(0);
    touch.dispose();
  });
  it('tilt: permission, orientation events steer touch1, calibration is saved', async () => {
    const { input, tick } = makeInput();
    const store = createTouchSettingsStore(memStorage());
    const win = { ...coarse(true), l: new Map(), DeviceOrientationEvent: { requestPermission: async () => 'granted' }, screen: { orientation: { angle: 90 } } };
    win.addEventListener = FakeTarget.prototype.addEventListener;
    win.removeEventListener = FakeTarget.prototype.removeEventListener;
    let now = 0;
    const touch = installTouchInput(input, { win, store, now: () => now });
    expect(touch.tiltState).toBe('off');
    store.set({ style: 'tilt' });
    expect(await touch.enableTilt()).toBe('on');
    const fire = (beta) => { for (const fn of win.l.get('deviceorientation') ?? []) fn({ beta, gamma: 0 }); };
    fire(40);
    expect(touch.calibrateTilt()).toBe(40);
    expect(JSON.parse(JSON.stringify(store.get())).tiltNeutral).toBe(40);
    fire(40 + 30);
    for (let i = 0; i < 60; i++) { now += 16; tick(16); }
    expect(input.getDriveInput('touch1').steer).toBeGreaterThan(0.9);
    store.set({ style: 'joystick' });
    expect(win.l.get('deviceorientation')?.size ?? 0).toBe(0);
    touch.dispose();
  });
  it('tilt denied / unsupported', async () => {
    const { input } = makeInput();
    const denied = { ...coarse(true), l: new Map(), DeviceOrientationEvent: { requestPermission: async () => 'denied' } };
    denied.addEventListener = FakeTarget.prototype.addEventListener;
    denied.removeEventListener = FakeTarget.prototype.removeEventListener;
    const t1 = installTouchInput(input, { win: denied, store: createTouchSettingsStore(memStorage()) });
    expect(await t1.enableTilt()).toBe('denied');
    t1.dispose();
    const t2 = installTouchInput(input, { win: coarse(true), store: createTouchSettingsStore(memStorage()) });
    expect(t2.tiltState).toBe('unsupported');
    expect(await t2.enableTilt()).toBe('unsupported');
    t2.dispose();
  });
  it('touch rumble vibrates through navigator.vibrate', () => {
    const { input } = makeInput();
    const win = coarse(true);
    win.navigator.vibrate = vi.fn();
    const touch = installTouchInput(input, { win, store: createTouchSettingsStore(memStorage()) });
    input.rumble('touch1', 1, 100);
    expect(win.navigator.vibrate).toHaveBeenCalledWith(100);
    touch.dispose();
  });
});

describe('menu gestures → menu events', () => {
  const dev = () => new TouchDevice({ id: 'touch1' });
  it('swipe left walks right; the click it causes is swallowed, a new press is not', () => {
    const d = dev();
    const mg = new MenuGestureController({ deviceFor: () => d });
    mg.down(1, 300, 100, 0);
    mg.move(1, 200, 100);
    expect(mg.up(1, 150, 100, 120)).toBe('right');
    expect([...d.read().taps]).toEqual(['right']);
    expect(mg.suppressClick(130)).toBe(true);
    expect(mg.suppressClick(120 + CLICK_SUPPRESS_MS + 1)).toBe(false);
    mg.down(2, 10, 10, 140);
    expect(mg.suppressClick(150)).toBe(false);
  });
  it('long-press → toggle while held', () => {
    const d = dev();
    const onAction = vi.fn();
    const mg = new MenuGestureController({ deviceFor: () => d, onAction });
    mg.down(1, 50, 50, 0);
    expect(mg.tick(100)).toBe(null);
    expect(mg.tick(700)).toBe('toggle');
    expect(onAction).toHaveBeenCalledWith('toggle', 'touch1', 'long-press');
    expect(mg.up(1, 50, 50, 900)).toBe(null);
  });
  it('two-finger tap → back; taps are left to the native click', () => {
    const d = dev();
    const mg = new MenuGestureController({ deviceFor: () => d });
    mg.down(1, 10, 10, 0);
    mg.down(2, 90, 10, 10);
    mg.up(1, 10, 10, 100);
    expect(mg.up(2, 90, 10, 120)).toBe('back');
    mg.down(3, 10, 10, 200);
    expect(mg.up(3, 10, 10, 260)).toBe(null);
    mg.down(4, 1, 1, 300);
    mg.cancel(4);
  });
  it('vertical swipes inside a native scroller scroll instead', () => {
    const d = dev();
    const mg = new MenuGestureController({ deviceFor: () => d });
    mg.down(1, 100, 300, 0, { nativeScrollY: true });
    expect(mg.up(1, 100, 150, 100)).toBe(null);
    mg.down(2, 300, 100, 200, { nativeScrollY: true });
    expect(mg.up(2, 150, 100, 300)).toBe('right');
  });
  it('no device (or a throwing lookup) → nothing sent', () => {
    const mg = new MenuGestureController({ deviceFor: () => { throw new Error('x'); } });
    mg.down(1, 300, 100, 0);
    expect(mg.up(1, 100, 100, 100)).toBe(null);
    const mg2 = new MenuGestureController();
    mg2.down(1, 300, 100, 0);
    expect(mg2.up(1, 100, 100, 100)).toBe(null);
  });
});

describe('touch settings screen reducer', () => {
  it('rows: calibrate only for tilt', () => {
    expect(visibleRows({ style: 'joystick' })).not.toContain('calibrate');
    expect(visibleRows({ style: 'tilt' })).toContain('calibrate');
    for (const r of TOUCH_ROWS) expect(TOUCH_ROW_TEXT[r]).toHaveLength(3);
  });
  it('up/down wrap, left/right cycle the style, tilt asks for permission', () => {
    let st = createTouchSettingsState({});
    let r = touchSettingsReduce(st, { action: 'up' });
    expect(r.state.rows[r.state.index]).toBe('back');
    r = touchSettingsReduce(r.state, { action: 'down' });
    expect(r.state.index).toBe(0);
    r = touchSettingsReduce(r.state, { action: 'right' });
    expect(r.patch).toEqual({ style: 'buttons' });
    r = touchSettingsReduce(r.state, { action: 'right' });
    expect(r.patch).toEqual({ style: 'tilt' });
    expect(r.effect).toBe('tilt');
    expect(r.state.rows).toContain('calibrate');
    r = touchSettingsReduce(r.state, { action: 'left' });
    expect(r.patch).toEqual({ style: 'buttons' });
    st = r.state;
    expect(st.rows).not.toContain('calibrate');
  });
  it('confirm toggles booleans; back row / B leave; calibrate row acts', () => {
    let st = createTouchSettingsState({ style: 'tilt' });
    const idx = (k) => st.rows.indexOf(k);
    let r = touchSettingsReduce(st, { action: 'select', index: idx('autoGas') });
    expect(r.patch).toEqual({ autoGas: false });
    st = r.state;
    r = touchSettingsReduce(st, { action: 'select', index: idx('calibrate') });
    expect(r.effect).toBe('calibrate');
    r = touchSettingsReduce(st, { action: 'select', index: idx('back') });
    expect(r.go).toBe('back');
    expect(touchSettingsReduce(st, { action: 'back' }).go).toBe('back');
    expect(touchSettingsReduce(st, { action: 'select', index: 99 }).patch).toBe(null);
    expect(touchSettingsReduce(st, { action: 'weird' }).patch).toBe(null);
  });
  it('set action (taps) clamps through normalize; size cycles', () => {
    const st = createTouchSettingsState({});
    let r = touchSettingsReduce(st, { action: 'set', key: 'size', value: 'large' });
    expect(r.patch).toEqual({ size: 'large' });
    r = touchSettingsReduce(st, { action: 'set', key: 'style', value: 'tilt' });
    expect(r.effect).toBe('tilt');
    expect(touchSettingsReduce(st, { action: 'set', key: 'hack', value: 1 }).patch).toBe(null);
    const sizeRow = { ...st, index: st.rows.indexOf('size') };
    expect(touchSettingsReduce(sizeRow, { action: 'left' }).patch).toEqual({ size: 'small' });
    const backRow = { ...st, index: st.rows.indexOf('back') };
    expect(touchSettingsReduce(backRow, { action: 'left' }).patch).toBe(null);
  });
  it('value texts', () => {
    const s = createTouchSettingsState({ style: 'buttons', size: 'large', leftHanded: true }).settings;
    expect(rowValueText(s, 'style')).toBe('◀ ▶ buttons');
    expect(rowValueText(s, 'size')).toBe('Large');
    expect(rowValueText(s, 'leftHanded')).toBe('ON');
    expect(rowValueText(s, 'twoPlayers')).toBe('OFF');
    expect(rowValueText(s, 'back')).toBe('');
  });
});

describe('touch runtime registry', () => {
  it('get / set / safe rects / wanted', () => {
    setTouchRuntime(null);
    expect(getTouchRuntime()).toBe(null);
    expect(getTouchSafeRects()).toEqual([]);
    expect(touchUiWanted()).toBe(false);
    setTouchRuntime({ touch: { capable: false, registered: true }, overlay: { getTouchSafeRects: () => [{ id: 'item' }] } });
    expect(getTouchSafeRects()).toEqual([{ id: 'item' }]);
    expect(touchUiWanted()).toBe(true);
    setTouchRuntime({ overlay: { getTouchSafeRects() { throw new Error('x'); } } });
    expect(getTouchSafeRects()).toEqual([]);
    setTouchRuntime(null);
  });
});
