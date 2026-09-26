// Invite links (NETWORKING.md §10.1): `?join=CAKE` opens the game straight into that room.
import { describe, it, expect } from 'vitest';
import {
  makeInviteLink, parseInviteCode, startupInvite, createInviteMemory, INVITE_BASE_URL, inviteQrSvg, qrMatrixToSvg,
} from '../src/net/session/inviteLink.js';
import { readFileSync, readdirSync } from 'node:fs';
import { encode } from 'uqr';

const CODE = 'CAKE';

describe('invite links', () => {
  it('makes a ?join=CODE link on the page itself (its own query and hash dropped)', () => {
    expect(makeInviteLink(CODE)).toBe(`${INVITE_BASE_URL}?join=CAKE`);
    expect(INVITE_BASE_URL).toBe('https://rillyboss.github.io/sprinkle-kart/');
    expect(makeInviteLink(CODE, 'http://localhost:5173/?signal=public#x')).toBe('http://localhost:5173/?join=CAKE');
    expect(() => makeInviteLink('COOL')).toThrow(RangeError); // O is not in the code alphabet
    expect(() => makeInviteLink(null)).toThrow(RangeError);
  });

  it('parses whole links, ?join=, #join= and bare join= forgivingly', () => {
    expect(parseInviteCode(makeInviteLink(CODE))).toBe('CAKE');
    expect(parseInviteCode('https://rillyboss.github.io/sprinkle-kart/?signal=public&join=cake')).toBe('CAKE');
    expect(parseInviteCode('?join= c a k e'.replace(/ /g, ''))).toBe('CAKE');
    expect(parseInviteCode('#join=BUNS')).toBe('BUNS');
    expect(parseInviteCode('join=%42UNS')).toBe('BUNS');
    expect(parseInviteCode('Come race! https://rillyboss.github.io/sprinkle-kart/?join=TART')).toBe('TART');
  });

  it('rejects junk (wrong length, letters outside the alphabet, bad encoding, no join)', () => {
    for (const bad of ['?join=CAK', '?join=CAKES', '?join=COOL', '?join=1234', '?join=%E0%A4%A', 'CAKE', '', null, 42, `?join=${'A'.repeat(500)}`]) {
      expect(parseInviteCode(bad), String(bad)).toBe(null);
    }
  });
});

describe('start-up handling (main.js reads the address once)', () => {
  it('online on: auto-join that room, and remove join from the address bar (other params kept)', () => {
    const r = startupInvite({ search: '?join=CAKE&signal=public', pathname: '/sprinkle-kart/', onlineOn: true });
    expect(r.code).toBe('CAKE');
    expect(r.join).toBe(true);
    expect(r.screen).toBe(null);
    expect(r.effects).toEqual([{ type: 'replaceState', url: '/sprinkle-kart/?signal=public' }]);
    expect(startupInvite({ search: '?join=BUNS', pathname: '/x/' }).effects).toEqual([{ type: 'replaceState', url: '/x/' }]);
  });

  it('online turned off by a grown-up: the "online play is off" screen, never a join', () => {
    const r = startupInvite({ search: '?join=CAKE', pathname: '/', onlineOn: false });
    expect(r.join).toBe(false);
    expect(r.screen).toBe('invite-gate');
    expect(r.params).toEqual({ returnTo: 'title', code: 'CAKE' });
    expect(r.effects).toHaveLength(1);
  });

  it('an old #join= link still works; a junk join is removed too; other addresses are left alone', () => {
    expect(startupInvite({ hash: '#join=TART', search: '', pathname: '/' })).toMatchObject({ code: 'TART', join: true });
    const junk = startupInvite({ search: '?join=nope', pathname: '/' });
    expect(junk).toMatchObject({ code: null, join: false, screen: null });
    expect(junk.effects).toEqual([{ type: 'replaceState', url: '/' }]);
    expect(startupInvite({ search: '?signal=public', hash: '#top', pathname: '/' })).toEqual({ code: null, join: false, screen: null, params: {}, effects: [] });
    // an old secret-sweets link: nothing to join, but it is cleared
    expect(startupInvite({ hash: '#join=SPRINKLE-4821~ABC-_z', pathname: '/' })).toMatchObject({ code: null, join: false });
  });

  it('the invite is kept in memory only and offered once', () => {
    const m = createInviteMemory();
    expect(m.peek()).toBe(null);
    m.remember('CAKE');
    expect(m.peek()).toBe('CAKE');
    expect(m.take()).toBe('CAKE');
    expect(m.take()).toBe(null);
    m.remember('junk!');
    expect(m.peek()).toBe(null);
  });
});

describe('invite QR code (lazy, pinned zero-dependency encoder)', () => {
  it('encodes the invite link; the three finder patterns are where a phone camera looks for them', async () => {
    const link = makeInviteLink(CODE);
    const svg = await inviteQrSvg(link);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg).toContain('aria-label="Invite QR code"');
    const { data, size } = encode(link, { ecc: 'M', border: 0 });
    expect(data).toHaveLength(size);
    for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let k = 0; k < 7; k++) {
        expect(data[y][x + k]).toBe(true); // top edge of the 7×7 finder square
        expect(data[y + 6][x + k]).toBe(true); // bottom edge
      }
      expect(data[y + 3][x + 3]).toBe(true); // its centre
      expect(data[y + 1][x + 1]).toBe(false); // the white ring
    }
    // the SVG draws exactly the dark modules
    const dark = data.flat().filter(Boolean).length;
    expect((svg.match(/h1v1h-1z/g) || []).length).toBe(dark);
  });

  it('qrMatrixToSvg adds a quiet zone and uses the given colours', () => {
    const svg = qrMatrixToSvg([[true, false], [false, true]], { dark: '#000', light: '#fff', quiet: 1 });
    expect(svg).toContain('viewBox="0 0 4 4"');
    expect(svg).toContain('M1 1h1v1h-1z');
    expect(svg).toContain('M2 2h1v1h-1z');
    expect(svg).toContain('fill="#000"');
  });

  it('is only ever loaded with a dynamic import() (its own small chunk), and the version is pinned', () => {
    const files = [];
    const walk = (dir) => { for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) { if (e.isDirectory()) walk(`${dir}${e.name}/`); else if (e.name.endsWith('.js')) files.push(`${dir}${e.name}`); } };
    walk('../src/');
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/^\s*import\s[^;]*from\s+['"]uqr['"]/m);
    }
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies.uqr).toBe('0.1.3');
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    expect(lock.packages['node_modules/uqr'].version).toBe('0.1.3');
    expect(lock.packages['node_modules/uqr'].dependencies ?? {}).toEqual({});
  });
});