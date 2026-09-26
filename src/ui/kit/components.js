/**
 * Candy Arcade components. Two flavours of every piece:
 *   xxxHtml(...)  -> markup string (for screens that render with innerHTML)
 *   xxx(...)      -> a live DOM node with its click handlers wired (uses ../dom.js el())
 * Class names are the contract (kit.css); see README.md + the ?uikit=1 page.
 * OWNER: UI art direction. Nothing here touches `document` at import time.
 */
import { el, escapeHtml } from '../dom.js';
import { icon, hasIcon } from './icons.js';

const esc = escapeHtml;

/* ------------------------------------------------------------------ */
/* glyphs, keys, hints                                                 */
/* ------------------------------------------------------------------ */

/** Controller button names -> icon names. */
export const PAD_GLYPHS = Object.freeze({
  A: 'btn-a', B: 'btn-b', X: 'btn-x', Y: 'btn-y', LB: 'btn-lb', RB: 'btn-rb',
  START: 'btn-start', DPAD: 'dpad', STICK: 'stick', MOUSE: 'mouse',
});

/** Controller button glyph ('A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'START' | 'DPAD' | 'STICK'). */
export function glyphHtml(button) {
  const b = String(button ?? '').toUpperCase();
  const name = PAD_GLYPHS[b] ?? 'btn-a';
  return `<span class="ck-glyph ck-glyph-${b.toLowerCase()}">${icon(name, { title: b === 'DPAD' ? 'D-pad' : b })}</span>`;
}

/** Keyboard keycap. */
export function keyHtml(text) {
  return `<span class="ck-key">${esc(text)}</span>`;
}

/** Pad glyph + keycap(s) for one action: inputsHtml('LB', ['Q', 'PgUp']). */
export function inputsHtml(pad, keys = []) {
  const ks = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  return `<span class="ck-inputs">${pad ? glyphHtml(pad) : ''}${ks.map(keyHtml).join('')}</span>`;
}

/**
 * Button prompt: glyph + key + label. Same signature as the legacy dom.js hint(letter, key, label).
 * `pad` may also be 'DPAD' / 'LB' ..., `key` a string or an array of keys.
 */
export function hintHtml(pad, key, label) {
  return `<span class="ck-hint">${inputsHtml(pad, key ? (Array.isArray(key) ? key : [key]) : [])}<span class="ck-hint-t">${esc(label)}</span></span>`;
}

/* ------------------------------------------------------------------ */
/* text                                                                */
/* ------------------------------------------------------------------ */

/** Display heading. tone: 'cream' (default) | 'lemon' | 'raspberry'; sticker: raspberry block, tilted. */
export function titleHtml(text, { sticker = false, tone = 'cream', tag = 'h1', cls = '' } = {}) {
  const t = ['h1', 'h2', 'h3', 'div', 'span'].includes(tag) ? tag : 'h1';
  const classes = ['ck-title', sticker ? 'ck-title--sticker' : '', tone !== 'cream' ? `ck-title--${tone}` : '', cls].filter(Boolean).join(' ');
  return `<${t} class="${esc(classes)}">${esc(text)}</${t}>`;
}

/** Sticker badge. variant: 'lemon' | 'raspberry' | 'mint' | 'sky' | 'grape' | 'cream' | 'player' (uses --pc). */
export function badgeHtml(text, { variant = 'lemon', iconName = '', flat = false, pc = '', cls = '' } = {}) {
  const classes = ['ck-badge', variant !== 'lemon' ? `ck-badge--${variant}` : '', flat ? 'ck-badge--flat' : '', cls].filter(Boolean).join(' ');
  const style = pc ? ` style="--pc:${esc(pc)}"` : '';
  return `<span class="${esc(classes)}"${style}>${iconName ? icon(iconName) : ''}${text != null && text !== '' ? `<span>${esc(text)}</span>` : ''}</span>`;
}

/* ------------------------------------------------------------------ */
/* buttons                                                             */
/* ------------------------------------------------------------------ */

const BTN_VARIANTS = new Set(['primary', 'go', 'lemon', 'sky', 'cream', 'grape']);

function btnClasses({ variant = 'primary', size = '', block = false, stripes = false, iconOnly = false, cls = '' }) {
  return ['ck-btn', BTN_VARIANTS.has(variant) && variant !== 'primary' ? `ck-btn--${variant}` : '',
    size === 'lg' || size === 'sm' ? `ck-btn--${size}` : '', block ? 'ck-btn--block' : '', stripes ? 'ck-btn--stripes' : '',
    iconOnly ? 'ck-btn--icon' : '', cls].filter(Boolean).join(' ');
}

