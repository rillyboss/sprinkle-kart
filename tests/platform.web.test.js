// Mobile platform: iOS / Android web fixes (viewport vars, gesture guards, audio resume, lifecycle, context
// loss, landscape request) and the rotate overlay — against a fake window (tests/helpers/fakeWindow.js).
import { describe, it, expect, vi } from 'vitest';
import { createFakeWindow, createFakeElement } from './helpers/fakeWindow.js';
import {
  applyViewportVars, installViewportWatch, installGestureGuards, installAudioResume, installLifecycle,
  installContextLossGuard, requestLandscape, allowsNativeTouch, inScrollable, orientationOf,
} from '../src/platform/web.js';
import { rotateOverlayState, createRotateOverlay, ROTATE_TEXT } from '../src/platform/rotateOverlay.js';

describe('viewport variables', () => {
  it('writes --sk-app-* and the data attributes', () => {
    const win = createFakeWindow({ innerWidth: 844, innerHeight: 390 });
    const r = applyViewportVars(win, { deviceClass: 'phone', touch: true, standalone: false, os: 'ios' });
    const root = win.document.documentElement;
    expect(root.style.props).toMatchObject({ '--sk-app-width': '844px', '--sk-app-height': '390px' });
    expect(root.dataset).toMatchObject({ skDevice: 'phone', skTouch: '1', skOrientation: 'landscape', skStandalone: '0', skOs: 'ios' });
    expect(r.height).toBe(390);
    expect(applyViewportVars({}, {})).toBe(null);
  });
  it('prefers the visual viewport (iOS toolbar) and follows rotation', () => {
    const win = createFakeWindow({ innerWidth: 390, innerHeight: 844, visualViewport: { width: 390, height: 760, ...createFakeElement() } });
    const seen = [];
    const off = installViewportWatch(win, { deviceClass: 'phone' }, (r) => seen.push(r.skOrientation));
    expect(win.document.documentElement.style.props['--sk-app-height']).toBe('760px');
    win.innerWidth = 844; win.innerHeight = 390; win.visualViewport.width = 844; win.visualViewport.height = 390;
    win.fire('resize');
    expect(seen.at(-1)).toBe('landscape');
    expect(win.count('resize')).toBe(1);
    off();
    expect(win.count('resize')).toBe(0);
    expect(win.count('orientationchange')).toBe(0);
    expect(installViewportWatch(null)).toBeTypeOf('function');
    expect(orientationOf(10, 10)).toBe('landscape');
  });
});

describe('gesture guards', () => {
  const setup = () => { const win = createFakeWindow(); return { win, doc: win.document, off: installGestureGuards(win) }; };
  it('blocks pinch, pull-to-refresh, double-tap zoom, long-press menus and selection', () => {
    const { doc, off } = setup();
    const target = createFakeElement('canvas');
    expect(doc.fire('gesturestart', { target }).defaultPrevented).toBe(true);
    expect(doc.fire('touchmove', { target, touches: [{}] }).defaultPrevented).toBe(true);
    expect(doc.fire('touchmove', { target, touches: [{}, {}] }).defaultPrevented).toBe(true);
    expect(doc.fire('dblclick', { target }).defaultPrevented).toBe(true);
    expect(doc.fire('contextmenu', { target }).defaultPrevented).toBe(true);
    expect(doc.fire('selectstart', { target }).defaultPrevented).toBe(true);
    off();
    expect(doc.fire('touchmove', { target, touches: [{}] }).defaultPrevented).toBe(false);
  });
  it('leaves text fields and scroll lists alone (but never a pinch)', () => {
    const { win, doc } = setup();
    const input = createFakeElement('input');
    expect(doc.fire('touchmove', { target: input, touches: [{}] }).defaultPrevented).toBe(false);
    expect(doc.fire('contextmenu', { target: input }).defaultPrevented).toBe(false);
    const list = createFakeElement('div');
    list.dataset.skScroll = '';
    const item = list.appendChild(createFakeElement('div'));
    expect(doc.fire('touchmove', { target: item, touches: [{}] }).defaultPrevented).toBe(false);
    expect(doc.fire('touchmove', { target: item, touches: [{}, {}] }).defaultPrevented).toBe(true);
    const scroller = createFakeElement('div');
    scroller.computed = { overflowY: 'auto', overflowX: 'visible' };
    scroller.scrollHeight = 500; scroller.clientHeight = 200;
    const row = scroller.appendChild(createFakeElement('div'));
    expect(inScrollable(row, win)).toBe(true);
    expect(doc.fire('touchmove', { target: row, touches: [{}] }).defaultPrevented).toBe(false);
    scroller.scrollHeight = 200;
    expect(inScrollable(row, win)).toBe(false);
  });
  it('allowsNativeTouch knows inputs, textareas, selects, contenteditable and .sk-scroll', () => {
    for (const tag of ['input', 'textarea', 'select']) expect(allowsNativeTouch(createFakeElement(tag))).toBe(true);
    const ce = createFakeElement('div'); ce.isContentEditable = true;
    expect(allowsNativeTouch(ce)).toBe(true);
    const sc = createFakeElement('div'); sc.classList.add('sk-scroll');
    expect(allowsNativeTouch(sc.appendChild(createFakeElement('span')))).toBe(true);
    expect(allowsNativeTouch(createFakeElement('div'))).toBe(false);
    expect(allowsNativeTouch(null)).toBe(false);
    expect(installGestureGuards({})).toBeTypeOf('function');
  });
});

