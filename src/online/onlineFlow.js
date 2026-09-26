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
  pausedEveryone: 'Snack break for everyone in the room!',
  controllerNap: 'Controller took a nap 💤 Robo Driver is driving!',
  // a guest's Start: a LOCAL overlay, the race goes on for everyone (§4, §10.4)
  guestPauseTitle: 'Robo Driver has the wheel!',
  guestPauseLine: 'Your friends keep racing. Robo Driver drives your kart until you come back!',
});

/** Host results options online (§10.4): the host decides for everyone. */
export const HOST_RESULT_OPTIONS = Object.freeze([['again', 'Race again', '🔁'], ['next-track', 'Next track', '➡️'], ['lobby', 'Back to the lobby', '🏠']]);
/** Guests see the same results, waiting for the host (or leave). */
export const GUEST_RESULT_OPTIONS = Object.freeze([['wait', 'Waiting for the host…', '⏳'], ['leave', 'Leave the room', '👋']]);
/** Host Start = "Pause everyone 🍪" (everyone freezes while this is open). */
export const HOST_PAUSE_OPTIONS = Object.freeze([['resume', 'Keep racing!', '▶️'], ['restart', 'Start over', '🔁'], ['lobby', 'Back to the lobby', '🏠']]);
/** Guest Start = a local overlay; Robo Driver drives meanwhile (the race never stops for everyone). */
export const GUEST_PAUSE_OPTIONS = Object.freeze([['resume', 'Keep racing!', '▶️'], ['leave', 'Leave the room', '👋']]);

/**
 * What a guest does with the host's CHOICE (§10.4). On the results it closes them (`resolve`); mid-race — the host
 * picked "Back to the lobby" or "Start over" in its pause — it ends the race at once (`end`), so no guest is left
 * in a frozen race until the silence timeout.
 * @param {string} choice  'again' | 'next-track' | 'lobby' | 'restart'
 * @param {boolean} resultsShown
 * @returns {{ end: 'lobby'|'again'|'next-track'|null, resolve: string|null }}
 */
export function guestChoiceAction(choice, resultsShown) {
  const outcome = choice === 'lobby' ? 'lobby' : choice === 'next-track' ? 'next-track' : 'again';
  if (resultsShown) return { end: null, resolve: `host:${choice}` };
  return { end: outcome, resolve: null };
}

/** A SETUP for a different race ends the guest's current one (the host started over / moved on). */
export function setupEndsRace(current, next) {
  return !!next && !!current && (next.raceId >>> 0) !== (current.raceId >>> 0);
}

/** How long the host waits for friends to finish picking before filling in racers (§10.4). */
export const READY_TIMEOUT_MS = 30_000;
/**
 * Session housekeeping (KEEP heartbeat, LOBBY coalescing, approval timeouts, host silence, reconnects) runs
 * this often — from a plain timer, never from rAF, so a hidden or busy tab keeps its room alive.
 */
export const SESSION_TICK_MS = 250;
/** sessionStorage key of this tab's WELCOME ticket (a reload re-attaches its house, §13.2). */
export const TICKET_KEY = 'sk-room-ticket';

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

/**
 * The WELCOME ticket store for guest sessions (§13.2), in sessionStorage: per tab, gone when the tab closes,
 * never sent anywhere but back to the same room's host. Keyed by the room label + sweets so another room never
 * sees it. Every storage call may throw (private windows, blocked storage): then there is simply no ticket.
 * @param {Storage|null} [storage]
 */
export function sessionTicketStore(storage = (() => { try { return globalThis.sessionStorage ?? null; } catch { return null; } })()) {
  const keyOf = (secret) => (secret ? `${secret.label}|${(secret.sweets ?? []).join('.')}` : '');
  const read = () => { try { return JSON.parse(storage?.getItem(TICKET_KEY) ?? 'null'); } catch { return null; } };
  return {
    load(secret) {
      const t = read();
      return t && t.room === keyOf(secret) && typeof t.token === 'string' ? t.token : null;
    },
    save(secret, token) {
      try { storage?.setItem(TICKET_KEY, JSON.stringify({ room: keyOf(secret), token })); } catch { /* no ticket */ }
    },
    clear(secret) {
      try { if (read()?.room === keyOf(secret)) storage?.removeItem(TICKET_KEY); } catch { /* ignore */ }
    },
  };
}

/**
 * A NetTransport whose real transport can be swapped (a guest's reconnect opens a fresh matchmaker +
 * WebRtcTransport): the session, the router and the race subscribe once to the proxy and never notice.
 */
