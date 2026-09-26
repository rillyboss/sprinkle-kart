/**
 * Menus — a small screen router for the whole pre-race flow plus pause,
 * results and the unlock party. Every screen lives in its own file in
 * ./screens/ (see ./screens/index.js for the ScreenDef contract).
 *
 *   const menus = new Menus(document.getElementById('ui'), { input, audio, portraits, characters, tracks, progress });
 *   const setup = await menus.run({ skipTitle: false, previous: null });
 *
 * IMPORTANT: call `menus.update(dt)` every frame while ANY of run() / showPause() /
 * showResults() is pending — it is what reads `input.consumeMenuEvents()`.
 * When no menu screen is active, update() does nothing (and does NOT consume events).
 *
 * All screen logic lives in pure reducers (./menuState.js); screens render
 * state to the DOM and wire mouse clicks into the same reducers.
 * Music is owned by the integrator; Menus only plays sfx() and voice().
 *
 * The Menus instance is the `ctx` every screen receives:
 *   ctx.input / audio / portraits / characters / tracks / progress
 *   ctx.draft             shared state of the current run (joinState, charPicks, charState,
 *                         trackPrev, previous, mode, skip:Set) — screens may add fields
 *   ctx.sfx(name) · ctx.fx(reducerResult) · ctx.char(id) · ctx.isLocked(charDef)
 *   ctx.isTrackLocked(trackDef) · ctx.devices() · ctx.setCooldown(seconds) · ctx.time
 */
import './ui.css';
import * as S from './menuState.js';
import { ensureFont, el } from './dom.js';
import { SCREENS } from './screens/index.js';
import { flowOrder, nextInFlow, prevInFlow, flowStart } from './screenFlow.js';
import { INPUT_COOLDOWN } from './screens/_shared.js';
import { isAvailable } from '../progress/access.js';

/**
 * The net-waiting ScreenDef when an online guest must not drive screen `def`
 * (ScreenDef.net.role === 'host'), else null. Offline (ctx.net null) always null.
 */
export function netWaitingFor(ctx, def) {
  if (!ctx?.net || ctx.net.role !== 'guest') return null;
  if (netRoleOf(def) !== 'host') return null;
  return ctx.screens?.get?.('net-waiting') ?? null;
}

/**
 * Online roles of the built-in screens (NETWORKING.md §10.4) for screens that do
 * not declare `ScreenDef.net` themselves: 'host' = only the host drives it (guests
 * see net-waiting), 'all' = every machine at once, 'local' = this machine only.
 */
export const DEFAULT_NET_ROLES = Object.freeze({
  'mode-select': 'host',
  'track-select': 'host',
  'cup-select': 'host',
  'arena-select': 'host',
  'my-cup': 'host',
  'character-select': 'all',
  join: 'local',
  results: 'all',
  'gp-standings': 'all',
});

/** 'host' | 'all' | 'local' for a ScreenDef. */
export function netRoleOf(def) {
  const r = def?.net?.role;
  if (r === 'host' || r === 'all' || r === 'local') return r;
  return DEFAULT_NET_ROLES[def?.id] ?? 'local';
}

export class Menus {
  constructor(root, { input = null, audio = null, portraits = null, characters = [], tracks = [], progress = null, screens = SCREENS } = {}) {
    ensureFont();
    this.root = root;
    this.input = input;
    this.audio = audio;
    this.portraits = portraits instanceof Map ? portraits : new Map();
    this.characters = characters;
    this.tracks = tracks;
    this.progress = progress;
    this.screens = screens;
    this.el = el('div.sk-menus', { hidden: true });
    root.appendChild(this.el);
    this.screen = null;
    this.screenId = null;
    this.draft = null;
    this._cooldown = 0;
    this.time = 0;
    this._resolveRun = null;
    this._resolveOpen = null;
    /**
     * Online session hooks (NETWORKING.md §10.1), null offline — every net hook below is a
     * no-op then, so offline paths are unchanged. Set by the online flow (WS7) to
     *   { role: 'host'|'guest', composeSetup(localSetup) → NetRaceSetup, waitingParams?(screenId) → params,
     *     lobby?() → LobbyState, dispatch?(ev), seatsLeft?() → how many local players this machine may have now
     *     (its current seats + the room's free seats; the join screen caps at it), ... }
     */
    this.net = null;
    /** Online flow actions for the online screens (host(), join(secret), leave() …), set by WS7. */
    this.online = null;
  }

  /** Swap in new portraits (e.g. when they finish rendering later). */
  setPortraits(portraits) {
    this.portraits = portraits instanceof Map ? portraits : new Map();
    this.screen?.refresh?.();
  }

  get active() {
    return !!this.screen;
  }

  /* ---------------- public API ---------------- */

  /** Run the pre-race flow; resolves with a RaceSetup. */
  run({ skipTitle = false, previous = null } = {}) {
    return new Promise((resolve) => {
      this._resolveRun = resolve;
      this.draft = {
        previous,
        joinState: S.createJoinState(previous?.players ?? []),
        charPicks: previous?.players ?? null,
        charState: null,
        trackPrev: previous ? { trackId: previous.trackId, speedClass: previous.speedClass, laps: previous.laps } : null,
        mode: previous?.mode ?? null,
        skip: new Set(),
      };
      this._drain();
      const start = flowStart(flowOrder(this.screens, this), { skipTitle });
      if (start) this.goto(start);
    });
  }

