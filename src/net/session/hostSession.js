/**
 * Host session state machine (NETWORKING.md §7.1, §10.2, §10.9, §13).
 *
 *   idle → opening (signaling join on every matchmaker, the room code shown) → lobby
 *   lobby → mode → characters → course → loading → race → results → (again | next) → loading …
 *   results → lobby ("Back to the lobby") → … → closing (host ends) → idle
 *
 * `hostReduce(state, ev) → { state, effects }` is pure (tested without a browser);
 * `createHostSession()` wraps it: it keeps the state, runs the transport /
 * signaling effects and tells listeners (`onEffect`) about everything else
 * (screens, lobby refreshes, emotes).
 *
 * Events: open · opened · open-failed · peer-join · peer-leave · hello ·
 * intent · host-intent · remove-house · remove-seat · lock · unlock · choice · phase ·
 * emote · peer-net · tick · close. Each may carry `now` (ms).
 *
 * Effects: { type: 'send', peerId, msg } · { type: 'disconnect', peerId } ·
 * { type: 'setLocked', locked } · { type: 'drop', peerId } · { type: 'join-signaling' } ·
 * { type: 'leave-signaling' } · { type: 'lobby', lobby } ·
 * { type: 'emote', globalPi, emote } · { type: 'error', text } · { type: 'phase', phase } ·
 * { type: 'reattach', houseId, peerId } (a house came back with its token: the race hands its karts back).
 *
 * Friends with the room code come straight in (no approval prompt: a handful of friends, NETWORKING.md §1
 * rule 3). Kid-safety rules enforced here: a locked room refuses new houses; removing a house locks the room
 * (a reload with a new peer id is refused until the host unlocks); a valid reconnect token re-attaches its
 * house even while locked (the house was never removed); a house that joins while the host is already
 * picking follows straight into the picking screens; LOBBY sends are coalesced to ≤ 4/s per guest and never
 * sent mid-race.
 *
 * OWNER: WS6 (session, lobby & screens).
 */
import {
  createLobby, lobbyReduce, lobbyForWire, seatsLeft, getHouse, hostHouse, houseOfPi, localCapacity, activePlayers, LOBBY_SEND_INTERVAL_MS,
} from './lobby.js';
import { composeOnlineSetup, cpuCountFor } from './composeSetup.js';
import { rejectText, signalingErrorText } from './texts.js';
import {
  compatible as defaultCompatible, buildIdentity, jsonEncode, jsonDecode, randomToken, isToken,
  INTENT_KINDS, EMOTE_COUNT, EMOTE_INTERVAL_MS, BYE, TICK_HZ, KEEPALIVE_MS,
} from './wire.js';
import { MAX_LOCAL_PLAYERS } from '../../config.js';

/** Phases in which a race runs: LOBBY waits (§6.2, §10.4). */
export const RACING_PHASES = Object.freeze(['loading', 'race']);
/** A peer that never says HELLO is let go after this long. */
export const HELLO_TIMEOUT_MS = 15_000;
/**
 * A house whose connection dropped (no BYE) stays `asleep` this long, seats and globalPi kept, so its reload or
 * its automatic reconnect re-attaches with the WELCOME token (§13.2). Mid-race Robo Driver has its karts; an
 * asleep house never holds up "everyone ready" and gets no karts in a new race. After the window (and never
 * during a race) it is removed.
 */
export const RECONNECT_WINDOW_MS = 60_000;
/** A joined guest the host has not heard from for this long shows as `wobbly` 📶 in the lobby (§7.4). */
export const GUEST_WOBBLY_MS = 3_000;

/**
 * @param {{ code: string, hostPlayers?: number|Array<{easyDrive?:boolean}>, mine?: object }} o
 */
