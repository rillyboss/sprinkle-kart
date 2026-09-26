/**
 * Pure planning helpers for scripts/smoke-online.mjs (unit-tested in tests/net.e2eplan.test.js).
 *
 * Like scripts/smoke-plan.mjs, nothing here touches a browser, a socket or the file system: it
 * turns (CLI filters, environment) into a profile, an ordered scenario list, URLs, the worker
 * dev command, and the pass/fail maths (timing percentiles vs the §17 M1-19 budgets, identical
 * standings, heap growth), so CI and local runs are predictable and testable.
 *
 * NETWORKING.md §15 (browser e2e row), §16.2 (ship ladder) and §17 (M1-19, M2, M3-5).
 */
import { isIgnorableError } from './smoke-plan.mjs';
import {
  ROOM_WORDS, SECRET_SWEETS, SWEETS_GRID_COLS, LABEL_DIGITS, splitLabel, createCodeEntryState,
} from '../src/net/session/roomCode.js';

/** Standard-mapping gamepad buttons the controller-only run presses (Gamepad API indices). */
export const PAD = Object.freeze({ A: 0, B: 1, X: 2, Y: 3, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 });

const shortest = (from, to, n) => {
  const up = ((to - from) % n + n) % n;
  return up <= n - up ? { dir: 'up', steps: up } : { dir: 'down', steps: n - up };
};

/**
 * The controller-only presses that type a room code + secret sweets on the code-entry screen
 * (src/net/session/roomCode.js codeEntryReduce): spin the word wheel and the 4 digit wheels the
 * short way round, confirm each wheel, then walk the 8 × 8 sweets grid (rows first, so Up never
 * leaves the grid) and pick the 6 sweets in order; the last press is the "Knock!" confirm.
 * Returns menu actions ('up'|'down'|'left'|'right'|'confirm').
 * @param {{ label: string, sweets: number[] }} secret
 */
export function planCodeEntry(secret) {
  const lab = splitLabel(secret.label);
  if (!lab) throw new Error(`planCodeEntry: bad label ${secret.label}`);
  const st = createCodeEntryState();
  const out = [];
  const spin = (from, to, n) => { const s = shortest(from, to, n); for (let i = 0; i < s.steps; i++) out.push(s.dir); };
  spin(st.wordIndex, lab.wordIndex, ROOM_WORDS.length);
  out.push('confirm');
  for (let k = 0; k < LABEL_DIGITS; k++) {
    spin(st.digits[k], lab.digits[k], 10);
    out.push('confirm'); // next wheel; after the last digit: on to the sweets grid
  }
  let cursor = st.cursor;
  const cols = SWEETS_GRID_COLS;
  for (const target of secret.sweets) {
    if (!(Number.isInteger(target) && target >= 0 && target < SECRET_SWEETS.length)) throw new Error(`planCodeEntry: bad sweet ${target}`);
    const dr = Math.floor(target / cols) - Math.floor(cursor / cols);
    for (let i = 0; i < Math.abs(dr); i++) out.push(dr > 0 ? 'down' : 'up');
    cursor += dr * cols;
    const dc = target - cursor;
    for (let i = 0; i < Math.abs(dc); i++) out.push(dc > 0 ? 'right' : 'left');
    cursor = target;
    out.push('confirm');
  }
  out.push('confirm'); // focus is on "Knock on SPRINKLE-4821!" after the 6th sweet
  return out;
}

/** Menu action → standard gamepad button. */
export function padButtonFor(action) {
  const b = { up: PAD.UP, down: PAD.DOWN, left: PAD.LEFT, right: PAD.RIGHT, confirm: PAD.A, back: PAD.B, start: PAD.START }[action];
  if (b === undefined) throw new Error(`padButtonFor: no button for ${action}`);
  return b;
}

/** The two matchmaker paths of the e2e: (a) public signaling via scripts/dev/localTracker.mjs, (b) our Worker via `npm run worker:dev`. */
export const ONLINE_PATHS = Object.freeze(['public', 'worker']);

