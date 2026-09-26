/**
 * "Pick a cup!" — Grand Prix cup select (flow order 40, only when
 * draft.mode === 'grand-prix'; it finishes the flow instead of track select).
 * A cup is playable when all 4 of its tracks are unlocked; otherwise it shows
 * a padlock and a hint for the next track to unlock. Locked tracks inside a
 * cup stay a mystery ("???"). The last card, "My Cup" ✨ (showcase features),
 * opens the Custom Cup builder (screens/myCup.js) to race any 4 unlocked tracks.
 * OWNER: modes + timing workstream.
 */
import * as S from '../menuState.js';
import { SPEED_CLASSES } from '../../config.js';
import { CUPS } from '../../data/cups.js';
import { el, escapeHtml, glyph, kbd, hint, floatiesLayer } from '../dom.js';
import { cupCards } from '../../modes/grandPrix.js';
import { createCupSelectState, cupSelectReduce, cupSpeed } from '../../modes/menus.js';
import { pc, hintsBar, backButton, shake, lockHint, SPEED_HINT } from './_shared.js';
import { MY_CUP_ID, MY_CUP_SIZE, myCupCard, myCupStore } from '../../modes/myCup.js';

/** The remembered custom cup (this visit's draft first, then storage). */
function savedMyCup(draft) {
  if (draft.myCup) return draft.myCup;
  try { return myCupStore().load(); } catch { return null; }
}

/** P1's racer name (for "<name>'s Cup"). */
function ownerName(ctx, draft) {
  const p1 = draft.joinState.players[0];
  const picks = draft.charState ? S.charSelections(draft.charState) : (draft.charPicks || []);
  const id = picks.find((q) => q.playerIndex === p1?.playerIndex)?.characterId;
  return (id && ctx.char?.(id)?.name) || '';
}

