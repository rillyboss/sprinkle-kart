/**
 * Candy Arcade UI kit (src/ui/kit/): icons are real SVG (never emoji), components produce the class
 * contract the stylesheets and the wave-2 sweep rely on, tokens exist for every brand colour.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeDom, fakeElement } from './helpers/fakeOverlayDom.js';
import {
  icon, ICON_NAMES, hasIcon, iconForEmoji, modeIcon, itemIcon, entryIcon, starPath, gearPath,
} from '../src/ui/kit/icons.js';
import {
  PAD_GLYPHS, glyphHtml, keyHtml, inputsHtml, hintHtml, titleHtml, badgeHtml, buttonHtml, button, tabBar,
  panel, segmented, meterHtml, starsHtml, toastHtml, modal, footbar, topbar,
} from '../src/ui/kit/components.js';
import * as kit from '../src/ui/kit/index.js';
import { glyph, kbd, hint } from '../src/ui/dom.js';
import { ITEM_CATALOG } from '../src/race/itemCatalog.js';

const EMOJI = /\p{Extended_Pictographic}/u;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

afterEach(() => { vi.unstubAllGlobals(); });

function withDom() {
  const doc = installFakeDom();
  doc.createTextNode = (t) => ({ textContent: t, nodeType: 3, children: [], classList: { contains: () => false } });
  return doc;
}

describe('icons', () => {
  it('every icon is a balanced 32x32 SVG with a grape outline and no emoji', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(60);
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg, name).toMatch(/^<svg class="ck-icon ck-icon-[a-z0-9-]+" viewBox="0 0 32 32"/);
      expect(svg.endsWith('</svg>'), name).toBe(true);
      expect(svg, name).not.toMatch(EMOJI);
      expect(svg, name).not.toMatch(/NaN|undefined/);
      expect(svg.length, name).toBeGreaterThan(160);
      const opens = (svg.match(/<(g|text|title)\b/g) || []).length;
      const closes = (svg.match(/<\/(g|text|title)>/g) || []).length;
      expect(opens, name).toBe(closes);
    }
  });

  it('covers controls, items, modes, menus and statuses', () => {
    for (const n of ['btn-a', 'btn-b', 'btn-x', 'btn-y', 'btn-lb', 'btn-rb', 'btn-start', 'dpad', 'key', 'lock', 'trophy', 'settings',
      'online', 'back', 'star', 'flag', 'jump', 'length', 'map', 'free', 'grand-prix', 'time-trial', 'team', 'battle', 'daily', 'records']) {
      expect(hasIcon(n), n).toBe(true);
    }
    for (const id of Object.keys(ITEM_CATALOG)) expect(hasIcon(id), `item ${id}`).toBe(true);
  });

  it('unknown names draw the mystery box; titles become accessible labels (escaped)', () => {
    expect(icon('nope')).toContain('ck-icon-mystery');
    expect(icon('lock', { title: 'Locked <3', cls: 'big' })).toContain('aria-label="Locked &lt;3"');
    expect(icon('lock', { cls: 'big' })).toContain('class="ck-icon ck-icon-lock big"');
    expect(icon('lock')).toContain('aria-hidden="true"');
  });

  it('maps old emoji labels, modes, items and menu entries to icons', () => {
    expect(iconForEmoji('🏆')).toBe('trophy');
    expect(iconForEmoji('⚙️')).toBe('settings');
    expect(iconForEmoji('⚙️')).toBe('settings');
    expect(iconForEmoji('🦄')).toBe(null);
    expect(iconForEmoji('')).toBe(null);
    expect(modeIcon('grand-prix')).toBe('grand-prix');
    expect(modeIcon('new-mode')).toBe('flag');
    expect(itemIcon('gumdrop')).toBe('gumdrop');
    expect(itemIcon('mystery-thing')).toBe('mystery');
    expect(entryIcon({ id: 'settings', emoji: '⚙️' })).toBe('settings');
    expect(entryIcon({ id: 'x', icon: 'camera' })).toBe('camera');
    expect(entryIcon({ id: 'x', emoji: '🎁' })).toBe('gift');
    expect(entryIcon({ id: 'x' })).toBe('sparkle');
    expect(entryIcon(null)).toBe('sparkle');
  });

  it('path helpers draw closed shapes', () => {
    expect(starPath(16, 16, 10, 5)).toMatch(/^M[\d. L-]+Z$/);
    expect(starPath(16, 16, 10, 5).split('L')).toHaveLength(10);
    expect(gearPath(16, 16, 12, 9, 8).split('L')).toHaveLength(32);
  });
});

describe('component markup', () => {
  it('glyphs, keys and hints (the legacy dom.js helpers now draw the kit ones)', () => {
    expect(Object.keys(PAD_GLYPHS)).toEqual(expect.arrayContaining(['A', 'B', 'X', 'Y', 'LB', 'RB', 'START', 'DPAD']));
    expect(glyphHtml('lb')).toContain('ck-glyph-lb');
    expect(glyphHtml('lb')).toContain('ck-icon-btn-lb');
    expect(glyphHtml('zz')).toContain('ck-icon-btn-a');
    expect(keyHtml('<Q>')).toBe('<span class="ck-key">&lt;Q&gt;</span>');
    expect(inputsHtml('RB', ['E', 'PgDn'])).toMatch(/ck-glyph-rb.*ck-key">E<.*ck-key">PgDn</);
    expect(inputsHtml(null, 'Q')).toBe('<span class="ck-inputs"><span class="ck-key">Q</span></span>');
    expect(hintHtml('A', 'Enter', 'Pick')).toMatch(/class="ck-hint".*ck-glyph-a.*Enter.*ck-hint-t">Pick</);
    expect(hintHtml('A', null, 'Go')).not.toContain('ck-key');
    expect(glyph('A')).toBe(glyphHtml('A'));
    expect(kbd('Esc')).toBe(keyHtml('Esc'));
    expect(hint('B', 'Esc', 'Back')).toMatch(/^<span class="sk-hint">.*ck-glyph-b/);
  });

  it('titles, badges, buttons', () => {
    expect(titleHtml('Hi & bye')).toBe('<h1 class="ck-title">Hi &amp; bye</h1>');
    expect(titleHtml('x', { sticker: true, tone: 'lemon', tag: 'div' })).toBe('<div class="ck-title ck-title--sticker ck-title--lemon">x</div>');
    expect(titleHtml('x', { tag: 'script' })).toMatch(/^<h1/);
    expect(badgeHtml('P1', { variant: 'player', pc: '#f00' })).toBe('<span class="ck-badge ck-badge--player" style="--pc:#f00"><span>P1</span></span>');
    expect(badgeHtml('', { iconName: 'lock', flat: true })).toMatch(/^<span class="ck-badge ck-badge--flat"><svg/);
    const b = buttonHtml({ label: 'Go', iconName: 'play', glyph: 'A', variant: 'go', size: 'lg', attrs: { 'data-x': '1' } });
    expect(b).toMatch(/^<button type="button" class="ck-btn ck-btn--go ck-btn--lg" data-x="1">/);
    expect(b).toContain('ck-icon-play');
    expect(b).toContain('ck-glyph-a');
    expect(buttonHtml({ iconName: 'back' })).toContain('ck-btn--icon');
    expect(buttonHtml({ label: 'x', variant: 'weird', stripes: true, block: true })).toContain('class="ck-btn ck-btn--block ck-btn--stripes"');
    expect(buttonHtml({ label: 'x', emoji: '🍪' })).toContain('ck-emoji');
  });

  it('meters, stars and toasts', () => {
    expect(meterHtml(3, 5).match(/class="on"/g)).toHaveLength(3);
    expect(meterHtml(9, 5).match(/class="on"/g)).toHaveLength(5);
    expect(meterHtml('x', 4)).not.toContain('class="on"');
    expect(meterHtml(2, 5, '#abc')).toContain('--ck-meter:#abc');
    expect(starsHtml(2).match(/ck-icon-star on/g)).toHaveLength(2);
    expect(starsHtml(2).match(/ck-icon-star off/g)).toHaveLength(3);
    expect(toastHtml({ title: 'Yay', iconName: 'trophy', tone: 'lemon', sub: 'sub' })).toMatch(/ck-toast ck-toast--lemon.*ck-icon-trophy.*<b>Yay<\/b><small>sub<\/small>/);
    expect(toastHtml({ title: 'x', tone: 'bogus' })).toContain('class="ck-toast"');
    expect(toastHtml({ title: 'x', emoji: '🦄' })).toContain('ck-emoji');
    expect(toastHtml({ title: 'x' })).toContain('ck-icon-sparkle');
  });
});

describe('component nodes', () => {
  it('button() wires the click and never bubbles', () => {
    withDom();
    const onClick = vi.fn();
    const stop = vi.fn();
    const b = button({ label: 'Go', variant: 'go', onClick });
    expect(b.className).toBe('ck-btn ck-btn--go');
    b.dispatch('click', { stopPropagation: stop });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });

  it('tabBar: clickable tabs, LB/RB nav buttons step with wrap, set() marks the selected tab', () => {
    withDom();
    const picks = [];
    const tb = tabBar({ tabs: [{ label: 'A', iconName: 'star' }, { label: 'B', locked: true }, { label: 'C' }], index: 0, onSelect: (i, how) => picks.push([i, how]) });
    expect(tb.tabs).toHaveLength(3);
    expect(tb.tabs[0].classList.contains('is-selected')).toBe(true);
    expect(tb.tabs[1].className).toBe('ck-tab is-locked');
    tb.tabs[2].dispatch('click');
    const [prev, , next] = tb.node.children;
    prev.dispatch('click');
    next.dispatch('click');
    expect(picks).toEqual([[2, 'click'], [2, 'step'], [1, 'step']]);
    tb.set(2);
    expect(tb.index).toBe(2);
    expect(tb.tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(tb.tabs[0].classList.contains('is-selected')).toBe(false);
    tb.step(1);
    expect(picks.at(-1)).toEqual([0, 'step']);
    const bare = tabBar({ tabs: [], nav: false });
    bare.step(1);
    expect(bare.node.children).toHaveLength(1);
  });

  it('segmented, panel, modal, footbar, topbar', () => {
    withDom();
    const chosen = [];
    const seg = segmented({ options: [{ label: 'Cozy', sub: 'easy' }, { label: 'Zippy', iconName: 'speed' }], index: 1, onSelect: (i) => chosen.push(i) });
    expect(seg.opts[1].classList.contains('is-selected')).toBe(true);
    seg.opts[0].dispatch('click');
    expect(chosen).toEqual([0]);
    seg.focus(true);
    expect(seg.node.classList.contains('is-focus')).toBe(true);
    const p = panel({ variant: 'dark', tilt: true, sprinkles: true, title: 'Facts', titleIcon: 'map' }, fakeElement('span'));
    expect(p.className).toBe('ck-panel ck-panel--dark ck-panel--tilt ck-panel--sprinkles');
    expect(p.children).toHaveLength(2);
    const onClose = vi.fn();
    const m = modal({ title: 'Hello', onClose });
    expect(m.className).toBe('ck-scrim');
    m.dispatch('click', { target: m, currentTarget: m });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(footbar([hintHtml('A', 'Enter', 'Go')], 'note').innerHTML).toMatch(/ck-footbar-note">note<.*ck-hint/);
    const back = vi.fn();
    const tb = topbar({ title: 'Choose!', onBack: back, right: '<b>x</b>' });
    expect(tb.className).toBe('ck-topbar');
    tb.children[0].dispatch('click');
    expect(back).toHaveBeenCalled();
    expect(topbar({ title: 'x', right: fakeElement('i') }).children).toHaveLength(2);
  });
});

describe('kit contract', () => {
  it('index re-exports the pieces and the font href loads Lilita One + Fredoka', () => {
    for (const k of ['icon', 'buttonHtml', 'tabBar', 'createToastLane', 'laneFor', 'toastHtml', 'KIT_FONT_HREF']) expect(kit[k], k).toBeDefined();
    expect(kit.KIT_FONT_HREF).toMatch(/Lilita\+One/);
    expect(kit.KIT_FONT_HREF).toMatch(/Fredoka/);
    expect(read('index.html')).toMatch(/Lilita\+One/);
  });

  it('tokens define the brand palette, type, outline, bevel and motion', () => {
    const css = read('src/ui/kit/tokens.css');
    for (const [name, hex] of [['raspberry', '#ff3e8a'], ['grape', '#2e1447'], ['mint', '#3fe0b5'], ['lemon', '#ffd23f'], ['sky', '#4fb3ff'], ['cream', '#fff6e8']]) {
      expect(css).toContain(`--ck-${name}: ${hex};`);
    }
    for (const t of ['--ck-font-display', '--ck-font-body', '--ck-ol', '--ck-bevel', '--ck-spring', '--ck-t-fast', '--ck-sprinkles', '--ck-stripes']) expect(css).toContain(`${t}:`);
  });

  it('every component class used by components.js is styled in kit.css', () => {
    const css = read('src/ui/kit/kit.css');
    for (const cls of ['ck-btn', 'ck-btn--go', 'ck-tabbar', 'ck-tab', 'ck-tab-nav', 'ck-panel', 'ck-card', 'ck-badge', 'ck-seg', 'ck-seg-opt',
      'ck-meter', 'ck-stars', 'ck-toast', 'ck-toast-chip', 'ck-scrim', 'ck-modal', 'ck-hint', 'ck-footbar', 'ck-topbar', 'ck-title', 'ck-glyph', 'ck-key', 'ck-icon']) {
      expect(css, cls).toMatch(new RegExp(`\\.${cls}[\\s{.,:]`));
    }
  });

  it('motion is snappy: no kit transition or animation longer than 1s except loops', () => {
    const css = read('src/ui/kit/kit.css') + read('src/ui/kit/hud.css');
    const slow = [...css.matchAll(/(?:transition|animation):[^;]*?(\d+(?:\.\d+)?)(ms|s)\b[^;]*;/g)]
      .filter((m) => !/infinite/.test(m[0]))
      .filter((m) => (m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1])) > 1000)
      .map((m) => m[0])
      .filter((s) => !/ck-finish|ck-banner/.test(s)); // the finish / final-lap sequences are timed on purpose
    expect(slow).toEqual([]);
  });
});
