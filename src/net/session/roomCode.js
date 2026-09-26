/**
 * Kid-friendly room codes (NETWORKING.md §1 rule 2, §4.2, §10.1, §19).
 *
 * A room is just **4 big letters**, like `CAKE`, shown huge on the host's TV. The letters come from an
 * unambiguous alphabet (no I, O or Q, so nobody mixes them up with 1 and 0), and a small blocklist keeps
 * rude words away. Friends join by picking the game in "Games you can join" (our Worker's open-games list),
 * by opening the invite link (`?join=CAKE`) or by typing the 4 letters on the chunky letter grid.
 *
 * `deriveRoomIds(code)` turns a code into the matchmaker ids (a quick SHA-256, no secrets): the public
 * signaling topic + password and the Worker room id. The Worker uses the very same room-id formula
 * (infra/signal-worker/src/codes.js) to check a host's code before listing its room.
 *
 * Also the pure `codeEntryReduce` for the code-entry screen (controller, keyboard and mouse).
 *
 * OWNER: online session & screens.
 */

/** Capital letters without the look-alikes I and O (and Q, which kids read as O). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export const CODE_LENGTH = 4;
const CODE_RE = /^[ABCDEFGHJKLMNPRSTUVWXYZ]{4}$/;

/** Three-letter bits that never appear anywhere in a code. */
export const BLOCKED_PARTS = Object.freeze([
  'ASS', 'FUK', 'FUC', 'FCK', 'FKU', 'SEX', 'XXX', 'KKK', 'WTF', 'CUM', 'FAG', 'JEW', 'NGR', 'NGA', 'NAZ',
  'DMN', 'PUS', 'PNS', 'VAG', 'TWT', 'CNT', 'SHT', 'SUX', 'GAY', 'KYS', 'STD', 'DUM', 'FAT', 'UGL', 'PMS',
  'BUM', 'PEE', 'WEE', 'NUD', 'DED', 'WTH', 'STF',
]);
/** Whole four-letter words a code is never. */
export const BLOCKED_WORDS = Object.freeze([
  'ARSE', 'ANAL', 'ANUS', 'BUTT', 'CRAP', 'CUNT', 'DAMN', 'DUMB', 'DYKE', 'FAGS', 'FART', 'FUCK', 'FUKK',
  'HELL', 'JERK', 'KUNT', 'RAPE', 'SCUM', 'SEXY', 'SHAT', 'SLUT', 'SUCK', 'TURD', 'TWAT', 'UGLY', 'WANK',
  'HATE', 'DEAD', 'DUMP', 'SPAZ', 'JAPS', 'GAYS', 'HUMP', 'NUDE', 'PUKE', 'PERV', 'THUG', 'SCAT', 'BRAT',
  'DRUG', 'BEER', 'GUNS', 'STAB', 'NERD', 'MEAN', 'PRAT', 'KLAN', 'SMUT', 'BAWD',
]);

/** True when a code contains a rude bit (or is a rude word). */
export function isRudeCode(code) {
  const c = String(code ?? '').toUpperCase();
  if (BLOCKED_WORDS.includes(c)) return true;
  return BLOCKED_PARTS.some((p) => c.includes(p));
}

