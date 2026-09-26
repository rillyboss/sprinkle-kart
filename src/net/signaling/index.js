/**
 * Dual matchmaker (NETWORKING.md §3, §4.2).
 *
 * - `chooseSignaling({ signalUrl, health })` → ordered kinds: a build with `VITE_SIGNAL_URL`
 *   uses `['worker', 'public']`, a build without it `['public']`.
 * - The HOST joins every kind at once (so a guest on an old cached build, or a guest whose
 *   Worker is down, still finds it on public signaling).
 * - A GUEST starts the Worker, then adds public signaling 4 s later — at once when `/health`
 *   failed or the Worker said it doesn't know the room. The guest uses ONE selfId on both; the
 *   first RTCPeerConnection whose two channels open wins (the WebRtcTransport decides and calls
 *   `settle`), and the guest leaves the other matchmaker.
 * - The host keeps one connection per selfId (the transport closes duplicates).
 *
 * `createDualSignaling` presents several SignalingTransports as one, so the WebRtcTransport
 * and the session only ever see a single SignalingTransport.
 *
 * Dev override (localhost / dev builds only, for e2e): `?signal=worker&signalUrl=http://…` or
 * `?signal=public&relays=ws://127.0.0.1:8000`.
 */
import { SignalingError, createListeners } from './types.js';
import { parseRelayList, publicIceServers } from './relays.js';

export const GUEST_PUBLIC_DELAY_MS = 4000;
/** Worker answers after which a guest should try public signaling right away. */
const FALLBACK_NOW = new Set(['unreachable', 'timeout', 'no-host', 'rate', 'bad-origin', 'host-exists']);
/** Worker answers that are final for a guest (the host is there and said no). */
const DEFINITIVE = new Set(['locked', 'full']);

/**
 * @param {{ signalUrl?: string|null, health?: { ok: boolean }|null }} o
 * @returns {('worker'|'public')[]}
 */
export function chooseSignaling({ signalUrl } = {}) {
  return signalUrl ? ['worker', 'public'] : ['public'];
}

/**
 * When each kind starts, relative to join() (ms).
 * @param {{ kinds: string[], role: 'host'|'guest', health?: { ok: boolean }|null, guestPublicDelayMs?: number }} o
 * @returns {Record<string, number>}
 */
export function signalingSchedule({ kinds, role, health, guestPublicDelayMs = GUEST_PUBLIC_DELAY_MS }) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of kinds) out[k] = 0;
  if (role === 'guest' && kinds.includes('worker') && kinds.includes('public') && health?.ok !== false) out.public = guestPublicDelayMs;
  return out;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Resolve which matchmaker(s) this page should use.
 * @param {{ envSignalUrl?: string|null, search?: string, hostname?: string, dev?: boolean }} o
 * @returns {{ signalUrl: string|null, forced: 'worker'|'public'|null, relays: string[]|null }}
 */
export function resolveSignalConfig({ envSignalUrl = null, search = '', hostname = '', dev = false } = {}) {
  const base = { signalUrl: cleanUrl(envSignalUrl), forced: null, relays: null };
  const devOk = dev || LOCAL_HOSTS.has(String(hostname).toLowerCase());
  if (!devOk || !search) return base;
  let q;
  try {
    q = new URLSearchParams(search);
  } catch {
    return base;
  }
  const sig = q.get('signal');
  if (sig === 'worker') {
    const url = cleanUrl(q.get('signalUrl')) ?? base.signalUrl;
    return url ? { signalUrl: url, forced: 'worker', relays: null } : base;
  }
  if (sig === 'public') return { signalUrl: null, forced: 'public', relays: parseRelayList(q.get('relays')) };
  return base;
}

function cleanUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const url = new URL(u.trim());
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Present several SignalingTransports as one.
 * @param {object} o
 * @param {Record<string, import('./types.js').SignalingTransport & Record<string, any>>} o.transports  by kind
 * @param {('worker'|'public')[]} o.kinds       ordered (see chooseSignaling)
 * @param {{ ok: boolean }|null} [o.health]     result of GET /health (null = unknown)
 * @param {number} [o.guestPublicDelayMs]
 * @param {{ setTimeout: Function, clearTimeout: Function }} [o.timers]
 * @returns {import('./types.js').SignalingTransport & Record<string, any>}
 */
