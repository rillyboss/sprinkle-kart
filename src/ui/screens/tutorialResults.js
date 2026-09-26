/**
 * How to Play results: which tricks were learned (a sticker checklist) and
 * "Practice again" / "Let's race!". Opened by the tutorial controller with
 * menus.open('tutorial-results', { summary, unlocks, characterId }).
 * Resolves 'again' | 'menu'. OWNER: showcase features & modes.
 */
import '../../modes/showcase.css';
import { el, escapeHtml, hint, floatiesLayer, confettiLayer } from '../dom.js';
import { createPhasedState, phasedTick, phasedReduce } from '../../modes/menus.js';
import { tutorialResultModel, TUTORIAL_OPTIONS } from '../../modes/tutorial.js';
import { hintsBar } from './_shared.js';
import { portraitFor, celebrationQueue, optionButtons } from './_modes.js';

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'tutorial-results',
  mount(ctx, nav, params = {}) {
    const { unlocks = [], options = TUTORIAL_OPTIONS, characterId = null } = params;
    const m = tutorialResultModel(params.summary?.tutorial ?? null);

    let state = createPhasedState(options.map((o) => o[0]), { introTime: 1.2 });
    const opts = optionButtons(options, (i) => handle({ deviceId: 'mouse', action: 'select', index: i }));
    const optHost = el('div.sk-gp-opts', {}, opts.node);

    const list = el('div.skh-checks', {}, m.rows.map((r, i) => el(`div.skh-check${r.learned ? '.skh-check-got' : ''}`, {
      '--i': i,
      html: `<span class="skh-check-e">${r.emoji}</span><span class="skh-check-t">${escapeHtml(r.text)}</span>`
        + `<span class="skh-check-m">${r.learned ? '✅' : '⭕'}</span>`,
    })));

    const node = el('div.sk-screen.skh-results', {},
      floatiesLayer(16, 41),
      m.star ? confettiLayer(90, 23) : null,
      el('div.sk-results-head', {},
        el('div.sk-gp-kicker', { html: '🎓 How to Play' }),
        el('h1.sk-h1.sk-results-title', { html: escapeHtml(m.title) }),
        el('div.skb-sub', { html: escapeHtml(m.sub) })),
      el('div.skh-results-body', {},
        characterId ? el('div.skh-results-me', { html: portraitFor(ctx, characterId, 'skh-portrait') + `<b>${m.learned}/${m.total}</b>` }) : null,
        list),
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
    ctx.sfx(m.star ? 'team-cheer' : 'cheer');
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
