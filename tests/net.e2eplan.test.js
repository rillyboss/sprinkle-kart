// scripts/smoke-online-plan.mjs — the pure half of the online browser e2e (NETWORKING.md §15, §17 M1-19).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ONLINE_PATHS, JOIN_METHODS, ONLINE_SCENARIOS, CODE_TO_LOBBY_P90_MS, M1_SCREENSHOTS, RACE_SCREENSHOTS,
  resolveOnlineProfile, onlineTimeout, planOnlineScenarios, neededServices, gameUrl, inviteFragment, nodeMajorOf,
  pickWorkerNode, nvmCandidates, workerDevCommand, pathWithNodeFirst, mockTurnAnswer, percentile, timingSummary,
  timingRow, standingsProblems, heapGrowthMb, heapProblems, missingScreenshots, isIgnorableOnlineError, isExternalUrl,
  chromeArgs, scenarioStatus, SOAK_HEAP_GROWTH_MB, SOAK_MINUTES, planCodeEntry, padButtonFor, PAD,
} from '../scripts/smoke-online-plan.mjs';
import { createCodeEntryState, codeEntryReduce, makeRoomSecret, ROOM_WORDS } from '../src/net/session/roomCode.js';
import { resolveSignalConfig } from '../src/net/signaling/index.js';
import { makeInviteLink, parseInviteFragment } from '../src/net/session/inviteLink.js';
import { filterPort53 } from '../infra/signal-worker/src/turn.js';

const names = (plan) => plan.map((s) => s.name);
const profile = (env = {}) => resolveOnlineProfile(env);

describe('online e2e profile', () => {
  it('defaults: local, M1, 10 timing runs, pending allowed, ports that do not clash with smoke.mjs', () => {
    const p = profile();
    expect(p).toMatchObject({ name: 'local', ci: false, port: 5290, workerPort: 8787, trackerPort: 0, timingRuns: 10, milestone: 'M1', strict: false, retries: 1, timeoutScale: 1 });
    expect(p.viewport).toEqual({ width: 1280, height: 720 });
    expect(p.soakMinutes).toBe(SOAK_MINUTES);
  });

  it('reads every knob and passes the ports through', () => {
    const p = profile({
      SMOKE_PORT: '5662', SMOKE_WORKER_PORT: '8811', SMOKE_TRACKER_PORT: '8812', SMOKE_ONLINE_RUNS: '3',
      SMOKE_ONLINE_MILESTONE: 'm2', SMOKE_ONLINE_STRICT: '1', SMOKE_SOAK_MINUTES: '2', SMOKE_VIEWPORT: '800x450',
      SMOKE_TIMEOUT_SCALE: '2', SMOKE_RETRIES: '0', SMOKE_WORKER_NODE: 'C:\\node25\\node.exe',
    });
    expect(p).toMatchObject({ port: 5662, workerPort: 8811, trackerPort: 8812, timingRuns: 3, milestone: 'M2', strict: true, soakMinutes: 2, timeoutScale: 2, retries: 0, workerNode: 'C:\\node25\\node.exe' });
    expect(p.viewport).toEqual({ width: 800, height: 450 });
  });

  it('CI: small viewport and 4x timeouts; junk values fall back to defaults', () => {
    const p = profile({ CI: 'true', SMOKE_PORT: 'abc', SMOKE_ONLINE_RUNS: '0', SMOKE_ONLINE_MILESTONE: 'M9', SMOKE_ONLINE_STRICT: 'false', SMOKE_RETRIES: '7' });
    expect(p).toMatchObject({ name: 'ci', ci: true, port: 5290, timingRuns: 10, milestone: 'M1', strict: false, timeoutScale: 4, retries: 1 });
    expect(p.viewport).toEqual({ width: 800, height: 450 });
    expect(onlineTimeout(p, 1000)).toBe(4000);
    expect(onlineTimeout(profile({ SMOKE_TIMEOUT_SCALE: '0.5' }), 1000)).toBe(1000); // never below the base
  });
});

