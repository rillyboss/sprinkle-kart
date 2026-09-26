// Showcase presentation: saved Effects & comfort prefs, the Effects screen reducer,
// the body-class system and the screen registration.
import { describe, it, expect, vi } from 'vitest';
import {
  PREFS_KEY, PREF_ROWS, DEFAULT_PREFS, normalizePrefs, effectivePrefs, createPrefsStore, deviceReducedMotion,
} from '../src/presentation/prefs.js';
import { EFFECTS_ROWS, createEffectsState, effectsReduce, togglePatch } from '../src/presentation/effectsMenu.js';
import presentationPrefs, { bodyClassesFor, applyBodyClasses, playerShapeWidget } from '../src/systems/presentationPrefs.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { menuEntries } from '../src/ui/screenFlow.js';
import { EFFECT_ROW_LABELS } from '../src/ui/screens/effects.js';
import { listSystems, installSystems } from '../src/systems/index.js';
import { createFakeApp } from './helpers/headlessSession.js';

/** In-memory Storage stand-in. */
function memStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function classList() {
  const set = new Set();
  return { set, toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
}

describe('normalizePrefs', () => {
  it('fills defaults for junk, arrays, null and partial objects', () => {
    for (const junk of [null, undefined, 42, 'x', [], [1, 2]]) expect(normalizePrefs(junk)).toEqual({ ...DEFAULT_PREFS });
    expect(normalizePrefs({ bubbles: false })).toEqual({ ...DEFAULT_PREFS, bubbles: false });
  });
  it('ignores wrong types and unknown motion modes', () => {
    const p = normalizePrefs({ motion: 'zoomy', shake: 'yes', weather: 0, attract: false, extra: 1 });
    expect(p).toEqual({ ...DEFAULT_PREFS, attract: false });
    expect('extra' in p).toBe(false);
  });
  it('follows the device reduced-motion setting only when motion is unset', () => {
    expect(normalizePrefs({}, { reducedMotion: true }).motion).toBe('gentle');
    expect(normalizePrefs({ motion: 'full' }, { reducedMotion: true }).motion).toBe('full');
    expect(normalizePrefs({ motion: 'gentle' }, { reducedMotion: false }).motion).toBe('gentle');
  });
  it('has one row per pref key', () => {
    expect([...PREF_ROWS].sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
  });
});

describe('effectivePrefs', () => {
  it('full motion keeps every effect the toggles allow', () => {
    expect(effectivePrefs(DEFAULT_PREFS)).toEqual({
      gentle: false, shake: true, flourishes: true, particleScale: 1, bubbles: true, weather: true, attract: true, colorAssist: false,
    });
  });
  it('gentle motion switches off wobble + flourishes and halves particles, whatever the toggles say', () => {
    const e = effectivePrefs({ ...DEFAULT_PREFS, motion: 'gentle', shake: true });
    expect(e.gentle).toBe(true);
    expect(e.shake).toBe(false);
    expect(e.flourishes).toBe(false);
    expect(e.particleScale).toBe(0.5);
    expect(e.weather).toBe(true);
  });
  it('shake off stays off in full motion', () => {
    expect(effectivePrefs({ shake: false }).shake).toBe(false);
  });
});

describe('deviceReducedMotion', () => {
  it('reads matchMedia and survives a missing / throwing window', () => {
    expect(deviceReducedMotion({ matchMedia: (q) => ({ matches: q.includes('reduce') }) })).toBe(true);
    expect(deviceReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(deviceReducedMotion(null)).toBe(false);
    expect(deviceReducedMotion({ matchMedia: () => { throw new Error('nope'); } })).toBe(false);
  });
});

describe('createPrefsStore', () => {
  it('loads, merges, saves and notifies only on real changes', () => {
    const storage = memStorage({ [PREFS_KEY]: JSON.stringify({ bubbles: false }) });
    const store = createPrefsStore({ storage, reducedMotion: false });
    expect(store.get().bubbles).toBe(false);
    const seen = [];
    const off = store.subscribe((p) => seen.push(p));
    store.set({ bubbles: false }); // no change -> no save, no notify
    expect(seen).toHaveLength(0);
    const next = store.set({ weather: false, motion: 'gentle' });
    expect(next).toMatchObject({ weather: false, motion: 'gentle', bubbles: false });
    expect(seen).toHaveLength(1);
    expect(JSON.parse(storage.getItem(PREFS_KEY))).toMatchObject({ weather: false, motion: 'gentle' });
    off();
    store.set({ weather: true });
    expect(seen).toHaveLength(1);
  });
  it('get() returns copies (callers cannot mutate the store)', () => {
    const store = createPrefsStore({ storage: memStorage(), reducedMotion: false });
    const a = store.get();
    a.bubbles = false;
    expect(store.get().bubbles).toBe(true);
  });
  it('survives corrupt JSON, a throwing storage and no storage at all', () => {
    expect(createPrefsStore({ storage: memStorage({ [PREFS_KEY]: '{oops' }), reducedMotion: false }).get()).toEqual({ ...DEFAULT_PREFS });
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('x'); } };
    const s = createPrefsStore({ storage: throwing, reducedMotion: true });
    expect(s.get().motion).toBe('gentle');
    expect(s.set({ shake: false }).shake).toBe(false); // kept in memory
    expect(s.get().shake).toBe(false);
    expect(s.reset().shake).toBe(true);
    const none = createPrefsStore({ storage: null, reducedMotion: false });
    expect(none.set({ attract: false }).attract).toBe(false);
  });
  it('reset() forgets the save and follows the device again', () => {
    const storage = memStorage();
    const store = createPrefsStore({ storage, reducedMotion: true });
    store.set({ motion: 'full', bubbles: false });
    const seen = vi.fn();
    store.subscribe(seen);
    expect(store.reset()).toEqual({ ...DEFAULT_PREFS, motion: 'gentle' });
    expect(storage.getItem(PREFS_KEY)).toBe(null);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it('a throwing listener never stops the others', () => {
    const store = createPrefsStore({ storage: memStorage(), reducedMotion: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = vi.fn();
    store.subscribe(() => { throw new Error('boom'); });
    store.subscribe(good);
    store.set({ shake: false });
    expect(good).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('reload() re-reads storage (another tab changed it)', () => {
    const storage = memStorage();
    const store = createPrefsStore({ storage, reducedMotion: false });
    expect(store.get().attract).toBe(true);
    storage.setItem(PREFS_KEY, JSON.stringify({ attract: false }));
    expect(store.get().attract).toBe(true);
    expect(store.reload().attract).toBe(false);
  });
});

describe('Effects screen reducer', () => {
  const start = () => createEffectsState(DEFAULT_PREFS);
  it('rows are every pref plus Back', () => {
    expect(EFFECTS_ROWS).toEqual([...PREF_ROWS, 'back']);
    for (const r of EFFECTS_ROWS) expect(EFFECT_ROW_LABELS[r], r).toBeTruthy();
  });
  it('up/down wrap and play the move sound', () => {
    let r = effectsReduce(start(), { action: 'up' });
    expect(r.state.row).toBe(EFFECTS_ROWS.length - 1);
    expect(r.fx).toEqual(['move']);
    r = effectsReduce(r.state, { action: 'down' });
    expect(r.state.row).toBe(0);
    expect(r.patch).toBe(null);
  });
  it('A / left / right flip the focused row and return a patch', () => {
    let r = effectsReduce(start(), { action: 'confirm' });
    expect(r.patch).toEqual({ motion: 'gentle' });
    expect(r.state.prefs.motion).toBe('gentle');
    expect(r.fx).toEqual(['confirm']);
    r = effectsReduce(r.state, { action: 'left' });
    expect(r.patch).toEqual({ motion: 'full' });
    r = effectsReduce({ ...r.state, row: 1 }, { action: 'right' });
    expect(r.patch).toEqual({ shake: false });
    r = effectsReduce(r.state, { action: 'toggle' });
    expect(r.patch).toEqual({ shake: true });
  });
  it('A on Back and B both leave; left/right on Back do nothing', () => {
    const back = { ...start(), row: EFFECTS_ROWS.indexOf('back') };
    expect(effectsReduce(back, { action: 'confirm' }).go).toBe('back');
    expect(effectsReduce(start(), { action: 'back' })).toMatchObject({ go: 'back', fx: ['back'] });
    const lr = effectsReduce(back, { action: 'left' });
    expect(lr.go).toBe(null);
    expect(lr.patch).toBe(null);
    expect(lr.fx).toEqual([]);
  });
  it('mouse select focuses and flips a row; bad indexes are ignored', () => {
    const r = effectsReduce(start(), { action: 'select', index: EFFECTS_ROWS.indexOf('colorAssist') });
    expect(r.state.row).toBe(EFFECTS_ROWS.indexOf('colorAssist'));
    expect(r.patch).toEqual({ colorAssist: true });
    for (const index of [-1, 99, 1.5, 'x', undefined]) {
      const n = effectsReduce(start(), { action: 'select', index });
      expect(n.patch).toBe(null);
      expect(n.state.row).toBe(0);
    }
    expect(effectsReduce(start(), { action: 'select', index: EFFECTS_ROWS.length - 1 }).go).toBe('back');
  });
  it('unknown actions change nothing', () => {
    const s = start();
    expect(effectsReduce(s, { action: 'pick' })).toEqual({ state: s, fx: [], patch: null, go: null });
    expect(effectsReduce(s)).toEqual({ state: s, fx: [], patch: null, go: null });
  });
  it('togglePatch covers every row', () => {
    for (const key of PREF_ROWS) expect(togglePatch(DEFAULT_PREFS, key)).toBeTruthy();
    expect(togglePatch(DEFAULT_PREFS, 'back')).toBe(null);
    expect(togglePatch(DEFAULT_PREFS, 'nope')).toBe(null);
    expect(togglePatch({ motion: 'gentle' }, 'motion', -1)).toEqual({ motion: 'full' });
  });
});

describe('Effects screen registration', () => {
  it('is a title-screen menu entry after Grown-ups', () => {
    expect(SCREENS.has('effects')).toBe(true);
    const ids = menuEntries(SCREENS, 'title').map((e) => e.id);
    expect(ids).toContain('effects');
    expect(ids.indexOf('effects')).toBeGreaterThan(ids.indexOf('settings'));
  });
  it('labels use friendly words only', () => {
    for (const [, title, help] of Object.values(EFFECT_ROW_LABELS)) {
      expect(`${title} ${help}`).not.toMatch(/\b(hit|kill|crash|destroy|dead|die)\b/i);
    }
  });
});

describe('presentation-prefs system', () => {
  it('maps prefs to body classes', () => {
    expect(bodyClassesFor(DEFAULT_PREFS)).toEqual({ 'skx-gentle': false, 'skx-cb': false });
    expect(bodyClassesFor({ motion: 'gentle', colorAssist: true })).toEqual({ 'skx-gentle': true, 'skx-cb': true });
    const target = { classList: classList() };
    applyBodyClasses(target, { motion: 'gentle' });
    expect(target.classList.contains('skx-gentle')).toBe(true);
    applyBodyClasses(target, { motion: 'full' });
    expect(target.classList.contains('skx-gentle')).toBe(false);
    expect(() => applyBodyClasses(null, DEFAULT_PREFS)).not.toThrow();
  });
  it('is auto-installed, adds the shape widget and follows store changes', () => {
    expect(listSystems().map((s) => s.id)).toContain('presentation-prefs');
    const store = createPrefsStore({ storage: memStorage(), reducedMotion: false });
    const app = createFakeApp({ prefs: store });
    const uninstall = installSystems(app.bus, app, [presentationPrefs]);
    expect(app.hud.widgets.map((w) => w.id)).toContain('skx-player-shape');
    uninstall();
    expect(app.hud.widgets.map((w) => w.id)).not.toContain('skx-player-shape');
  });
  it('the shape widget tags the viewport with the player number and cleans up', () => {
    const vp = { dataset: {} };
    const inst = playerShapeWidget.create(vp, 2, vp);
    expect(vp.dataset.skxP).toBe('3');
    inst.update();
    inst.destroy();
    expect(vp.dataset.skxP).toBeUndefined();
    expect(() => playerShapeWidget.create(null, 0, null).destroy()).not.toThrow();
  });
});
