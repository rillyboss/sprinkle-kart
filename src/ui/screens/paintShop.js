/**
 * Paint Shop 🎨 — reached from the title screen's menu row. Pick a racer (top
 * row), pick a paint (bottom row) and see the whole kart in its new colour.
 * Saved straight away; every race after that uses it (src/modes/paint.js).
 * OWNER: showcase features & modes.
 */
import '../../modes/showcase.css';
import { el, escapeHtml, hint, kbd, floatiesLayer } from '../dom.js';
import { renderPortraits } from '../../render/portraits.js';
import {
  PAINTS, getPaint, paintedDef, paintStore, createPaintShopState, paintShopReduce, currentRacer, currentPaint, paintIndex,
} from '../../modes/paint.js';
import { backButton, hintsBar, keepVisible } from './_shared.js';
import { portraitFor } from './_modes.js';

const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0')}`;

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'paint-shop',
  menuEntry: { label: 'Paint Shop', emoji: '🎨', order: 70 },
  mount(ctx, nav, params = {}) {
    const d = ctx.draft;
    const racers = ctx.characters.filter((c) => { try { return !ctx.isLocked(c); } catch { return true; } });
    const store = (() => { try { return paintStore(); } catch { return null; } })();
    let saved = {};
    try { saved = store?.load() ?? {}; } catch { /* ignore */ }
    const preferred = d.previous?.players?.[0]?.characterId ?? d.charPicks?.[0]?.characterId ?? null;
    let state = createPaintShopState({ racerIds: racers.map((c) => c.id), paints: saved, racerId: preferred, controllerId: d.joinState?.players?.[0]?.deviceId ?? null });
    const leave = () => nav.goto(params.returnTo ?? 'title');

    // --- the big preview (a real render of the painted kart, cached per racer + paint) ---
    const previews = new Map();
    const img = el('img.skps-img', { alt: '' });
    const spinner = el('div.skps-wait', { html: '🎨' });
    const nameEl = el('div.skps-name');
    const paintEl = el('div.skps-paint');
    const preview = el('div.skps-preview', {}, el('div.skps-stage', {}, img, spinner), nameEl, paintEl);
    let wanted = '';
    let timer = null;
    let alive = true;
    const showPreview = () => {
      const id = currentRacer(state);
      const paint = currentPaint(state);
      const key = `${id}|${paint}`;
      wanted = key;
      const url = previews.get(key);
      if (url) { img.src = url; img.hidden = false; spinner.hidden = true; return; }
      img.hidden = !img.src;
      img.classList.add('skps-stale');
      spinner.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const def = ctx.char(id);
        if (!def || !alive) return;
        let map = null;
        try { map = await renderPortraits([paintedDef(def, paint)], 320, { framing: 'full' }); } catch { map = null; }
        const src = map?.get(id) ?? '';
        if (src) previews.set(key, src);
        if (!alive || wanted !== key) return;
        if (src) { img.src = src; img.hidden = false; }
        img.classList.remove('skps-stale');
        spinner.hidden = true;
      }, 140);
    };

    // --- racer row + paint row ---
    const racerBtns = racers.map((c, i) => el('button.skps-racer', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'racer', value: i }); },
      html: portraitFor(ctx, c.id, 'skps-portrait') + '<i class="skps-dot"></i>',
    }));
    const paintBtns = PAINTS.map((p, i) => el('button.skps-pot', {
      title: p.name,
      style: p.color === null ? '' : `--pc:${hex(p.color)}`,
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'paint', value: i }); },
      html: `<span class="skps-blob${p.color === null ? ' skps-blob-orig' : ''}"></span><span class="skps-pot-e">${p.emoji}</span>`,
    }));
    const racerRow = el('div.skps-row.skps-racers', {}, racerBtns);
    const paintRow = el('div.skps-row.skps-pots', {}, paintBtns);

    const node = el('div.sk-screen.skps-screen', {},
      floatiesLayer(14, 29),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Paint Shop <span class="sk-wiggle">🎨</span>' }),
        el('div.sk-chooser', { html: 'Pick a racer, then a paint!' })),
      el('div.skps-body', {},
        preview,
        el('div.skps-side', {},
          el('div.skps-label', { html: '1 · Racer' }), racerRow,
          el('div.skps-label', { html: '2 · Paint' }), paintRow)),
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('A', 'Enter', 'Next / Done'),
        hint('Y', 'Tab', 'Original'),
        hint('B', 'Esc', 'Back'),
      ]),
    );

    const sync = () => {
      const id = currentRacer(state);
      const def = ctx.char(id);
      const paint = getPaint(currentPaint(state));
      racerBtns.forEach((b, i) => {
        b.classList.toggle('sk-sel', i === state.racer);
        b.classList.toggle('skps-focus', i === state.racer && state.row === 0);
        const p = getPaint(state.pick[racers[i].id]);
        b.style.setProperty('--pc', p?.color == null ? 'transparent' : hex(p.color));
        b.classList.toggle('skps-painted', !!p && p.color !== null);
      });
      const pi = paintIndex(state);
      paintBtns.forEach((b, i) => {
        b.classList.toggle('sk-sel', i === pi);
        b.classList.toggle('skps-focus', i === pi && state.row === 1);
      });
      racerRow.classList.toggle('skps-row-on', state.row === 0);
      paintRow.classList.toggle('skps-row-on', state.row === 1);
      nameEl.textContent = def?.name ?? '';
      paintEl.innerHTML = paint ? `${paint.emoji} ${escapeHtml(paint.name)}` : '';
      if (racerBtns[state.racer]) keepVisible(racerBtns[state.racer]);
      showPreview();
    };

    const handle = (ev) => {
      const res = paintShopReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      if (res.changed) {
        try { store?.set(res.changed.racerId, res.changed.paintId); } catch { /* ignore */ }
      }
      sync();
      if (res.go === 'back') leave();
    };

    sync();
    return {
      node,
      cls: 'sk-mode-full',
      handle,
      destroy() { alive = false; clearTimeout(timer); },
    };
  },
};
