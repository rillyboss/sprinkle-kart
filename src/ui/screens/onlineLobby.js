/**
 * online-lobby — the room (NETWORKING.md §10.1, §10.3, §10.4, §10.9).
 *
 * Host: the 4-letter room code, HUGE (friends read it off the TV), whether the room shows in
 * "Games you can join" (a toggle, when our Worker keeps the list), "Copy invite link 📋", a QR code of
 * the link, every house with its players / racers / ping icon, remove a house or a single player,
 * lock / unlock ("Room locked 🔒 — tap to open again") and "Let's pick! 🎨". Friends with the code come
 * straight in — no approval prompts.
 * Guests: the same room read-only, "Waiting for the host to start…".
 * Everyone: the 8 preset emotes (Y), and Leave.
 *
 * Live data comes from `ctx.net` (main.js wires the session): { role, lobby(), code, houseId,
 * dispatch(ev), onEffect?(fn), listing?() → { supported, on }, setListed?(on) } — or, for tests /
 * screenshots, from params { role, lobby, code, localHouseId, inviteLink, listing }.
 * Actions go to `ctx.net.dispatch` (remove-house / remove-seat / lock / unlock / emote), `ctx.net.setListed`
 * and `ctx.online` (pick() = "Let's pick!", leave()).
 *
 * Logic: `lobbyScreenReduce` below (pure, tested).
 * OWNER: online session & screens.
 */
import './online.css';
import { el, escapeHtml, hint, kbd, floatiesLayer, portraitHtml } from '../dom.js';
import { hintsBar, backButton, shake } from './_shared.js';
import { TEXT, LOBBY_EMOTES } from '../../net/session/texts.js';
import { isRoomCode } from '../../net/session/roomCode.js';
import { makeInviteLink, inviteQrSvg, INVITE_BASE_URL } from '../../net/session/inviteLink.js';

const wrap = (i, n) => (n ? ((i % n) + n) % n : 0);
const out = (state, fx = [], effects = [], extra = {}) => ({ state, fx, effects, ...extra });

export const HOST_ACTIONS = Object.freeze(['start', 'list', 'copy', 'lock', 'leave']);
export const GUEST_ACTIONS = Object.freeze(['leave']);

/** @param {{ role?: 'host'|'guest', canList?: boolean }} [o] canList: our Worker keeps the open-games list */
export function createLobbyScreenState({ role = 'host', canList = true } = {}) {
  const actions = role === 'host' ? HOST_ACTIONS.filter((a) => a !== 'list' || canList) : GUEST_ACTIONS;
  return {
    role, actions, focus: 'actions', action: 0, house: 0, emote: 0,
    modal: null, modalIndex: 0, houseOptions: [],
  };
}

/** Options of the "house" modal for a guest house (host only). */
export function houseModalOptions(house) {
  if (!house) return [];
  const seats = house.players.length > 1 ? house.players.map((p) => ({ kind: 'remove-seat', houseId: house.houseId, seat: p.seat })) : [];
  return [{ kind: 'remove-house', houseId: house.houseId }, ...seats, { kind: 'cancel' }];
}

/**
 * @param {object} s screen state
 * @param {{ action: string } & object} ev menu event
 * @param {{ lobby?: object, selectable?: object[], listed?: boolean }} ctx live data:
 *   `selectable` = the house cards the host may pick (guest houses); `listed` = shown in "Games you can join"
 * @returns {{ state, fx: string[], effects: object[], shake?: boolean }}
 *   effects: start | lock | unlock | list {on} | copy | leave | remove-house {houseId} |
 *   remove-seat {houseId, seat} | emote {emote}
 */
