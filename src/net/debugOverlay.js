/**
 * Net debug overlay (NETWORKING.md §14): `?netdebug=1`, F9 while online, or
 * Settings → Effects "Show network info". A small panel in the top-left plus
 * the same numbers on `window.__game.net` for smoke / e2e.
 *
 * Screens get shared and streamed, so it shows candidate TYPES only
 * (host / srflx / relay, udp / tcp / tls) — never raw IP addresses or ports:
 * every value goes through a whitelist (enums) or a number formatter, and any
 * free string is scrubbed of anything that looks like an address.
 *
 * `formatNetDebug(info) → rows` is pure (tested with a fake stats report full of
 * IPs); `createDebugOverlay()` renders it (DOM only when called).
 *
 * OWNER: WS6 (session, lobby & screens).
 */

export const CANDIDATE_TYPES = Object.freeze(['host', 'srflx', 'prflx', 'relay']);
export const CANDIDATE_PROTOCOLS = Object.freeze(['udp', 'tcp', 'tls']);
export const TRANSPORT_KINDS = Object.freeze(['public-torrent', 'public-nostr', 'worker', 'memory']);
export const ROLES = Object.freeze(['host', 'guest']);

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g;
// IPv6-ish: a run of hex groups with 2+ colons (e.g. 2001:db8::1, fe80::1%eth0, [::1]:5000)
const IPV6 = /\[?[0-9a-f]*:[0-9a-f]*:[0-9a-f:.%\w]*\]?(?::\d{1,5})?/gi;
const MDNS = /\b[0-9a-f-]{36}\.local\b/gi;

/** Replace anything address-like with '•••'. */
export function scrubIps(text) {
  return String(text ?? '')
    .replace(MDNS, '•••')
    .replace(IPV6, (m) => ((m.match(/:/g) || []).length >= 2 && /[0-9a-f]/i.test(m) ? '•••' : m))
    .replace(IPV4, '•••');
}

const pick = (v, list, dash = '—') => (list.includes(v) ? v : dash);
const num = (v, digits = 0, unit = '') => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : '—');
const yes = (v) => (v === true ? 'yes' : v === false ? 'no' : '—');

/** 'relay/udp' from a candidate type string or { type, protocol } (anything else → '—'). */
export function candidateLabel(c) {
  if (!c) return '—';
  if (typeof c === 'string') {
    const [t, p] = c.split('/');
    const type = pick(t, CANDIDATE_TYPES, '');
    if (!type) return '—';
    return p && CANDIDATE_PROTOCOLS.includes(p) ? `${type}/${p}` : type;
  }
  const type = pick(c.type ?? c.candidateType, CANDIDATE_TYPES, '');
  if (!type) return '—';
  const proto = pick(c.protocol ?? c.relayProtocol, CANDIDATE_PROTOCOLS, '');
  return proto ? `${type}/${proto}` : type;
}

const build = (b) => {
  const s = scrubIps(b ?? '');
  return /^[\w.-]{1,40}$/.test(s) ? s : '—';
};

/**
 * @param {object} info { role, transport, matchmakers[], hostAdvantageMs, self: { build, proto, content },
 *   peers: [{ label?, relayed, candidate, rttMs, jitterMs, lossPct, burstLen, snapshotHz, kbpsIn, kbpsOut,
 *   stateSkips, interpDelayMs, lead, slack, extrapolating, reconcileP50Cm, reconcileP99Cm, snaps, localHits, localHitsConfirmed,
 *   eventsPerSec, lastEventSeq, bufferedCtrl, clockOffsetMs, clockSpreadMs, epoch, hostTick, localTick,
 *   build, proto, content }] }
 * @returns {{ title: string, rows: Array<[string, string]>, peers: Array<{ title: string, rows: Array<[string, string]> }> }}
 */
