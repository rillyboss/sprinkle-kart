/**
 * iOS / Android web platform fixes (mobile platform). OWNER: mobile platform.
 * Each installer takes the window / document it works on (tests pass fakes) and returns an uninstall function.
 *
 *   applyViewportVars(win, caps)       CSS custom properties + data attributes on <html> for the UI (see below)
 *   installViewportWatch(win, caps)    keeps them fresh on resize / rotation / visual-viewport changes
 *   installGestureGuards(win)          no pinch zoom, no double-tap zoom, no pull-to-refresh / bounce, no long-press
 *                                      callout or text selection in-game (inputs and [data-sk-scroll] still work)
 *   installAudioResume(win, audio)     Web Audio unlock + resume on the first / every touchend (iOS needs a gesture,
 *                                      and after a phone call or Siri the context sits in 'interrupted')
 *   installLifecycle(win, handlers)    visibilitychange / pagehide / pageshow → onHidden(reason) / onVisible(reason)
 *   installContextLossGuard(canvas, h) webglcontextlost / webglcontextrestored → onLost() / onRestored()
 *   requestLandscape(win)              fullscreen + screen.orientation.lock('landscape') (call from a user gesture)
 *
 * CSS custom properties on <html> (use them in any stylesheet; the phase-2 responsive UI builds on these):
 *   --sk-safe-top / -right / -bottom / -left   env(safe-area-inset-*) (notch, home indicator, rounded corners)
 *   --sk-app-height / --sk-app-width           the visible viewport in px (100dvh without the iOS toolbar bugs)
 * Data attributes on <html>:
 *   data-sk-device="phone|tablet|desktop"  data-sk-touch="1|0"  data-sk-orientation="landscape|portrait"
 *   data-sk-standalone="1|0" (home-screen app)  data-sk-os="ios|android|…"
 * The static part (env() fallbacks, 100dvh, gesture CSS) lives in src/platform/platform.css.
 */

const docOf = (win) => win?.document ?? null;

/** landscape | portrait for a width / height. */
export const orientationOf = (w, h) => (Number(w) >= Number(h) ? 'landscape' : 'portrait');

/**
 * Write the viewport variables + data attributes. Returns what it wrote (for tests / debug).
 * @param {any} win
 * @param {{ deviceClass?: string, touch?: boolean, standalone?: boolean, os?: string }} caps
 */
export function applyViewportVars(win, caps = {}) {
  const doc = docOf(win);
  const root = doc?.documentElement;
  if (!root) return null;
  const vv = win.visualViewport;
  const w = Math.round(vv?.width || win.innerWidth || root.clientWidth || 0);
  const h = Math.round(vv?.height || win.innerHeight || root.clientHeight || 0);
  const vals = {
    '--sk-app-width': `${w}px`,
    '--sk-app-height': `${h}px`,
  };
  for (const [k, v] of Object.entries(vals)) root.style?.setProperty?.(k, v);
  const data = {
    skDevice: caps.deviceClass || 'desktop',
    skTouch: caps.touch ? '1' : '0',
    skOrientation: orientationOf(w, h),
    skStandalone: caps.standalone ? '1' : '0',
    skOs: caps.os || 'other',
  };
  if (root.dataset) Object.assign(root.dataset, data);
  return { ...vals, ...data, width: w, height: h };
}

/** Re-apply on resize, rotation and visual viewport changes (the iOS toolbar sliding in / out). */
export function installViewportWatch(win, caps, onChange) {
  if (!win?.addEventListener) return () => {};
  let pending = false;
  const run = () => {
    pending = false;
    const r = applyViewportVars(win, caps);
    try { onChange?.(r); } catch { /* ignore */ }
  };
  const later = () => {
    if (pending) return;
    pending = true;
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run);
    else run();
  };
  // iOS reports the new size a little after 'orientationchange': check again shortly after
  const rotate = () => { later(); setTimeout(later, 250); };
  win.addEventListener('resize', later);
  win.addEventListener('orientationchange', rotate);
  win.visualViewport?.addEventListener?.('resize', later);
  run();
  return () => {
    win.removeEventListener('resize', later);
    win.removeEventListener('orientationchange', rotate);
    win.visualViewport?.removeEventListener?.('resize', later);
  };
}

/** Elements where the normal touch behaviour must survive (typing a room code, scrolling a list). */
export function allowsNativeTouch(target) {
  let el = target;
  for (let i = 0; el && i < 25; i++, el = el.parentElement) {
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
    if (el.dataset && ('skScroll' in el.dataset)) return true;
    if (el.classList?.contains?.('sk-scroll')) return true;
  }
  return false;
}

/** Is the element (or an ancestor) a real scroll container with something to scroll? */
export function inScrollable(target, win) {
  let el = target;
  for (let i = 0; el && el.nodeType === 1 && i < 25; i++, el = el.parentElement) {
    if (el === win?.document?.body || el === win?.document?.documentElement) return false;
    try {
      const st = win.getComputedStyle(el);
      const oy = st.overflowY, ox = st.overflowX;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return true;
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true;
    } catch { return false; }
  }
  return false;
}

/**
 * Block the browser gestures that break a game on touch screens.
 * @param {any} win
 */
