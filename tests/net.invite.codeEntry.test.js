// codeEntryReduce: word wheel + 4 digit wheels + 8 × 8 sweets grid, controller / keyboard / mouse (NETWORKING.md §10.1).
import { describe, it, expect } from 'vitest';
import {
  createCodeEntryState, codeEntryReduce, entrySecret, entryLabel, ROOM_WORDS, SECRET_SWEETS, SWEETS_COUNT,
} from '../src/net/session/roomCode.js';
import { parseInviteFragment } from '../src/net/session/inviteLink.js';

const ev = (action, extra = {}) => ({ deviceId: 'pad0', action, ...extra });
const run = (s, evs) => evs.reduce((st, e) => codeEntryReduce(st, typeof e === 'string' ? ev(e) : e, { parseInvite: parseInviteFragment }).state, s);

describe('code entry with only a controller', () => {
  it('spins the word and digit wheels (wrapping) and moves between them', () => {
    let s = createCodeEntryState();
    expect(entryLabel(s)).toBe('SPRINKLE-0000');
    s = run(s, ['down']); // word wheel wraps backwards
    expect(ROOM_WORDS[s.wordIndex]).toBe(ROOM_WORDS.at(-1));
    s = run(s, ['up', 'up']);
    expect(ROOM_WORDS[s.wordIndex]).toBe('CUPCAKE');
    s = run(s, ['right', 'down']); // digit 1 wraps 0 → 9
    expect(s.digits).toEqual([9, 0, 0, 0]);
    s = run(s, ['left', 'left']); // wraps from the word to the last digit
    expect(s.col).toBe(4);
    s = run(s, ['up', 'up', 'up']);
    expect(entryLabel(s)).toBe('CUPCAKE-9003');
  });

  it('A walks the wheels then enters the grid; the grid moves by rows; up from the top row goes back', () => {
    let s = run(createCodeEntryState(), ['confirm', 'confirm', 'confirm', 'confirm']);
    expect(s).toMatchObject({ focus: 'label', col: 4 });
    s = run(s, ['confirm']);
    expect(s.focus).toBe('sweets');
    s = run(s, ['down', 'down', 'right']);
    expect(s.cursor).toBe(17);
    s = run(s, ['up', 'up', 'up']);
    expect(s.focus).toBe('label');
    s = run(s, ['start']);
    expect(s.focus).toBe('sweets');
    s = run(s, ['left']); // the cursor stayed on sweet 1 while we visited the wheels
    expect(s.cursor).toBe(0);
  });

  it('6 picks in order → Join (go "join" with the secret); B undoes one sweet at a time', () => {
    let s = run(createCodeEntryState(), ['start']);
    for (let k = 0; k < 5; k++) s = run(s, ['confirm', 'right']);
    expect(s.picks).toEqual([0, 1, 2, 3, 4]);
    expect(entrySecret(s)).toBe(null);
    s = run(s, ['back']);
    expect(s.picks).toEqual([0, 1, 2, 3]);
    s = run(s, ['right', 'confirm', 'right', 'confirm']);
    expect(s.picks).toHaveLength(SWEETS_COUNT);
    expect(s.focus).toBe('go');
    const r = codeEntryReduce(s, ev('confirm'));
    expect(r.go).toBe('join');
    expect(r.secret).toEqual({ label: 'SPRINKLE-0000', sweets: s.picks });
    // B on Join takes the last sweet back
    const b = codeEntryReduce(s, ev('back'));
    expect(b.state.picks).toHaveLength(5);
    expect(b.state.focus).toBe('sweets');
    // the same sweet may be picked twice (6 picks from 64, repeats allowed)
    let d = run(createCodeEntryState(), ['start', 'confirm', 'confirm']);
    expect(d.picks).toEqual([0, 0]);
    d = run(d, ['confirm', 'confirm', 'confirm', 'confirm']);
    expect(codeEntryReduce(d, ev('confirm')).state.focus).toBe('go');
  });

  it('B steps back through the wheels and finally leaves (go "back")', () => {
    let s = run(createCodeEntryState(), ['right', 'right']);
    let r = codeEntryReduce(s, ev('back'));
    expect(r.state.col).toBe(1);
    r = codeEntryReduce(r.state, ev('back'));
    expect(r.state.col).toBe(0);
    r = codeEntryReduce(r.state, ev('back'));
    expect(r.go).toBe('back');
    s = run(createCodeEntryState(), ['start']);
    expect(codeEntryReduce(s, ev('back')).state.focus).toBe('label'); // empty grid → back to the wheels
  });

  it('Join without 6 sweets nudges back to the grid', () => {
    const s = { ...createCodeEntryState(), focus: 'go', picks: [1, 2] };
    const r = codeEntryReduce(s, ev('confirm'));
    expect(r.go).toBe(null);
    expect(r.shake).toBe(true);
    expect(r.state.focus).toBe('sweets');
    expect(codeEntryReduce(createCodeEntryState(), ev('focus', { focus: 'go' })).state.focus).toBe('label');
  });
});

