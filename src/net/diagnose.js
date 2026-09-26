/**
 * Check connection (NETWORKING.md §13.6): three probes, three kid-friendly rows.
 *
 * | Row          | Probe                                                                  |
 * | Matchmaker   | Worker build: GET /health; public build (or Worker napping): a tracker WebSocket opens |
 * | Direct       | gather ICE with public STUN only: does a `srflx` candidate appear?     |
 * | Relay (TURN) | Worker GET /ice (TURN creds) + gather with iceTransportPolicy 'relay'  |
 *
 * `runConnectionCheck()` returns raw results (candidate TYPES and timings only);
 * `describeCheck()` turns them into rows with kid text plus a "For grown-ups" line. Neither
 * ever keeps or prints an IP address or port: candidate strings are parsed for `typ` and
 * protocol, then dropped (screens get shared and streamed).
 */
import { fetchHealth, fetchIceServers, hasTurn } from './signaling/ice.js';
import { PUBLIC_TRACKERS, publicIceServers } from './signaling/relays.js';

export const GATHER_TIMEOUT_MS = 5000;
export const TRACKER_TIMEOUT_MS = 4000;
export const SLOW_MS = 1500;

const TYP = /\btyp\s+(host|srflx|prflx|relay)\b/;

/**
 * Candidate string → { type, protocol } (never the address).
 * @param {string} line
 */
export function parseCandidate(line) {
  if (typeof line !== 'string') return null;
  const m = TYP.exec(line);
  if (!m) return null;
  const parts = line.replace(/^a=/, '').split(/\s+/);
  const proto = (parts[2] || '').toLowerCase();
  return { type: m[1], protocol: proto === 'tcp' ? 'tcp' : 'udp' };
}

/**
 * Gather ICE candidates for one configuration, keeping only their types.
 * @returns {Promise<{ types: string[], relayProtocols: string[], firstMs: Record<string, number>, timedOut: boolean, error?: string }>}
 */