describe('scenario plan', () => {
  it('the catalogue covers both paths × both join methods, timing and check for each path', () => {
    for (const path of ONLINE_PATHS) {
      for (const join of JOIN_METHODS) expect(ONLINE_SCENARIOS.some((s) => s.kind === 'room' && s.path === path && s.join === join), `${path}/${join}`).toBe(true);
      expect(ONLINE_SCENARIOS.some((s) => s.kind === 'timing' && s.path === path)).toBe(true);
      expect(ONLINE_SCENARIOS.some((s) => s.kind === 'check' && s.path === path)).toBe(true);
    }
    expect(new Set(ONLINE_SCENARIOS.map((s) => s.name)).size).toBe(ONLINE_SCENARIOS.length);
    expect(Object.isFrozen(ONLINE_SCENARIOS[0])).toBe(true);
  });

  it('M1 by default: rooms, timings and checks; no GP / reconnect / team / battle / soak', () => {
    expect(names(planOnlineScenarios({ profile: profile() }))).toEqual([
      'public-invite', 'public-controller', 'worker-invite', 'worker-controller',
      'public-timing', 'worker-timing', 'public-check', 'worker-check',
    ]);
  });

  it('M2 adds the GP + ceremony and reconnect scenarios, M3 adds Team and Battle; the soak only runs when named', () => {
    const m2 = names(planOnlineScenarios({ profile: profile({ SMOKE_ONLINE_MILESTONE: 'M2' }) }));
    expect(m2).toContain('worker-gp');
    expect(m2).toContain('worker-reconnect');
    expect(m2).not.toContain('worker-team');
    const m3 = names(planOnlineScenarios({ profile: profile({ SMOKE_ONLINE_MILESTONE: 'M3' }) }));
    expect(m3).toEqual(expect.arrayContaining(['worker-gp', 'worker-reconnect', 'worker-team', 'worker-battle']));
    expect(m3).not.toContain('soak');
    expect(names(planOnlineScenarios({ filters: ['soak'], profile: profile() }))).toEqual(['soak']);
  });

  it('filters are substrings; a full name runs a later-milestone scenario anyway', () => {
    const p = profile();
    expect(names(planOnlineScenarios({ filters: ['public'], profile: p }))).toEqual(['public-invite', 'public-controller', 'public-timing', 'public-check']);
    expect(names(planOnlineScenarios({ filters: ['controller'], profile: p }))).toEqual(['public-controller', 'worker-controller']);
    expect(names(planOnlineScenarios({ filters: ['worker-invite', 'timing'], profile: p }))).toEqual(['worker-invite', 'public-timing', 'worker-timing']);
    expect(names(planOnlineScenarios({ filters: ['worker-gp'], profile: p }))).toEqual(['worker-gp']);
    expect(names(planOnlineScenarios({ filters: ['gp'], profile: p }))).toEqual([]); // substring, but M2 > M1
    expect(planOnlineScenarios({ filters: ['nope'], profile: p })).toEqual([]);
  });

  it('only the matchmakers a plan uses are started', () => {
    const p = profile();
    expect(neededServices(planOnlineScenarios({ profile: p }))).toEqual({ tracker: true, worker: true });
    expect(neededServices(planOnlineScenarios({ filters: ['public'], profile: p }))).toEqual({ tracker: true, worker: false });
    expect(neededServices(planOnlineScenarios({ filters: ['worker-'], profile: p }))).toEqual({ tracker: false, worker: true });
  });
});

