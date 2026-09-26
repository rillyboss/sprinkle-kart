/**
 * "My Cup" — a Custom Cup builder: pick any 4 unlocked tracks, in your own
 * order, give the cup a name + emoji, and race it as a Grand Prix (points,
 * standings, trophy ceremony). Pure reducer + helpers (DOM-free, unit tested)
 * and a tiny storage so the family's favourite cup is remembered.
 *
 *   MY_CUP_ID, MY_CUP_SIZE, MY_CUP_EMOJIS, MY_CUP_NAMES
 *   myCupDef(trackIds, { name, emoji })       -> a cup object like CUPS entries ({ id, name, emoji, trackIds, custom })
 *   createMyCupState({ trackIds, picks, emoji, name, owner, cols, controllerId })
 *   myCupReduce(state, ev)                    -> { state, fx, go: 'go'|'back'|null, shake? }
 *   myCupName(state) / myCupEmoji(state)      -> what the cup is called right now
 *   myCupStore(backend)                       -> { load(): { trackIds, name, emoji }, save(saved) }
 *   myCupSetup(players, trackIds, speedClass, { name, emoji }) -> the Grand Prix RaceSetup
 *
 * Screen layout (screens/myCup.js): a top bar [emoji] [name] [Start My Cup!],
 * the 4 numbered slots, then the grid of unlocked tracks.
 *
 * A custom cup counts as a finished Grand Prix (the "Cup Runner" goal) but is
 * not one of the real cups, so it never gives cup trophies / "Win a cup"
 * unlocks (see progress/engine.js applyGrandPrix).
 *
 * OWNER: showcase features & modes.
 */
import { jsonStore } from './storage.js';

export const MY_CUP_ID = 'my-cup';
export const MY_CUP_SIZE = 4;
export const MY_CUP_KEY = 'sprinkle-kart-my-cup-v1';

/** Cup badges to pick from (A on the emoji chip cycles them). */
export const MY_CUP_EMOJIS = Object.freeze(['✨', '🌈', '🦄', '🧁', '🍭', '🌟', '🎀', '🐰', '🌸', '🍓', '🚀', '🐢']);
/** Cup names to pick from; '{owner}' becomes "<P1 racer>'s Cup". */
export const OWNER_NAME = '{owner}';
export const MY_CUP_NAMES = Object.freeze([
  'My Cup', OWNER_NAME, 'Sparkle Cup', 'Rainbow Cup', 'Giggle Cup', 'Sunshine Cup',
  'Cupcake Cup', 'Bubble Cup', 'Dream Cup', 'Family Cup', 'Silly Cup', 'Snuggle Cup',
]);
/** The top bar, left to right. */
export const MY_CUP_BAR = Object.freeze(['emoji', 'name', 'go']);

const NAME_MAX = 24;
const cleanName = (n) => (typeof n === 'string' ? n.trim().slice(0, NAME_MAX) : '');

/** Name choices for this builder (the owner one only when we know the racer). */
export function myCupNameChoices(owner) {
  return MY_CUP_NAMES.filter((n) => n !== OWNER_NAME || !!cleanName(owner));
}

/** Resolve a name key ('{owner}' or a plain name) to display text. */
export function resolveCupName(key, owner) {
  if (key === OWNER_NAME) return cleanName(owner) ? `${cleanName(owner)}'s Cup` : 'My Cup';
  return cleanName(key) || 'My Cup';
}

/** The custom cup as a cup object (for the GP loop, standings and ceremony). */
export function myCupDef(trackIds = [], { name, emoji } = {}) {
  return {
    id: MY_CUP_ID,
    name: cleanName(name) || 'My Cup',
    emoji: MY_CUP_EMOJIS.includes(emoji) ? emoji : MY_CUP_EMOJIS[0],
    trackIds: [...new Set(trackIds || [])].slice(0, MY_CUP_SIZE),
    custom: true,
  };
}

const out = (state, fx = [], go = null, extra = {}) => ({ state, fx, go, ...extra });
const wrap = (i, n) => ((i % n) + n) % n;