function btnInner({ label = '', iconName = '', glyph = '', emoji = '' }) {
  const ic = iconName && hasIcon(iconName) ? icon(iconName) : emoji ? `<span class="ck-emoji">${esc(emoji)}</span>` : '';
  return `${ic}${label ? `<span class="ck-btn-label">${esc(label)}</span>` : ''}${glyph ? glyphHtml(glyph) : ''}`;
}

/**
 * Chunky button markup.
 * @param {{label?:string, iconName?:string, glyph?:string, variant?:'primary'|'go'|'lemon'|'sky'|'cream'|'grape',
 *          size?:''|'lg'|'sm', block?:boolean, stripes?:boolean, cls?:string, attrs?:Record<string,string>}} o
 */
export function buttonHtml(o = {}) {
  const attrs = Object.entries(o.attrs ?? {}).map(([k, v]) => ` ${esc(k)}="${esc(v)}"`).join('');
  return `<button type="button" class="${esc(btnClasses({ ...o, iconOnly: !o.label && !!o.iconName }))}"${attrs}>${btnInner(o)}</button>`;
}

/** Chunky button node; `onClick(event)` is wired, clicks never bubble into the screen. */
export function button(o = {}) {
  const node = el('button', {
    type: 'button',
    class: btnClasses({ ...o, iconOnly: !o.label && !!o.iconName }),
    html: btnInner(o),
    onclick: (e) => { e?.stopPropagation?.(); o.onClick?.(e); },
  });
  node.className = node.className.trim();
  return node;
}

/* ------------------------------------------------------------------ */
/* tab bar                                                             */
/* ------------------------------------------------------------------ */

/**
 * A real tab bar: clickable tabs + LB / RB end buttons (keyboard Q/E or PgUp/PgDn arrive as
 * menu actions 'tabPrev' / 'tabNext' — route them to `step(-1|1)` in your screen's handler).
 * @param {{ tabs: Array<{id?:string, label:string, iconName?:string, locked?:boolean}>, index?:number,
 *           onSelect?:(index:number, how:'click'|'step')=>void, nav?:boolean, keys?:[string,string] }} o
 * @returns {{ node, tabs: HTMLElement[], set(index), step(dir) }}
 */
export function tabBar({ tabs = [], index = 0, onSelect = null, nav = true, keys = ['Q', 'E'] } = {}) {
  let current = Math.max(0, Math.min(tabs.length - 1, index));
  const tabEls = tabs.map((t, i) => {
    const b = el('button', {
      type: 'button', class: `ck-tab${t.locked ? ' is-locked' : ''}`, role: 'tab', 'data-tab': t.id ?? String(i),
      html: `${t.iconName ? icon(t.iconName) : ''}<span class="ck-tab-label">${esc(t.label)}</span>${t.locked ? icon('lock', { cls: 'ck-tab-lock' }) : ''}`,
      onclick: (e) => { e?.stopPropagation?.(); onSelect?.(i, 'click'); },
    });
    b.className = b.className.trim();
    return b;
  });
  const strip = el('div.ck-tabs', { role: 'tablist' }, tabEls);
  const navBtn = (dir) => el('button', {
    type: 'button', class: 'ck-tab-nav', 'data-dir': dir < 0 ? 'prev' : 'next', 'aria-label': dir < 0 ? 'Previous tab' : 'Next tab',
    html: dir < 0 ? `${glyphHtml('LB')}${keyHtml(keys[0])}` : `${keyHtml(keys[1])}${glyphHtml('RB')}`,
    onclick: (e) => { e?.stopPropagation?.(); api.step(dir); },
  });
  const node = el('div.ck-tabbar', {}, nav ? navBtn(-1) : null, strip, nav ? navBtn(1) : null);
  const api = {
    node,
    tabs: tabEls,
    get index() { return current; },
    set(i) {
      current = Math.max(0, Math.min(tabEls.length - 1, i));
      tabEls.forEach((t, k) => { t.classList.toggle('is-selected', k === current); t.setAttribute('aria-selected', k === current ? 'true' : 'false'); });
    },
    step(dir) {
      if (!tabEls.length) return;
      const next = (current + (dir < 0 ? -1 : 1) + tabEls.length) % tabEls.length;
      onSelect?.(next, 'step');
    },
  };
  api.set(current);
  return api;
}

/* ------------------------------------------------------------------ */
/* panels, segmented, meters                                           */
/* ------------------------------------------------------------------ */

