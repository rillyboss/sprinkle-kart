// Mobile platform: service worker registration + update flow, install hints, toasts (src/platform/pwa.js)
// and the whole createPlatform() object (src/platform/index.js) with fake devices.
import { describe, it, expect, vi } from 'vitest';
import { createFakeWindow, createTarget } from './helpers/fakeWindow.js';
import {
  swSupport, registerServiceWorker, applyUpdate, installHintKind, createHintStore, createToast, workerBuild, updateAction,
  HINT_MIN_VISITS, HINT_SNOOZE_DAYS, HINT_KEY, UPDATE_TEXT, IOS_HINT_TEXT, UPDATE_CHECK_MS,
} from '../src/platform/pwa.js';
import { createPlatform } from '../src/platform/index.js';
import { createGraphicsPrefs } from '../src/platform/qualityPrefs.js';
import { PRESETS } from '../src/platform/quality.js';
import { UA } from './platform.capabilities.test.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeSw({ waiting = null, controller = {}, fail = false } = {}) {
  const reg = createTarget({ waiting, installing: null, update: vi.fn(() => Promise.resolve()) });
  const sw = createTarget({ controller, register: vi.fn(() => (fail ? Promise.reject(new Error('no')) : Promise.resolve(reg))) });
  return { sw, reg };
}

describe('swSupport', () => {
  const nav = { serviceWorker: { register() {} } };
  it('production + https (or localhost) + a service worker API', () => {
    expect(swSupport({ nav, loc: { protocol: 'https:', hostname: 'rillyboss.github.io' }, prod: true }).ok).toBe(true);
    expect(swSupport({ nav, loc: { protocol: 'http:', hostname: 'localhost' }, prod: true }).ok).toBe(true);
    expect(swSupport({ nav, loc: { protocol: 'http:', hostname: '192.168.1.5' }, prod: true })).toEqual({ ok: false, reason: 'not https' });
    expect(swSupport({ nav, loc: { protocol: 'https:' }, prod: false })).toEqual({ ok: false, reason: 'dev build' });
    expect(swSupport({ nav: {}, loc: { protocol: 'https:' }, prod: true })).toEqual({ ok: false, reason: 'no service worker' });
  });
});

describe('registerServiceWorker', () => {
  it('registers ./sw.js relative to the page (GitHub Pages sub-path) with scope ./', async () => {
    const { sw } = fakeSw();
    await registerServiceWorker({ nav: { serviceWorker: sw } });
    expect(sw.register).toHaveBeenCalledWith('./sw.js', { scope: './' });
  });
  it('a worker already waiting (and a controller) is an update', async () => {
    const { sw } = fakeSw({ waiting: { postMessage: vi.fn() } });
    const ready = vi.fn();
    await registerServiceWorker({ nav: { serviceWorker: sw }, onUpdateReady: ready });
    expect(ready).toHaveBeenCalledTimes(1);
  });
  it('the first install (no controller) is not an update', async () => {
    const { sw } = fakeSw({ waiting: { postMessage() {} }, controller: null });
    const ready = vi.fn();
    await registerServiceWorker({ nav: { serviceWorker: sw }, onUpdateReady: ready });
    expect(ready).not.toHaveBeenCalled();
  });
  it('an update found later reports once it is installed; focus and a timer check for updates', async () => {
    const { sw, reg } = fakeSw();
    const win = createFakeWindow();
    const ready = vi.fn();
    await registerServiceWorker({ nav: { serviceWorker: sw }, onUpdateReady: ready, win });
    const installing = createTarget({ state: 'installing' });
    reg.installing = installing;
    reg.fire('updatefound');
    installing.state = 'installed';
    reg.waiting = { postMessage() {} };
    installing.fire('statechange');
    installing.fire('statechange');
    expect(ready).toHaveBeenCalledTimes(1);
    win.document.fire('visibilitychange');
    expect(reg.update).toHaveBeenCalledTimes(1);
    expect(win.timers.find((t) => t.repeat)?.ms).toBe(UPDATE_CHECK_MS);
  });
  it('failures resolve null', async () => {
    expect(await registerServiceWorker({ nav: {} })).toBe(null);
    expect(await registerServiceWorker({ nav: { serviceWorker: fakeSw({ fail: true }).sw } })).toBe(null);
    const blocked = { serviceWorker: { register: () => Promise.resolve(undefined) } };
    expect(await registerServiceWorker({ nav: blocked })).toBe(null);
  });
});

