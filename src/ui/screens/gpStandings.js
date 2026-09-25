/**
 * Grand Prix standings between races (animated point tally: everyone's new
 * points count up, then the rows slide into their new order), and after the
 * last race the trophy ceremony (gold / silver / bronze cups for the top 3 on
 * a podium, confetti, then any unlock celebrations from gp.unlocks).
 *
 * Opened by main.js with menus.open('gp-standings', params):
 *   { gp: GrandPrixResult, cup: CupDef, final: boolean, nextTrack: TrackDef|null, unlocks: [{kind, def}] }
 * Resolves 'next' | 'menu' (between races) or 'again' | 'menu' (after the ceremony).
 * OWNER: modes + timing workstream.
 */
import { el, escapeHtml, hint, floatiesLayer, confettiLayer } from '../dom.js';
import { ordinal, medalFor } from '../hudLogic.js';
import { standingsTally, tallyValue, trophyFor, podiumOrder, ceremonyHeadline } from '../../modes/grandPrix.js';
import { createPhasedState, phasedTick, phasedReduce } from '../../modes/menus.js';
import { pc, hintsBar } from './_shared.js';
import { playerTag, nameOf, trophyHtml, portraitFor, celebrationQueue, optionButtons } from './_modes.js';

const TALLY_DELAY = 0.7;
const TALLY_TIME = 1.3;
const SLIDE_AT = TALLY_DELAY + TALLY_TIME + 0.25;

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'gp-standings',
  mount(ctx, nav, params = {}) {
    const { gp = null, cup = null, final = false, nextTrack = null, unlocks = [] } = params;
    const rows = standingsTally(gp);
    const raceNo = (gp?.raceIndex ?? 0) + 1;
    const raceCount = gp?.raceCount ?? 4;
    const cupName = cup?.name ?? 'the cup';
    const maxPts = Math.max(1, ...rows.map((r) => r.after));

    /* ---------- standings table ---------- */
    const rowEls = rows.map((r) => {
      const human = !r.isCPU;
      const node = el(`div.sk-gprow${human ? '.sk-gprow-human' : ''}`, {
        '--pc': human ? pc(r.playerIndex) : 'transparent',
        '--shift': String(r.fromIndex - r.toIndex),
        '--w0': `${(r.before / maxPts) * 100}%`,
        html: `<span class="sk-gprow-place sk-medal-${medalFor(r.place)}">${ordinal(r.place)}</span>`
          + portraitFor(ctx, r.characterId, 'sk-gprow-portrait')
          + `<span class="sk-gprow-name">${playerTag(r)} ${escapeHtml(nameOf(ctx, r.characterId))}</span>`
          + '<span class="sk-gprow-bar"><i></i></span>'
          + `<span class="sk-gprow-gain">${r.gained ? `+${r.gained}` : '·'}</span>`
          + `<span class="sk-gprow-pts"><b>${r.before}</b><small>pts</small></span>`,
      });
      return { node, r, pts: node.querySelector('.sk-gprow-pts b'), bar: node.querySelector('.sk-gprow-bar i') };
    });
    rowEls.forEach(({ bar, r }) => { bar.style.width = `${(r.before / maxPts) * 100}%`; });
    const table = el('div.sk-gptable.sk-gp-presort', {}, rowEls.map((x) => x.node));

    /* ---------- options ---------- */
    const between = [['next', nextTrack ? `Next: ${nextTrack.name}` : 'Next race', '➡️'], ['menu', 'Leave cup', '🏠']];
    const afterCeremony = [['again', 'Play this cup again', '🔁'], ['menu', 'Menu', '🏠']];
    let phaseName = 'standings'; // 'standings' | 'ceremony'
    const first = final ? [['trophy', 'Trophy time!', '🏆']] : between;
    let state = createPhasedState(first.map((o) => o[0]), { introTime: SLIDE_AT + 0.6 });
    let opts = optionButtons(first, (i) => handle({ deviceId: 'mouse', action: 'select', index: i }));
    const optHost = el('div.sk-gp-opts', {}, opts.node);

    const standingsView = el('div.sk-gp-view', {},
      el('div.sk-results-head', {},
        el('div.sk-gp-kicker', { html: `${cup?.emoji ?? '🏆'} ${escapeHtml(cupName)}` }),
        el('h1.sk-h1.sk-results-title', { html: final ? 'Final standings! 🎉' : `Standings after race ${raceNo} of ${raceCount} ⭐` }),
        el('p.sk-lead', { html: final ? 'Every point counted. What a cup!' : 'Points are sprinkling in… ✨' })),
      table);

    const node = el('div.sk-screen.sk-gp', {}, floatiesLayer(16, 33), standingsView, optHost,
      hintsBar([hint('A', 'Enter', 'Choose')]));

    let t = 0;
    let slid = false;
    let ticked = -1;
    let celebrations = null;

    /* ---------- ceremony ---------- */
    function showCeremony() {
      phaseName = 'ceremony';
      standingsView.remove();
      const top = podiumOrder(gp?.standings ?? []);
      const podium = el('div.sk-cer-podium', {}, top.map((r) => {
        const kind = trophyFor(r.place);
        return el(`div.sk-cer-step.sk-cer-${r.place}`, {
          html: `<div class="sk-cer-cup">${trophyHtml(kind, { big: r.place === 1 })}</div>`
            + portraitFor(ctx, r.characterId, 'sk-cer-portrait')
            + `<div class="sk-cer-name">${playerTag(r)} ${escapeHtml(nameOf(ctx, r.characterId))}</div>`
            + `<div class="sk-cer-block sk-medal-${medalFor(r.place)}"><span>${ordinal(r.place)}</span><small>${r.points} pts</small></div>`,
        });
      }));
      const headline = ceremonyHeadline(gp, (id) => nameOf(ctx, id), cupName);
      const view = el('div.sk-gp-view.sk-cer', {},
        confettiLayer(110, 5),
        el('div.sk-results-head', {},
          el('div.sk-gp-kicker', { html: `${cup?.emoji ?? '🏆'} ${escapeHtml(cupName)} · Trophy ceremony` }),
          el('h1.sk-h1.sk-results-title', { html: escapeHtml(headline) }),
          el('p.sk-lead', { html: 'Hip hip hooray for everybody! 🎈' })),
        podium);
      node.insertBefore(view, optHost);
      opts.node.remove();
      opts = optionButtons(afterCeremony, (i) => handle({ deviceId: 'mouse', action: 'select', index: i }));
      optHost.appendChild(opts.node);
      state = createPhasedState(afterCeremony.map((o) => o[0]), { introTime: 2.4 });
      ctx.sfx('gp-trophy');
      ctx.sfx('cheer');
      const winner = gp?.standings?.[0];
      const def = winner && ctx.char(winner.characterId);
      if (def) { try { ctx.audio?.voice?.(def, 'win'); } catch { /* ignore */ } }
      celebrations = celebrationQueue(ctx, node, unlocks, { delay: 2.6 });
      sync();
    }

    const sync = () => {
      optHost.classList.toggle('sk-show', state.phase === 'choose');
      opts.sync(state.index);
    };

    const handle = (ev) => {
      if (celebrations?.handle(ev)) return;
      if (ev.action === 'back') return;
      const res = phasedReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      if (res.skipped && phaseName === 'standings') finishTally();
      sync();
      if (!res.go) return;
      if (res.go === 'trophy') showCeremony();
      else nav.resolve(res.go);
    };

    function finishTally() {
      t = Math.max(t, SLIDE_AT);
      rowEls.forEach(({ pts, bar, r }) => { pts.textContent = String(r.after); bar.style.width = `${(r.after / maxPts) * 100}%`; });
      slide();
    }
    function slide() {
      if (slid) return;
      slid = true;
      table.classList.remove('sk-gp-presort');
      table.classList.add('sk-gp-sorted');
    }

    ctx.sfx('cheer');
    sync();
    return {
      node,
      cls: 'sk-mode-full sk-mode-results',
      handle,
      update(dt) {
        t += dt;
        const before = state.phase;
        state = phasedTick(state, dt);
        if (before !== state.phase) sync();
        celebrations?.update(dt);
        if (phaseName !== 'standings' || slid) return;
        const k = t - TALLY_DELAY;
        if (k > 0) {
          rowEls.forEach(({ pts, bar, r }) => {
            const v = tallyValue(r.before, r.after, k, TALLY_TIME);
            pts.textContent = String(v);
            bar.style.width = `${(v / maxPts) * 100}%`;
          });
          const tick = Math.floor(k / 0.08);
          if (k < TALLY_TIME && tick !== ticked) { ticked = tick; ctx.sfx('gp-tally', { pitch: 1 + k * 0.3 }); }
        }
        if (t >= SLIDE_AT) slide();
      },
    };
  },
};
