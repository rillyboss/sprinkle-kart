/**
 * Touch controls system — phones and tablets play with their fingers.
 *
 * Installs (zero edits to main.js):
 *   - the touch devices ('touch1', + 'touch2' for two players on one tablet) in the
 *     InputManager (src/input/touch/installTouch.js) — they join like a controller;
 *   - menu gestures on the menus (swipe = move, long-press = toggle, two-finger tap = back);
 *   - the on-screen race controls overlay (src/ui/touch/TouchControls.js), shown at
 *     race-start for humans driving a touch device, suspended while paused / on results,
 *     removed at race-exit. Works the same for online races (the device feeds
 *     input.getDriveInput like any pad).
 *
 * `?touch=1` forces touch mode on a desktop browser (testing); `?touch=0` turns it off.
 * The runtime is published via src/input/touch/touchRuntime.js and window.__game.touch.
 */
import { installTouchInput } from '../input/touch/installTouch.js';
import { createTouchSettingsStore } from '../input/touch/touchSettings.js';
import { setTouchRuntime } from '../input/touch/touchRuntime.js';
import { TouchControls } from '../ui/touch/TouchControls.js';
import { attachMenuGestures } from '../ui/touch/menuGestureLayer.js';

/** '?touch=1' → true, '?touch=0' → false, else null (auto). */
export function touchParam(search = '') {
  try {
    const v = new URLSearchParams(search).get('touch');
    if (v === '1' || v === 'true' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'off') return false;
  } catch { /* ignore */ }
  return null;
}

/**
 * Wire everything. All browser pieces are injectable so node tests can drive it.
 * @returns {{ touch, overlay, uninstall: () => void } | null}
 */
export function createTouchSystem(bus, app, {
  win = typeof window !== 'undefined' ? window : null,
  store = null,
  install = installTouchInput,
  makeOverlay = null,
  attachGestures = null,
} = {}) {
  if (!win || !app?.input?.addExternalDevice) return null;
  const forced = touchParam(win.location?.search ?? '');
  if (forced === false) return null;
  const touch = install(app.input, { win, store: store ?? createTouchSettingsStore(), force: forced === true });
  const root = app.hud?.root ?? win.document?.getElementById?.('ui') ?? null;
  const overlay = makeOverlay && root ? makeOverlay({ root, touch, win }) : null;
  const offGestures = attachGestures && app.menus?.el ? attachGestures(app.menus.el, touch, { win }) : () => {};
  const markMenus = () => { if (touch.capable || touch.registered) root?.classList?.add('sk-touch-menus'); };
  markMenus();
  const offDev = app.input.onDeviceChange?.(markMenus) ?? (() => {});

  const offs = [
    bus.on('race-start', (info) => {
      overlay?.show((info?.humans ?? []).map((h) => ({ deviceId: h.deviceId, playerIndex: h.playerIndex })));
    }),
    bus.on('race-frame', (dt, session) => overlay?.update(dt, session)),
    bus.on('race-exit', () => overlay?.hide()),
  ];

  const rt = { touch, overlay, getTouchSafeRects: () => overlay?.getTouchSafeRects() ?? [] };
  setTouchRuntime(rt);
  if (app.game) app.game.touch = rt;

  return {
    touch,
    overlay,
    uninstall() {
      for (const off of offs) off();
      offGestures();
      offDev();
      overlay?.dispose?.();
      touch.dispose();
      setTouchRuntime(null);
      if (app.game?.touch === rt) delete app.game.touch;
    },
  };
}

export default {
  id: 'touch-controls',
  order: 60,
  install(bus, app) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const sys = createTouchSystem(bus, app, {
      makeOverlay: (o) => new TouchControls(o),
      attachGestures: attachMenuGestures,
    });
    return sys ? () => sys.uninstall() : undefined;
  },
};
