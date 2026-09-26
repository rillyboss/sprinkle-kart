/**
 * Guest session state machine (NETWORKING.md §7.1, §10.2, §13).
 *
 *   idle → connecting (signaling, ICE ≤ 15 s) → knocking (HELLO sent, waiting for WELCOME; friends with the
 *   code come straight in) → joined → follows PHASE (lobby | net-waiting | characters | loading | race | results …)
 *   joined → reconnecting (the link dropped / the host went quiet: "Reconnecting… 🔌", a fresh matchmaker +
 *   connection, HELLO with the WELCOME token re-attaches the same house, §13.2) → joined
 *   → ended: removed | host-gone | net-nap | version | declined | locked | full | not-found | no-connect | left
 *   → back to the Online hub with a friendly sentence.
 *
 * Heartbeat (§7.4): the guest sends KEEP whenever it sent nothing for KEEPALIVE_MS (knocking and joined);
 * any byte from the host on any channel counts as heard. "No host appeared on signaling at all" (a wrong
 * code, or that game ended) and "the host appeared but the connection never opened" (NAT) end differently.
 *
 * `guestReduce(state, ev) → { state, effects }` is pure; `createGuestSession()` wraps it
 * like createHostSession (same shape: { state, dispatch, onEffect, lobby }).
 *
 * Events: connect · connected · connect-failed · host-seen · message · heard · host-leave · intent ·
 * emote · leave · tick { online? }.
 * Effects: { type: 'send', msg } · { type: 'join-signaling', code } · { type: 'leave-signaling' } ·
 * { type: 'screen', id, params } · { type: 'lobby', lobby } · { type: 'phase', phase, screen, params } ·
 * { type: 'token', token } · { type: 'seat-removed', seat } · { type: 'emote', globalPi, emote } ·
 * { type: 'choice', screen, choice } · { type: 'ended', reason, text } ·
 * { type: 'reconnect', attempt } (open a fresh matchmaker + connection) · { type: 'net-state', reconnecting, text }.
 *
 * OWNER: WS6 (session, lobby & screens).
 */
import { TEXT, rejectText, signalingErrorText } from './texts.js';
import {
  buildIdentity, jsonEncode, jsonDecode, isToken, REJECT_REASONS, EMOTE_COUNT, EMOTE_INTERVAL_MS, BYE, KEEPALIVE_MS,
} from './wire.js';
import { canHost, currentPlatform } from '../platform.js';
import { MAX_LOCAL_PLAYERS } from '../../config.js';
import { localCapacity } from './lobby.js';

/** Signaling + ICE (15 s incl. one restart) + a little slack. */
export const CONNECT_TIMEOUT_MS = 20_000;
/**
 * No packet from the host for this long (it sends KEEP every second even in a quiet lobby) = the link is down:
 * a joined house starts reconnecting, a house still knocking goes back to the hub (§7.4, §13.3).
 */
export const HOST_SILENT_MS = 8_000;
/**
 * How long a joined house keeps trying to come back before giving up (§13.2). Longer than the transport's ICE
 * failure grace (10 s) plus a fresh matchmaker round, so a Wi-Fi hiccup of 10–20 s costs nothing but a few
 * seconds of Robo Driver.
 */
export const RECONNECT_GIVE_UP_MS = 30_000;
/** When the reconnect attempts start (ms after the link dropped): a fresh matchmaker + connection each. */
export const RECONNECT_ATTEMPTS_MS = Object.freeze([0, 3_000, 7_000, 12_000, 18_000, 24_000]);