describe('code entry with a keyboard / mouse', () => {
  it('letters search the word list, digits fill the wheels, Backspace erases', () => {
    let s = run(createCodeEntryState(), [{ action: 'type', text: 'moon' }]);
    expect(ROOM_WORDS[s.wordIndex]).toBe('MOONBEAM');
    s = run(s, [{ action: 'type', text: 'x' }]); // no word starts with X: nothing changes
    expect(ROOM_WORDS[s.wordIndex]).toBe('MOONBEAM');
    s = run(s, [{ action: 'type', text: 'p' }]); // "MOONP" matches nothing → a fresh search for P
    expect(ROOM_WORDS[s.wordIndex]).toBe('PUDDING');
    s = run(s, [{ action: 'type', text: 'pi' }]); // "PUDDINGPI"? no → "P" then "PI"
    expect(ROOM_WORDS[s.wordIndex]).toMatch(/^PI/);
    s = run(s, [{ action: 'type', text: '4821' }]);
    expect(entryLabel(s)).toMatch(/-4821$/);
    expect(s.focus).toBe('sweets');
    s = run(s, [{ action: 'pick', index: 63 }, { action: 'pick', index: 2 }]);
    expect(s.picks).toEqual([63, 2]);
    s = run(s, [{ action: 'erase' }]);
    expect(s.picks).toEqual([63]);
    s = run(s, [{ action: 'unpick', index: 0 }]);
    expect(s.picks).toEqual([]);
  });

  it('pasting a code fills the wheels; pasting an invite link fills everything; junk shakes', () => {
    let r = codeEntryReduce(createCodeEntryState(), ev('paste', { text: 'bunny 0707' }), { parseInvite: parseInviteFragment });
    expect(entryLabel(r.state)).toBe('BUNNY-0707');
    expect(r.state.focus).toBe('sweets');
    r = codeEntryReduce(createCodeEntryState(), ev('paste', { text: 'https://rillyboss.github.io/sprinkle-kart/#join=SPRINKLE-4821~ABC-_a' }), { parseInvite: parseInviteFragment });
    expect(entrySecret(r.state)).toEqual({ label: 'SPRINKLE-4821', sweets: [0, 1, 2, 62, 63, 26] });
    expect(r.state.focus).toBe('go');
    r = codeEntryReduce(createCodeEntryState(), ev('paste', { text: 'hello friend' }), { parseInvite: parseInviteFragment });
    expect(r.shake).toBe(true);
  });

  it('mouse: set a wheel, pick / unpick sweets; bad input is ignored', () => {
    let s = run(createCodeEntryState(), [{ action: 'set', key: 'word', value: 33 }, { action: 'set', key: 'digit', col: 2, value: 12 }]);
    expect(entryLabel(s)).toBe('CUPCAKE-0200');
    s = run(s, [{ action: 'set', key: 'digit', col: 9, value: 1 }, { action: 'pick', index: 64 }, { action: 'pick', index: -1 }, { action: 'unpick', index: 3 }]);
    expect(entryLabel(s)).toBe('CUPCAKE-0200');
    expect(s.picks).toEqual([]);
    expect(SECRET_SWEETS).toHaveLength(64);
  });

  it('prefill from a secret or a label', () => {
    expect(entrySecret(createCodeEntryState({ label: 'SPRINKLE-4821', sweets: [1, 2, 3, 4, 5, 6] }))).toEqual({ label: 'SPRINKLE-4821', sweets: [1, 2, 3, 4, 5, 6] });
    expect(entryLabel(createCodeEntryState({ label: 'nonsense' }))).toBe('SPRINKLE-0000');
    expect(createCodeEntryState({ sweets: [1, 99, 2] }).picks).toEqual([1, 2]);
  });
});