export function createHostState({ code = '', hostPlayers = 1, mine = buildIdentity() } = /** @type {any} */ ({})) {
  const c = typeof code === 'string' ? code : '';
  return {
    phase: 'idle',
    code: c,
    hostPlayers,
    mine,
    lobby: createLobby({ label: c }),
    peers: {},   // peerId → { stage: 'hello-wait'|'joined'|'gone', since, houseId?, token? }
    tokens: {},  // token → houseId (M2 reconnect)
    asleep: {},  // houseId → { at, bye } houses whose connection went (removed after RECONNECT_WINDOW_MS / a BYE)
    keep: {},    // peerId → last ctrl send ms (KEEP heartbeat)
    sent: {},    // peerId → { last, dirty } LOBBY coalescing
    emotes: {},  // globalPi → last emote ms
    now: 0,
  };
}

const racing = (st) => RACING_PHASES.includes(st.phase);
const joinedPeers = (st) => Object.keys(st.peers).filter((p) => st.peers[p].stage === 'joined');
const peerOfHouse = (st, houseId) => Object.keys(st.peers).find((p) => st.peers[p].stage === 'joined' && st.peers[p].houseId === houseId) ?? null;

/**
 * @param {{ makeToken?: () => string, compatible?: (mine, theirs) => { ok: boolean } }} [deps]
 */
