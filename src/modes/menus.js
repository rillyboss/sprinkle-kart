/**
 * Pure reducers for the modes screens (mode select, cup select, records,
 * GP standings, time-trial results). Same shape as src/ui/menuState.js:
 * `reduce(state, ev) -> { state, fx, go, ...extra }`.
 *
 * OWNER: modes + timing workstream.
 */
import { SPEED_ORDER } from '../ui/menuState.js';
import { ONLINE_MODES } from '../net/session/modes.js';

const out = (state, fx = [], go = null, extra = {}) => ({ state, fx, go, ...extra });
const wrap = (i, n) => ((i % n) + n) % n;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------------- mode select ---------------- */

/** The big mode cards, in order (showcase modes: Team Race + Bubble Battle at the end). */
export const MODE_CARDS = Object.freeze([
  Object.freeze({ id: 'free', name: 'Free Race', emoji: '🏁', blurb: 'Pick any track and zoom with friends!', art: ['🏁', '🍭', '🎈'] }),
  Object.freeze({ id: 'grand-prix', name: 'Grand Prix', emoji: '🏆', blurb: '4 races, sparkly points, a shiny cup!', art: ['🏆', '⭐', '🎀'] }),
  Object.freeze({ id: 'time-trial', name: 'Time Trial', emoji: '⏱️', blurb: 'Race your sparkly ghost. Beat your best!', art: ['⏱️', '👻', '✨'] }),
  Object.freeze({ id: 'team', name: 'Team Race', emoji: '🤝', blurb: 'Race together! Team points win the day.', art: ['🤝', '🍭', '⭐'] }),
  Object.freeze({ id: 'battle', name: 'Bubble Battle', emoji: '🫧', blurb: 'Pop bubbles! Last one bobbing wins!', art: ['🫧', '🎯', '🛁'] }),
]);

/**
 * The mode cards to show: all of them offline; online (a `ctx.net`) only the
 * modes whose milestone is done (`ONLINE_MODES`, src/net/session/modes.js,
 * NETWORKING.md §10.1 / §11), in MODE_CARDS order.
 * @param {object|null} net ctx.net (null offline)
 * @param {string[]} [onlineModes]
 */
export function modeCardsFor(net, onlineModes = ONLINE_MODES) {
  if (!net) return MODE_CARDS;
  return MODE_CARDS.filter((m) => onlineModes.includes(m.id));
}

/**
 * @param {object} o
 * @param {string|null} [o.mode] previously picked mode (focus starts there)
 * @param {number} [o.entryCount] menu-entry buttons under the cards (Records ...)
 * @param {string|null} [o.controllerId] only this device (and the mouse) may drive it
 * @param {ReadonlyArray<{id:string}>} [o.cards] the cards on screen (default MODE_CARDS; online: modeCardsFor(net))
 */
export function createModeSelectState({ mode = null, entryCount = 0, controllerId = null, cards = null } = {}) {
  const list = cards ?? MODE_CARDS;
  const i = list.findIndex((m) => m.id === mode);
  const state = { index: i < 0 ? 0 : i, row: 'cards', entry: 0, entryCount, controllerId };
  return cards ? { ...state, cardIds: list.map((m) => m.id) } : state;
}

const cardIdsOf = (state) => state.cardIds ?? MODE_CARDS.map((m) => m.id);

/**
 * Left/right choose a card (or an entry), Down/Up move between the cards and
 * the entry row, A/Start pick, B goes back.
 * Pointer: { action: 'set', key: 'index'|'entry', value } and { action: 'select', key, value }.
 * Result `go`: 'mode' (+ `mode`), 'entry' (+ `entry` index) or 'back'.
 */
export function modeSelectReduce(state, ev) {
  if (state.controllerId && ev.deviceId !== state.controllerId && ev.deviceId !== 'mouse') return out(state);
  const ids = cardIdsOf(state);
  const n = ids.length;
  const onCards = state.row === 'cards' || !state.entryCount;
  switch (ev.action) {
    case 'left':
    case 'right': {
      const d = ev.action === 'right' ? 1 : -1;
      if (onCards) return out({ ...state, row: 'cards', index: wrap(state.index + d, n) }, ['move']);
      return out({ ...state, entry: wrap(state.entry + d, state.entryCount) }, ['move']);
    }
    case 'down':
      if (onCards && state.entryCount) return out({ ...state, row: 'entries' }, ['move']);
      return out(state);
    case 'up':
      if (!onCards) return out({ ...state, row: 'cards' }, ['move']);
      return out(state);
    case 'confirm':
    case 'start':
      if (onCards) return out(state, ['confirm'], 'mode', { mode: ids[state.index] });
      return out(state, ['confirm'], 'entry', { entry: state.entry });
    case 'set':
    case 'select': {
      const pick = ev.action === 'select';
      if (ev.key === 'index' && ev.value >= 0 && ev.value < n) {
        const s = { ...state, row: 'cards', index: ev.value };
        return pick ? out(s, ['confirm'], 'mode', { mode: ids[ev.value] }) : out(s, ['move']);
      }
      if (ev.key === 'entry' && ev.value >= 0 && ev.value < state.entryCount) {
        const s = { ...state, row: 'entries', entry: ev.value };
        return pick ? out(s, ['confirm'], 'entry', { entry: ev.value }) : out(s, ['move']);
      }
      return out(state);
    }
    case 'back':
      return out(state, ['back'], 'back');
    default:
      return out(state);
  }
}

/* ---------------- cup select ---------------- */