export function formatNetDebug(info = {}) {
  const i = info ?? {};
  const rows = [
    ['role', pick(i.role, ROLES)],
    ['transport', pick(i.transport, TRANSPORT_KINDS)],
    ['matchmakers', (Array.isArray(i.matchmakers) ? i.matchmakers : []).map((m) => pick(m, TRANSPORT_KINDS)).join(' + ') || '—'],
    ['build', `${build(i.self?.build)} · proto ${num(i.self?.proto)} · content ${num(i.self?.content)}`],
    ['host advantage', num(i.hostAdvantageMs, 0, ' ms')],
  ];
  const peers = (Array.isArray(i.peers) ? i.peers : []).slice(0, 8).map((p, k) => ({
    title: `peer ${k + 1}${typeof p.label === 'string' ? ` ${scrubIps(p.label).slice(0, 24)}` : ''}`,
    rows: [
      ['path', `${p.relayed === true ? 'relayed' : p.relayed === false ? 'direct' : '—'} · ${candidateLabel(p.candidate ?? p.candidateType)}`],
      ['rtt / jitter', `${num(p.rttMs, 0, ' ms')} / ${num(p.jitterMs, 0, ' ms')}`],
      ['loss / burst', `${num(p.lossPct, 1, ' %')} / ${num(p.burstLen, 1)}`],
      ['snapshots in', `${num(p.snapshotHz, 0, ' Hz')}`],
      ['wire kbps in / out', `${num(p.kbpsIn, 0)} / ${num(p.kbpsOut, 0)}`],
      ['state skips', num(p.stateSkips)],
      ['interp delay', num(p.interpDelayMs, 0, ' ms')],
      ['input lead / slack', `${num(p.lead, 0)} / ${num(p.slack, 0)} ticks`],
      ['extrapolating', yes(p.extrapolating)],
      ['reconcile p50 / p99', `${num(p.reconcileP50Cm, 0, ' cm')} / ${num(p.reconcileP99Cm, 0, ' cm')}`],
      ['snaps', num(p.snaps)],
      // own-kart gumdrop bonks played locally at the gumdrop (§9.8) / of those, confirmed by the host
      ['local bonks / confirmed', `${num(p.localHits)} / ${num(p.localHitsConfirmed)}`],
      ['events/s · last seq', `${num(p.eventsPerSec, 1)} · ${num(p.lastEventSeq)}`],
      ['ctrl buffered', num(p.bufferedCtrl, 0, ' B')],
      ['clock offset', `${num(p.clockOffsetMs, 1, ' ms')} ± ${num(p.clockSpreadMs, 1, ' ms')}`],
      ['timebase epoch', num(p.epoch)],
      ['host tick / estimate', `${num(p.hostTick)} / ${num(p.localTick, 1)}`],
      ['their build', `${build(p.build)} · proto ${num(p.proto)} · content ${num(p.content)}`],
    ],
  }));
  return { title: 'Network info 🛰️', rows, peers };
}

/** Plain-text dump of the rows (also what the overlay renders). */
export function netDebugText(info) {
  const f = formatNetDebug(info);
  const lines = [f.title, ...f.rows.map(([k, v]) => `${k}: ${v}`)];
  for (const p of f.peers) lines.push(`— ${p.title}`, ...p.rows.map(([k, v]) => `  ${k}: ${v}`));
  return scrubIps(lines.join('\n'));
}

/** `?netdebug=1` or the saved "Show network info" preference. */
export function shouldShowNetDebug({ search = '', showNetworkInfo = false } = {}) {
  if (showNetworkInfo === true) return true;
  try { return new URLSearchParams(search).get('netdebug') === '1'; } catch { return false; }
}

/**
 * A tiny overlay panel (top-left). `update(info)` re-renders; `destroy()` removes it.
 * @param {{ doc?: Document, parent?: HTMLElement }} [o]
 */
export function createDebugOverlay({ doc = typeof document !== 'undefined' ? document : null, parent = null } = {}) {
  if (!doc) return { node: null, update() {}, destroy() {}, text: '' };
  const node = doc.createElement('pre');
  node.className = 'sk-netdebug';
  Object.assign(node.style, {
    position: 'fixed', left: '8px', top: '8px', zIndex: '50', margin: '0', padding: '6px 8px', maxWidth: '44ch',
    font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#4b2a5a', background: 'rgba(255,255,255,0.82)',
    borderRadius: '8px', pointerEvents: 'none', whiteSpace: 'pre-wrap',
  });
  (parent ?? doc.body)?.appendChild?.(node);
  const api = {
    node,
    text: '',
    update(info) {
      api.text = netDebugText(info);
      node.textContent = api.text;
    },
    destroy() { node.remove?.(); },
  };
  return api;
}
