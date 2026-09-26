/**
 * "Ask a grown-up" — shown when an invite link (or the Online hub) is opened on
 * a machine with online play switched off (NETWORKING.md §10.1, acceptance M1-17).
 * One button back to the title. It never bypasses the parent gate: turning
 * online on happens only in Settings → Grown-ups (privacy sentence + gate).
 *
 * Params: { returnTo? }.
 * OWNER: WS6 (session, lobby & screens).
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
        el('div.skn-wait-e', { 'aria-hidden': 'true' }, '💌'),
        el('div.skn-wait-t', {}, 'A friend sent you an invite!'),
        el('div.skn-wait-s', { html: escapeHtml(TEXT.inviteGate) }),
        btn),
      hintsBar([hint('A', 'Enter', 'Back to the title'), hint('B', 'Esc', 'Back')]),
    );
    const handle = (ev) => {
      if (['confirm', 'start', 'back', 'select'].includes(ev.action)) back();
    };
    return { node, cls: 'sk-mode-full skn-mode-online', handle };
  },
};
