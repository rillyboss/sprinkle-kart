#!/usr/bin/env node
/**
 * Sprinkle Kart ONLINE e2e (NETWORKING.md §15 "Browser e2e", §17 M1-19).
 *
 *   SMOKE_PORT=5662 node scripts/smoke-online.mjs [filters...]
 *   SMOKE_PORT=5662 SMOKE_WORKER_PORT=8811 node scripts/smoke-online.mjs worker-controller
 *   node scripts/smoke-online.mjs soak            # the 10-minute browser soak (M3-5), only when named
 *
 * Starts its own Vite dev server on SMOKE_PORT, the minimal WebTorrent tracker
 * (scripts/dev/localTracker.mjs, in-process) and `npm run worker:dev` (the same wrapper,
 * with the port passed through and a LOCAL mock of the Cloudflare TURN API), then drives
 * system Chrome (headless, SwiftShader) with TWO browser contexts = two houses:
 *
 *   (a) public path  ?signal=public&relays=ws://127.0.0.1:<tracker>
 *   (b) Worker path  ?signal=worker&signalUrl=http://127.0.0.1:<worker>
 *
 * Scenario per path (scripts/smoke-online-plan.mjs has the list): online on (the save seeds
 * `onlineEnabled`; the parent gate itself is covered by unit tests), the host opens a room
 * from the title → Online → Host; the guest (2 local players) joins BY INVITE LINK in one run
 * and BY CONTROLLER EVENTS ONLY (word wheel, digit wheels, sweets grid) in another; the match
 * check pair is compared on both screens and screenshotted before the host approves; seats,
 * racer picks, lobby emotes both ways; Free Race 1 lap + identical standings + rematch (needs
 * WS7's in-game flow, see below); remove the guest → the room locks → the guest's reload is
 * refused. Timing runs measure code entry → lobby 10× per path against the M1-19 budgets.
 * Check connection runs with UDP blocked (fake ICE) and must say "Relay needed".
 *
 * The browser is HERMETIC: every non-local host name is unresolvable (chromeArgs), ICE servers
 * that are not on this machine are stripped, and any WebSocket to a non-local host is recorded
 * and fails the scenario, so no automated run ever contacts a real public tracker / relay /
 * STUN server.
 *
 * WS7 (net/integration) wires the in-game online flow as `menus.online` (host / join / pick /
 * leave). When a build has it, this script drives the real thing end to end. Until then it
 * installs a small TEST-ONLY stand-in built from the real modules (openOnline = real signaling
 * + real WebRtcTransport, createHostSession / createGuestSession, the real screens), so every
 * step up to the lobby runs for real, and the race steps are reported as PENDING (a failure
 * with SMOKE_ONLINE_STRICT=1).
 *
 * Output: smoke-out/online/<path>-*.png, summary.json (+ GitHub job summary). Exits non-zero
 * on any failure. Never waits on the wall clock where a game condition exists.
 */
import { spawn, execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  resolveOnlineProfile, onlineTimeout, planOnlineScenarios, neededServices, gameUrl, pickWorkerNode, nvmCandidates,
  workerDevCommand, pathWithNodeFirst, mockTurnAnswer, timingSummary, timingRow, standingsProblems, heapProblems,
  missingScreenshots, isIgnorableOnlineError, chromeArgs, scenarioStatus, planCodeEntry, padButtonFor, PAD,
} from './smoke-online-plan.mjs';
import { startLocalTracker } from './dev/localTracker.mjs';
import { makeInviteLink } from '../src/net/session/inviteLink.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'smoke-out', 'online');
const PROFILE = resolveOnlineProfile(process.env);
const PORT = PROFILE.port;
const BASE = `http://localhost:${PORT}/`;
const filters = process.argv.slice(2);
const T = (ms) => onlineTimeout(PROFILE, ms);
const log = (...a) => console.log('[online]', ...a);

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/-FAIL\.(png|log)$/.test(f)) rmSync(path.join(OUT, f), { force: true });

const results = [];
const timings = [];
const children = [];

/* ---------------- services: vite, local tracker, mock TURN API, worker dev ---------------- */

function spawnLogged(cmd, args, opts, name) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts });
  child.tail = '';
  const keep = (d) => { child.tail = (child.tail + d).slice(-20000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', (code) => { if (code) log(`${name} exited (${code})\n${child.tail.slice(-3000)}`); });
  children.push(child);
  return child;
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch { /* already gone */ }
}

async function waitHttp(url, ms, what, child = null) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (child && child.exitCode !== null) throw new Error(`${what} exited early\n${child.tail?.slice(-3000) ?? ''}`);
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${what} did not answer at ${url} within ${Math.round(ms / 1000)} s\n${child?.tail?.slice(-3000) ?? ''}`);
}

async function startVite() {
  const child = spawnLogged(`npx vite --port ${PORT} --strictPort`, [], { shell: true }, 'vite');
  await waitHttp(BASE, T(60000), 'vite dev server', child);
  log(`vite up on ${BASE}`);
  return child;
}

/** A local stand-in for POST https://rtc.live.cloudflare.com/v1/turn/keys/<id>/credentials/generate-ice-servers. */
function startTurnMock() {
  const stats = { requests: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.method !== 'POST' || !/\/v1\/turn\/keys\/[^/]+\/credentials\/generate-ice-servers$/.test(req.url)
        || req.headers.authorization !== 'Bearer local-e2e-token') {
        res.writeHead(404).end();
        return;
      }
      stats.requests++;
      let ttl = 900;
      try { ttl = JSON.parse(body).ttl ?? 900; } catch { /* default */ }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify(mockTurnAnswer(ttl)));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ url: `http://127.0.0.1:${port}`, stats, close: () => new Promise((r) => server.close(() => r())) });
  }));
}

function workerNodeCandidates() {
  const roots = [process.env.NVM_HOME, 'C:\\ProgramData\\nvm'].filter(Boolean);
  const out = [];
  for (const root of roots) {
    try { out.push(...nvmCandidates(root, readdirSync(root), process.platform)); } catch { /* not there */ }
  }
  return out.filter((c) => existsSync(c.path));
}

