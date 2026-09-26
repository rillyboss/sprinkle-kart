/**
 * Online hub — "Play with friends 🌐": Host a game · Join a friend · Check connection
 * (NETWORKING.md §10.1). A title-screen entry that only shows once a grown-up
 * turned online play on (Settings → Grown-ups). Opened from an invite link it
 * asks "Join 🏡 SPRINKLE-4821?" (one press to confirm).
 *
 * The online flow itself (signaling, sessions, races) is wired by WS7 through
 * `ctx.online` = { host(), join(secret), leave?() }; without it the hub still
 * works as a menu (Join / Check connection) and says hosting is almost ready.
 *
 * Params: { returnTo?, invite?: RoomSecret, message?: string, platform? }.
 * OWNER: WS6 (session, lobby & screens).
 */
import './online.css';
import * as S from '../menuState.js';
import { el, escapeHtml, hint, kbd, floatiesLayer } from '../dom.js';
import { hintsBar, backButton } from './_shared.js';
import { TEXT } from '../../net/session/texts.js';
import { canHost, currentPlatform } from '../../net/platform.js';
import { isRoomSecret } from '../../net/session/roomCode.js';
import inviteGate from './inviteGate.js';

export const HUB_OPTIONS = Object.freeze(['host', 'join', 'check']);
export const INVITE_OPTIONS = Object.freeze(['join-invite', 'not-now']);

const CARDS = {
  host: ['🏰', 'Host a game', 'Make a room and invite your friends'],
  join: ['🏡', 'Join a friend', 'Enter their room code + secret sweets'],
  check: ['🛰️', 'Check connection', 'See if online play works here'],
  'join-invite': ['🎟️', 'Join!', 'Hop into your friend\'s room'],
  'not-now': ['💖', 'Not now', 'Back to the menu'],
};

/** Is online play switched on (Settings → Grown-ups)? */
export function onlineEnabled(ctx) {
  try { return !!ctx?.progress?.getSettings?.()?.onlineEnabled; } catch { return false; }
}

/**
 * What a hub choice does (pure, for tests): { go: screen id, params } or { call: 'host'|'join', secret? }
 * or { message }.
 */
export function hubAction(choice, { invite = null, platform = currentPlatform(), hasOnline = false } = {}) {
  switch (choice) {
    case 'host':
      if (!canHost(platform)) return { message: TEXT.hostNeedsComputer };
      return hasOnline ? { call: 'host' } : { message: TEXT.comingSoon };
    case 'join': return { go: 'code-entry', params: { returnTo: 'online-hub' } };
    case 'check': return { go: 'check-connection', params: { returnTo: 'online-hub' } };
    case 'join-invite': return hasOnline ? { call: 'join', secret: invite } : { go: 'code-entry', params: { returnTo: 'online-hub', prefill: invite } };
    case 'not-now':
    case 'cancel':
    default: return { go: 'back' };
  }
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'online-hub',
  menuEntry: { label: 'Online', emoji: '🌐', order: 80, when: (ctx) => onlineEnabled(ctx) },
  mount(ctx, nav, params = {}) {
    // Never usable with online play off: an invite on such a machine sees the "ask a grown-up" screen.
    if (!onlineEnabled(ctx)) return inviteGate.mount(ctx, nav, { returnTo: params.returnTo ?? 'title' });
    const invite = isRoomSecret(params.invite) ? params.invite : null;
    const options = invite ? INVITE_OPTIONS : HUB_OPTIONS;
    let state = S.createListState(options, 0);
    const platform = params.platform ?? currentPlatform();
    const msg = el('div.skn-msg', { role: 'status' }, params.message ? String(params.message) : '');

    const cards = options.map((id, i) => {
      const [emoji, title, blurb] = CARDS[id];
      return el(`button.skn-card.skn-card-${id}`, {
        onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: i }); },
        html: `<span class="skn-card-e">${emoji}</span><span class="skn-card-t">${escapeHtml(title)}</span><span class="skn-card-b">${escapeHtml(blurb)}</span>`,
      });
    });
    if (!canHost(platform) && !invite) cards[0].classList.add('skn-soft');

    const leave = () => nav.goto(params.returnTo ?? 'title');
    const node = el('div.sk-screen.skn-screen.skn-hub', {},
      floatiesLayer(18, 52),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: invite ? `${escapeHtml(TEXT.joinInvite(invite.label))}` : 'Play with friends <span class="sk-wiggle">🌐</span>' })),
      el('div.skn-lead', {}, invite ? 'A friend invited you to their room! 💌' : 'Race friends in other houses — only people with your secret room code can ask to join.'),
      msg,
      el('div.skn-cards', {}, cards),
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('A', 'Enter', 'OK'),
        hint('B', 'Esc', 'Back'),
      ]),
    );

    const sync = () => cards.forEach((c, i) => c.classList.toggle('sk-sel', i === state.index));
    const handle = (ev) => {
      const res = S.listReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      sync();
      if (!res.go) return;
      const a = hubAction(res.go, { invite, platform, hasOnline: !!ctx.online });
      if (a.message) { msg.textContent = a.message; return; }
      if (a.call === 'host') ctx.online.host();
      else if (a.call === 'join') ctx.online.join(a.secret);
      else if (a.go === 'back') leave();
      else nav.goto(a.go, a.params);
    };
    sync();
    return { node, cls: 'sk-mode-full skn-mode-online', handle };
  },
};
