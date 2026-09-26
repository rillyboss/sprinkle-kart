/**
 * Bubble Pop Battle results: who was the last one bobbing, then everyone's
 * bubbles left and bubbles popped. Opened by the battle controller with
 * menus.open('battle-results', { summary, battle, trackDef, unlocks }).
 * Resolves 'again' | 'next-track' (another arena) | 'menu'.
 * OWNER: showcase features & modes.
 */
import '../../modes/showcase.css';
import { el, escapeHtml, hint, floatiesLayer, confettiLayer } from '../dom.js';
import { createPhasedState, phasedTick, phasedReduce } from '../../modes/menus.js';
import { battleResultModel, BATTLE_OPTIONS } from '../../modes/showcaseResults.js';
import { hintsBar } from './_shared.js';
import { portraitFor, nameOf, playerTag, celebrationQueue, optionButtons } from './_modes.js';

const bubblesHtml = (r) => (r.out
  ? '<span class="skb-out">💤 out</span>'
  : `<span class="skb-bubs">${'<i class="skb-bub"></i>'.repeat(r.bubbles)}${'<i class="skb-bub skb-bub-gone"></i>'.repeat(Math.max(0, r.max - r.bubbles))}</span>`);

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'battle-results',
  mount(ctx, nav, params = {}) {
    const { trackDef = null, unlocks = [], options = BATTLE_OPTIONS } = params;
    const battle = params.battle ?? params.summary?.battle ?? null;
    const m = battleResultModel(battle, (id) => nameOf(ctx, id));
    const winner = m.rows.find((r) => r.winner) ?? null;

    const rows = m.rows.map((r, i) => el(`div.skb-row${r.winner ? '.skb-row-win' : ''}${r.isCPU ? '' : '.skb-row-human'}`, {
      '--i': i,
      html: `<span class="skb-place">${r.medal || r.place}</span>${portraitFor(ctx, r.characterId, 'skb-row-portrait')}`
        + `<span class="skb-name">${playerTag(r)}${escapeHtml(nameOf(ctx, r.characterId))}</span>`
        + `${bubblesHtml(r)}<span class="skb-pops" title="bubbles popped">🎯 ${r.pops}</span>`,
    }));

    let state = createPhasedState(options.map((o) => o[0]), { introTime: 1.2 });
    const opts = optionButtons(options, (i) => handle({ deviceId: 'mouse', action: 'select', index: i }));
    const optHost = el('div.sk-gp-opts', {}, opts.node);

    const node = el('div.sk-screen.skb-results', {},
      floatiesLayer(16, 61),
      m.humanWon ? confettiLayer(80, 13) : null,
      el('div.sk-results-head', {},
        el('div.sk-gp-kicker', { html: `🫧 Bubble Battle${trackDef?.name ? ` · ${escapeHtml(trackDef.name)}` : ''}` }),
        el('h1.sk-h1.sk-results-title', { html: escapeHtml(m.title) }),
        m.sub ? el('div.skb-sub', { html: escapeHtml(m.sub) }) : null),
      el('div.skb-body', {},
        winner ? el('div.skb-hero', { html: `${portraitFor(ctx, winner.characterId, 'skb-hero-portrait')}<div class="skb-hero-bubbles"><i></i><i></i><i></i></div><div class="skb-hero-crown">👑</div>` }) : null,
        el('div.skb-table', {}, rows)),
      optHost,
      hintsBar([hint('A', 'Enter', 'Choose')]));

    const celebrations = celebrationQueue(ctx, node, unlocks, { delay: 2 });
    const sync = () => {
      optHost.classList.toggle('sk-show', state.phase === 'choose');
      opts.sync(state.index);
    };
    const handle = (ev) => {
      if (celebrations.handle(ev)) return;
      if (ev.action === 'back') return;
      const res = phasedReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      sync();
      if (res.go) nav.resolve(res.go);
    };
    ctx.sfx(m.humanWon ? 'battle-win' : 'cheer');
    if (winner && !winner.isCPU) { try { ctx.audio?.voice?.(ctx.char(winner.characterId), 'win'); } catch { /* ignore */ } }
    sync();
    return {
      node,
      cls: 'sk-mode-full sk-mode-results',
      handle,
      update(dt) {
        const before = state.phase;
        state = phasedTick(state, dt);
        if (before !== state.phase) sync();
        celebrations.update(dt);
      },
    };
  },
};