describe('applyUpdate / workerBuild / updateAction', () => {
  it('asks the waiting worker to skip waiting and reloads once it controls the page', () => {
    const sw = createTarget();
    const waiting = { postMessage: vi.fn() };
    const reload = vi.fn();
    applyUpdate({ waiting }, { nav: { serviceWorker: sw }, reload });
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    sw.fire('controllerchange');
    sw.fire('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('nothing waiting → just reload', () => {
    const reload = vi.fn();
    applyUpdate(null, { reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('workerBuild asks over a MessageChannel, null on silence', async () => {
    const worker = { postMessage: (msg, [port]) => { expect(msg).toEqual({ type: 'GET_VERSION' }); port.postMessage({ build: 'abc123' }); } };
    expect(await workerBuild(worker)).toBe('abc123');
    expect(await workerBuild({ postMessage() {} }, { timeout: 10 })).toBe(null);
    expect(await workerBuild(null)).toBe(null);
    expect(await workerBuild(worker, { Channel: null })).toBe(null);
  });
  it('same build → silent take-over, anything else → the toast', () => {
    expect(updateAction({ pageBuild: 'abc', workerBuild: 'abc' })).toBe('silent');
    expect(updateAction({ pageBuild: 'abc', workerBuild: 'def' })).toBe('toast');
    expect(updateAction({ pageBuild: 'abc', workerBuild: null })).toBe('toast');
    expect(updateAction({ pageBuild: 'dev', workerBuild: 'dev' })).toBe('toast');
  });
});

describe('install hints', () => {
  const ios = { mobile: true, isIOS: true, isSafari: true };
  const android = { mobile: true, isAndroid: true };
  const now = 1_000_000_000_000;
  it('iOS Safari gets the Share tip; Android only with a real prompt; never desktops / installed apps / first visits', () => {
    expect(installHintKind({ caps: ios, visits: HINT_MIN_VISITS, now })).toBe('ios');
    expect(installHintKind({ caps: android, visits: 5, now })).toBe(null);
    expect(installHintKind({ caps: android, visits: 5, canPrompt: true, now })).toBe('android');
    expect(installHintKind({ caps: { mobile: false }, visits: 5, canPrompt: true, now })).toBe(null);
    expect(installHintKind({ caps: ios, visits: 5, standalone: true, now })).toBe(null);
    expect(installHintKind({ caps: { ...ios, standalone: true }, visits: 5, now })).toBe(null);
    expect(installHintKind({ caps: ios, visits: 1, now })).toBe(null);
    expect(installHintKind({ caps: { ...ios, isSafari: false }, visits: 5, now })).toBe(null);
  });
  it('a dismissed hint sleeps for a month', () => {
    const day = 86400000;
    expect(installHintKind({ caps: ios, visits: 9, dismissedAt: now - 3 * day, now })).toBe(null);
    expect(installHintKind({ caps: ios, visits: 9, dismissedAt: now - (HINT_SNOOZE_DAYS + 1) * day, now })).toBe('ios');
  });
  it('the hint store counts visits and remembers dismissals; broken storage is harmless', () => {
    const m = new Map();
    const store = createHintStore({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) });
    expect(store.visit()).toEqual({ visits: 1, dismissedAt: null });
    expect(store.visit().visits).toBe(2);
    store.dismiss(123);
    expect(JSON.parse(m.get(HINT_KEY))).toEqual({ visits: 2, dismissedAt: 123 });
    const broken = createHintStore({ getItem: () => '{', setItem: () => { throw new Error('x'); } });
    expect(broken.visit()).toEqual({ visits: 1, dismissedAt: null });
    expect(createHintStore(null).read()).toEqual({ visits: 0, dismissedAt: null });
  });
  it('the texts are friendly', () => {
    expect(`${UPDATE_TEXT} ${IOS_HINT_TEXT}`).not.toMatch(/\b(error|failed|must|warning)\b/i);
  });
});

describe('createToast', () => {
  it('tap and close', () => {
    const win = createFakeWindow();
    const onTap = vi.fn();
    const onClose = vi.fn();
    const t = createToast({ doc: win.document, text: UPDATE_TEXT, action: 'Go', onTap, onClose, cls: 'x' });
    expect(t.node.className).toBe('sk-pwa-toast x');
    expect(win.document.body.children).toContain(t.node);
    const [main, close] = t.node.children;
    main.fire('click');
    expect(onTap).toHaveBeenCalledTimes(1);
    close.fire('click');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(win.document.body.children).not.toContain(t.node);
    t.close();
    expect(createToast({ doc: null, text: 'x' }).node).toBe(null);
  });
});

describe('createPlatform', () => {
  const mem = () => { const m = new Map(); return createGraphicsPrefs({ storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }); };
  const phoneEnv = { userAgent: UA.iphone, maxTouchPoints: 5, coarsePointer: true, devicePixelRatio: 3, screenWidth: 390, screenHeight: 844 };

  it('a desktop gets exactly the old game: high, antialias, no cap, no dynamic resolution', () => {
    const p = createPlatform({ win: null, prefs: mem(), env: { userAgent: UA.windows }, gpu: { renderer: 'ANGLE (NVIDIA GeForce RTX 3070)' } });
    expect(p.quality.id).toBe('high');
    expect(p.quality.antialias).toBe(true);
    expect(p.frameCap).toBe(0);
    expect(p.dynamic.enabled).toBe(false);
    expect(p.pixelRatio(1, 2)).toBe(1.5);
    expect(p.pixelRatio(4, 2)).toBe(1);
    for (let t = 0; t < 2000; t += 50) expect(p.frameGate(t)).toBe(true);
    expect(p.renderScale).toBe(1);
  });
  it('a phone with a software GPU gets low: 30 fps cap offline, never online', () => {
    const p = createPlatform({ win: null, prefs: mem(), env: phoneEnv, gpu: { renderer: 'SwiftShader', software: true } });
    expect(p.caps.deviceClass).toBe('phone');
    expect(p.quality.id).toBe('low');
    expect(p.gpu.tierHint).toBe('low');
    let offline = 0;
    let online = 0;
    for (let t = 0; t < 1000; t += 1000 / 60) { if (p.frameGate(t)) offline++; }
    for (let t = 1000; t < 2000; t += 1000 / 60) { if (p.frameGate(t, { online: true })) online++; }
    expect(offline).toBeGreaterThanOrEqual(29);
    expect(offline).toBeLessThanOrEqual(31);
    expect(online).toBeGreaterThanOrEqual(59);
  });
  it('slow frames lower the resolution and call onResize + change listeners; a new race resets it', () => {
    const p = createPlatform({ win: null, prefs: mem(), env: phoneEnv, gpu: { renderer: 'Adreno (TM) 618' } });
    expect(p.quality.id).toBe('medium');
    const onResize = vi.fn();
    p.attach({ onResize });
    const changes = [];
    const off = p.on('change', (e) => changes.push(e.reason));
    let t = 0;
    for (let i = 0; i < 120; i++) { t += 40; p.frameGate(t); }
    expect(p.renderScale).toBeLessThan(1);
    expect(onResize).toHaveBeenCalled();
    expect(changes).toContain('resolution');
    expect(p.pixelRatio(1, 3)).toBeLessThan(1.25);
    p.resetResolution();
    expect(p.renderScale).toBe(1);
    off();
  });
  it('setChoice saves, re-resolves and notifies; junk is ignored', () => {
    const prefs = mem();
    const p = createPlatform({ win: null, prefs, env: phoneEnv, gpu: { renderer: 'Adreno (TM) 618' } });
    const seen = vi.fn();
    p.on('change', seen);
    expect(p.setChoice('high').id).toBe('high');
    expect(prefs.get().quality).toBe('high');
    expect(p.choice).toBe('high');
    expect(p.frameCap).toBe(0);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ reason: 'choice' }));
    expect(p.setChoice('ultra').id).toBe('high');
    expect(createPlatform({ win: null, prefs, env: phoneEnv, gpu: {} }).quality.id).toBe('high'); // saved
  });
  it('?quality= overrides the saved choice for this page load only', () => {
    const prefs = mem();
    prefs.set({ quality: 'high' });
    const win = createFakeWindow({ location: { protocol: 'https:', hostname: 'x', search: '?quality=low' } });
    const p = createPlatform({ win, prefs, env: { userAgent: UA.windows }, gpu: {} });
    expect(p.quality.id).toBe('low');
    expect(prefs.get().quality).toBe('high');
  });
  it('antialiasMatches compares with the live context; info() is a plain snapshot', () => {
    const p = createPlatform({ win: null, prefs: mem(), env: phoneEnv, gpu: { renderer: 'Adreno (TM) 618', benchMs: 20 } });
    expect(p.antialiasMatches()).toBe(true);
    const renderer = { getContext: () => ({ getContextAttributes: () => ({ antialias: true }) }), getPixelRatio: () => 1.25, info: { render: { calls: 42, triangles: 9 }, memory: { geometries: 3, textures: 2 } } };
    p.attach({ renderer });
    expect(p.antialiasMatches()).toBe(false); // medium = no AA, context has it → "after a reload"
    expect(p.info()).toMatchObject({ deviceClass: 'phone', os: 'ios', quality: 'medium', calls: 42, pixelRatio: 1.25, benchMs: 20, benchHint: 'medium' });
  });

  describe('attach() in a (fake) phone browser', () => {
    const phoneWin = (w = 390, h = 844) => createFakeWindow({ innerWidth: w, innerHeight: h, navigator: { userAgent: UA.iphone, maxTouchPoints: 5 }, media: { '(pointer: coarse)': true } });

    it('sets the viewport vars, guards gestures, shows the rotate overlay in portrait and follows rotation', () => {
      const win = phoneWin();
      const p = createPlatform({ win, prefs: mem(), gpu: { renderer: 'Apple GPU' } });
      const off = p.attach({ canvas: createTarget() });
      expect(win.document.documentElement.dataset).toMatchObject({ skDevice: 'phone', skTouch: '1', skOrientation: 'portrait' });
      expect(p.rotate.visible).toBe(true);
      expect(win.document.count('touchmove')).toBe(1);
      win.innerWidth = 844; win.innerHeight = 390;
      win.fire('resize');
      expect(p.rotate.visible).toBe(false);
      win.innerWidth = 390; win.innerHeight = 844;
      win.fire('resize');
      expect(p.rotate.visible).toBe(true);
      p.rotate.node.querySelector('.sk-rotate-skip').fire('click');
      expect(p.rotate.visible).toBe(false);
      off();
      expect(win.document.count('touchmove')).toBe(0);
    });
    it('hidden / visible / context loss reach listeners; pagehide suspends running audio', () => {
      const win = phoneWin(844, 390);
      const p = createPlatform({ win, prefs: mem(), gpu: {} });
      const canvas = createTarget();
      const audio = { ctx: { state: 'running', suspend: vi.fn(() => Promise.resolve()), resume: vi.fn(() => Promise.resolve()) }, unlock: vi.fn() };
      const onResize = vi.fn();
      p.attach({ canvas, audio, onResize });
      const events = [];
      for (const ev of ['hidden', 'visible', 'contextlost', 'contextrestored']) p.on(ev, () => events.push(ev));
      win.fire('pagehide');
      expect(audio.ctx.suspend).toHaveBeenCalled();
      win.fire('pageshow', { persisted: true });
      canvas.fire('webglcontextlost');
      canvas.fire('webglcontextrestored');
      expect(events).toEqual(['hidden', 'visible', 'contextlost', 'contextrestored']);
      expect(onResize).toHaveBeenCalled();
    });
    it('the first tap asks for full screen + landscape (once)', async () => {
      const win = phoneWin(844, 390);
      win.document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
      win.screen.orientation = { type: 'portrait-primary', lock: vi.fn(() => Promise.resolve()) };
      const p = createPlatform({ win, prefs: mem(), gpu: {} });
      p.attach({});
      win.document.fire('touchend');
      win.document.fire('touchend');
      await flush();
      expect(win.document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
      expect(win.screen.orientation.lock).toHaveBeenCalledWith('landscape');
    });
    it('desktop: no rotate overlay, no gesture guards, no fullscreen request', () => {
      const win = createFakeWindow({ navigator: { userAgent: UA.windows } });
      const p = createPlatform({ win, prefs: mem(), gpu: {} });
      p.attach({});
      expect(p.rotate).toBe(null);
      expect(win.document.count('touchmove')).toBe(0);
      expect(win.document.count('touchend')).toBe(0);
    });
    it('production: registers the worker; a new build shows "tap to update" and applyUpdate reloads', async () => {
      const win = phoneWin(844, 390);
      const waiting = { postMessage: vi.fn((msg, ports) => { if (msg.type === 'GET_VERSION') ports[0].postMessage({ build: 'someone-elses-build' }); }) };
      const { sw } = fakeSw({ waiting });
      win.navigator.serviceWorker = sw;
      win.location = { protocol: 'https:', hostname: 'rillyboss.github.io', search: '', reload: vi.fn() };
      const p = createPlatform({ win, prefs: mem(), gpu: {}, prod: true });
      const ready = vi.fn();
      p.on('update-ready', ready);
      p.attach({});
      await flush(); await flush(); await flush();
      await new Promise((r) => setTimeout(r, 20));
      expect(sw.register).toHaveBeenCalled();
      expect(ready).toHaveBeenCalled();
      expect(p.pwa.updateReady).toBe(true);
      const toast = win.document.body.children.find((c) => c.classList.contains('sk-pwa-update'));
      expect(toast).toBeTruthy();
      toast.children[0].fire('click');
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      sw.fire('controllerchange');
      expect(win.location.reload).toHaveBeenCalled();
    });
    it('Android: beforeinstallprompt is kept for promptInstall(); the hint shows only when asked', async () => {
      const win = createFakeWindow({ navigator: { userAgent: UA.pixel, maxTouchPoints: 5 } });
      const storage = new Map([[HINT_KEY, JSON.stringify({ visits: 3, dismissedAt: null })]]);
      vi.stubGlobal('localStorage', { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
      try {
        const p = createPlatform({ win, prefs: mem(), gpu: {} });
        p.attach({});
        const prompt = { preventDefault: vi.fn(), prompt: vi.fn(() => Promise.resolve()), userChoice: Promise.resolve({ outcome: 'accepted' }) };
        win.fire('beforeinstallprompt', prompt);
        expect(p.pwa.canInstall).toBe(true);
        expect(win.document.body.children.some((c) => c.classList.contains('sk-pwa-hint'))).toBe(false);
        p.pwa.showHint();
        const hint = win.document.body.children.find((c) => c.classList.contains('sk-pwa-hint-android'));
        expect(hint).toBeTruthy();
        expect(await p.pwa.promptInstall()).toBe(true);
        expect(await p.pwa.promptInstall()).toBe(false);
        p.pwa.hideHint();
      } finally { vi.unstubAllGlobals(); }
    });
  });
});

it('presets referenced by the platform are the frozen table', () => {
  expect(Object.isFrozen(PRESETS.low)).toBe(true);
});