export async function gatherCandidateTypes({ RTCPeerConnectionImpl, config, timeoutMs = GATHER_TIMEOUT_MS, now = () => Date.now(), timers = globalThis }) {
  const out = { types: [], relayProtocols: [], firstMs: {}, timedOut: false };
  if (typeof RTCPeerConnectionImpl !== 'function') return { ...out, error: 'no-webrtc' };
  let pc;
  try {
    pc = new RTCPeerConnectionImpl(config);
  } catch {
    return { ...out, error: 'config' };
  }
  const t0 = now();
  try {
    await new Promise((resolve) => {
      const timer = timers.setTimeout(() => {
        out.timedOut = true;
        resolve();
      }, timeoutMs);
      const done = () => {
        timers.clearTimeout(timer);
        resolve();
      };
      pc.addEventListener('icecandidate', (ev) => {
        const c = /** @type {any} */ (ev).candidate;
        if (!c) return done();
        const parsed = parseCandidate(c.candidate);
        if (!parsed) return;
        if (!out.types.includes(parsed.type)) {
          out.types.push(parsed.type);
          out.firstMs[parsed.type] = Math.max(0, now() - t0);
        }
        if (parsed.type === 'relay') {
          const rp = typeof c.relayProtocol === 'string' ? c.relayProtocol : parsed.protocol;
          if (['udp', 'tcp', 'tls'].includes(rp) && !out.relayProtocols.includes(rp)) out.relayProtocols.push(rp);
        }
      });
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') done();
      });
      try {
        pc.createDataChannel('sk-probe');
      } catch {
        /* gathering still works for some engines without a channel */
      }
      Promise.resolve()
        .then(() => pc.createOffer())
        .then((o) => pc.setLocalDescription(o))
        .catch(() => {
          out.error = 'offer';
          done();
        });
    });
  } finally {
    try {
      pc.close();
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Try opening tracker WebSockets; the first one that opens wins. */
async function probeTrackers({ WebSocketImpl, trackers, timeoutMs, now, timers }) {
  if (typeof WebSocketImpl !== 'function' || !trackers.length) return { reachable: 0, total: trackers.length, ms: null };
  const t0 = now();
  let firstMs = null;
  const results = await Promise.all(
    trackers.map(
      (url) =>
        new Promise((resolve) => {
          let ws;
          const timer = timers.setTimeout(() => finish(false), timeoutMs);
          function finish(ok) {
            timers.clearTimeout(timer);
            try {
              ws?.close();
            } catch {
              /* ignore */
            }
            resolve(ok);
          }
          try {
            ws = new WebSocketImpl(url);
          } catch {
            finish(false);
            return;
          }
          ws.onopen = () => {
            if (firstMs === null) firstMs = Math.max(0, now() - t0);
            finish(true);
          };
          ws.onerror = () => finish(false);
          ws.onclose = () => finish(false);
        }),
    ),
  );
  return { reachable: results.filter(Boolean).length, total: trackers.length, ms: firstMs };
}

/**
 * Run all three probes. Never throws.
 * @param {object} o
 * @param {string|null} [o.signalUrl]              VITE_SIGNAL_URL (null on a public-only build)
 * @param {typeof fetch} [o.fetchImpl]
 * @param {typeof RTCPeerConnection} [o.RTCPeerConnectionImpl]
 * @param {typeof WebSocket} [o.WebSocketImpl]    for the tracker probe
 * @param {string[]} [o.trackers]
 * @param {RTCIceServer[]} [o.iceServers]          STUN for the direct probe (default: public STUN)
 * @param {() => number} [o.now]
 * @param {object} [o.timers]
 * @param {number} [o.gatherTimeoutMs]
 */
export async function runConnectionCheck({
  signalUrl = null,
  fetchImpl = globalThis.fetch,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  WebSocketImpl = globalThis.WebSocket,
  trackers = [...PUBLIC_TRACKERS],
  iceServers = publicIceServers(),
  now = () => Date.now(),
  timers = globalThis,
  gatherTimeoutMs = GATHER_TIMEOUT_MS,
} = {}) {
  const worker = !!signalUrl;
  // 1. Matchmaker
  const health = worker ? await fetchHealth({ signalUrl, fetchImpl, now }) : null;
  const needTrackers = !worker || !health?.ok;
  const trackerProbe = needTrackers ? await probeTrackers({ WebSocketImpl, trackers, timeoutMs: TRACKER_TIMEOUT_MS, now, timers }) : null;
  let matchStatus;
  if (worker && health?.ok) matchStatus = (health.ms ?? 0) > SLOW_MS ? 'slow' : 'reachable';
  else if (trackerProbe && trackerProbe.reachable > 0) matchStatus = (trackerProbe.ms ?? 0) > SLOW_MS ? 'slow' : 'reachable';
  else matchStatus = 'unreachable';
  const matchmaker = {
    kind: worker && health?.ok ? 'worker' : 'public',
    workerBuild: worker,
    workerOk: worker ? !!health?.ok : null,
    workerMs: health?.ms ?? null,
    turnConfigured: health?.ok ? !!health.turn : null,
    trackers: trackerProbe ? { reachable: trackerProbe.reachable, total: trackerProbe.total, ms: trackerProbe.ms } : null,
    status: matchStatus,
  };

  // 2. Direct connection (public STUN only)
  const direct0 = await gatherCandidateTypes({ RTCPeerConnectionImpl, config: { iceServers }, timeoutMs: gatherTimeoutMs, now, timers });
  // No srflx = no direct path to another house (UDP off, or STUN unreachable): "Relay needed".
  // Host-only candidates still work inside one home network; that detail goes to grown-ups.
  const directStatus = direct0.error === 'no-webrtc' ? 'no-webrtc' : direct0.types.includes('srflx') ? 'yes' : 'no';
  const direct = {
    types: direct0.types,
    stunMs: direct0.firstMs.srflx ?? null,
    status: directStatus,
  };

  // 3. Relay (TURN) — only with our Worker
  let relay;
  if (!worker) relay = { status: 'not-set-up', turn: false, types: [], relayProtocols: [], reason: 'no-worker' };
  else {
    const ice = await fetchIceServers({ signalUrl, fetchImpl });
    if (!ice.turn || !hasTurn(ice.iceServers)) {
      const status = ice.reason === 'unreachable' || ice.reason === 'timeout' ? 'napping' : ice.reason === 'rate' ? 'busy' : 'not-set-up';
      relay = { status, turn: false, types: [], relayProtocols: [], reason: ice.reason ?? 'no-turn' };
    } else {
      const g = await gatherCandidateTypes({
        RTCPeerConnectionImpl,
        config: { iceServers: ice.iceServers, iceTransportPolicy: 'relay' },
        timeoutMs: gatherTimeoutMs,
        now,
        timers,
      });
      relay = {
        status: g.types.includes('relay') ? 'ready' : 'unreachable',
        turn: true,
        types: g.types,
        relayProtocols: g.relayProtocols,
        relayMs: g.firstMs.relay ?? null,
      };
    }
  }
  return { matchmaker, direct, relay, at: now() };
}

const ms = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)} ms` : '—');

/**
 * Raw results → three rows for the Check connection screen.
 * @param {Awaited<ReturnType<typeof runConnectionCheck>>} r
 * @typedef {{ id: 'matchmaker'|'direct'|'relay', icon: '✅'|'⚠️'|'❌', title: string, text: string, grownUps: string }} CheckRow
 * @returns {{ rows: CheckRow[], matchmaker: CheckRow, direct: CheckRow, relay: CheckRow, ok: boolean, hint: string }}
 */
export function describeCheck(r) {
  const m = r?.matchmaker ?? {};
  const d = r?.direct ?? {};
  const rl = r?.relay ?? {};
  const rows = [];

  // Matchmaker
  {
    let icon = '✅';
    let text;
    if (m.status === 'unreachable') {
      icon = '❌';
      text = "Couldn't reach the matchmaker 🙈";
    } else if (m.workerBuild && m.workerOk) {
      icon = m.status === 'slow' ? '⚠️' : '✅';
      text = m.status === 'slow' ? 'Sprinkle Kart server (a bit slow) 🐢' : 'Sprinkle Kart server 🍭 (public relays as backup)';
    } else if (m.workerBuild) {
      icon = '⚠️';
      text = 'Server napping, using public relays 😴';
    } else {
      icon = m.status === 'slow' ? '⚠️' : '✅';
      text = m.status === 'slow' ? 'Public relays (a bit slow) 🐢' : 'Public relays 🌍';
    }
    const bits = [];
    if (m.workerBuild) bits.push(m.workerOk ? `server answered in ${ms(m.workerMs)}` : 'server not answering');
    if (m.workerBuild && m.workerOk) bits.push(m.turnConfigured ? 'relay configured' : 'relay not configured');
    if (m.trackers) bits.push(`public trackers ${m.trackers.reachable}/${m.trackers.total} reachable${m.trackers.ms !== null ? ` (${ms(m.trackers.ms)})` : ''}`);
    rows.push({ id: 'matchmaker', icon, title: 'Matchmaker', text, grownUps: `For grown-ups: ${bits.join(' · ') || '—'}` });
  }

  // Direct
  {
    let icon;
    let text;
    if (d.status === 'yes') {
      icon = '✅';
      text = 'Direct connection works! 🚀';
    } else if (d.status === 'no-webrtc') {
      icon = '❌';
      text = "This browser can't do online races 🙈";
    } else {
      icon = '❌';
      text = 'Relay needed 🛟';
    }
    const types = (d.types || []).join(', ') || 'none';
    rows.push({
      id: 'direct',
      icon,
      title: 'Direct connection',
      text,
      grownUps: `For grown-ups: candidate types ${types} · STUN ≈ ${ms(d.stunMs)}${
        d.status === 'yes' ? '' : (d.types || []).includes('host') ? ' · no srflx candidate: only same-network (host) connections work, UDP or STUN may be off' : ' · no candidates'
      }`,
    });
  }

  // Relay
  {
    let icon;
    let text;
    switch (rl.status) {
      case 'ready':
        icon = '✅';
        text = 'Relay ready 🛟';
        break;
      case 'unreachable':
        icon = '❌';
        text = "The relay can't get through on this network 🧱";
        break;
      case 'napping':
        icon = '⚠️';
        text = 'Relay server napping 😴';
        break;
      case 'busy':
        icon = '⚠️';
        text = 'Relay is busy — try again in a minute ⏳';
        break;
      default:
        icon = '⚠️';
        text = 'Relay not set up yet (a grown-up can add it) 🔧';
    }
    const bits = [];
    if (rl.status === 'ready' || rl.status === 'unreachable') {
      bits.push(`candidate types ${(rl.types || []).join(', ') || 'none'}`);
      if (rl.relayProtocols?.length) bits.push(`relay over ${rl.relayProtocols.join('/')}`);
      if (rl.relayMs !== undefined) bits.push(`relay ≈ ${ms(rl.relayMs)}`);
    } else bits.push(rl.reason === 'no-worker' ? 'no Sprinkle Kart server in this build (see docs/INFRA_SETUP.md)' : `TURN unavailable (${rl.reason || 'not configured'})`);
    rows.push({ id: 'relay', icon, title: 'Relay (TURN)', text, grownUps: `For grown-ups: ${bits.join(' · ')}` });
  }

  const matchOk = rows[0].icon !== '❌';
  const canConnect = matchOk && (d.status === 'yes' || rl.status === 'ready');
  let hint;
  if (!matchOk) hint = 'Try again in a moment, or try another network 📶';
  else if (canConnect) hint = "You're ready to race with friends! 🏁";
  else if (d.status !== 'yes' && rl.status !== 'ready') hint = 'A grown-up can turn on the Sprinkle Kart relay (docs/INFRA_SETUP.md), or try another network 📶';
  else hint = 'Try again in a moment 🔄';
  return { rows, matchmaker: rows[0], direct: rows[1], relay: rows[2], ok: canConnect, hint };
}