export function createHostReducer({ makeToken = randomToken, compatible = defaultCompatible, isCharacter = null } = {}) {
  return function hostReduce(state, ev) {
    const effects = [];
    let st = { ...state, now: Number.isFinite(ev?.now) ? ev.now : state.now };
    const prevLobby = state.lobby;

    const send = (peerId, msg) => effects.push({ type: 'send', peerId, msg });
    const fresh = new Set(); // peers that got the whole lobby in WELCOME during this event
    const reject = (peerId, reason, detail) => {
      send(peerId, detail ? { type: 'REJECT', reason, detail } : { type: 'REJECT', reason });
      effects.push({ type: 'disconnect', peerId });
      st = { ...st, peers: { ...st.peers, [peerId]: { ...(st.peers[peerId] ?? {}), stage: 'gone' } } };
    };
    const applyLobby = (action) => {
      const r = lobbyReduce(st.lobby, action);
      st = { ...st, lobby: r.lobby };
      for (const e of r.effects) {
        if (e.type === 'setLocked') effects.push(e);
        else if (e.type === 'drop' && e.peerId) effects.push({ type: 'drop', peerId: e.peerId }, { type: 'disconnect', peerId: e.peerId });
      }
      return r;
    };
    /** A new house with the room code: straight in (the lobby still refuses when it is full). */
    const admit = (peerId, localPlayers) => {
      const before = new Set(st.lobby.houses.map((h) => h.houseId));
      const r = applyLobby({ type: 'house-approve', players: localPlayers });
      if (r.effects.some((e) => e.type === 'refused')) { reject(peerId, racing(st) ? 'in-race-full' : 'full'); return; }
      welcome(peerId, r.lobby.houses.find((h) => !before.has(h.houseId)));
    };
    const welcome = (peerId, house) => {
      fresh.add(peerId);
      const token = makeToken();
      st = {
        ...st,
        peers: { ...st.peers, [peerId]: { ...st.peers[peerId], stage: 'joined', houseId: house.houseId, token, joinedAt: st.now } },
        tokens: { ...st.tokens, [token]: house.houseId },
        sent: { ...st.sent, [peerId]: { last: st.now, dirty: false } },
      };
      send(peerId, {
        type: 'WELCOME', houseId: house.houseId, emoji: house.emoji, token, hostBuild: st.mine.build, tickHz: TICK_HZ, lobby: lobbyForWire(st.lobby),
      });
      // Not in the lobby (racing, or the host is already picking): follow the host at once, so a friend who
      // joins while everyone picks racers lands in the racer screen too.
      if (st.phase !== 'lobby') send(peerId, { type: 'PHASE', phase: st.phase, screen: null, params: {} });
    };
    const dropTokens = (houseId) => {
      st = { ...st, tokens: Object.fromEntries(Object.entries(st.tokens).filter(([, hid]) => hid !== houseId)) };
    };
    const forgetAsleep = (houseId) => {
      if (!Object.hasOwn(st.asleep, houseId)) return;
      const asleep = { ...st.asleep };
      delete asleep[houseId];
      st = { ...st, asleep };
    };
    const removeHouse = (houseId) => {
      forgetAsleep(houseId);
      dropTokens(houseId);
      if (getHouse(st.lobby, houseId)) applyLobby({ type: 'house-leave', houseId });
    };
    /** Asleep houses whose BYE came mid-race or whose reconnect window ran out go (never during a race). */
    const expireAsleep = () => {
      if (racing(st)) return;
      for (const [id, info] of Object.entries(st.asleep)) {
        const houseId = Number(id);
        if (peerOfHouse(st, houseId)) { forgetAsleep(houseId); continue; }
        if (info.bye || st.now - info.at >= RECONNECT_WINDOW_MS) removeHouse(houseId);
      }
    };
    const houseOfPeer = (peerId) => (st.peers[peerId]?.stage === 'joined' ? st.peers[peerId].houseId : null);
    const intentToLobby = (houseId, it) => {
      if (!it || !INTENT_KINDS.includes(it.kind)) return;
      const seat = Number.isInteger(it.seat) && it.seat >= 0 && it.seat < MAX_LOCAL_PLAYERS ? it.seat : null;
      switch (it.kind) {
        case 'seat-join': applyLobby({ type: 'seat-join', houseId, seat, easyDrive: !!it.easyDrive }); break;
        case 'seat-leave': if (seat !== null) applyLobby({ type: 'seat-leave', houseId, seat }); break;
        case 'pick':
          // a racer this build doesn't know (an old tab) is never accepted into the roster
          if (seat !== null && (it.characterId == null || !isCharacter || isCharacter(it.characterId))) {
            applyLobby({ type: 'pick', houseId, seat, characterId: it.characterId ?? null, paintId: it.paintId, easyDrive: it.easyDrive });
          }
          break;
        case 'ready': if (seat !== null) applyLobby({ type: 'ready', houseId, seat, ready: true }); break;
        case 'unready': if (seat !== null) applyLobby({ type: 'ready', houseId, seat, ready: false }); break;
        default: break;
      }
    };

    switch (ev?.type) {
      case 'open':
        if (st.phase !== 'idle') break;
        st = { ...st, phase: 'opening' };
        effects.push({ type: 'join-signaling' });
        break;

      case 'opened': {
        if (st.phase !== 'opening') break;
        st = { ...st, phase: 'lobby', lobby: createLobby({ label: st.code ?? '' }) };
        applyLobby({ type: 'house-join', isHost: true, players: st.hostPlayers });
        effects.push({ type: 'phase', phase: 'lobby' });
        break;
      }

      case 'open-failed':
        if (st.phase !== 'opening') break;
        st = { ...st, phase: 'idle' };
        effects.push({ type: 'error', text: signalingErrorText(ev.code) }, { type: 'leave-signaling' });
        break;

      case 'peer-join':
        if (st.phase === 'idle' || st.phase === 'opening' || typeof ev.peerId !== 'string') break;
        if (st.peers[ev.peerId] && st.peers[ev.peerId].stage !== 'gone') break; // one connection per id
        st = { ...st, peers: { ...st.peers, [ev.peerId]: { stage: 'hello-wait', since: st.now } } };
        break;

      case 'hello': {
        const { peerId } = ev;
        const h = ev.hello ?? {};
        if (st.phase === 'idle' || st.phase === 'opening' || typeof peerId !== 'string') break;
        const peer = st.peers[peerId];
        if (peer && peer.stage !== 'hello-wait') break; // one HELLO per connection
        if (!peer) st = { ...st, peers: { ...st.peers, [peerId]: { stage: 'hello-wait', since: st.now } } };
        if (!compatible(st.mine, h).ok) { reject(peerId, 'version'); break; }
        // M2: a valid reconnect token re-attaches its house, even while locked.
        if (isToken(h.token) && Object.hasOwn(st.tokens, h.token)) {
          const houseId = st.tokens[h.token];
          const house = getHouse(st.lobby, houseId);
          const holder = peerOfHouse(st, houseId);
          if (house && !house.isHost) {
            if (holder && holder !== peerId) {
              st = { ...st, peers: { ...st.peers, [holder]: { ...st.peers[holder], stage: 'gone' } } };
              effects.push({ type: 'disconnect', peerId: holder });
            }
            fresh.add(peerId);
            const token = makeToken();
            const tokens = { ...st.tokens };
            delete tokens[h.token];
            tokens[token] = houseId;
            const asleep = { ...st.asleep };
            delete asleep[houseId];
            st = {
              ...st,
              tokens,
              asleep,
              peers: { ...st.peers, [peerId]: { stage: 'joined', since: st.now, houseId, token, joinedAt: st.now } },
              sent: { ...st.sent, [peerId]: { last: st.now, dirty: false } },
            };
            applyLobby({ type: 'net', houseId, net: 'ok', rttMs: house.rttMs });
            effects.push({ type: 'reattach', houseId, peerId });
            send(peerId, { type: 'WELCOME', houseId, emoji: house.emoji, token, hostBuild: st.mine.build, tickHz: TICK_HZ, lobby: lobbyForWire(st.lobby) });
            if (st.phase !== 'lobby') send(peerId, { type: 'PHASE', phase: st.phase, screen: null, params: {} });
            break;
          }
        }
        if (st.lobby.locked) { reject(peerId, 'locked'); break; }
        const n = Number(h.house?.localPlayers);
        if (!Number.isInteger(n) || n < 1 || n > MAX_LOCAL_PLAYERS) { reject(peerId, 'declined'); break; }
        if (n > seatsLeft(st.lobby) || st.lobby.houses.length >= 8) { reject(peerId, racing(st) ? 'in-race-full' : 'full'); break; }
        admit(peerId, n);
        break;
      }

      case 'peer-leave': {
        const peer = st.peers[ev.peerId];
        if (!peer || peer.stage === 'gone') break;
        const was = peer.stage;
        st = { ...st, peers: { ...st.peers, [ev.peerId]: { ...peer, stage: 'gone' } } };
        if (was === 'joined') {
          const houseId = peer.houseId;
          if (ev.bye && !racing(st)) {
            // "Leave the room" in the lobby: the house goes at once, its seats are free.
            removeHouse(houseId);
          } else {
            // A dropped connection (or a BYE mid-race): Robo Driver keeps its karts racing (§13.1) and the house
            // stays asleep for the reconnect window (§13.2); a BYE house goes as soon as the race is over.
            applyLobby({ type: 'net', houseId, net: 'asleep', rttMs: 0 });
            st = { ...st, asleep: { ...st.asleep, [houseId]: { at: st.now, bye: !!ev.bye } } };
            if (ev.bye) dropTokens(houseId);
          }
        }
        break;
      }

      case 'intent': {
        const houseId = houseOfPeer(ev.peerId);
        if (houseId === null) break;
        intentToLobby(houseId, ev.intent);
        break;
      }

      case 'host-intent': {
        const hh = hostHouse(st.lobby);
        if (hh) intentToLobby(hh.houseId, ev.intent);
        break;
      }

      case 'remove-house': {
        const house = getHouse(st.lobby, ev.houseId);
        if (!house || house.isHost) break;
        const peerId = peerOfHouse(st, house.houseId);
        if (peerId) {
          send(peerId, { type: 'KICK', scope: 0, seat: 0 });
          st = { ...st, peers: { ...st.peers, [peerId]: { ...st.peers[peerId], stage: 'gone' } } };
        }
        dropTokens(house.houseId);
        forgetAsleep(house.houseId);
        applyLobby({ type: 'house-remove', houseId: house.houseId, peerId });
        break;
      }

      case 'remove-seat': {
        const house = getHouse(st.lobby, ev.houseId);
        if (!house || !house.players.some((p) => p.seat === ev.seat)) break;
        if (house.players.length === 1 && !house.isHost) {
          // the last seat of a guest house = removing the house
          return hostReduce(state, { ...ev, type: 'remove-house' });
        }
        const peerId = peerOfHouse(st, house.houseId);
        if (peerId) send(peerId, { type: 'KICK', scope: 1, seat: ev.seat });
        applyLobby({ type: 'seat-leave', houseId: house.houseId, seat: ev.seat });
        break;
      }

      case 'lock':
        applyLobby({ type: 'lock' });
        break;

      case 'unlock':
        applyLobby({ type: 'unlock' });
        break;

      case 'choice':
        applyLobby({ type: 'choice', patch: ev.patch ?? {} });
        break;

      case 'phase': {
        const r = applyLobby({ type: 'phase', phase: ev.phase });
        if (r.effects.some((e) => e.type === 'refused')) break;
        st = { ...st, phase: ev.phase };
        expireAsleep();
        for (const p of joinedPeers(st)) send(p, { type: 'PHASE', phase: ev.phase, screen: ev.screen ?? null, params: ev.params ?? {} });
        effects.push({ type: 'phase', phase: ev.phase });
        break;
      }

      case 'emote': {
        const e = Number(ev.emote);
        if (!Number.isInteger(e) || e < 0 || e >= EMOTE_COUNT) break;
        const pi = Number(ev.globalPi);
        const house = houseOfPi(st.lobby, pi);
        if (!house) break;
        if (ev.peerId !== undefined && houseOfPeer(ev.peerId) !== house.houseId) break; // a guest emotes only for its own players
        if (ev.peerId === undefined && !house.isHost) break;
        const last = st.emotes[pi];
        if (last !== undefined && st.now - last < EMOTE_INTERVAL_MS) break; // 1 per 1.5 s per player
        st = { ...st, emotes: { ...st.emotes, [pi]: st.now } };
        for (const p of joinedPeers(st)) send(p, { type: 'EMOTE', globalPi: pi, emote: e });
        effects.push({ type: 'emote', globalPi: pi, emote: e });
        break;
      }

      case 'peer-net': {
        const houseId = houseOfPeer(ev.peerId);
        if (houseId !== null) applyLobby({ type: 'net', houseId, net: ev.net, rttMs: ev.rttMs });
        break;
      }

      case 'tick': {
        for (const [peerId, p] of Object.entries(st.peers)) {
          if (p.stage === 'hello-wait' && st.now - p.since >= HELLO_TIMEOUT_MS) {
            st = { ...st, peers: { ...st.peers, [peerId]: { ...p, stage: 'gone' } } };
            effects.push({ type: 'disconnect', peerId });
          }
        }
        expireAsleep();
        // §7.4 liveness from what the wrapper heard (any byte on any channel): wobbly after 3 s in the lobby.
        if (ev.heard && !racing(st)) {
          for (const peerId of joinedPeers(st)) {
            const p = st.peers[peerId];
            const house = getHouse(st.lobby, p.houseId);
            if (!house || house.net === 'asleep') continue;
            const last = Math.max(Number(ev.heard[peerId]) || 0, p.joinedAt ?? p.since ?? 0);
            const want = st.now - last > GUEST_WOBBLY_MS ? 'wobbly' : 'ok';
            if (house.net !== want) applyLobby({ type: 'net', houseId: p.houseId, net: want });
          }
        }
        // KEEP heartbeat: every joined guest hears from us at least once a second (§7.4), so a quiet lobby or a
        // host lingering on the track screen never looks like a sleeping host.
        for (const [peerId, p] of Object.entries(st.peers)) {
          if (p.stage === 'joined' && !(st.now - (st.keep[peerId] ?? -Infinity) < KEEPALIVE_MS)) {
            send(peerId, { type: 'KEEP' });
          }
        }
        break;
      }

      case 'close':
        if (st.phase === 'idle') break;
        for (const p of joinedPeers(st)) send(p, { type: 'BYE', reason: BYE.hostEnding });
        st = { ...createHostState({ code: st.code, hostPlayers: st.hostPlayers, mine: st.mine }), tokens: {} };
        effects.push({ type: 'leave-signaling' }, { type: 'phase', phase: 'idle' });
        break;

      default:
        break;
    }

    // LOBBY: mark every guest dirty on a change, send when allowed (≤ 4/s, never mid-race).
    if (st.lobby !== prevLobby) {
      effects.push({ type: 'lobby', lobby: st.lobby });
      const sent = { ...st.sent };
      for (const p of joinedPeers(st)) if (!fresh.has(p)) sent[p] = { ...(sent[p] ?? { last: -Infinity }), dirty: true };
      st = { ...st, sent };
    }
    if (!racing(st)) {
      const sent = { ...st.sent };
      let wire = null;
      for (const p of joinedPeers(st)) {
        const s = sent[p];
        if (s?.dirty && st.now - s.last >= LOBBY_SEND_INTERVAL_MS) {
          wire ??= lobbyForWire(st.lobby);
          send(p, { type: 'LOBBY', lobby: wire });
          sent[p] = { last: st.now, dirty: false };
        }
      }
      st = { ...st, sent };
    }

    let keep = null;
    for (const e of effects) if (e.type === 'send') (keep ??= { ...st.keep })[e.peerId] = st.now;
    if (keep) st = { ...st, keep };
    return { state: st, effects };
  };
}