/** How the guest finds the room: the invite link (`#join=` fragment) or code + sweets typed with ONLY controller events. */
export const JOIN_METHODS = Object.freeze(['invite', 'controller']);

/** Milestones in ship-ladder order (§16.2). */
export const MILESTONES = Object.freeze(['M1', 'M2', 'M3']);

/** §17 M1-19: code entry → lobby, p90 over the timing runs, per path (ms). */
export const CODE_TO_LOBBY_P90_MS = Object.freeze({ worker: 10000, public: 20000 });

/** §17 M3-5: browser soak heap growth budget (MB) and default length (minutes). */
export const SOAK_HEAP_GROWTH_MB = 30;
export const SOAK_MINUTES = 10;

/** Every screenshot the M1 run must leave in smoke-out/online/ (reviewed by a person, attached to the PR). */
export const M1_SCREENSHOTS = Object.freeze([
  'hub', 'code-entry', 'lobby-host', 'lobby-guest', 'approval-host', 'approval-guest',
  'check-connection-udp-blocked', 'race-host', 'race-guest', 'results-host', 'results-guest',
]);

/** Screenshots that need the in-game online flow (WS7: ctx.online.pick → race); the others come from the lobby path. */
export const RACE_SCREENSHOTS = Object.freeze(['race-host', 'race-guest', 'results-host', 'results-guest']);

/**
 * The scenario catalogue, in run order. `milestone` gates it (profile.milestone), `explicit`
 * scenarios run only when a filter names them (the 10-minute soak).
 *   room    — the full two-context scenario on one path with one join method (§15)
 *   timing  — N fresh guests join one path; code entry → lobby is measured each time
 *   check   — Check connection with simulated UDP blocked (fake ICE) on one path
 *   gp      — M2: Grand Prix 4 races + ceremony, identical standings
 *   reconnect — M2: guest drops mid-race and comes back within 60 s (token + RESYNC)
 *   team / battle — M3 modes
 *   soak    — M3-5: 10-minute two-context run, heap growth < 30 MB, no console errors
 */
export const ONLINE_SCENARIOS = Object.freeze([
  { name: 'public-invite', kind: 'room', path: 'public', join: 'invite', milestone: 'M1' },
  { name: 'public-controller', kind: 'room', path: 'public', join: 'controller', milestone: 'M1' },
  { name: 'worker-invite', kind: 'room', path: 'worker', join: 'invite', milestone: 'M1' },
  { name: 'worker-controller', kind: 'room', path: 'worker', join: 'controller', milestone: 'M1' },
  { name: 'public-timing', kind: 'timing', path: 'public', milestone: 'M1' },
  { name: 'worker-timing', kind: 'timing', path: 'worker', milestone: 'M1' },
  { name: 'public-check', kind: 'check', path: 'public', milestone: 'M1' },
  { name: 'worker-check', kind: 'check', path: 'worker', milestone: 'M1' },
  { name: 'worker-gp', kind: 'gp', path: 'worker', milestone: 'M2' },
  { name: 'worker-reconnect', kind: 'reconnect', path: 'worker', milestone: 'M2' },
  { name: 'worker-team', kind: 'team', path: 'worker', milestone: 'M3' },
  { name: 'worker-battle', kind: 'battle', path: 'worker', milestone: 'M3' },
  { name: 'soak', kind: 'soak', path: 'worker', milestone: 'M3', explicit: true },
].map((s) => Object.freeze(s)));

const truthy = (v) => v !== undefined && v !== null && v !== '' && v !== '0' && String(v).toLowerCase() !== 'false';
const intIn = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
};
function parseViewport(text, fallback) {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(text || '').trim());
  return m ? { width: Number(m[1]), height: Number(m[2]) } : fallback;
}

