/**
 * "My Sticker Book" — the Collection screen (a title-screen menu entry).
 * Pages: Racers (all 21, locked ones as silhouettes with a friendly hint and
 * a progress bar), Tracks (all 20 by cup, with trophies / best places / best
 * times) and Our totals (family stats). Fully controller-navigable:
 * arrows move, Y / Tab flips the page, Up from the top row reaches the tabs,
 * B goes back. Logic: src/progress/screenState.js (bookReduce) + collection.js.
 * OWNER: progression/unlocks workstream.
 */
import './progress.css';
import { el, escapeHtml, hint, portraitHtml, floatiesLayer, kbd } from '../dom.js';
import { cssColor, lighten, formatTime, trackOutlinePoints } from '../hudLogic.js';
import { hintsBar, backButton, shake, keepVisible, trackArt, lockHint } from './_shared.js';
import { bookModel, medalEmoji } from '../../progress/collection.js';
import { createBookState, bookReduce, BOOK_TABS } from '../../progress/screenState.js';
import { STAT_BOOK, TURBO_BOOK, ordinalText } from '../../progress/progressText.js';
import { unlockDetail } from '../../progress/describeUnlock.js';
import { barHtml } from './unlock.js';

const TAB_LABELS = { racers: ['💞', 'Racers'], tracks: ['🗺️', 'Tracks'], stats: ['📊', 'Our totals'] };
const RACER_COLS = 7;
const TRACK_COLS = 4;