describe('game URLs', () => {
  const tracker = 'ws://127.0.0.1:9123';
  const worker = 'http://127.0.0.1:8811';

  it('public path: the dev override the game actually honours on localhost', () => {
    const url = gameUrl({ port: 5662, path: 'public', trackerUrl: tracker });
    expect(url).toBe('http://localhost:5662/?signal=public&relays=ws%3A%2F%2F127.0.0.1%3A9123&laps=1');
    const u = new URL(url);
    expect(resolveSignalConfig({ search: u.search, hostname: u.hostname })).toEqual({ signalUrl: null, forced: 'public', relays: [tracker] });
  });

  it('worker path: signalUrl survives the game parser', () => {
    const u = new URL(gameUrl({ port: 5662, path: 'worker', workerUrl: worker, laps: null, extra: { netdebug: '1' } }));
    expect(u.searchParams.get('laps')).toBe(null);
    expect(u.searchParams.get('netdebug')).toBe('1');
    expect(resolveSignalConfig({ search: u.search, hostname: u.hostname })).toEqual({ signalUrl: worker, forced: 'worker', relays: null });
  });

  it('the override is ignored off localhost, so the e2e must stay on localhost', () => {
    const u = new URL(gameUrl({ port: 5662, path: 'worker', workerUrl: worker }));
    expect(resolveSignalConfig({ search: u.search, hostname: 'rillyboss.github.io' }).forced).toBe(null);
  });

  it('invite links keep their secret in the fragment, which the game parses back', () => {
    const secret = { label: 'SPRINKLE-4821', sweets: [0, 12, 3, 47, 55, 62] };
    const link = makeInviteLink(secret, 'https://rillyboss.github.io/sprinkle-kart/');
    const frag = inviteFragment(link);
    expect(frag).toMatch(/^join=SPRINKLE-4821~[A-Za-z0-9_-]{6}$/);
    const url = gameUrl({ port: 5662, path: 'public', trackerUrl: tracker, invite: link });
    expect(url.endsWith(`#${frag}`)).toBe(true);
    expect(url.split('#')[0]).not.toContain('SPRINKLE'); // never in the query string
    expect(parseInviteFragment(new URL(url).hash)).toEqual(secret);
    expect(inviteFragment('https://x/#nothing')).toBe(null);
  });

  it('refuses a path without its matchmaker', () => {
    expect(() => gameUrl({ port: 1, path: 'worker' })).toThrow(/workerUrl/);
    expect(() => gameUrl({ port: 1, path: 'public' })).toThrow(/trackerUrl/);
    expect(() => gameUrl({ port: 1, path: 'lan', trackerUrl: 'x' })).toThrow(/unknown path/);
  });
});

