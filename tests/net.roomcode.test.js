// Kid-friendly room codes (NETWORKING.md §1 rule 2, §4.2, §10.1): 4 big letters, an unambiguous alphabet,
// no rude words, quick room ids that match the Worker, and the chunky letter-grid code entry.
import { describe, it, expect } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import {
  CODE_ALPHABET, CODE_LENGTH, CODE_KEYS, CODE_GRID_COLS, BLOCKED_PARTS, BLOCKED_WORDS, ROOM_ID_SALT,
  isRudeCode, isRoomCode, makeRoomCode, parseRoomCode, cryptoRandomInt, deriveRoomIds,
  createCodeEntryState, codeEntryReduce,
} from '../src/net/session/roomCode.js';
import { parseInviteCode } from '../src/net/session/inviteLink.js';
import { seededRng } from '../src/net/session/composeSetup.js';
import * as workerCodes from '../infra/signal-worker/src/codes.js';

const subtle = globalThis.crypto?.subtle ?? webcrypto.subtle;

describe('the code alphabet', () => {
  it('is capital letters with no look-alikes (I, O, Q, 0, 1) and matches the Worker', () => {
    expect(CODE_LENGTH).toBe(4);
    expect(CODE_ALPHABET).toMatch(/^[A-Z]+$/);
    for (const c of 'IOQ01') expect(CODE_ALPHABET).not.toContain(c);
    expect(CODE_ALPHABET).toBe(workerCodes.CODE_ALPHABET);
    expect(ROOM_ID_SALT).toBe(workerCodes.ROOM_ID_SALT);
    expect(isRoomCode('CAKE')).toBe(true);
    for (const bad of ['cake', 'COOL', 'CAK', 'CAKES', 'CA E', 42, null]) expect(isRoomCode(bad)).toBe(false);
  });

  it('blocks rude words and rude bits anywhere in a code', () => {
    for (const w of BLOCKED_WORDS) {
      expect(w).toMatch(/^[A-Z]{4}$/);
      expect(isRudeCode(w), w).toBe(true);
    }
    for (const p of BLOCKED_PARTS) {
      expect(p).toMatch(/^[A-Z]{3}$/);
      expect(isRudeCode(`${p}A`), p).toBe(true);
      expect(isRudeCode(`B${p}`), p).toBe(true);
    }
    for (const ok of ['CAKE', 'BUNS', 'TART', 'MEWS', 'ZAPY']) expect(isRudeCode(ok), ok).toBe(false);
  });
});

