/**
 * Pause overlay ("Snack break!"). Opened by Menus.showPause(label); resolves
 * with 'resume' | 'restart' | 'quit'.
 */
import * as S from '../menuState.js';
import { el, escapeHtml, hint } from '../dom.js';

/** Pause menu options: [id, label, icon]. Modes may pass their own via params.options. */
export const PAUSE_OPTIONS = [
  ['resume', 'Keep racing!', '▶️'],
  ['restart', 'Start over', '🔁'],
  ['quit', 'Back to menu', '🏠'],
];

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'pause',
  mount(ctx, nav, { label = '', options = PAUSE_OPTIONS, title = 'Snack break!', emoji = '🍪' } = {}) {
    let state = S.createListState(options.map((o) => o[0]));
    const btns = options.map(([, text, icon], i) => el('button.sk-listbtn', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: i }); },
      html: `<span class="sk-listbtn-i">${icon}</span><span>${text}</span>`,
    }));
    const node = el('div.sk-screen.sk-pause', {},
      el('div.sk-card-pop.sk-pause-card', {},
        el('div.sk-pause-emoji', { html: escapeHtml(emoji) }),
        el('h1.sk-h1', { html: escapeHtml(title) }),
        el('p.sk-lead', { html: escapeHtml(S.pauseLeadText(label)) }),
        el('div.sk-list', {}, btns),
        el('div.sk-hints.sk-hints-in', { html: hint('A', 'Enter', 'Choose') + hint('B', 'Esc', 'Keep racing') })));
    const sync = () => btns.forEach((b, i) => b.classList.toggle('sk-sel', i === state.index));
    const handle = (ev) => {
      const res = S.listReduce(state, ev, { startCancels: true });
      state = res.state;
      ctx.fx(res);
      sync();
      if (res.go) nav.resolve(res.go === 'cancel' ? 'resume' : res.go);
    };
    sync();
    return { node, cls: 'sk-mode-overlay', handle };
  },
};