export function lobbyScreenReduce(s, ev, { lobby = null, selectable = [], listed = true } = {}) {
  const a = ev.action;
  if (s.modal === 'house') {
    const n = s.houseOptions.length;
    switch (a) {
      case 'up': case 'left': return out({ ...s, modalIndex: wrap(s.modalIndex - 1, n) }, ['move']);
      case 'down': case 'right': return out({ ...s, modalIndex: wrap(s.modalIndex + 1, n) }, ['move']);
      case 'select':
        if (!(ev.index >= 0 && ev.index < n)) return out(s);
        return lobbyScreenReduce({ ...s, modalIndex: ev.index }, { ...ev, action: 'confirm' }, { lobby, selectable, listed });
      case 'confirm': case 'start': {
        const opt = s.houseOptions[s.modalIndex];
        const closed = { ...s, modal: null, modalIndex: 0, houseOptions: [] };
        if (!opt || opt.kind === 'cancel') return out(closed, ['back']);
        const eff = opt.kind === 'remove-house' ? { type: 'remove-house', houseId: opt.houseId } : { type: 'remove-seat', houseId: opt.houseId, seat: opt.seat };
        return out({ ...closed, focus: 'actions' }, ['back'], [eff]);
      }
      case 'back': return out({ ...s, modal: null, modalIndex: 0, houseOptions: [] }, ['back']);
      default: return out(s);
    }
  }
  const acts = s.actions;
  const actionEffect = (id) => {
    if (id === 'lock') return lobby?.locked ? { type: 'unlock' } : { type: 'lock' };
    if (id === 'list') return { type: 'list', on: !listed };
    return { type: id };
  };
  // pointer shortcuts
  if (a === 'pick-action') {
    if (!(ev.index >= 0 && ev.index < acts.length)) return out(s);
    return out({ ...s, focus: 'actions', action: ev.index }, ['confirm'], [actionEffect(acts[ev.index])]);
  }
  if (a === 'pick-house') {
    const h = selectable[ev.index];
    if (s.role !== 'host' || !h) return out(s);
    return out({ ...s, focus: 'houses', house: ev.index, modal: 'house', modalIndex: 0, houseOptions: houseModalOptions(h) }, ['confirm']);
  }
  if (a === 'pick-emote') {
    if (!(ev.index >= 0 && ev.index < LOBBY_EMOTES.length)) return out(s);
    return out({ ...s, focus: 'emotes', emote: ev.index }, ['confirm'], [{ type: 'emote', emote: LOBBY_EMOTES[ev.index].id }]);
  }
  if (a === 'toggle') return out({ ...s, focus: s.focus === 'emotes' ? 'actions' : 'emotes' }, ['move']);

  if (s.focus === 'houses') {
    const n = selectable.length;
    if (!n) return out({ ...s, focus: 'actions' });
    switch (a) {
      case 'left': case 'up': return out({ ...s, house: wrap(s.house - 1, n) }, ['move']);
      case 'right': return out({ ...s, house: wrap(s.house + 1, n) }, ['move']);
      case 'down': return out({ ...s, focus: 'actions' }, ['move']);
      case 'confirm': case 'start': return lobbyScreenReduce(s, { action: 'pick-house', index: wrap(s.house, n) }, { lobby, selectable, listed });
      case 'back': return out({ ...s, focus: 'actions' }, ['back']);
      default: return out(s);
    }
  }
  if (s.focus === 'emotes') {
    const n = LOBBY_EMOTES.length;
    switch (a) {
      case 'left': return out({ ...s, emote: wrap(s.emote - 1, n) }, ['move']);
      case 'right': return out({ ...s, emote: wrap(s.emote + 1, n) }, ['move']);
      case 'up': case 'back': return out({ ...s, focus: 'actions' }, ['move']);
      case 'confirm': case 'start': return out(s, ['confirm'], [{ type: 'emote', emote: LOBBY_EMOTES[s.emote].id }]);
      default: return out(s);
    }
  }
  // actions row
  switch (a) {
    case 'left': return out({ ...s, action: wrap(s.action - 1, acts.length) }, ['move']);
    case 'right': return out({ ...s, action: wrap(s.action + 1, acts.length) }, ['move']);
    case 'up': return selectable.length && s.role === 'host' ? out({ ...s, focus: 'houses', house: wrap(s.house, selectable.length) }, ['move']) : out(s);
    case 'down': return out({ ...s, focus: 'emotes' }, ['move']);
    case 'confirm': return out(s, ['confirm'], [actionEffect(acts[s.action])]);
    case 'start': return s.role === 'host' ? out({ ...s, action: 0 }, ['confirm'], [{ type: 'start' }]) : out(s);
    case 'back': {
      const leaveAt = acts.indexOf('leave');
      if (s.action === leaveAt) return out(s, ['back'], [{ type: 'leave' }]);
      return out({ ...s, action: leaveAt }, ['move']);
    }
    default: return out(s);
  }
}