export function createTransportProxy() {
  const msgFns = new Set();
  const peerFns = new Set();
  let target = null;
  let offs = [];
  return {
    get target() { return target; },
    get selfId() { return target?.selfId ?? null; },
    get role() { return target?.role ?? null; },
    /** Point at a new transport (null = none). The old one is only unsubscribed; its owner closes it. */
    setTarget(t) {
      for (const off of offs.splice(0)) { try { off?.(); } catch { /* ignore */ } }
      target = t ?? null;
      if (!target) return;
      offs.push(target.onMessage((p, ch, b) => { for (const fn of [...msgFns]) fn(p, ch, b); }));
      if (target.onPeer) offs.push(target.onPeer((ev) => { for (const fn of [...peerFns]) fn(ev); }));
    },
    peers: () => target?.peers?.() ?? [],
    send: (peerId, ch, bytes) => target?.send?.(peerId, ch, bytes) ?? false,
    broadcast: (ch, bytes, except) => target?.broadcast?.(ch, bytes, except),
    onMessage(fn) { msgFns.add(fn); return () => msgFns.delete(fn); },
    onPeer(fn) { peerFns.add(fn); return () => peerFns.delete(fn); },
    stats: (peerId) => target?.stats?.(peerId) ?? {},
    disconnect: (peerId, reason) => target?.disconnect?.(peerId, reason),
    renewIceIfRelayed: () => target?.renewIceIfRelayed?.(),
    close() { try { target?.close?.(); } catch { /* ignore */ } },
  };
}

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
 *
 * The session, router and race talk to a swappable transport proxy: when the session asks to reconnect
 * (§13.2 — the link dropped), a fresh matchmaker + connection (new selfId, so the host never mistakes it for the
 * old, dying one) replaces the old one, and HELLO with the WELCOME ticket re-attaches the same house.
 * Signaling hints feed the session: a host that showed up (`host-seen`) turns a later timeout into the NAT
 * sentence instead of "check the code", and a locked host's refusal becomes "closed".
 */
export async function joinGuestRoom({ secret, localPlayers = 1, progress = null, signal = {}, deps = {} }) {
  const now = deps.now ?? (() => Date.now());
  const proxy = createTransportProxy();
  let signaling = null;
  let link = null; // { transport, signaling, offs }
  let gen = 0;
  let closed = false;
  let session = null;
  const fixed = deps.transport ?? null;

  const watch = (transport, sig) => {
    const offs = [];
    const seen = () => session?.dispatch({ type: 'host-seen' });
    try { if (sig?.onPeerConnection) offs.push(sig.onPeerConnection(seen)); } catch { /* optional */ }
    try { if (transport?.onFailure) offs.push(transport.onFailure(seen)); } catch { /* optional */ }
    try { if (sig?.onRefused) offs.push(sig.onRefused((code) => session?.dispatch({ type: 'connect-failed', code }))); } catch { /* optional */ }
    return offs;
  };
  const drop = (l) => {
    if (!l) return;
    for (const off of l.offs) { try { off?.(); } catch { /* ignore */ } }
    if (l.transport === fixed) return; // a test's in-memory endpoint lives on
    try { l.signaling?.leave?.(); } catch { /* ignore */ }
    try { l.transport?.close?.(); } catch { /* ignore */ }
  };
  const openLink = async (attempt) => {
    if (fixed) return { transport: fixed, signaling: deps.signaling ?? null };
    const ids = await (deps.deriveRoomIds ?? netStack.deriveRoomIds)(secret);
    const open = deps.openOnline ?? (await import('../net/signaling/index.js')).openOnline;
    const selfId = (attempt === 0 && deps.selfId) || (deps.makePeerId ?? (await import('../net/signaling/types.js')).makePeerId)();
    const relayOnly = !!progress?.getSettings?.()?.relayOnly;
    return open({ role: 'guest', selfId, ids, relayOnly, signalUrl: signal.signalUrl ?? null, forced: signal.forced ?? null, relays: signal.relays ?? null });
  };
  const useLink = (r) => {
    drop(link);
    link = { transport: r.transport, signaling: r.signaling ?? null, offs: watch(r.transport, r.signaling) };
    signaling = link.signaling;
    proxy.setTarget(r.transport);
  };

  let failure = null;
  try { useLink(await openLink(0)); } catch (err) { failure = err?.code ?? 'unreachable'; }
  const tokenStore = deps.tokenStore === undefined ? sessionTicketStore() : deps.tokenStore;
  session = createGuestSession({
    transport: proxy, signalings: signaling ? [signaling] : [], secret, localPlayers, now, mine: identity(), platform: deps.platform ?? currentPlatform(), tokenStore,
  });
  const router = failure ? null : createRoomRouter({ transport: proxy });
  session.dispatch({ type: 'connect' });
  if (failure) session.dispatch({ type: 'connect-failed', code: failure });
  else {
    const peers = proxy.peers();
    if (peers.length && !session.state.hostPeerId) session.dispatch({ type: 'connected', peerId: peers[0] });
  }

  // §13.2: a fresh matchmaker + connection for every reconnect attempt the session asks for
  session.onEffect((e) => {
    if (e.type !== 'reconnect' || closed) return;
    const my = ++gen;
    const old = link;
    link = null;
    proxy.setTarget(null);
    drop(old);
    openLink(e.attempt + 1).then((r) => {
      if (closed || my !== gen) { drop({ ...r, offs: [] }); return; }
      useLink(r);
      const p = proxy.peers();
      if (p.length) session.dispatch({ type: 'connected', peerId: p[0] });
    }, (err) => {
      if (!closed && my === gen) session.dispatch({ type: 'connect-failed', code: err?.code ?? 'unreachable' });
    });
  });

  const netCtx = createGuestNetContext(session);
  return {
    role: 'guest', secret, transport: proxy, get signaling() { return signaling; }, session, netCtx, router,
    hostId: () => session.state.hostPeerId,
    close() {
      try { session.dispatch({ type: 'leave' }); } catch { /* ignore */ }
      closed = true;
      router?.dispose();
      session.dispose();
      const l = link;
      link = null;
      for (const off of l?.offs ?? []) { try { off?.(); } catch { /* ignore */ } }
      try { l?.signaling?.leave?.(); } catch { /* ignore */ }
      setTimeout(() => { try { l?.transport?.close?.(); } catch { /* ignore */ } proxy.setTarget(null); }, 300); // let BYE go out
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