/** Panel node. variant: '' | 'dark' | 'raspberry'; tilt / sprinkles flags. */
export function panel({ variant = '', tilt = false, sprinkles = false, title = '', titleIcon = '', cls = '' } = {}, ...children) {
  const classes = ['ck-panel', variant ? `ck-panel--${variant}` : '', tilt ? 'ck-panel--tilt' : '', sprinkles ? 'ck-panel--sprinkles' : '', cls].filter(Boolean).join(' ');
  const head = title ? el('div.ck-panel-head', { html: `${titleIcon ? icon(titleIcon) : ''}<span>${esc(title)}</span>` }) : null;
  const node = el('div', { class: classes }, head, ...children);
  node.className = node.className.trim();
  return node;
}

/**
 * Segmented control (one choice of a few): options [{ label, sub?, iconName? }].
 * @returns {{ node, opts: HTMLElement[], set(index), focus(on) }}
 */
export function segmented({ options = [], index = 0, onSelect = null, cls = '' } = {}) {
  const opts = options.map((o, i) => {
    const b = el('button', {
      type: 'button', class: 'ck-seg-opt',
      html: `${o.iconName ? icon(o.iconName) : ''}<span>${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>`,
      onclick: (e) => { e?.stopPropagation?.(); onSelect?.(i); },
    });
    b.className = b.className.trim();
    return b;
  });
  const node = el('div', { class: `ck-seg${cls ? ` ${cls}` : ''}`, role: 'radiogroup' }, opts);
  const api = {
    node,
    opts,
    set(i) { opts.forEach((o, k) => o.classList.toggle('is-selected', k === i)); },
    focus(on) { node.classList.toggle('is-focus', !!on); },
  };
  api.set(index);
  return api;
}

/** Stat meter: `value` of `max` filled segments. */
export function meterHtml(value, max = 5, color = '') {
  const v = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  const style = color ? ` style="--ck-meter:${esc(color)}"` : '';
  return `<span class="ck-meter"${style}>${Array.from({ length: max }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** Difficulty stars: n of max. */
export function starsHtml(n, max = 5) {
  const v = Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
  return `<span class="ck-stars" aria-label="${v} of ${max} stars">${Array.from({ length: max }, (_, i) => icon('star', { cls: i < v ? 'on' : 'off' })).join('')}</span>`;
}

/* ------------------------------------------------------------------ */
/* toast, modal, chrome                                                */
/* ------------------------------------------------------------------ */

const TONES = new Set(['raspberry', 'mint', 'lemon', 'sky', 'grape', 'alert']);

/** Toast markup: { iconName | emoji, title, sub?, tone: 'raspberry'|'mint'|'lemon'|'sky'|'grape'|'alert' }. */
export function toastHtml({ iconName = '', emoji = '', title = '', sub = '', tone = 'raspberry', cls = '' } = {}) {
  const t = TONES.has(tone) ? tone : 'raspberry';
  const chip = iconName && hasIcon(iconName) ? icon(iconName) : emoji ? `<span class="ck-emoji">${esc(emoji)}</span>` : icon('sparkle');
  return `<div class="ck-toast${t !== 'raspberry' ? ` ck-toast--${t}` : ''}${cls ? ` ${esc(cls)}` : ''}">`
    + `<span class="ck-toast-chip">${chip}</span><span class="ck-toast-text"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></div>`;
}

/** Modal: scrim + panel with a sticker title. Returns the scrim node (append it to a screen). */
export function modal({ title = '', onClose = null, cls = '' } = {}, ...children) {
  const box = panel({ cls: `ck-modal${cls ? ` ${cls}` : ''}` },
    title ? el('div.ck-modal-title', { html: titleHtml(title, { sticker: true, tag: 'div' }) }) : null,
    el('div.ck-modal-body', {}, ...children));
  return el('div.ck-scrim', { onclick: (e) => { if (e?.target === e?.currentTarget) onClose?.(); } }, box);
}

/** Bottom grape bar of button hints (strings from hintHtml) with an optional note on the left. */
export function footbar(hints = [], note = '') {
  return el('div.ck-footbar', { html: `${note ? `<span class="ck-footbar-note">${esc(note)}</span>` : ''}${hints.join('')}` });
}

/**
 * Screen top bar: back button + tilted display title on the grape band, optional right-side node/markup.
 * @returns {HTMLElement}
 */
export function topbar({ title = '', onBack = null, right = null } = {}) {
  const back = onBack ? button({ label: 'Back', iconName: 'back', variant: 'cream', size: 'sm', cls: 'ck-backbtn sk-back', onClick: onBack }) : null;
  const rightNode = right == null ? null : typeof right === 'string' ? el('div.ck-topbar-right', { html: right }) : el('div.ck-topbar-right', {}, right);
  return el('div.ck-topbar', {}, back, el('div.ck-topbar-title', { html: titleHtml(title) }), rightNode);
}
