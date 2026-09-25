import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InputManager, neutralDriveInput } from '../src/input/InputManager.js';
import { KEYBOARD_LAYOUTS, layoutCodes, CODE_TO_KEYBOARD, isGameKey, readKeyboardFrame } from '../src/input/keyboardLayouts.js';
import { applyDeadzone, decodeHat, readGamepad, describeGamepad, gamepadLabels } from '../src/input/gamepadMapping.js';
import { RepeatTimer } from '../src/input/MenuRepeat.js';

// ─────────────── fakes ───────────────

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  dispatch(type, props = {}) {
    const ev = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }
  keydown(code, extra = {}) {
    return this.dispatch('keydown', { code, ...extra });
  }
  keyup(code, extra = {}) {
    return this.dispatch('keyup', { code, ...extra });
  }
}

function makePad({ index = 0, id = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', mapping = 'standard', nButtons = 17, nAxes = 4 } = {}) {
  return {
    index,
    id,
    mapping,
    connected: true,
    buttons: Array.from({ length: nButtons }, () => ({ pressed: false, value: 0 })),
    axes: Array.from({ length: nAxes }, () => 0),
    press(i, value = 1) {
      this.buttons[i] = { pressed: value > 0.5, value };
    },
    release(i) {
      this.buttons[i] = { pressed: false, value: 0 };
    },
  };
}

function setup(opts = {}) {
  const target = new FakeTarget();
  const pads = [null, null, null, null];
  let t = 1000;
  const clock = {
    get: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
  const im = new InputManager(target, { getGamepads: () => pads, now: clock.get, ...opts });
  return { im, target, pads, clock };
}

const actions = (events) => events.map((e) => `${e.deviceId}:${e.action}`);

// ─────────────── keyboard layouts ───────────────

describe('keyboard layouts', () => {
  it('kb1 and kb2 never share a key', () => {
    const a = new Set(layoutCodes(KEYBOARD_LAYOUTS.kb1));
    const b = layoutCodes(KEYBOARD_LAYOUTS.kb2);
    for (const code of b) expect(a.has(code), code).toBe(false);
  });

  it('maps codes back to their owner', () => {
    expect(CODE_TO_KEYBOARD.get('KeyW')).toBe('kb1');
    expect(CODE_TO_KEYBOARD.get('ArrowUp')).toBe('kb2');
    expect(isGameKey('Space')).toBe(true);
    expect(isGameKey('KeyZ')).toBe(false);
  });

  it('every layout binds every action', () => {
    const needed = ['accel', 'brake', 'steerLeft', 'steerRight', 'drift', 'item', 'lookBack', 'pause', 'up', 'down', 'left', 'right', 'confirm', 'back', 'start', 'toggle'];
    for (const layout of Object.values(KEYBOARD_LAYOUTS)) {
      for (const n of needed) expect(layout.bindings[n]?.length, `${layout.id}.${n}`).toBeGreaterThan(0);
    }
  });

  it('readKeyboardFrame combines held and tapped keys', () => {
    const f = readKeyboardFrame(KEYBOARD_LAYOUTS.kb1, new Set(['KeyW', 'KeyA']), new Set(['KeyE']));
    expect(f.accel).toBe(1);
    expect(f.steer).toBe(-1);
    expect(f.held.item).toBe(true);
    expect(f.taps.has('item')).toBe(true);
    const both = readKeyboardFrame(KEYBOARD_LAYOUTS.kb1, new Set(['KeyA', 'KeyD']), new Set());
    expect(both.steer).toBe(0);
  });
});

// ─────────────── gamepad mapping ───────────────

describe('gamepad mapping helpers', () => {
  it('applyDeadzone zeroes small values and rescales the rest', () => {
    expect(applyDeadzone(0.1)).toBe(0);
    expect(applyDeadzone(-0.2)).toBe(0);
    expect(applyDeadzone(1)).toBe(1);
    expect(applyDeadzone(-1)).toBe(-1);
    expect(applyDeadzone(0.6)).toBeCloseTo(0.5);
    expect(applyDeadzone(NaN)).toBe(0);
    expect(applyDeadzone(1.3)).toBe(1);
  });

  it('decodeHat handles all 8 directions and centre', () => {
    const step = 2 / 7;
    const expected = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    expected.forEach(([x, y], i) => {
      expect(decodeHat(-1 + i * step)).toEqual({ x, y });
    });
    expect(decodeHat(3.2857 / 2.555)).toEqual({ x: 0, y: 0 }); // ~1.286 = centred
    expect(decodeHat(1.2857)).toEqual({ x: 0, y: 0 });
    expect(decodeHat(undefined)).toEqual({ x: 0, y: 0 });
  });

  it('standard pad: A accelerates, analog RT/LT, stick steer with deadzone', () => {
    const gp = makePad();
    gp.axes[0] = 0.15;
    expect(readGamepad(gp).steer).toBe(0);
    gp.axes[0] = -1;
    expect(readGamepad(gp).steer).toBe(-1);
    gp.press(7, 0.5);
    gp.press(6, 0.3);
    const f = readGamepad(gp);
    expect(f.accel).toBeGreaterThan(0.4);
    expect(f.accel).toBeLessThan(0.5);
    expect(f.brake).toBeGreaterThan(0.2);
    gp.press(0);
    expect(readGamepad(gp).accel).toBe(1);
  });

  it('d-pad overrides stick for steering', () => {
    const gp = makePad();
    gp.axes[0] = -0.8;
    gp.press(15);
    expect(readGamepad(gp).steer).toBe(1);
  });

  it('drift, item, look back, pause', () => {
    const gp = makePad();
    gp.press(5);
    gp.press(4);
    gp.press(9);
    let f = readGamepad(gp);
    expect(f.held.drift && f.held.item && f.held.pause && f.held.start).toBe(true);
    const gp2 = makePad();
    gp2.press(2); // X drift
    gp2.press(3); // Y item + toggle
    gp2.axes[3] = 0.9; // right stick down
    f = readGamepad(gp2);
    expect(f.held.drift).toBe(true);
    expect(f.held.item).toBe(true);
    expect(f.held.toggle).toBe(true);
    expect(f.held.lookBack).toBe(true);
  });

  it('menu stick directions use hysteresis and dominant axis', () => {
    const gp = makePad();
    gp.axes[0] = 0.45;
    let f = readGamepad(gp);
    expect(f.held.right).toBe(false);
    gp.axes[0] = 0.6;
    f = readGamepad(gp, f);
    expect(f.held.right).toBe(true);
    gp.axes[0] = 0.4; // still above release threshold
    f = readGamepad(gp, f);
    expect(f.held.right).toBe(true);
    gp.axes[0] = 0.3;
    f = readGamepad(gp, f);
    expect(f.held.right).toBe(false);
    gp.axes[0] = 0.7;
    gp.axes[1] = -0.9;
    f = readGamepad(gp);
    expect(f.held.up).toBe(true);
    expect(f.held.right).toBe(false);
  });

  it('non-standard pad: hat d-pad, select as start, few buttons', () => {
    const gp = makePad({ id: 'USB Gamepad (Vendor: 0079 Product: 0006)', mapping: '', nButtons: 12, nAxes: 10 });
    gp.axes[9] = -1 + 6 * (2 / 7); // left
    gp.press(8);
    const f = readGamepad(gp);
    expect(f.steer).toBe(-1);
    expect(f.held.left).toBe(true);
    expect(f.held.start).toBe(true);
    gp.axes[9] = 1.2857;
    expect(readGamepad(gp).steer).toBe(0);
  });

  it('non-standard pad with digital triggers and missing buttons does not crash', () => {
    const gp = { index: 0, id: 'weird', mapping: '', connected: true, buttons: [{ pressed: true }], axes: [] };
    const f = readGamepad(gp);
    expect(f.accel).toBe(1);
    expect(f.steer).toBe(0);
    expect(f.anyButton).toBe(true);
    const numeric = { index: 0, id: 'old', mapping: '', buttons: [0, 1], axes: [0, 0] };
    expect(readGamepad(numeric).brake).toBe(1);
  });

  it('describeGamepad recognises families', () => {
    expect(describeGamepad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)').kind).toBe('xbox');
    expect(describeGamepad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)').kind).toBe('playstation');
    expect(describeGamepad('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)').kind).toBe('switch');
    expect(describeGamepad('Some Pad').kind).toBe('generic');
    expect(describeGamepad(undefined).name).toBe('Game Controller');
    expect(gamepadLabels('playstation').confirm).toBe('✕');
    expect(gamepadLabels('xbox').confirm).toBe('A');
  });
});

// ─────────────── repeat timer ───────────────

describe('RepeatTimer', () => {
  it('fires on press, after delay, then every interval', () => {
    const r = new RepeatTimer({ delay: 350, interval: 120 });
    const fires = [];
    for (let t = 0; t <= 700; t += 10) if (r.update(true, t)) fires.push(t);
    expect(fires).toEqual([0, 350, 470, 590]);
  });

  it('stops on release and restarts on re-press', () => {
    const r = new RepeatTimer();
    expect(r.update(true, 0)).toBe(true);
    expect(r.update(false, 50)).toBe(false);
    expect(r.update(true, 60)).toBe(true);
    expect(r.update(true, 100)).toBe(false);
  });

  it('a tap shorter than a frame still fires once', () => {
    const r = new RepeatTimer();
    expect(r.update(false, 0, true)).toBe(true);
    expect(r.update(false, 16)).toBe(false);
  });

  it('never bursts after a long frame', () => {
    const r = new RepeatTimer({ delay: 350, interval: 120 });
    r.update(true, 0);
    expect(r.update(true, 2000)).toBe(true);
    expect(r.update(true, 2001)).toBe(false);
  });
});

// ─────────────── InputManager: keyboard ───────────────

describe('InputManager keyboard', () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('lists both keyboards', () => {
    const devs = ctx.im.getDevices();
    expect(devs.map((d) => d.id)).toEqual(['kb1', 'kb2']);
    expect(devs.every((d) => d.type === 'keyboard' && d.connected)).toBe(true);
  });

  it('drives with WASD and arrows independently', () => {
    const { im, target } = ctx;
    target.keydown('KeyW');
    target.keydown('KeyD');
    target.keydown('ArrowDown');
    target.keydown('ArrowLeft');
    im.update();
    expect(im.getDriveInput('kb1')).toMatchObject({ accel: 1, steer: 1, brake: 0 });
    expect(im.getDriveInput('kb2')).toMatchObject({ accel: 0, steer: -1, brake: 1 });
    target.keyup('KeyD');
    im.update();
    expect(im.getDriveInput('kb1').steer).toBe(0);
  });

  it('prevents default for game keys but not other keys', () => {
    const { target } = ctx;
    expect(target.keydown('Space').defaultPrevented).toBe(true);
    expect(target.keydown('ArrowDown').defaultPrevented).toBe(true);
    expect(target.keydown('Tab').defaultPrevented).toBe(true);
    expect(target.keydown('F5').defaultPrevented).toBe(false);
    expect(target.keydown('KeyW', { metaKey: true }).defaultPrevented).toBe(false);
    expect(target.keydown('KeyW', { target: { tagName: 'input' } }).defaultPrevented).toBe(false);
  });

  it('useItem is an edge: true for exactly one update', () => {
    const { im, target } = ctx;
    target.keydown('KeyE');
    im.update();
    expect(im.getDriveInput('kb1').useItem).toBe(true);
    expect(im.getDriveInput('kb1').useItem).toBe(true); // same frame, stable
    im.update();
    expect(im.getDriveInput('kb1').useItem).toBe(false);
    target.keydown('KeyE', { repeat: true });
    im.update();
    expect(im.getDriveInput('kb1').useItem).toBe(false);
  });

  it('a tap faster than one frame still registers', () => {
    const { im, target } = ctx;
    target.keydown('Slash');
    target.keyup('Slash');
    im.update();
    expect(im.getDriveInput('kb2').useItem).toBe(true);
    expect(actions(im.consumeMenuEvents())).toEqual(['kb2:confirm']);
  });

  it('drift and look back are held values', () => {
    const { im, target } = ctx;
    target.keydown('ShiftRight');
    target.keydown('Period');
    im.update();
    im.update();
    expect(im.getDriveInput('kb2')).toMatchObject({ drift: true, lookBack: true });
  });

  it('pause is an edge per device', () => {
    const { im, target } = ctx;
    target.keydown('KeyP');
    im.update();
    expect(im.isPausePressed('kb1')).toBe(true);
    expect(im.isPausePressed('kb2')).toBe(false);
    expect(im.isPausePressed()).toBe(true);
    expect(im.getPauseDevice()).toBe('kb1');
    im.update();
    expect(im.isPausePressed('kb1')).toBe(false);
    target.keydown('Backspace');
    im.update();
    expect(im.isPausePressed('kb2')).toBe(true);
  });

  it('emits menu events and consume clears them', () => {
    const { im, target } = ctx;
    target.keydown('Enter');
    target.keydown('Tab');
    target.keydown('Escape');
    target.keydown('Backslash');
    im.update();
    const ev = im.consumeMenuEvents();
    expect(ev).toEqual(expect.arrayContaining([
      { deviceId: 'kb1', action: 'confirm' },
      { deviceId: 'kb1', action: 'toggle' },
      { deviceId: 'kb1', action: 'back' },
      { deviceId: 'kb2', action: 'start' },
    ]));
    expect(ev).toHaveLength(4);
    expect(im.consumeMenuEvents()).toEqual([]);
  });

  it('menu directions auto-repeat while held', () => {
    const { im, target, clock } = ctx;
    target.keydown('ArrowDown');
    const got = [];
    for (let i = 0; i < 45; i++) {
      im.update();
      got.push(...im.consumeMenuEvents().map((e) => e.action));
      clock.advance(16);
    }
    // 0ms, ~352ms, ~480ms, ~608ms  (45 frames * 16 = 720ms)
    expect(got.filter((a) => a === 'down')).toHaveLength(4);
    target.keyup('ArrowDown');
    im.update();
    clock.advance(500);
    im.update();
    expect(im.consumeMenuEvents()).toEqual([]);
  });

  it('blur releases stuck keys', () => {
    const { im, target } = ctx;
    target.keydown('KeyW');
    im.update();
    target.dispatch('blur');
    im.update();
    expect(im.getDriveInput('kb1').accel).toBe(0);
  });

  it('drops stale unconsumed menu events', () => {
    const { im, target, clock } = ctx;
    target.keydown('Space');
    im.update();
    for (let i = 0; i < 5; i++) {
      clock.advance(200);
      im.update();
    }
    expect(im.consumeMenuEvents()).toEqual([]);
  });

  it('keeps events through a single slow frame', () => {
    const { im, target, clock } = ctx;
    target.keydown('Space');
    im.update();
    clock.advance(900);
    im.update();
    expect(actions(im.consumeMenuEvents())).toEqual(['kb1:confirm']);
  });

  it('dispose removes listeners', () => {
    const { im, target } = ctx;
    expect(target.count()).toBeGreaterThan(0);
    im.dispose();
    expect(target.count()).toBe(0);
    im.update(); // safe
  });

  it('works with no target at all (node / SSR)', () => {
    const im = new InputManager(null, { getGamepads: () => [] });
    im.update();
    expect(im.getDriveInput('kb1')).toEqual(neutralDriveInput());
  });
});

// ─────────────── InputManager: gamepads ───────────────

describe('InputManager gamepads', () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('connects with stable ids by index and fires device events', () => {
    const { im, pads } = ctx;
    const events = [];
    im.onDeviceChange((e) => events.push(`${e.type}:${e.deviceId}`));
    pads[2] = makePad({ index: 2, id: 'DualSense Wireless Controller' });
    im.update();
    expect(events).toEqual(['connected:gp2']);
    const dev = im.getDevice('gp2');
    expect(dev).toMatchObject({ type: 'gamepad', kind: 'playstation', connected: true, name: 'PlayStation Controller' });
    pads[2] = null;
    im.update();
    expect(events).toEqual(['connected:gp2', 'disconnected:gp2']);
    expect(im.getDevice('gp2').connected).toBe(false);
    expect(im.getDevices().map((d) => d.id)).toEqual(['kb1', 'kb2', 'gp2']);
    pads[2] = makePad({ index: 2 });
    im.update();
    expect(events.at(-1)).toBe('connected:gp2');
    expect(im.getDevice('gp2').kind).toBe('xbox');
  });

  it('treats connected:false entries as unplugged', () => {
    const { im, pads } = ctx;
    pads[0] = makePad();
    im.update();
    pads[0].connected = false;
    im.update();
    expect(im.isConnected('gp0')).toBe(false);
  });

  it('survives getGamepads throwing', () => {
    const im = new InputManager(new FakeTarget(), { getGamepads: () => { throw new Error('nope'); } });
    expect(() => im.update()).not.toThrow();
  });

  it('drive input + item edge from a pad', () => {
    const { im, pads } = ctx;
    const gp = (pads[0] = makePad());
    gp.press(7, 0.8);
    gp.axes[0] = 0.6;
    gp.press(5);
    gp.press(4);
    im.update();
    const d = im.getDriveInput('gp0');
    expect(d.accel).toBeCloseTo((0.8 - 0.06) / 0.94);
    expect(d.steer).toBeCloseTo(0.5);
    expect(d.drift).toBe(true);
    expect(d.useItem).toBe(true);
    im.update();
    expect(im.getDriveInput('gp0').useItem).toBe(false);
    gp.release(4);
    im.update();
    gp.press(4);
    im.update();
    expect(im.getDriveInput('gp0').useItem).toBe(true);
  });

  it('the button press that reveals a pad counts (press A to join)', () => {
    const { im, pads } = ctx;
    const gp = (pads[1] = makePad({ index: 1 }));
    gp.press(0);
    im.update();
    expect(actions(im.consumeMenuEvents())).toEqual(['gp1:confirm']);
  });

  it('menu events: A confirm, B back, Y toggle, Start start + pause', () => {
    const { im, pads } = ctx;
    const gp = (pads[0] = makePad());
    im.update();
    gp.press(0);
    gp.press(1);
    gp.press(3);
    gp.press(9);
    im.update();
    expect(actions(im.consumeMenuEvents()).sort()).toEqual(['gp0:back', 'gp0:confirm', 'gp0:start', 'gp0:toggle']);
    expect(im.isPausePressed('gp0')).toBe(true);
    im.update();
    expect(im.consumeMenuEvents()).toEqual([]);
    expect(im.isPausePressed('gp0')).toBe(false);
  });

  it('stick menu navigation auto-repeats', () => {
    const { im, pads, clock } = ctx;
    const gp = (pads[0] = makePad());
    gp.axes[1] = -1;
    let ups = 0;
    for (let i = 0; i < 30; i++) {
      im.update();
      ups += im.consumeMenuEvents().filter((e) => e.action === 'up').length;
      clock.advance(16); // 480ms total
    }
    expect(ups).toBe(2);
  });

  it('disconnect mid-race returns neutral input', () => {
    const { im, pads } = ctx;
    const gp = (pads[0] = makePad());
    gp.press(0);
    im.update();
    expect(im.getDriveInput('gp0').accel).toBe(1);
    pads[0] = null;
    im.update();
    expect(im.getDriveInput('gp0')).toEqual(neutralDriveInput());
  });

  it('unknown devices return neutral input', () => {
    expect(ctx.im.getDriveInput('gp3')).toEqual(neutralDriveInput());
    expect(ctx.im.isPausePressed('nope')).toBe(false);
  });

  it('rumble uses dual-rumble when available', () => {
    const { im, pads } = ctx;
    const gp = (pads[0] = makePad());
    const playEffect = vi.fn(() => Promise.resolve('complete'));
    gp.vibrationActuator = { type: 'dual-rumble', playEffect };
    im.update();
    im.rumble('gp0', 2, 200);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', expect.objectContaining({ duration: 200, weakMagnitude: 1 }));
    im.setRumbleEnabled(false);
    im.rumble('gp0', 0.5, 100);
    expect(playEffect).toHaveBeenCalledTimes(1);
  });

  it('rumble falls back to hapticActuators and swallows errors', () => {
    const { im, pads } = ctx;
    const gp = (pads[0] = makePad());
    const pulse = vi.fn(() => Promise.reject(new Error('no')));
    gp.hapticActuators = [{ pulse }];
    im.update();
    expect(() => im.rumble('gp0', 0.4, 80)).not.toThrow();
    expect(pulse).toHaveBeenCalledWith(0.4, 80);
    gp.hapticActuators = null;
    gp.vibrationActuator = { playEffect: () => { throw new Error('boom'); } };
    expect(() => im.rumble('gp0', 0.4, 80)).not.toThrow();
  });

  it('rumble is a no-op for keyboards, unknown and unsupported pads', () => {
    const { im, pads } = ctx;
    pads[0] = makePad();
    im.update();
    expect(() => {
      im.rumble('kb1', 1, 100);
      im.rumble('gp3', 1, 100);
      im.rumble('gp0', 1, 100);
    }).not.toThrow();
  });
});

