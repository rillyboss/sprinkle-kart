/**
 * installTouchInput — registers the touch players as InputManager devices.
 *
 *   const touch = installTouchInput(input, { win: window, store, force: false });
 *   touch.devices            Map<'touch1'|'touch2', TouchDevice>
 *   touch.device(id)         TouchDevice | null
 *   touch.capable            this looks like a phone / tablet (or ?touch=1)
 *   touch.tilt               TiltSteer shared by the whole screen (touch1 only)
 *   touch.enableTilt()       ask for motion permission (call from a TAP on iOS) → Promise<state>
 *   touch.tiltState          'off' | 'on' | 'denied' | 'unsupported'
 *   touch.dispose()
 *
 * Devices appear:
 *   - right away on a coarse-pointer device (phones, tablets) or with `force`;
 *   - otherwise on the first touch press anywhere (a touchscreen laptop),
 * so a phone player is a controller like any other and taps "Join" to become P1.
 * `touch2` exists only while the "two touch players" setting is on.
 */
import { TouchDevice, TOUCH_LABELS, makeHaptics } from './TouchDevice.js';
import { TiltSteer, screenAngleOf, requestTiltPermission, tiltSupported } from './tilt.js';
import { createTouchSettingsStore } from './touchSettings.js';

export const TOUCH_IDS = Object.freeze(['touch1', 'touch2']);
export const TOUCH_ICON = '👆';

export function touchDeviceName(id, twoPlayers) {
  if (!twoPlayers) return 'Touch screen';
  return id === 'touch2' ? 'Touch (right side)' : 'Touch (left side)';
}

/** Best guess whether the primary input is a finger. */
export function isTouchCapable(win, force = false) {
  if (force) return true;
  if (!win) return false;
  try {
    if (typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches) return true;
  } catch { /* ignore */ }
  const nav = win.navigator;
  return !!(nav && nav.maxTouchPoints > 0 && typeof win.matchMedia !== 'function');
}

export function installTouchInput(input, { win = typeof window !== 'undefined' ? window : undefined, store = createTouchSettingsStore(), force = false, now } = {}) {
  const clock = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const devices = new Map();
  const haptics = makeHaptics(win?.navigator);
  const tilt = new TiltSteer({ neutral: store.get().tiltNeutral });
  let lastRead = null;
  let tiltState = tiltSupported(win) ? 'off' : 'unsupported';
  let orientationOn = false;

  const onOrientation = (e) => tilt.feed(e, screenAngleOf(win));
  function listenOrientation(on) {
    if (!win || typeof win.addEventListener !== 'function' || on === orientationOn) return;
    orientationOn = on;
    win[on ? 'addEventListener' : 'removeEventListener']('deviceorientation', onOrientation);
  }

  function makeSource(dev) {
    return {
      read(t) {
        if (dev.id === 'touch1' && dev.settings.style === 'tilt' && tiltState === 'on') {
          const tt = Number.isFinite(t) ? t : clock();
          const dt = lastRead === null ? 0 : Math.max(0, Math.min(0.1, (tt - lastRead) / 1000));
          lastRead = tt;
          dev.setTiltSteer(tilt.update(dt));
        }
        return dev.read();
      },
      rumble: (s, ms) => dev.rumble(s, ms),
    };
  }

  function announce(dev) {
    input.addExternalDevice(dev.id, makeSource(dev), { name: dev.name, kind: 'touch', type: 'touch', icon: TOUCH_ICON, labels: { ...TOUCH_LABELS }, pointerType: 'touch' });
  }

  function addDevice(id) {
    if (devices.has(id)) return devices.get(id);
    const s = store.get();
    const dev = new TouchDevice({ id, name: touchDeviceName(id, s.twoPlayers), settings: s, slot: TOUCH_IDS.indexOf(id) });
    dev.haptics = haptics;
    devices.set(id, dev);
    announce(dev);
    return dev;
  }

  function removeDevice(id) {
    if (!devices.has(id)) return;
    devices.delete(id);
    input.removeExternalDevice(id);
  }

  function ensureDevices() {
    const s = store.get();
    addDevice('touch1');
    if (s.twoPlayers) addDevice('touch2');
    else removeDevice('touch2');
    for (const dev of devices.values()) {
      dev.setSettings(s);
      const name = touchDeviceName(dev.id, s.twoPlayers);
      if (name !== dev.name) {
        dev.name = name;
        announce(dev); // re-register under the new name (same id, stays connected)
      }
    }
  }

  const capable = isTouchCapable(win, force);
  let registered = false;
  function register() {
    if (registered) return;
    registered = true;
    ensureDevices();
  }
  if (capable) register();

  const onPointerDown = (e) => {
    if (e && e.pointerType === 'touch') register();
  };
  if (!registered && win && typeof win.addEventListener === 'function') {
    win.addEventListener('pointerdown', onPointerDown, true);
  }

  const unsub = store.subscribe((s) => {
    tilt.opts.neutral = s.tiltNeutral;
    if (registered) ensureDevices();
    listenOrientation(s.style === 'tilt' && tiltState === 'on');
  });

  const api = {
    devices,
    store,
    tilt,
    capable,
    get registered() { return registered; },
    get tiltState() { return tiltState; },
    device: (id) => devices.get(id) ?? null,
    isTouchDevice: (id) => devices.has(id),
    register,
    /** Ask for motion permission (iOS needs a tap) and start listening. */
    async enableTilt() {
      if (tiltState === 'unsupported') return tiltState;
      const res = await requestTiltPermission(win);
      tiltState = res === 'granted' ? 'on' : res === 'unsupported' ? 'unsupported' : 'denied';
      listenOrientation(tiltState === 'on' && store.get().style === 'tilt');
      return tiltState;
    },
    /** Current angle becomes "straight ahead" (saved). */
    calibrateTilt() {
      const n = tilt.calibrate();
      store.set({ tiltNeutral: n });
      return n;
    },
    dispose() {
      unsub();
      listenOrientation(false);
      win?.removeEventListener?.('pointerdown', onPointerDown, true);
      for (const id of [...devices.keys()]) removeDevice(id);
    },
  };
  return api;
}