describe('audio resume', () => {
  it('unlocks and resumes a suspended / interrupted context on a gesture while visible', () => {
    const win = createFakeWindow();
    const ctx = { state: 'interrupted', resume: vi.fn(() => Promise.resolve()) };
    const audio = { unlock: vi.fn(), ctx };
    const off = installAudioResume(win, audio);
    win.document.fire('touchend');
    expect(audio.unlock).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    ctx.state = 'running';
    win.document.fire('pointerup');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    ctx.state = 'suspended';
    win.document.visibilityState = 'hidden';
    win.document.fire('click');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    win.document.visibilityState = 'visible';
    ctx.state = 'closed';
    win.document.fire('keydown');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    off();
    expect(win.document.count('touchend')).toBe(0);
    expect(installAudioResume(win, null)).toBeTypeOf('function');
  });
});

describe('lifecycle', () => {
  it('reports hidden once (visibilitychange or pagehide) and visible again', () => {
    const win = createFakeWindow();
    const calls = [];
    const off = installLifecycle(win, { onHidden: (r) => calls.push(`hidden:${r}`), onVisible: (r) => calls.push(`visible:${r}`) });
    win.document.visibilityState = 'hidden';
    win.document.fire('visibilitychange');
    win.fire('pagehide');
    win.document.visibilityState = 'visible';
    win.document.fire('visibilitychange');
    win.fire('pagehide');
    win.fire('pageshow', { persisted: true });
    expect(calls).toEqual(['hidden:hidden', 'visible:visible', 'hidden:pagehide', 'visible:pageshow']);
    off();
    expect(win.count('pagehide')).toBe(0);
    expect(installLifecycle({})).toBeTypeOf('function');
  });
});

describe('WebGL context loss', () => {
  it('prevents the default (so the browser restores it) and reports both events', () => {
    const canvas = createFakeElement('canvas');
    const lost = vi.fn();
    const restored = vi.fn();
    const off = installContextLossGuard(canvas, { onLost: lost, onRestored: restored });
    expect(canvas.fire('webglcontextlost').defaultPrevented).toBe(true);
    canvas.fire('webglcontextrestored');
    expect([lost.mock.calls.length, restored.mock.calls.length]).toEqual([1, 1]);
    off();
    expect(canvas.count('webglcontextlost')).toBe(0);
    expect(installContextLossGuard(null)).toBeTypeOf('function');
  });
});

describe('requestLandscape', () => {
  it('asks for full screen then locks landscape', async () => {
    const win = createFakeWindow();
    win.document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
    win.screen.orientation = { lock: vi.fn(() => Promise.resolve()) };
    expect(await requestLandscape(win)).toEqual({ fullscreen: true, locked: true });
    expect(win.screen.orientation.lock).toHaveBeenCalledWith('landscape');
  });
  it('never throws when the browser says no (iPhone Safari)', async () => {
    const win = createFakeWindow();
    win.document.documentElement.webkitRequestFullscreen = vi.fn(() => Promise.reject(new Error('no')));
    win.screen.orientation = { lock: () => Promise.reject(new Error('NotSupportedError')) };
    expect(await requestLandscape(win)).toEqual({ fullscreen: false, locked: false });
    const already = createFakeWindow();
    already.document.fullscreenElement = {};
    expect(await requestLandscape(already)).toEqual({ fullscreen: true, locked: false });
    expect(await requestLandscape({})).toEqual({ fullscreen: false, locked: false });
  });
});

describe('rotate overlay', () => {
  it.each([
    [{ phone: true, width: 390, height: 844 }, true, 'portrait'],
    [{ phone: true, width: 844, height: 390 }, false, 'landscape'],
    [{ phone: false, width: 390, height: 844 }, false, 'not-phone'],
    [{ phone: true, width: 390, height: 844, dismissed: true }, false, 'dismissed'],
    [{ phone: true, width: 390, height: 844, locked: true }, false, 'locked'],
  ])('%o → visible %s', (input, visible, reason) => {
    expect(rotateOverlayState(input)).toEqual({ visible, reason });
  });
  it('the element: hidden by default, set() toggles, "Play anyway" dismisses, destroy removes', () => {
    const win = createFakeWindow();
    const onDismiss = vi.fn();
    const ov = createRotateOverlay({ doc: win.document, onDismiss });
    expect(ov.node.className).toBe('sk-rotate');
    expect(ov.node.hidden).toBe(true);
    ov.set(true);
    expect(ov.node.hidden).toBe(false);
    expect(ov.node.classList.contains('sk-rotate-on')).toBe(true);
    const skip = ov.node.querySelector('.sk-rotate-skip');
    expect(skip.textContent).toBe(ROTATE_TEXT.skip);
    expect(ov.node.querySelector('.sk-rotate-title').textContent).toBe(ROTATE_TEXT.title);
    skip.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    ov.destroy();
    expect(win.document.body.children).not.toContain(ov.node);
    const none = createRotateOverlay({ doc: null });
    expect(() => { none.set(true); none.destroy(); }).not.toThrow();
  });
  it('the text is friendly', () => {
    expect(Object.values(ROTATE_TEXT).join(' ')).not.toMatch(/\b(error|wrong|must|invalid)\b/i);
  });
});