export const CUP_ROWS = Object.freeze(['cup', 'speed', 'go']);

/**
 * @param {object} o
 * @param {boolean[]} o.playable one flag per cup card
 * @param {string|null} [o.cupId] previous cup
 * @param {string[]} [o.cupIds] cup ids in card order (to find the previous one)
 * @param {string|null} [o.speedClass]
 * @param {boolean} [o.easyDrive] someone has Kid-Assist on: start on Cozy
 * @param {string|null} [o.controllerId]
 */
export function createCupSelectState({ playable, cupId = null, cupIds = [], speedClass = null, easyDrive = false, controllerId = null }) {
  let index = cupIds.indexOf(cupId);
  if (index < 0 || !playable[index]) index = Math.max(0, playable.indexOf(true));
  let speedIndex = SPEED_ORDER.indexOf(speedClass ?? (easyDrive ? 'cozy' : 'zippy'));
  if (speedIndex < 0) speedIndex = 1;
  return { row: 0, index, speedIndex, playable: [...playable], controllerId };
}

/**
 * Rows: cup cards / speed / "Start the cup!". Confirm on a locked cup = a
 * nope-wiggle (`shake: 'cup'`). `go`: 'next' | 'back'.
 */
export function cupSelectReduce(state, ev) {
  if (state.controllerId && ev.deviceId !== state.controllerId && ev.deviceId !== 'mouse') return out(state);
  const n = state.playable.length;
  const row = CUP_ROWS[state.row];
  switch (ev.action) {
    case 'up':
    case 'down': {
      const r = clamp(state.row + (ev.action === 'down' ? 1 : -1), 0, CUP_ROWS.length - 1);
      return r === state.row ? out(state) : out({ ...state, row: r }, ['move']);
    }
    case 'left':
    case 'right': {
      const d = ev.action === 'right' ? 1 : -1;
      if (row === 'cup' && n) return out({ ...state, index: wrap(state.index + d, n) }, ['move']);
      if (row === 'speed') {
        const speedIndex = clamp(state.speedIndex + d, 0, SPEED_ORDER.length - 1);
        return speedIndex === state.speedIndex ? out(state) : out({ ...state, speedIndex }, ['move']);
      }
      return out(state);
    }
    case 'toggle':
      return out({ ...state, speedIndex: wrap(state.speedIndex + 1, SPEED_ORDER.length) }, ['move']);
    case 'set': {
      if (ev.key === 'index' && ev.value >= 0 && ev.value < n) return out({ ...state, index: ev.value, row: 0 }, ['move']);
      if (ev.key === 'speedIndex' && ev.value >= 0 && ev.value < SPEED_ORDER.length) return out({ ...state, speedIndex: ev.value, row: 1 }, ['move']);
      return out(state);
    }
    case 'confirm':
    case 'start':
      if (!state.playable[state.index]) return out({ ...state, row: 0 }, ['back'], null, { shake: 'cup' });
      return out(state, ['confirm'], 'next');
    case 'back':
      return out(state, ['back'], 'back');
    default:
      return out(state);
  }
}

export const cupSpeed = (state) => SPEED_ORDER[state.speedIndex];

/* ---------------- records ---------------- */

export function createRecordsState(pages, page = 0) {
  return { page: clamp(page, 0, Math.max(0, pages - 1)), pages };
}

/** Left/right flip cup pages; B / A / Start go back. */
export function recordsReduce(state, ev) {
  switch (ev.action) {
    case 'left':
    case 'right': {
      if (state.pages <= 1) return out(state);
      return out({ ...state, page: wrap(state.page + (ev.action === 'right' ? 1 : -1), state.pages) }, ['move']);
    }
    case 'set':
      if (ev.key === 'page' && ev.value >= 0 && ev.value < state.pages) return out({ ...state, page: ev.value }, ['move']);
      return out(state);
    case 'back':
    case 'confirm':
    case 'start':
      return out(state, ['back'], 'back');
    default:
      return out(state);
  }
}

/* ---------------- phased screens (standings, ceremony) ---------------- */

/**
 * A screen that first plays an animation (A skips it), then shows option
 * buttons. state = { phase: 'intro'|'choose', t, introTime, index, options }.
 */
export function createPhasedState(options, { introTime = 2 } = {}) {
  return { phase: 'intro', t: 0, introTime, index: 0, options: [...options] };
}

export function phasedTick(state, dt) {
  if (state.phase !== 'intro') return state;
  const t = state.t + dt;
  return t >= state.introTime ? { ...state, t, phase: 'choose' } : { ...state, t };
}

/** During the intro any A/Start skips to the options; then a normal option list. */
export function phasedReduce(state, ev) {
  const n = state.options.length;
  if (state.phase === 'intro') {
    if (ev.action === 'confirm' || ev.action === 'start' || ev.action === 'select') return out({ ...state, phase: 'choose', t: state.introTime }, ['confirm'], null, { skipped: true });
    return out(state);
  }
  switch (ev.action) {
    case 'left': case 'up':
      return n ? out({ ...state, index: wrap(state.index - 1, n) }, ['move']) : out(state);
    case 'right': case 'down':
      return n ? out({ ...state, index: wrap(state.index + 1, n) }, ['move']) : out(state);
    case 'confirm': case 'start':
      return n ? out(state, ['confirm'], state.options[state.index]) : out(state);
    case 'select':
      if (ev.index >= 0 && ev.index < n) return out({ ...state, index: ev.index }, ['confirm'], state.options[ev.index]);
      return out(state);
    default:
      return out(state);
  }
}
