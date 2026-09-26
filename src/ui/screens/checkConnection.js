/**
 * check-connection — "Can we play online here?" (NETWORKING.md §13.6, docs/INFRA_SETUP.md step 8).
 * Three kid-friendly rows (Matchmaker · Direct connection · Relay) with ✅ / ⚠️ / ❌ and a
 * "For grown-ups" line showing candidate TYPES and timings only — never an IP address
 * (screens get shared). The probes are WS4's runConnectionCheck / describeCheck,
 * loaded lazily so no network code ships before someone opens this screen.
 *
 * Params: { returnTo?, result?: raw check (tests / screenshots), run?: () => Promise<raw>, signalUrl?, signal? }.
 * Without params.signal the screen resolves the same signal config the rooms use (build env plus the
 * localhost-only ?signal=… dev override), so dev and e2e builds never probe public trackers/STUN.
 * OWNER: WS6 (session, lobby & screens).
 */
import './online.css';
import * as S from '../menuState.js';
import { el, escapeHtml, hint, floatiesLayer } from '../dom.js';
import { hintsBar, backButton } from './_shared.js';
import { scrubIps } from '../../net/debugOverlay.js';

export const CHECK_OPTIONS = Object.freeze(['again', 'back']);
const PENDING_ROWS = [
  { id: 'matchmaker', icon: '⏳', title: 'Matchmaker', text: 'Looking for the matchmaker…', grownUps: '' },
  { id: 'direct', icon: '⏳', title: 'Direct connection', text: 'Checking the road between houses…', grownUps: '' },
  { id: 'relay', icon: '⏳', title: 'Relay', text: 'Checking the Sprinkle Kart relay…', grownUps: '' },
];

/** The build's Worker URL (null on a public-only build). */
export function signalUrlFromEnv() {
  try { return import.meta.env?.VITE_SIGNAL_URL || null; } catch { return null; }
}

/**
 * The options runConnectionCheck gets for a resolved signal config ({ signalUrl, forced, relays }).
 * A relay override (local trackers) also drops public STUN: that dev mode stays on this machine.
 */
export function checkOptionsFor({ signalUrl = null, signal = null } = {}) {
  if (!signal) return { signalUrl };
  const opts = { signalUrl: signal.forced === 'public' ? null : (signal.signalUrl ?? signalUrl ?? null) };
  if (signal.relays?.length) {
    opts.trackers = [...signal.relays];
    opts.iceServers = [];
  }
  return opts;
}

/** The signal config for this page, resolved like the room flows do (lazy; null if unavailable). */
export async function resolveScreenSignal({
  importer = () => import('../../net/signaling/index.js'),
  envSignalUrl = signalUrlFromEnv(),
  dev = (() => { try { return !!import.meta.env?.DEV; } catch { return false; } })(),
  location = globalThis.location,
} = {}) {
  try {
    const { resolveSignalConfig } = await importer();
    return resolveSignalConfig({ envSignalUrl, search: location?.search ?? '', hostname: location?.hostname ?? '', dev });
  } catch {
    return null;
  }
}

/** Default probe: lazy-load the diagnostics (WS4) and run them. */
export async function runCheck({ signalUrl = signalUrlFromEnv(), signal = null, importer = () => import('../../net/diagnose.js') } = {}) {
  const { runConnectionCheck, describeCheck } = await importer();
  const raw = await runConnectionCheck(checkOptionsFor({ signalUrl, signal }));
  return describeCheck(raw);
}

/** Row markup (text is escaped and scrubbed of anything address-like). */
export function checkRowHtml(row) {
  return `<span class="skn-check-i">${row.icon === '⏳' ? '<span class="skn-spin">⏳</span>' : escapeHtml(row.icon)}</span>`
    + `<span class="skn-check-t"><b>${escapeHtml(row.title)}</b><span>${escapeHtml(scrubIps(row.text))}</span>`
    + `${row.grownUps ? `<small>${escapeHtml(scrubIps(row.grownUps))}</small>` : ''}</span>`;
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'check-connection',
  mount(ctx, nav, params = {}) {
    let state = S.createListState(CHECK_OPTIONS, 1);
    let alive = true;
    let busy = false;
    const rowEls = PENDING_ROWS.map((r) => el(`div.skn-check-row.skn-check-${r.id}`, { html: checkRowHtml(r) }));
    const hintEl = el('div.skn-msg', { role: 'status' });
    const btns = CHECK_OPTIONS.map((id, i) => el('button.skn-btn', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: i }); },
      html: id === 'again' ? '🔁 Check again' : '🏠 Back',
    }));

    const show = (desc) => {
      if (!alive) return;
      const rows = desc?.rows ?? [];
      rowEls.forEach((node, i) => { if (rows[i]) node.innerHTML = checkRowHtml(rows[i]); });
      hintEl.textContent = desc?.hint ? scrubIps(desc.hint) : '';
    };
    const start = async () => {
      if (busy) return;
      busy = true;
      rowEls.forEach((node, i) => { node.innerHTML = checkRowHtml(PENDING_ROWS[i]); });
      hintEl.textContent = '';
      try {
        const desc = params.result ? params.result : await (params.run ?? (async () => runCheck({
          signalUrl: params.signalUrl ?? signalUrlFromEnv(),
          signal: params.signal ?? (params.signalUrl ? null : await resolveScreenSignal()),
        })))();
        show(desc);
      } catch (err) {
        console.warn('[check-connection]', err);
        show({ rows: [], hint: 'Hmm, the check got tangled up. Try again in a moment 🔁' });
      } finally {
        busy = false;
      }
    };

    const node = el('div.sk-screen.skn-screen.skn-checkconn', {},
      floatiesLayer(14, 91),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Check connection <span class="sk-wiggle">🛰️</span>' })),
      el('div.skn-lead', {}, 'Can this computer race friends in other houses? Let\'s peek!'),
      el('div.skn-check', {}, rowEls),
      hintEl,
      el('div.skn-actions', {}, btns),
      hintsBar([hint('A', 'Enter', 'OK'), hint('B', 'Esc', 'Back')]),
    );
    const sync = () => btns.forEach((b, i) => b.classList.toggle('sk-sel', i === state.index));
    const handle = (ev) => {
      const res = S.listReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      sync();
      if (res.go === 'again') start();
      else if (res.go === 'back' || res.go === 'cancel') nav.goto(params.returnTo ?? 'online-hub');
    };
    sync();
    start();
    return { node, cls: 'sk-mode-full skn-mode-online', handle, destroy() { alive = false; } };
  },
};