export function createGuestState({ code = '', localPlayers = 1, mine = buildIdentity(), token = null, canHostFlag = true } = /** @type {any} */ ({})) {
  return {
    phase: 'idle',
    code: typeof code === 'string' ? code : '',
    localPlayers: Math.max(1, Math.min(MAX_LOCAL_PLAYERS, localPlayers | 0 || 1)),
    mine,
    canHost: !!canHostFlag,
    token: isToken(token) ? token : null,
    seen: false,        // a host showed up on signaling during this attempt (NAT trouble vs a wrong code)
    lastSent: 0,        // last ctrl send (KEEP heartbeat)
    online: true,       // navigator.onLine as last reported by the wrapper
    reconnect: null,    // { since, attempts } while reconnecting
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

const LIVE = ['connecting', 'knocking', 'joined', 'reconnecting'];

export function guestReduce(state, ev) {
  const effects = [];
  let st = { ...state, now: Number.isFinite(ev?.now) ? ev.now : state.now };
  if (typeof ev?.online === 'boolean') st.online = ev.online;
  const send = (msg) => { effects.push({ type: 'send', msg }); st = { ...st, lastSent: st.now }; };
  const end = (reason, text) => {
    const wasReconnecting = st.phase === 'reconnecting';
    st = { ...st, phase: 'ended', end: { reason, text }, reconnect: null };
    if (wasReconnecting) effects.push({ type: 'net-state', reconnecting: false, text: '' });
    effects.push(
      { type: 'leave-signaling' },
      { type: 'ended', reason, text },
      { type: 'screen', id: 'online-hub', params: { message: text, ...(reason === 'no-connect' ? { tips: [...TEXT.noConnectTips] } : {}) } },
    );
  };
  /** The link to the host is gone: a house with a token tries to come back, anyone else goes home. */
  const lost = () => {
    const offline = st.online === false;
    if (st.phase === 'joined' && st.token) {
      const text = offline ? TEXT.netNap : TEXT.reconnecting;
      st = { ...st, phase: 'reconnecting', hostPeerId: null, reconnect: { since: st.now, attempts: 1 } };
      effects.push(
        { type: 'reconnect', attempt: 0 },
        { type: 'net-state', reconnecting: true, text },
        { type: 'screen', id: 'net-waiting', params: { mode: 'connecting', text, label: st.code } },
      );
      return;
    }
    if (offline) end('net-nap', TEXT.netNapEnd);
    else end('host-gone', TEXT.hostGone);
  };

  switch (ev?.type) {
    case 'connect': {
      if (LIVE.includes(st.phase)) break;
      st = { ...st, phase: 'connecting', since: st.now, lastHeard: st.now, end: null, hostPeerId: null, houseId: null, lobby: null, seen: false, reconnect: null };
      effects.push(
        { type: 'join-signaling', code: st.code },
        { type: 'screen', id: 'net-waiting', params: { mode: 'connecting', text: TEXT.knocking, label: st.code } },
      );
      break;
    }

    case 'connected': {
      if (st.phase === 'reconnecting') {
        // a fresh connection to the host: knock again with our ticket (same house and seats)
        if (st.hostPeerId) break;
        st = { ...st, hostPeerId: ev.peerId ?? null, lastHeard: st.now, seen: true };
        send({
          type: 'HELLO', proto: st.mine.proto, build: st.mine.build, content: st.mine.content,
          house: { localPlayers: st.localPlayers }, canHost: st.canHost, token: st.token,
        });
        break;
      }
      if (st.phase !== 'connecting') break;
      st = { ...st, phase: 'knocking', hostPeerId: ev.peerId ?? null, lastHeard: st.now, since: st.now, seen: true };
      const hello = {
        type: 'HELLO', proto: st.mine.proto, build: st.mine.build, content: st.mine.content,
        house: { localPlayers: st.localPlayers }, canHost: st.canHost,
      };
      if (st.token) hello.token = st.token;
      send(hello);
      break;
    }

    case 'connect-failed':
      if (st.phase === 'reconnecting') {
        // the host said no this time (locked / full) → home; a missing matchmaker just means "try again"
        if (ev.code === 'locked' || ev.code === 'full') end(ev.code, signalingErrorText(ev.code));
        else st = { ...st, hostPeerId: null };
        break;
      }
      if (!['connecting', 'knocking'].includes(st.phase)) break;
      if (ev.code === 'locked' || ev.code === 'full') { end(ev.code, signalingErrorText(ev.code)); break; }
      end(ev.code === 'ice' ? 'no-connect' : ev.code === 'unreachable' ? 'unreachable' : 'not-found',
        ev.code === 'ice' ? TEXT.noConnect : signalingErrorText(ev.code));
      break;

    case 'host-seen':
      // signaling surfaced the host (a connection is being made): a timeout now means NAT trouble, not a typo
      if (st.phase === 'connecting' || st.phase === 'reconnecting') st = { ...st, seen: true };
      break;

    case 'heard':
      if (LIVE.includes(st.phase)) st = { ...st, lastHeard: st.now };
      break;

    case 'message': {
      const m = ev.msg;
      if (!m || !LIVE.includes(st.phase)) break;
      st = { ...st, lastHeard: st.now };
      switch (m.type) {
        case 'WELCOME': {
          if (st.phase !== 'knocking' && st.phase !== 'reconnecting') break;
          const back = st.phase === 'reconnecting';
          st = {
            ...st, phase: 'joined', houseId: m.houseId, emoji: m.emoji, token: isToken(m.token) ? m.token : st.token, lobby: m.lobby ?? null, hostPhase: m.lobby?.phase ?? 'lobby', reconnect: null,
          };
          if (st.token) effects.push({ type: 'token', token: st.token });
          if (back) effects.push({ type: 'net-state', reconnecting: false, text: '' }, { type: 'reattached', houseId: st.houseId });
          effects.push({ type: 'lobby', lobby: st.lobby }, { type: 'screen', id: 'online-lobby', params: { role: 'guest' } });
          break;
        }
        case 'REJECT': {
          const reason = REJECT_REASONS.includes(m.reason) ? m.reason : 'declined';
          end(reason, rejectText(reason, m.detail ?? null));
          break;
        }
        case 'KEEP':
          break; // heard (above) is all a heartbeat does
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
      if (st.phase === 'reconnecting') { st = { ...st, hostPeerId: null }; break; } // the next attempt follows
      if (!LIVE.includes(st.phase) || st.phase === 'connecting') break;
      lost();
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
      if (st.phase === 'connecting' && st.now - st.since >= CONNECT_TIMEOUT_MS) {
        // nobody ever answered on the matchmaker = a wrong code or no host (§13.5); a host that showed
        // up but whose connection never opened = the NAT tips (§13.4)
        if (st.seen) end('no-connect', TEXT.noConnect);
        else end('not-found', TEXT.notFound);
      } else if ((st.phase === 'joined' || st.phase === 'knocking') && st.now - st.lastHeard >= HOST_SILENT_MS) {
        lost();
      } else if (st.phase === 'reconnecting') {
        const r = st.reconnect;
        if (st.now - r.since >= RECONNECT_GIVE_UP_MS) {
          if (st.online === false) end('net-nap', TEXT.netNapEnd);
          else end('host-gone', TEXT.hostGone);
        } else if (!st.hostPeerId && r.attempts < RECONNECT_ATTEMPTS_MS.length && st.now - r.since >= RECONNECT_ATTEMPTS_MS[r.attempts]) {
          st = { ...st, reconnect: { ...r, attempts: r.attempts + 1 } };
          effects.push({ type: 'reconnect', attempt: r.attempts });
        } else if (st.hostPeerId && st.now - st.lastHeard >= HOST_SILENT_MS) {
          st = { ...st, hostPeerId: null }; // that attempt went nowhere: the next one opens a fresh connection
        }
        if (st.phase === 'reconnecting' && state.online !== st.online) {
          effects.push({ type: 'net-state', reconnecting: true, text: st.online === false ? TEXT.netNap : TEXT.reconnecting });
        }
      }
      // KEEP heartbeat: the host hears from us at least once a second while we wait or play (§7.4)
      if ((st.phase === 'joined' || st.phase === 'knocking') && st.now - st.lastSent >= KEEPALIVE_MS) send({ type: 'KEEP' });
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
    get code() { return session.state.code; },
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
 * @param {string} o.code           the room code ('CAKE')
 * @param {number} o.localPlayers   1..4 players on this machine
 * @param {() => number} [o.now]
 * @param {object} [o.mine]         buildIdentity()
 * @param {string|null} [o.token]   reconnect token (default: the one tokenStore remembers for this room)
 * @param {object} [o.platform]     { userAgent, platform, maxTouchPoints } for HELLO.canHost
 * @param {{ load: (code) => string|null, save: (code, token) => void, clear: (code) => void }|null} [o.tokenStore]
 *   where the WELCOME ticket lives (sessionStorage in the game): a reload of this tab re-attaches its house
 */
export function createGuestSession({
  transport = null, signalings = [], code = '', localPlayers = 1, now = () => Date.now(), mine = buildIdentity(),
  token = null, platform = currentPlatform(), encode = jsonEncode, decode = jsonDecode, tokenStore = null,
} = /** @type {any} */ ({})) {
  void signalings;
  let remembered = null;
  try { remembered = token ?? tokenStore?.load?.(code) ?? null; } catch { remembered = null; }
  let state = createGuestState({ code, localPlayers, mine, token: remembered, canHostFlag: canHost(platform) });
  const listeners = new Set();
  const offs = [];
  const run = (e) => {
    try {
      if (e.type === 'send' && state.hostPeerId) transport?.send?.(state.hostPeerId, 'ctrl', encode(e.msg));
      if (e.type === 'token' && tokenStore) tokenStore.save(state.code, e.token);
      if (e.type === 'ended' && tokenStore && e.reason !== 'net-nap' && e.reason !== 'host-gone') tokenStore.clear(state.code);
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
