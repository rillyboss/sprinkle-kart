/**
 * Wires menu gestures (swipe / long-press / two-finger tap) on the menus element to the
 * touch devices. Only TOUCH pointers count (a mouse drag never swipes). Logic:
 * src/input/touch/menuGestures.js. Screens are not touched: gestures arrive as ordinary
 * menu events ({ deviceId: 'touch1', action: 'right' }).
 *
 *   const off = attachMenuGestures(menus.el, touch, { win: window });
 */
import { MenuGestureController } from '../../input/touch/menuGestures.js';

/** The touch device a menu gesture at x belongs to (left / right half with two touch players). */
export function menuDeviceFor(touch, x, width) {
  const d2 = touch.device('touch2');
  if (d2 && Number.isFinite(width) && x >= width / 2) return d2;
  return touch.device('touch1');
}

export function attachMenuGestures(target, touch, { win = typeof window !== 'undefined' ? window : null, now } = {}) {
  if (!target || typeof target.addEventListener !== 'function' || !touch) return () => {};
  const clock = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const mg = new MenuGestureController({ deviceFor: (x) => menuDeviceFor(touch, x, win?.innerWidth) });
  let raf = null;
  const loop = () => {
    raf = null;
    mg.tick(clock());
    if (mg.g.count > 0) raf = win?.requestAnimationFrame?.(loop) ?? null;
  };
  const isTouch = (e) => e.pointerType === 'touch';
  const onDown = (e) => {
    if (!isTouch(e)) return;
    touch.register?.();
    mg.down(e.pointerId, e.clientX, e.clientY, clock());
    if (raf === null) raf = win?.requestAnimationFrame?.(loop) ?? null;
  };
  const onMove = (e) => { if (isTouch(e)) mg.move(e.pointerId, e.clientX, e.clientY); };
  const onUp = (e) => { if (isTouch(e)) mg.up(e.pointerId, e.clientX, e.clientY, clock()); };
  const onCancel = (e) => { if (isTouch(e)) mg.cancel(e.pointerId); };
  const onClick = (e) => {
    if (mg.suppressClick(clock())) { e.stopPropagation?.(); e.preventDefault?.(); }
  };
  const onContext = (e) => { if (mg.g.count > 0) e.preventDefault?.(); };
  target.addEventListener('pointerdown', onDown, true);
  target.addEventListener('pointermove', onMove, true);
  target.addEventListener('pointerup', onUp, true);
  target.addEventListener('pointercancel', onCancel, true);
  target.addEventListener('click', onClick, true);
  target.addEventListener('contextmenu', onContext, true);
  return () => {
    target.removeEventListener('pointerdown', onDown, true);
    target.removeEventListener('pointermove', onMove, true);
    target.removeEventListener('pointerup', onUp, true);
    target.removeEventListener('pointercancel', onCancel, true);
    target.removeEventListener('click', onClick, true);
    target.removeEventListener('contextmenu', onContext, true);
    if (raf !== null) win?.cancelAnimationFrame?.(raf);
  };
}
