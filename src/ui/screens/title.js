/**
 * Title screen — "Press A!". The device that presses first becomes P1.
 * Flow order 10 (first). Screens with a `menuEntry` (see ../screenFlow.js
 * menuEntries) appear as a small button row under "Press A": Down focuses it,
 * Left/Right choose, A opens (with params { returnTo: 'title' }), Up/B go back.
 */
import * as S from '../menuState.js';
import { el, glyph, kbd, floatiesLayer, escapeHtml } from '../dom.js';
import { menuEntries, titleFocusReduce } from '../screenFlow.js';

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'title',
  flow: { order: 10 },
  mount(ctx, nav) {
    let wins = 0;
    try { wins = ctx.progress?.loadProgress?.()?.wins ?? 0; } catch { /* ignore */ }
    const letters = (word, off) => [...word].map((ch, i) => `<span style="--i:${i + off}">${ch}</span>`).join('');
    const sprinkles = Array.from({ length: 14 }, (_, i) => {
      const colors = ['#ff5fb4', '#6cc4ff', '#ffd95e', '#6fe3bf', '#b48cff', '#ff9f80'];
      const a = (i / 14) * Math.PI * 2;
      const x = 50 + Math.cos(a) * (46 + (i % 3) * 3);
      const y = 50 + Math.sin(a) * (40 + (i % 2) * 8);
      return `<i class="sk-logo-sprinkle" style="left:${x}%;top:${y}%;--r:${(i * 47) % 180}deg;--c:${colors[i % colors.length]};--i:${i}"></i>`;
    }).join('');

    const entries = menuEntries(ctx.screens, 'title');
    let focus = -1;
    const chips = entries.map((en, i) => el('button.sk-title-entry', {
      onclick: (e) => { e.stopPropagation(); openEntry(i); },
      html: `${en.emoji ? `<span>${escapeHtml(en.emoji)}</span> ` : ''}${escapeHtml(en.label)}`,
    }));
    const showFocus = () => chips.forEach((c, i) => c.classList.toggle('sk-focus', i === focus));
    function openEntry(i) {
      ctx.sfx('confirm');
      nav.goto(entries[i].id, { returnTo: 'title' });
    }

    const handle = (ev) => {
      const r = titleFocusReduce(focus, ev.action, entries.length);
      if (r.open !== null) { openEntry(r.open); return; }
      if (r.focus !== focus) { focus = r.focus; ctx.sfx('move'); showFocus(); return; }
      if (r.play) {
        ctx.sfx('confirm');
        const dev = ev.deviceId === 'mouse' ? 'kb1' : ev.deviceId;
        // The device that pressed A becomes P1 straight away.
        const d = ctx.draft;
        if (!d.joinState.players.some((p) => p.deviceId === dev)) {
          d.joinState = S.joinReduce(d.joinState, { deviceId: dev, action: 'confirm' }).state;
        }
        nav.next();
      }
    };
    const node = el('div.sk-screen.sk-title', { onclick: () => handle({ deviceId: 'mouse', action: 'confirm' }) },
      floatiesLayer(34, 11),
      el('div.sk-logo-wrap', {},
        el('div.sk-logo', {
          html: `${sprinkles}<div class="sk-logo-line sk-logo-1">${letters('Sprinkle', 0)}</div>`
            + `<div class="sk-logo-line sk-logo-2">${letters('Kart', 8)}<span class="sk-logo-kart">🏎️</span></div>`,
        }),
        el('div.sk-subtitle', { html: 'made with <b>Sophia</b> <span class="sk-beat">💖</span>' }),
      ),
      el('div.sk-press', { html: `Press ${glyph('A')} or ${kbd('Enter')}!` }),
      chips.length ? el('div.sk-title-entries', {}, ...chips) : null,
      wins > 0 ? el('div.sk-wins', { html: `🏆 × ${wins} <span>trophies won</span>` }) : null,
      el('div.sk-title-karts', { 'aria-hidden': 'true', html: '<span>🍭</span><span>🧁</span><span>🍬</span>' }),
    );
    return { node, cls: 'sk-mode-full', handle };
  },
};