export function createDualSignaling({ transports, kinds, health = null, guestPublicDelayMs = GUEST_PUBLIC_DELAY_MS, timers = globalThis }) {
  const connL = createListeners();
  const leaveL = createListeners();
  const subs = kinds
    .filter((k) => transports[k])
    .map((kind) => ({
      kind,
      t: transports[kind],
      state: /** @type {'idle'|'scheduled'|'joining'|'joined'|'failed'|'left'} */ ('idle'),
      timer: null,
      error: null,
      result: null,
    }));
  if (!subs.length) throw new TypeError('createDualSignaling: no transports');
  const unsubs = [];
  for (const s of subs) {
    unsubs.push(s.t.onPeerConnection((p) => connL.emit({ ...p, kind: s.kind, via: p.via })));
    unsubs.push(s.t.onPeerLeave((peerId, info) => leaveL.emit(peerId, { ...(info || {}), kind: s.kind })));
  }
  let role = 'guest';
  let left = false;
  /** peerId → kind of the connection the transport settled on */
  const owner = new Map();

  const sub = (k) => subs.find((s) => s.kind === k);

  async function leaveSub(s) {
    if (s.timer) timers.clearTimeout(s.timer);
    s.timer = null;
    if (s.state === 'left' || s.state === 'failed') return;
    const was = s.state;
    s.state = 'left';
    if (was === 'joined' || was === 'joining') {
      try {
        await s.t.leave();
      } catch {
        /* ignore */
      }
    }
  }

  const api = {
    kind: subs[0].kind,
    kinds: () => subs.map((s) => s.kind),
    detail: () =>
      subs
        .filter((s) => s.state === 'joined')
        .map((s) => (typeof s.t.detail === 'function' ? s.t.detail() : s.kind))
        .join('+') || subs[0].kind,
    states: () => Object.fromEntries(subs.map((s) => [s.kind, s.state])),
    /** @param {import('./types.js').JoinOptions} opts */
    join(opts) {
      role = opts.role;
      const schedule = signalingSchedule({ kinds: subs.map((s) => s.kind), role, health, guestPublicDelayMs });
      return new Promise((resolve, reject) => {
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          const pending = subs.some((s) => s.state === 'scheduled' || s.state === 'joining');
          if (pending) return;
          const joined = subs.find((s) => s.state === 'joined');
          if (joined) return;
          resolved = true;
          const errs = subs.map((s) => s.error).filter(Boolean);
          const pick = errs.find((e) => DEFINITIVE.has(e.code)) ?? errs.find((e) => e.code !== 'unreachable') ?? errs[0];
          reject(pick ?? new SignalingError('unreachable'));
        };
        const start = (s) => {
          if (left || s.state !== 'idle' && s.state !== 'scheduled') return;
          if (s.timer) timers.clearTimeout(s.timer);
          s.timer = null;
          s.state = 'joining';
          // Public signaling learns the Worker's TURN servers when they are already known.
          const w = sub('worker');
          const iceServers = s.kind === 'public' && w?.result?.iceServers?.length ? w.result.iceServers : opts.iceServers;
          Promise.resolve()
            .then(() => s.t.join({ ...opts, iceServers }))
            .then(
              (r) => {
                if (s.state === 'left') {
                  s.t.leave?.();
                  return;
                }
                s.state = 'joined';
                s.result = r;
                if (s.kind === 'worker' && r?.iceServers?.length) sub('public')?.t.setIceServers?.(r.iceServers);
                if (!resolved) {
                  resolved = true;
                  resolve({ iceServers: r?.iceServers ?? opts.iceServers ?? publicIceServers() });
                }
              },
              (err) => {
                if (s.state === 'left') return;
                s.state = 'failed';
                s.error = err instanceof SignalingError ? err : new SignalingError('unreachable', { kind: s.kind, cause: err });
                if (role === 'guest' && s.kind === 'worker') {
                  if (DEFINITIVE.has(s.error.code)) {
                    // The host is on the Worker and said no: don't knock on the other door.
                    for (const o of subs) if (o !== s && o.state === 'scheduled') leaveSub(o);
                  } else if (FALLBACK_NOW.has(s.error.code)) {
                    const p = sub('public');
                    if (p && p.state === 'scheduled') start(p);
                  }
                }
                finish();
              },
            );
        };
        for (const s of subs) {
          const delay = schedule[s.kind] ?? 0;
          if (delay > 0) {
            s.state = 'scheduled';
            s.timer = timers.setTimeout(() => start(s), delay);
          } else start(s);
        }
      });
    },
    onPeerConnection: (fn) => connL.add(fn),
    onPeerLeave: (fn) => leaveL.add(fn),
    drop(peerId) {
      for (const s of subs) if (s.state === 'joined') s.t.drop(peerId);
    },
    setLocked(locked) {
      for (const s of subs) if (s.state === 'joined') s.t.setLocked(locked);
    },
    async refreshIce() {
      const w = sub('worker');
      if (w && w.state === 'joined') return w.t.refreshIce();
      const any = subs.find((s) => s.state === 'joined');
      return any ? any.t.refreshIce() : publicIceServers();
    },
    async restartIce(peerId) {
      const k = owner.get(peerId);
      const s = (k && sub(k)) || subs.find((x) => x.state === 'joined');
      if (!s || s.state !== 'joined' || typeof s.t.restartIce !== 'function') return false;
      return s.t.restartIce(peerId);
    },
    /** Called by the WebRtcTransport when a connection wins (both channels open). */
    settle(peerId, pc, kind) {
      const s = kind ? sub(kind) : null;
      if (!s) return;
      owner.set(peerId, s.kind);
      try {
        s.t.settle?.(peerId, pc, kind);
      } catch {
        /* ignore */
      }
      if (role === 'guest') for (const o of subs) if (o !== s) leaveSub(o);
    },
    async leave() {
      if (left) return;
      left = true;
      await Promise.all(subs.map(leaveSub));
      for (const u of unsubs) u();
      connL.clear();
      leaveL.clear();
    },
  };
  return api;
}

