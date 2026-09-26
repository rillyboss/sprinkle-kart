/**
 * Pure reducers for the progression screens (Sticker Book, Settings, the
 * parent gate). DOM-free and unit tested; the screens in src/ui/screens/
 * render these states and feed menu events ({ deviceId, action, ... }) in.
 *
 * Every reducer returns { state, fx: string[], go: string|null, ... } like
 * src/ui/menuState.js (fx = menu sound names for ctx.fx()).
 */

const out = (state, fx = [], go = null, extra = {}) => ({ state, fx, go, ...extra });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (i, n) => ((i % n) + n) % n;

/* ------------------------------------------------------------------ */
/* Parent gate: "Grown-ups: what is 7 + 5?" answered with the d-pad     */
/* ------------------------------------------------------------------ */

export const GATE_MAX = 20;
export const GATE_TRIES = 3;

/** Tiny seeded rng (Park-Miller), so tests can pick the question. */
function rng(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/**
 * A new addition question with a two-digit answer (11..17: easy for a
 * grown-up, a puzzle for a small racer). The dial starts at 0.
 * @param {number} [seed]
 */
export function createGate(seed = Date.now()) {
  const r = rng(seed);
  const a = 5 + Math.floor(r() * 5); // 5..9
  const bMin = Math.max(3, 11 - a);
  const bMax = Math.min(9, 17 - a);
  const b = bMin + Math.floor(r() * (bMax - bMin + 1));
  return { a, b, value: 0, tries: 0, seed: Math.floor(r() * 1e9) };
}

export const gateAnswer = (g) => g.a + g.b;

/**
 * up/right = +1, down/left = -1 (wrapping 0..GATE_MAX), confirm checks the
 * answer (go 'pass'), back = go 'cancel'. Pointer: { action:'set', value }.
 * After GATE_TRIES wrong answers a fresh question appears.
 */
export function gateReduce(g, ev) {
  switch (ev.action) {
    case 'up': case 'right': return out({ ...g, value: wrap(g.value + 1, GATE_MAX + 1) }, ['move']);
    case 'down': case 'left': return out({ ...g, value: wrap(g.value - 1, GATE_MAX + 1) }, ['move']);
    case 'set':
      if (!Number.isFinite(ev.value)) return out(g);
      return out({ ...g, value: clamp(Math.round(ev.value), 0, GATE_MAX) }, ['move']);
    case 'confirm': case 'start': case 'select': {
      if (g.value === gateAnswer(g)) return out(g, ['confirm'], 'pass');
      const tries = g.tries + 1;
      if (tries >= GATE_TRIES) return out(createGate(g.seed), ['gate-oops'], null, { shake: true, fresh: true });
      return out({ ...g, tries }, ['gate-oops'], null, { shake: true });
    }
    case 'back': return out(g, ['back'], 'cancel');
    default: return out(g);
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const SETTINGS_ROWS = Object.freeze(['music', 'sfx', 'kidAssist', 'unlockAll', 'reset', 'back']);
export const VOLUME_STEPS = 10;

/** @param {{music:number, sfx:number, kidAssistDefault:boolean}} settings  @param {boolean} unlockAll */
export function createSettingsState(settings = {}, unlockAll = false, { seed = Date.now() } = {}) {
  const step = (v, d) => clamp(Math.round((Number.isFinite(v) ? v : d) * VOLUME_STEPS), 0, VOLUME_STEPS);
  return {
    row: 0,
    music: step(settings.music, 0.7),
    sfx: step(settings.sfx, 0.85),
    kidAssist: !!settings.kidAssistDefault,
    unlockAll: !!unlockAll,
    modal: null,          // null | 'gate' | 'confirm-reset' | 'done'
    gate: null,
    gateFor: null,        // 'unlockAll' | 'reset'
    confirmIndex: 0,      // 0 = "Keep it!", 1 = "Reset"
    seed,
  };
}

const volumeEffect = (s) => ({ type: 'volume', music: s.music / VOLUME_STEPS, sfx: s.sfx / VOLUME_STEPS });

function openGate(s, gateFor) {
  const gate = createGate(s.seed);
  return { ...s, modal: 'gate', gate, gateFor, seed: gate.seed };
}

/**
 * Settings reducer. Directions move rows / change the focused value, confirm
 * acts, back leaves (or closes a modal). Returns `effects` for the screen to
 * apply: { type: 'volume', music, sfx } | { type: 'kidAssist', on } |
 * { type: 'unlockAll', on } | { type: 'reset' }.
 * Pointer: { action:'select', index } focuses a row and confirms it;
 * { action:'set', key:'music'|'sfx', value:0..10 } sets a volume.
 */
export function settingsReduce(s, ev) {
  const fx = [];
  const effects = [];
  const done = (st, go = null, extra = {}) => ({ state: st, fx, go, effects, ...extra });

  if (s.modal === 'gate') {
    const r = gateReduce(s.gate, ev);
    fx.push(...r.fx);
    if (r.go === 'cancel') return done({ ...s, modal: null, gate: null, gateFor: null });
    if (r.go === 'pass') {
      if (s.gateFor === 'unlockAll') {
        effects.push({ type: 'unlockAll', on: true });
        fx.push('unlock');
        return done({ ...s, modal: 'done', gate: null, unlockAll: true });
      }
      effects.push({ type: 'reset' });
      return done({ ...s, modal: 'done', gate: null, unlockAll: false });
    }
    return done({ ...s, gate: r.state }, null, { shake: !!r.shake });
  }

  if (s.modal === 'done') {
    if (['confirm', 'back', 'start', 'select'].includes(ev.action)) {
      fx.push('confirm');
      return done({ ...s, modal: null, gateFor: null });
    }
    return done(s);
  }

  if (s.modal === 'confirm-reset') {
    switch (ev.action) {
      case 'left': case 'right': case 'up': case 'down':
        fx.push('move');
        return done({ ...s, confirmIndex: 1 - s.confirmIndex });
      case 'select':
        if (ev.index !== 0 && ev.index !== 1) return done(s);
        return settingsReduce({ ...s, confirmIndex: ev.index }, { ...ev, action: 'confirm' });
      case 'confirm': case 'start':
        if (s.confirmIndex === 1) { fx.push('confirm'); return done(openGate({ ...s, confirmIndex: 0 }, 'reset')); }
        fx.push('back');
        return done({ ...s, modal: null });
      case 'back':
        fx.push('back');
        return done({ ...s, modal: null, confirmIndex: 0 });
      default: return done(s);
    }
  }

  const key = SETTINGS_ROWS[s.row];
  const adjust = (d) => {
    if (key === 'music' || key === 'sfx') {
      const v = clamp(s[key] + d, 0, VOLUME_STEPS);
      if (v === s[key]) return done(s);
      const ns = { ...s, [key]: v };
      fx.push('move');
      effects.push(volumeEffect(ns));
      return done(ns);
    }
    if (key === 'kidAssist') {
      const ns = { ...s, kidAssist: !s.kidAssist };
      fx.push('move');
      effects.push({ type: 'kidAssist', on: ns.kidAssist });
      return done(ns);
    }
    return done(s);
  };
  const act = (st) => {
    const k = SETTINGS_ROWS[st.row];
    switch (k) {
      case 'kidAssist': {
        const ns = { ...st, kidAssist: !st.kidAssist };
        fx.push('confirm');
        effects.push({ type: 'kidAssist', on: ns.kidAssist });
        return done(ns);
      }
      case 'unlockAll':
        if (st.unlockAll) {
          fx.push('back');
          effects.push({ type: 'unlockAll', on: false });
          return done({ ...st, unlockAll: false });
        }
        fx.push('confirm');
        return done(openGate(st, 'unlockAll'));
      case 'reset':
        fx.push('confirm');
        return done({ ...st, modal: 'confirm-reset', confirmIndex: 0 });
      case 'back':
        fx.push('back');
        return done(st, 'back');
      default:
        return done(st); // volumes: A does nothing (left/right change them)
    }
  };

  switch (ev.action) {
    case 'up': fx.push('move'); return done({ ...s, row: wrap(s.row - 1, SETTINGS_ROWS.length) });
    case 'down': fx.push('move'); return done({ ...s, row: wrap(s.row + 1, SETTINGS_ROWS.length) });
    case 'left': return adjust(-1);
    case 'right': return adjust(+1);
    case 'confirm': case 'start': return act(s);
    case 'select':
      if (!(ev.index >= 0 && ev.index < SETTINGS_ROWS.length)) return done(s);
      return act({ ...s, row: ev.index });
    case 'set': {
      if ((ev.key !== 'music' && ev.key !== 'sfx') || !Number.isFinite(ev.value)) return done(s);
      const ns = { ...s, row: SETTINGS_ROWS.indexOf(ev.key), [ev.key]: clamp(Math.round(ev.value), 0, VOLUME_STEPS) };
      fx.push('move');
      effects.push(volumeEffect(ns));
      return done(ns);
    }
    case 'back': fx.push('back'); return done(s, 'back');
    default: return done(s);
  }
}

/* ------------------------------------------------------------------ */
/* Sticker Book (collection)                                           */
/* ------------------------------------------------------------------ */

export const BOOK_TABS = Object.freeze(['racers', 'tracks', 'stats']);

/**
 * @param {{ racers: number, tracks: number, racerCols?: number, trackCols?: number, tab?: number }} o
 * focus: 'tabs' (the tab strip) or 'grid'.
 */
export function createBookState({ racers = 0, tracks = 0, racerCols = 7, trackCols = 4, tab = 0 } = {}) {
  return {
    tab: clamp(tab, 0, BOOK_TABS.length - 1),
    focus: 'grid',
    counts: [racers, tracks, 0],
    cols: [Math.max(1, racerCols), Math.max(1, trackCols), 1],
    index: [0, 0, 0],
  };
}

const withIndex = (s, i) => {
  const index = [...s.index];
  index[s.tab] = i;
  return { ...s, index };
};
const setTab = (s, tab) => {
  const t = wrap(tab, BOOK_TABS.length);
  return { ...s, tab: t, focus: s.counts[t] > 0 ? s.focus : 'tabs' };
};

/**
 * Tab strip: left/right switch pages, down enters the grid. Grid: arrows move
 * (up from the top row goes back to the tab strip), toggle (Y / Tab) = next
 * page from anywhere, back = go 'back'.
 * Pointer: { action:'set', key:'tab', value } and { action:'pick', index }.
 */
export function bookReduce(s, ev) {
  const n = s.counts[s.tab];
  const cols = s.cols[s.tab];
  const i = s.index[s.tab];
  switch (ev.action) {
    case 'toggle': return out(setTab(s, s.tab + 1), ['book-page']);
    case 'back': return out(s, ['back'], 'back');
    case 'set':
      if (ev.key === 'tab' && Number.isInteger(ev.value)) return out(setTab({ ...s, focus: 'tabs' }, ev.value), ['book-page']);
      return out(s);
    case 'pick':
      if (!(ev.index >= 0 && ev.index < n)) return out(s);
      return out({ ...withIndex(s, ev.index), focus: 'grid' }, ['move']);
    default: break;
  }
  if (s.focus === 'tabs' || n === 0) {
    switch (ev.action) {
      case 'left': return out(setTab(s, s.tab - 1), ['book-page']);
      case 'right': return out(setTab(s, s.tab + 1), ['book-page']);
      case 'down': case 'confirm':
        return n > 0 ? out({ ...s, focus: 'grid' }, ['move']) : out(s);
      case 'start': return out(s, ['back'], 'back');
      default: return out(s);
    }
  }
  switch (ev.action) {
    case 'left': return out(withIndex(s, wrap(i - 1, n)), ['move']);
    case 'right': return out(withIndex(s, wrap(i + 1, n)), ['move']);
    case 'up':
      if (i - cols < 0) return out({ ...s, focus: 'tabs' }, ['move']);
      return out(withIndex(s, i - cols), ['move']);
    case 'down': {
      if (i + cols < n) return out(withIndex(s, i + cols), ['move']);
      // last partial row: land on its last sticker rather than doing nothing
      const lastRowStart = Math.floor((n - 1) / cols) * cols;
      if (i < lastRowStart) return out(withIndex(s, n - 1), ['move']);
      return out(s);
    }
    case 'confirm': return out(s, [], null, { cheer: true }); // the screen plays 'sticker' or a nope wiggle
    case 'start': return out(s, ['back'], 'back');
    default: return out(s);
  }
}
