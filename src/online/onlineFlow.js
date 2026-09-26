/**
 * Online room glue (NETWORKING.md §10, §13): opening / joining a room with the real matchmakers + WebRTC
 * (WS4) and the WS6 sessions, routing bytes between the session and the race, keeping the lobby in step
 * with this machine's menus (seats, racer picks, ready), which screen phase the host is on, and the
 * friendly option lists for results and pause online. main.js drives it (`runOnlineHost` /
 * `runOnlineGuest`); everything here is testable without a browser.
 *
 * Loaded with `import()` only after a grown-up turned online on and the family opened Online, so no
 * network code is downloaded before that (§1 rule 1).
 *
 * OWNER: WS7 (online game integration).
 */
import { createHostSession, createHostNetContext } from '../net/session/hostSession.js';
import { createGuestSession, createGuestNetContext } from '../net/session/guestSession.js';
import { makeRoomSecret } from '../net/session/roomCode.js';
import { buildIdentity } from '../net/session/wire.js';
import { allPlayers, getHouse, lobbyAllReady } from '../net/session/lobby.js';
import { currentPlatform } from '../net/platform.js';
import { isSessionBytes, decodeRaceCtrl, createPendingBytes } from './netRace.js';
import { netStack } from './stack.js';

/** Friendly words the online glue adds (tone-tested with the WS6 catalogue). */
export const ONLINE_TEXT = Object.freeze({
  opening: 'Opening your room… 🏰',
  friendsPicking: 'Waiting for friends to pick their racers… 🎨',
  loading: 'Getting the track ready… 🏁',
  robo: '🤖 Robo Driver has the wheel!',
  roboBack: 'You have the wheel again! 🏎️',
  wobbly: 'A friend\'s connection is a bit wobbly… 📶',
  finishWait: 'Finish! ✨',
  pausedEveryone: 'Everyone is on a snack break 🍪',
  controllerNap: 'Controller took a nap 💤 Robo Driver is driving!',
});

/** Host results options online (§10.4): the host decides for everyone. */
export const HOST_RESULT_OPTIONS = Object.freeze([['again', 'Race again', '🔁'], ['next-track', 'Next track', '➡️'], ['lobby', 'Back to the lobby', '🏠']]);
/** Guests see the same results, waiting for the host (or leave). */
export const GUEST_RESULT_OPTIONS = Object.freeze([['wait', 'Waiting for the host…', '⏳'], ['leave', 'Leave the room', '👋']]);
/** Host Start = "Pause everyone 🍪" (everyone freezes while this is open). */
export const HOST_PAUSE_OPTIONS = Object.freeze([['resume', 'Keep racing!', '▶️'], ['restart', 'Start over', '🔁'], ['lobby', 'Back to the lobby', '🏠']]);
/** Guest Start = a local overlay; Robo Driver drives meanwhile (the race never stops for everyone). */
export const GUEST_PAUSE_OPTIONS = Object.freeze([['resume', 'Keep racing!', '▶️'], ['leave', 'Leave the room', '👋']]);

/** How long the host waits for friends to finish picking before filling in racers (§10.4). */
export const READY_TIMEOUT_MS = 30_000;
/** Session housekeeping (LOBBY coalescing, approval timeouts, host-silence) runs this often. */
export const SESSION_TICK_MS = 250;

/** The lobby phase for the host's current menu screen (null = no change). */
export function phaseForScreen(screenId) {
  switch (screenId) {
    case 'online-lobby': return 'lobby';
    case 'join':
    case 'mode-select': return 'mode';
    case 'character-select': return 'characters';
    case 'track-select':
    case 'cup-select':
    case 'arena-select':
    case 'my-cup': return 'course';
    default: return null;
  }
}

/** What this machine's menus say it wants in the lobby: seats (local join order), picks, ready. */
export function desiredSeats(draft, paintOf = () => 'original') {
  const players = [...(draft?.joinState?.players ?? [])].sort((a, b) => a.playerIndex - b.playerIndex);
  const picks = draft?.charPicks ?? [];
  const done = !!draft?.charState;
  return players.map((p, seat) => {
    const pick = picks.find((q) => q.deviceId === p.deviceId) ?? picks.find((q) => q.playerIndex === p.playerIndex) ?? null;
    const characterId = typeof pick?.characterId === 'string' ? pick.characterId : null;
    let paintId = 'original';
    if (characterId) { try { paintId = paintOf(characterId) || 'original'; } catch { /* own colours */ } }
    return { seat, deviceId: p.deviceId, easyDrive: !!p.easyDrive, characterId, paintId, ready: done && !!characterId };
  });
}

/**
 * Keeps this house's lobby seats in step with the local menus (join screen → seat-join/leave, character
 * select → pick + ready). Pure diff + a resend limit, so calling `update` every frame is cheap and a lost
 * intent is simply sent again a moment later.
 * @param {{ houseId: () => number|null, lobby: () => object|null, send: (intent) => void, now?: () => number, resendMs?: number }} o
 */
