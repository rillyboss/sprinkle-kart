/**
 * Room labels + secret sweets (NETWORKING.md §1 rule 2, §4.2, §10.1, §19).
 *
 * A room has a friendly **label** like `SPRINKLE-4821` (one of 32 cute words +
 * 4 digits; shown and said out loud, NOT secret) and a secret of 6 **secret
 * sweets** (6 picks from a fixed 64-treat palette = 36 bits). Label + sweets are
 * stretched into the room key by `deriveRoomIds` (src/net/roomKey.js, WS2); the
 * label alone gives nothing.
 *
 * Also the pure `codeEntryReduce` for the code-entry screen: a word wheel,
 * 4 digit wheels and an 8 × 8 sweets grid, driven by a controller, the keyboard
 * or the mouse.
 *
 * SECRET_SWEETS: the binding palette lives with WS2's roomKey.js. Until that
 * lands on main, this module carries the same 64-entry palette so the lobby,
 * invite links and code entry work; switch the import when roomKey.js merges
 * (the indices, not the pictures, are what the room key uses).
 *
 * OWNER: WS6 (session, lobby & screens).
 */

/** 32 cute words for room labels (upper case, letters only). Append-only: never reorder. */
export const ROOM_WORDS = Object.freeze([
  'SPRINKLE', 'CUPCAKE', 'GUMDROP', 'LOLLIPOP', 'COOKIE', 'MUFFIN', 'DONUT', 'BUBBLE',
  'RAINBOW', 'UNICORN', 'SUNDAE', 'TOFFEE', 'CANDY', 'JELLY', 'PUDDING', 'WAFFLE',
  'PANCAKE', 'BISCUIT', 'CHERRY', 'PEACH', 'BERRY', 'MANGO', 'TEACUP', 'TEDDY',
  'BUNNY', 'KITTEN', 'PUPPY', 'PICNIC', 'STARLIGHT', 'MOONBEAM', 'SUNSHINE', 'BALLOON',
]);

/** 64 secret sweets (index 0..63 = one base64url character in invite links). Append-only. */
export const SECRET_SWEETS = Object.freeze([
  '🍩', '🦄', '🍓', '🍭', '🧁', '🌈', '🍪', '🍫',
  '🍬', '🍰', '🎂', '🍦', '🍨', '🍧', '🥧', '🍮',
  '🍯', '🍒', '🍑', '🍉', '🍇', '🍌', '🍍', '🥝',
  '🍋', '🍊', '🍎', '🍐', '🥭', '🥥', '🥨', '🥞',
  '🧇', '🍿', '🥐', '🍡', '🍥', '🍘', '🧃', '🥤',
  '🧋', '🍵', '🥮', '🥛', '🎈', '🎀', '🎁', '💖',
  '🌸', '🌻', '🌷', '🍀', '🍄', '🌙', '🍙', '🧸',
  '🎠', '🎡', '🎨', '🎵', '💎', '🌺', '🌟', '🎉',
]);

export const SWEETS_COUNT = 6;
export const SWEETS_GRID_COLS = 8;
export const LABEL_DIGITS = 4;

