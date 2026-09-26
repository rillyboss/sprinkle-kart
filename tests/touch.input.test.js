// Touch controls — pure input maths: joystick, gestures, tilt, settings.
import { describe, it, expect } from 'vitest';
import { stickVector, shapeAxis, steerFromStick, FloatingStick, STICK_DEFAULTS } from '../src/input/touch/joystick.js';
import { GestureRecognizer, gestureToMenuAction, GESTURE_DEFAULTS } from '../src/input/touch/gestures.js';
import { TiltSteer, rawTiltAngle, normalizeScreenAngle, screenAngleOf, tiltSupported, requestTiltPermission } from '../src/input/touch/tilt.js';
import {
  normalizeTouchSettings, loadTouchSettings, saveTouchSettings, createTouchSettingsStore,
  DEFAULT_TOUCH_SETTINGS, TOUCH_SETTINGS_KEY,
} from '../src/input/touch/touchSettings.js';

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

describe('joystick math', () => {
  it('stickVector clamps to the unit circle and keeps direction', () => {
    expect(stickVector(0, 0, 32, 0, 64)).toEqual({ x: 0.5, y: 0, mag: 0.5 });
    const v = stickVector(0, 0, 300, 400, 100);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
    expect(v.mag).toBe(1);
  });
  it('stickVector survives junk input', () => {
    const v = stickVector(NaN, 0, Infinity, 5, 0);
    expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
  });
  it('shapeAxis: deadzone, exact full deflection, sign, curve', () => {
    expect(shapeAxis(0.05)).toBe(0);
    expect(shapeAxis(-STICK_DEFAULTS.deadzone)).toBe(0);
    expect(shapeAxis(1)).toBeCloseTo(1);
    expect(shapeAxis(-1)).toBeCloseTo(-1);
    expect(shapeAxis(2)).toBeCloseTo(1); // clamped
    const lin = shapeAxis(0.56, { deadzone: 0.12, curve: 1 });
    const curved = shapeAxis(0.56, { deadzone: 0.12, curve: 1.35 });
    expect(lin).toBeCloseTo(0.5);
    expect(curved).toBeLessThan(lin); // finer control near centre
    expect(shapeAxis(NaN)).toBe(0);
  });
  it('shapeAxis is monotonic', () => {
    let prev = -Infinity;
    for (let x = -1; x <= 1.0001; x += 0.05) {
      const y = shapeAxis(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });
  it('steerFromStick reads the x axis only', () => {
    expect(steerFromStick({ x: 0, y: 1 })).toBe(0);
    expect(steerFromStick({ x: 1, y: 0 })).toBeCloseTo(1);
    expect(steerFromStick(null)).toBe(0);
  });
  it('FloatingStick: centre where the thumb lands, one owner at a time', () => {
    const s = new FloatingStick({ radius: 50, follow: false });
    expect(s.steer()).toBe(0);
    expect(s.start(1, 100, 200)).toBe(true);
    expect(s.start(2, 0, 0)).toBe(false);
    expect(s.move(2, 500, 200)).toBe(false); // someone else's finger
    s.move(1, 150, 200);
    expect(s.steer()).toBeCloseTo(1);
    expect(s.thumb).toEqual({ x: 150, y: 200 });
    s.move(1, 75, 200);
    expect(s.steer()).toBeLessThan(0);
    expect(s.end(2)).toBe(false);
    expect(s.end(1)).toBe(true);
    expect(s.active).toBe(false);
    expect(s.steer()).toBe(0);
  });
  it('FloatingStick follow mode drags the base so reversing is instant', () => {
    const s = new FloatingStick({ radius: 50 });
    s.start(1, 100, 100);
    s.move(1, 300, 100); // 4 radii to the right
    expect(s.origin.x).toBeCloseTo(250);
    expect(s.steer()).toBeCloseTo(1);
    s.move(1, 240, 100); // tiny move back → already steering left
    expect(s.steer()).toBeLessThan(0);
  });
});

describe('gesture recognition', () => {
  const g = () => new GestureRecognizer();
  it('tap: quick and still', () => {
    const r = g();
    r.down(1, 10, 10, 0);
    expect(r.up(1, 12, 11, 120)).toBe('tap');
  });
  it('a slow still press is not a tap', () => {
    const r = g();
    r.down(1, 10, 10, 0);
    expect(r.up(1, 10, 10, GESTURE_DEFAULTS.tapMaxMs + 100)).toBe(null);
  });
  it('swipes in 4 directions, diagonals ignored', () => {
    const cases = [[-100, 0, 'swipe-left'], [100, 0, 'swipe-right'], [0, -100, 'swipe-up'], [0, 100, 'swipe-down'], [80, 75, null]];
    for (const [dx, dy, want] of cases) {
      const r = g();
      r.down(1, 200, 200, 0);
      r.move(1, 200 + dx / 2, 200 + dy / 2);
      expect(r.up(1, 200 + dx, 200 + dy, 150)).toBe(want);
    }
  });
  it('too short or too slow is not a swipe', () => {
    const r = g();
    r.down(1, 0, 0, 0);
    expect(r.up(1, 20, 0, 100)).toBe(null);
    r.down(2, 0, 0, 0);
    expect(r.up(2, 200, 0, 2000)).toBe(null);
  });
  it('long-press fires once while held, and the release is swallowed', () => {
    const r = g();
    r.down(1, 50, 50, 0);
    expect(r.tick(100)).toBe(null);
    expect(r.tick(GESTURE_DEFAULTS.longPressMs + 1)).toBe('long-press');
    expect(r.tick(2000)).toBe(null);
    expect(r.up(1, 50, 50, 2100)).toBe(null);
  });
  it('moving cancels long-press', () => {
    const r = g();
    r.down(1, 50, 50, 0);
    r.move(1, 120, 50);
    expect(r.tick(1000)).toBe(null);
  });
  it('two-finger tap', () => {
    const r = g();
    r.down(1, 10, 10, 0);
    r.down(2, 60, 10, 20);
    expect(r.tick(900)).toBe(null); // no long-press with two fingers
    expect(r.up(1, 10, 10, 150)).toBe(null);
    expect(r.up(2, 60, 10, 200)).toBe('two-finger-tap');
  });
  it('two fingers that move or linger are not a tap', () => {
    const r = g();
    r.down(1, 10, 10, 0);
    r.down(2, 60, 10, 0);
    r.move(2, 160, 10);
    r.up(1, 10, 10, 100);
    expect(r.up(2, 160, 10, 120)).toBe(null);
    r.down(3, 0, 0, 0);
    r.down(4, 5, 5, 0);
    r.up(3, 0, 0, 900);
    expect(r.up(4, 5, 5, 1000)).toBe(null);
  });
  it('unknown pointers, cancel and reset are safe', () => {
    const r = g();
    expect(r.up(9, 0, 0, 0)).toBe(null);
    r.move(9, 1, 1);
    r.down(1, 0, 0, 0);
    r.cancel(1);
    expect(r.count).toBe(0);
    r.down(1, 0, 0, 0);
    r.reset();
    expect(r.count).toBe(0);
  });
  it('maps gestures to menu actions (swipe left = next = right)', () => {
    expect(gestureToMenuAction('swipe-left')).toBe('right');
    expect(gestureToMenuAction('swipe-right')).toBe('left');
    expect(gestureToMenuAction('swipe-up')).toBe('down');
    expect(gestureToMenuAction('swipe-down')).toBe('up');
    expect(gestureToMenuAction('long-press')).toBe('toggle');
    expect(gestureToMenuAction('two-finger-tap')).toBe('back');
    expect(gestureToMenuAction('tap')).toBe(null);
    expect(gestureToMenuAction(undefined)).toBe(null);
  });
});

describe('tilt steering', () => {
  it('normalizes screen angles', () => {
    expect(normalizeScreenAngle(0)).toBe(0);
    expect(normalizeScreenAngle(-90)).toBe(270);
    expect(normalizeScreenAngle(450)).toBe(90);
    expect(normalizeScreenAngle(undefined)).toBe(0);
  });
  it('picks the wheel axis for the orientation', () => {
    const r = { beta: 10, gamma: -20 };
    expect(rawTiltAngle(r, 0)).toBe(-20);
    expect(rawTiltAngle(r, 90)).toBe(10);
    expect(rawTiltAngle(r, -90)).toBe(-10);
    expect(rawTiltAngle(r, 180)).toBe(20);
    expect(rawTiltAngle({}, 90)).toBe(0);
  });
  it('screenAngleOf prefers screen.orientation, then window.orientation', () => {
    expect(screenAngleOf({ screen: { orientation: { angle: 90 } } })).toBe(90);
    expect(screenAngleOf({ orientation: -90 })).toBe(-90);
    expect(screenAngleOf(null)).toBe(0);
  });
  it('deadzone, full lock, sign', () => {
    const t = new TiltSteer({ smoothing: 0, maxAngle: 24, deadzone: 3 });
    t.feed({ beta: 2, gamma: 0 }, 90);
    expect(t.update(1 / 60)).toBe(0);
    t.feed({ beta: 30 }, 90);
    expect(t.update(1 / 60)).toBe(1);
    t.feed({ beta: -13.5 }, 90);
    expect(t.update(1 / 60)).toBeCloseTo(-0.5);
  });
  it('calibration makes the current angle straight ahead', () => {
    const t = new TiltSteer({ smoothing: 0 });
    t.feed({ beta: 40 }, 90);
    expect(t.calibrate()).toBe(40);
    expect(t.update(0.016)).toBe(0);
    t.feed({ beta: 40 + 24 }, 90);
    expect(t.update(0.016)).toBe(1);
  });
  it('wraps across ±180', () => {
    const t = new TiltSteer({ smoothing: 0, neutral: 175 });
    t.feed({ beta: -175 }, 90); // 10° past neutral, across the wrap
    expect(t.target()).toBeGreaterThan(0);
    const t2 = new TiltSteer({ smoothing: 0, neutral: -175 });
    t2.feed({ beta: 175 }, 90);
    expect(t2.target()).toBeLessThan(0);
  });
  it('smoothing is a frame-rate independent low-pass', () => {
    const a = new TiltSteer({ smoothing: 0.1 });
    const b = new TiltSteer({ smoothing: 0.1 });
    a.feed({ beta: 0 }, 90); b.feed({ beta: 0 }, 90);
    a.feed({ beta: 60 }, 90); b.feed({ beta: 60 }, 90);
    for (let i = 0; i < 6; i++) a.update(1 / 60);
    for (let i = 0; i < 3; i++) b.update(1 / 30);
    expect(a.value).toBeCloseTo(b.value, 5);
    expect(a.value).toBeGreaterThan(0);
    expect(a.value).toBeLessThan(1);
    for (let i = 0; i < 200; i++) a.update(1 / 60);
    expect(a.value).toBeCloseTo(1, 3);
    expect(a.update(0)).toBe(a.value); // no time, no change
  });
  it('ignores empty readings; first reading snaps', () => {
    const t = new TiltSteer({ smoothing: 1 });
    t.feed(null);
    t.feed({ alpha: 3 });
    expect(t.hasReading).toBe(false);
    t.feed({ gamma: 30 }, 0);
    expect(t.value).toBe(1);
  });
  it('permission helper: unsupported / granted / iOS prompt / denied / throws', async () => {
    expect(tiltSupported(undefined)).toBe(false);
    expect(await requestTiltPermission({})).toBe('unsupported');
    expect(await requestTiltPermission({ DeviceOrientationEvent: function D() {} })).toBe('granted');
    const ios = (res) => ({ DeviceOrientationEvent: { requestPermission: async () => res } });
    expect(await requestTiltPermission(ios('granted'))).toBe('granted');
    expect(await requestTiltPermission(ios('denied'))).toBe('denied');
    expect(await requestTiltPermission({ DeviceOrientationEvent: { requestPermission: async () => { throw new Error('no gesture'); } } })).toBe('denied');
  });
});

describe('touch settings', () => {
  it('defaults: joystick, auto-gas ON', () => {
    const s = normalizeTouchSettings(null);
    expect(s).toEqual({ ...DEFAULT_TOUCH_SETTINGS });
    expect(s.autoGas).toBe(true);
    expect(s.style).toBe('joystick');
  });
  it('normalizes junk and clamps numbers', () => {
    const s = normalizeTouchSettings({ style: 'mind-control', autoGas: 'yes', size: 'huge', opacity: 9, tiltNeutral: 999, leftHanded: true });
    expect(s.style).toBe('joystick');
    expect(s.autoGas).toBe(true);
    expect(s.size).toBe('medium');
    expect(s.opacity).toBe(1);
    expect(s.tiltNeutral).toBe(180);
    expect(s.leftHanded).toBe(true);
  });
  it('load / save round trip, bad JSON and missing storage are safe', () => {
    const st = memStorage();
    saveTouchSettings({ style: 'tilt', autoGas: false }, st);
    expect(JSON.parse(st.map.get(TOUCH_SETTINGS_KEY)).style).toBe('tilt');
    expect(loadTouchSettings(st).autoGas).toBe(false);
    expect(loadTouchSettings(memStorage({ [TOUCH_SETTINGS_KEY]: '{oops' })).style).toBe('joystick');
    expect(loadTouchSettings(null).style).toBe('joystick');
    const throwing = { getItem() { throw new Error('x'); }, setItem() { throw new Error('quota'); } };
    expect(saveTouchSettings({ size: 'large' }, throwing).size).toBe('large');
  });
  it('store: set merges, saves and notifies; unsubscribe works', () => {
    const st = memStorage();
    const store = createTouchSettingsStore(st);
    const seen = [];
    const off = store.subscribe((s) => seen.push(s.size));
    store.subscribe(() => { throw new Error('bad listener'); });
    store.set({ size: 'large' });
    expect(store.get().size).toBe('large');
    expect(store.get().autoGas).toBe(true);
    expect(loadTouchSettings(st).size).toBe('large');
    off();
    store.set({ size: 'small' });
    expect(seen).toEqual(['large']);
  });
});
