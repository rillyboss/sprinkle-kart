/**
 * "How do you want to play?" — the big mode cards (Free Race, Grand Prix,
 * Time Trial, Team Race, Bubble Battle) plus menu-entry buttons (Records ...) under them.
 * Flow order 25 (after join, before character select). P1 (or the mouse) chooses.
 * OWNER: modes + timing workstream.
 */
import { el, escapeHtml, hint, kbd, floatiesLayer } from '../dom.js';
import { menuEntries } from '../screenFlow.js';
import { modeCardsFor, createModeSelectState, modeSelectReduce } from '../../modes/menus.js';
import { applyModeChoice, restoreParty } from '../../modes/flow.js';
import { pc, hintsBar, backButton } from './_shared.js';

const TAGS = {
  free: (n) => (n > 1 ? `${n} friends + CPU pals` : 'You + 7 CPU pals'),
  'grand-prix': () => '4 tracks · points · trophies',
  'time-trial': (n) => (n > 1 ? 'Solo run for P1 — everyone cheers!' : 'Just you and your ghost'),
  team: (n) => (n > 1 ? `${n} of you + buddies vs ⭐` : 'You + 3 buddies vs ⭐'),
  battle: () => '3 bubbles each · 2 arenas',
};

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'mode-select',
  flow: { order: 25 },
  mount(ctx, nav) {
    const d = ctx.draft;
    restoreParty(d); // coming back here undoes a Time Trial's "P1 only"
    const players = d.joinState.players;
    const entries = menuEntries(ctx.screens, 'mode-select');
    const shown = modeCardsFor(ctx.net); // online: only ONLINE_MODES (NETWORKING.md §10.1)
    let state = createModeSelectState({ mode: d.mode, entryCount: entries.length, controllerId: players[0]?.deviceId ?? null, cards: ctx.net ? shown : null });

    const cards = shown.map((m, i) => el(`button.sk-mode-card.sk-mode-${m.id}`, {
      onclick: (e) => {
        e.stopPropagation();
        handle({ deviceId: 'mouse', action: state.index === i && state.row === 'cards' ? 'select' : 'set', key: 'index', value: i });
      },
      html: `<div class="sk-mode-art"><span class="a1">${m.art[0]}</span><span class="a2">${m.art[1]}</span><span class="a3">${m.art[2]}</span></div>`
        + `<div class="sk-mode-name">${escapeHtml(m.name)}</div>`
        + `<div class="sk-mode-blurb">${escapeHtml(m.blurb)}</div>`
        + `<div class="sk-mode-tag">${escapeHtml(TAGS[m.id]?.(players.length) ?? '')}</div>`,
    }));
    const chips = entries.map((en, i) => el('button.sk-title-entry.sk-mode-entry', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', key: 'entry', value: i }); },
      html: `${en.emoji ? `<span>${escapeHtml(en.emoji)}</span> ` : ''}${escapeHtml(en.label)}`,
    }));

    const node = el('div.sk-screen.sk-modes', {},
      floatiesLayer(22, 25),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'How do you want to play? <span class="sk-wiggle">🎮</span>' }),
        el('div.sk-chooser', { html: `<b class="sk-tag" style="--pc:${pc(0)}">P1</b> picks the fun!` })),
      el('div.sk-mode-cards', { '--n': cards.length }, cards),
      chips.length ? el('div.sk-title-entries.sk-mode-entries', {}, chips) : null,
      hintsBar([
        hint('A', 'Enter', 'Pick'),
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('B', 'Esc', 'Back'),
      ]),
    );

    const sync = () => {
      cards.forEach((c, i) => c.classList.toggle('sk-sel', state.row === 'cards' && i === state.index));
      cards.forEach((c, i) => c.classList.toggle('sk-soft', state.row !== 'cards' && i === state.index));
      chips.forEach((c, i) => c.classList.toggle('sk-focus', state.row === 'entries' && i === state.entry));
    };

    const handle = (ev) => {
      const res = modeSelectReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      sync();
      if (res.go === 'mode') {
        applyModeChoice(d, res.mode);
        nav.next();
      } else if (res.go === 'entry') {
        nav.goto(entries[res.entry].id, { returnTo: 'mode-select' });
      } else if (res.go === 'back') {
        restoreParty(d);
        nav.back();
      }
    };

    sync();
    return { node, cls: 'sk-mode-full', handle };
  },
};
