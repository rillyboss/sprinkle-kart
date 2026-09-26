/**
 * "Pick your racer!" — every player moves their own cursor over a
 * data-driven grid of the whole roster (locked racers show as "?" with their
 * unlock hint). Big rosters get more columns and a scrolling grid.
 * Flow order 30.
 */
import * as S from '../menuState.js';
import { el, escapeHtml, hint, portraitHtml, floatiesLayer } from '../dom.js';
import { pc, hintsBar, backButton, shake, keepVisible, lockHint, lockDetail, STAT_ROWS } from './_shared.js';
import { lockProgressHtml } from './unlock.js';
import './characterSelect.css';

/** Rosters bigger than this get a scrolling grid. */
const SCROLL_ABOVE = 12;

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'character-select',
  flow: { order: 30 },
  mount(ctx, nav) {
    const d = ctx.draft;
    const players = d.joinState.players;
    let state = S.createCharSelectState({
      players,
      characters: ctx.characters,
      isLocked: (def) => ctx.isLocked(def),
      previous: d.charPicks,
      cols: S.rosterColumns(ctx.characters.length, players.length),
    });
    const solo = players.length === 1;
    const tiles = [];
    const tileSigs = [];
    const many = state.items.length > SCROLL_ABOVE;
    const wide = many && !solo && state.cols > S.gridColumns(state.items.length);
    const grid = el(`div.sk-grid${many ? '.sk-grid-many' : ''}${wide ? '.sk-grid-wide' : ''}`, { '--cols': state.cols });
    state.items.forEach((it, i) => {
      const def = ctx.char(it.id);
      const t = el('button.sk-tile', {
        onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'pick', index: i }); },
        html: `${portraitHtml(def, ctx.portraits, { locked: it.locked })}`
          + `<div class="sk-tile-name">${it.locked ? `🔒 ${escapeHtml(lockHint(def, { short: many }))}` : escapeHtml(def?.name ?? it.id)}</div>`
          + (it.locked ? lockProgressHtml(def, ctx, { cls: 'skp-bar-tile', compact: true }) : '')
          + '<div class="sk-rings"></div>',
      });
      if (it.locked) t.classList.add('sk-tile-locked');
      tiles.push(t);
      grid.appendChild(t);
    });
    // "More friends below!" cue: sticks to the bottom of the scroll box while rows are hidden
    const cue = many ? el('div.sk-grid-cue', { html: '<span>More friends below! ⌄</span>' }) : null;
    if (cue) grid.appendChild(cue);
    const fitGrid = () => fitRosterGrid(grid, tiles, state.cols);
    const onScroll = () => updateGridCue(grid);
    grid.addEventListener?.('scroll', onScroll);

    const panelWrap = el('div.sk-panels');
    const panels = state.cursors.map((c) => {
      const p = el('div.sk-panel', { '--pc': pc(c.playerIndex) });
      panelWrap.appendChild(p);
      return p;
    });
    const panelSigs = [];
    const readyBanner = el('div.sk-ready-banner', { html: 'Everyone\'s ready! 🎉' });

    const keepPicks = () => {
      d.charPicks = state.cursors.map((c) => ({
        playerIndex: c.playerIndex, deviceId: c.deviceId, characterId: state.items[c.index].id,
      }));
    };

    const node = el('div.sk-screen.sk-chars', { class: solo ? 'sk-chars-solo' : `sk-chars-n${players.length}` },
      floatiesLayer(18, 9),
      el('div.sk-header', {},
        backButton(() => { ctx.sfx('back'); keepPicks(); nav.back(); }),
        el('h1.sk-h1', { html: 'Pick your racer! <span class="sk-wiggle">✨</span>' })),
      el('div.sk-chars-body', {}, grid, panelWrap),
      readyBanner,
      hintsBar([
        hint('A', 'Enter', 'Pick'),
        hint('B', 'Esc', 'Undo / Back'),
        `<span class="sk-hint"><span class="sk-hint-t">Friends can pick the same racer too! 💞</span></span>`,
      ]),
    );

    const sync = (force = false) => {
      state.items.forEach((it, i) => {
        const here = state.cursors.filter((c) => c.index === i);
        const sig = here.map((c) => `${c.playerIndex}${c.ready ? 'r' : ''}`).join(',');
        if (!force && tileSigs[i] === sig) return;
        tileSigs[i] = sig;
        tiles[i].classList.toggle('sk-tile-hot', here.length > 0);
        tiles[i].classList.toggle('sk-tile-picked', here.some((c) => c.ready));
        const rings = here.map((c, k) => `<i class="sk-ring ${c.ready ? 'ready' : ''}" style="--pc:${pc(c.playerIndex)};--k:${k}"></i>`).join('');
        const tags = here.map((c) => `<b class="sk-tag ${c.ready ? 'ready' : ''}" style="--pc:${pc(c.playerIndex)}">P${c.playerIndex + 1}${c.ready ? ' ✓' : ''}</b>`).join('');
        tiles[i].querySelector('.sk-rings').innerHTML = `${rings}<div class="sk-tags">${tags}</div>`;
      });
      state.cursors.forEach((c, k) => {
        const it = state.items[c.index];
        const sig = `${c.index}|${c.ready}`;
        if (!force && panelSigs[k] === sig) return;
        const moved = panelSigs[k] !== undefined;
        panelSigs[k] = sig;
        if (moved && state.items.length > SCROLL_ABOVE) keepVisible(tiles[c.index]);
        const def = ctx.char(it.id);
        let body;
        if (it.locked) {
          body = `${portraitHtml(def, ctx.portraits, { locked: true, cls: 'sk-panel-portrait' })}`
            + '<div class="sk-panel-info"><div class="sk-panel-name">Mystery Friend!</div>'
            + `<div class="sk-panel-tag">🔒 ${escapeHtml(lockHint(def))}</div>`
            + `<div class="sk-panel-hint">${escapeHtml(lockDetail(def, 'character'))}</div>`
            + `${lockProgressHtml(def, ctx, { cls: 'skp-bar-panel' })}</div>`;
        } else {
          const stats = STAT_ROWS.map(([key, label, icon]) => {
            const v = Math.max(1, Math.min(5, Math.round(def?.stats?.[key] ?? 3)));
            const pips = Array.from({ length: 5 }, (_, j) => `<i class="${j < v ? 'on' : ''}"></i>`).join('');
            return `<div class="sk-stat"><span class="sk-stat-l">${icon} ${label}</span><span class="sk-pips">${pips}</span></div>`;
          }).join('');
          body = `${portraitHtml(def, ctx.portraits, { cls: 'sk-panel-portrait' })}`
            + `<div class="sk-panel-info"><div class="sk-panel-name">${escapeHtml(def?.name ?? it.id)}</div>`
            + `<div class="sk-panel-tag">${escapeHtml(def?.tagline ?? '')}</div>`
            + (def?.personality ? `<div class="sk-panel-about">${escapeHtml(def.personality)}</div>` : '')
            + (def?.quotes?.select ? `<div class="sk-bubble">“${escapeHtml(def.quotes.select)}”</div>` : '')
            + `<div class="sk-stats">${stats}</div></div>`;
        }
        panels[k].innerHTML = `<div class="sk-panel-p">P${c.playerIndex + 1}</div>${body}`
          + (c.ready ? '<div class="sk-stamp">READY!</div>' : '');
        panels[k].classList.toggle('sk-panel-ready', c.ready);
        if (c.ready) { panels[k].classList.remove('sk-pop'); void panels[k].offsetWidth; panels[k].classList.add('sk-pop'); }
      });
      node.classList.toggle('sk-all-ready', S.allReady(state));
    };

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      d.charState = state;
      keepPicks();
      nav.next();
    };

    let readyTimer = 0;
    const handle = (ev) => {
      if (done) return;
      const disconnected = ctx.devices().filter((x) => x.connected === false).map((x) => x.id);
      const res = S.charSelectReduce(state, ev, { disconnected });
      state = res.state;
      ctx.fx(res);
      if (res.shake != null) {
        const ci = state.cursors.findIndex((c) => c.playerIndex === res.shake);
        shake(panels[ci]);
        shake(tiles[state.cursors[ci]?.index]);
      }
      sync();
      if (S.allReady(state) && readyTimer <= 0) readyTimer = 1.1;
      if (!S.allReady(state)) readyTimer = 0;
      if (res.go === 'next') finish();
      else if (res.go === 'back') { keepPicks(); nav.back(); }
    };

    sync(true);
    let fitted = 0;
    return {
      node,
      cls: 'sk-mode-full',
      handle,
      update: (dt) => {
        // once laid out (and again every ~second, for window resizes): whole rows only + scroll cue
        if (many && (fitted -= dt) <= 0) { fitted = 1; fitGrid(); }
        if (readyTimer > 0) {
          readyTimer -= dt;
          if (readyTimer <= 0 && S.allReady(state)) finish();
        }
      },
      refresh: () => {
        state.items.forEach((it, i) => {
          const def = ctx.char(it.id);
          const old = tiles[i].querySelector('.sk-portrait');
          if (old) old.outerHTML = portraitHtml(def, ctx.portraits, { locked: it.locked });
        });
        sync(true);
      },
      destroy: () => { done = true; grid.removeEventListener?.('scroll', onScroll); },
    };
  },
};