// ─────────────── user gestures ───────────────

describe('InputManager onAnyUserGesture', () => {
  it('fires once on first keydown / pointer', () => {
    const { im, target } = setup();
    const cb = vi.fn();
    im.onAnyUserGesture(cb);
    target.dispatch('pointerdown');
    target.keydown('KeyW');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('pointer');
  });

  it('fires for a gamepad button, then once more on the first DOM gesture', () => {
    const { im, target, pads } = setup();
    const cb = vi.fn();
    im.onAnyUserGesture(cb);
    const gp = (pads[0] = makePad());
    gp.press(2);
    im.update();
    im.update();
    gp.release(2);
    im.update();
    gp.press(2);
    im.update();
    expect(cb.mock.calls).toEqual([['gamepad']]);
    target.keydown('KeyZ');
    target.keydown('KeyZ');
    expect(cb.mock.calls).toEqual([['gamepad'], ['keyboard']]);
  });

  it('fires immediately if a DOM gesture already happened; unsubscribe works', () => {
    const { im, target } = setup();
    const early = vi.fn();
    const off = im.onAnyUserGesture(early);
    off();
    target.dispatch('touchend');
    expect(early).not.toHaveBeenCalled();
    const late = vi.fn();
    im.onAnyUserGesture(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});

// ─────────────── virtual devices ───────────────

describe('InputManager virtual devices', () => {
  it('can be added, driven and removed', () => {
    const { im } = setup();
    const events = [];
    im.onDeviceChange((e) => events.push(`${e.type}:${e.deviceId}`));
    const dev = im.addVirtualDevice('bot1');
    expect(dev).toMatchObject({ id: 'bot1', type: 'gamepad', kind: 'virtual', virtual: true, connected: true });
    expect(im.addVirtualDevice('bot1').id).toBe('bot1'); // idempotent
    expect(events).toEqual(['connected:bot1']);
    expect(im.getDevices().at(-1).id).toBe('bot1');

    im.setVirtualDriveInput('bot1', { steer: 2, accel: 1, drift: true });
    im.update();
    expect(im.getDriveInput('bot1')).toEqual({ steer: 1, accel: 1, brake: 0, drift: true, useItem: false, lookBack: false });

    im.setVirtualDriveInput('bot1', { useItem: true, pause: true });
    im.update();
    expect(im.getDriveInput('bot1').useItem).toBe(true);
    expect(im.getDriveInput('bot1').accel).toBe(1); // partial update keeps the rest
    expect(im.isPausePressed('bot1')).toBe(true);
    im.update();
    expect(im.getDriveInput('bot1').useItem).toBe(false);
    expect(im.isPausePressed('bot1')).toBe(false);

    im.removeVirtualDevice('bot1');
    expect(events).toEqual(['connected:bot1', 'disconnected:bot1']);
    expect(im.getDriveInput('bot1')).toEqual(neutralDriveInput());
  });

  it('pushes menu events in order and validates input', () => {
    const { im } = setup();
    im.addVirtualDevice('v0');
    im.pushVirtualMenuEvent('v0', 'confirm');
    im.pushVirtualMenuEvent('v0', 'right');
    im.update();
    expect(actions(im.consumeMenuEvents())).toEqual(['v0:confirm', 'v0:right']);
    expect(() => im.pushVirtualMenuEvent('v0', 'dance')).toThrow();
    expect(() => im.pushVirtualMenuEvent('nobody', 'confirm')).toThrow();
    expect(() => im.setVirtualDriveInput('kb1', {})).toThrow();
    expect(() => im.addVirtualDevice('kb1')).toThrow();
  });

  it('events pushed without update are consumable immediately', () => {
    const { im } = setup();
    im.addVirtualDevice('v0');
    im.pushVirtualMenuEvent('v0', 'start');
    expect(actions(im.consumeMenuEvents())).toEqual(['v0:start']);
  });
});