describe('worker dev plumbing', () => {
  it('picks a Node 22+ for wrangler: override, then this Node, then the newest nvm install', () => {
    const candidates = nvmCandidates('C:\\ProgramData\\nvm', ['elevate.cmd', 'v14.21.3', 'v20.20.0', 'v25.4.0', 'v22.3.0', 'nodejs.ico']);
    expect(candidates.map((c) => c.version)).toEqual(['v14.21.3', 'v20.20.0', 'v25.4.0', 'v22.3.0']);
    expect(candidates[2].path).toBe('C:\\ProgramData\\nvm\\v25.4.0\\node.exe');
    expect(pickWorkerNode({ version: 'v20.20.0', execPath: 'C:\\n20\\node.exe', candidates })).toBe('C:\\ProgramData\\nvm\\v25.4.0\\node.exe');
    expect(pickWorkerNode({ version: 'v24.1.0', execPath: '/usr/bin/node', candidates })).toBe('/usr/bin/node');
    expect(pickWorkerNode({ override: 'D:\\n\\node.exe', version: 'v24.1.0', execPath: '/usr/bin/node' })).toBe('D:\\n\\node.exe');
    expect(pickWorkerNode({ version: 'v20.1.0', execPath: 'x', candidates: [{ path: 'y', version: 'v18.0.0' }] })).toBe(null);
    expect(nvmCandidates('/home/u/.nvm/versions/node', ['v22.0.0'], 'linux')[0].path).toBe('/home/u/.nvm/versions/node/v22.0.0/bin/node');
    expect(nodeMajorOf('v25.4.0')).toBe(25);
    expect(nodeMajorOf('garbage')).toBeNaN();
  });

  it('runs the same wrapper as npm run worker:dev, on the passed port, with a LOCAL mock TURN API only', () => {
    const plain = workerDevCommand({ node: 'node', port: 8811 });
    expect(plain.args.slice(0, 2)).toEqual(['scripts/worker.mjs', 'dev']);
    expect(plain.args.join(' ')).toContain('--port 8811 --ip 127.0.0.1');
    expect(plain.args).not.toContain('--var');
    const mocked = workerDevCommand({ node: 'node', port: 8811, turnMockUrl: 'http://127.0.0.1:9000' });
    const vars = mocked.args.filter((_, i) => mocked.args[i - 1] === '--var');
    expect(vars).toEqual(['TURN_API_BASE:http://127.0.0.1:9000', 'TURN_KEY_ID:local-e2e-key', 'TURN_KEY_API_TOKEN:local-e2e-token']);
    expect(mocked.args.join(' ')).not.toContain('rtc.live.cloudflare.com');
  });

  it('the wrapper script accepts the dev command and the worker config names are the binding ones', () => {
    const wrapper = readFileSync(new URL('../scripts/worker.mjs', import.meta.url), 'utf8');
    expect(wrapper).toMatch(/dev: \['dev'\]/);
    const toml = readFileSync(new URL('../infra/signal-worker/wrangler.toml', import.meta.url), 'utf8');
    expect(toml).toContain('name = "sprinkle-kart-signal"');
    expect(toml).toContain('TURN_API_BASE');
    const devVars = readFileSync(new URL('../infra/signal-worker/.dev.vars.example', import.meta.url), 'utf8');
    expect(devVars).toMatch(/ALLOWED_ORIGINS=http:\/\/localhost:\*,http:\/\/127\.0\.0\.1:\*/); // any smoke port may connect
  });

  it('puts the worker Node first on PATH (so npx/npm inside the wrapper use it) without duplicates', () => {
    expect(pathWithNodeFirst('C:\\nvm\\v25\\node.exe', 'C:\\a;C:\\nvm\\v25;C:\\b')).toBe('C:\\nvm\\v25;C:\\a;C:\\b');
    expect(pathWithNodeFirst('/opt/n/bin/node', '/usr/bin:/bin', 'linux')).toBe('/opt/n/bin:/usr/bin:/bin');
    expect(pathWithNodeFirst('node', '/usr/bin', 'linux')).toBe('/usr/bin');
  });

  it('the mock TURN answer looks like Cloudflare\'s (incl. :53 URLs the worker must filter)', () => {
    const a = mockTurnAnswer(900);
    const filtered = filterPort53(a.iceServers);
    expect(JSON.stringify(filtered)).not.toMatch(/:53\b/);
    expect(filtered.some((s) => s.username && s.credential && s.urls.some((u) => u.startsWith('turns:') && u.includes(':443')))).toBe(true);
  });
});

describe('controller-only code entry', () => {
  const run = (secret) => {
    let s = createCodeEntryState();
    let last = null;
    for (const a of planCodeEntry(secret)) {
      last = codeEntryReduce(s, { deviceId: 'pad0', action: a });
      s = last.state;
    }
    return last;
  };

  it('the planned presses make the reducer knock with exactly that secret', () => {
    for (const secret of [
      { label: 'SPRINKLE-4821', sweets: [0, 12, 3, 47, 55, 62] },
      { label: `${ROOM_WORDS[ROOM_WORDS.length - 1]}-9990`, sweets: [63, 0, 63, 7, 56, 8] },
      { label: `${ROOM_WORDS[16]}-5555`, sweets: [5, 5, 5, 5, 5, 5] },
    ]) {
      const last = run(secret);
      expect(last.go, secret.label).toBe('join');
      expect(last.secret).toEqual(secret);
    }
  });

  it('works for random secrets and never uses more presses than the short way round', () => {
    for (let i = 0; i < 40; i++) {
      const secret = makeRoomSecret();
      const presses = planCodeEntry(secret);
      expect(run(secret).secret).toEqual(secret);
      // ≤ 16 word spins + 5 × 5 digit spins + 5 confirms + 6 × (7 rows + 7 cols + 1) + 1
      expect(presses.length).toBeLessThanOrEqual(16 + 25 + 5 + 6 * 15 + 1);
      expect(presses.every((a) => ['up', 'down', 'left', 'right', 'confirm'].includes(a))).toBe(true);
    }
  });

  it('maps every action to a standard-gamepad button and rejects junk', () => {
    expect(padButtonFor('confirm')).toBe(PAD.A);
    expect([padButtonFor('up'), padButtonFor('down'), padButtonFor('left'), padButtonFor('right')]).toEqual([12, 13, 14, 15]);
    expect(padButtonFor('back')).toBe(PAD.B);
    expect(() => padButtonFor('jump')).toThrow();
    expect(() => planCodeEntry({ label: 'nope', sweets: [] })).toThrow(/bad label/);
    expect(() => planCodeEntry({ label: 'SPRINKLE-4821', sweets: [64] })).toThrow(/bad sweet/);
  });
});

