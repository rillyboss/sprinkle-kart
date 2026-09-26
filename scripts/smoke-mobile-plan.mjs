/**
 * Plan for the phone / tablet e2e (scripts/smoke-mobile.mjs). Pure, unit tested (tests/platform.e2eplan.test.js).
 * OWNER: mobile platform.
 */

/** Emulated devices (Playwright descriptor names) and what the game must do on each. */
export const MOBILE_DEVICES = Object.freeze([
  { id: 'iphone13', descriptor: 'iPhone 13', deviceClass: 'phone', os: 'ios' },
  { id: 'ipad-pro-11', descriptor: 'iPad Pro 11', deviceClass: 'tablet', os: 'ios' },
  { id: 'pixel7', descriptor: 'Pixel 7', deviceClass: 'phone', os: 'android' },
]);

export const ORIENTATIONS = Object.freeze(['landscape', 'portrait']);

/** Playwright descriptor name for an orientation (the built-in list has "<name> landscape" variants). */
export function descriptorName(device, orientation) {
  return orientation === 'landscape' ? `${device.descriptor} landscape` : device.descriptor;
}

/** Should the rotate overlay be up? Phones held upright only. */
export function expectRotateOverlay(device, orientation) {
  return device.deviceClass === 'phone' && orientation === 'portrait';
}

/**
 * Scenario list.
 * @param {{ engines?: string[], only?: string[] }} [o] engines: 'chromium' | 'webkit'; only = substring filters
 */
export function planMobileScenarios({ engines = ['chromium'], only = [] } = {}) {
  const out = [];
  for (const engine of engines) {
    for (const device of MOBILE_DEVICES) {
      for (const orientation of ORIENTATIONS) {
        out.push({ name: `${engine}-${device.id}-${orientation}-boot`, kind: 'boot', engine, device, orientation });
      }
      out.push({ name: `${engine}-${device.id}-race`, kind: 'race', engine, device, orientation: 'landscape' });
    }
    // service workers: Chromium only (Playwright's WebKit has no SW offline support on Windows)
    if (engine === 'chromium') out.push({ name: `${engine}-pixel7-offline`, kind: 'offline', engine, device: MOBILE_DEVICES[2], orientation: 'landscape' });
  }
  return only.length ? out.filter((s) => only.some((f) => s.name.includes(f))) : out;
}

/** Tiers a phone / tablet may get on 'auto' (never the desktop-only 'high' on emulated software GPUs). */
export function acceptableAutoTier(info) {
  if (!info) return false;
  if (info.software) return info.quality === 'low';
  return info.quality === 'low' || info.quality === 'medium' || (info.deviceClass === 'tablet' && info.quality === 'high');
}
