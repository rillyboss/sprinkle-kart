/**
 * Guest session state machine (NETWORKING.md §7.1, §10.2, §13).
 *
 *   idle → connecting (signaling, ICE ≤ 15 s) → handshake → waiting-approval (shows the match
 *   check) → joined → follows PHASE (lobby | net-waiting | characters | loading | race | results …)
 *   → ended: removed | host-gone | version | declined | locked | full | not-found | no-connect | left
 *   → back to the Online hub with a friendly sentence.
 *
 * `guestReduce(state, ev) → { state, effects }` is pure; `createGuestSession()` wraps it
 * like createHostSession (same shape: { state, dispatch, onEffect, lobby }).
 *
 * Events: connect · connected · connect-failed · message · heard · host-leave · intent ·
 * emote · leave · tick.
 * Effects: { type: 'send', msg } · { type: 'join-signaling', secret } · { type: 'leave-signaling' } ·
 * { type: 'screen', id, params } · { type: 'lobby', lobby } · { type: 'phase', phase, screen, params } ·
 * { type: 'token', token } · { type: 'seat-removed', seat } · { type: 'emote', globalPi, emote } ·
 * { type: 'choice', screen, choice } · { type: 'ended', reason, text }.
 *
 * OWNER: WS6 (session, lobby & screens).
 */
import { drawMatch, matchEmoji, isMatch } from './approval.js';
import { TEXT, rejectText, signalingErrorText } from './texts.js';
import {
  buildIdentity, jsonEncode, jsonDecode, isToken, REJECT_REASONS, EMOTE_COUNT, EMOTE_INTERVAL_MS, BYE,
} from './wire.js';
import { canHost, currentPlatform } from '../platform.js';
import { MAX_LOCAL_PLAYERS } from '../../config.js';
import { localCapacity } from './lobby.js';

/** Signaling + ICE (15 s incl. one restart) + a little slack. */
export const CONNECT_TIMEOUT_MS = 20_000;
/** No packet from the host for this long = the host is gone (§7.4, §13.3). */
export const HOST_SILENT_MS = 8_000;

export function createGuestState({ secret, localPlayers = 1, mine = buildIdentity(), token = null, canHostFlag = true } = /** @type {any} */ ({})) {
  return {
    phase: 'idle',
    secret: secret ? { label: secret.label, sweets: [...secret.sweets] } : null,
    localPlayers: Math.max(1, Math.min(MAX_LOCAL_PLAYERS, localPlayers | 0 || 1)),
    mine,
    canHost: !!canHostFlag,
    token: isToken(token) ? token : null,
    match: null,
    hostPeerId: null,
    houseId: null,
    emoji: null,
    lobby: null,
    hostPhase: null,
    end: null,
    since: 0,
    lastHeard: 0,
    emotes: {},
    now: 0,
  };
}

const LIVE = ['connecting', 'handshake', 'waiting-approval', 'joined'];