export function installGestureGuards(win) {
  const doc = docOf(win);
  if (!doc?.addEventListener) return () => {};
  const offs = [];
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); offs.push(() => target.removeEventListener(ev, fn, opts)); };
  const stop = (e) => { if (e.cancelable !== false) e.preventDefault?.(); };
  // iOS Safari pinch (it ignores user-scalable=no since iOS 10)
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) on(doc, ev, stop, { passive: false });
  // two fingers = pinch; one finger drag outside a scroll list = pull-to-refresh / rubber-band bounce
  on(doc, 'touchmove', (e) => {
    if ((e.touches?.length ?? 1) > 1) { stop(e); return; }
    if (allowsNativeTouch(e.target) || inScrollable(e.target, win)) return;
    stop(e);
  }, { passive: false });
  // desktop-mode double-click zoom and long-press menus / callouts / selection
  on(doc, 'dblclick', (e) => { if (!allowsNativeTouch(e.target)) stop(e); }, { passive: false });
  on(doc, 'contextmenu', (e) => { if (!allowsNativeTouch(e.target)) stop(e); });
  on(doc, 'selectstart', (e) => { if (!allowsNativeTouch(e.target)) stop(e); });
  return () => offs.forEach((off) => off());
}

/**
 * iOS: the AudioContext may only start in a touchend / click, and it drops to 'suspended' / 'interrupted'
 * after a call, Siri or a lock. Every gesture unlocks (first time) and resumes (later) while the page is visible.
 * @param {any} win
 * @param {{ unlock?: () => any, ctx?: { state: string, resume: () => Promise<any> } | null }} audio
 */
export function installAudioResume(win, audio) {
  const doc = docOf(win);
  if (!doc?.addEventListener || !audio) return () => {};
  const kick = () => {
    if (doc.visibilityState === 'hidden') return;
    try { audio.unlock?.(); } catch { /* ignore */ }
    const ctx = audio.ctx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
      try { ctx.resume?.()?.catch?.(() => {}); } catch { /* ignore */ }
    }
  };
  const evs = ['touchend', 'pointerup', 'click', 'keydown'];
  for (const ev of evs) doc.addEventListener(ev, kick, { capture: true, passive: true });
  return () => { for (const ev of evs) doc.removeEventListener(ev, kick, { capture: true, passive: true }); };
}

/**
 * Page lifecycle: onHidden('hidden' | 'pagehide'), onVisible('visible' | 'pageshow'). Deduplicated: a hidden page
 * reports hidden once until it is visible again.
 * @param {any} win
 * @param {{ onHidden?: (reason: string) => void, onVisible?: (reason: string) => void }} h
 */
export function installLifecycle(win, { onHidden, onVisible } = {}) {
  const doc = docOf(win);
  if (!doc?.addEventListener || !win?.addEventListener) return () => {};
  let hidden = doc.visibilityState === 'hidden';
  const hide = (reason) => { if (hidden) return; hidden = true; try { onHidden?.(reason); } catch { /* ignore */ } };
  const show = (reason) => { if (!hidden) return; hidden = false; try { onVisible?.(reason); } catch { /* ignore */ } };
  const vis = () => (doc.visibilityState === 'hidden' ? hide('hidden') : show('visible'));
  const ph = () => hide('pagehide');
  const ps = (e) => { if (doc.visibilityState !== 'hidden') show(e?.persisted ? 'pageshow' : 'visible'); };
  doc.addEventListener('visibilitychange', vis);
  win.addEventListener('pagehide', ph);
  win.addEventListener('pageshow', ps);
  return () => {
    doc.removeEventListener('visibilitychange', vis);
    win.removeEventListener('pagehide', ph);
    win.removeEventListener('pageshow', ps);
  };
}

/**
 * WebGL context loss (iOS drops it when memory runs low or the app sits in the background). preventDefault on
 * 'webglcontextlost' is what allows the browser to restore it; three.js' renderer rebuilds its state on restore.
 * @param {any} canvas
 * @param {{ onLost?: () => void, onRestored?: () => void }} h
 */
export function installContextLossGuard(canvas, { onLost, onRestored } = {}) {
  if (!canvas?.addEventListener) return () => {};
  const lost = (e) => { e.preventDefault?.(); try { onLost?.(); } catch { /* ignore */ } };
  const restored = () => { try { onRestored?.(); } catch { /* ignore */ } };
  canvas.addEventListener('webglcontextlost', lost, false);
  canvas.addEventListener('webglcontextrestored', restored, false);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost, false);
    canvas.removeEventListener('webglcontextrestored', restored, false);
  };
}

/**
 * Full screen + landscape lock where the browser allows it (Android Chrome, iPadOS Safari partially; iPhone
 * Safari has neither — the rotate overlay covers it). Must run inside a user gesture. Never throws / rejects.
 * @param {any} win
 * @returns {Promise<{ fullscreen: boolean, locked: boolean }>}
 */
export async function requestLandscape(win) {
  const doc = docOf(win);
  const root = doc?.documentElement;
  const out = { fullscreen: false, locked: false };
  if (!root) return out;
  try {
    if (!(doc.fullscreenElement || doc.webkitFullscreenElement)) {
      const req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) { await req.call(root, { navigationUI: 'hide' }); out.fullscreen = true; }
    } else out.fullscreen = true;
  } catch { /* denied / unsupported */ }
  try {
    const o = win.screen?.orientation;
    if (o?.lock) { await o.lock('landscape'); out.locked = true; }
  } catch { /* only allowed in fullscreen on most browsers */ }
  return out;
}