/**
 * Build the real matchmakers for this page (lazy: Trystero loads only inside public.join()).
 * @param {object} o
 * @param {string|null} o.signalUrl
 * @param {{ ok: boolean }|null} [o.health]
 * @param {'worker'|'public'|null} [o.forced]      dev override: one kind only
 * @param {string[]|null} [o.relays]               dev override: tracker urls
 * @param {object} [o.deps]  { WebSocketImpl, fetchImpl, RTCPeerConnectionImpl, importer, timers }
 */
export async function createSignaling({ signalUrl, health = null, forced = null, relays = null, deps = {} }) {
  const kinds = forced ? [forced] : chooseSignaling({ signalUrl, health });
  /** @type {Record<string, any>} */
  const transports = {};
  if (kinds.includes('worker') && signalUrl) {
    const { createWorkerSignaling } = await import('./worker.js');
    transports.worker = createWorkerSignaling({
      baseUrl: signalUrl,
      WebSocketImpl: deps.WebSocketImpl,
      fetchImpl: deps.fetchImpl,
      RTCPeerConnectionImpl: deps.RTCPeerConnectionImpl,
      ...(deps.timers ? { timers: deps.timers } : {}),
    });
  }
  if (kinds.includes('public')) {
    const { createPublicSignaling } = await import('./public.js');
    transports.public = createPublicSignaling({
      // A dev relay override means "local trackers only": no Nostr fallback to public relays.
      ...(relays ? { trackers: relays, nostrRelays: [] } : {}),
      ...(deps.importer ? { importer: deps.importer } : {}),
      ...(deps.RTCPeerConnectionImpl ? { RTCPeerConnectionImpl: deps.RTCPeerConnectionImpl } : {}),
      ...(deps.timers ? { timers: deps.timers } : {}),
      ...(deps.fallbackAfterMs !== undefined ? { fallbackAfterMs: deps.fallbackAfterMs } : {}),
    });
  }
  return createDualSignaling({
    transports,
    kinds: kinds.filter((k) => transports[k]),
    health,
    ...(deps.timers ? { timers: deps.timers } : {}),
    ...(deps.guestPublicDelayMs !== undefined ? { guestPublicDelayMs: deps.guestPublicDelayMs } : {}),
  });
}

/**
 * One call for the session: matchmaker(s) + WebRtcTransport, subscribed BEFORE join so no
 * early connection is missed.
 * @param {object} o
 * @param {'host'|'guest'} o.role
 * @param {string} o.selfId
 * @param {import('./types.js').RoomIds} o.ids
 * @param {boolean} [o.relayOnly]
 * @param {string|null} [o.signalUrl]
 * @param {{ ok: boolean }|null} [o.health]
 * @param {'worker'|'public'|null} [o.forced]
 * @param {string[]|null} [o.relays]
 * @param {RTCIceServer[]} [o.iceServers]
 * @param {object} [o.deps]
 */
export async function openOnline({ role, selfId, ids, relayOnly = false, signalUrl = null, health = null, forced = null, relays = null, iceServers, deps = {} }) {
  const signaling = deps.signaling ?? (await createSignaling({ signalUrl, health, forced, relays, deps }));
  const { createWebRtcTransport } = await import('../transport/webrtc.js');
  const transport = createWebRtcTransport({
    signaling,
    role,
    selfId,
    iceServers: iceServers ?? publicIceServers(),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.timers ? { timers: deps.timers } : {}),
  });
  try {
    const joined = await signaling.join({ ids, role, selfId, iceServers: iceServers ?? publicIceServers(), relayOnly });
    return { transport, signaling, joined };
  } catch (err) {
    transport.close();
    throw err;
  }
}

/**
 * Resolve when the transport has at least one peer (a guest: the host), reject with
 * SignalingError('no-host') after `timeoutMs`.
 * @param {{ peers: () => string[], onPeer: Function }} transport
 */
export function waitForPeer(transport, { timeoutMs = 20000, timers = globalThis } = {}) {
  return new Promise((resolve, reject) => {
    if (transport.peers().length) return resolve(transport.peers()[0]);
    const off = transport.onPeer((ev) => {
      if (ev.type !== 'join') return;
      off();
      timers.clearTimeout(timer);
      resolve(ev.peerId);
    });
    const timer = timers.setTimeout(() => {
      off();
      reject(new SignalingError('no-host'));
    }, timeoutMs);
  });
}
