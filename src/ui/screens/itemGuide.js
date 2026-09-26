/**
 * "Item Guide" — every power-up with its icon and one friendly sentence.
 * Reached from the title screen's menu row (menuEntry). A/B/Start go back.
 * OWNER: power-up clarity workstream.
 */
import { el, escapeHtml, hint } from '../dom.js';
import { ITEM_CATALOG, ITEM_ORDER } from '../../race/itemCatalog.js';
import '../widgets/items.css';

/** Rows of the guide, in item order (pure: tested in tests/items.guide.test.js). */
export function guideRows() {
  return ITEM_ORDER.map((id) => {
    const c = ITEM_CATALOG[id];
    return { id, name: c.name, emoji: c.emoji, color: c.color, text: c.guide, tip: c.tip };
  });
}

/**
 * Selection reducer: arrows walk the 2-column grid (wrapping), confirm / back /
 * start leave. Returns { index, leave, moved }.
 */
export function guideReduce(index, action, n = ITEM_ORDER.length, cols = 2) {
  const i = Math.max(0, Math.min(n - 1, index | 0));
  switch (action) {
    case 'left': return { index: (i - 1 + n) % n, leave: false, moved: true };
    case 'right': return { index: (i + 1) % n, leave: false, moved: true };
    case 'up': return { index: (i - cols + n) % n, leave: false, moved: true };
    case 'down': return { index: (i + cols) % n, leave: false, moved: true };
    case 'confirm': case 'back': case 'start': return { index: i, leave: true, moved: false };
    default: return { index: i, leave: false, moved: false };
  }
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'item-guide',
  menuEntry: { label: 'Item Guide', emoji: '🎁', order: 60 },
  mount(ctx, nav, params = {}) {
    const rows = guideRows();
    let index = 0;
    const leave = () => { ctx.sfx?.('back'); nav.goto(params.returnTo ?? 'title'); };
    const cards = rows.map((r, i) => el('div.sk-itemguide-row', {
      '--ic': r.color,
      onclick: (e) => { e.stopPropagation(); index = i; sync(); },
      html: `<div class="ic">${r.emoji}</div><div><b>${escapeHtml(r.name)}</b><p>${escapeHtml(r.text)}</p><small>💡 ${escapeHtml(r.tip)}</small></div>`,
    }));
    const sync = () => cards.forEach((c, i) => c.classList.toggle('sk-sel', i === index));
    const node = el('div.sk-screen.sk-itemguide', { onclick: leave },
      el('div.sk-card-pop.sk-itemguide-card', { onclick: (e) => e.stopPropagation() },
        el('h1.sk-h1', { html: '🎁 Item Guide' }),
        el('p.sk-lead', { html: 'Drive through a rainbow <b>?</b> box to get a surprise! Use it with <b>LB</b> on a controller, <b>E</b> (WASD) or <b>/</b> (arrows).' }),
        el('div.sk-itemguide-grid', {}, cards),
        el('div.sk-hints.sk-hints-in', { html: hint('A', 'Enter', 'Done') + hint('B', 'Esc', 'Back') })));
    const handle = (ev) => {
      const r = guideReduce(index, ev.action, rows.length);
      if (r.leave) { leave(); return; }
      if (r.moved) { index = r.index; ctx.sfx?.('move'); sync(); }
    };
    sync();
    return { node, cls: 'sk-mode-full', handle };
  },
};
