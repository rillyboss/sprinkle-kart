/**
 * "Choose a track!" — P1 picks a track (grouped by cup, one cup per page),
 * the speed class and the laps. Locked tracks show a padlock and their
 * unlock hint and can't be raced. Flow order 40 (last: it finishes the flow).
 */
import * as S from '../menuState.js';
import { SPEED_CLASSES } from '../../config.js';
import { groupTracksByCup } from '../../data/cups.js';
import { el, escapeHtml, glyph, kbd, hint, floatiesLayer } from '../dom.js';
import { cssColor, lighten, trackOutlinePoints } from '../hudLogic.js';
import { pc, hintsBar, backButton, shake, trackArt, lockHint, SPEED_HINT } from './_shared.js';

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'track-select',
  flow: { order: 40 },
  mount(ctx, nav) {
    const d = ctx.draft;
    // Cup pages, in cup order; the flat list below is what the reducer indexes.
    const groups = groupTracksByCup(ctx.tracks);
    const tracks = groups.flatMap((g) => g.tracks);
    const sizes = groups.map((g) => g.tracks.length);
    const paged = groups.length > 1;
    const p1 = d.joinState.players[0];
    let state = S.createTrackSelectState({
      tracks,
      previous: d.trackPrev,
      controllerId: p1?.deviceId ?? null,
      easyDrive: d.joinState.players.some((p) => p.easyDrive),
      isLocked: (t) => ctx.isTrackLocked(t),
    });
    let trophies = {};
    try { trophies = ctx.progress?.loadProgress?.()?.trophies ?? {}; } catch { /* ignore */ }

    const cards = tracks.map((t, i) => {
      const locked = state.locked[i];
      const base = cssColor(t.previewColor, '#ffa6d8');
      const art = trackArt(t);
      const outline = trackOutlinePoints(t.controlPoints, 100, 60, 0.1);
      const cups = trophies[t.id] ? `<div class="sk-card-cup">🏆 ${trophies[t.id]}</div>` : '';
      const card = el('button.sk-card', {
        '--c1': lighten(base, 0.55),
        '--c2': base,
        '--c3': lighten(base, 0.2),
        onclick: (e) => {
          e.stopPropagation();
          if (state.trackIndex === i) handle({ deviceId: 'mouse', action: 'confirm' });
          else handle({ deviceId: 'mouse', action: 'set', key: 'trackIndex', value: i });
        },
        html: `<div class="sk-card-art"><span class="a1">${art[0]}</span><span class="a2">${art[1]}</span><span class="a3">${art[2]}</span>`
          + (outline ? `<svg viewBox="0 0 100 60" class="sk-card-map"><polygon points="${outline}"/></svg>` : '')
          + (locked ? '<div class="sk-card-lock">🔒</div>' : '')
          + `</div>${cups}<div class="sk-card-name">${escapeHtml(t.name)}</div>`
          + `<div class="sk-card-sub">${escapeHtml(locked ? lockHint(t) : (t.subtitle ?? ''))}</div>`,
      });
      if (locked) card.classList.add('sk-card-locked');
      return card;
    });

    // One `.sk-cards` row per cup page; only the current page is shown.
    const pages = groups.map((g, gi) => {
      const start = sizes.slice(0, gi).reduce((a, n) => a + n, 0);
      return el('div.sk-cards', { 'data-cup': g.cup?.id ?? 'other' }, cards.slice(start, start + g.tracks.length));
    });
    const tabs = paged
      ? groups.map((g, gi) => el('button.sk-cup-tab', {
        onclick: (e) => {
          e.stopPropagation();
          const start = sizes.slice(0, gi).reduce((a, n) => a + n, 0);
          handle({ deviceId: 'mouse', action: 'set', key: 'trackIndex', value: start });
        },
        html: `<span class="sk-cup-e">${g.cup?.emoji ?? '🏁'}</span><span class="sk-cup-n">${escapeHtml(g.cup?.name ?? 'More tracks')}</span>`,
      }))
      : [];
    const cupBar = paged ? el('div.sk-cupbar', {}, tabs) : null;
    const trackRow = el('div.sk-track-row', {}, cupBar, pages);

    const speedPills = S.SPEED_ORDER.map((id, i) => {
      const sc = SPEED_CLASSES[id] ?? { name: id, emoji: '' };
      return el('button.sk-pill', {
        onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'speedIndex', value: i }); },
        html: `<span class="sk-pill-e">${sc.emoji}</span><span class="sk-pill-t">${escapeHtml(sc.name)}<small>${SPEED_HINT[id] ?? ''}</small></span>`,
      });
    });
    const lapPills = S.LAP_OPTIONS.map((n, i) => el('button.sk-pill.sk-pill-num', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'lapsIndex', value: i }); },
      html: `<b>${n}</b>`,
    }));
    const goBtn = el('button.sk-bigbtn.sk-race', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'confirm' }); },
      html: `<span>Let's race!</span> <span class="sk-flag">🏁</span> <span class="sk-go-k">${glyph('A')}</span>`,
    });

    const rowEls = [
      paged ? trackRow : pages[0],
      el('div.sk-optrow', {}, el('div.sk-optlabel', { html: 'Speed' }), el('div.sk-pills', {}, speedPills)),
      el('div.sk-optrow', {}, el('div.sk-optlabel', { html: 'Laps' }), el('div.sk-pills', {}, lapPills)),
      el('div.sk-gorow', {}, goBtn),
    ];

    const node = el('div.sk-screen.sk-tracks', {},
      floatiesLayer(20, 13),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Choose a track! <span class="sk-wiggle">🗺️</span>' }),
        el('div.sk-chooser', { html: `<b class="sk-tag" style="--pc:${pc(0)}">P1</b> is choosing — everyone else, cheer! 📣` })),
      ...rowEls,
      hintsBar([
        hint('A', 'Enter', 'Race!'),
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('Y', 'Tab', 'Speed'),
        hint('B', 'Esc', 'Back'),
      ]),
    );

    const sync = () => {
      cards.forEach((c, i) => c.classList.toggle('sk-sel', i === state.trackIndex));
      speedPills.forEach((c, i) => c.classList.toggle('sk-sel', i === state.speedIndex));
      lapPills.forEach((c, i) => c.classList.toggle('sk-sel', i === state.lapsIndex));
      rowEls.forEach((r, i) => r.classList.toggle('sk-row-focus', i === state.row));
      const { page } = S.pageForIndex(sizes, state.trackIndex);
      pages.forEach((p, i) => { p.hidden = i !== page; });
      tabs.forEach((t, i) => t.classList.toggle('sk-sel', i === page));
    };

    const handle = (ev) => {
      const res = S.trackSelectReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      if (res.shake === 'track') shake(cards[state.trackIndex]);
      sync();
      if (res.go === 'next') {
        d.trackPrev = S.trackSelection(state, tracks);
        nav.finish(S.buildRaceSetup(d.joinState, d.charState, state, tracks));
      } else if (res.go === 'back') {
        d.trackPrev = S.trackSelection(state, tracks);
        nav.back();
      }
    };

    sync();
    return { node, cls: 'sk-mode-full', handle };
  },
};