async function startWorker(turnMockUrl) {
  const url = `http://127.0.0.1:${PROFILE.workerPort}`;
  try {
    const r = await fetch(`${url}/health`);
    if (r.ok) {
      const h = await r.json();
      log(`reusing the signal worker already running at ${url} (turn: ${h.turn})`);
      return { url, child: null, reused: true, turn: !!h.turn };
    }
  } catch { /* start our own */ }
  const node = pickWorkerNode({ override: PROFILE.workerNode, version: process.version, execPath: process.execPath, candidates: workerNodeCandidates() });
  if (!node) throw new Error('npm run worker:dev needs Node 22+ (set SMOKE_WORKER_NODE to a node.exe, e.g. C:\\ProgramData\\nvm\\v25.4.0\\node.exe)');
  const { cmd, args } = workerDevCommand({ node, port: PROFILE.workerPort, turnMockUrl });
  const env = { ...process.env, PATH: pathWithNodeFirst(node, process.env.PATH ?? process.env.Path ?? '', process.platform) };
  if (process.platform === 'win32') env.Path = env.PATH;
  log(`starting worker:dev on ${url} with ${node}`);
  const child = spawnLogged(cmd, args, { env }, 'worker:dev');
  const r = await waitHttp(`${url}/health`, T(180000), 'npm run worker:dev', child); // first run installs the worker package
  const h = await r.json();
  log(`worker up: ${JSON.stringify(h)}`);
  return { url, child, reused: false, turn: !!h.turn };
}

/* ---------------- browser pages ---------------- */

/** Before any page script: online on in this browser's save, hermetic network, optional fake pad. */
const INIT_SCRIPT = (cfg) => {
  try {
    const KEY = 'sprinkle-kart-progress-v1';
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!cur.settings || !cur.settings.onlineEnabled) {
      cur.settings = { ...(cur.settings || {}), onlineEnabled: true, music: 0, sfx: 0 };
      localStorage.setItem(KEY, JSON.stringify(cur));
    }
  } catch { /* storage blocked: the scenario will say online is off */ }
  const H = { external: [], strippedIce: 0 };
  window.__skHermetic = H;
  const localHost = (h) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h);
  const isLocalUrl = (u) => { try { return localHost(new URL(u, location.href).hostname); } catch { return true; } };
  const WS = window.WebSocket;
  window.WebSocket = new Proxy(WS, {
    construct(target, args) {
      if (!isLocalUrl(String(args[0]))) H.external.push(String(args[0]));
      return Reflect.construct(target, args);
    },
  });
  const PC = window.RTCPeerConnection;
  if (PC) {
    const iceLocal = (u) => /^(stun|stuns|turn|turns):(\[::1\]|127\.0\.0\.1|localhost)(:|\?|$)/i.test(String(u));
    const clean = (c) => {
      if (!c || !Array.isArray(c.iceServers)) return c;
      const iceServers = [];
      for (const s of c.iceServers) {
        const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => { const keep = iceLocal(u); if (!keep) H.strippedIce++; return keep; });
        if (urls.length) iceServers.push({ ...s, urls });
      }
      return { ...c, iceServers };
    };
    class HermeticRTCPeerConnection extends PC {
      constructor(c, ...rest) { super(clean(c), ...rest); }
      setConfiguration(c) { return super.setConfiguration(clean(c)); }
    }
    window.RTCPeerConnection = HermeticRTCPeerConnection;
  }
  if (cfg && cfg.pad) {
    const pad = {
      id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
      index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: { playEffect: () => Promise.resolve('complete') },
    };
    window.__pad = { set(i, on) { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp++; } };
    navigator.getGamepads = () => [pad, null, null, null];
  }
};

/**
 * TEST-ONLY stand-in for WS7's `menus.online` (installed only when the build has none). It is
 * glue over the REAL modules: openOnline (real matchmaker + WebRtcTransport), the real host /
 * guest sessions and net contexts, the real screens. Races are WS7's job, so pick() only notes
 * the request. Runs in the page; `cfg` = { forced, signalUrl, relays, localPlayers }.
 */