/**
 * Resolve the run profile from the environment.
 *
 *   SMOKE_PORT              vite dev server port (default 5290); the game is always served on localhost
 *   SMOKE_WORKER_PORT       `npm run worker:dev` port (default 8787); an already running worker there is reused
 *   SMOKE_TRACKER_PORT      scripts/dev/localTracker.mjs port (default 0 = any free port)
 *   SMOKE_ONLINE_RUNS       timing runs per path (default 10, §17 M1-19)
 *   SMOKE_ONLINE_MILESTONE  M1 | M2 | M3 — the newest milestone whose scenarios run (default M1)
 *   SMOKE_ONLINE_STRICT     1 = a step that needs a later workstream (e.g. WS7's in-game race) FAILS instead of
 *                           being reported as pending
 *   SMOKE_SOAK_MINUTES      browser soak length (default 10)
 *   SMOKE_WORKER_NODE       a Node 22+ executable for worker:dev when this Node is older
 *   CI / SMOKE_TIMEOUT_SCALE / SMOKE_RETRIES / SMOKE_VIEWPORT as in smoke-plan.mjs
 * @param {Record<string, string | undefined>} env
 */
export function resolveOnlineProfile(env = {}) {
  const ci = truthy(env.CI);
  const scale = Number(env.SMOKE_TIMEOUT_SCALE);
  const ms = String(env.SMOKE_ONLINE_MILESTONE || '').toUpperCase();
  const soak = Number(env.SMOKE_SOAK_MINUTES);
  return {
    name: ci ? 'ci' : 'local',
    ci,
    port: intIn(env.SMOKE_PORT, 1, 65535, 5290),
    workerPort: intIn(env.SMOKE_WORKER_PORT, 1, 65535, 8787),
    trackerPort: intIn(env.SMOKE_TRACKER_PORT, 0, 65535, 0),
    timingRuns: intIn(env.SMOKE_ONLINE_RUNS, 1, 100, 10),
    milestone: MILESTONES.includes(ms) ? ms : 'M1',
    strict: truthy(env.SMOKE_ONLINE_STRICT),
    soakMinutes: Number.isFinite(soak) && soak > 0 ? Math.min(soak, 120) : SOAK_MINUTES,
    viewport: parseViewport(env.SMOKE_VIEWPORT, ci ? { width: 800, height: 450 } : { width: 1280, height: 720 }),
    timeoutScale: Number.isFinite(scale) && scale > 0 ? scale : ci ? 4 : 1,
    retries: intIn(env.SMOKE_RETRIES, 0, 3, 1),
    workerNode: env.SMOKE_WORKER_NODE || null,
  };
}

/** Scale a base timeout (ms) by the profile, never below the base. */
export function onlineTimeout(profile, baseMs) {
  return Math.round(baseMs * Math.max(1, profile?.timeoutScale ?? 1));
}

const msIndex = (m) => MILESTONES.indexOf(m);

/**
 * The ordered scenario list. Filters are substrings of scenario names (`public`, `worker`, `invite`,
 * `controller`, `timing`, `check`, `soak`, a full name…); no filter = every scenario up to the milestone
 * except the explicit ones. A filter that names a later-milestone scenario outright still runs it.
 * @param {{ filters?: string[], profile: ReturnType<typeof resolveOnlineProfile> }} o
 */
export function planOnlineScenarios({ filters = [], profile }) {
  return ONLINE_SCENARIOS.filter((s) => {
    const named = filters.some((f) => f === s.name);
    const matched = !filters.length || filters.some((f) => s.name.includes(f));
    if (!matched) return false;
    if (s.explicit) return filters.some((f) => s.name.includes(f)) && filters.length > 0;
    return named || msIndex(s.milestone) <= msIndex(profile.milestone);
  });
}

/** Which matchmaker processes a plan needs (so the runner only starts what it uses). */
export function neededServices(plan) {
  return {
    tracker: plan.some((s) => s.path === 'public'),
    worker: plan.some((s) => s.path === 'worker'),
  };
}