export function guestReduce(state, ev) {
  const effects = [];
  let st = { ...state, now: Number.isFinite(ev?.now) ? ev.now : state.now };
  const send = (msg) => effects.push({ type: 'send', msg });
  const end = (reason, text) => {
    st = { ...st, phase: 'ended', end: { reason, text } };
    effects.push(
      { type: 'leave-signaling' },
      { type: 'ended', reason, text },
      { type: 'screen', id: 'online-hub', params: { message: text } },
    );
  };

  switch (ev?.type) {
    case 'connect': {
      if (LIVE.includes(st.phase)) break;
      const match = isMatch(ev.match) ? [...ev.match] : drawMatch(); // fresh per attempt, never reused
      st = { ...st, phase: 'connecting', match, since: st.now, lastHeard: st.now, end: null, hostPeerId: null, houseId: null, lobby: null };
      effects.push(
        { type: 'join-signaling', secret: st.secret },
        { type: 'screen', id: 'net-waiting', params: { mode: 'connecting', text: TEXT.knocking, label: st.secret?.label ?? '' } },
      );
      break;
    }

    case 'connected': {
      if (st.phase !== 'connecting') break;
      st = { ...st, phase: 'waiting-approval', hostPeerId: ev.peerId ?? null, lastHeard: st.now, since: st.now };
      const hello = {
        type: 'HELLO', proto: st.mine.proto, build: st.mine.build, content: st.mine.content,
        house: { localPlayers: st.localPlayers }, canHost: st.canHost, match: [...st.match],
      };
      if (st.token) hello.token = st.token;
      send(hello);
      const animals = matchEmoji(st.match);
      effects.push({ type: 'screen', id: 'net-waiting', params: { mode: 'approval', text: TEXT.showHost(animals), animals, match: [...st.match], label: st.secret?.label ?? '' } });
      break;
    }

    case 'connect-failed':
      if (!['connecting', 'handshake'].includes(st.phase)) break;
      end(ev.code === 'ice' ? 'no-connect' : ev.code === 'unreachable' ? 'unreachable' : 'not-found',
        ev.code === 'ice' ? TEXT.noConnect : signalingErrorText(ev.code));
      break;

    case 'heard':
      if (LIVE.includes(st.phase)) st = { ...st, lastHeard: st.now };
      break;

    case 'message': {
      const m = ev.msg;
      if (!m || !LIVE.includes(st.phase)) break;
      st = { ...st, lastHeard: st.now };
      switch (m.type) {
        case 'WELCOME':
          if (st.phase !== 'waiting-approval') break;
          st = {
            ...st, phase: 'joined', houseId: m.houseId, emoji: m.emoji, token: isToken(m.token) ? m.token : st.token, lobby: m.lobby ?? null, hostPhase: m.lobby?.phase ?? 'lobby',
          };
          if (st.token) effects.push({ type: 'token', token: st.token });
          effects.push({ type: 'lobby', lobby: st.lobby }, { type: 'screen', id: 'online-lobby', params: { role: 'guest' } });
          break;
        case 'REJECT': {
          const reason = REJECT_REASONS.includes(m.reason) ? m.reason : 'declined';
          end(reason, rejectText(reason, m.detail ?? null));
          break;
        }
        case 'LOBBY':
          if (st.phase !== 'joined' || !m.lobby) break;
          st = { ...st, lobby: m.lobby };
          effects.push({ type: 'lobby', lobby: m.lobby });
          break;
        case 'PHASE':
          if (st.phase !== 'joined') break;
          st = { ...st, hostPhase: m.phase };
          effects.push({ type: 'phase', phase: m.phase, screen: m.screen ?? null, params: m.params ?? {} });
          break;
        case 'KICK':
          if (st.phase !== 'joined') break;
          if (m.scope === 1) effects.push({ type: 'seat-removed', seat: m.seat });
          else end('removed', TEXT.removed);
          break;
        case 'BYE':
          if (m.reason === BYE.removed) end('removed', TEXT.removed);
          else end('host-gone', TEXT.hostGone);
          break;
        case 'EMOTE':
          if (st.phase === 'joined' && Number.isInteger(m.emote) && m.emote >= 0 && m.emote < EMOTE_COUNT) {
            effects.push({ type: 'emote', globalPi: m.globalPi, emote: m.emote });
          }
          break;
        case 'CHOICE':
          if (st.phase === 'joined') effects.push({ type: 'choice', screen: m.screen, choice: m.choice });
          break;
        default:
          break;
      }
      break;
    }

    case 'host-leave':
      if (!LIVE.includes(st.phase) || st.phase === 'connecting') break;
      end('host-gone', TEXT.hostGone);
      break;

    case 'intent':
      if (st.phase !== 'joined' || !ev.intent) break;
      send({ type: 'INTENT', ...ev.intent });
      break;

    case 'emote': {
      if (st.phase !== 'joined') break;
      const e = Number(ev.emote);
      const pi = Number(ev.globalPi);
      if (!Number.isInteger(e) || e < 0 || e >= EMOTE_COUNT) break;
      const mine = st.lobby?.houses?.find((h) => h.houseId === st.houseId)?.players?.some((p) => p.globalPi === pi);
      if (!mine) break;
      const last = st.emotes[pi];
      if (last !== undefined && st.now - last < EMOTE_INTERVAL_MS) break;
      st = { ...st, emotes: { ...st.emotes, [pi]: st.now } };
      send({ type: 'EMOTE', globalPi: pi, emote: e });
      break;
    }

    case 'leave':
      if (!LIVE.includes(st.phase)) break;
      if (st.phase !== 'connecting') send({ type: 'BYE', reason: BYE.leaving });
      st = { ...st, phase: 'ended', end: { reason: 'left', text: '' } };
      effects.push({ type: 'leave-signaling' }, { type: 'ended', reason: 'left', text: '' }, { type: 'screen', id: 'online-hub', params: {} });
      break;

    case 'tick':
      if (st.phase === 'connecting' && st.now - st.since >= CONNECT_TIMEOUT_MS) end('no-connect', TEXT.noConnect);
      else if ((st.phase === 'joined' || st.phase === 'waiting-approval') && st.now - st.lastHeard >= HOST_SILENT_MS) end('host-gone', TEXT.hostGone);
      break;

    default:
      break;
  }
  return { state: st, effects };
}