/**
 * @param {object} o
 * @param {string[]} o.trackIds the tracks you may pick (unlocked), in grid order
 * @param {string[]} [o.picks] a remembered cup (unknown / locked ids are dropped)
 * @param {string} [o.emoji] remembered badge
 * @param {string} [o.name] remembered name key ('{owner}' or a preset)
 * @param {string} [o.owner] P1's racer name (for "<name>'s Cup")
 * @param {number} [o.cols]
 * @param {string|null} [o.controllerId]
 */
export function createMyCupState({ trackIds = [], picks = [], emoji, name, owner = '', cols = 5, controllerId = null } = {}) {
  const ids = [...new Set(trackIds)];
  const kept = [];
  for (const id of picks || []) if (ids.includes(id) && !kept.includes(id) && kept.length < MY_CUP_SIZE) kept.push(id);
  const names = myCupNameChoices(owner);
  return {
    trackIds: ids,
    picks: kept,
    cursor: 0,
    cols: Math.max(1, cols | 0),
    focus: kept.length === MY_CUP_SIZE ? 'go' : 'grid',
    emojiIndex: Math.max(0, MY_CUP_EMOJIS.indexOf(emoji)),
    names,
    nameIndex: Math.max(0, names.indexOf(name)),
    owner: cleanName(owner),
    controllerId,
  };
}

export const myCupReady = (s) => s.picks.length === MY_CUP_SIZE;
export const myCupEmoji = (s) => MY_CUP_EMOJIS[s.emojiIndex] ?? MY_CUP_EMOJIS[0];
export const myCupNameKey = (s) => s.names[s.nameIndex] ?? 'My Cup';
export const myCupName = (s) => resolveCupName(myCupNameKey(s), s.owner);
/** What gets remembered / put in the RaceSetup. */
export const myCupSaved = (s) => ({ trackIds: [...s.picks], name: myCupNameKey(s), emoji: myCupEmoji(s) });

const cycle = (s, key) => (key === 'emoji'
  ? { ...s, focus: 'emoji', emojiIndex: wrap(s.emojiIndex + 1, MY_CUP_EMOJIS.length) }
  : { ...s, focus: 'name', nameIndex: wrap(s.nameIndex + 1, s.names.length) });

