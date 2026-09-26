/**
 * Installable app: service worker registration, "New version — tap to update", install hints.
 * OWNER: mobile platform. The worker itself is generated at build time by build/pwa.js (dist/sw.js).
 *
 *   swSupport({ nav, loc, prod })            PURE → { ok, reason } (https or localhost, production build only)
 *   registerServiceWorker({ nav, loc, onUpdateReady, url })  → Promise<registration|null>
 *   applyUpdate(reg, { nav, reload })        tell the waiting worker to take over, reload once it has
 *   installHintKind({ caps, standalone, canPrompt, visits, dismissedAt, now })  PURE → 'ios' | 'android' | null
 *   createToast({ doc, text, action, onTap, onClose, cls })  a small tappable bubble (restyle via .sk-pwa-toast)
 *
 * Update policy (never a stale build for online play — NETWORKING.md §7.2): the worker answers page loads
 * NETWORK-FIRST, so whenever the device is online the page is the newest deploy; the cached copy is only used
 * offline (local play). A tab that stays open across a deploy finds the new worker on the next update check
 * (on focus and every 30 min) and shows "New version — tap to update"; nothing reloads by itself, so a race
 * or an online room is never cut off. `platform.pwa.updateReady` tells the online screens a refresh is due.
 */

export const UPDATE_TEXT = '✨ New version — tap to update';
export const IOS_HINT_TEXT = 'Tip: tap Share ⬆️ then “Add to Home Screen” to play full screen! 🍭';
export const ANDROID_HINT_TEXT = '📲 Add Sprinkle Kart to your home screen';
export const HINT_KEY = 'sprinkle-kart-install-hint-v1';
/** Days before a dismissed install hint may show again. */
export const HINT_SNOOZE_DAYS = 30;
/** Visits before the install hint appears (never on the very first one). */
export const HINT_MIN_VISITS = 2;
export const UPDATE_CHECK_MS = 30 * 60 * 1000;

/**
 * @param {{ nav?: any, loc?: { protocol?: string, hostname?: string }, prod?: boolean }} env
 */
export function swSupport({ nav, loc, prod } = {}) {
  if (!prod) return { ok: false, reason: 'dev build' };
  if (!nav?.serviceWorker?.register) return { ok: false, reason: 'no service worker' };
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(String(loc?.hostname ?? ''));
  if (loc?.protocol !== 'https:' && !local) return { ok: false, reason: 'not https' };
  return { ok: true, reason: 'ok' };
}

/**
 * Register ./sw.js (relative, so it works under the GitHub Pages sub-path) and report an update that is
 * installed and waiting. The very first install (no controller yet) is not an "update".
 * @param {{ nav: any, url?: string, onUpdateReady?: (reg: any) => void, win?: any }} opts
 */
export async function registerServiceWorker({ nav, url = './sw.js', onUpdateReady, win } = {}) {
  const sw = nav?.serviceWorker;
  if (!sw?.register) return null;
  let reg;
  try { reg = await sw.register(url, { scope: './' }); } catch { return null; }
  let told = false;
  const ready = () => {
    if (told || !reg.waiting || !sw.controller) return;
    told = true;
    try { onUpdateReady?.(reg); } catch { /* ignore */ }
  };
  ready();
  reg.addEventListener?.('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener?.('statechange', () => { if (w.state === 'installed') ready(); });
  });
  if (win?.addEventListener) {
    const check = () => { try { reg.update?.()?.catch?.(() => {}); } catch { /* ignore */ } };
    win.document?.addEventListener?.('visibilitychange', () => { if (win.document.visibilityState === 'visible') check(); });
    if (typeof win.setInterval === 'function') win.setInterval(check, UPDATE_CHECK_MS);
  }
  return reg;
}

/**
 * Activate the waiting worker and reload once it controls the page.
 * @param {any} reg
 * @param {{ nav?: any, reload?: () => void }} [opts]
 */
export function applyUpdate(reg, { nav, reload } = {}) {
  const sw = nav?.serviceWorker;
  let done = false;
  const go = () => { if (done) return; done = true; try { reload?.(); } catch { /* ignore */ } };
  sw?.addEventListener?.('controllerchange', go);
  if (reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  else go();
}

/**
 * Which install hint to show, if any.
 * @param {{ caps?: any, standalone?: boolean, canPrompt?: boolean, visits?: number, dismissedAt?: number|null, now?: number }} s
 * @returns {'ios'|'android'|null}
 */
export function installHintKind({ caps = {}, standalone = false, canPrompt = false, visits = 0, dismissedAt = null, now = Date.now() } = {}) {
  if (standalone || caps.standalone) return null;
  if (!caps.mobile) return null;
  if ((visits || 0) < HINT_MIN_VISITS) return null;
  if (Number.isFinite(dismissedAt) && now - dismissedAt < HINT_SNOOZE_DAYS * 86400000) return null;
  if (caps.isIOS && caps.isSafari) return 'ios';
  if (canPrompt) return 'android';
  return null;
}

/** Saved hint state { visits, dismissedAt }; never throws. */
export function createHintStore(storage = (() => { try { return localStorage; } catch { return null; } })()) {
  const read = () => {
    try {
      const v = JSON.parse(storage?.getItem(HINT_KEY) || 'null');
      return { visits: Number(v?.visits) || 0, dismissedAt: Number.isFinite(v?.dismissedAt) ? v.dismissedAt : null };
    } catch { return { visits: 0, dismissedAt: null }; }
  };
  const write = (v) => { try { storage?.setItem(HINT_KEY, JSON.stringify(v)); } catch { /* ignore */ } return v; };
  return {
    read,
    visit() { const v = read(); return write({ ...v, visits: v.visits + 1 }); },
    dismiss(now = Date.now()) { return write({ ...read(), dismissedAt: now }); },
  };
}

/**
 * A small bubble at the bottom of the screen (safe-area aware, see platform.css). Tap = onTap, ✕ = onClose.
 * @param {{ doc?: any, text: string, action?: string, onTap?: () => void, onClose?: () => void, cls?: string }} o
 */
export function createToast({ doc = typeof document !== 'undefined' ? document : null, text, action = '', onTap, onClose, cls = '' } = {}) {
  if (!doc?.createElement || !doc.body) return { node: null, close() {} };
  const node = doc.createElement('div');
  node.className = `sk-pwa-toast ${cls}`.trim();
  node.setAttribute('role', 'status');
  const main = doc.createElement('button');
  main.type = 'button';
  main.className = 'sk-pwa-toast-main';
  main.textContent = text;
  if (action) {
    const b = doc.createElement('b');
    b.textContent = ` ${action}`;
    main.appendChild(b);
  }
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'sk-pwa-toast-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  node.append(main, close);
  let closed = false;
  const handle = {
    node,
    close() { if (closed) return; closed = true; node.remove(); },
  };
  main.addEventListener('click', (e) => { e.stopPropagation(); try { onTap?.(); } catch { /* ignore */ } });
  close.addEventListener('click', (e) => { e.stopPropagation(); handle.close(); try { onClose?.(); } catch { /* ignore */ } });
  doc.body.appendChild(node);
  return handle;
}
