// The player/parent docs stay in step with the game: every racer, track, cup, mode and arena is
// in the README (with its unlock), and package.json matches the newest CHANGELOG entry.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { LINEUP_CHARACTERS, LINEUP_TRACKS, LINEUP_CUPS } from '../src/content/lineup.js';
import { MODE_CARDS } from '../src/modes/menus.js';
import { PAINTS } from '../src/modes/paint.js';
import { GOALS } from '../src/progress/goals.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const readme = read('README.md');
const changelog = read('CHANGELOG.md');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

/** The README table row that starts with the bold name, or null. */
const rowFor = (name) => readme.split('\n').find((l) => l.startsWith(`| **${name}**`)) ?? null;
/** The README section (### heading → next heading) containing the given heading text. */
const section = (heading) => {
  const start = readme.indexOf(heading);
  if (start < 0) return '';
  const rest = readme.slice(start + heading.length);
  const next = rest.search(/\n##/);
  return next < 0 ? rest : rest.slice(0, next);
};
const DESCRIBE_UNLOCK = {
  'stat:wins': (n) => (n === 1 ? /Win (1|any) race/ : new RegExp(`Win ${n} races`)),
  'stat:racesFinished': (n) => new RegExp(`Finish ${n} races?`),
};

describe('README: racers', () => {
  it('lists all 21 racers, each exactly once in a table', () => {
    expect(LINEUP_CHARACTERS).toHaveLength(21);
    for (const c of LINEUP_CHARACTERS) {
      expect(rowFor(c.name), c.name).not.toBe(null);
      expect(readme.split('\n').filter((l) => l.startsWith(`| **${c.name}**`)), c.name).toHaveLength(1);
    }
  });

  it('every racer row says how to unlock it (starters say "Ready to race")', () => {
    for (const c of LINEUP_CHARACTERS) {
      const cells = rowFor(c.name).split('|').map((s) => s.trim()).filter(Boolean);
      expect(cells.length, c.name).toBe(3);
      const how = cells[2];
      if (c.unlock === null) expect(how, c.name).toBe('Ready to race');
      else {
        expect(how, c.name).not.toBe('Ready to race');
        const rx = DESCRIBE_UNLOCK[`${c.unlock.type}:${c.unlock.stat}`]?.(c.unlock.count);
        if (rx) expect(how, c.name).toMatch(rx);
        if (c.unlock.type === 'track') expect(how, c.name).toContain(LINEUP_TRACKS.find((t) => t.id === c.unlock.trackId).name);
      }
    }
  });
});

describe('README: tracks and cups', () => {
  it('lists all 20 tracks under their own cup heading, with an unlock column', () => {
    expect(LINEUP_TRACKS).toHaveLength(20);
    for (const cup of LINEUP_CUPS) {
      const body = section(`### ${cup.emoji} ${cup.name}`);
      expect(body, cup.name).not.toBe('');
      for (const id of cup.trackIds) {
        const t = LINEUP_TRACKS.find((x) => x.id === id);
        const row = body.split('\n').find((l) => l.startsWith(`| **${t.name}**`));
        expect(row, `${t.name} in ${cup.name}`).toBeTruthy();
        const how = row.split('|').map((s) => s.trim()).filter(Boolean).at(-1);
        if (t.unlock === null) expect(how, t.name).toBe('Ready to race');
        else {
          expect(how, t.name).not.toBe('Ready to race');
          const rx = DESCRIBE_UNLOCK[`${t.unlock.type}:${t.unlock.stat}`]?.(t.unlock.count);
          if (rx) expect(how, t.name).toMatch(rx);
          if (t.unlock.type === 'cup-track') expect(how, t.name).toContain(LINEUP_CUPS.find((c) => c.id === t.unlock.cupId).name);
        }
      }
    }
  });

  it('names every cup and both battle arenas', () => {
    for (const cup of LINEUP_CUPS) expect(readme).toContain(cup.name);
    for (const arena of ['Bubble Bath Bowl', 'Gumball Garden']) expect(readme).toContain(arena);
  });
});

describe('README: modes, toys and grown-up features', () => {
  it('covers every mode card and the extra ways to play', () => {
    for (const m of MODE_CARDS) expect(readme, m.name).toContain(`**${m.name} ${m.emoji}**`);
    for (const x of ['Daily Sprinkle', 'My Cup', 'How to Play', 'Records']) expect(readme).toContain(x);
  });

  it('has player/parent sections for controls, Kid-Assist, Effects, Paint Shop, Sticker Book and the parent gate', () => {
    for (const h of ['## Controls', '## Kid-Assist', '## Effects & comfort', '## Paint Shop', 'Sticker Book', 'parent gate', 'Fun Goals']) {
      expect(readme, h).toContain(h);
    }
  });

  it('Paint Shop count matches the paint pots', () => {
    const colours = PAINTS.filter((p) => p.id !== PAINTS[0].id).length;
    expect(readme).toContain(`${colours} paints`);
    expect(changelog).toContain(`${colours} paints`);
  });

  it('Fun Goals count in the changelog matches the goals list', () => {
    expect(changelog).toContain(`${GOALS.length} achievement stickers`);
  });

  it('links the online-play infra guide as coming soon, and the guide exists', () => {
    expect(readme).toMatch(/\[docs\/INFRA_SETUP\.md\]\(docs\/INFRA_SETUP\.md\)[^\n]*coming soon: online play/i);
    expect(existsSync(new URL('../docs/INFRA_SETUP.md', import.meta.url))).toBe(true);
  });

  it('in-page contents links point at real headings (GitHub slug rules)', () => {
    const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const slugs = new Set(readme.split('\n').filter((l) => /^#{1,4} /.test(l)).map((l) => slug(l.replace(/^#+ /, ''))));
    const links = [...readme.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(10);
    for (const l of links) expect(slugs.has(l), l).toBe(true);
  });
});

describe('version and changelog', () => {
  it('package.json (and the lockfile) carry the newest CHANGELOG version', () => {
    const newest = /^## v(\d+\.\d+\.\d+)/m.exec(changelog)?.[1];
    expect(newest).toBe('2.0.0');
    expect(pkg.version).toBe(newest);
    expect(lock.version).toBe(newest);
    expect(lock.packages[''].version).toBe(newest);
  });

  it('the changelog has v2.0.0 above v1.0.0, and v2 lists every new racer and track', () => {
    const v2 = changelog.indexOf('## v2.0.0');
    const v1 = changelog.indexOf('## v1.0.0');
    expect(v2).toBeGreaterThan(-1);
    expect(v1).toBeGreaterThan(v2);
    const v2Text = changelog.slice(v2, v1);
    for (const c of LINEUP_CHARACTERS.filter((x) => x.pack !== 'original')) expect(v2Text, c.name).toContain(c.name);
    for (const t of LINEUP_TRACKS.filter((x) => x.cup !== 'sprinkle-cup')) expect(v2Text, t.name).toContain(t.name);
    const v1Text = changelog.slice(v1);
    for (const c of LINEUP_CHARACTERS.filter((x) => x.pack === 'original')) expect(v1Text, c.name).toContain(c.name);
  });
});