/**
 * The game URL for one context. The dev override (`?signal=…`) only works on localhost / dev builds
 * (src/net/signaling/index.js resolveSignalConfig), so the host is always `localhost`.
 * @param {{ port: number, path: 'public'|'worker', trackerUrl?: string|null, workerUrl?: string|null,
 *           invite?: string|null, laps?: number|null, extra?: Record<string, string> }} o
 */
export function gameUrl({ port, path, trackerUrl = null, workerUrl = null, invite = null, laps = 1, extra = {} }) {
  const q = new URLSearchParams();
  if (path === 'worker') {
    if (!workerUrl) throw new Error('gameUrl: the worker path needs workerUrl');
    q.set('signal', 'worker');
    q.set('signalUrl', workerUrl);
  } else if (path === 'public') {
    if (!trackerUrl) throw new Error('gameUrl: the public path needs trackerUrl');
    q.set('signal', 'public');
    q.set('relays', trackerUrl);
  } else throw new Error(`gameUrl: unknown path ${path}`);
  if (laps) q.set('laps', String(laps));
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const hash = invite ? `#${String(invite).replace(/^.*#/, '')}` : '';
  return `http://localhost:${port}/?${q.toString()}${hash}`;
}

/** `#join=SPRINKLE-4821~abcdef` from a full invite link (the part a guest's browser keeps local). */
export function inviteFragment(link) {
  const m = /#(join=[^#\s]+)$/.exec(String(link || ''));
  return m ? m[1] : null;
}

/** Major version from 'v22.1.0' / '22.1.0' (NaN when unreadable). */
export function nodeMajorOf(version) {
  const m = /^v?(\d+)\./.exec(String(version ?? ''));
  return m ? Number(m[1]) : NaN;
}

/**
 * Pick a Node 22+ executable for `npm run worker:dev` (wrangler ≥ 4.88 needs it; NETWORKING.md §3).
 * Order: SMOKE_WORKER_NODE, this Node when new enough, then the candidates (e.g. nvm-windows installs),
 * newest version first. Returns null when none qualifies.
 * @param {{ override?: string|null, version: string, execPath: string,
 *           candidates?: Array<{ path: string, version: string }> }} o
 */
export function pickWorkerNode({ override = null, version, execPath, candidates = [] }) {
  if (override) return override;
  if (nodeMajorOf(version) >= 22) return execPath;
  const ok = candidates.filter((c) => nodeMajorOf(c.version) >= 22)
    .sort((a, b) => nodeMajorOf(b.version) - nodeMajorOf(a.version));
  return ok.length ? ok[0].path : null;
}

/**
 * Directory names of an nvm-style install ('v25.4.0', 'v20.20.0', 'elevate.cmd'…) → candidate node paths.
 * @param {string} root  e.g. C:\ProgramData\nvm
 * @param {string[]} names
 * @param {'win32'|string} platform
 */
export function nvmCandidates(root, names, platform = 'win32') {
  const sep = platform === 'win32' ? '\\' : '/';
  const exe = platform === 'win32' ? 'node.exe' : `bin${sep}node`;
  return names.filter((n) => /^v\d+\.\d+\.\d+$/.test(n)).map((n) => ({ path: `${root}${sep}${n}${sep}${exe}`, version: n }));
}

/**
 * The worker dev command (`node scripts/worker.mjs dev …`, the same wrapper as `npm run worker:dev`),
 * with the port passed through and, for the relay row of Check connection, a LOCAL mock of the
 * Cloudflare TURN API (TURN_API_BASE + dummy key vars: never a real secret, never the real API).
 * @param {{ node: string, port: number, turnMockUrl?: string|null }} o
 * @returns {{ cmd: string, args: string[] }}
 */