/**
 * The `ctx.net` object the menus use on a GUEST: host-only screens become net-waiting
 * (Menus.goto), the lobby screen reads the replicated LobbyState, and the join screen caps
 * at this house's seats + the room's free seats. Guests never compose a setup (SETUP comes
 * from the host), so `composeSetup` is absent.
 * @param {ReturnType<typeof createGuestSession>} session
 */
export function createGuestNetContext(session) {
  return {
    role: 'guest',
    get secret() { return session.state.secret; },
    get houseId() { return session.state.houseId; },
    lobby: () => session.lobby(),
    prompt: () => null,
    dispatch: (ev) => session.dispatch(ev),
    onEffect: (fn) => session.onEffect(fn),
    seatsLeft: () => {
      const l = session.lobby();
      return l ? localCapacity(l, session.state.houseId) : session.state.localPlayers;
    },
    waitingParams: () => ({}),
  };
}

/**
 * The live guest session (same shape as createHostSession).
 * @param {object} o
 * @param {object} [o.transport]    NetTransport; the only peer a guest sees is the host
 * @param {object[]} [o.signalings]
 * @param {{ label: string, sweets: number[] }} o.secret
 * @param {number} o.localPlayers   1..4 players on this machine
 * @param {() => number} [o.now]
 * @param {object} [o.mine]         buildIdentity()
 * @param {string|null} [o.token]   reconnect token from sessionStorage (M2)
 * @param {object} [o.platform]     { userAgent, platform, maxTouchPoints } for HELLO.canHost
 */
export function createGuestSession({
  transport = null, signalings = [], secret, localPlayers = 1, now = () => Date.now(), mine = buildIdentity(),
  token = null, platform = currentPlatform(), encode = jsonEncode, decode = jsonDecode,
} = /** @type {any} */ ({})) {
  void signalings;
  let state = createGuestState({ secret, localPlayers, mine, token, canHostFlag: canHost(platform) });
  const listeners = new Set();
  const offs = [];
  const run = (e) => {
    try {
      if (e.type === 'send' && state.hostPeerId) transport?.send?.(state.hostPeerId, 'ctrl', encode(e.msg));
    } catch (err) { console.warn('[guest-session] effect', e.type, err); }
    for (const fn of listeners) { try { fn(e); } catch (err) { console.warn('[guest-session] listener', err); } }
  };
  const session = {
    get state() { return state; },
    dispatch(ev) {
      const r = guestReduce(state, { now: now(), ...ev });
      state = r.state;
      r.effects.forEach(run);
      return r.effects;
    },
    onEffect(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    lobby() { return state.lobby; },
    dispose() { offs.splice(0).forEach((off) => { try { off(); } catch { /* ignore */ } }); listeners.clear(); },
  };
  if (transport?.onPeer) {
    offs.push(transport.onPeer((p) => {
      if (p.type === 'join') session.dispatch({ type: 'connected', peerId: p.peerId });
      else if (p.peerId === state.hostPeerId) session.dispatch({ type: 'host-leave' });
    }));
  }
  if (transport?.onMessage) {
    offs.push(transport.onMessage((peerId, ch, bytes) => {
      if (peerId !== state.hostPeerId) return;
      if (ch !== 'ctrl') { session.dispatch({ type: 'heard' }); return; }
      const msg = decode(bytes);
      if (msg) session.dispatch({ type: 'message', msg });
      else session.dispatch({ type: 'heard' });
    }));
  }
  return session;
}