  update(dt = 1 / 60) {
    if (!this.screen) return;
    this.time += dt;
    this._cooldown -= dt;
    const events = this.input?.consumeMenuEvents?.() ?? [];
    for (const ev of events) {
      if (!this.screen) break;
      if (this._cooldown > 0) continue;
      this.screen.handle(ev);
    }
    this.screen?.update?.(dt);
  }

  /** Pause overlay; resolves 'resume' | 'restart' | 'quit'. */
  showPause(playerLabel = '', extra = {}) {
    return this.open('pause', { label: playerLabel, ...extra });
  }

  /**
   * Results screen; resolves with the chosen option ('again' | 'next-track' | 'menu').
   * `unlocks` = [{ kind: 'character'|'track', def }] celebrated in order
   * (legacy: a single `newlyUnlocked` character def).
   */
  showResults(params = {}) {
    return this.open('results', params);
  }

  /** Open any screen as a one-off; resolves when it calls nav.resolve(value). */
  open(id, params = {}) {
    return new Promise((resolve) => {
      this._drain();
      this._resolveOpen = resolve;
      this.goto(id, params);
    });
  }

  hide() {
    this.screen?.destroy?.();
    this.screen = null;
    this.screenId = null;
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  dispose() {
    this.hide();
    this.el.remove();
  }

  /* ---------------- router ---------------- */

  /**
   * Resolve whatever one-off screen is open (results, standings …) as if it had
   * picked `value` — e.g. a host CHOICE closing a guest's copy of that screen.
   */
  resolveCurrent(value) {
    this._resolveOpened(value);
  }

  /** Mount screen `id` (with optional params). */
  goto(id, params = {}) {
    let def = this.screens.get(id);
    if (!def) {
      console.warn(`[menus] no screen "${id}"`);
      return;
    }
    // Online guests wait while the host drives host-only screens (ScreenDef.net.role === 'host').
    const waiting = netWaitingFor(this, def);
    if (waiting) {
      const extra = (() => { try { return this.net.waitingParams?.(id) ?? {}; } catch { return {}; } })();
      params = { forId: id, ...extra, ...params };
      id = 'net-waiting';
      def = waiting;
    }
    const nav = {
      next: () => this._next(id),
      back: () => this._back(id),
      goto: (to, p) => this.goto(to, p),
      finish: (setup) => this._finish(setup),
      resolve: (value) => this._resolveOpened(value),
    };
    const inst = def.mount(this, nav, params);
    this._mount(id, inst);
  }

  /** The flow screen ids for the current run, in order. */
  flow() {
    return flowOrder(this.screens, this);
  }

  _next(from) {
    const to = nextInFlow(this.flow(), from);
    if (to) this.goto(to);
  }

  _back(from) {
    const to = prevInFlow(this.flow(), from);
    if (to) this.goto(to);
  }

  _finish(setup) {
    const resolve = this._resolveRun;
    this._resolveRun = null;
    // Online host: merge the local flow's choices with the lobby roster into a NetRaceSetup.
    let result = setup;
    if (this.net && typeof this.net.composeSetup === 'function') {
      try { result = this.net.composeSetup(setup) ?? setup; } catch (err) { console.warn('[menus] composeSetup', err); }
    }
    this.hide();
    resolve?.(result);
  }

  _resolveOpened(value) {
    const resolve = this._resolveOpen;
    this._resolveOpen = null;
    this.hide();
    resolve?.(value);
  }

  _mount(id, screen) {
    this.screen?.destroy?.();
    this.el.innerHTML = '';
    this.el.className = `sk-menus ${screen.cls || ''}`;
    this.el.hidden = false;
    this.el.appendChild(screen.node);
    this.screen = screen;
    this.screenId = id;
    this._cooldown = INPUT_COOLDOWN;
  }

  _drain() {
    try { this.input?.consumeMenuEvents?.(); } catch { /* ignore */ }
  }

  /* ---------------- helpers for screens (ctx API) ---------------- */

  /** Play reducer fx names + a character's 'select' voice line. */
  fx(res) {
    for (const name of res.fx || []) this.sfx(name);
    if (res.voice) {
      const def = this.char(res.voice);
      if (def) try { this.audio?.voice?.(def, 'select'); } catch { /* ignore */ }
    }
  }

  sfx(name, opts) {
    try { this.audio?.sfx?.(name, opts); } catch { /* audio is optional */ }
  }

  char(id) {
    return this.characters.find((c) => c.id === id) ?? null;
  }

  _isUnlockedFn() {
    return (id) => !!this.progress?.isUnlocked?.(id);
  }

  /** True if a character is still locked for these players. */
  isLocked(def) {
    return !!def && !isAvailable(def, this._isUnlockedFn());
  }

  /** True if a track is still locked. */
  isTrackLocked(def) {
    return !!def && !isAvailable(def, this._isUnlockedFn());
  }

  devices() {
    try { return this.input?.getDevices?.() ?? []; } catch { return []; }
  }

  setCooldown(seconds) {
    this._cooldown = seconds;
  }
}