/** The RaceSetup a cup pick finishes the menus with (first race of the cup). */
export function cupRaceSetup(draft, card, speedClass) {
  const picks = draft.charState ? S.charSelections(draft.charState) : [];
  return {
    players: draft.joinState.players.map((p) => ({
      playerIndex: p.playerIndex,
      deviceId: p.deviceId,
      characterId: picks.find((q) => q.playerIndex === p.playerIndex)?.characterId
        ?? draft.charPicks?.find((q) => q.playerIndex === p.playerIndex)?.characterId,
      easyDrive: p.easyDrive,
    })),
    trackId: card.tracks[0]?.def.id,
    speedClass,
    laps: null,
    mode: 'grand-prix',
    cupId: card.cup.id,
  };
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'cup-select',
  flow: { order: 40, when: (ctx) => ctx?.draft?.mode === 'grand-prix' },
  mount(ctx, nav) {
    const d = ctx.draft;
    const list = cupCards(CUPS, ctx.tracks, (t) => ctx.isTrackLocked(t));
    // "My Cup": playable once there are enough unlocked tracks to fill it.
    const open = ctx.tracks.filter((t) => !t.placeholder && !ctx.isTrackLocked(t));
    const openTracks = open.length;
    const openTrackName = (id) => open.find((t) => t.id === id)?.name ?? null;
    const myCupIndex = list.length;
    list.push({ cup: { id: MY_CUP_ID, name: 'My Cup', emoji: '✨', trackIds: [] }, tracks: [], playable: openTracks >= MY_CUP_SIZE, missing: 0, firstLocked: null, custom: true });
    const p1 = d.joinState.players[0];
    let state = createCupSelectState({
      playable: list.map((c) => c.playable),
      cupId: d.cupId ?? d.previous?.cupId ?? null,
      cupIds: list.map((c) => c.cup.id),
      speedClass: d.trackPrev?.speedClass ?? null,
      easyDrive: d.joinState.players.some((p) => p.easyDrive),
      controllerId: p1?.deviceId ?? null,
    });

    const cards = list.map((c, i) => {
      if (c.custom) {
        const card = el('button.sk-cupcard.skc-cupcard', {
          onclick: (e) => {
            e.stopPropagation();
            if (state.index === i) handle({ deviceId: 'mouse', action: 'confirm' });
            else handle({ deviceId: 'mouse', action: 'set', key: 'index', value: i });
          },
          html: (() => {
            const m = myCupCard(savedMyCup(d), openTrackName, ownerName(ctx, d));
            return `<div class="sk-cupcard-top skc-cupcard-top"><span class="sk-cupcard-e">${m.emoji}</span></div>`
              + `<div class="sk-cupcard-name">${escapeHtml(m.name)}</div>`
              + '<ol class="sk-cuptracks">' + m.rows.map((name, k) => (name
                ? `<li class="sk-cuptrack"><span>${k + 1}</span>${escapeHtml(name)}</li>`
                : `<li class="sk-cuptrack skc-cuptrack"><span>${k + 1}</span>You pick!</li>`)).join('') + '</ol>'
              + `<div class="sk-cupcard-foot">${!c.playable ? `🔒 Unlock ${MY_CUP_SIZE} tracks first` : m.remembered ? 'Race it or change it! 🎨' : 'Pick any 4 tracks! 🎨'}</div>`;
          })(),
        });
        if (!c.playable) card.classList.add('sk-cupcard-locked');
        return card;
      }
      const rows = c.cup.trackIds.map((id, k) => {
        const t = c.tracks.find((x) => x.def.id === id);
        if (!t) return `<li class="sk-cuptrack sk-cuptrack-soon"><span>${k + 1}</span>Coming soon!</li>`;
        return t.locked
          ? `<li class="sk-cuptrack sk-cuptrack-locked"><span>${k + 1}</span>🔒 ???</li>`
          : `<li class="sk-cuptrack"><span>${k + 1}</span>${escapeHtml(t.def.name)}</li>`;
      }).join('');
      let foot;
      if (c.playable) foot = '<div class="sk-cupcard-foot sk-cupcard-ready">Ready to race! 🎉</div>';
      else if (c.missing) foot = '<div class="sk-cupcard-foot">Tracks on the way! 🚧</div>';
      else foot = `<div class="sk-cupcard-foot">🔒 ${escapeHtml(lockHint(c.firstLocked, { short: true }))}</div>`;
      const card = el('button.sk-cupcard', {
        onclick: (e) => {
          e.stopPropagation();
          if (state.index === i) handle({ deviceId: 'mouse', action: 'confirm' });
          else handle({ deviceId: 'mouse', action: 'set', key: 'index', value: i });
        },
        html: `<div class="sk-cupcard-top"><span class="sk-cupcard-e">${c.cup.emoji}</span>${c.playable ? '' : '<span class="sk-cupcard-lock">🔒</span>'}</div>`
          + `<div class="sk-cupcard-name">${escapeHtml(c.cup.name)}</div>`
          + `<ol class="sk-cuptracks">${rows}</ol>${foot}`,
      });
      if (!c.playable) card.classList.add('sk-cupcard-locked');
      return card;
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
      html: `<span>Start the cup!</span> <span class="sk-flag">🏆</span> <span class="sk-go-k">${glyph('A')}</span>`,
    });
    const rowEls = [
      el('div.sk-cupcards', {}, cards),
      el('div.sk-optrow', {}, el('div.sk-optlabel', { html: 'Speed' }), el('div.sk-pills', {}, speedPills)),
      el('div.sk-gorow', {}, goBtn),
    ];

    const node = el('div.sk-screen.sk-cups', {},
      floatiesLayer(20, 41),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Pick a cup! <span class="sk-wiggle">🏆</span>' }),
        el('div.sk-chooser', { html: `<b class="sk-tag" style="--pc:${pc(0)}">P1</b> is choosing — 4 races, most points wins!` })),
      ...rowEls,
      hintsBar([
        hint('A', 'Enter', 'Start!'),
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('Y', 'Tab', 'Speed'),
        hint('B', 'Esc', 'Back'),
      ]),
    );

    const sync = () => {
      cards.forEach((c, i) => c.classList.toggle('sk-sel', i === state.index));
      speedPills.forEach((c, i) => c.classList.toggle('sk-sel', i === state.speedIndex));
      rowEls.forEach((r, i) => r.classList.toggle('sk-row-focus', i === state.row));
      goBtn.classList.toggle('sk-disabled', !state.playable[state.index]);
    };

    const handle = (ev) => {
      const res = cupSelectReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      if (res.shake === 'cup') shake(cards[state.index]);
      sync();
      d.cupId = list[state.index]?.cup.id ?? null;
      d.trackPrev = { ...(d.trackPrev || {}), speedClass: cupSpeed(state) };
      if (res.go === 'next' && state.index === myCupIndex) nav.goto('my-cup', { returnTo: 'cup-select' });
      else if (res.go === 'next') nav.finish(cupRaceSetup(d, list[state.index], cupSpeed(state)));
      else if (res.go === 'back') nav.back();
    };

    sync();
    return { node, cls: 'sk-mode-full', handle };
  },
};