const NET_ICON = { ok: '🟢', wobbly: '📶', asleep: '😴' };

/** One-line status of a house (ping icon + words). */
export function houseStatus(h) {
  if (h.isHost) return '👑 host';
  if (h.net === 'asleep') return `${NET_ICON.asleep} napping`;
  if (h.net === 'wobbly') return `${NET_ICON.wobbly} a bit wobbly`;
  return `${NET_ICON.ok} ${Number.isFinite(h.rttMs) && h.rttMs > 0 ? `${Math.round(h.rttMs)} ms` : 'ok'}`;
}

/** The page's own URL (so a localhost / preview build links to itself), else the live site. */
export function pageBaseUrl() {
  try {
    if (typeof location !== 'undefined' && /^https?:/.test(location.href)) return `${location.origin}${location.pathname}`;
  } catch { /* ignore */ }
  return INVITE_BASE_URL;
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'online-lobby',
  net: { role: 'all' },
  mount(ctx, nav, params = {}) {
    const net = ctx.net ?? null;
    const role = net?.role ?? params.role ?? 'host';
    const getLobby = () => (net?.lobby ? net.lobby() : params.lobby) ?? null;
    const code = isRoomCode(net?.code) ? net.code : isRoomCode(params.code) ? params.code : null;
    const getListing = () => {
      try { return (net?.listing ? net.listing() : params.listing) ?? { supported: false, on: false }; } catch { return { supported: false, on: false }; }
    };
    const localHouseId = net?.houseId ?? params.localHouseId ?? (role === 'host' ? 0 : null);
    const link = params.inviteLink ?? (code && role === 'host' ? makeInviteLink(code, pageBaseUrl()) : '');
    let state = createLobbyScreenState({ role, canList: !!getListing().supported });
    let lastLobby = null;
    let lastListKey = '';
    const bubbles = new Map(); // houseId → { emoji, until }
    let clock = 0;

    const msg = el('div.skn-msg', { role: 'status' });
    const lockLine = el('button.skn-lockline', { onclick: (e) => { e.stopPropagation(); if (role === 'host' && getLobby()?.locked) apply([{ type: 'unlock' }]); } });
    const housesEl = el('div.skn-houses');
    const qr = el('div.skn-qr', { 'aria-label': 'Invite QR code' });
    const actionBtns = state.actions.map((id, i) => el(`button.skn-btn.skn-act-${id}`, { onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'pick-action', index: i }); } }));
    const emoteBtns = LOBBY_EMOTES.map((em, i) => el('button.skn-emote', {
      title: em.text, 'aria-label': em.text, onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'pick-emote', index: i }); },
    }, em.emoji));
    const modal = el('div.skn-modal', { hidden: true, onclick: (e) => e.stopPropagation() });

    const listLine = el('div.skn-listline');
    const invitePanel = role === 'host' && code ? el('section.skn-invite', { 'aria-label': 'Room code' },
      el('div.skn-invite-k', {}, 'Room code'),
      el('div.skn-code-big', { 'aria-label': code.split('').join(' ') }, code),
      el('div.skn-invite-how', {}, 'Friends: Online → Join a friend'),
      listLine,
      qr,
      el('div.skn-link', {}, link),
    ) : role === 'guest' ? el('section.skn-invite', {},
      el('div.skn-invite-k', {}, 'You are in'),
      el('div.skn-code-big', {}, getLobby()?.label ?? ''),
      el('div.skn-wait-s', {}, 'Waiting for the host to start… 🍭'),
    ) : null;

    if (role === 'host' && link) {
      inviteQrSvg(link).then((svg) => { qr.innerHTML = svg; }).catch((err) => console.warn('[lobby] qr', err));
    }

    const node = el('div.sk-screen.skn-screen.skn-lobbyscreen', {},
      floatiesLayer(12, 19),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: role === 'host' ? 'Your room <span class="sk-wiggle">🏰</span>' : 'Friends\' room <span class="sk-wiggle">🏡</span>' })),
      lockLine,
      msg,
      el('div.skn-lobby', {}, invitePanel, housesEl),
      el('div.skn-actions', {}, actionBtns),
      el('div.skn-emotes', {}, emoteBtns),
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('A', 'Enter', 'OK'),
        hint('Y', 'Tab', 'Emotes'),
        hint('B', 'Esc', 'Leave'),
      ]),
      modal,
    );

    const guestHouses = (lobby) => (lobby?.houses ?? []).filter((h) => !h.isHost);

    const renderHouses = () => {
      const lobby = getLobby();
      const sel = role === 'host' ? guestHouses(lobby) : [];
      housesEl.innerHTML = '';
      for (const h of lobby?.houses ?? []) {
        const selIndex = sel.indexOf(h);
        const players = [...h.players].sort((a, b) => a.seat - b.seat).map((p) => {
          const def = typeof p.characterId === 'string' ? ctx.char?.(p.characterId) : null;
          const name = def ? def.name : 'Picking a racer… 🎨';
          return `<div class="skn-player">${portraitHtml(def, ctx.portraits, { locked: !def })}<span class="skn-pn">${escapeHtml(name)}</span>${p.ready ? '<span class="skn-ready">✓</span>' : ''}</div>`;
        }).join('');
        const b = bubbles.get(h.houseId);
        const card = el(`button.skn-house${h.net === 'asleep' ? '.skn-asleep' : ''}${h.houseId === localHouseId ? '.skn-mine' : ''}`, {
          onclick: (e) => { e.stopPropagation(); if (selIndex >= 0) handle({ deviceId: 'mouse', action: 'pick-house', index: selIndex }); },
          html: `<div class="skn-house-h"><span class="skn-e">${escapeHtml(h.emoji)}</span><span>${h.houseId === localHouseId ? 'Your house' : h.isHost ? 'Host\'s house' : 'Friends'}</span>`
            + `<span class="skn-net">${escapeHtml(houseStatus(h))}</span></div>${players}`
            + `${b && b.until > clock ? `<span class="skn-emote-bubble">${escapeHtml(b.emoji)}</span>` : ''}`,
        });
        card.classList.toggle('sk-sel', state.focus === 'houses' && selIndex === state.house && !state.modal);
        housesEl.appendChild(card);
      }
      lockLine.textContent = lobby?.locked ? (role === 'host' ? TEXT.roomLocked : "The host's room is closed for now 🔒") : '';
      const li = getListing();
      listLine.textContent = li.supported ? (li.on && !lobby?.locked ? TEXT.listShown : TEXT.listHidden) : '';
    };

    const renderActions = () => {
      const lobby = getLobby();
      const listed = !!getListing().on;
      const labels = {
        start: "🎨 Let's pick!",
        list: listed ? '🙈 Hide from the list' : '👀 Show in the list',
        lock: lobby?.locked ? '🔓 Open the room' : '🔒 No more houses, please',
        copy: '📋 Copy invite link',
        leave: role === 'host' ? '👋 End the room' : '👋 Leave the room',
      };
      actionBtns.forEach((b, i) => {
        b.textContent = labels[state.actions[i]];
        b.classList.toggle('sk-sel', state.focus === 'actions' && i === state.action && !state.modal);
      });
      emoteBtns.forEach((b, i) => b.classList.toggle('sk-sel', state.focus === 'emotes' && i === state.emote && !state.modal));
    };

    const renderModal = () => {
      modal.hidden = !state.modal;
      if (!state.modal) { modal.innerHTML = ''; return; }
      if (state.modal === 'house') {
        const lobby = getLobby();
        const labelFor = (o) => {
          if (o.kind === 'remove-house') return '👋 Remove this house';
          if (o.kind === 'cancel') return '💖 Never mind';
          const h = lobby?.houses?.find((x) => x.houseId === o.houseId);
          const p = h?.players?.find((x) => x.seat === o.seat);
          const def = p?.characterId ? ctx.char?.(p.characterId) : null;
          return `👋 Remove ${def ? escapeHtml(def.name) : `player ${o.seat + 1}`}`;
        };
        modal.innerHTML = '<div class="skn-modal-card skn-housemenu">'
          + '<div class="skn-modal-k">Say bye-bye for now? 👋</div>'
          + '<div class="skn-wait-s">Removing a house also locks the room, so they can\'t pop straight back in.</div>'
          + `<div class="skn-actions">${state.houseOptions.map((o, i) => `<button class="skn-btn ${i === state.modalIndex ? 'sk-sel' : ''}" data-i="${i}">${labelFor(o)}</button>`).join('')}</div>`
          + '</div>';
      }
      modal.querySelectorAll?.('[data-i]')?.forEach?.((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        handle({ deviceId: 'mouse', action: 'select', index: Number(b.dataset.i) });
      }));
    };

    const sync = () => { renderHouses(); renderActions(); renderModal(); };

    const localPis = () => {
      const h = getLobby()?.houses?.find((x) => x.houseId === localHouseId);
      return h ? [...h.players].sort((a, b) => a.seat - b.seat).map((p) => p.globalPi) : [];
    };

    const copyLink = () => {
      const done = (ok) => { msg.textContent = ok ? TEXT.copied : `${TEXT.copyFallback} ${link}`; };
      try {
        const p = globalThis.navigator?.clipboard?.writeText?.(link);
        if (p?.then) p.then(() => done(true), () => done(false));
        else done(false);
      } catch { done(false); }
    };

    function apply(effects) {
      for (const e of effects) {
        switch (e.type) {
          case 'list': net?.setListed?.(e.on); break;
          case 'remove-house': net?.dispatch?.({ type: 'remove-house', houseId: e.houseId }); break;
          case 'remove-seat': net?.dispatch?.({ type: 'remove-seat', houseId: e.houseId, seat: e.seat }); break;
          case 'lock': net?.dispatch?.({ type: 'lock' }); break;
          case 'unlock': net?.dispatch?.({ type: 'unlock' }); break;
          case 'copy': copyLink(); break;
          case 'start':
            if (ctx.online?.pick) ctx.online.pick();
            else msg.textContent = TEXT.comingSoon;
            break;
          case 'leave':
            if (ctx.online?.leave) ctx.online.leave();
            else if (net?.dispatch) net.dispatch({ type: role === 'host' ? 'close' : 'leave' });
            else nav.goto('online-hub');
            break;
          case 'emote': {
            const pi = localPis()[0];
            if (pi !== undefined) net?.dispatch?.({ type: 'emote', globalPi: pi, emote: e.emote });
            showBubble(localHouseId, e.emote);
            break;
          }
          default: break;
        }
      }
    }

    function showBubble(houseId, emoteId) {
      const em = LOBBY_EMOTES.find((x) => x.id === emoteId);
      if (houseId === null || houseId === undefined || !em) return;
      bubbles.set(houseId, { emoji: em.emoji, until: clock + 2.2 });
      renderHouses();
    }

    const selectableNow = () => (role === 'host' ? guestHouses(getLobby()) : []);
    const handle = (ev) => {
      const res = lobbyScreenReduce(state, ev, { lobby: getLobby(), selectable: selectableNow(), listed: !!getListing().on });
      state = res.state;
      ctx.fx?.(res);
      apply(res.effects);
      sync();
      if (res.shake) shake(modal.querySelector?.('.skn-modal-card'));
    };

    // Remote emotes → bubbles on their house card.
    const offEffect = net?.onEffect?.((e) => {
      if (e?.type !== 'emote') return;
      const h = getLobby()?.houses?.find((x) => x.players.some((p) => p.globalPi === e.globalPi));
      if (h && h.houseId !== localHouseId) showBubble(h.houseId, e.emote);
    });

    const update = (dt = 1 / 60) => {
      clock += dt;
      const lobby = getLobby();
      const li = getListing();
      const listKey = `${li.supported}|${li.on}`;
      if (lobby !== lastLobby || listKey !== lastListKey) {
        lastLobby = lobby;
        lastListKey = listKey;
        sync();
      }
      for (const [hid, b] of bubbles) if (b.until <= clock) { bubbles.delete(hid); renderHouses(); }
    };

    update(0);
    return {
      node,
      cls: 'sk-mode-full skn-mode-online',
      handle,
      update,
      refresh: sync,
      destroy() { try { offEffect?.(); } catch { /* ignore */ } },
    };
  },
};
