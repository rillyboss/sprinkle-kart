/**
 * Pure, DOM-free state machines for every menu screen.
 *
 * Each screen has `createXState(...)` and `xReduce(state, event)`.
 * A reducer never mutates its input; it returns:
 *
 *   { state, fx: string[], go: null | string, voice?: characterId, shake?: playerIndex }
 *
 *   - `fx`    AudioManager.sfx names to play ('move' | 'confirm' | 'back' | 'join' ...)
 *   - `go`    a navigation outcome for the Menus controller ('next' | 'back' | option id ...)
 *   - `voice` a character id whose 'select' voice line should play
 *   - `shake` a player index whose UI should do a little "nope" wiggle
 *
 * Events are the InputManager menu events `{ deviceId, action }` with action
 * 'up'|'down'|'left'|'right'|'confirm'|'back'|'start'|'toggle', plus a few
 * pointer-only actions the DOM layer synthesises for mouse clicks
 * ('pick', 'set', 'select').
 */
import { MAX_PLAYERS, DEFAULT_LAPS } from '../config.js';

export const LAP_OPTIONS = [1, 2, 3, 5];
export const SPEED_ORDER = ['cozy', 'zippy', 'zoomy'];

const out = (state, fx = [], go = null, extra = {}) => ({ state, fx, go, ...extra });
const wrap = (i, n) => ((i % n) + n) % n;

/* ------------------------------------------------------------------ */
/* Join screen                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<{deviceId:string, easyDrive?:boolean}>} [previousPlayers]
 */
export function createJoinState(previousPlayers = []) {
  return {
    players: previousPlayers.slice(0, MAX_PLAYERS).map((p, i) => ({
      playerIndex: i,
      deviceId: p.deviceId,
      easyDrive: !!p.easyDrive,
    })),
  };
}

const reindex = (players) => players.map((p, i) => ({ ...p, playerIndex: i }));

/**
 * Join rules:
 *  - confirm/start from a new device joins it as the next player (max 4).
 *  - confirm from P1, or start from any joined player, continues ('next') when >= 1 joined.
 *  - toggle (Y / Tab) flips that player's Easy Drive.
 *  - back from a joined player leaves (everyone behind them slides up a slot).
 *  - back from a non-joined device when nobody has joined goes back to the title.
 */
export function joinReduce(state, ev) {
  const { players } = state;
  const i = players.findIndex((p) => p.deviceId === ev.deviceId);
  switch (ev.action) {
    case 'confirm':
    case 'start': {
      if (i === -1) {
        if (players.length >= MAX_PLAYERS) return out(state, ['back']);
        const np = [...players, { playerIndex: players.length, deviceId: ev.deviceId, easyDrive: false }];
        return out({ ...state, players: np }, ['join'], null, { joined: np.length - 1 });
      }
      if (i === 0 || ev.action === 'start') return out(state, ['confirm'], 'next');
      return out(state, [], null, { shake: i });
    }
    case 'toggle': {
      if (i === -1) return out(state);
      const np = players.map((p, k) => (k === i ? { ...p, easyDrive: !p.easyDrive } : p));
      return out({ ...state, players: np }, ['move']);
    }
    case 'back': {
      if (i === -1) return players.length === 0 ? out(state, ['back'], 'back') : out(state);
      return out({ ...state, players: reindex(players.filter((_, k) => k !== i)) }, ['back']);
    }
    default:
      return out(state);
  }
}

/* ------------------------------------------------------------------ */
/* Character select                                                    */
/* ------------------------------------------------------------------ */

/** Grid width that looks nice for a roster size (9 -> 5, 8 -> 4, 6 -> 3). */
export function gridColumns(n) {
  if (n <= 4) return Math.max(1, n);
  return Math.ceil(n / 2);
}

/**
 * @param {object} o
 * @param {Array<{playerIndex:number, deviceId:string}>} o.players
 * @param {Array<{id:string}>} o.characters full roster incl. locked ones
 * @param {(def)=>boolean} [o.isLocked] true if this character is still locked
 * @param {Array<{playerIndex:number, deviceId?:string, characterId:string}>} [o.previous]
 * @param {number} [o.cols]
 */