async function installOnlineGlue(cfg) {
  const menus = window.__game.menus;
  const E = window.__skE2E = window.__skE2E || { marks: {}, log: [], emotes: [], ended: null, mode: null };
  if (menus.online) { E.mode = 'integrated'; return 'integrated'; }
  E.mode = 'glue';
  const [sig, types, hostS, guestS, roomCode, invite] = await Promise.all([
    import('/src/net/signaling/index.js'), import('/src/net/signaling/types.js'), import('/src/net/session/hostSession.js'),
    import('/src/net/session/guestSession.js'), import('/src/net/session/roomCode.js'), import('/src/net/session/inviteLink.js'),
  ]);
  // WS2's src/net/roomKey.js when this build has it (the runner checks the file, so no 404 is ever requested)
  const roomKey = cfg.hasRoomKey ? await import(/* @vite-ignore */ '/src/net/roomKey.js') : null;
  const enc = new TextEncoder();
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // NETWORKING.md §4.2 room key (used only until src/net/roomKey.js exists)
  async function deriveIds(secret) {
    if (roomKey?.deriveRoomIds) return roomKey.deriveRoomIds(secret);
    const base = await crypto.subtle.importKey('raw', enc.encode(`${secret.label}|${secret.sweets.join('.')}`), 'PBKDF2', false, ['deriveBits']);
    const K = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('sprinkle-kart-room-v1'), iterations: 150000 }, base, 256);
    const hk = await crypto.subtle.importKey('raw', K, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = (s) => crypto.subtle.sign('HMAC', hk, enc.encode(s));
    return { topic: `sk-${hex(await mac('topic')).slice(0, 20)}`, password: b64url(await mac('pw')), workerRoom: `r${hex(await mac('room')).slice(0, 24)}` };
  }
  const open = (role, ids) => sig.openOnline({
    role, selfId: types.makePeerId(), ids, signalUrl: cfg.signalUrl, forced: cfg.forced, relays: cfg.relays,
    deps: { fallbackAfterMs: 1e9 }, // never add the PUBLIC Nostr relays in a test
  });
  const note = (what, extra = {}) => { E.log.push({ t: Math.round(performance.now()), what, ...extra }); if (E.log.length > 400) E.log.shift(); };
  let live = null;

  function stop() {
    if (!live) return;
    for (const id of live.timers) clearInterval(id);
    try { live.session?.dispose?.(); } catch { /* ignore */ }
    try { live.transport?.close?.(); } catch { /* ignore */ }
    try { live.signaling?.leave?.(); } catch { /* ignore */ }
    live = null;
    menus.net = null;
  }

  menus.online = {
    async host() {
      if (live) return;
      const secret = roomCode.makeRoomSecret();
      const ids = await deriveIds(secret);
      E.marks.hostOpen = performance.now();
      const { transport, signaling } = await open('host', ids);
      const session = hostS.createHostSession({ transport, signalings: [signaling], secret, hostPlayers: 1, progress: menus.progress });
      live = { role: 'host', session, transport, signaling, timers: [] };
      session.onEffect((e) => {
        if (e.type === 'prompt') { note('prompt', { on: !!e.prompt }); if (e.prompt) E.marks.prompt = performance.now(); }
        else if (e.type === 'emote') E.emotes.push({ from: e.globalPi, emote: e.emote, t: performance.now() });
        else if (e.type === 'setLocked') note('locked', { locked: e.locked });
      });
      session.dispatch({ type: 'open' });
      session.dispatch({ type: 'opened' });
      // Heartbeat stand-in (WS7 sends PING/PONG on the state channel, §7.4): the guest session only needs to hear us.
      live.timers.push(setInterval(() => {
        try { for (const p of transport.peers()) transport.send(p, 'state', new Uint8Array([0])); } catch { /* ignore */ }
        session.dispatch({ type: 'tick' });
      }, 500));
      menus.net = hostS.createHostNetContext(session);
      note('hosting', { label: secret.label });
      menus.goto('online-lobby');
    },
    async join(secret) {
      if (live) stop();
      E.marks.codeEntered = performance.now();
      E.ended = null;
      const lis = { peer: new Set(), msg: new Set() };
      const proxy = {
        onPeer: (fn) => { lis.peer.add(fn); return () => lis.peer.delete(fn); },
        onMessage: (fn) => { lis.msg.add(fn); return () => lis.msg.delete(fn); },
        send: (p, ch, b) => live?.transport?.send(p, ch, b) ?? false,
        disconnect: (p, r) => live?.transport?.disconnect(p, r),
        peers: () => live?.transport?.peers() ?? [],
      };
      const session = guestS.createGuestSession({ transport: proxy, secret, localPlayers: cfg.localPlayers ?? 2 });
      const me = { role: 'guest', session, transport: null, signaling: null, timers: [] };
      live = me;
      session.onEffect((e) => {
        if (e.type === 'screen') {
          if (e.id === 'online-lobby') { menus.net = guestS.createGuestNetContext(session); E.marks.lobby = performance.now(); }
          note('screen', { id: e.id });
          menus.goto(e.id, e.params ?? {});
        } else if (e.type === 'emote') E.emotes.push({ from: e.globalPi, emote: e.emote, t: performance.now() });
        else if (e.type === 'ended') {
          E.ended = { reason: e.reason, text: e.text };
          note('ended', E.ended);
          // after this dispatch's remaining effects (the hub screen) have run
          setTimeout(() => { if (live === me) stop(); }, 0);
        }
      });
      me.timers.push(setInterval(() => session.dispatch({ type: 'tick' }), 250));
      session.dispatch({ type: 'connect' });
      try {
        const ids = await deriveIds(secret);
        const o = await open('guest', ids);
        if (live !== me) { o.transport.close(); o.signaling.leave(); return; }
        me.transport = o.transport;
        me.signaling = o.signaling;
        o.transport.onPeer((ev) => lis.peer.forEach((f) => f(ev)));
        o.transport.onMessage((p, ch, b) => lis.msg.forEach((f) => f(p, ch, b)));
        for (const p of o.transport.peers()) lis.peer.forEach((f) => f({ type: 'join', peerId: p }));
      } catch (err) {
        note('join-failed', { code: err?.code ?? String(err) });
        if (live === me) session.dispatch({ type: 'connect-failed', code: err?.code ?? 'unreachable' });
      }
    },
    pick() { E.pickRequested = (E.pickRequested ?? 0) + 1; note('pick'); },
    leave() {
      const was = live;
      if (!was) { menus.goto('online-hub'); return; }
      if (was.role === 'host') was.session.dispatch({ type: 'close' });
      else was.session.dispatch({ type: 'leave' });
      stop();
      menus.goto('online-hub');
    },
  };
  // WS7 reads a `#join=` link once at start-up and clears it (§10.1): do the same here.
  const inv = invite.startupInvite({ hash: location.hash, pathname: location.pathname, search: location.search, onlineEnabled: true });
  for (const fx of inv.effects) if (fx.type === 'replaceState') history.replaceState(null, '', fx.url);
  if (inv.screen) menus.goto(inv.screen, inv.params);
  return 'glue';
}

