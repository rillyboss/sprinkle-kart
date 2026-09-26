/**
 * net-waiting — the generic "please wait" screen of online play (NETWORKING.md §10.1, §10.4):
 *   mode 'connecting'   "Knocking on the door… 🚪" while signaling / ICE run
 *   mode 'picking'      "Host is picking a mode… 🎨" — guests see this for host-only screens
 *                       (Menus.goto routes ScreenDef.net.role === 'host' here; `forId` names it)
 *   mode 'waiting'      "Waiting for the host… ⏳" (host tab hidden / snack break)
 *   mode 'reconnecting' "Reconnecting… 🔌" (M2)
 * B asks to leave the room (ctx.online.leave(), else back to the Online hub).
 * FOCUS previews of the host's card are milestone M3.
 *
 * Params: { mode?, forId?, text?, label?, sub? }.
 * OWNER: online session & screens.
 */
import './online.css';
import { el, escapeHtml, hint, floatiesLayer } from '../dom.js';
import { hintsBar } from './_shared.js';
import { TEXT } from '../../net/session/texts.js';

const HOST_SCREEN_TEXT = {
  'mode-select': TEXT.hostPicking.mode,
  'track-select': TEXT.hostPicking.course,
  'cup-select': TEXT.hostPicking.course,
  'arena-select': TEXT.hostPicking.course,
  'my-cup': TEXT.hostPicking.course,
};

/** The main line + emoji for params (pure, for tests). */
export function waitingView(params = {}) {
  const mode = params.mode ?? (params.forId ? 'picking' : 'waiting');
  switch (mode) {
    case 'connecting': return { mode, emoji: '🚪', text: params.text ?? TEXT.knocking, sub: params.label ? `Room ${params.label}` : '' };
    case 'picking': return { mode, emoji: '🎨', text: params.text ?? HOST_SCREEN_TEXT[params.forId] ?? TEXT.hostPicking.default, sub: params.sub ?? 'Get ready to cheer! 📣' };
    case 'reconnecting': return { mode, emoji: '🔌', text: params.text ?? TEXT.reconnecting, sub: '' };
    default: return { mode: 'waiting', emoji: '⏳', text: params.text ?? TEXT.hostWaiting, sub: params.sub ?? '' };
  }
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'net-waiting',
  mount(ctx, nav, params = {}) {
    const v = waitingView(params);
    const leave = () => {
      if (ctx.online?.leave) ctx.online.leave();
      else if (ctx.net?.dispatch) ctx.net.dispatch({ type: 'leave' });
      else nav.goto('online-hub');
    };
    const node = el('div.sk-screen.skn-screen.skn-waiting', {},
      floatiesLayer(14, 64),
      el('div.skn-wait', {},
        el('div.skn-wait-e', { 'aria-hidden': 'true' }, v.emoji),
        el('div.skn-wait-t', { html: `${escapeHtml(v.text)}` }),
        v.sub ? el('div.skn-wait-s', {}, v.sub) : null,
        el('div.skn-wait-s.skn-dots', {}, v.mode === 'picking' ? '' : 'Hang on')),
      hintsBar([hint('B', 'Esc', 'Leave room')]),
    );
    const handle = (ev) => {
      if (ev.action === 'back') { ctx.sfx?.('back'); leave(); }
    };
    return { node, cls: 'sk-mode-full skn-mode-online', handle };
  },
};