describe('timing maths (code entry → lobby, §17 M1-19)', () => {
  it('budgets are the acceptance numbers', () => {
    expect(CODE_TO_LOBBY_P90_MS).toEqual({ worker: 10000, public: 20000 });
  });

  it('nearest-rank percentile', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(ten, 0.9)).toBe(9);
    expect(percentile(ten, 0.5)).toBe(5);
    expect(percentile(ten, 1)).toBe(10);
    expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([], 0.9)).toBe(null);
    expect(percentile([3, NaN, 1], 0.5)).toBe(1);
  });

  it('passes under budget, fails over it, and a run that never arrived counts as the slowest', () => {
    const ok = timingSummary([1200, 1500, 900, 2000, 1100, 1300, 1400, 1000, 1600, 9000], 'worker', 10);
    expect(ok).toMatchObject({ ok: true, runs: 10, p90: 2000, max: 9000, budgetMs: 10000, problems: [] });
    const slow = timingSummary([11000, 12000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 'worker', 10);
    expect(slow.ok).toBe(false);
    expect(slow.problems[0]).toMatch(/p90 11000 ms > 10000 ms/);
    const lost = timingSummary([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, Infinity, Infinity], 'public', 10);
    expect(lost.ok).toBe(false); // 2 of 10 lost: the p90 sample is a run that never arrived
    expect(lost.problems.join(' ')).toMatch(/p90 never > 20000 ms/);
    expect(lost.warnings).toEqual(['2 of 10 run(s) never reached the lobby']);
    const oneLost = timingSummary([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, Infinity], 'public', 10);
    expect(oneLost).toMatchObject({ ok: true, lost: 1, p90: 1000, max: 1000 }); // 1 in 10 may miss (p90)…
    expect(oneLost.warnings[0]).toMatch(/1 of 10/); // …but it is always reported
    expect(timingRow(oneLost)).toContain('| 10 (1 lost) |');
    expect(timingRow(oneLost)).toContain('⚠️');
    expect(timingSummary([15000], 'public', 10).problems[0]).toMatch(/only 1 of 10/);
    expect(timingSummary([15000], 'public', 1).ok).toBe(true); // 20 s budget on public
  });

  it('formats a results-table row for the PR', () => {
    const row = timingRow(timingSummary([1000, 2000], 'worker'));
    expect(row).toBe('| worker | 2 | 1.00 s | 2.00 s | 2.00 s | ≤ 10 s | ✅ |');
    expect(timingRow({ path: 'public', runs: 0, p50: null, p90: null, max: null, budgetMs: 20000, ok: false })).toContain('— | — | — | ≤ 20 s | ❌');
  });
});