async function openPage(browser, name, { pad = false } = {}) {
  const ctx = await browser.newContext({ viewport: PROFILE.viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT_SCRIPT, { pad });
  const page = await ctx.newPage();
  page.setDefaultTimeout(T(30000));
  const p = { ctx, page, name, errors: [], consoleLog: [], via: pad ? 'pad' : 'kb' };
  const noteLine = (line) => { p.consoleLog.push(line); if (p.consoleLog.length > 400) p.consoleLog.shift(); };
  page.on('console', (m) => {
    noteLine(`[${m.type()}] ${m.text()}`);
    if (m.type() === 'error' && !isIgnorableOnlineError(m.text())) p.errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => { noteLine(`[pageerror] ${e.stack || e.message}`); p.errors.push(`pageerror: ${e.message}`); });
  page.on('requestfailed', (r) => {
    const line = `${r.url()} ${r.failure()?.errorText ?? ''}`;
    noteLine(`[requestfailed] ${line}`);
    if (!isIgnorableOnlineError(line)) p.errors.push(`requestfailed: ${line}`);
  });
  return p;
}

/* ---------------- game helpers (all waits are on game conditions) ---------------- */

async function waitGame(p, fn, arg, timeout, what) {
  try {
    await p.page.waitForFunction(fn, arg, { timeout, polling: 50 });
  } catch (err) {
    const info = await p.page.evaluate(() => ({ screen: window.__game?.menus?.screenId, state: window.__game?.state, e2e: window.__skE2E?.log?.slice(-6) })).catch(() => ({}));
    throw new Error(`${p.name}: timed out after ${Math.round(timeout / 1000)} s waiting for ${what} (screen=${info.screen} state=${info.state} log=${JSON.stringify(info.e2e ?? [])})${/Timeout/.test(err.message) ? '' : `: ${err.message}`}`);
  }
}
const onScreen = (p, id, timeout = T(30000)) => waitGame(p, (s) => window.__game?.menus?.screenId === s, id, timeout, `the ${id} screen`);
async function waitFrames(p, n = 1) {
  const f0 = await p.page.evaluate(() => window.__game?.frames ?? 0);
  await waitGame(p, ([f, k]) => (window.__game?.frames ?? 0) >= f + k, [f0, n], T(20000), `${n} frame(s)`);
}
const waitMenusReady = (p) => waitGame(p, () => { const m = window.__game?.menus; return !!m?.screen && m._cooldown <= 0; }, null, T(20000), 'menus to accept input');

const KEY_OF = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', confirm: 'Enter', back: 'Escape', start: 'Enter' };

/** One pad tap for exactly one game frame (synchronised with the game's own 'frame' event, like smoke.mjs). */
async function padTap(p, button) {
  await p.page.evaluate(([b, ms]) => new Promise((resolve, reject) => {
    const bus = window.__game?.bus;
    if (!bus) { reject(new Error('window.__game.bus missing')); return; }
    let n = 0;
    const timer = setTimeout(() => { off(); window.__pad.set(b, false); reject(new Error(`pad tap: no game frames for ${ms} ms`)); }, ms);
    const off = bus.on('frame', () => {
      n++;
      if (n === 1) window.__pad.set(b, false);
      else { off(); clearTimeout(timer); resolve(); }
    });
    window.__pad.set(b, true);
  }), [button, T(20000)]);
}

/** A menu action with the page's device (keyboard, or pad for the controller-only run). */
async function press(p, action, { via = p.via, until = null, arg = null, what = action, tries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    await waitMenusReady(p);
    if (via === 'pad') await padTap(p, padButtonFor(action));
    else { await p.page.keyboard.press(KEY_OF[action]); await waitFrames(p, 1); }
    if (!until) return;
    try {
      await waitGame(p, until, arg, T(6000), what);
      return;
    } catch (err) {
      if (attempt >= tries) throw err;
    }
  }
}

async function bootGame(p, url, cfg) {
  // A URL that differs only by its #fragment would be a same-document navigation: always load fresh.
  if (p.page.url() !== 'about:blank') await p.page.goto('about:blank');
  await p.page.goto(url, { timeout: T(60000) });
  await waitGame(p, () => !!window.__game?.menus?.screen, null, T(60000), 'the game to boot');
  const mode = await p.page.evaluate(installOnlineGlue, cfg);
  return mode;
}

/** Title → Online (the menu entry only a grown-up's setting shows) → the Online hub. */
async function titleToHub(p) {
  await onScreen(p, 'title');
  await press(p, 'down', { until: () => !!document.querySelector('.sk-title-entry.sk-focus'), what: 'a title menu entry focused' });
  for (let i = 0; i < 12; i++) {
    const txt = await p.page.evaluate(() => document.querySelector('.sk-title-entry.sk-focus')?.textContent ?? '');
    if (/Online/.test(txt)) break;
    await press(p, 'right');
  }
  await press(p, 'confirm', { until: () => window.__game?.menus?.screenId === 'online-hub', what: 'the Online hub' });
}

const shotPath = (name) => path.join(OUT, `${name}.png`);
async function shot(p, name) {
  await waitFrames(p, 2).catch(() => {});
  await p.page.screenshot({ path: shotPath(name) });
}

const HAS_ROOM_KEY = existsSync(path.join(ROOT, 'src', 'net', 'roomKey.js'));
function signalCfg(path_, svc) {
  const base = { localPlayers: 2, hasRoomKey: HAS_ROOM_KEY };
  return path_ === 'worker'
    ? { ...base, forced: 'worker', signalUrl: svc.worker.url, relays: null }
    : { ...base, forced: 'public', signalUrl: null, relays: [svc.tracker.url] };
}
function urlFor(path_, svc, extra = {}) {
  return gameUrl({ port: PORT, path: path_, trackerUrl: svc.tracker?.url ?? null, workerUrl: svc.worker?.url ?? null, extra: { attract: '0', ...extra.query }, invite: extra.invite ?? null });
}

const netInfo = (p) => p.page.evaluate(() => {
  const n = window.__game?.menus?.net;
  if (!n) return null;
  const lobby = n.lobby?.() ?? null;
  const prompt = n.prompt?.() ?? null;
  return {
    role: n.role, houseId: n.houseId ?? null, secret: n.secret ?? null, prompt,
    locked: !!lobby?.locked,
    houses: (lobby?.houses ?? []).map((h) => ({ id: h.houseId, isHost: h.isHost, players: h.players.map((x) => ({ seat: x.seat, pi: x.globalPi, characterId: x.characterId })) })),
  };
});

/** Host has a room; returns the secret and the invite link (pointing at this dev server). */
async function hostOpensRoom(host) {
  await titleToHub(host);
  await press(host, 'confirm', { until: () => window.__game?.menus?.screenId === 'online-lobby' && !!window.__game.menus.net?.secret, what: 'the host lobby with a room code' });
  const info = await netInfo(host);
  return { secret: info.secret, link: makeInviteLink(info.secret, BASE) };
}

/** Wait for the approval pair on both screens, check they match, optionally screenshot, approve. */
async function approveWithMatchCheck(sc, host, guest, problems, { shots = null } = {}) {
  await waitGame(guest, () => !!document.querySelector('.skn-waiting .skn-animals')?.textContent, null, T(30000), 'the guest match-check animals');
  await waitGame(host, () => !!window.__game?.menus?.net?.prompt?.() && !!document.querySelector('.skn-prompt .skn-animals'), null, T(30000), 'the host approval prompt');
  const guestAnimals = (await guest.page.textContent('.skn-waiting .skn-animals')).trim();
  const hostAnimals = (await host.page.textContent('.skn-prompt .skn-animals')).trim();
  const prompt = (await netInfo(host)).prompt;
  if (guestAnimals !== hostAnimals || prompt.animals !== guestAnimals) problems.push(`match check differs: guest shows ${guestAnimals}, host asks about ${hostAnimals} (${prompt.animals})`);
  if (!prompt.text.includes(guestAnimals)) problems.push(`the host prompt text does not name the animals: ${prompt.text}`);
  if (shots) {
    await shot(guest, `${shots}approval-guest`);
    await shot(host, `${shots}approval-host`);
  }
  await press(host, 'confirm', { until: () => !window.__game?.menus?.net?.prompt?.(), what: 'the approval to be answered' });
}

/* ---------------- scenarios ---------------- */

function newResult(sc) {
  return { name: sc.name, problems: [], pending: [], notes: [], shots: [], mode: null, timing: null };
}

function hermeticProblems(pages) {
  return Promise.all(pages.map(async (p) => {
    const h = await p.page.evaluate(() => window.__skHermetic ?? null).catch(() => null);
    return h && h.external.length ? [`${p.name} opened WebSockets to non-local hosts: ${[...new Set(h.external)].join(', ')}`] : [];
  })).then((a) => a.flat());
}

function errorsOf(pages) {
  return pages.flatMap((p) => p.errors.filter((e) => !isIgnorableOnlineError(e)).slice(0, 8).map((e) => `${p.name} ${e}`));
}

async function writeDiagnostics(name, pages, problems) {
  const lines = [`scenario: ${name}`, '', 'problems:', ...problems.map((x) => `  - ${x}`)];
  for (const p of pages) {
    await p.page.screenshot({ path: path.join(OUT, `${name}-${p.name}-FAIL.png`) }).catch(() => {});
    const state = await p.page.evaluate(() => ({ screen: window.__game?.menus?.screenId, state: window.__game?.state, e2e: window.__skE2E ?? null, hermetic: window.__skHermetic ?? null })).catch((e) => ({ unavailable: String(e) }));
    lines.push('', `== ${p.name} ==`, JSON.stringify(state, null, 2), '', ...p.consoleLog.slice(-150));
  }
  writeFileSync(path.join(OUT, `${name}-FAIL.log`), lines.join('\n'));
}

/** The full two-house scenario on one path with one join method. */
async function roomScenario(browser, sc, svc, r) {
  const pad = sc.join === 'controller';
  const host = await openPage(browser, 'host', { pad });
  const guest = await openPage(browser, 'guest', { pad });
  const pages = [host, guest];
  const prefix = `${sc.path}-${pad ? 'pad-' : ''}`;
  const cfg = signalCfg(sc.path, svc);
  try {
    r.mode = await bootGame(host, urlFor(sc.path, svc), cfg);
    r.notes.push(`online flow: ${r.mode === 'integrated' ? 'the game (WS7)' : 'test stand-in over the real modules (WS7 not in this build)'}`);
    const { secret, link } = await hostOpensRoom(host);
    await shot(host, `${prefix}hub`).catch(() => {});
    r.notes.push(`room ${secret.label}`);

    // ---- the guest finds the room
    let t0;
    if (!pad) {
      await bootGame(guest, urlFor(sc.path, svc, { invite: link }), cfg);
      await onScreen(guest, 'online-hub');
      const hash = await guest.page.evaluate(() => location.hash);
      if (hash) r.problems.push(`the invite fragment was not cleared from the address bar (${hash})`);
      await waitGame(guest, () => /SPRINKLE|-\d{4}/.test(document.querySelector('.skn-hub h1')?.textContent ?? ''), null, T(10000), 'the "Join <room>?" hub');
      await shot(guest, `${prefix}hub-invite`);
      await waitMenusReady(guest);
      t0 = Date.now();
      await press(guest, 'confirm', { until: () => window.__game?.menus?.screenId !== 'online-hub', what: 'the guest to knock' });
    } else {
      await bootGame(guest, urlFor(sc.path, svc), cfg);
      await titleToHub(guest);
      await press(guest, 'right', { until: () => !!document.querySelector('.skn-card-join.sk-sel'), what: 'the Join card' });
      await press(guest, 'confirm', { until: () => window.__game?.menus?.screenId === 'code-entry', what: 'code entry' });
      const presses = planCodeEntry(secret);
      for (const a of presses.slice(0, -1)) await press(guest, a);
      const shown = await guest.page.evaluate(() => ({
        label: `${document.querySelector('.skn-word b')?.textContent}-${[...document.querySelectorAll('.skn-digit b')].map((b) => b.textContent).join('')}`,
        picks: [...document.querySelectorAll('.skn-picked span.on')].length,
      }));
      if (shown.label !== secret.label || shown.picks !== 6) r.problems.push(`code entry shows ${shown.label} with ${shown.picks} sweets, expected ${secret.label} + 6`);
      await shot(guest, `${prefix}code-entry`);
      t0 = Date.now();
      await press(guest, 'confirm', { until: () => window.__game?.menus?.screenId !== 'code-entry', what: 'the guest to knock' });
    }

    // ---- approval with the match check (host uses the same kind of device)
    await approveWithMatchCheck(sc, host, guest, r.problems, { shots: prefix });
    await onScreen(guest, 'online-lobby', T(30000));
    r.timing = Date.now() - t0;
    r.notes.push(`code entry → lobby ${(r.timing / 1000).toFixed(2)} s`);

    // ---- seats: the guest house brings 2 local players
    await waitGame(host, () => (window.__game?.menus?.net?.lobby?.()?.houses ?? []).some((h) => !h.isHost && h.players.length === 2), null, T(15000), 'the guest house with 2 seats on the host');

    // ---- racer picks (the in-game character select is WS7's; the stand-in sends the same INTENTs)
    const ids = await guest.page.evaluate(() => (window.__game?.menus?.characters ?? window.__game?.characters ?? []).map((c) => c.id).filter(Boolean).slice(0, 2));
    if (r.mode === 'glue') {
      const picks = ids.length >= 2 ? ids : ['luna', 'rocco'];
      await guest.page.evaluate((cs) => cs.forEach((characterId, seat) => window.__game.menus.net.dispatch({ type: 'intent', intent: { kind: 'pick', seat, characterId, paintId: 'original' } })), picks);
      await waitGame(host, (cs) => (window.__game?.menus?.net?.lobby?.()?.houses ?? []).some((h) => !h.isHost && cs.every((c, i) => h.players.find((x) => x.seat === i)?.characterId === c)), picks, T(10000), 'the guest racer picks on the host');
      await waitGame(guest, (cs) => (window.__game?.menus?.net?.lobby?.()?.houses ?? []).some((h) => !h.isHost && cs.every((c, i) => h.players.find((x) => x.seat === i)?.characterId === c)), picks, T(10000), 'the guest\'s own picks echoed back in LOBBY');
    }

    // ---- lobby emotes, both ways, with the page's device (Down = emote row, A = send)
    await press(guest, 'down');
    await press(guest, 'confirm');
    await waitGame(host, () => !!document.querySelector('.skn-house:not(.skn-mine) .skn-emote-bubble'), null, T(10000), 'the guest emote bubble on the host');
    await press(host, 'down');
    await press(host, 'confirm');
    await waitGame(guest, () => !!document.querySelector('.skn-house:not(.skn-mine) .skn-emote-bubble'), null, T(10000), 'the host emote bubble on the guest');
    await shot(host, `${prefix}lobby-host`);
    await shot(guest, `${prefix}lobby-guest`);
    await press(host, 'up'); // back to the action row
    await press(guest, 'up');

    // ---- Free Race 1 lap, identical standings, rematch
    if (r.mode === 'integrated') await raceSteps(sc, host, guest, r, prefix);
    else r.pending.push('Free Race 1 lap + identical standings + rematch: needs the in-game online flow (WS7 menus.online.pick → race)');

    // ---- remove the guest house → the room locks
    await press(host, 'up', { until: () => !!document.querySelector('.skn-house.sk-sel'), what: 'a guest house selected' });
    await press(host, 'confirm', { until: () => !!document.querySelector('.skn-housemenu'), what: 'the house menu' });
    await press(host, 'confirm', { until: () => !document.querySelector('.skn-housemenu'), what: 'the house to be removed' });
    await waitGame(host, () => { const l = window.__game?.menus?.net?.lobby?.(); return !!l?.locked && l.houses.length === 1; }, null, T(10000), 'a locked room with only the host');
    await waitGame(guest, () => window.__game?.menus?.screenId === 'online-hub' && /bye-bye/i.test(document.querySelector('.skn-msg')?.textContent ?? ''), null, T(15000), 'the guest back on the hub with the bye-bye message');
    await shot(host, `${prefix}lobby-locked`);

    // ---- the removed house reloads (new peer id) and is refused
    await bootGame(guest, urlFor(sc.path, svc, { invite: link }), cfg);
    await onScreen(guest, 'online-hub');
    // one press only: a refusal can bring the guest back to the plain hub before the next poll, where another A would HOST a room
    await press(guest, 'confirm', { tries: 1, until: () => window.__game?.menus?.screenId !== 'online-hub' || !!document.querySelector('.skn-msg')?.textContent, what: 'the reloaded guest to knock' });
    const deadline = Date.now() + T(30000);
    let refused = false;
    while (Date.now() < deadline) {
      const g = await guest.page.evaluate(() => ({ screen: window.__game?.menus?.screenId, msg: document.querySelector('.skn-msg')?.textContent ?? '' }));
      if (g.screen === 'online-lobby') { r.problems.push('a removed house got back into a locked room'); break; }
      if (g.screen === 'online-hub') { refused = true; r.notes.push(`reload refused: "${g.msg}"`); break; }
      const h = await netInfo(host);
      if (h?.prompt) { r.problems.push('a locked room showed an approval prompt for the removed house'); break; }
      await new Promise((res) => setTimeout(res, 250));
    }
    if (!refused && !r.problems.length) r.problems.push('the reloaded guest was neither refused nor admitted within 30 s');
    await shot(guest, `${prefix}refused`);
    const h = await netInfo(host);
    if (h.houses.length !== 1 || !h.locked) r.problems.push(`after the refused reload the room shows ${h.houses.length} houses (locked=${h.locked})`);
  } finally {
    r.problems.push(...await hermeticProblems(pages));
    r.problems.push(...errorsOf(pages));
    if (r.problems.length) await writeDiagnostics(sc.name, pages, r.problems);
    for (const p of pages) await p.ctx.close().catch(() => {});
  }
}

/**
 * The race half (WS7 builds only): the host picks Free Race, everyone picks, 1 lap (?laps=1) with the
 * robo/assist autopilot, identical standings on both machines, then the rematch reaches a second race.
 */
async function raceSteps(sc, host, guest, r, prefix) {
  const inRace = () => window.__game?.state === 'race' || window.__game?.state === 'racing' || !!window.__game?.race;
  await press(host, 'confirm', { until: () => window.__game?.menus?.screenId !== 'online-lobby', what: "Let's pick!" });
  const deadline = Date.now() + T(120000);
  while (Date.now() < deadline && !(await host.page.evaluate(inRace))) {
    for (const p of [host, guest]) {
      const s = await p.page.evaluate(() => ({ screen: window.__game?.menus?.screenId, ready: (window.__game?.menus?._cooldown ?? 1) <= 0 }));
      if (!s.screen || s.screen === 'net-waiting' || s.screen === 'online-lobby' || !s.ready) continue;
      if (s.screen === 'join' && p === guest) { await p.page.keyboard.press('Enter'); if (p.via === 'pad') await padTap(p, PAD.A); }
      await press(p, 'confirm').catch(() => {});
    }
  }
  await waitGame(host, inRace, null, T(60000), 'the host race');
  await waitGame(guest, inRace, null, T(60000), 'the guest race');
  for (const p of [host, guest]) await p.page.keyboard.down('ArrowUp');
  await waitGame(host, () => window.__game?.race?.state === 'racing', null, T(60000), 'GO on the host');
  await shot(host, `${sc.path}-race-host`);
  await shot(guest, `${sc.path}-race-guest`);
  const done = () => !!window.__game?.lastResults || window.__game?.menus?.screenId === 'results';
  await waitGame(host, done, null, T(300000), 'the host results');
  await waitGame(guest, done, null, T(60000), 'the guest results');
  for (const p of [host, guest]) await p.page.keyboard.up('ArrowUp');
  const standings = (p) => p.page.evaluate(() => {
    const n = window.__game?.net;
    const res = n?.results ?? window.__game?.lastResults;
    return (res?.standings ?? res?.order ?? []).map((x) => (typeof x === 'object' ? { id: x.id ?? x.characterId, finishTimeMs: x.finishTimeMs ?? null } : { id: x }));
  });
  r.problems.push(...standingsProblems(await standings(host), await standings(guest)));
  await shot(host, `${sc.path}-results-host`);
  await shot(guest, `${sc.path}-results-guest`);
  // rematch: the host's first results option is "Race again"
  await press(host, 'confirm');
  await waitGame(guest, inRace, null, T(120000), 'the rematch on the guest');
  r.notes.push('rematch reached');
}

/**
 * N guests join one path in a row; code entry → lobby is timed each time (§17 M1-19). Every run is a
 * NEW house (fresh browser context = new save, new peer id, cold page), like a friend opening the
 * link; the page load is not timed, the knock → lobby part is. Afterwards the last guest page leaves
 * and knocks again straight away a few times ("warm rejoin": reported, not budgeted).
 */
async function timingScenario(browser, sc, svc, r) {
  const host = await openPage(browser, 'host');
  const pages = [host];
  const cfg = signalCfg(sc.path, svc);
  const samples = [];
  const warm = [];
  const knock = async (guest, secret, problems) => {
    const t0 = Date.now();
    await guest.page.evaluate((s) => { window.__game.menus.online.join(s); }, secret);
    await approveWithMatchCheck(sc, host, guest, problems);
    await onScreen(guest, 'online-lobby', T(40000));
    return Date.now() - t0;
  };
  const leave = async (guest) => {
    await guest.page.evaluate(() => window.__game.menus.online.leave());
    await waitGame(host, () => (window.__game?.menus?.net?.lobby?.()?.houses ?? []).length === 1 && !window.__game.menus.net.prompt?.(), null, T(20000), 'the host lobby back to one house');
  };
  let guest = null;
  try {
    r.mode = await bootGame(host, urlFor(sc.path, svc), cfg);
    const { secret } = await hostOpensRoom(host);
    for (let i = 0; i < PROFILE.timingRuns; i++) {
      guest = await openPage(browser, `guest${i + 1}`);
      pages.push(guest);
      try {
        await bootGame(guest, urlFor(sc.path, svc), cfg);
        await onScreen(guest, 'title');
        samples.push(await knock(guest, secret, r.problems));
      } catch (err) {
        samples.push(Infinity);
        r.notes.push('⚠ ' + `run ${i + 1}: ${err.message.split('\n')[0]}`);
      }
      await leave(guest).catch((err) => r.problems.push(`run ${i + 1} leave: ${err.message.split('\n')[0]}`));
      if (i < PROFILE.timingRuns - 1) {
        pages.pop();
        r.problems.push(...errorsOf([guest]), ...await hermeticProblems([guest]));
        await guest.ctx.close().catch(() => {});
      }
    }
    // warm rejoin: the last guest page knocks again right after leaving (informational only)
    for (let k = 0; k < 3 && guest; k++) {
      try {
        warm.push(await knock(guest, secret, []));
        await leave(guest);
      } catch {
        warm.push(Infinity);
        await guest.page.evaluate(() => window.__game.menus.online.leave()).catch(() => {});
      }
    }
  } finally {
    const t = timingSummary(samples, sc.path, PROFILE.timingRuns);
    r.timing = t;
    timings.push({ ...t, samples, warmRejoin: warm });
    r.notes.push(`p50 ${t.p50} ms, p90 ${t.p90} ms, max ${t.max} ms over ${t.runs} cold runs`);
    r.notes.push(`warm rejoin: ${warm.map((x) => (Number.isFinite(x) ? `${x} ms` : 'never')).join(', ') || 'n/a'}`);
    r.problems.push(...t.problems.filter((x) => !r.problems.includes(x)));
    r.notes.push(...t.warnings.map((w) => `⚠ ${w}`));
    r.problems.push(...await hermeticProblems(pages));
    r.problems.push(...errorsOf(pages));
    if (r.problems.length) await writeDiagnostics(sc.name, pages, r.problems);
    for (const p of pages) await p.ctx.close().catch(() => {});
  }
}

/** Check connection with UDP blocked: a fake ICE gatherer with no srflx (and a TURN/TLS relay when TURN exists). */
async function checkScenario(browser, sc, svc, r) {
  const p = await openPage(browser, 'check');
  try {
    r.mode = await bootGame(p, urlFor(sc.path, svc), signalCfg(sc.path, svc));
    await titleToHub(p);
    await p.page.evaluate(({ signalUrl, trackers }) => {
      class UdpBlockedPC {
        constructor(config = {}) { this.config = config; this.iceGatheringState = 'new'; this.l = { icecandidate: [], icegatheringstatechange: [] }; }
        addEventListener(type, fn) { (this.l[type] ||= []).push(fn); }
        removeEventListener() {}
        createDataChannel() { return { close() {} }; }
        async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
        async setLocalDescription() {
          const emit = (candidate) => this.l.icecandidate.forEach((f) => f({ candidate }));
          setTimeout(() => {
            emit({ candidate: 'candidate:1 1 udp 2122260223 10.0.0.2 50000 typ host', relayProtocol: undefined });
            const turn = (this.config.iceServers || []).some((s) => s.credential && [].concat(s.urls).some((u) => /^turns:.*:443/.test(u)));
            if (this.config.iceTransportPolicy === 'relay' && turn) emit({ candidate: 'candidate:2 1 udp 8265471 203.0.113.9 60000 typ relay raddr 0.0.0.0 rport 0', relayProtocol: 'tls' });
            emit(null);
            this.iceGatheringState = 'complete';
            this.l.icegatheringstatechange.forEach((f) => f({}));
          }, 30);
        }
        close() {}
      }
      const run = async () => {
        const d = await import('/src/net/diagnose.js');
        const raw = await d.runConnectionCheck({ signalUrl, trackers, RTCPeerConnectionImpl: UdpBlockedPC, gatherTimeoutMs: 3000 });
        window.__skE2E.check = raw;
        return d.describeCheck(raw);
      };
      window.__game.menus.goto('check-connection', { returnTo: 'online-hub', run });
    }, { signalUrl: sc.path === 'worker' ? svc.worker.url : null, trackers: svc.tracker ? [svc.tracker.url] : [] });
    await waitGame(p, () => !document.querySelector('.skn-check .skn-spin') && !!window.__skE2E?.check, null, T(20000), 'the three check rows');
    const rows = await p.page.evaluate(() => [...document.querySelectorAll('.skn-check-row')].map((e) => e.textContent));
    const [match, direct, relay] = rows;
    if (!/Relay needed/.test(direct ?? '')) r.problems.push(`direct row should say "Relay needed" with UDP blocked: ${direct}`);
    if (/\b\d{1,3}(\.\d{1,3}){3}\b/.test(rows.join(' '))) r.problems.push('a check row shows an IP address');
    if (sc.path === 'worker') {
      if (!/Sprinkle Kart server/.test(match ?? '')) r.problems.push(`matchmaker row should name our server: ${match}`);
      if (svc.worker.turn) {
        if (!/^✅/.test(relay ?? '')) r.problems.push(`relay row should be ready via TURN/TLS 443: ${relay}`);
      } else r.notes.push('reused worker has no TURN configured: relay row not asserted');
    } else {
      if (!/Public relays/.test(match ?? '')) r.problems.push(`matchmaker row should say public relays: ${match}`);
      if (!/Not set up/i.test(relay ?? '')) r.problems.push(`relay row should say not set up on a public-only build: ${relay}`);
    }
    r.notes.push(rows.map((x) => x.replace(/\s+/g, ' ').slice(0, 60)).join(' | '));
    await shot(p, `${sc.path}-check-connection-udp-blocked`);
  } finally {
    r.problems.push(...await hermeticProblems([p]));
    r.problems.push(...errorsOf([p]));
    if (r.problems.length) await writeDiagnostics(sc.name, [p], r.problems);
    await p.ctx.close().catch(() => {});
  }
}

/** M3-5: two contexts stay together for SMOKE_SOAK_MINUTES; heap growth < 30 MB, no console errors. */
async function soakScenario(browser, sc, svc, r) {
  const host = await openPage(browser, 'host');
  const guest = await openPage(browser, 'guest');
  const pages = [host, guest];
  const cfg = signalCfg(sc.path, svc);
  const heap = { host: [], guest: [] };
  const sample = async () => {
    for (const p of pages) {
      const cdp = p.cdp ??= await p.ctx.newCDPSession(p.page);
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const { usedSize } = await cdp.send('Runtime.getHeapUsage');
      heap[p.name].push({ t: Date.now(), usedMB: usedSize / 1048576 });
    }
  };
  try {
    r.mode = await bootGame(host, urlFor(sc.path, svc), cfg);
    const { link } = await hostOpensRoom(host);
    await bootGame(guest, urlFor(sc.path, svc, { invite: link }), cfg);
    await onScreen(guest, 'online-hub');
    await press(guest, 'confirm', { until: () => window.__game?.menus?.screenId !== 'online-hub', what: 'the guest to knock' });
    await approveWithMatchCheck(sc, host, guest, r.problems);
    await onScreen(guest, 'online-lobby');
    if (r.mode !== 'integrated') r.pending.push('racing during the soak: needs WS7 (the stand-in soaks the connected lobby: heartbeats, LOBBY, emotes)');
    await press(host, 'down');
    await press(guest, 'down');
    await sample();
    const end = Date.now() + PROFILE.soakMinutes * 60000;
    let nextSample = Date.now() + 30000;
    let n = 0;
    while (Date.now() < end) {
      const p = n++ % 2 ? host : guest;
      await press(p, n % 5 ? 'right' : 'confirm');
      if (Date.now() >= nextSample) { await sample(); nextSample += 30000; }
      await new Promise((res) => setTimeout(res, 800)); // pacing only; emotes are rate-limited to 1 per 1.5 s
      const still = await guest.page.evaluate(() => window.__game?.menus?.screenId);
      if (still !== 'online-lobby') { r.problems.push(`the guest left the lobby during the soak (now on ${still})`); break; }
    }
    await sample();
    for (const who of ['host', 'guest']) r.problems.push(...heapProblems(heap[who], { who }));
    r.notes.push(`heap MB host ${heap.host.map((s) => s.usedMB.toFixed(1)).join(' → ')}; guest ${heap.guest.map((s) => s.usedMB.toFixed(1)).join(' → ')}`);
  } finally {
    r.problems.push(...await hermeticProblems(pages));
    r.problems.push(...errorsOf(pages));
    if (r.problems.length) await writeDiagnostics(sc.name, pages, r.problems);
    for (const p of pages) await p.ctx.close().catch(() => {});
  }
}

/** M2 / M3 follow-ups: reported as pending until their workstreams land (see docs/ONLINE_CHECKLIST.md). */
const laterMilestone = (why) => async (browser, sc, svc, r) => { r.pending.push(why); };

const RUNNERS = {
  room: roomScenario,
  timing: timingScenario,
  check: checkScenario,
  soak: soakScenario,
  gp: laterMilestone('M2 follow-up: Grand Prix 4 races + podium ceremony with identical standings (needs WS5/WS6/WS7 M2)'),
  reconnect: laterMilestone('M2 follow-up: guest drops mid-race and is back within 60 s via its token (needs WS5 RESYNC + WS6 tokens)'),
  team: laterMilestone('M3 follow-up: Team Race online (needs WS1(b) + WS5/WS7 M3)'),
  battle: laterMilestone('M3 follow-up: Bubble Battle online (needs WS1(b) + WS5/WS7 M3)'),
};

async function runScenario(browser, sc, svc) {
  const t0 = Date.now();
  let r;
  for (let attempt = 1; attempt <= PROFILE.retries + 1; attempt++) {
    r = newResult(sc);
    try {
      await RUNNERS[sc.kind](browser, sc, svc, r);
    } catch (err) {
      r.problems.push(err.message);
    }
    if (!r.problems.length) { if (attempt > 1) r.notes.push(`flaky: passed on try ${attempt}`); break; }
    if (attempt <= PROFILE.retries) log(`${sc.name}: attempt ${attempt} failed (${r.problems[0].split('\n')[0]}), retrying…`);
  }
  r.status = scenarioStatus(r, { strict: PROFILE.strict });
  r.seconds = Math.round((Date.now() - t0) / 1000);
  results.push(r);
  const tag = { ok: 'ok', pending: 'ok (with pending steps)', fail: 'FAIL' }[r.status];
  log(`${sc.name}: ${tag} [${r.seconds}s] ${r.notes.join(' · ')}`);
  for (const x of r.pending) log(`  pending: ${x}`);
  for (const x of r.problems) log(`  problem: ${x}`);
}

function writeSummary(totalSeconds, plan) {
  const shots = readdirSync(OUT).filter((f) => f.endsWith('.png') && !f.includes('-FAIL'));
  const raceRan = results.some((r) => r.mode === 'integrated' && r.status === 'ok' && r.name.endsWith('-invite'));
  const fullM1 = plan.filter((s) => s.milestone === 'M1').length === 8;
  const missing = fullM1 ? missingScreenshots(shots, { needRace: raceRan }) : [];
  const summary = { profile: PROFILE, filters, totalSeconds, results, timings, screenshots: shots, missingScreenshots: missing };
  writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  const table = ['| path | runs | p50 | p90 | max | budget | |', '|---|---|---|---|---|---|---|', ...timings.map(timingRow)];
  if (timings.length) console.log(`\n[online] code entry → lobby (§17 M1-19):\n${table.join('\n')}`);
  if (missing.length) console.log(`[online] missing screenshots: ${missing.join(', ')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const icon = { ok: '✅', pending: '🟡', fail: '❌' };
    const rows = results.map((r) => `| ${icon[r.status]} | ${r.name} | ${r.seconds}s | ${(r.problems[0] || r.pending[0] || r.notes.join(' · ')).replace(/\|/g, '\\|').split('\n')[0]} |`);
    const md = [`### 🌐 Online e2e (${PROFILE.name}, ${totalSeconds}s)`, '', '| | scenario | time | notes |', '|---|---|---|---|', ...rows, '', ...(timings.length ? table : []), ''].join('\n');
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); } catch { /* optional */ }
  }
  return missing;
}