/** Uniform integer 0..n-1 from crypto.getRandomValues (browser + node 20). */
export function cryptoRandomInt(n) {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error('crypto.getRandomValues is needed for room secrets');
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n; // rejection sampling: no modulo bias
  for (;;) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** rng() in [0,1) → integer 0..n-1 (null rng = crypto). */
function intFrom(rng, n) {
  if (typeof rng !== 'function') return cryptoRandomInt(n);
  const v = Number(rng());
  const i = Math.floor((Number.isFinite(v) ? v : 0) * n);
  return Math.max(0, Math.min(n - 1, i));
}

/** 'SPRINKLE' + [4,8,2,1] → 'SPRINKLE-4821'. */
export function formatLabel(wordIndex, digits) {
  const w = ROOM_WORDS[wordIndex] ?? ROOM_WORDS[0];
  return `${w}-${digits.map((d) => String(Math.max(0, Math.min(9, d | 0)))).join('')}`;
}

/**
 * A fresh room secret for a host.
 * @param {(() => number)|null} [rng] returns [0,1); default crypto.getRandomValues
 * @returns {{ label: string, sweets: number[] }}
 */
export function makeRoomSecret(rng = null) {
  const word = intFrom(rng, ROOM_WORDS.length);
  const digits = Array.from({ length: LABEL_DIGITS }, () => intFrom(rng, 10));
  const sweets = Array.from({ length: SWEETS_COUNT }, () => intFrom(rng, SECRET_SWEETS.length));
  return { label: formatLabel(word, digits), sweets };
}

/**
 * Forgiving label parser: case, spaces, '-', '_' or nothing between word and
 * digits. 'sprinkle 4821' → 'SPRINKLE-4821'; anything else → null.
 * @param {unknown} text
 */
export function parseRoomCode(text) {
  if (typeof text !== 'string' || text.length > 64) return null;
  const m = /^\s*([a-z]+)\s*[-_ ]?\s*(\d)\s*(\d)\s*(\d)\s*(\d)\s*$/i.exec(text);
  if (!m) return null;
  const word = m[1].toUpperCase();
  if (!ROOM_WORDS.includes(word)) return null;
  return `${word}-${m[2]}${m[3]}${m[4]}${m[5]}`;
}

/** Word index + digits of a canonical label (null if it is not one). */
export function splitLabel(label) {
  const canon = parseRoomCode(label);
  if (!canon) return null;
  const [word, digits] = canon.split('-');
  return { wordIndex: ROOM_WORDS.indexOf(word), digits: [...digits].map(Number) };
}

/** True for a well-formed RoomSecret { label, sweets: 6 × 0..63 }. */
export function isRoomSecret(s) {
  return !!s && typeof s === 'object'
    && parseRoomCode(s.label) === s.label
    && Array.isArray(s.sweets) && s.sweets.length === SWEETS_COUNT
    && s.sweets.every((i) => Number.isInteger(i) && i >= 0 && i < SECRET_SWEETS.length);
}

/** '🍩🦄🍓🍭🧁🌈' for display (the host's own screen and the code-entry echo). */
export function sweetsText(sweets = []) {
  return sweets.map((i) => SECRET_SWEETS[i] ?? '❔').join('');
}

/* ------------------------------------------------------------------ */
/* Code entry reducer                                                  */
/* ------------------------------------------------------------------ */

export const LABEL_COLS = 1 + LABEL_DIGITS; // word wheel + 4 digit wheels
const wrap = (i, n) => ((i % n) + n) % n;
const out = (state, fx = [], go = null, extra = {}) => ({ state, fx, go, ...extra });

/**
 * @param {{ label?: string, sweets?: number[] }} [prefill] e.g. from a pasted code
 */
export function createCodeEntryState(prefill = {}) {
  const lab = splitLabel(prefill.label ?? '') ?? { wordIndex: 0, digits: [0, 0, 0, 0] };
  const picks = Array.isArray(prefill.sweets)
    ? prefill.sweets.filter((i) => Number.isInteger(i) && i >= 0 && i < SECRET_SWEETS.length).slice(0, SWEETS_COUNT)
    : [];
  return {
    focus: 'label',   // 'label' | 'sweets' | 'go'
    col: 0,           // label column: 0 = word, 1..4 = digits
    wordIndex: lab.wordIndex,
    digits: lab.digits,
    cursor: 0,        // sweets grid cursor 0..63
    picks,            // chosen sweet indices, in order
    typed: '',        // letters typed on a keyboard (word prefix search)
  };
}

/** The label the wheels show. */
export const entryLabel = (s) => formatLabel(s.wordIndex, s.digits);

/** The full secret once 6 sweets are picked, else null. */
export function entrySecret(s) {
  if (s.picks.length !== SWEETS_COUNT) return null;
  return { label: entryLabel(s), sweets: [...s.picks] };
}

function typeText(s, text) {
  let st = s;
  let changed = false;
  for (const ch of String(text)) {
    if (/[a-z]/i.test(ch)) {
      const typed = (st.typed + ch).toUpperCase();
      let idx = ROOM_WORDS.findIndex((w) => w.startsWith(typed));
      let nextTyped = typed;
      if (idx < 0) { // start a new word with this letter
        nextTyped = ch.toUpperCase();
        idx = ROOM_WORDS.findIndex((w) => w.startsWith(nextTyped));
      }
      if (idx >= 0) { st = { ...st, wordIndex: idx, typed: nextTyped, focus: 'label', col: 0 }; changed = true; }
    } else if (/[0-9]/.test(ch)) {
      const col = st.focus === 'label' && st.col >= 1 ? st.col : 1;
      const digits = [...st.digits];
      digits[col - 1] = Number(ch);
      const nextCol = col < LABEL_DIGITS ? col + 1 : col;
      st = { ...st, digits, focus: col === LABEL_DIGITS ? 'sweets' : 'label', col: col === LABEL_DIGITS ? col : nextCol, typed: '' };
      changed = true;
    }
  }
  return changed ? out(st, ['move']) : out(s);
}

/**
 * Controller: in the label row Left/Right pick a wheel and Up/Down spin it, A
 * moves on to the sweets grid. In the grid the arrows move and A picks a sweet
 * (6 picks → the "Join!" button). B removes the last sweet / steps back; B on an
 * empty grid returns to the wheels, and B on the wheels leaves (go 'back').
 * Keyboard: { action:'type', text } (letters search the word list, digits fill
 * the digit wheels), { action:'erase' } (Backspace), { action:'paste', text }
 * (a whole code 'SPRINKLE-4821' or an invite link / fragment).
 * Mouse: { action:'set', key:'word'|'digit', col?, value }, { action:'pick', index },
 * { action:'unpick', index }, { action:'focus', focus }.
 * `go`: 'back' | 'join' (+ `secret`).
 */
export function codeEntryReduce(s, ev, { parseInvite = null } = {}) {
  const n = SECRET_SWEETS.length;
  const cols = SWEETS_GRID_COLS;
  switch (ev.action) {
    case 'type': return typeText(s, ev.text ?? '');
    case 'erase': {
      if (s.picks.length) return out({ ...s, picks: s.picks.slice(0, -1), focus: 'sweets' }, ['back']);
      if (s.typed) return out({ ...s, typed: s.typed.slice(0, -1) }, ['back']);
      return out(s);
    }
    case 'paste': {
      const text = String(ev.text ?? '');
      const secret = typeof parseInvite === 'function' ? parseInvite(text) : null;
      if (secret) {
        const next = createCodeEntryState(secret);
        return out({ ...next, focus: 'go' }, ['confirm']);
      }
      const label = parseRoomCode(text);
      if (!label) return out(s, ['back'], null, { shake: true });
      const lab = splitLabel(label);
      return out({ ...s, wordIndex: lab.wordIndex, digits: lab.digits, focus: 'sweets', typed: '' }, ['confirm']);
    }
    case 'focus':
      if (!['label', 'sweets', 'go'].includes(ev.focus)) return out(s);
      if (ev.focus === 'go' && s.picks.length !== SWEETS_COUNT) return out(s);
      return out({ ...s, focus: ev.focus }, ['move']);
    case 'set': {
      if (ev.key === 'word' && Number.isInteger(ev.value)) {
        return out({ ...s, focus: 'label', col: 0, wordIndex: wrap(ev.value, ROOM_WORDS.length), typed: '' }, ['move']);
      }
      if (ev.key === 'digit' && Number.isInteger(ev.col) && ev.col >= 1 && ev.col <= LABEL_DIGITS && Number.isInteger(ev.value)) {
        const digits = [...s.digits];
        digits[ev.col - 1] = wrap(ev.value, 10);
        return out({ ...s, focus: 'label', col: ev.col, digits, typed: '' }, ['move']);
      }
      return out(s);
    }
    case 'pick': {
      if (!(Number.isInteger(ev.index) && ev.index >= 0 && ev.index < n)) return out(s);
      if (s.picks.length >= SWEETS_COUNT) return out({ ...s, cursor: ev.index, focus: 'go' }, ['back'], null, { shake: true });
      const picks = [...s.picks, ev.index];
      return out({ ...s, cursor: ev.index, picks, focus: picks.length === SWEETS_COUNT ? 'go' : 'sweets' }, ['join']);
    }
    case 'unpick': {
      if (!(Number.isInteger(ev.index) && ev.index >= 0 && ev.index < s.picks.length)) return out(s);
      return out({ ...s, picks: s.picks.filter((_, k) => k !== ev.index), focus: 'sweets' }, ['back']);
    }
    default: break;
  }

  if (s.focus === 'label') {
    switch (ev.action) {
      case 'left': return out({ ...s, col: wrap(s.col - 1, LABEL_COLS), typed: '' }, ['move']);
      case 'right': return out({ ...s, col: wrap(s.col + 1, LABEL_COLS), typed: '' }, ['move']);
      case 'up':
      case 'down': {
        const d = ev.action === 'up' ? 1 : -1;
        if (s.col === 0) return out({ ...s, wordIndex: wrap(s.wordIndex + d, ROOM_WORDS.length), typed: '' }, ['move']);
        const digits = [...s.digits];
        digits[s.col - 1] = wrap(digits[s.col - 1] + d, 10);
        return out({ ...s, digits, typed: '' }, ['move']);
      }
      case 'confirm':
      case 'start':
        if (s.col < LABEL_COLS - 1 && ev.action === 'confirm') return out({ ...s, col: s.col + 1 }, ['move']);
        return out({ ...s, focus: s.picks.length === SWEETS_COUNT ? 'go' : 'sweets' }, ['confirm']);
      case 'back':
        if (s.col > 0) return out({ ...s, col: s.col - 1 }, ['back']);
        return out(s, ['back'], 'back');
      default: return out(s);
    }
  }

  if (s.focus === 'sweets') {
    switch (ev.action) {
      case 'left': return out({ ...s, cursor: wrap(s.cursor - 1, n) }, ['move']);
      case 'right': return out({ ...s, cursor: wrap(s.cursor + 1, n) }, ['move']);
      case 'up':
        if (s.cursor < cols) return out({ ...s, focus: 'label' }, ['move']);
        return out({ ...s, cursor: s.cursor - cols }, ['move']);
      case 'down':
        if (s.cursor + cols >= n) return s.picks.length === SWEETS_COUNT ? out({ ...s, focus: 'go' }, ['move']) : out(s);
        return out({ ...s, cursor: s.cursor + cols }, ['move']);
      case 'confirm':
        return codeEntryReduce(s, { action: 'pick', index: s.cursor });
      case 'start':
        if (s.picks.length === SWEETS_COUNT) return out({ ...s, focus: 'go' }, ['confirm'], 'join', { secret: entrySecret(s) });
        return codeEntryReduce(s, { action: 'pick', index: s.cursor });
      case 'back':
        if (s.picks.length) return out({ ...s, picks: s.picks.slice(0, -1) }, ['back']);
        return out({ ...s, focus: 'label' }, ['back']);
      default: return out(s);
    }
  }

  // focus 'go'
  switch (ev.action) {
    case 'confirm':
    case 'start':
      if (s.picks.length !== SWEETS_COUNT) return out({ ...s, focus: 'sweets' }, ['back'], null, { shake: true });
      return out(s, ['confirm'], 'join', { secret: entrySecret(s) });
    case 'up': return out({ ...s, focus: 'sweets' }, ['move']);
    case 'back': return out({ ...s, picks: s.picks.slice(0, -1), focus: 'sweets' }, ['back']);
    default: return out(s);
  }
}