export function createDraftSync({ houseId, lobby, send, now = () => Date.now(), resendMs = 500, paintOf = undefined }) {
  const sentAt = new Map();
  const fire = (intent) => {
    const key = JSON.stringify(intent);
    const t = now();
    if (sentAt.has(key) && t - sentAt.get(key) < resendMs) return false;
    sentAt.set(key, t);
    send(intent);
    return true;
  };
  return {
    /** @returns {object[]} the intents sent this call */
    update(draft) {
      const out = [];
      const l = lobby();
      const house = getHouse(l, houseId());
      if (!house || !draft) return out;
      const want = desiredSeats(draft, paintOf);
      if (!want.length) return out;
      const have = new Map(house.players.map((p) => [p.seat, p]));
      for (const w of want) {
        const p = have.get(w.seat);
        if (!p) { if (fire({ kind: 'seat-join', seat: w.seat, easyDrive: w.easyDrive })) out.push('seat-join'); continue; }
        if (w.characterId && (p.characterId !== w.characterId || p.easyDrive !== w.easyDrive || (p.paintId ?? 'original') !== w.paintId)) {
          if (fire({ kind: 'pick', seat: w.seat, characterId: w.characterId, easyDrive: w.easyDrive, paintId: w.paintId })) out.push('pick');
          continue;
        }
        if (w.ready && !p.ready && p.characterId === w.characterId) { if (fire({ kind: 'ready', seat: w.seat })) out.push('ready'); }
      }
      for (const p of house.players) {
        if (p.seat >= want.length) { if (fire({ kind: 'seat-leave', seat: p.seat })) out.push('seat-leave'); }
      }
      return out;
    },
    reset() { sentAt.clear(); },
  };
}

/** Everyone in the lobby picked a racer and is ready (at least one player). */
export const everyoneReady = (lobby) => lobbyAllReady(lobby);

/**
 * Fill any racer a slow friend did not pick in time with an unused unlocked one (never leaves a kart
 * without a racer). Pure: returns a new setup.
 * @param {object} setup NetRaceSetup
 * @param {string[]} pool racers to choose from, in preference order
 */
export function fillMissingPicks(setup, pool = []) {
  const used = new Set(setup.participants.map((p) => p.characterId).filter((c) => typeof c === 'string'));
  const spare = pool.filter((id) => !used.has(id));
  let i = 0;
  return {
    ...setup,
    participants: setup.participants.map((p) => {
      if (typeof p.characterId === 'string') return p;
      const characterId = spare[i++] ?? pool[0] ?? 'luna';
      return { ...p, characterId };
    }),
  };
}

/** Is the lobby's host choice + roster enough to race? (at least one player, a track for a race mode) */
export function canStart(lobby) {
  return allPlayers(lobby).length > 0 && !!lobby?.hostChoice?.trackId;
}

/**
 * One transport, two owners: session messages go to the WS6 session wrapper (it subscribes itself);
 * SETUP / LOADED / RESULT come here; everything else (the netcode) goes to the running race, or waits in
 * a buffer between SETUP and the moment the race exists.
 */
export function createRoomRouter({ transport, stack = netStack }) {
  const listeners = { setup: new Set(), loaded: new Set(), result: new Set() };
  const pending = createPendingBytes();
  let race = null;
  let buffering = false;
  const off = transport.onMessage((peerId, ch, bytes) => {
    if (isSessionBytes(bytes)) return;
    const rc = decodeRaceCtrl(stack, bytes);
    if (rc) { for (const fn of listeners[rc.kind]) fn(rc, peerId); return; }
    if (race) race.onBytes(peerId, ch, bytes);
    else if (buffering) pending.push(peerId, ch, bytes);
  });
  return {
    on(kind, fn) { listeners[kind].add(fn); return () => listeners[kind].delete(fn); },
    /** Buffer netcode bytes from now on (a SETUP arrived; the race is being built). */
    expectRace() { buffering = true; },
    /** The race that gets the netcode bytes (null = none); flushes anything buffered into it. */
    setRace(r) {
      race = r;
      if (r) pending.flush((p, c, b) => r.onBytes(p, c, b));
      else { pending.clear(); buffering = false; }
    },
    get race() { return race; },
    get buffered() { return pending.size; },
    dispose() { try { off?.(); } catch { /* ignore */ } pending.clear(); race = null; },
  };
}

/* ------------------------------------------------------------------ opening / joining */

function identity() {
  const build = typeof __SK_BUILD__ !== 'undefined' ? __SK_BUILD__ : 'dev'; // eslint-disable-line no-undef
  return buildIdentity({ build });
}

/** Signaling config for this page (Worker iff VITE_SIGNAL_URL; dev overrides on localhost only). */
export function signalConfigFor({ env = {}, location = globalThis.location, resolve }) {
  return resolve({
    envSignalUrl: env.VITE_SIGNAL_URL ?? null,
    search: location?.search ?? '',
    hostname: location?.hostname ?? '',
    dev: !!env.DEV,
  });
}

/**
 * Open a room as the host: secret → room ids → matchmaker(s) + WebRTC → host session → ctx.net.
 * @param {object} o
 * @param {object} o.progress                progress module (settings.relayOnly / approvalGate)
 * @param {number} [o.hostPlayers]
 * @param {(count: number) => string[]} o.pickCpus
 * @param {object} [o.rules]
 * @param {object} [o.signal]                { signalUrl, forced, relays }
 * @param {object} [o.deps]                  { openOnline, makeSecret, deriveRoomIds, transport, signaling, now }
 */
