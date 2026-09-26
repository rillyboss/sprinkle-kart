/**
 * "Build My Cup!" ✨ — the Custom Cup builder (reached from the "My Cup" card
 * on cup select). Pick any 4 unlocked tracks in your own order; the 4 slots
 * at the top fill up as you pick; Start (or the big button) races them as a
 * Grand Prix. The last custom cup is remembered.
 * Logic: src/modes/myCup.js (myCupReduce). OWNER: showcase features & modes.
 */
import '../../modes/showcase.css';
import * as S from '../menuState.js';
import { el, escapeHtml, glyph, kbd, hint, floatiesLayer } from '../dom.js';
import { cssColor, lighten, trackOutlinePoints } from '../hudLogic.js';
import { groupTracksByCup } from '../../data/cups.js';
import { createMyCupState, myCupReduce, myCupReady, myCupStore, myCupSetup, MY_CUP_SIZE } from '../../modes/myCup.js';
import { pc, hintsBar, backButton, shake, trackArt, keepVisible } from './_shared.js';

const COLS = 5;

/** Players for the cup (same as cup select). */
function cupPlayers(draft) {
  const picks = draft.charState ? S.charSelections(draft.charState) : [];
  return draft.joinState.players.map((p) => ({
    playerIndex: p.playerIndex,
    deviceId: p.deviceId,
    characterId: picks.find((q) => q.playerIndex === p.playerIndex)?.characterId
      ?? draft.charPicks?.find((q) => q.playerIndex === p.playerIndex)?.characterId,
    easyDrive: p.easyDrive,
  }));
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'my-cup',
  mount(ctx, nav, params = {}) {
    const d = ctx.draft;
    const groups = groupTracksByCup(ctx.tracks);
    const tracks = groups.flatMap((g) => g.tracks.map((t) => ({ def: t, cup: g.cup }))).filter((x) => !x.def.placeholder && !ctx.isTrackLocked(x.def));
    const store = (() => { try { return myCupStore(); } catch { return null; } })();
    let remembered = [];
    try { remembered = d.myCup ?? store?.load() ?? []; } catch { /* ignore */ }
    let state = createMyCupState({ trackIds: tracks.map((x) => x.def.id), picks: remembered, cols: COLS, controllerId: d.joinState.players[0]?.deviceId ?? null });
    const byId = new Map(tracks.map((x) => [x.def.id, x]));
    const leave = () => nav.goto(params.returnTo ?? 'cup-select');

    const cardHtml = (def, big = false) => {
      const base = cssColor(def.previewColor, '#ffa6d8');
      const art = trackArt(def);
      const outline = def.controlPoints ? trackOutlinePoints(def.controlPoints, 100, 60, 0.12) : '';
      return { base, html: `<div class="skc-art" style="--c1:${lighten(base, 0.55)};--c2:${base}">${outline ? `<svg viewBox="0 0 100 60" aria-hidden="true"><polygon points="${outline}"/></svg>` : ''}<span class="a1">${art[0]}</span>${big ? `<span class="a2">${art[1]}</span>` : ''}</div>` };
    };

    const slots = Array.from({ length: MY_CUP_SIZE }, (_, i) => el('div.skc-slot', { '--i': i }));
    const cards = tracks.map((x, i) => el('button.skc-card', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'pick', index: i }); },
      html: `${cardHtml(x.def).html}<div class="skc-name">${escapeHtml(x.def.name)}</div><div class="skc-cup">${x.cup?.emoji ?? '🏁'}</div><div class="skc-badge"></div>`,
    }));
    const goBtn = el('button.sk-bigbtn.sk-race.skc-go', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'start' }); },
      html: `<span>Start My Cup!</span> <span class="sk-flag">🏆</span> <span class="sk-go-k">${glyph('A')}</span>`,
    });
    const slotRow = el('div.skc-slots', {}, slots, goBtn);
    const grid = el('div.skc-grid', { '--cols': COLS }, cards);

    const node = el('div.sk-screen.skc-builder', {},
      floatiesLayer(18, 83),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Build My Cup! <span class="sk-wiggle">✨</span>' }),
        el('div.sk-chooser', { html: `<b class="sk-tag" style="--pc:${pc(0)}">P1</b> picks ${MY_CUP_SIZE} tracks — any order!` })),
      slotRow,
      grid,
      hintsBar([
        hint('A', 'Enter', 'Add / take out'),
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('Y', 'Tab', 'Undo'),
        hint('B', 'Esc', 'Back'),
      ]),
    );

    let lastCursor = -1;
    const sync = () => {
      slots.forEach((s, i) => {
        const id = state.picks[i];
        const x = id ? byId.get(id) : null;
        s.classList.toggle('skc-slot-full', !!x);
        s.innerHTML = x
          ? `<span class="skc-num">${i + 1}</span>${cardHtml(x.def, true).html}<div class="skc-name">${escapeHtml(x.def.name)}</div>`
          : `<span class="skc-num">${i + 1}</span><div class="skc-empty">?</div>`;
      });
      cards.forEach((c, i) => {
        const at = state.picks.indexOf(state.trackIds[i]);
        c.classList.toggle('sk-sel', i === state.cursor && state.focus === 'grid');
        c.classList.toggle('skc-picked', at >= 0);
        c.querySelector('.skc-badge').textContent = at >= 0 ? String(at + 1) : '';
      });
      goBtn.classList.toggle('sk-disabled', !myCupReady(state));
      goBtn.classList.toggle('skc-ready', myCupReady(state));
      goBtn.classList.toggle('sk-sel', state.focus === 'go');
      if (state.cursor !== lastCursor) { lastCursor = state.cursor; keepVisible(cards[state.cursor]); }
    };

    const handle = (ev) => {
      const res = myCupReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      if (res.shake === 'slots') shake(slotRow);
      if (res.shake === 'go') shake(goBtn);
      d.myCup = [...state.picks];
      sync();
      if (res.go === 'go') {
        try { store?.save(state.picks); } catch { /* ignore */ }
        nav.finish(myCupSetup(cupPlayers(d), state.picks, d.trackPrev?.speedClass ?? 'zippy'));
      } else if (res.go === 'back') {
        leave();
      }
    };

    sync();
    return { node, cls: 'sk-mode-full', handle };
  },
};