describe('result checks', () => {
  const host = [{ id: 3, place: 1, finishTimeMs: 61000 }, { id: 0, place: 2, finishTimeMs: 62500 }];

  it('identical standings pass; order, count and finish-time differences are reported', () => {
    expect(standingsProblems(host, host.map((r) => ({ ...r })))).toEqual([]);
    expect(standingsProblems({ standings: host }, { standings: host })).toEqual([]);
    expect(standingsProblems(host, [host[1], host[0]])[0]).toMatch(/place 1: host 3, guest 0/);
    expect(standingsProblems(host, [host[0]])[0]).toMatch(/1 racers, host 2/);
    expect(standingsProblems(host, [host[0], { ...host[1], finishTimeMs: 62501 }])[0]).toMatch(/finish time/);
    expect(standingsProblems([], host)).toEqual(['host has no standings']);
    expect(standingsProblems(host, null, { who: 'guest 2' })).toEqual(['guest 2 has no standings']);
    expect(standingsProblems([{ characterId: 'luna' }], [{ characterId: 'luna' }])).toEqual([]);
  });

  it('heap growth uses medians after a warm-up, and fails over 30 MB', () => {
    expect(SOAK_HEAP_GROWTH_MB).toBe(30);
    const flat = [80, 50, 52, 51, 53, 52, 51].map((usedMB, t) => ({ t, usedMB }));
    expect(heapGrowthMb(flat)).toBeLessThan(2); // the first (warm-up) spike is ignored
    const leak = Array.from({ length: 11 }, (_, t) => ({ t, usedMB: 50 + t * 5 }));
    expect(heapGrowthMb(leak)).toBe(35); // median(55,60,65)=60 → median(90,95,100)=95
    expect(heapProblems(leak, { who: 'host' })[0]).toMatch(/host heap grew 35\.0 MB/);
    expect(heapProblems(flat)).toEqual([]);
    expect(heapGrowthMb([{ usedMB: 1 }])).toBe(0);
  });

  it('knows which screenshots are missing (race ones only when the race ran)', () => {
    const lobbyOnly = ['public-hub.png', 'worker-pad-code-entry.png', 'smoke-out/online/lobby-host.png', 'lobby-guest.png', 'approval-host.png', 'approval-guest.png', 'check-connection-udp-blocked.png'];
    expect(missingScreenshots(lobbyOnly, { needRace: false })).toEqual([]);
    expect(missingScreenshots(lobbyOnly)).toEqual(RACE_SCREENSHOTS);
    expect(missingScreenshots([])).toEqual(M1_SCREENSHOTS);
  });

  it('scenario status: problems fail, pending steps are pending unless strict', () => {
    expect(scenarioStatus({ problems: [], pending: [] })).toBe('ok');
    expect(scenarioStatus({ problems: ['x'], pending: [] })).toBe('fail');
    expect(scenarioStatus({ problems: [], pending: ['race needs WS7'] })).toBe('pending');
    expect(scenarioStatus({ problems: [], pending: ['race needs WS7'] }, { strict: true })).toBe('fail');
  });
});