export function createCharSelectState({ players, characters, isLocked = () => false, previous = null, cols }) {
  const items = characters.map((c) => ({ id: c.id, locked: !!isLocked(c) }));
  const n = items.length;
  const firstFree = (start) => {
    for (let k = 0; k < n; k++) {
      const idx = wrap(start + k, n);
      if (!items[idx].locked) return idx;
    }
    return 0;
  };
  const cursors = players.map((p, k) => {
    const prev = previous?.find((q) => q.deviceId === p.deviceId) ?? previous?.find((q) => q.playerIndex === p.playerIndex);
    let index = prev ? items.findIndex((it) => it.id === prev.characterId && !it.locked) : -1;
    if (index < 0) index = firstFree(k);
    return { playerIndex: p.playerIndex, deviceId: p.deviceId, index, ready: false };
  });
  return { items, cols: cols ?? gridColumns(n), cursors };
}

/** Move a grid index. Left/right wrap through the whole list; up/down wrap rows. */
export function moveGridIndex(index, action, n, cols) {
  if (action === 'left') return wrap(index - 1, n);
  if (action === 'right') return wrap(index + 1, n);
  const rows = Math.ceil(n / cols);
  if (rows <= 1) return index;
  const r = Math.floor(index / cols);
  const c = index % cols;
  const r2 = wrap(r + (action === 'down' ? 1 : -1), rows);
  return Math.min(r2 * cols + c, n - 1);
}

export function allReady(state) {
  return state.cursors.length > 0 && state.cursors.every((c) => c.ready);
}

/**
 * True when everyone still plugged in is ready (at least one real player).
 * @param {Iterable<string>} disconnected device ids whose controller is unplugged
 */
export function readyExceptDisconnected(state, disconnected = []) {
  const off = new Set(disconnected);
  const live = state.cursors.filter((c) => !off.has(c.deviceId));
  return live.length > 0 && live.every((c) => c.ready);
}

/**
 * Extra pointer actions:
 *   { action:'pick', index, playerIndex? } — mouse click on a tile: moves that
 *   player's cursor (default: first player who isn't ready yet) and confirms.
 * `opts.disconnected`: device ids of unplugged controllers. P1's start (or
 * confirm once ready) treats those players as ready with their current
 * highlight, so a flat controller never blocks the family.
 */
export function charSelectReduce(state, ev, { disconnected = [] } = {}) {
  if ((ev.action === 'start' || ev.action === 'confirm') && disconnected.length && !allReady(state)) {
    const ci0 = state.cursors.findIndex((c) => c.deviceId === ev.deviceId);
    const off = new Set(disconnected);
    if (ci0 === 0 && state.cursors[0].ready && readyExceptDisconnected(state, off)) {
      const cursors = state.cursors.map((c) => {
        if (c.ready || !off.has(c.deviceId)) return c;
        const locked = state.items[c.index]?.locked;
        const index = locked ? Math.max(0, state.items.findIndex((it) => !it.locked)) : c.index;
        return { ...c, index, ready: true };
      });
      return out({ ...state, cursors }, ['confirm'], 'next');
    }
  }
  let ci;
  if (ev.action === 'pick') {
    ci = ev.playerIndex != null
      ? state.cursors.findIndex((c) => c.playerIndex === ev.playerIndex)
      : state.cursors.findIndex((c) => !c.ready);
    if (ci === -1) return out(state);
  } else {
    ci = state.cursors.findIndex((c) => c.deviceId === ev.deviceId);
    if (ci === -1) return out(state);
  }
  const cur = state.cursors[ci];
  const setCursor = (patch) => ({
    ...state,
    cursors: state.cursors.map((c, k) => (k === ci ? { ...c, ...patch } : c)),
  });
  const n = state.items.length;

  switch (ev.action) {
    case 'up': case 'down': case 'left': case 'right': {
      if (cur.ready) return out(state);
      const index = moveGridIndex(cur.index, ev.action, n, state.cols);
      if (index === cur.index) return out(state);
      return out(setCursor({ index }), ['move']);
    }
    case 'pick': {
      if (ev.index < 0 || ev.index >= n) return out(state);
      if (cur.ready) return out(state);
      const moved = setCursor({ index: ev.index });
      return charSelectReduce(moved, { deviceId: cur.deviceId, action: 'confirm' });
    }
    case 'confirm': {
      if (cur.ready) {
        return ci === 0 && allReady(state) ? out(state, ['confirm'], 'next') : out(state);
      }
      const item = state.items[cur.index];
      if (item.locked) return out(state, ['back'], null, { shake: cur.playerIndex });
      const next = setCursor({ ready: true });
      return out(next, ['confirm'], null, { voice: item.id });
    }
    case 'start':
      if (allReady(state)) return out(state, ['confirm'], 'next');
      if (!cur.ready) return charSelectReduce(state, { deviceId: cur.deviceId, action: 'confirm' });
      return out(state);
    case 'back':
      if (cur.ready) return out(setCursor({ ready: false }), ['back']);
      if (ci === 0) return out(state, ['back'], 'back');
      return out(state);
    default:
      return out(state);
  }
}

