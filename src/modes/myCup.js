/**
 * "My Cup" — a Custom Cup builder: pick any 4 unlocked tracks, in your own
 * order, and race them as a Grand Prix (points, standings, trophy ceremony).
 * Pure reducer + helpers (DOM-free, unit tested) and a tiny storage so the
 * family's favourite cup is remembered.
 *
 *   MY_CUP_ID, MY_CUP_SIZE
 *   myCupDef(trackIds)                        -> a cup object like CUPS entries ({ id, name, emoji, trackIds })
 *   createMyCupState({ trackIds, picks, cols, controllerId })
 *   myCupReduce(state, ev)                    -> { state, fx, go: 'go'|'back'|null, shake? }
 *   myCupStore(backend)                       -> { load(): string[], save(ids) }
 *
 * OWNER: showcase features & modes.
 */
import { jsonStore } from './storage.js';

export const MY_CUP_ID = 'my-cup';
export const MY_CUP_SIZE = 4;
export const MY_CUP_KEY = 'sprinkle-kart-my-cup-v1';

/** The custom cup as a cup object (for the GP loop, standings and ceremony). */
export function myCupDef(trackIds = []) {
  return { id: MY_CUP_ID, name: 'My Cup', emoji: '✨', trackIds: [...trackIds].slice(0, MY_CUP_SIZE) };
}

const out = (state, fx = [], go = null, extra = {}) => ({ state, fx, go, ...extra });
const wrap = (i, n) => ((i % n) + n) % n;

/**
 * @param {object} o
 * @param {string[]} o.trackIds the tracks you may pick (unlocked), in grid order
 * @param {string[]} [o.picks] a remembered cup (unknown / locked ids are dropped)
 * @param {number} [o.cols]
 * @param {string|null} [o.controllerId]
 */
export function createMyCupState({ trackIds = [], picks = [], cols = 5, controllerId = null } = {}) {
  const ids = [...new Set(trackIds)];
  const kept = [];
  for (const id of picks || []) if (ids.includes(id) && !kept.includes(id) && kept.length < MY_CUP_SIZE) kept.push(id);
  return { trackIds: ids, picks: kept, cursor: 0, cols: Math.max(1, cols | 0), focus: kept.length === MY_CUP_SIZE ? 'go' : 'grid', controllerId };
}

export const myCupReady = (s) => s.picks.length === MY_CUP_SIZE;

/**
 * Arrows move the cursor over the track grid; A adds the track (or takes it
 * out again). When the 4th track goes in, the focus jumps to the big "Start
 * My Cup!" button (focus 'go'): A there starts the cup, any arrow goes back
 * to the grid. Y takes the last pick out; Start begins a full cup from
 * anywhere; B goes back.
 * Pointer: { action: 'pick', index } toggles that track, { action: 'set', key: 'cursor', value }.
 */
export function myCupReduce(s, ev) {
  if (s.controllerId && ev.deviceId !== s.controllerId && ev.deviceId !== 'mouse') return out(s);
  const n = s.trackIds.length;
  const toggle = (st, i) => {
    const id = st.trackIds[i];
    if (!id) return out(st);
    if (st.picks.includes(id)) return out({ ...st, cursor: i, picks: st.picks.filter((x) => x !== id) }, ['back']);
    if (st.picks.length >= MY_CUP_SIZE) return out({ ...st, cursor: i }, ['back'], null, { shake: 'slots' });
    const picks = [...st.picks, id];
    const full = picks.length === MY_CUP_SIZE;
    return out({ ...st, cursor: i, picks, focus: full ? 'go' : 'grid' }, [full ? 'unlock' : 'confirm']);
  };
  if (s.focus === 'go') {
    switch (ev.action) {
      case 'confirm': case 'start': case 'select':
        return myCupReady(s) ? out(s, ['confirm'], 'go') : out({ ...s, focus: 'grid' });
      case 'left': case 'right': case 'up': case 'down':
        return out({ ...s, focus: 'grid' }, ['move']);
      case 'toggle':
        return out({ ...s, focus: 'grid', picks: s.picks.slice(0, -1) }, ['back']);
      case 'pick': case 'set': return myCupReduce({ ...s, focus: 'grid' }, ev);
      case 'back': return out(s, ['back'], 'back');
      default: return out(s);
    }
  }
  switch (ev.action) {
    case 'left': case 'right': {
      if (!n) return out(s);
      return out({ ...s, cursor: wrap(s.cursor + (ev.action === 'right' ? 1 : -1), n) }, ['move']);
    }
    case 'up': case 'down': {
      if (!n) return out(s);
      const next = s.cursor + (ev.action === 'down' ? s.cols : -s.cols);
      if (next < 0 || next >= n) return out(s);
      return out({ ...s, cursor: next }, ['move']);
    }
    case 'confirm': return toggle(s, s.cursor);
    case 'pick':
      if (!(ev.index >= 0 && ev.index < n)) return out(s);
      return toggle(s, ev.index);
    case 'set':
      if (ev.key === 'cursor' && ev.value >= 0 && ev.value < n) return out({ ...s, cursor: ev.value }, ['move']);
      return out(s);
    case 'toggle':
      if (!s.picks.length) return out(s);
      return out({ ...s, picks: s.picks.slice(0, -1) }, ['back']);
    case 'start': case 'select':
      if (!myCupReady(s)) return out(s, ['back'], null, { shake: 'go' });
      return out(s, ['confirm'], 'go');
    case 'back': return out(s, ['back'], 'back');
    default: return out(s);
  }
}

/** Remembered custom cup (track ids). */
export function myCupStore(backend) {
  const store = backend === undefined ? jsonStore(MY_CUP_KEY) : jsonStore(MY_CUP_KEY, backend);
  return {
    load() {
      const v = store.read();
      return Array.isArray(v.trackIds) ? v.trackIds.filter((id) => typeof id === 'string').slice(0, MY_CUP_SIZE) : [];
    },
    save(ids) { return store.write({ trackIds: [...(ids || [])].slice(0, MY_CUP_SIZE) }); },
  };
}

/** The Grand Prix RaceSetup for a custom cup. */
export function myCupSetup(players, trackIds, speedClass) {
  const ids = [...trackIds].slice(0, MY_CUP_SIZE);
  return { players, trackId: ids[0], speedClass, laps: null, mode: 'grand-prix', cupId: MY_CUP_ID, customTrackIds: ids };
}
