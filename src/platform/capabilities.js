/**
 * Device capability detection (mobile & tablet support). OWNER: mobile platform.
 *
 *   const env = readEnvironment(window);          // raw facts the browser reports (safe without window)
 *   const caps = detectCapabilities(env);         // pure: { touch, deviceClass, os, browser, ... }
 *
 * `detectCapabilities` is PURE — tests feed it fake navigators / UA strings. The rules:
 *   - touch      = maxTouchPoints > 0, or 'ontouchstart' exists, or the primary pointer is coarse
 *   - os         = 'ios' for iPhone / iPod / iPad, *including* iPadOS in desktop mode (Safari reports a Mac UA:
 *                  platform 'MacIntel' + maxTouchPoints > 1 — same rule as src/net/platform.js),
 *                  'android', 'windows', 'mac', 'chromeos', 'linux', else 'other'
 *   - deviceClass 'phone' | 'tablet' | 'desktop':
 *                  iPhone/iPod → phone · iPad (either UA) → tablet ·
 *                  Android: "Mobile" in the UA → phone, else tablet (Google's own convention) ·
 *                  any other touch-first device (coarse pointer, no hover): short side < 600 CSS px → phone,
 *                  else tablet · everything else → desktop (touch laptops keep 'desktop')
 *   - browser    'safari' (incl. every iOS browser: they are all WebKit), 'chrome', 'firefox', 'edge',
 *                  'samsung', else 'other'; `webkit` = the engine is WebKit
 *   - standalone = launched from the home screen (display-mode standalone/fullscreen, or iOS navigator.standalone)
 *   - memoryGB   = navigator.deviceMemory (Chrome only, capped at 8 by the browser) or null
 *   - cores      = navigator.hardwareConcurrency or null
 *   - saveData   = navigator.connection.saveData (Data Saver / Lite mode)
 *   - reducedMotion = prefers-reduced-motion: reduce
 */

/** Short side (CSS px) below which a touch-first device counts as a phone. */
export const PHONE_MAX_SHORT_SIDE = 600;

const safe = (fn, fallback) => {
  try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; }
};

/**
 * What this browser reports. Everything optional; missing window → a plain desktop-ish empty environment.
 * @param {any} [win]
 */
export function readEnvironment(win = typeof window !== 'undefined' ? window : null) {
  const nav = win?.navigator ?? null;
  const mq = (q) => safe(() => !!win.matchMedia(q).matches, false);
  return {
    userAgent: String(safe(() => nav.userAgent, '') ?? ''),
    platform: String(safe(() => nav.platform, '') ?? ''),
    maxTouchPoints: Number(safe(() => nav.maxTouchPoints, 0)) || 0,
    hasTouchEvents: !!win && safe(() => 'ontouchstart' in win, false),
    coarsePointer: !!win && mq('(pointer: coarse)'),
    anyHover: !!win && mq('(any-hover: hover)'),
    standaloneMedia: !!win && (mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)')),
    iosStandalone: safe(() => nav.standalone === true, false),
    reducedMotion: !!win && mq('(prefers-reduced-motion: reduce)'),
    deviceMemory: safe(() => nav.deviceMemory, null) ?? null,
    hardwareConcurrency: safe(() => nav.hardwareConcurrency, null) ?? null,
    saveData: safe(() => !!nav.connection?.saveData, false),
    effectiveType: String(safe(() => nav.connection?.effectiveType, '') ?? ''),
    devicePixelRatio: Number(safe(() => win.devicePixelRatio, 1)) || 1,
    screenWidth: Number(safe(() => win.screen.width, 0)) || 0,
    screenHeight: Number(safe(() => win.screen.height, 0)) || 0,
    innerWidth: Number(safe(() => win.innerWidth, 0)) || 0,
    innerHeight: Number(safe(() => win.innerHeight, 0)) || 0,
  };
}

/** @param {string} ua @param {string} platform @param {number} touchPoints */
export function detectOs(ua = '', platform = '', touchPoints = 0) {
  if (/iPhone|iPod|iPad/.test(ua)) return 'ios';
  if (platform === 'MacIntel' && touchPoints > 1) return 'ios'; // iPadOS desktop-mode Safari
  if (/Android/i.test(ua)) return 'android';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Linux|X11/.test(ua)) return 'linux';
  return 'other';
}

/** @param {string} ua @param {string} os */
export function detectBrowser(ua = '', os = 'other') {
  if (os === 'ios') return 'safari'; // Chrome/Firefox on iOS are WebKit underneath: same quirks
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Chromium\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

/**
 * @param {Partial<ReturnType<typeof readEnvironment>>} env
 */
export function detectCapabilities(env = {}) {
  const ua = String(env.userAgent ?? '');
  const platform = String(env.platform ?? '');
  const touchPoints = Number(env.maxTouchPoints) || 0;
  const os = detectOs(ua, platform, touchPoints);
  const browser = detectBrowser(ua, os);
  const touch = touchPoints > 0 || !!env.hasTouchEvents || !!env.coarsePointer;
  const ipad = /iPad/.test(ua) || (os === 'ios' && !/iPhone|iPod/.test(ua));

  const sw = Number(env.screenWidth) || Number(env.innerWidth) || 0;
  const sh = Number(env.screenHeight) || Number(env.innerHeight) || 0;
  const shortSide = sw && sh ? Math.min(sw, sh) : 0;

  let deviceClass = 'desktop';
  if (os === 'ios') deviceClass = ipad ? 'tablet' : 'phone';
  else if (os === 'android') deviceClass = /Mobile/.test(ua) ? 'phone' : 'tablet';
  else if (touch && env.coarsePointer && !env.anyHover) {
    deviceClass = shortSide && shortSide < PHONE_MAX_SHORT_SIDE ? 'phone' : 'tablet';
  }

  const mem = Number(env.deviceMemory);
  const cores = Number(env.hardwareConcurrency);
  return {
    touch,
    deviceClass,
    mobile: deviceClass !== 'desktop',
    phone: deviceClass === 'phone',
    tablet: deviceClass === 'tablet',
    os,
    isIOS: os === 'ios',
    isAndroid: os === 'android',
    browser,
    webkit: os === 'ios' || browser === 'safari',
    isSafari: browser === 'safari',
    standalone: !!env.standaloneMedia || !!env.iosStandalone,
    memoryGB: Number.isFinite(mem) && mem > 0 ? mem : null,
    cores: Number.isFinite(cores) && cores > 0 ? cores : null,
    saveData: !!env.saveData,
    slowNetwork: /(^|-)2g$/.test(String(env.effectiveType ?? '')),
    reducedMotion: !!env.reducedMotion,
    dpr: Math.max(0.5, Math.min(4, Number(env.devicePixelRatio) || 1)),
    shortSide,
  };
}