/** Selected character ids by playerIndex. */
export function charSelections(state) {
  return state.cursors.map((c) => ({ playerIndex: c.playerIndex, characterId: state.items[c.index].id }));
}

/* ------------------------------------------------------------------ */
/* Track select                                                        */
/* ------------------------------------------------------------------ */

export const TRACK_ROWS = ['track', 'speed', 'laps', 'go'];

function lapsIndexFor(laps) {
  let best = 0;
  LAP_OPTIONS.forEach((v, i) => {
    if (Math.abs(v - laps) < Math.abs(LAP_OPTIONS[best] - laps)) best = i;
  });
  return best;
}

/**
 * @param {object} o
 * @param {Array<{id:string, laps?:number}>} o.tracks
 * @param {{trackId?:string, speedClass?:string, laps?:number}|null} [o.previous]
 * @param {string|null} [o.controllerId] only this device may drive the screen (null = anyone)
 * @param {boolean} [o.easyDrive] someone has Magic Steering on: start on Cozy
 */
export function createTrackSelectState({ tracks, previous = null, controllerId = null, easyDrive = false }) {
  let trackIndex = previous?.trackId ? tracks.findIndex((t) => t.id === previous.trackId) : 0;
  if (trackIndex < 0) trackIndex = 0;
  let speedIndex = SPEED_ORDER.indexOf(previous?.speedClass ?? (easyDrive ? 'cozy' : 'zippy'));
  if (speedIndex < 0) speedIndex = 1;
  const laps = previous?.laps ?? tracks[trackIndex]?.laps ?? DEFAULT_LAPS;
  return {
    row: 0,
    trackIndex,
    speedIndex,
    lapsIndex: lapsIndexFor(laps),
    trackCount: tracks.length,
    controllerId,
  };
}

/**
 * Rows: track cards / speed class / laps / "Let's race!" button.
 * Up/down picks a row, left/right changes it, confirm or start races,
 * toggle cycles the speed class, back returns to character select.
 * Pointer: { action:'set', key:'trackIndex'|'speedIndex'|'lapsIndex', value }.
 */