export async function openHostRoom({ progress, hostPlayers = 1, pickCpus, rules = {}, signal = {}, deps = {} }) {
  const secret = (deps.makeSecret ?? makeRoomSecret)();
  let transport = deps.transport ?? null;
  let signaling = deps.signaling ?? null;
  if (!transport) {
    const ids = await (deps.deriveRoomIds ?? netStack.deriveRoomIds)(secret);
    const open = deps.openOnline ?? (await import('../net/signaling/index.js')).openOnline;
    const selfId = deps.selfId ?? (await import('../net/signaling/types.js')).makePeerId();
    const relayOnly = !!progress?.getSettings?.()?.relayOnly;
    const r = await open({ role: 'host', selfId, ids, relayOnly, signalUrl: signal.signalUrl ?? null, forced: signal.forced ?? null, relays: signal.relays ?? null });
    transport = r.transport;
    signaling = r.signaling;
  }
  const now = deps.now ?? (() => Date.now());
  const session = createHostSession({ transport, signalings: signaling ? [signaling] : [], progress, now, secret, hostPlayers, mine: identity() });
  session.dispatch({ type: 'open' });
  session.dispatch({ type: 'opened' });
  for (const peerId of transport.peers?.() ?? []) session.dispatch({ type: 'peer-join', peerId });
  const netCtx = createHostNetContext(session, { pickCpus, rules });
  const router = createRoomRouter({ transport });
  return {
    role: 'host', secret, transport, signaling, session, netCtx, router,
    /** peer id of a joined house (null = gone). */
    peerOf(houseId) {
      const e = Object.entries(session.state.peers).find(([, p]) => p.stage === 'joined' && p.houseId === houseId);
      return e ? e[0] : null;
    },
    close() {
      try { session.dispatch({ type: 'close' }); } catch { /* ignore */ }
      router.dispose();
      session.dispose();
      try { signaling?.leave?.(); } catch { /* ignore */ }
      setTimeout(() => { try { transport.close?.(); } catch { /* ignore */ } }, 300); // let BYE go out
    },
  };
}

/**
 * Join a room as a guest. Resolves once the matchmaker found the host (or with the error the session turns
 * into a friendly sentence); the approval (match check) then runs inside the session.
 */
export async function joinGuestRoom({ secret, localPlayers = 1, progress = null, signal = {}, deps = {} }) {
  const now = deps.now ?? (() => Date.now());
  let transport = deps.transport ?? null;
  let signaling = deps.signaling ?? null;
  let failure = null;
  if (!transport) {
    try {
      const ids = await (deps.deriveRoomIds ?? netStack.deriveRoomIds)(secret);
      const open = deps.openOnline ?? (await import('../net/signaling/index.js')).openOnline;
      const selfId = deps.selfId ?? (await import('../net/signaling/types.js')).makePeerId();
      const relayOnly = !!progress?.getSettings?.()?.relayOnly;
      const r = await open({ role: 'guest', selfId, ids, relayOnly, signalUrl: signal.signalUrl ?? null, forced: signal.forced ?? null, relays: signal.relays ?? null });
      transport = r.transport;
      signaling = r.signaling;
    } catch (err) {
      failure = err?.code ?? 'unreachable';
    }
  }
  const session = createGuestSession({ transport, signalings: signaling ? [signaling] : [], secret, localPlayers, now, mine: identity(), platform: deps.platform ?? currentPlatform() });
  const router = transport ? createRoomRouter({ transport }) : null;
  session.dispatch({ type: 'connect' });
  if (failure) session.dispatch({ type: 'connect-failed', code: failure });
  else {
    const peers = transport.peers?.() ?? [];
    if (peers.length && !session.state.hostPeerId) session.dispatch({ type: 'connected', peerId: peers[0] });
  }
  const netCtx = createGuestNetContext(session);
  return {
    role: 'guest', secret, transport, signaling, session, netCtx, router,
    hostId: () => session.state.hostPeerId,
    close() {
      try { session.dispatch({ type: 'leave' }); } catch { /* ignore */ }
      router?.dispose();
      session.dispose();
      try { signaling?.leave?.(); } catch { /* ignore */ }
      setTimeout(() => { try { transport?.close?.(); } catch { /* ignore */ } }, 300);
    },
  };
}

/** A tiny async queue: session effects / router messages in, `next()` out (the guest room loop). */
export function createEventQueue() {
  const items = [];
  const waiters = [];
  return {
    push(e) { const w = waiters.shift(); if (w) w(e); else items.push(e); },
    next() { return items.length ? Promise.resolve(items.shift()) : new Promise((r) => waiters.push(r)); },
    /** Take queued items matching `pred` without waiting (e.g. a SETUP that arrived during results). */
    take(pred) { const i = items.findIndex(pred); return i >= 0 ? items.splice(i, 1)[0] : null; },
    get size() { return items.length; },
  };
}