/* ---------------- main ---------------- */

const svc = { tracker: null, worker: null, turn: null };
let browser = null;
let vite = null;
let exitCode = 0;
const tStart = Date.now();
const plan = planOnlineScenarios({ filters, profile: PROFILE });
try {
  log(`profile ${PROFILE.name}: port ${PORT}, worker ${PROFILE.workerPort}, milestone ${PROFILE.milestone}, ${PROFILE.timingRuns} timing runs${PROFILE.strict ? ', strict' : ''}`);
  log(`scenarios (${plan.length}): ${plan.map((s) => s.name).join(', ')}`);
  if (!plan.length) throw new Error(`no scenario matches the filters ${JSON.stringify(filters)}`);
  const need = neededServices(plan);
  vite = await startVite();
  if (need.tracker) {
    svc.tracker = await startLocalTracker({ port: PROFILE.trackerPort, host: '127.0.0.1' });
    log(`local tracker on ${svc.tracker.url}`);
  }
  if (need.worker) {
    svc.turn = await startTurnMock();
    svc.worker = await startWorker(svc.turn.url);
    svc.worker.child && children.push(svc.worker.child);
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: chromeArgs() });
  for (const sc of plan) await runScenario(browser, sc, svc);
} catch (err) {
  results.push({ name: 'online-e2e', status: 'fail', problems: [err.stack || err.message], pending: [], notes: [], seconds: 0 });
  log(`FAIL ${err.stack || err.message}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (svc.tracker) await svc.tracker.close().catch(() => {});
  if (svc.turn) await svc.turn.close().catch(() => {});
  for (const c of children) stopChild(c);
  stopChild(vite);
}

const total = Math.round((Date.now() - tStart) / 1000);
const missing = writeSummary(total, plan);
const failed = results.filter((r) => r.status === 'fail');
const pending = results.filter((r) => r.status === 'pending');
if (failed.length || (missing.length && PROFILE.strict)) {
  console.log(`\n[online] ${failed.length} failing scenario(s) in ${total}s: ${failed.map((r) => r.name).join(', ')} (see smoke-out/online/*-FAIL.*)`);
  exitCode = 1;
} else {
  console.log(`\n[online] green in ${total}s${pending.length ? ` (${pending.length} with pending steps: ${pending.map((r) => r.name).join(', ')})` : ''}. Screenshots in ${OUT}`);
}
process.exit(exitCode);