export function trackSelectReduce(state, ev) {
  if (state.controllerId && ev.deviceId !== state.controllerId && ev.deviceId !== 'mouse') return out(state);
  const rowName = TRACK_ROWS[state.row];
  switch (ev.action) {
    case 'up':
    case 'down': {
      const row = Math.max(0, Math.min(TRACK_ROWS.length - 1, state.row + (ev.action === 'down' ? 1 : -1)));
      return row === state.row ? out(state) : out({ ...state, row }, ['move']);
    }
    case 'left':
    case 'right': {
      const d = ev.action === 'right' ? 1 : -1;
      if (rowName === 'track') return out({ ...state, trackIndex: wrap(state.trackIndex + d, state.trackCount) }, ['move']);
      if (rowName === 'speed') {
        const speedIndex = Math.max(0, Math.min(SPEED_ORDER.length - 1, state.speedIndex + d));
        return speedIndex === state.speedIndex ? out(state) : out({ ...state, speedIndex }, ['move']);
      }
      if (rowName === 'laps') {
        const lapsIndex = Math.max(0, Math.min(LAP_OPTIONS.length - 1, state.lapsIndex + d));
        return lapsIndex === state.lapsIndex ? out(state) : out({ ...state, lapsIndex }, ['move']);
      }
      return out(state);
    }
    case 'toggle':
      return out({ ...state, speedIndex: wrap(state.speedIndex + 1, SPEED_ORDER.length) }, ['move']);
    case 'set': {
      const limits = { trackIndex: state.trackCount, speedIndex: SPEED_ORDER.length, lapsIndex: LAP_OPTIONS.length };
      if (!(ev.key in limits) || ev.value < 0 || ev.value >= limits[ev.key]) return out(state);
      const row = { trackIndex: 0, speedIndex: 1, lapsIndex: 2 }[ev.key];
      return out({ ...state, [ev.key]: ev.value, row }, ['move']);
    }
    case 'confirm':
    case 'start':
      return out(state, ['confirm'], 'next');
    case 'back':
      return out(state, ['back'], 'back');
    default:
      return out(state);
  }
}

/** { trackId, speedClass, laps } from a track-select state. */
export function trackSelection(state, tracks) {
  return {
    trackId: tracks[state.trackIndex].id,
    speedClass: SPEED_ORDER[state.speedIndex],
    laps: LAP_OPTIONS[state.lapsIndex],
  };
}

/* ------------------------------------------------------------------ */
/* Simple vertical/horizontal option lists (pause, results)            */
/* ------------------------------------------------------------------ */

export function createListState(options, index = 0) {
  return { options: [...options], index: Math.max(0, Math.min(options.length - 1, index)) };
}

/**
 * up/left = previous, down/right = next (wrapping); confirm picks (go = option id);
 * back = go 'cancel'. `start` behaves like confirm unless `startCancels`.
 * Pointer: { action:'select', index } picks that option directly.
 */
export function listReduce(state, ev, { startCancels = false } = {}) {
  const n = state.options.length;
  switch (ev.action) {
    case 'up': case 'left':
      return out({ ...state, index: wrap(state.index - 1, n) }, ['move']);
    case 'down': case 'right':
      return out({ ...state, index: wrap(state.index + 1, n) }, ['move']);
    case 'confirm':
      return out(state, ['confirm'], state.options[state.index]);
    case 'start':
      return startCancels ? out(state, ['back'], 'cancel') : out(state, ['confirm'], state.options[state.index]);
    case 'select':
      if (ev.index < 0 || ev.index >= n) return out(state);
      return out({ ...state, index: ev.index }, ['confirm'], state.options[ev.index]);
    case 'back':
      return out(state, ['back'], 'cancel');
    default:
      return out(state);
  }
}

/* ------------------------------------------------------------------ */
/* Assemble the final RaceSetup                                        */
/* ------------------------------------------------------------------ */

export function buildRaceSetup(joinState, charState, trackState, tracks) {
  const picks = charSelections(charState);
  return {
    players: joinState.players.map((p) => ({
      playerIndex: p.playerIndex,
      deviceId: p.deviceId,
      characterId: picks.find((q) => q.playerIndex === p.playerIndex)?.characterId,
      easyDrive: p.easyDrive,
    })),
    ...trackSelection(trackState, tracks),
  };
}

/**
 * Pause-screen line: a short label ("P2") becomes "P2 paused the race"; a full
 * sentence (ending in ! . or ?) is shown as-is. Plain text (escape before use).
 */
export function pauseLeadText(playerLabel) {
  if (!playerLabel) return 'The race is paused';
  const text = String(playerLabel).trim();
  return /[!.?]$/.test(text) ? text : `${text} paused the race`;
}
