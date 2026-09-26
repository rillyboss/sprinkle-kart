// Invite links + room codes (NETWORKING.md §4.2, §10.1; acceptance M1 #2).
import { describe, it, expect } from 'vitest';
import {
  makeInviteLink, parseInviteFragment, startupInvite, createInviteMemory, encodeSweets, decodeSweets, B64URL, INVITE_BASE_URL,
} from '../src/net/session/inviteLink.js';
import {
  makeRoomSecret, parseRoomCode, ROOM_WORDS, SECRET_SWEETS, isRoomSecret, splitLabel, formatLabel, sweetsText, cryptoRandomInt,
} from '../src/net/session/roomCode.js';
import { MATCH_ANIMALS } from '../src/net/session/approval.js';
import { seededRng } from '../src/net/session/composeSetup.js';

const SECRET = { label: 'SPRINKLE-4821', sweets: [0, 1, 2, 62, 63, 26] };

describe('room words and secret sweets', () => {
  it('32 unique cute words, 64 unique sweets, and no sweet is a match-check animal', () => {
    expect(ROOM_WORDS).toHaveLength(32);
    expect(new Set(ROOM_WORDS).size).toBe(32);
    for (const w of ROOM_WORDS) expect(w).toMatch(/^[A-Z]{3,10}$/);
    expect(SECRET_SWEETS).toHaveLength(64);
    expect(new Set(SECRET_SWEETS).size).toBe(64);
    for (const s of SECRET_SWEETS) expect(MATCH_ANIMALS).not.toContain(s);
    expect(B64URL).toHaveLength(64);
    expect(new Set(B64URL).size).toBe(64);
  });

  it('makeRoomSecret draws a label + 6 sweets (seeded rng and crypto)', () => {
    const a = makeRoomSecret(seededRng(7));
    const b = makeRoomSecret(seededRng(7));
    expect(a).toEqual(b);
    expect(isRoomSecret(a)).toBe(true);
    expect(a.label).toMatch(/^[A-Z]+-\d{4}$/);
    const c = makeRoomSecret();
    expect(isRoomSecret(c)).toBe(true);
    const labels = new Set(Array.from({ length: 50 }, () => makeRoomSecret().label + makeRoomSecret().sweets.join()));
    expect(labels.size).toBeGreaterThan(45);
  });

  it('crypto ints are in range and spread out', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) { const v = cryptoRandomInt(10); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(10); seen.add(v); }
    expect(seen.size).toBe(10);
  });

  it('parseRoomCode is forgiving of case / spaces / separators and strict on words', () => {
    expect(parseRoomCode('SPRINKLE-4821')).toBe('SPRINKLE-4821');
    expect(parseRoomCode(' sprinkle 4821 ')).toBe('SPRINKLE-4821');
    expect(parseRoomCode('Sprinkle4821')).toBe('SPRINKLE-4821');
    expect(parseRoomCode('sprinkle_4 8 2 1')).toBe('SPRINKLE-4821');
    expect(parseRoomCode('NOTAWORD-4821')).toBe(null);
    expect(parseRoomCode('SPRINKLE-482')).toBe(null);
    expect(parseRoomCode('SPRINKLE-48210')).toBe(null);
    expect(parseRoomCode('')).toBe(null);
    expect(parseRoomCode(42)).toBe(null);
    expect(parseRoomCode('x'.repeat(100))).toBe(null);
    expect(splitLabel('cupcake-0007')).toEqual({ wordIndex: 1, digits: [0, 0, 0, 7] });
    expect(formatLabel(0, [4, 8, 2, 1])).toBe('SPRINKLE-4821');
    expect(sweetsText([0, 1])).toBe('🍩🦄');
  });
});