/**
 * The live host session.
 * @param {object} o
 * @param {object} [o.transport]      NetTransport (§4.1): send / disconnect / onMessage / onPeer
 * @param {object[]} [o.signalings]   SignalingTransports (§4.2): setLocked / drop
 * @param {object} [o.progress]       unused (kept for the §16 signature)
 * @param {() => number} [o.rng]      unused by M1 logic (tokens use crypto); kept for the §16 signature
 * @param {() => number} [o.now]
 * @param {string} o.code             the room code ('CAKE')
 * @param {number|Array} [o.hostPlayers] the host house's local players
 * @param {object} [o.mine]           buildIdentity() (WS2 version.js values)
 * @param {(mine, theirs) => { ok: boolean }} [o.compatible]
 * @param {(msg) => Uint8Array} [o.encode] ctrl encoder (WS2 codec; default JSON stand-in)
 * @param {(bytes) => object|null} [o.decode]
 * @param {() => string} [o.makeToken]
 * @param {(id: string) => boolean} [o.isCharacter]  racer ids this build knows (picks of others are ignored)
 */
export function createHostSession({
  transport = null, signalings = [], progress = null, rng = null, now = () => Date.now(), code = '',
  hostPlayers = 1, mine = buildIdentity(), compatible, encode = jsonEncode, decode = jsonDecode, makeToken, isCharacter = null,
} = /** @type {any} */ ({})) {
  void rng;
  void progress;
  const reduce = createHostReducer({ makeToken, compatible, isCharacter });
  let state = createHostState({ code, hostPlayers, mine });
  const listeners = new Set();
  const offs = [];
  const heard = {}; // peerId → last ms any byte came from it (every channel; cheap, no dispatch per packet)

  const run = (e) => {
    try {
      if (e.type === 'send') transport?.send?.(e.peerId, 'ctrl', encode(e.msg));
      else if (e.type === 'disconnect') transport?.disconnect?.(e.peerId, 'session');
      else if (e.type === 'setLocked') for (const s of signalings) s?.setLocked?.(e.locked);
      else if (e.type === 'drop') for (const s of signalings) s?.drop?.(e.peerId);
    } catch (err) { console.warn('[host-session] effect', e.type, err); }
    for (const fn of listeners) { try { fn(e); } catch (err) { console.warn('[host-session] listener', err); } }
  };

  const session = {
    get state() { return state; },
    dispatch(ev) {
      const r = reduce(state, { now: now(), ...(ev?.type === 'tick' ? { heard: { ...heard } } : {}), ...ev });
      state = r.state;
      r.effects.forEach(run);
      return r.effects;
    },
    onEffect(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    lobby() { return state.lobby; },
    dispose() { offs.splice(0).forEach((off) => { try { off(); } catch { /* ignore */ } }); listeners.clear(); },
  };

  if (transport?.onPeer) {
    offs.push(transport.onPeer((p) => session.dispatch({ type: p.type === 'join' ? 'peer-join' : 'peer-leave', peerId: p.peerId })));
  }
  if (transport?.onMessage) {
    offs.push(transport.onMessage((peerId, ch, bytes) => {
      heard[peerId] = now();
      if (ch !== 'ctrl') return;
      const msg = decode(bytes);
      if (!msg) return;
      if (msg.type === 'HELLO') session.dispatch({ type: 'hello', peerId, hello: msg });
      else if (msg.type === 'INTENT') session.dispatch({ type: 'intent', peerId, intent: msg });
      else if (msg.type === 'EMOTE') session.dispatch({ type: 'emote', peerId, globalPi: msg.globalPi, emote: msg.emote });
      else if (msg.type === 'BYE') session.dispatch({ type: 'peer-leave', peerId, bye: true });
    }));
  }
  return session;
}

/**
 * The `ctx.net` object the menus use on the HOST (Menus.js: role, composeSetup, lobby,
 * dispatch, seatsLeft …), built from a live host session. `composeSetup` turns the
 * host's local flow result (track / speed / laps / mode) into a NetRaceSetup for the whole
 * lobby (§10.5): it records the host's choice in the lobby, draws the seed, numbers the
 * race and asks `pickCpus(count)` for the CPU racers (from the host's unlocked racers).
 * @param {ReturnType<typeof createHostSession>} session
 * @param {{ makeSeed?: () => number, pickCpus?: (count: number) => string[], rules?: object }} [o]
 */
export function createHostNetContext(session, { makeSeed = () => cryptoU32(), pickCpus = () => [], rules = {} } = {}) {
  let raceId = 0;
  return {
    role: 'host',
    get code() { return session.state.code; },
    houseId: 0,
    lobby: () => session.lobby(),
    dispatch: (ev) => session.dispatch(ev),
    onEffect: (fn) => session.onEffect(fn),
    seatsLeft: () => {
      const l = session.lobby();
      return localCapacity(l, hostHouse(l)?.houseId ?? 0);
    },
    composeSetup(localSetup = {}) {
      const patch = {};
      for (const k of ['mode', 'trackId', 'cupId', 'arenaId', 'speedClass', 'laps', 'customTrackIds']) if (localSetup[k] !== undefined) patch[k] = localSetup[k];
      session.dispatch({ type: 'choice', patch });
      const lobby = session.lobby();
      const humans = activePlayers(lobby).length;
      const cpuIds = pickCpus(cpuCountFor(humans, rules)) ?? [];
      raceId += 1;
      return composeOnlineSetup(lobby, lobby.hostChoice, { seed: makeSeed(), raceId, cpuIds, rules });
    },
    waitingParams: () => ({}),
  };
}

function cryptoU32() {
  const b = new Uint32Array(1);
  globalThis.crypto.getRandomValues(b);
  return b[0];
}

export { rejectText };