export function workerDevCommand({ node, port, turnMockUrl = null }) {
  const args = ['scripts/worker.mjs', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--log-level', 'warn'];
  if (turnMockUrl) {
    args.push('--var', `TURN_API_BASE:${turnMockUrl}`, '--var', 'TURN_KEY_ID:local-e2e-key', '--var', 'TURN_KEY_API_TOKEN:local-e2e-token');
  }
  return { cmd: node, args };
}

/** PATH with the worker Node's folder first, so the wrapper's `npx`/`npm` run on the same Node. */
export function pathWithNodeFirst(nodePath, currentPath = '', platform = 'win32') {
  const sep = platform === 'win32' ? '\\' : '/';
  const i = nodePath.lastIndexOf(sep);
  const dir = i > 0 ? nodePath.slice(0, i) : '';
  if (!dir) return currentPath;
  const delim = platform === 'win32' ? ';' : ':';
  return [dir, ...String(currentPath).split(delim).filter((p) => p && p !== dir)].join(delim);
}

/** The body a mock TURN API returns for POST …/credentials/generate-ice-servers (shape of Cloudflare's answer). */
export function mockTurnAnswer(ttl = 900) {
  return {
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp',
          'turn:turn.cloudflare.com:3478?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: `e2e-user-${ttl}`,
        credential: 'e2e-credential',
      },
    ],
  };
}

/** Nearest-rank percentile (p in 0..1) of a list of numbers; null for an empty list. */
export function percentile(samples, p) {
  const s = samples.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const rank = Math.max(1, Math.ceil(p * s.length));
  return s[Math.min(s.length, rank) - 1];
}

/**
 * Code entry → lobby timings of one path vs its budget (§17 M1-19).
 * @param {number[]} samples ms per run (failed runs are Infinity)
 * @param {'public'|'worker'} path
 * @param {number} [wantRuns]
 */
export function timingSummary(samples, path, wantRuns = samples.length) {
  const budgetMs = CODE_TO_LOBBY_P90_MS[path];
  const done = samples.filter((x) => Number.isFinite(x));
  const p90 = percentile(samples.map((x) => (Number.isFinite(x) ? x : Number.MAX_SAFE_INTEGER)), 0.9);
  const problems = [];
  const warnings = [];
  if (samples.length < wantRuns) problems.push(`only ${samples.length} of ${wantRuns} timing runs ran`);
  // A run that never arrived counts as the slowest sample: the p90 budget decides (1 in 10 may miss,
  // as the acceptance number says), and every miss is reported as a warning for the PR.
  const lost = samples.length - done.length;
  if (lost) warnings.push(`${lost} of ${samples.length} run(s) never reached the lobby`);
  const shownP90 = p90 === Number.MAX_SAFE_INTEGER ? null : p90;
  if (p90 === null || p90 > budgetMs) problems.push(`code entry → lobby p90 ${shownP90 === null ? 'never' : `${Math.round(p90)} ms`} > ${budgetMs} ms budget (${path})`);
  return {
    path, runs: samples.length, lost, budgetMs,
    p50: percentile(done, 0.5), p90: shownP90, max: done.length ? Math.max(...done) : null,
    ok: !problems.length, problems, warnings,
  };
}

/** One results table row for the PR / job summary. */
export function timingRow(t) {
  const f = (x) => (x === null || x === undefined ? '—' : `${(x / 1000).toFixed(2)} s`);
  return `| ${t.path} | ${t.runs}${t.lost ? ` (${t.lost} lost)` : ''} | ${f(t.p50)} | ${f(t.p90)} | ${f(t.max)} | ≤ ${(t.budgetMs / 1000).toFixed(0)} s | ${t.ok ? (t.lost ? '⚠️' : '✅') : '❌'} |`;
}

/**
 * Compare the standings two machines show (host vs guest). Each row: { id|characterId, place, finishTimeMs? }.
 * Returns human-readable differences (empty = identical).
 */
