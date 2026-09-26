/**
 * "Online play is off" — shown when an invite link (or the Online hub) is opened on a machine where a
 * grown-up turned online play off (NETWORKING.md §10.1). One button back to the title. It never turns
 * online play back on: that happens only in Settings → Grown-ups (behind the parent gate).
 *
 * Params: { returnTo?, code? }.
 * OWNER: online session & screens.
 */
import './online.css';
import { el, escapeHtml, hint, floatiesLayer } from '../dom.js';
import { hintsBar } from './_shared.js';
import { TEXT } from '../../net/session/texts.js';

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'invite-gate',
  mount(ctx, nav, params = {}) {
    const back = () => { ctx.sfx?.('confirm'); nav.goto(params.returnTo ?? 'title'); };
    const btn = el('button.skn-btn.sk-sel.skn-gate-back', {
      onclick: (e) => { e.stopPropagation(); back(); },
      html: '🏠 Back to the title',
    });
    const node = el('div.sk-screen.skn-screen.skn-invite-gate', {},
      floatiesLayer(16, 77),
      el('div.skn-wait', {},
        el('div.skn-wait-e', { 'aria-hidden': 'true' }, params.code ? '💌' : '🌙'),
        el('div.skn-wait-t', {}, params.code ? 'A friend sent you an invite!' : 'Online play is resting'),
        el('div.skn-wait-s', { html: escapeHtml(TEXT.onlineOff) }),
        btn),
      hintsBar([hint('A', 'Enter', 'Back to the title'), hint('B', 'Esc', 'Back')]),
    );
    const handle = (ev) => {
      if (['confirm', 'start', 'back', 'select'].includes(ev.action)) back();
    };
    return { node, cls: 'sk-mode-full skn-mode-online', handle };
  },
};
