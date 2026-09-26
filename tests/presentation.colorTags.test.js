// Showcase presentation: colour-friendly shapes on the menu player tags (P1 ♥ · P2 ★ · P3 ◆ · P4 ●).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import presentationPrefs, {
  playerOfTag, markPlayerTags, MENU_TAG_SELECTOR, PLAYER_SHAPES, TAG_SCAN_EVERY,
} from '../src/systems/presentationPrefs.js';
import { createPrefsStore } from '../src/presentation/prefs.js';
import { installSystems } from '../src/systems/index.js';
import { createFakeApp } from './helpers/headlessSession.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const tag = (text) => ({ textContent: text, dataset: {} });
/** A fake menus root; `selectors` records what was asked for. */
const rootWith = (els) => {
  const root = { els, asked: [], querySelectorAll(sel) { root.asked.push(sel); return root.els; } };
  return root;
};

describe('playerOfTag', () => {
  it('reads P1..P4 at the start of a tag, with or without extras', () => {
    expect(playerOfTag('P1')).toBe(1);
    expect(playerOfTag('P2 ✓')).toBe(2);
    expect(playerOfTag('  P3')).toBe(3);
    expect(playerOfTag('P4')).toBe(4);
  });
  it('ignores everything else', () => {
    for (const t of ['P5', 'P10', 'CPU', '', null, undefined, 'Press A', 'Pumpkin', 'p1', 'Lap 1']) expect(playerOfTag(t), String(t)).toBe(null);
  });
});

describe('markPlayerTags', () => {
  it('marks tags with their player and clears stale marks', () => {
    const a = tag('P1'), b = tag('P3 ✓'), c = tag('CPU');
    c.dataset.skxTag = '2'; // was a player tag before a re-render
    const root = rootWith([a, b, c, null, { textContent: 'P2' }]);
    expect(markPlayerTags(root)).toBe(2);
    expect(root.asked).toEqual([MENU_TAG_SELECTOR]);
    expect(a.dataset.skxTag).toBe('1');
    expect(b.dataset.skxTag).toBe('3');
    expect(c.dataset.skxTag).toBeUndefined();
    b.textContent = 'P4';
    markPlayerTags(root);
    expect(b.dataset.skxTag).toBe('4');
    expect(markPlayerTags(null)).toBe(0);
    expect(markPlayerTags({})).toBe(0);
  });
  it('the CSS has a shape for every player, matching the HUD shapes', () => {
    const css = readFileSync(new URL('../src/presentation/presentation.css', import.meta.url), 'utf8');
    PLAYER_SHAPES.forEach((shape, i) => {
      expect(css).toContain(`body.skx-cb [data-skx-tag='${i + 1}']::before { content: '${shape}'; }`);
      expect(css).toContain(`[data-skx-p='${i + 1}'] .sk-pchip::before { content: '${shape}'; }`);
    });
  });
});

describe('presentation-prefs system: menu tag scan', () => {
  const setup = (colorAssist) => {
    const store = createPrefsStore({ storage: memStorage(), reducedMotion: false });
    store.set({ colorAssist });
    const els = [tag('P1'), tag('P2')];
    const menus = { el: rootWith(els), screenId: 'join' };
    const game = { state: 'menu', errors: [] };
    const app = createFakeApp({ prefs: store, menus, game });
    const uninstall = installSystems(app.bus, app, [presentationPrefs]);
    return { store, els, menus, game, app, uninstall };
  };

  it('with shapes on, tags the menu a few times a second (not every frame)', () => {
    const { els, menus, game, app, uninstall } = setup(true);
    app.bus.emit('frame', 1 / 60, game);
    expect(els.map((e) => e.dataset.skxTag)).toEqual(['1', '2']);
    const scans = () => menus.el.asked.length;
    const before = scans();
    for (let i = 0; i < 6; i++) app.bus.emit('frame', 1 / 60, game); // 0.1 s
    expect(scans()).toBe(before);
    for (let i = 0; i < Math.ceil(TAG_SCAN_EVERY * 60); i++) app.bus.emit('frame', 1 / 60, game);
    expect(scans()).toBe(before + 1);
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });

  it('does nothing during a race or with shapes off, and follows the switch', () => {
    const { store, els, menus, game, app, uninstall } = setup(false);
    for (let i = 0; i < 30; i++) app.bus.emit('frame', 1 / 30, game);
    expect(els[0].dataset.skxTag).toBeUndefined();
    game.state = 'race';
    store.set({ colorAssist: true });
    for (let i = 0; i < 30; i++) app.bus.emit('frame', 1 / 30, game);
    expect(menus.el.asked).toEqual([]);
    game.state = 'results';
    for (let i = 0; i < 10; i++) app.bus.emit('frame', 1 / 30, game);
    expect(els[0].dataset.skxTag).toBe('1');
    uninstall();
    const asked = menus.el.asked.length;
    app.bus.emit('frame', 1, game);
    expect(menus.el.asked.length).toBe(asked); // uninstalled
    expect(app.bus.errors).toEqual([]);
  });

  it('copes without menus', () => {
    const store = createPrefsStore({ storage: memStorage(), reducedMotion: false });
    store.set({ colorAssist: true });
    const app = createFakeApp({ prefs: store, menus: null, game: { state: 'menu', errors: [] } });
    const uninstall = installSystems(app.bus, app, [presentationPrefs]);
    app.bus.emit('frame', 1, app.game);
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });
});
