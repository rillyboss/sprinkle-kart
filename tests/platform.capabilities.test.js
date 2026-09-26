// Mobile platform: device capability detection from fake navigators / UA strings (src/platform/capabilities.js).
import { describe, it, expect } from 'vitest';
import { detectCapabilities, detectOs, detectBrowser, readEnvironment, PHONE_MAX_SHORT_SIDE } from '../src/platform/capabilities.js';

export const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1',
  ipadLegacy: 'Mozilla/5.0 (iPad; CPU OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  pixel: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  galaxyTab: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

describe('detectOs / detectBrowser', () => {
  it('knows iOS including iPadOS desktop mode (MacIntel + touch points)', () => {
    expect(detectOs(UA.iphone)).toBe('ios');
    expect(detectOs(UA.ipadLegacy)).toBe('ios');
    expect(detectOs(UA.ipadDesktop, 'MacIntel', 5)).toBe('ios');
    expect(detectOs(UA.mac, 'MacIntel', 0)).toBe('mac');
  });
  it('knows the others', () => {
    expect(detectOs(UA.pixel)).toBe('android');
    expect(detectOs(UA.windows)).toBe('windows');
    expect(detectOs(UA.chromebook)).toBe('chromeos');
    expect(detectOs(UA.firefox)).toBe('linux');
    expect(detectOs('')).toBe('other');
  });
  it('every iOS browser is Safari (WebKit)', () => {
    expect(detectBrowser(UA.iphoneChrome, 'ios')).toBe('safari');
    expect(detectBrowser(UA.samsung, 'android')).toBe('samsung');
    expect(detectBrowser(UA.edge, 'windows')).toBe('edge');
    expect(detectBrowser(UA.firefox, 'linux')).toBe('firefox');
    expect(detectBrowser(UA.pixel, 'android')).toBe('chrome');
    expect(detectBrowser(UA.mac, 'mac')).toBe('safari');
    expect(detectBrowser('curl/8', 'other')).toBe('other');
  });
});

describe('detectCapabilities', () => {
  it('iPhone → phone, touch, iOS Safari quirks', () => {
    const c = detectCapabilities({ userAgent: UA.iphone, platform: 'iPhone', maxTouchPoints: 5, coarsePointer: true, screenWidth: 390, screenHeight: 844, devicePixelRatio: 3 });
    expect(c).toMatchObject({ deviceClass: 'phone', phone: true, mobile: true, touch: true, os: 'ios', isIOS: true, browser: 'safari', webkit: true, dpr: 3 });
  });
  it('iPad in desktop mode → tablet (not a Mac)', () => {
    const c = detectCapabilities({ userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5, screenWidth: 834, screenHeight: 1194 });
    expect(c.deviceClass).toBe('tablet');
    expect(c.isIOS).toBe(true);
  });
  it('legacy iPad UA → tablet', () => {
    expect(detectCapabilities({ userAgent: UA.ipadLegacy, maxTouchPoints: 5 }).deviceClass).toBe('tablet');
  });
  it('Android: "Mobile" in the UA → phone, otherwise tablet', () => {
    expect(detectCapabilities({ userAgent: UA.pixel, maxTouchPoints: 5 }).deviceClass).toBe('phone');
    expect(detectCapabilities({ userAgent: UA.galaxyTab, maxTouchPoints: 10 }).deviceClass).toBe('tablet');
    expect(detectCapabilities({ userAgent: UA.samsung, maxTouchPoints: 5 }).browser).toBe('samsung');
  });
  it('desktops stay desktops, even touch laptops with a hover pointer', () => {
    expect(detectCapabilities({ userAgent: UA.windows }).deviceClass).toBe('desktop');
    expect(detectCapabilities({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 0 }).deviceClass).toBe('desktop');
    const touchLaptop = detectCapabilities({ userAgent: UA.windows, maxTouchPoints: 10, anyHover: true, coarsePointer: false });
    expect(touchLaptop).toMatchObject({ deviceClass: 'desktop', touch: true, mobile: false });
  });
  it('an unknown touch-first device is classed by its short side', () => {
    const small = detectCapabilities({ userAgent: UA.chromebook, maxTouchPoints: 5, coarsePointer: true, anyHover: false, screenWidth: 400, screenHeight: 800 });
    const big = detectCapabilities({ userAgent: UA.chromebook, maxTouchPoints: 5, coarsePointer: true, anyHover: false, screenWidth: PHONE_MAX_SHORT_SIDE, screenHeight: 1000 });
    expect(small.deviceClass).toBe('phone');
    expect(big.deviceClass).toBe('tablet');
  });
  it('memory, cores, save-data, reduced motion, standalone', () => {
    const c = detectCapabilities({ userAgent: UA.pixel, deviceMemory: 4, hardwareConcurrency: 8, saveData: true, reducedMotion: true, standaloneMedia: true, effectiveType: 'slow-2g' });
    expect(c).toMatchObject({ memoryGB: 4, cores: 8, saveData: true, reducedMotion: true, standalone: true, slowNetwork: true });
    const ios = detectCapabilities({ userAgent: UA.iphone, iosStandalone: true });
    expect(ios.standalone).toBe(true);
    const none = detectCapabilities({ userAgent: UA.iphone, deviceMemory: 'junk', hardwareConcurrency: -1 });
    expect(none.memoryGB).toBe(null);
    expect(none.cores).toBe(null);
  });
  it('empty input is a safe desktop', () => {
    const c = detectCapabilities();
    expect(c).toMatchObject({ deviceClass: 'desktop', touch: false, os: 'other', dpr: 1 });
    expect(detectCapabilities({ devicePixelRatio: 9 }).dpr).toBe(4);
  });
});

describe('readEnvironment', () => {
  it('is safe without a window', () => {
    const env = readEnvironment(null);
    expect(env.userAgent).toBe('');
    expect(env.maxTouchPoints).toBe(0);
    expect(env.coarsePointer).toBe(false);
  });
  it('reads a (fake) browser window, surviving throwing getters', () => {
    const win = {
      navigator: {
        userAgent: UA.pixel, platform: 'Linux armv8l', maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8,
        connection: { saveData: true, effectiveType: '4g' },
        get standalone() { throw new Error('nope'); },
      },
      ontouchstart: null,
      matchMedia: (q) => ({ matches: q === '(pointer: coarse)' || q === '(display-mode: standalone)' }),
      devicePixelRatio: 2.625,
      screen: { width: 412, height: 915 },
      innerWidth: 915,
      innerHeight: 412,
    };
    const env = readEnvironment(win);
    expect(env).toMatchObject({ userAgent: UA.pixel, maxTouchPoints: 5, hasTouchEvents: true, coarsePointer: true, anyHover: false, standaloneMedia: true, iosStandalone: false, deviceMemory: 8, saveData: true, devicePixelRatio: 2.625, screenWidth: 412 });
    expect(detectCapabilities(env)).toMatchObject({ deviceClass: 'phone', standalone: true });
  });
});