const n = (v) => (Number.isFinite(v) ? v : 0);
const many = (k, one, lots) => `${k} ${k === 1 ? one : lots}`;

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'collection',
  menuEntry: { label: 'Sticker Book', emoji: '📒', order: 80 },
  mount(ctx, nav, params = {}) {
    let p = null;
    try { p = ctx.progress?.loadProgress?.() ?? null; } catch { /* ignore */ }
    const book = bookModel(p || {}, { characters: ctx.characters, tracks: ctx.tracks });
    let state = createBookState({ racers: book.racers.length, tracks: book.tracks.length, racerCols: RACER_COLS, trackCols: TRACK_COLS, tab: params.tab ?? 0 });
    const leave = () => nav.goto(params.returnTo ?? 'title');

    /* ---------- racer stickers ---------- */
    const racerEls = book.racers.map((r, i) => {
      const pic = r.def
        ? portraitHtml(r.def, ctx.portraits, { cls: 'skp-sticker-portrait' })
        : '<div class="sk-portrait sk-portrait-locked skp-sticker-portrait"><span class="sk-q">?</span></div>';
      const bar = !r.open && r.info && r.info.target > 1 ? barHtml(r.info.ratio, r.info.count, 'skp-bar-mini') : '';
      return el(`button.skp-sticker${r.open ? '' : '.skp-locked'}`, {
        '--i': i,
        '--tilt': `${((i * 37) % 7) - 3}deg`,
        onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'pick', index: i }); },
        html: `<div class="skp-sticker-pic${r.open ? '' : ' skp-silhouette'}">${pic}${r.open ? '' : '<span class="skp-lock">🔒</span>'}</div>`
          + `<div class="skp-sticker-name">${r.open ? escapeHtml(r.name) : '???'}</div>${bar}`,
      });
    });
    const racerPage = el('div.skp-page.skp-page-racers', { '--cols': RACER_COLS }, el('div.skp-grid', {}, racerEls));

    /* ---------- track stickers (one row per cup) ---------- */
    const trackEls = [];
    const cupRows = book.cups.map((cup) => {
      const cells = cup.trackIds.map((id) => {
        const i = book.tracks.findIndex((t) => t.id === id);
        const t = book.tracks[i];
        const base = cssColor(t.def?.previewColor, '#d9c9f0');
        const art = t.def ? trackArt(t.def) : ['🚧', '🍬', '✨'];
        const outline = t.def?.controlPoints ? trackOutlinePoints(t.def.controlPoints, 100, 60, 0.12) : '';
        const medal = medalEmoji(t.tally.bestPlace);
        const b = el(`button.skp-tsticker${t.open ? '' : '.skp-locked'}`, {
          '--c1': lighten(base, 0.55),
          '--c2': base,
          '--tilt': `${((i * 29) % 5) - 2}deg`,
          onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'pick', index: i }); },
          html: `<div class="skp-tart">${outline ? `<svg viewBox="0 0 100 60"><polygon points="${outline}"/></svg>` : ''}`
            + `<span class="a1">${t.open ? art[0] : '🔒'}</span>${t.open ? `<span class="a2">${art[1]}</span>` : ''}</div>`
            + `<div class="skp-tname">${escapeHtml(t.name)}</div>`
            + (!t.open && t.info && t.info.target > 1 ? barHtml(t.info.ratio, t.info.count, 'skp-bar-mini') : '')
            + (medal ? `<div class="skp-medal">${medal}</div>` : '')
            + (t.trophies ? `<div class="skp-trophies">🏆${t.trophies}</div>` : ''),
        });
        trackEls[i] = b;
        return b;
      });
      const cupMedal = cup.wins ? '🏆' : medalEmoji(cup.bestPlace);
      return el('div.skp-cuprow', {},
        el('div.skp-cup', { html: `<span class="skp-cup-e">${cup.emoji}</span><span class="skp-cup-n">${escapeHtml(cup.name)}</span>${cupMedal ? `<span class="skp-cup-m">${cupMedal}</span>` : ''}` }),
        el('div.skp-cupcells', {}, cells));
    });
    const trackPage = el('div.skp-page.skp-page-tracks', {}, cupRows);

    /* ---------- totals ---------- */
    const statTiles = STAT_BOOK.map(([key, emoji, label], i) => el('div.skp-stat', {
      '--i': i,
      html: `<span class="skp-stat-e">${emoji}</span><b>${n(book.stats[key])}</b><span class="skp-stat-l">${escapeHtml(label)}</span>`,
    }));
    const turbos = TURBO_BOOK.map(([key, emoji, label]) => `<span class="skp-turbo">${emoji} ${escapeHtml(label)} <b>${n(book.stats[key])}</b></span>`).join('');
    const cupsLine = book.cups.map((c) => `<span class="skp-cupstat">${c.emoji} ${c.wins ? `🏆×${c.wins}` : c.bestPlace ? `${medalEmoji(c.bestPlace)} ${ordinalText(c.bestPlace)}` : '—'}</span>`).join('');
    const statsPage = el('div.skp-page.skp-page-stats', {},
      el('div.skp-stats', {}, statTiles),
      el('div.skp-statline', { html: `<span class="skp-statline-k">Drift turbos</span>${turbos}` }),
      el('div.skp-statline', { html: `<span class="skp-statline-k">Grand Prix cups</span>${cupsLine}` }),
    );
    const pages = [racerPage, trackPage, statsPage];

    /** "Favourite racer / track" cards for the totals page ('' before the first race). */
    const favourites = () => {
      const top = (list, score) => list.filter((x) => score(x) > 0).sort((a, b) => score(b) - score(a))[0] ?? null;
      const racer = top(book.racers, (r) => r.tally.races * 10 + r.tally.wins);
      const track = top(book.tracks, (t) => t.tally.finishes * 10 + t.tally.wins);
      const rows = [];
      if (racer) {
        rows.push(`<div class="skp-d-fav">${portraitHtml(racer.def, ctx.portraits)}<span>Favourite racer<small>${escapeHtml(racer.name)} · ${many(racer.tally.races, 'race', 'races')}</small></span></div>`);
      }
      if (track) {
        const medal = medalEmoji(track.tally.bestPlace) || '🏁';
        rows.push(`<div class="skp-d-fav"><span class="skp-stat-e">${medal}</span><span>Favourite track<small>${escapeHtml(track.name)} · ${many(track.tally.finishes, 'race', 'races')}</small></span></div>`);
      }
      return rows.length ? `<div class="skp-d-favs">${rows.join('')}</div>` : '';
    };

    /* ---------- detail panel ---------- */
    const panel = el('div.skp-detail');
    const renderDetail = () => {
      const tab = BOOK_TABS[state.tab];
      if (tab === 'stats') {
        const pct = book.total ? book.stickers / book.total : 0;
        panel.innerHTML = '<div class="skp-d-big">📒</div>'
          + `<div class="skp-d-name">${book.stickers} of ${book.total} stickers</div>`
          + barHtml(pct, `${Math.round(pct * 100)}%`, 'skp-bar-panel')
          + `<div class="skp-d-line">${book.stickers >= book.total ? 'You found them ALL! Superstar! 🌈' : 'Every race fills your book a little more! ✨'}</div>`
          + (book.unlockAll ? '<div class="skp-d-note">A grown-up opened every page 🎁</div>' : '')
          + favourites();
        return;
      }
      const item = tab === 'racers' ? book.racers[state.index[0]] : book.tracks[state.index[1]];
      if (!item) { panel.innerHTML = ''; return; }
      const kind = item.kind;
      let pic;
      if (kind === 'character') {
        pic = item.def
          ? `<div class="skp-d-pic${item.open ? '' : ' skp-silhouette'}">${portraitHtml(item.def, ctx.portraits, { cls: 'skp-d-portrait' })}</div>`
          : '<div class="skp-d-pic"><div class="sk-portrait sk-portrait-locked skp-d-portrait"><span class="sk-q">?</span></div></div>';
      } else {
        const base = cssColor(item.def?.previewColor, '#d9c9f0');
        const art = item.def ? trackArt(item.def) : ['🚧', '🍬', '✨'];
        pic = `<div class="skp-d-card${item.open ? '' : ' skp-locked'}" style="--c1:${lighten(base, 0.55)};--c2:${base}">`
          + `<span class="a1">${item.open ? art[0] : '🔒'}</span><span class="a2">${art[1]}</span><span class="a3">${art[2]}</span></div>`;
      }
      const cup = kind === 'track' ? book.cups.find((c) => c.id === item.cup) : null;
      let body = '';
      if (!item.built) body += '<div class="skp-d-soon">Coming soon! 🚧</div>';
      if (kind === 'character' && item.open && item.def?.tagline) body += `<div class="skp-d-tag">${escapeHtml(item.def.tagline)}</div>`;
      if (kind === 'track' && item.open && item.def?.subtitle) body += `<div class="skp-d-tag">${escapeHtml(item.def.subtitle)}</div>`;
      if (item.open) {
        body += `<div class="skp-d-ok">${item.free ? 'In your book from the start! 💖' : 'Unlocked! In your book ✔'}</div>`;
      } else if (item.info?.done) {
        body += '<div class="skp-d-ready">You did it! Race once more to meet this surprise 🎉</div>';
      } else {
        const hintText = item.def ? lockHint(item.def) : unlockDetail(item.rule, kind).replace(/…$/, '!');
        body += `<div class="skp-d-hint">🔒 ${escapeHtml(hintText)}</div>`;
        if (item.info) body += barHtml(item.info.target > 1 ? item.info.ratio : 0.06, item.info.text || 'Not yet — you can do it!', 'skp-bar-panel');
      }
      if (kind === 'character') {
        const t = item.tally;
        body += `<div class="skp-d-stats"><span>🏁 ${many(t.races, 'race', 'races')}</span><span>🏆 ${many(t.wins, 'win', 'wins')}</span><span>🥉 ${t.podiums} top 3</span></div>`;
        if (item.open && item.def?.quotes?.select) body += `<div class="sk-bubble skp-d-quote">“${escapeHtml(item.def.quotes.select)}”</div>`;
      } else {
        const t = item.tally;
        const best = t.bestPlace ? `${medalEmoji(t.bestPlace)} ${ordinalText(t.bestPlace)}` : '—';
        body += `<div class="skp-d-stats"><span>🏁 ${many(t.finishes, 'finish', 'finishes')}</span><span>🏆 ${many(t.wins, 'win', 'wins')}</span><span>Best ${best}</span></div>`;
        const r = item.record;
        if (r.bestRace || r.bestLap || t.timeTrials) {
          body += `<div class="skp-d-stats skp-d-times">${r.bestRace ? `<span>⏱️ ${formatTime(r.bestRace)}</span>` : ''}${r.bestLap ? `<span>⚡ lap ${formatTime(r.bestLap)}</span>` : ''}${t.timeTrials ? `<span>👻 ${many(t.timeTrials, 'trial', 'trials')}</span>` : ''}</div>`;
        }
      }
      panel.innerHTML = `${pic}<div class="skp-d-name">${escapeHtml(item.open ? item.name : kind === 'character' ? 'Mystery Friend!' : item.name)}</div>`
        + (cup ? `<div class="skp-d-cup">${cup.emoji} ${escapeHtml(cup.name)}</div>` : '')
        + body;
    };

    const tabs = BOOK_TABS.map((id, i) => el('button.skp-tab', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'tab', value: i }); },
      html: `<span>${TAB_LABELS[id][0]}</span> ${TAB_LABELS[id][1]}`,
    }));
    const counter = el('div.skp-counter', { html: `⭐ <b>${book.stickers}</b> / ${book.total} stickers` });

    const node = el('div.sk-screen.skp-book', {},
      floatiesLayer(18, 31),
      el('div.sk-header.skp-head', {},
        backButton(() => { ctx.sfx('back'); leave(); }),
        el('h1.sk-h1', { html: 'My Sticker Book <span class="sk-wiggle">📒</span>' }),
        counter),
      el('div.skp-tabs', {}, tabs),
      el('div.skp-body', {}, el('div.skp-pages', {}, pages), panel),
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Look</span></span>`,
        hint('Y', 'Tab', 'Next page'),
        hint('B', 'Esc', 'Back'),
      ]),
    );

    let lastSel = -1;
    const sync = () => {
      const tab = BOOK_TABS[state.tab];
      pages.forEach((pg, i) => { pg.hidden = i !== state.tab; });
      tabs.forEach((t, i) => {
        t.classList.toggle('sk-sel', i === state.tab);
        t.classList.toggle('skp-focus', i === state.tab && state.focus === 'tabs');
      });
      const grid = tab === 'racers' ? racerEls : tab === 'tracks' ? trackEls : [];
      [...racerEls, ...trackEls].forEach((b) => b.classList.remove('sk-sel'));
      if (state.focus === 'grid' && grid.length) {
        const b = grid[state.index[state.tab]];
        b?.classList.add('sk-sel');
        const sig = state.tab * 100 + state.index[state.tab];
        if (sig !== lastSel) { lastSel = sig; keepVisible(b); }
      }
      renderDetail();
    };

    const handle = (ev) => {
      const res = bookReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      if (res.cheer) {
        const tab = BOOK_TABS[state.tab];
        const item = tab === 'racers' ? book.racers[state.index[0]] : book.tracks[state.index[1]];
        const b = (tab === 'racers' ? racerEls : trackEls)[state.index[state.tab]];
        ctx.sfx(item?.open ? 'sticker' : 'back');
        if (item?.open) {
          b?.classList.remove('skp-boing'); void b?.offsetWidth; b?.classList.add('skp-boing');
          if (item.kind === 'character' && item.def) { try { ctx.audio?.voice?.(item.def, 'select'); } catch { /* ignore */ } }
        } else shake(b);
      }
      sync();
      if (res.go === 'back') leave();
    };

    sync();
    return { node, cls: 'sk-mode-full skp-mode-book', handle, refresh: () => sync() };
  },
};