/**
 * Grid: arrows move the cursor; A adds the track (or takes it out again);
 * Up from the top row goes to the top bar. When the 4th track goes in, the
 * focus jumps to the big "Start My Cup!" button.
 * Top bar: Left/Right move between [emoji] [name] [Start]; A on the emoji or
 * name chip picks the next one; A on Start begins the cup; Down goes back to
 * the grid.
 * Anywhere: Y takes the last pick out; Start begins a full cup; B goes back.
 * Pointer: { action: 'pick', index } toggles that track, { action: 'cycle', key: 'emoji'|'name' },
 * { action: 'set', key: 'cursor', value }.
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
  const startCup = (st) => (myCupReady(st) ? out(st, ['confirm'], 'go') : out(st, ['back'], null, { shake: 'go' }));

  // Works the same from anywhere.
  switch (ev.action) {
    case 'start': return startCup(s);
    case 'back': return out(s, ['back'], 'back');
    case 'cycle':
      if (ev.key !== 'emoji' && ev.key !== 'name') return out(s);
      return out(cycle(s, ev.key), ['move']);
    case 'pick':
      if (!(ev.index >= 0 && ev.index < n)) return out(s);
      return toggle({ ...s, focus: 'grid' }, ev.index);
    case 'set':
      if (ev.key === 'cursor' && ev.value >= 0 && ev.value < n) return out({ ...s, focus: 'grid', cursor: ev.value }, ['move']);
      if (ev.key === 'focus' && MY_CUP_BAR.includes(ev.value)) return out({ ...s, focus: ev.value }, ['move']);
      return out(s);
    default: break;
  }

  if (s.focus !== 'grid') {
    const at = Math.max(0, MY_CUP_BAR.indexOf(s.focus));
    switch (ev.action) {
      case 'confirm':
        if (s.focus === 'go') return startCup(s);
        return out(cycle(s, s.focus), ['move']);
      case 'left': case 'right': {
        const next = Math.min(MY_CUP_BAR.length - 1, Math.max(0, at + (ev.action === 'right' ? 1 : -1)));
        return next === at ? out(s) : out({ ...s, focus: MY_CUP_BAR[next] }, ['move']);
      }
      case 'down': return n ? out({ ...s, focus: 'grid' }, ['move']) : out(s);
      case 'up': return out(s);
      case 'toggle':
        if (!s.picks.length) return out(s);
        // Undo from the Start button: back to the grid to pick a new one.
        return out({ ...s, focus: s.focus === 'go' ? 'grid' : s.focus, picks: s.picks.slice(0, -1) }, ['back']);
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
      if (next < 0 && ev.action === 'up') return out({ ...s, focus: myCupReady(s) ? 'go' : 'name' }, ['move']);
      if (next < 0 || next >= n) return out(s);
      return out({ ...s, cursor: next }, ['move']);
    }
    case 'confirm': return toggle(s, s.cursor);
    case 'toggle':
      if (!s.picks.length) return out(s);
      return out({ ...s, picks: s.picks.slice(0, -1) }, ['back']);
    default: return out(s);
  }
}

/** Remembered custom cup: { trackIds, name, emoji }. */
export function myCupStore(backend) {
  const store = backend === undefined ? jsonStore(MY_CUP_KEY) : jsonStore(MY_CUP_KEY, backend);
  return {
    load() {
      const v = store.read() || {};
      return {
        trackIds: Array.isArray(v.trackIds) ? v.trackIds.filter((id) => typeof id === 'string').slice(0, MY_CUP_SIZE) : [],
        name: MY_CUP_NAMES.includes(v.name) ? v.name : null,
        emoji: MY_CUP_EMOJIS.includes(v.emoji) ? v.emoji : null,
      };
    },
    save(saved = {}) {
      return store.write({
        trackIds: [...(saved.trackIds || [])].slice(0, MY_CUP_SIZE),
        name: MY_CUP_NAMES.includes(saved.name) ? saved.name : null,
        emoji: MY_CUP_EMOJIS.includes(saved.emoji) ? saved.emoji : null,
      });
    },
  };
}

/** The Grand Prix RaceSetup for a custom cup (name = display text). */
export function myCupSetup(players, trackIds, speedClass, { name, emoji } = {}) {
  const ids = [...trackIds].slice(0, MY_CUP_SIZE);
  const def = myCupDef(ids, { name, emoji });
  return {
    players, trackId: ids[0], speedClass, laps: null, mode: 'grand-prix', cupId: MY_CUP_ID,
    customTrackIds: ids, customCup: { name: def.name, emoji: def.emoji },
  };
}

/**
 * What the "My Cup" card on cup select shows: the remembered cup (name, badge,
 * track names) or 4 "You pick!" rows.
 * @param {{ trackIds?: string[], name?: string|null, emoji?: string|null }|null} saved
 * @param {(id: string) => string|null} trackName name of an unlocked track (null = locked / unknown)
 * @param {string} [owner] P1's racer name
 * @returns {{ name: string, emoji: string, rows: Array<string|null>, remembered: boolean }}
 */
export function myCupCard(saved, trackName, owner = '') {
  const names = (saved?.trackIds || []).map((id) => (typeof id === 'string' ? trackName(id) : null)).filter(Boolean).slice(0, MY_CUP_SIZE);
  const remembered = names.length > 0;
  return {
    name: saved?.name ? resolveCupName(saved.name, owner) : 'My Cup',
    emoji: MY_CUP_EMOJIS.includes(saved?.emoji) ? saved.emoji : MY_CUP_EMOJIS[0],
    rows: Array.from({ length: MY_CUP_SIZE }, (_, i) => names[i] ?? null),
    remembered,
  };
}
