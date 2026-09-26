/**
 * "Pick an arena!" — Bubble Pop Battle arena select (flow order 40, only when
 * draft.mode === 'battle'; it finishes the flow instead of track select).
 * Arena cards (with the arena's outline), a speed row and a big "Let's pop!"
 * button, plus a little how-to-play strip. Reuses the cup-select reducer
 * (rows: cards / speed / go). OWNER: showcase features & modes.
 */
import '../../modes/showcase.css';
import * as S from '../menuState.js';
import { SPEED_CLASSES } from '../../config.js';
import { el, escapeHtml, glyph, kbd, hint, floatiesLayer } from '../dom.js';
import { cssColor, lighten, trackOutlinePoints } from '../hudLogic.js';
import { ARENAS } from '../../modes/arenas/index.js';
import { BATTLE_BUBBLES, BATTLE_TIME, clockText } from '../../modes/battle.js';
import { createCupSelectState, cupSelectReduce, cupSpeed } from '../../modes/menus.js';
import { pc, hintsBar, backButton, SPEED_HINT } from './_shared.js';

/** The RaceSetup an arena pick finishes the menus with. */
export function arenaRaceSetup(draft, arenaId, speedClass) {
  const picks = draft.charState ? S.charSelections(draft.charState) : [];
  return {
    players: draft.joinState.players.map((p) => ({
      playerIndex: p.playerIndex,
      deviceId: p.deviceId,
      characterId: picks.find((q) => q.playerIndex === p.playerIndex)?.characterId
        ?? draft.charPicks?.find((q) => q.playerIndex === p.playerIndex)?.characterId,
      easyDrive: p.easyDrive,
    })),
    trackId: draft.trackPrev?.trackId ?? draft.previous?.trackId ?? null,
    speedClass,
    laps: null,
    mode: 'battle',
    arenaId,
  };
}

export const HOW_TO_BATTLE = Object.freeze([
  ['🫧', `Everyone floats ${BATTLE_BUBBLES} bubbles`],
  ['🎁', 'Grab ? boxes for gumdrops & rockets'],
  ['🎯', 'Bonk a racer to pop a bubble'],
  ['🏆', 'Last one bobbing wins!'],
]);

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'arena-select',
  flow: { order: 40, when: (ctx) => ctx?.draft?.mode === 'battle' },
  mount(ctx, nav) {
    const d = ctx.draft;
    const p1 = d.joinState.players[0];
    const ids = ARENAS.map((a) => a.def.id);
    let state = createCupSelectState({
      playable: ARENAS.map(() => true),
      cupId: d.arenaId ?? d.previous?.arenaId ?? null,
      cupIds: ids,
      speedClass: d.trackPrev?.speedClass ?? null,
      easyDrive: d.joinState.players.some((p) => p.easyDrive),
      controllerId: p1?.deviceId ?? null,
    });

    const cards = ARENAS.map(({ def }, i) => {
      const base = cssColor(def.previewColor, '#c9a8ff');
      const outline = trackOutlinePoints(def.controlPoints, 100, 60, 0.14);
      return el('button.sk-cupcard.skb-arena', {
        '--c1': lighten(base, 0.6),
        '--c2': base,
        onclick: (e) => {
          e.stopPropagation();
          if (state.index === i && state.row === 0) handle({ deviceId: 'mouse', action: 'confirm' });
          else handle({ deviceId: 'mouse', action: 'set', key: 'index', value: i });
        },
        html: `<div class="skb-arena-art"><svg viewBox="0 0 100 60" aria-hidden="true"><polygon points="${outline}"/></svg>`
          + `<span class="a1">${def.art[0]}</span><span class="a2">${def.art[1]}</span><span class="a3">${def.art[2]}</span></div>`
          + `<div class="sk-cupcard-name">${escapeHtml(def.name)}</div>`
          + `<div class="sk-cupcard-foot">${escapeHtml(def.subtitle)}</div>`,
      });
    });

    const speedPills = S.SPEED_ORDER.map((id, i) => {
      const sc = SPEED_CLASSES[id] ?? { name: id, emoji: '' };
      return el('button.sk-pill', {
        onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'speedIndex', value: i }); },
        html: `<span class="sk-pill-e">${sc.emoji}</span><span class="sk-pill-t">${escapeHtml(sc.name)}<small>${SPEED_HINT[id] ?? ''}</small></span>`,
      });
    });
    const goBtn = el('button.sk-bigbtn.sk-race', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'confirm' }); },
      html: `<span>Let's pop!</span> <span class="sk-flag">🫧</span> <span class="sk-go-k">${glyph('A')}</span>`,
    });
    const how = el('div.skb-how', {
      html: HOW_TO_BATTLE.map(([e, t], i) => `<span class="skb-how-step" style="--i:${i}"><b>${e}</b>${escapeHtml(t)}</span>`).join('')
        + `<span class="skb-how-step skb-how-time"><b>⏱️</b>${clockText(BATTLE_TIME)}</span>`,
    });
    const rowEls = [
      el('div.sk-cupcards.skb-arenas', {}, cards),
      el('div.sk-optrow', {}, el('div.sk-optlabel', { html: 'Speed' }), el('div.sk-pills', {}, speedPills)),
      el('div.sk-gorow', {}, goBtn),
    ];

    const node = el('div.sk-screen.sk-cups.skb-arena-select', {},
      floatiesLayer(20, 43),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Pick an arena! <span class="sk-wiggle">🫧</span>' }),
        el('div.sk-chooser', { html: `<b class="sk-tag" style="--pc:${pc(0)}">P1</b> is choosing — Bubble Pop Battle!` })),
      how,
      ...rowEls,
      hintsBar([
        hint('A', 'Enter', 'Pop!'),
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('Y', 'Tab', 'Speed'),
        hint('B', 'Esc', 'Back'),
      ]),
    );

    const sync = () => {
      cards.forEach((c, i) => c.classList.toggle('sk-sel', i === state.index));
      speedPills.forEach((c, i) => c.classList.toggle('sk-sel', i === state.speedIndex));
      rowEls.forEach((r, i) => r.classList.toggle('sk-row-focus', i === state.row));
    };

    const handle = (ev) => {
      const res = cupSelectReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      sync();
      d.arenaId = ids[state.index] ?? null;
      d.trackPrev = { ...(d.trackPrev || {}), speedClass: cupSpeed(state) };
      if (res.go === 'next') nav.finish(arenaRaceSetup(d, ids[state.index], cupSpeed(state)));
      else if (res.go === 'back') nav.back();
    };

    sync();
    return { node, cls: 'sk-mode-full', handle };
  },
};
