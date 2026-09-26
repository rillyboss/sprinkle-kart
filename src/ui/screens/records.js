/**
 * Records — the best race and best lap on every track (one cup per page),
 * with the racer who set them. Reached from mode select (menuEntry
 * where: 'mode-select'); B goes back. OWNER: modes + timing workstream.
 */
import { groupTracksByCup } from '../../data/cups.js';
import { el, escapeHtml, hint, kbd, floatiesLayer } from '../dom.js';
import { cssColor, lighten } from '../hudLogic.js';
import { recordHolders, recordRows, recordCount } from '../../modes/recordHolders.js';
import { createRecordsState, recordsReduce } from '../../modes/menus.js';
import { hintsBar, backButton, trackArt, lockHint } from './_shared.js';
import { portraitFor, nameOf } from './_modes.js';

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'records',
  menuEntry: { label: 'Records', emoji: '🏆', order: 10, where: 'mode-select' },
  mount(ctx, nav, params = {}) {
    const groups = recordRows(groupTracksByCup(ctx.tracks), {
      getRecord: (id) => ctx.progress?.getRecord?.(id) ?? { bestRace: null, bestLap: null },
      holder: (id, kind, time) => recordHolders.holder(id, kind, time),
      isLocked: (t) => ctx.isTrackLocked(t),
    });
    let state = createRecordsState(groups.length);
    const total = recordCount(groups);

    const cell = (time, text, by, icon) => {
      if (time == null) return `<span class="sk-rec-cell sk-rec-none">${icon} <em>not yet!</em></span>`;
      const who = by ? `${portraitFor(ctx, by, 'sk-rec-portrait')}<span class="sk-rec-who">${escapeHtml(nameOf(ctx, by))}</span>` : '';
      return `<span class="sk-rec-cell">${icon} <b>${text}</b>${who}</span>`;
    };
    const pages = groups.map((g) => el('div.sk-rec-page', {}, g.rows.map((r, i) => {
      const base = cssColor(r.track.previewColor, '#ffa6d8');
      const art = trackArt(r.track);
      return el(`div.sk-rec-row${r.locked ? '.sk-rec-locked' : ''}`, {
        '--c1': lighten(base, 0.55), '--c2': base, '--i': i,
        html: `<span class="sk-rec-art">${art[0]}</span>`
          + `<span class="sk-rec-track">${escapeHtml(r.track.name)}${r.locked ? `<small>🔒 ${escapeHtml(lockHint(r.track, { short: true }))}</small>` : ''}</span>`
          + cell(r.bestRace, r.raceText, r.raceBy, '🏁')
          + cell(r.bestLap, r.lapText, r.lapBy, '🔁'),
      });
    })));
    const tabs = groups.map((g, gi) => el('button.sk-cup-tab', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'page', value: gi }); },
      html: `<span class="sk-cup-e">${g.cup?.emoji ?? '🏁'}</span><span class="sk-cup-n">${escapeHtml(g.cup?.name ?? 'More tracks')}</span>`,
    }));

    const node = el('div.sk-screen.sk-records', {},
      floatiesLayer(18, 61),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Super speedy records! <span class="sk-wiggle">🏆</span>' })),
      el('p.sk-lead', { html: total ? `${total} track${total === 1 ? '' : 's'} with a record so far. Can you beat them?` : 'No records yet — every finish sets one! ⏱️' }),
      tabs.length > 1 ? el('div.sk-cupbar', {}, tabs) : null,
      el('div.sk-rec-head', { html: '<span></span><span>Track</span><span>🏁 Best race</span><span>🔁 Best lap</span>' }),
      el('div.sk-rec-body', {}, pages),
      hintsBar([
        groups.length > 1 ? `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Cups</span></span>` : '',
        hint('B', 'Esc', 'Back'),
      ]),
    );

    const sync = () => {
      pages.forEach((p, i) => { p.hidden = i !== state.page; });
      tabs.forEach((t, i) => t.classList.toggle('sk-sel', i === state.page));
    };
    const handle = (ev) => {
      const res = recordsReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      sync();
      if (res.go === 'back') nav.goto(params.returnTo ?? 'mode-select');
    };
    sync();
    return { node, cls: 'sk-mode-full', handle };
  },
};
