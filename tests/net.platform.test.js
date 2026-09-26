// canHost / isAppleMobile (NETWORKING.md §13.5, acceptance M1 #6): iPads and iPhones may join, never host.
import { describe, it, expect } from 'vitest';
import { canHost, isAppleMobile, currentPlatform, HOST_NEEDS_COMPUTER_TEXT } from '../src/net/platform.js';
import { TEXT } from '../src/net/session/texts.js';

const UA = {
  ipadDesktop17: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  ipadDesktop18: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  ipadMobile: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipod: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 16093.68.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

describe('canHost fixtures', () => {
  it('iPadOS 17/18 desktop-mode UA + maxTouchPoints 5 cannot host (the UA alone looks like a Mac)', () => {
    for (const ua of [UA.ipadDesktop17, UA.ipadDesktop18]) {
      expect(canHost({ userAgent: ua, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(false);
      expect(isAppleMobile({ userAgent: ua, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    }
  });

  it('iPad mobile UA, iPhone and iPod cannot host', () => {
    expect(canHost({ userAgent: UA.ipadMobile, platform: 'iPad', maxTouchPoints: 5 })).toBe(false);
    expect(canHost({ userAgent: UA.iphone, platform: 'iPhone', maxTouchPoints: 5 })).toBe(false);
    expect(canHost({ userAgent: UA.ipod, platform: 'iPod', maxTouchPoints: 5 })).toBe(false);
    // even if a browser hides the platform, the UA still gives it away
    expect(canHost({ userAgent: UA.iphone, platform: '', maxTouchPoints: 0 })).toBe(false);
  });

  it('a real Mac (0 touch points) can host', () => {
    expect(canHost({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(true);
    expect(canHost({ userAgent: UA.ipadDesktop18, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(true); // Safari on a Mac
    expect(canHost({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 1 })).toBe(true);
  });

  it('Windows, ChromeOS and Android can host', () => {
    expect(canHost({ userAgent: UA.windows, platform: 'Win32', maxTouchPoints: 10 })).toBe(true);
    expect(canHost({ userAgent: UA.chromeos, platform: 'Linux x86_64', maxTouchPoints: 10 })).toBe(true);
    expect(canHost({ userAgent: UA.android, platform: 'Linux armv81', maxTouchPoints: 5 })).toBe(true);
  });

  it('is safe with missing / odd values', () => {
    expect(canHost()).toBe(true);
    expect(canHost({ userAgent: null, platform: undefined, maxTouchPoints: 'x' })).toBe(true);
    expect(canHost({ platform: 'MacIntel', maxTouchPoints: '5' })).toBe(false);
  });

  it('currentPlatform reads a navigator-like object and works without one', () => {
    expect(currentPlatform(null)).toEqual({ userAgent: '', platform: '', maxTouchPoints: 0 });
    expect(currentPlatform({ userAgent: UA.iphone, platform: 'iPhone', maxTouchPoints: 5 })).toEqual({ userAgent: UA.iphone, platform: 'iPhone', maxTouchPoints: 5 });
  });

  it('uses the friendly "Hosting needs a computer" sentence from the text catalogue', () => {
    expect(HOST_NEEDS_COMPUTER_TEXT).toBe(TEXT.hostNeedsComputer);
    expect(HOST_NEEDS_COMPUTER_TEXT).toBe('Hosting needs a computer 💻 — you can still join!');
  });
});