/**
 * Size a scrolling roster grid to a whole number of rows (a row is never cut
 * in half, so every locked card's progress bar shows) and toggle the "more
 * friends" cue. Pure DOM measuring; does nothing before layout (or in tests).
 */
export function fitRosterGrid(grid, tiles, cols) {
  try {
    if (!grid || !tiles?.length || typeof getComputedStyle !== 'function') return;
    const first = tiles[0];
    const next = tiles[cols];
    const cs = getComputedStyle(grid);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    if (next && first.offsetHeight > 0) {
      const rowH = next.offsetTop - first.offsetTop;
      const gap = rowH - first.offsetHeight;
      grid.style.maxHeight = '';
      const room = grid.clientHeight - padT - padB + gap;
      const rows = Math.max(1, Math.floor(room / rowH + 0.02));
      const allRows = Math.ceil(tiles.length / cols);
      if (rows < allRows && rowH > 0) grid.style.maxHeight = `${Math.ceil(rows * rowH - gap + padT + padB)}px`;
    }
    updateGridCue(grid);
  } catch { /* measuring is best effort */ }
}

/** Show the cue while there is more roster below the fold. */
export function updateGridCue(grid) {
  if (!grid) return;
  const more = grid.scrollHeight - grid.clientHeight - grid.scrollTop > 8;
  grid.classList.toggle('sk-grid-more', more);
}
