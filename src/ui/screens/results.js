/**
 * Results — podium, standings, then the unlock celebrations (one per unlock,
 * in order). Opened by Menus.showResults(); resolves with the chosen option
 * id ('again' | 'next-track' | 'menu' by default).
 */
import * as S from '../menuState.js';
import { el, escapeHtml, hint, portraitHtml, floatiesLayer, confettiLayer } from '../dom.js';
import { ordinal, medalFor, cheerMessage, formatTime } from '../hudLogic.js';
import { pc, hintsBar, UNLOCK_MIN_SHOW } from './_shared.js';
import { unlockOverlay, nextUnlockTeaser } from './unlock.js';

/** Results options: [id, label, icon]. Modes may pass their own via params.options. */
export const RESULT_OPTIONS = [
  ['again', 'Race again', '🔁'],
  ['next-track', 'Next track', '➡️'],
  ['menu', 'Menu', '🏠'],
];

/**
 * Normalise the unlock list: `unlocks` ([{kind, def}]) wins; otherwise the
 * legacy single `newlyUnlocked` character def.
 */
export function unlockQueue({ unlocks = null, newlyUnlocked = null } = {}) {
  if (Array.isArray(unlocks) && unlocks.length) return unlocks.filter((u) => u && u.def);
  return newlyUnlocked ? [{ kind: 'character', id: newlyUnlocked.id, def: newlyUnlocked }] : [];
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'results',
  mount(ctx, nav, params = {}) {
    const { standings = [], trackDef = null, humanWinner = null, options = RESULT_OPTIONS } = params;
    const queue = unlockQueue(params);
    const total = standings.length;
    const placeOf = (k, i) => k.finishPlace ?? k.place ?? i + 1;
    const nameOf = (k) => k.name ?? ctx.char(k.characterId)?.name ?? 'Racer';
    const tagOf = (k) => (k.playerIndex != null && !k.isCPU
      ? `<b class="sk-tag" style="--pc:${pc(k.playerIndex)}">P${k.playerIndex + 1}</b>` : '');

    const podiumOrder = [1, 0, 2].filter((i) => i < total);
    const podium = el('div.sk-podium', {}, podiumOrder.map((i) => {
      const k = standings[i];
      const place = placeOf(k, i);
      return el(`div.sk-step.sk-step-${place}`, {
        html: `${place === 1 ? '<div class="sk-crown">👑</div>' : ''}`
          + `${portraitHtml(ctx.char(k.characterId), ctx.portraits, { cls: 'sk-step-portrait' })}`
          + `<div class="sk-step-name">${tagOf(k)} ${escapeHtml(nameOf(k))}</div>`
          + `<div class="sk-step-block sk-medal-${medalFor(place)}"><span>${ordinal(place)}</span></div>`,
      });
    }));

    const list = el('div.sk-standings', {}, standings.map((k, i) => {
      const place = placeOf(k, i);
      const human = k.playerIndex != null && !k.isCPU;
      return el(`div.sk-row${human ? '.sk-row-human' : ''}`, {
        '--pc': human ? pc(k.playerIndex) : 'transparent',
        '--i': i,
        html: `<span class="sk-row-place sk-medal-${medalFor(place)}">${ordinal(place)}</span>`
          + `${portraitHtml(ctx.char(k.characterId), ctx.portraits, { cls: 'sk-row-portrait' })}`
          + `<span class="sk-row-name">${tagOf(k)} ${escapeHtml(nameOf(k))}</span>`
          + `<span class="sk-row-cheer">${cheerMessage(place, total)}</span>`
          + `<span class="sk-row-time">${k.finished ? formatTime(k.finishTime) : 'zooming…'}</span>`,
      });
    }));

    let state = S.createListState(options.map((o) => o[0]));
    const btns = options.map(([, label, icon], i) => el('button.sk-listbtn', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: i }); },
      html: `<span class="sk-listbtn-i">${icon}</span><span>${label}</span>`,
    }));

    const headline = humanWinner
      ? `${escapeHtml(humanWinner.playerIndex != null ? `P${humanWinner.playerIndex + 1} ` : '')}${escapeHtml(nameOf(humanWinner))} wins! 🏆`
      : 'What a race! 🎉';
    const node = el('div.sk-screen.sk-results', {},
      floatiesLayer(16, 21),
      confettiLayer(90, 3),
      el('div.sk-results-head', {},
        el('h1.sk-h1.sk-results-title', { html: headline }),
        el('p.sk-lead', { html: `${trackDef?.name ? `${escapeHtml(trackDef.name)} · ` : ''}Everybody did great!` })),
      el('div.sk-results-body', {}, podium, list),
      params.teaser === false ? null : nextUnlockTeaser(ctx), // progression: "Next sticker" card
      el('div.sk-list.sk-list-row', {}, btns),
      hintsBar([hint('A', 'Enter', 'Choose')]),
    );

    let celebration = null;
    let celebrationAge = 0; // seconds the current unlock reveal has been on screen
    let celebrateTimer = queue.length ? 1.8 : 0;
    const seqTotal = queue.length;
    const celebrate = () => {
      celebrateTimer = 0;
      const u = queue.shift();
      if (!u) return;
      const seq = { index: seqTotal - queue.length - 1, total: seqTotal };
      celebration = unlockOverlay(ctx, u, () => handle({ deviceId: 'mouse', action: 'confirm' }), seq);
      node.appendChild(celebration);
      ctx.sfx('unlock');
      if (u.kind !== 'track') { try { ctx.audio?.voice?.(u.def, 'win'); } catch { /* ignore */ } }
      celebrationAge = 0;
      ctx.setCooldown(0.6);
    };
    const sync = () => btns.forEach((b, i) => b.classList.toggle('sk-sel', i === state.index));
    const handle = (ev) => {
      if (celebrateTimer > 0) {
        if (ev.action === 'confirm' || ev.action === 'start' || ev.action === 'select') celebrate();
        return;
      }
      if (celebration) {
        // Mashing A through the finish must not skip the big reveal.
        if (celebrationAge < UNLOCK_MIN_SHOW) return;
        if (['confirm', 'start', 'back', 'select'].includes(ev.action)) {
          ctx.sfx('confirm');
          celebration.classList.add('sk-leaving');
          const c = celebration;
          celebration = null;
          setTimeout(() => c.remove(), 450);
          ctx.setCooldown(0.9);
          if (queue.length) celebrateTimer = 0.7; // next unlock after a breath
        }
        return;
      }
      if (ev.action === 'back') return; // no accidental exit from results
      const res = S.listReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      sync();
      if (res.go) nav.resolve(res.go);
    };
    ctx.sfx('cheer');
    sync();
    return {
      node,
      cls: 'sk-mode-full sk-mode-results',
      handle,
      update: (dt) => {
        if (celebrateTimer > 0) {
          celebrateTimer -= dt;
          if (celebrateTimer <= 0) celebrate();
        }
        if (celebration) {
          celebrationAge += dt;
          celebration.classList.toggle('sk-can-continue', celebrationAge >= UNLOCK_MIN_SHOW);
        }
      },
    };
  },
};
