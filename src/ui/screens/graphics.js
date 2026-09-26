/**
 * "🖥️ Graphics" — a title-screen menu entry for the graphics quality (Auto · Speedy · Balanced · Sparkly).
 * Auto (the default) lets src/platform/ pick a tier for this device; the others force one.
 * Up/Down pick a row, Left/Right/A change it, B goes back. Tapping a choice picks it.
 * Logic: src/platform/graphicsMenu.js (pure). Applies through `platform.setChoice()` (window.__game.platform)
 * or, without a platform (tests), just saves the choice. OWNER: mobile platform.
 * The phase-2 responsive UI may restyle it freely; it reuses the Effects screen's row classes.
 */
import './progress.css';
import '../../presentation/presentation.css';
import { el, escapeHtml, hint, kbd, floatiesLayer } from '../dom.js';
import { hintsBar, backButton } from './_shared.js';
import { graphicsPrefs } from '../../platform/qualityPrefs.js';
import { QUALITY_CHOICES } from '../../platform/quality.js';
import {
  GRAPHICS_ROWS, QUALITY_LABELS, QUALITY_HELP, createGraphicsState, graphicsReduce, graphicsStatus,
} from '../../platform/graphicsMenu.js';

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'graphics',
  menuEntry: { label: 'Graphics', emoji: '🖥️', order: 96 },
  mount(ctx, nav, params = {}) {
    const platform = params.platform ?? (typeof window !== 'undefined' ? window.__game?.platform : null) ?? null;
    const store = params.store ?? graphicsPrefs;
    let state = createGraphicsState(platform?.choice ?? store.get().quality);
    const leave = () => nav.goto(params.returnTo ?? 'title');

    const qualityRow = el('div.skp-set-row.skx-eff-row.skg-row-quality', {});
    const backRow = el('button.skp-set-row.skx-eff-row.skp-set-back.skg-row-back', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: 1 }); },
    });
    const rows = [qualityRow, backRow];
    const status = el('div.skg-status', {});

    const render = () => {
      const [emoji, title] = QUALITY_LABELS[state.choice];
      const segs = QUALITY_CHOICES.map((c) => `<b class="${c === state.choice ? 'on' : ''}" data-q="${c}">${QUALITY_LABELS[c][0]} ${escapeHtml(QUALITY_LABELS[c][1])}</b>`).join('');
      qualityRow.innerHTML = `<span class="skp-set-e">${emoji}</span><span class="skp-set-t">${escapeHtml(title)}<small>${escapeHtml(QUALITY_HELP[state.choice])}</small></span><span class="skx-seg skg-seg">${segs}</span>`;
      backRow.innerHTML = '<span class="skp-set-e">🏠</span><span class="skp-set-t">Back</span>';
      rows.forEach((r, i) => r.classList.toggle('sk-sel', i === state.row));
      status.textContent = graphicsStatus({ choice: state.choice, quality: platform?.quality, antialiasOk: platform?.antialiasMatches?.() ?? true });
    };

    qualityRow.addEventListener('click', (e) => {
      e.stopPropagation();
      const q = e.target?.closest?.('[data-q]')?.dataset?.q;
      handle(q ? { deviceId: 'mouse', action: 'select', value: q } : { deviceId: 'mouse', action: 'select', index: 0 });
    });

    const handle = (ev) => {
      const res = graphicsReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      if (res.choice) {
        try {
          if (platform?.setChoice) platform.setChoice(res.choice);
          else store.set({ quality: res.choice });
        } catch (err) { console.warn('[graphics] could not save', err); }
      }
      render();
      if (res.go === 'back') leave();
    };

    const node = el('div.sk-screen.skp-settings.skx-effects.skg-graphics', {},
      floatiesLayer(10, 71),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Graphics <span class="sk-wiggle">🖥️</span>' })),
      el('div.skp-set-list', {}, rows),
      status,
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose / change</span></span>`,
        hint('A', 'Enter', 'Change'),
        hint('B', 'Esc', 'Back'),
      ]),
    );
    render();
    return { node, cls: 'sk-mode-full skx-mode-effects', handle, refresh: render, rows: GRAPHICS_ROWS };
  },
};