describe('makeRoomCode', () => {
  it('draws 4 letters of the alphabet, never a rude code, with a seeded rng or crypto', () => {
    const rng = seededRng(7);
    const seen = new Set();
    for (let i = 0; i < 3000; i++) {
      const c = makeRoomCode(rng);
      expect(isRoomCode(c), c).toBe(true);
      expect(isRudeCode(c), c).toBe(false);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(2900); // ~280 000 codes: collisions are rare
    expect(isRoomCode(makeRoomCode())).toBe(true);
    expect(makeRoomCode(seededRng(3))).toBe(makeRoomCode(seededRng(3)));
  });

  it('skips codes it is told to avoid (a code the Worker said is taken) and survives a broken rng', () => {
    const first = makeRoomCode(seededRng(11));
    expect(makeRoomCode(seededRng(11), { avoid: [first] })).not.toBe(first);
    expect(makeRoomCode(() => 0)).toBe('AAAA');
    expect(makeRoomCode(() => 0, { avoid: ['AAAA'] })).toBe('CAKE'); // a stuck rng still gives a friendly room
  });

  it('crypto ints are in range and spread out', () => {
    const counts = new Array(CODE_ALPHABET.length).fill(0);
    for (let i = 0; i < 4600; i++) counts[cryptoRandomInt(CODE_ALPHABET.length)]++;
    expect(Math.min(...counts)).toBeGreaterThan(100);
  });

  it('parseRoomCode forgives case, spaces and dashes', () => {
    expect(parseRoomCode(' c a-k e ')).toBe('CAKE');
    expect(parseRoomCode('bun_s')).toBe('BUNS');
    expect(parseRoomCode('COOL')).toBe(null);
    expect(parseRoomCode('x'.repeat(40))).toBe(null);
    expect(parseRoomCode(undefined)).toBe(null);
  });
});

describe('deriveRoomIds', () => {
  const sha = (text) => createHash('sha256').update(text).digest();

  it('is three quick SHA-256s: topic, password and the Worker room id', async () => {
    const ids = await deriveRoomIds('CAKE', { subtle });
    expect(ids.code).toBe('CAKE');
    expect(ids.workerRoom).toBe(`r${sha('sprinkle-kart-room-v2|CAKE').toString('hex').slice(0, 24)}`);
    expect(ids.topic).toBe(`sk-${sha('sprinkle-kart-topic-v2|CAKE').toString('hex').slice(0, 20)}`);
    expect(ids.password).toBe(sha('sprinkle-kart-pw-v2|CAKE').toString('base64url'));
    expect(ids.topic).toMatch(/^sk-[0-9a-f]{20}$/);
    expect(ids.workerRoom).toMatch(/^r[0-9a-f]{24}$/);
  });

  it('gives the same Worker room id as the Worker itself (so it can list the room)', async () => {
    const rng = seededRng(5);
    for (let i = 0; i < 25; i++) {
      const code = makeRoomCode(rng);
      expect((await deriveRoomIds(code, { subtle })).workerRoom).toBe(await workerCodes.roomIdForCode(code));
    }
  });

  it('different codes give different ids; junk and missing crypto get a clear error', async () => {
    const a = await deriveRoomIds('CAKE', { subtle });
    const b = await deriveRoomIds('CAKF', { subtle });
    expect(a.topic).not.toBe(b.topic);
    expect(a.workerRoom).not.toBe(b.workerRoom);
    await expect(deriveRoomIds('cake', { subtle })).rejects.toThrow(/4-letter/);
    await expect(deriveRoomIds('CAKE', { subtle: null })).rejects.toThrow(/secure context/);
  });
});

describe('code entry (chunky letter grid)', () => {
  const run = (events, s = createCodeEntryState()) => {
    let r = { state: s };
    for (const ev of events) {
      r = codeEntryReduce(r.state, ev, { parseInvite: parseInviteCode });
      if (r.go) return r;
    }
    return r;
  };
  /** Controller presses that type `code` from the top-left key (the short way round, rows then columns). */
  const pressesFor = (code) => {
    const out = [];
    let cur = 0;
    for (const ch of code) {
      const to = CODE_KEYS.indexOf(ch);
      const dr = Math.floor(to / CODE_GRID_COLS) - Math.floor(cur / CODE_GRID_COLS);
      const dc = (to % CODE_GRID_COLS) - (cur % CODE_GRID_COLS);
      for (let i = 0; i < Math.abs(dr); i++) out.push({ action: dr > 0 ? 'down' : 'up' });
      for (let i = 0; i < Math.abs(dc); i++) out.push({ action: dc > 0 ? 'right' : 'left' });
      out.push({ action: 'confirm' });
      cur = to;
    }
    return out;
  };

  it('has every letter plus erase on a 6-wide grid', () => {
    expect(CODE_KEYS).toEqual([...CODE_ALPHABET, 'erase']);
    expect(CODE_KEYS.length % CODE_GRID_COLS).toBe(0);
  });

  it('controller only: the arrows move, A presses; the 4th letter joins at once (no extra press)', () => {
    const r = run(pressesFor('CAKE'));
    expect(r.go).toBe('join');
    expect(r.code).toBe('CAKE');
    expect(r.state.letters).toBe('CAKE');
    for (const code of ['ZZZZ', 'BUNS', 'TART', 'MEWP']) expect(run(pressesFor(code)).code).toBe(code);
  });

  it('the grid wraps left/right and up/down by rows', () => {
    const s = createCodeEntryState();
    expect(codeEntryReduce(s, { action: 'left' }).state.cursor).toBe(CODE_KEYS.length - 1);
    expect(codeEntryReduce(s, { action: 'down' }).state.cursor).toBe(CODE_GRID_COLS);
    expect(codeEntryReduce(s, { action: 'up' }).state.cursor).toBe(CODE_KEYS.length - CODE_GRID_COLS);
    const bottom = { ...s, cursor: CODE_KEYS.length - 2 };
    expect(codeEntryReduce(bottom, { action: 'down' }).state.cursor).toBe((CODE_KEYS.length - 2) % CODE_GRID_COLS);
  });

  it('B erases the last letter, and on an empty code leaves (go "back"); the erase key erases too', () => {
    const s = createCodeEntryState('CA');
    const b1 = codeEntryReduce(s, { action: 'back' });
    expect(b1.state.letters).toBe('C');
    expect(b1.go).toBe(null);
    const b2 = codeEntryReduce(codeEntryReduce(b1.state, { action: 'back' }).state, { action: 'back' });
    expect(b2.go).toBe('back');
    const erase = codeEntryReduce(createCodeEntryState('CAK'), { action: 'press', index: CODE_KEYS.indexOf('erase') });
    expect(erase.state.letters).toBe('CA');
    expect(codeEntryReduce(createCodeEntryState(), { action: 'erase' }).state.letters).toBe('');
  });

  it('keyboard: typing letters fills the code and joins on the 4th; I / O / Q wiggle; Backspace erases', () => {
    expect(run([{ action: 'type', text: 'c' }, { action: 'type', text: 'a' }, { action: 'type', text: 'k' }, { action: 'type', text: 'e' }])).toMatchObject({ go: 'join', code: 'CAKE' });
    const o = codeEntryReduce(createCodeEntryState('CA'), { action: 'type', text: 'o' });
    expect(o.shake).toBe(true);
    expect(o.state.letters).toBe('CA');
    expect(codeEntryReduce(createCodeEntryState('CA'), { action: 'erase' }).state.letters).toBe('C');
    expect(codeEntryReduce(createCodeEntryState(), { action: 'type', text: '12!' }).state.letters).toBe('');
    expect(codeEntryReduce(createCodeEntryState(), { action: 'type', text: 'buns' })).toMatchObject({ go: 'join', code: 'BUNS' });
  });

  it('mouse clicks press keys; pasting a code or an invite link joins; junk wiggles', () => {
    let s = createCodeEntryState();
    for (const ch of 'TAR') s = codeEntryReduce(s, { action: 'press', index: CODE_KEYS.indexOf(ch) }).state;
    expect(codeEntryReduce(s, { action: 'press', index: CODE_KEYS.indexOf('T') })).toMatchObject({ go: 'join', code: 'TART' });
    expect(codeEntryReduce(s, { action: 'press', index: 99 }).state).toBe(s);
    expect(codeEntryReduce(createCodeEntryState(), { action: 'paste', text: 'https://rillyboss.github.io/sprinkle-kart/?join=BUNS' }, { parseInvite: parseInviteCode })).toMatchObject({ go: 'join', code: 'BUNS' });
    expect(codeEntryReduce(createCodeEntryState(), { action: 'paste', text: ' cake ' })).toMatchObject({ go: 'join', code: 'CAKE' });
    expect(codeEntryReduce(createCodeEntryState(), { action: 'paste', text: 'hello there' }).shake).toBe(true);
  });

  it('Start joins with 4 letters; a prefill keeps only alphabet letters', () => {
    expect(codeEntryReduce(createCodeEntryState('CAKE'), { action: 'start' })).toMatchObject({ go: 'join', code: 'CAKE' });
    expect(createCodeEntryState('c0a1k-e!').letters).toBe('CAKE');
    expect(createCodeEntryState('ABCDEFG').letters).toBe('ABCD');
    expect(createCodeEntryState(null).letters).toBe('');
  });
});