describe('invite links', () => {
  it('makes the documented #join= fragment link (one base64url char per sweet)', () => {
    const link = makeInviteLink(SECRET);
    expect(link).toBe(`${INVITE_BASE_URL}#join=SPRINKLE-4821~ABC-_a`);
    expect(link.startsWith('https://rillyboss.github.io/sprinkle-kart/#join=')).toBe(true);
    expect(link).not.toContain('?'); // never a query string: fragments are not sent to servers
    expect(makeInviteLink(SECRET, 'http://localhost:5173/?x=1#old')).toBe('http://localhost:5173/?x=1#join=SPRINKLE-4821~ABC-_a');
    expect(() => makeInviteLink({ label: 'SPRINKLE-4821', sweets: [1, 2] })).toThrow();
    expect(() => encodeSweets([0, 0, 0, 0, 0, 64])).toThrow();
  });

  it('round-trips every sweet index and random secrets', () => {
    expect(decodeSweets(encodeSweets([0, 10, 20, 30, 40, 63]))).toEqual([0, 10, 20, 30, 40, 63]);
    const rng = seededRng(3);
    for (let i = 0; i < 200; i++) {
      const s = makeRoomSecret(rng);
      expect(parseInviteFragment(new URL(makeInviteLink(s)).hash)).toEqual(s);
    }
  });

  it('parses fragments forgivingly (case / spaces in the label, full URLs, %-encoding)', () => {
    expect(parseInviteFragment('#join=SPRINKLE-4821~ABC-_a')).toEqual(SECRET);
    expect(parseInviteFragment('join=sprinkle-4821~ABC-_a')).toEqual(SECRET);
    expect(parseInviteFragment('#join= sprinkle 4821 ~ABC-_a')).toEqual(SECRET);
    expect(parseInviteFragment('https://rillyboss.github.io/sprinkle-kart/#join=SPRINKLE-4821~ABC-_a')).toEqual(SECRET);
    expect(parseInviteFragment('#join=SPRINKLE-4821%7EABC-_a')).toEqual(SECRET);
    expect(parseInviteFragment('#JOIN=SPRINKLE-4821~ABC-_a')).toEqual(SECRET);
  });

  it('rejects junk (strict alphabet, exact length, real words)', () => {
    for (const junk of [
      '', '#', '#join=', '#join=SPRINKLE-4821', '#join=SPRINKLE-4821~ABC', '#join=SPRINKLE-4821~ABC-_aa',
      '#join=SPRINKLE-4821~ABC+/a', '#join=SPRINKLE-4821~ABC=_a', '#join=NOPE-4821~ABC-_a', '#join=SPRINKLE-48~ABC-_a',
      '#join=SPRINKLE-4821~ABC-_a~x', '#play=SPRINKLE-4821~ABC-_a', '#join=%E0%A4%A', `#join=${'A'.repeat(400)}`,
      '#join=<script>~ABCDEF', null, undefined, 12,
    ]) expect(parseInviteFragment(junk), String(junk)).toBe(null);
    // sweets are case-SENSITIVE (base64url): 'abc-_a' is a different secret, not the same one
    expect(parseInviteFragment('#join=SPRINKLE-4821~abc-_a')).not.toEqual(SECRET);
  });
});

describe('start-up handling (main.js reads the hash once, WS7 wires it)', () => {
  it('online on: opens the Online hub with the invite and clears the fragment (replaceState effect)', () => {
    const r = startupInvite({ hash: '#join=SPRINKLE-4821~ABC-_a', pathname: '/sprinkle-kart/', search: '?x=1', onlineEnabled: true });
    expect(r.secret).toEqual(SECRET);
    expect(r.screen).toBe('online-hub');
    expect(r.params).toEqual({ invite: SECRET });
    expect(r.effects).toEqual([{ type: 'replaceState', url: '/sprinkle-kart/?x=1' }]);
  });

  it('online off: the "ask a grown-up" screen, never the hub (the gate is respected), fragment still cleared', () => {
    const r = startupInvite({ hash: '#join=SPRINKLE-4821~ABC-_a', pathname: '/sprinkle-kart/', onlineEnabled: false });
    expect(r.screen).toBe('invite-gate');
    expect(r.params.invite).toBeUndefined();
    expect(r.effects).toEqual([{ type: 'replaceState', url: '/sprinkle-kart/' }]);
  });

  it('a junk join fragment is cleared too, and ordinary hashes are left alone', () => {
    const junk = startupInvite({ hash: '#join=oops', pathname: '/', onlineEnabled: true });
    expect(junk.secret).toBe(null);
    expect(junk.screen).toBe(null);
    expect(junk.effects).toHaveLength(1);
    const plain = startupInvite({ hash: '#section', pathname: '/', onlineEnabled: true });
    expect(plain).toEqual({ secret: null, screen: null, params: {}, effects: [] });
    expect(startupInvite()).toEqual({ secret: null, screen: null, params: {}, effects: [] });
  });

  it('the invite is kept in memory only and offered once', () => {
    const mem = createInviteMemory();
    mem.remember(SECRET);
    expect(mem.peek()).toEqual(SECRET);
    expect(mem.take()).toEqual(SECRET);
    expect(mem.take()).toBe(null);
    mem.remember({ label: 'bad' });
    expect(mem.peek()).toBe(null);
  });
});