describe('hermetic browser (never a real public relay, §15)', () => {
  it('every non-local host name is unresolvable; host candidates are real (no mDNS); SwiftShader', () => {
    const args = chromeArgs('win32');
    expect(args).toContain('--disable-features=WebRtcHideLocalIpsWithMdns');
    expect(args).toEqual(expect.arrayContaining(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']));
    const rules = args.find((a) => a.startsWith('--host-resolver-rules='));
    expect(rules).toMatch(/MAP \* ~NOTFOUND/);
    expect(rules).toMatch(/EXCLUDE localhost/);
    expect(rules).toMatch(/EXCLUDE 127\.0\.0\.1/);
    expect(chromeArgs('linux')).toContain('--disable-dev-shm-usage');
    expect(chromeArgs('win32')).not.toContain('--disable-dev-shm-usage');
  });

  it('flags every public tracker / relay / STUN host as external, and this machine as local', () => {
    for (const u of ['wss://tracker.openwebtorrent.com', 'wss://nos.lol', 'https://rtc.live.cloudflare.com/v1', 'wss://relay.damus.io']) expect(isExternalUrl(u), u).toBe(true);
    for (const u of ['ws://127.0.0.1:9123', 'ws://localhost:8811/room/r1', 'http://[::1]:5173/']) expect(isExternalUrl(u), u).toBe(false);
    expect(isExternalUrl('not a url')).toBe(false);
  });

  it('only blocked font requests are ignorable console noise', () => {
    expect(isIgnorableOnlineError('Failed to load resource: net::ERR_NAME_NOT_RESOLVED https://fonts.googleapis.com/css2')).toBe(true);
    expect(isIgnorableOnlineError('requestfailed: https://fonts.gstatic.com/x.woff2')).toBe(true);
    expect(isIgnorableOnlineError('net::ERR_NAME_NOT_RESOLVED wss://tracker.openwebtorrent.com')).toBe(false);
    expect(isIgnorableOnlineError('TypeError: x is undefined')).toBe(false);
    // Chrome's URL-less console line (the requestfailed hook still sees and judges the URL)
    expect(isIgnorableOnlineError('console: Failed to load resource: net::ERR_NAME_NOT_RESOLVED')).toBe(true);
    expect(isIgnorableOnlineError('Failed to load resource: the server responded with a status of 404 (Not Found)')).toBe(false);
    // a deliberate close (remove / leave) that Trystero logs as an error
    expect(isIgnorableOnlineError('Trystero peer error: OperationError: User-Initiated Abort, reason=Close called')).toBe(true);
    expect(isIgnorableOnlineError('Trystero peer error: OperationError: something else')).toBe(false);
  });
});

describe('CI: the nightly online e2e never gates anything (§15)', () => {
  const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const jobOf = (name) => {
    const start = yml.indexOf(`\n  ${name}:`);
    if (start < 0) return null;
    const rest = yml.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };
  const job = jobOf('online-smoke');

  it('exists, runs smoke-online on Node 24 with system Chrome and uploads smoke-out/online', () => {
    expect(job).not.toBe(null);
    expect(job).toContain('node scripts/smoke-online.mjs');
    expect(job).toMatch(/node-version: 24/);
    expect(job).toContain('google-chrome --version');
    expect(job).toMatch(/path: smoke-out\/online\//);
    expect(job).toMatch(/if: always\(\)/);
  });

  it('runs only nightly / on manual dispatch, never on PRs or pushes, and cannot fail the workflow', () => {
    expect(job).toMatch(/if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
    expect(job).not.toMatch(/pull_request/);
    expect(job).toMatch(/continue-on-error: true/);
    expect(job).not.toMatch(/needs:/);
    // nothing waits for it
    expect(yml).not.toMatch(/needs:\s*\[?[^\n]*online-smoke/);
  });

  it('leaves the gate and the other jobs alone: test-and-build first, worker-test only on worker changes, smoke after the gate', () => {
    const names = [...yml.matchAll(/\n {2}([a-z-]+):\n/g)].map((m) => m[1]).filter((n) => ['test-and-build', 'worker-test', 'smoke', 'online-smoke'].includes(n));
    expect(names).toEqual(['test-and-build', 'worker-test', 'smoke', 'online-smoke']);
    const gate = jobOf('test-and-build');
    expect(gate).toContain('npm run test:coverage');
    expect(gate).not.toContain('smoke-online');
    const worker = jobOf('worker-test');
    expect(worker).toContain('infra/signal-worker');
    expect(worker).toContain('npm run worker:test');
    expect(jobOf('smoke')).toMatch(/needs: test-and-build/);
  });
});

describe('docs: the manual checklist and the contributing section', () => {
  const checklist = readFileSync(new URL('../docs/ONLINE_CHECKLIST.md', import.meta.url), 'utf8');
  const contributing = readFileSync(new URL('../CONTRIBUTING.md', import.meta.url), 'utf8');

  it('the checklist covers every §15 manual item and ends with a results table for the release PR', () => {
    for (const needle of [
      'two real homes', 'phone hotspot', 'text message', 'Check connection', 'UDP', 'Relay needed', '45 minutes',
      'iPad', 'Hosting needs a computer', 'Version mismatch', 'everyone refresh', 'Room locked', '## Results',
    ]) expect(checklist.toLowerCase(), needle).toContain(needle.toLowerCase());
    expect(checklist).toMatch(/never run in CI/i);
    expect(checklist).toMatch(/\| # \| Check/);
    expect(checklist).toMatch(/- \[ \]/); // tick boxes
  });

  it('CONTRIBUTING explains the online smoke, worker:dev, soak, LAN/iPad testing and links the checklist', () => {
    const i = contributing.indexOf('### Online testing');
    expect(i).toBeGreaterThan(0);
    const section = contributing.slice(i, contributing.indexOf('\n## ', i));
    for (const needle of [
      'node scripts/smoke-online.mjs', 'SMOKE_PORT', 'SMOKE_WORKER_PORT', 'npm run worker:dev', 'Node 22+',
      'SOAK=1', 'scripts/dev/localTracker.mjs', 'docs/ONLINE_CHECKLIST.md', 'cloudflared tunnel', 'GitHub Pages',
      'secure context', 'smoke-out/online/', 'online-smoke', 'hermetic',
    ]) expect(section, needle).toContain(needle);
  });

  it('the documented budgets match the plan', () => {
    expect(contributing).toContain(`≤ ${CODE_TO_LOBBY_P90_MS.worker / 1000} s p90 on the Worker`);
    expect(contributing).toContain(`≤ ${CODE_TO_LOBBY_P90_MS.public / 1000} s p90 on public relays`);
  });
});

describe('the runner stays in sync with its plan', () => {
  const src = readFileSync(new URL('../scripts/smoke-online.mjs', import.meta.url), 'utf8');

  it('imports the plan and launches system Chrome headless with the plan\'s flags and two contexts', () => {
    expect(src).toContain("from './smoke-online-plan.mjs'");
    expect(src).toMatch(/channel: 'chrome'/);
    expect(src).toMatch(/headless: true/);
    expect(src).toContain('chromeArgs(');
    expect((src.match(/browser\.newContext\(/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(src).toContain('startLocalTracker');
  });

  it('has a runner for every scenario kind in the catalogue', () => {
    for (const kind of new Set(ONLINE_SCENARIOS.map((s) => s.kind))) expect(src, kind).toMatch(new RegExp(`\\b${kind}: `));
  });

  it('writes screenshots and the summary into smoke-out/online/', () => {
    expect(src).toMatch(/'smoke-out', 'online'/);
    expect(src).toContain('summary.json');
  });
});

describe('netcode quality in the online e2e (net review #14)', () => {
  it('asserts reconcile / snapshot rate / lead / skips / loss only with a real GPU', async () => {
    const { qualityProblems, QUALITY_BUDGET } = await import('../scripts/smoke-online-plan.mjs');
    const good = { fps: 58, reconcileP99Cm: 12, snapshotHz: 30, lead: 4.5, stateSkips: 0, lossPct: 0 };
    expect(qualityProblems(good)).toMatchObject({ asserted: true, problems: [] });
    const bad = { fps: 58, reconcileP99Cm: 84, snapshotHz: 15, lead: 60, stateSkips: 130, lossPct: 13.5 };
    const r = qualityProblems(bad);
    expect(r.problems).toHaveLength(5);
    expect(r.note).toMatch(/reconcile p99 84 cm/);
    // swiftshader (1.7 fps): a note, never a failure
    const slow = qualityProblems({ ...bad, fps: 1.7 });
    expect(slow).toMatchObject({ asserted: false, problems: [] });
    expect(slow.note).toMatch(/not asserted below 20 fps/);
    expect(qualityProblems(null).problems).toEqual(['no netcode sample from the guest']);
    expect(QUALITY_BUDGET.minFps).toBe(20);
    const e2e = readFileSync(new URL('../scripts/smoke-online.mjs', import.meta.url), 'utf8');
    expect(e2e).toMatch(/const q = qualityProblems\(sample\);/);
    // the glue no longer fakes a heartbeat; the scenario idles past the host-silence limit (net review #1)
    expect(e2e).not.toMatch(/new Uint8Array\(\[0\]\)/);
    expect(e2e).toMatch(/const IDLE_MS = 11000;/);
    expect(e2e).toMatch(/idleMs: IDLE_MS/);
  });
});