/** A well-formed room code: 4 letters of CODE_ALPHABET. */
export function isRoomCode(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

/** Uniform integer 0..n-1 from crypto.getRandomValues (browser + node 20). */
export function cryptoRandomInt(n) {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error('crypto.getRandomValues is needed for room codes');
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

/**
 * A fresh room code for a host (never a rude one).
 * @param {(() => number)|null} [rng] returns [0,1); default crypto.getRandomValues
 * @param {{ avoid?: string[] }} [o] codes not to use (e.g. one that was already taken)
 */
export function makeRoomCode(rng = null, { avoid = [] } = {}) {
  for (let tries = 0; tries < 200; tries++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[intFrom(rng, CODE_ALPHABET.length)];
    if (!isRudeCode(code) && !avoid.includes(code)) return code;
  }
  return 'CAKE'; // a broken rng that keeps landing on blocked codes: still a friendly room
}

/**
 * Forgiving code parser: case, spaces and dashes are fine ('c a-k e' → 'CAKE'); anything that is not
 * 4 letters of the alphabet → null.
 * @param {unknown} text
 */
export function parseRoomCode(text) {
  if (typeof text !== 'string' || text.length > 32) return null;
  const c = text.replace(/[\s-_]+/g, '').toUpperCase();
  return isRoomCode(c) ? c : null;
}

/* ------------------------------------------------------------------ */
/* Room ids for the matchmakers                                        */
/* ------------------------------------------------------------------ */

/** Must match infra/signal-worker/src/codes.js ROOM_ID_SALT (the Worker checks listed codes with it). */
export const ROOM_ID_SALT = 'sprinkle-kart-room-v2|';
const TOPIC_SALT = 'sprinkle-kart-topic-v2|';
const PASSWORD_SALT = 'sprinkle-kart-pw-v2|';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The matchmaker ids for a room code (quick: three SHA-256s).
 * @param {string} code
 * @param {{ subtle?: SubtleCrypto }} [o]
 * @returns {Promise<{ code: string, topic: string, password: string, workerRoom: string }>}
 */
export async function deriveRoomIds(code, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!isRoomCode(code)) throw new TypeError('deriveRoomIds: a 4-letter room code is needed');
  if (!subtle) throw new Error('deriveRoomIds: crypto.subtle is not available (a secure context is needed)');
  const sha = (text) => subtle.digest('SHA-256', enc.encode(text));
  const [room, topic, pw] = await Promise.all([sha(ROOM_ID_SALT + code), sha(TOPIC_SALT + code), sha(PASSWORD_SALT + code)]);
  return { code, topic: `sk-${hex(topic).slice(0, 20)}`, password: b64url(pw), workerRoom: `r${hex(room).slice(0, 24)}` };
}

/* ------------------------------------------------------------------ */
/* Code entry reducer                                                  */
/* ------------------------------------------------------------------ */

/** The chunky on-screen keys: every letter, then "erase". 6 columns × 4 rows. */
export const CODE_KEYS = Object.freeze([...CODE_ALPHABET, 'erase']);
export const CODE_GRID_COLS = 6;
const wrap = (i, n) => ((i % n) + n) % n;
const out = (state, fx = [], go = null, extra = {}) => ({ state, fx, go, ...extra });

/** @param {string} [prefill] letters already typed (e.g. from a pasted code) */
export function createCodeEntryState(prefill = '') {
  const letters = [...String(prefill ?? '').toUpperCase()].filter((ch) => CODE_ALPHABET.includes(ch)).slice(0, CODE_LENGTH).join('');
  return { letters, cursor: 0 };
}

/** Add one letter; the 4th letter joins right away. */
function addLetter(s, ch) {
  if (!CODE_ALPHABET.includes(ch)) return out(s, ['back'], null, { shake: true });
  if (s.letters.length >= CODE_LENGTH) return out(s);
  const letters = s.letters + ch;
  const st = { ...s, letters };
  return letters.length === CODE_LENGTH ? out(st, ['confirm'], 'join', { code: letters }) : out(st, ['move']);
}

/**
 * Controller: the arrows move over the letter grid, A presses the key under the cursor (a letter, or
 * "erase"), B erases the last letter (and on an empty code leaves: go 'back'), Start with 4 letters joins.
 * Keyboard: { action:'type', text } (letters; I/O/Q and anything else wiggles), { action:'erase' }
 * (Backspace), { action:'paste', text } (a code or an invite link). Mouse: { action:'press', index }.
 * `go`: 'back' | 'join' (+ `code`) — the 4th letter joins at once, no extra press.
 * @param {{ letters: string, cursor: number }} s
 * @param {{ action: string } & object} ev
 * @param {{ parseInvite?: (text: string) => string|null }} [o]
 */
export function codeEntryReduce(s, ev, { parseInvite = null } = {}) {
  const n = CODE_KEYS.length;
  const cols = CODE_GRID_COLS;
  const press = (index) => {
    const key = CODE_KEYS[index];
    if (key === undefined) return out(s);
    const st = { ...s, cursor: index };
    if (key === 'erase') return st.letters ? out({ ...st, letters: st.letters.slice(0, -1) }, ['back']) : out(st, ['back']);
    return addLetter(st, key);
  };
  switch (ev.action) {
    case 'type': {
      let st = s;
      let res = out(s);
      for (const ch of String(ev.text ?? '').toUpperCase()) {
        if (!/[A-Z]/.test(ch)) continue;
        res = addLetter(st, ch);
        st = res.state;
        if (res.go || res.shake) return res;
      }
      return res;
    }
    case 'erase':
      return s.letters ? out({ ...s, letters: s.letters.slice(0, -1) }, ['back']) : out(s);
    case 'paste': {
      const text = String(ev.text ?? '');
      const code = (typeof parseInvite === 'function' ? parseInvite(text) : null) ?? parseRoomCode(text);
      if (!code) return out(s, ['back'], null, { shake: true });
      return out({ ...s, letters: code }, ['confirm'], 'join', { code });
    }
    case 'press':
      return Number.isInteger(ev.index) ? press(ev.index) : out(s);
    case 'left': return out({ ...s, cursor: wrap(s.cursor - 1, n) }, ['move']);
    case 'right': return out({ ...s, cursor: wrap(s.cursor + 1, n) }, ['move']);
    case 'up': {
      const c = s.cursor - cols;
      return out({ ...s, cursor: c >= 0 ? c : Math.min(n - 1, wrap(s.cursor, cols) + cols * Math.floor((n - 1) / cols)) }, ['move']);
    }
    case 'down': {
      const c = s.cursor + cols;
      return out({ ...s, cursor: c < n ? c : wrap(s.cursor, cols) }, ['move']);
    }
    case 'confirm':
      return press(s.cursor);
    case 'start':
      if (s.letters.length === CODE_LENGTH) return out(s, ['confirm'], 'join', { code: s.letters });
      return press(s.cursor);
    case 'back':
      if (s.letters) return out({ ...s, letters: s.letters.slice(0, -1) }, ['back']);
      return out(s, ['back'], 'back');
    default:
      return out(s);
  }
}