export function standingsProblems(host, guest, { who = 'guest' } = {}) {
  const rows = (x) => (Array.isArray(x) ? x : Array.isArray(x?.standings) ? x.standings : null);
  const a = rows(host);
  const b = rows(guest);
  if (!a || !a.length) return ['host has no standings'];
  if (!b || !b.length) return [`${who} has no standings`];
  const out = [];
  if (a.length !== b.length) out.push(`${who} shows ${b.length} racers, host ${a.length}`);
  const key = (r) => r.id ?? r.characterId ?? r.kartId;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (key(a[i]) !== key(b[i])) out.push(`place ${i + 1}: host ${key(a[i])}, ${who} ${key(b[i])}`);
    else if ((a[i].finishTimeMs ?? null) !== (b[i].finishTimeMs ?? null)) out.push(`${key(a[i])} finish time: host ${a[i].finishTimeMs}, ${who} ${b[i].finishTimeMs}`);
  }
  return out;
}

/**
 * Heap growth over a soak (MB): median of the last 3 samples minus the median of the first 3 after
 * `warmup` samples. Samples: [{ t, usedMB }].
 */
export function heapGrowthMb(samples, { warmup = 1 } = {}) {
  const v = samples.map((s) => s.usedMB).filter((x) => Number.isFinite(x)).slice(warmup);
  if (v.length < 2) return 0;
  const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return med(v.slice(-3)) - med(v.slice(0, 3));
}

export function heapProblems(samples, { limitMb = SOAK_HEAP_GROWTH_MB, who = 'page' } = {}) {
  const g = heapGrowthMb(samples);
  return g > limitMb ? [`${who} heap grew ${g.toFixed(1)} MB (> ${limitMb} MB) over the soak`] : [];
}

/** Screenshots the run was supposed to leave but didn't (names without the .png). */
export function missingScreenshots(files, { needRace = true, required = M1_SCREENSHOTS } = {}) {
  const have = new Set(files.map((f) => String(f).replace(/\.png$/i, '').replace(/^.*[\\/]/, '').replace(/^(public|worker)-(pad-)?/, '')));
  return required.filter((n) => (needRace || !RACE_SCREENSHOTS.includes(n)) && !have.has(n));
}

/**
 * Console noise we never treat as a failure. The browser runs with every non-local host name
 * unresolvable (hermetic: no public tracker / relay / STUN is ever reached), so a font request
 * failing with ERR_NAME_NOT_RESOLVED is expected; anything else still fails the scenario.
 */
export function isIgnorableOnlineError(text) {
  const s = String(text);
  if (isIgnorableError(s)) return true;
  // Chrome's console line for a blocked font has no URL; the runner's requestfailed hook still
  // fails the scenario for any NON-font external request (it sees the URL).
  if (/^(console: )?Failed to load resource: net::ERR_NAME_NOT_RESOLVED$/.test(s)) return true;
  // Trystero logs a deliberate close of a peer connection (remove a house, leave) as an error.
  if (/Trystero peer error: OperationError: User-Initiated Abort, reason=Close called/.test(s)) return true;
  return /net::ERR_NAME_NOT_RESOLVED/.test(s) && /fonts\.(googleapis|gstatic)\.com/.test(s);
}

/** A WebSocket / fetch URL the hermetic run must never open (anything not on this machine). */
export function isExternalUrl(url) {
  try {
    const u = new URL(url);
    return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * The Chrome flags of every online e2e run (NETWORKING.md §15): SwiftShader WebGL, real host
 * candidates instead of mDNS names (flaky in headless on Windows), and every host name except
 * this machine unresolvable so no public tracker, relay or STUN server can ever be contacted.
 */
export function chromeArgs(platform = process.platform) {
  const args = [
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--autoplay-policy=no-user-gesture-required',
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1',
  ];
  if (platform === 'linux') args.push('--disable-dev-shm-usage');
  return args;
}

/** Scenario status from its problems and pending steps (pending = needs a later workstream). */
export function scenarioStatus({ problems = [], pending = [] }, { strict = false } = {}) {
  if (problems.length) return 'fail';
  if (pending.length) return strict ? 'fail' : 'pending';
  return 'ok';
}
