/**
 * Small DOM helpers shared by Menus and Hud.
 */
import { cssColor, lighten } from './hudLogic.js';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap';

/** Inject the Fredoka Google Font <link> once (no-op if index.html already has it). */
export function ensureFont() {
  if (typeof document === 'undefined') return;
  const has = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /family=Fredoka/i.test(l.href));
  if (has) return;
  for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
    const pc = document.createElement('link');
    pc.rel = 'preconnect';
    pc.href = href;
    if (href.includes('gstatic')) pc.crossOrigin = 'anonymous';
    document.head.appendChild(pc);
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  document.head.appendChild(link);
}

/**
 * Tiny element factory: el('div.a.b', { onclick, style: {...}, dataset }, children...)
 * Strings become text nodes; `html:` sets innerHTML.
 */
export function el(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className += ` ${v}`;
    else if (k.startsWith('--')) node.style.setProperty(k, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Controller button glyph: coloured circle with the letter. */
export function glyph(letter) {
  return `<span class="sk-g sk-g-${letter.toLowerCase()}">${letter}</span>`;
}

/** Keyboard key hint. */
export function kbd(text) {
  return `<span class="sk-kbd">${escapeHtml(text)}</span>`;
}

/** Hint pill: glyphs + keys + label. */
export function hint(letter, key, label) {
  return `<span class="sk-hint">${glyph(letter)}${key ? kbd(key) : ''}<span class="sk-hint-t">${escapeHtml(label)}</span></span>`;
}

const CHAR_EMOJI = {
  rocco: '🍝',
  lenny: '🥒',
  stella: '🌟',
  peachy: '🍑',
  gumbo: '🐻',
  muffin: '🧁',
  dino: '🦖',
  bizzy: '🐝',
  'cotton-candy-girl': '🍭',
};

/**
 * Portrait markup for a character: the rendered image if we have one,
 * otherwise a coloured circle with an emoji/initial. `locked` renders the
 * mystery "?" silhouette instead.
 */
export function portraitHtml(def, portraits, { locked = false, cls = '' } = {}) {
  if (locked) {
    return `<div class="sk-portrait sk-portrait-locked ${cls}"><span class="sk-q">?</span></div>`;
  }
  const src = def && portraits && typeof portraits.get === 'function' ? portraits.get(def.id) : null;
  const primary = cssColor(def?.colors?.primary, '#ff9ad5');
  const bg = `radial-gradient(circle at 35% 30%, ${lighten(primary, 0.75)}, ${lighten(primary, 0.35)} 70%)`;
  if (src) {
    return `<div class="sk-portrait ${cls}" style="background:${bg}"><img src="${escapeHtml(src)}" alt="${escapeHtml(def.name)}" draggable="false"></div>`;
  }
  const face = def?.emoji || CHAR_EMOJI[def?.id] || escapeHtml((def?.name || '?').trim().charAt(0).toUpperCase());
  return `<div class="sk-portrait sk-portrait-fallback ${cls}" style="background:${bg}"><span>${face}</span></div>`;
}

/** Floating sprinkles / hearts / stars background layer. */
export function floatiesLayer(count = 30, seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const colors = ['#ff7cc3', '#b48cff', '#6fe3bf', '#6cc4ff', '#ffd95e', '#ff9f80'];
  const layer = el('div.sk-floaties', { 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    const kind = rnd();
    const c = colors[Math.floor(rnd() * colors.length)];
    const f = el(`span.sk-floaty${kind < 0.55 ? '.sk-sprinkle' : kind < 0.8 ? '.sk-heart' : '.sk-star'}`);
    f.style.setProperty('--x', `${(rnd() * 100).toFixed(1)}%`);
    f.style.setProperty('--d', `${(9 + rnd() * 12).toFixed(1)}s`);
    f.style.setProperty('--delay', `${(-rnd() * 20).toFixed(1)}s`);
    f.style.setProperty('--r', `${Math.round(rnd() * 360)}deg`);
    f.style.setProperty('--s', `${(0.6 + rnd() * 0.9).toFixed(2)}`);
    f.style.setProperty('--c', c);
    f.style.setProperty('--sway', `${Math.round(10 + rnd() * 40)}px`);
    if (kind >= 0.55) f.textContent = kind < 0.8 ? '♥' : '★';
    layer.appendChild(f);
  }
  return layer;
}

/** Confetti burst layer (CSS-animated). */
export function confettiLayer(count = 90, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const colors = ['#ff5fb4', '#b48cff', '#4fd6a8', '#4fa8ff', '#ffc933', '#ff8a65', '#ffffff'];
  const layer = el('div.sk-confetti', { 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    const p = el(`span.sk-conf${rnd() < 0.3 ? '.sk-conf-round' : ''}`);
    p.style.setProperty('--x', `${(rnd() * 100).toFixed(1)}%`);
    p.style.setProperty('--d', `${(2.8 + rnd() * 3).toFixed(2)}s`);
    p.style.setProperty('--delay', `${(-rnd() * 5).toFixed(2)}s`);
    p.style.setProperty('--c', colors[Math.floor(rnd() * colors.length)]);
    p.style.setProperty('--spin', `${Math.round(360 + rnd() * 720)}deg`);
    p.style.setProperty('--drift', `${Math.round(-80 + rnd() * 160)}px`);
    layer.appendChild(p);
  }
  return layer;
}
