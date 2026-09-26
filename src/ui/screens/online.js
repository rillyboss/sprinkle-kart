/**
 * Online hub — "Play with friends 🌐": Host a game · Join a friend · Check connection
 * (NETWORKING.md §10.1). On the title screen by default (Settings → Grown-ups can turn online play off).
 *
 *   Host a game  → one press: the room opens with a big 4-letter code and friends can join right away.
 *   Join a friend → "Games you can join" (our Worker's open-games list) or "Type a code".
 *
 * The online flow itself (signaling, sessions, races) is wired in main.js through
 * `ctx.online` = { host(), join(code), listRooms?(), canList?, leave?() }; without it the hub still
 * works as a menu (Join / Check connection) and says hosting is almost ready.
 *
 * Params: { returnTo?, invite?: 'CAKE' (offer to join it), message?: string, tips?: string[], platform? }.
 * OWNER: online session & screens.
 */
import './online.css';
import * as S from '../menuState.js';
import { el, escapeHtml, hint, kbd, floatiesLayer } from '../dom.js';
import { hintsBar, backButton } from './_shared.js';
import { TEXT } from '../../net/session/texts.js';
import { canHost, currentPlatform } from '../../net/platform.js';
import { isRoomCode } from '../../net/session/roomCode.js';
import { isOnlineOn } from '../../progress/schema.js';
import inviteGate from './inviteGate.js';

export const HUB_OPTIONS = Object.freeze(['host', 'join', 'check']);
export const INVITE_OPTIONS = Object.freeze(['join-invite', 'not-now']);

const CARDS = {
  host: ['🏰', 'Host a game', 'Make a room — friends join with its 4 letters'],
  join: ['🏡', 'Join a friend', 'Pick their game or type their code'],
  check: ['🛰️', 'Check connection', 'See if online play works here'],
  'join-invite': ['🎟️', 'Join!', 'Hop into your friend\'s room'],
  'not-now': ['💖', 'Not now', 'Back to the menu'],
};

/** Is online play available here? (on unless a grown-up turned it off in Settings → Grown-ups) */
export function onlineEnabled(ctx) {
  try { return isOnlineOn(ctx?.progress?.getSettings?.()); } catch { return true; }
}

/**
 * What a hub choice does (pure, for tests): { go: screen id, params } or { call: 'host'|'join', code? }
 * or { message }.
 * @param {string} choice
 * @param {{ invite?: string|null, platform?: object, hasOnline?: boolean, canList?: boolean }} [o]
 *   canList: false = this build has no Worker list at all, so Join goes straight to the code grid
 */
export function hubAction(choice, { invite = null, platform = currentPlatform(), hasOnline = false, canList = true } = {}) {
  switch (choice) {
    case 'host':
      if (!canHost(platform)) return { message: TEXT.hostNeedsComputer };
      return hasOnline ? { call: 'host' } : { message: TEXT.comingSoon };
    case 'join':
      return canList ? { go: 'online-join', params: { returnTo: 'online-hub' } } : { go: 'code-entry', params: { returnTo: 'online-hub' } };
    case 'check': return { go: 'check-connection', params: { returnTo: 'online-hub' } };
    case 'join-invite': return hasOnline ? { call: 'join', code: invite } : { go: 'code-entry', params: { returnTo: 'online-hub', prefill: invite } };
    case 'not-now':
    case 'cancel':
    default: return { go: 'back' };
  }
}

/** The hub's tip lines (params.tips: plain strings, at most 3; anything else is ignored). */
export function hubTips(params = {}) {
  return Array.isArray(params?.tips) ? params.tips.filter((t) => typeof t === 'string' && t).slice(0, 3) : [];
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'online-hub',
  menuEntry: { label: 'Online', emoji: '🌐', order: 80, when: (ctx) => onlineEnabled(ctx) },
  mount(ctx, nav, params = {}) {
    // Online play turned off on this machine: the friendly "it's off" screen instead.
    if (!onlineEnabled(ctx)) return inviteGate.mount(ctx, nav, { returnTo: params.returnTo ?? 'title' });
    const invite = isRoomCode(params.invite) ? params.invite : null;
    const options = invite ? INVITE_OPTIONS : HUB_OPTIONS;
    let state = S.createListState(options, 0);
    const platform = params.platform ?? currentPlatform();
    const msg = el('div.skn-msg', { role: 'status' }, params.message ? String(params.message) : '');
    // "We couldn't connect your houses 🙈" comes with the three friendly tips (NETWORKING.md §13.4)
    const tips = hubTips(params);
    const tipList = tips.length ? el('ul.skn-tips', {}, tips.map((t) => el('li', {}, t))) : null;

    const cards = options.map((id, i) => {
      const [emoji, title, blurb] = CARDS[id];
      return el(`button.skn-card.skn-card-${id}`, {
        onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: i }); },
        onmouseenter: () => { if (state.index !== i) { state = { ...state, index: i }; sync(); } },
        html: `<span class="skn-card-e">${emoji}</span><span class="skn-card-t">${escapeHtml(title)}</span><span class="skn-card-b">${escapeHtml(blurb)}</span>`,
      });
    });
    if (!canHost(platform) && !invite) cards[0].classList.add('skn-soft');

    const leave = () => nav.goto(params.returnTo ?? 'title');
    const node = el('div.sk-screen.skn-screen.skn-hub', {},
      floatiesLayer(18, 52),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: invite ? `${escapeHtml(TEXT.joinInvite(invite))}` : 'Play with friends <span class="sk-wiggle">🌐</span>' })),
      el('div.skn-lead', {}, invite ? 'A friend invited you to their room! 💌' : 'Race friends in other houses! 🏁'),
      msg,
      ...(tipList ? [tipList] : []),
      el('div.skn-cards', {}, cards),
      el('p.skn-privacy-line', {}, TEXT.privacyShort),
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
      const a = hubAction(res.go, { invite, platform, hasOnline: !!ctx.online, canList: ctx.online?.canList !== false });
      if (a.message) { msg.textContent = a.message; tipList?.remove(); return; }
      if (a.call === 'host') ctx.online.host();
      else if (a.call === 'join') ctx.online.join(a.code);
      else if (a.go === 'back') leave();
      else nav.goto(a.go, a.params);
    };
    sync();
    return { node, cls: 'sk-mode-full skn-mode-online', handle };
  },
};
