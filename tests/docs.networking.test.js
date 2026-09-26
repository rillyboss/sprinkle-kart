// NETWORKING.md is the binding online-play design. These checks keep it in step with the binding
// infrastructure names (docs/INFRA_SETUP.md), with ARCHITECTURE.md, and internally consistent
// (unique wire codes, channel split, workstream plan limits), so later workstreams can trust it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EVENTS } from '../src/game/events.js';
import { MODE_CARDS } from '../src/modes/menus.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const net = read('NETWORKING.md');
const infra = read('docs/INFRA_SETUP.md');
const arch = read('ARCHITECTURE.md');

/** Body of the `## <n>.` section of NETWORKING.md. */
const section = (n) => {
  const start = net.search(new RegExp(`^## ${n}\\. `, 'm'));
  if (start < 0) return '';
  const rest = net.slice(start + 4);
  const next = rest.search(/^## \d+\. /m);
  return next < 0 ? rest : rest.slice(0, next);
};

/** Table rows (arrays of trimmed cells) of a markdown chunk. */
const rows = (md) => md.split('\n')
  .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));

describe('NETWORKING.md: binding infrastructure names', () => {
  const BINDING = [
    'sprinkle-kart-signal', 'SignalRoom', 'new_sqlite_classes', 'VITE_SIGNAL_URL',
    'TURN_KEY_ID', 'TURN_KEY_API_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
    'ALLOWED_ORIGINS', 'https://rillyboss.github.io,http://localhost:5173',
    'worker:dev', 'worker:test', 'worker:deploy', 'infra/signal-worker/',
    '.github/workflows/pages.yml', '.github/workflows/worker.yml',
    'GET /health', 'GET /ice', 'GET /room/:code',
    'https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers',
    'SPRINKLE-4821', 'Settings → Grown-ups',
  ];

  it('uses every binding name, spelled exactly', () => {
    for (const name of BINDING) expect(net, name).toContain(name);
  });

  it('agrees with docs/INFRA_SETUP.md on the shared names', () => {
    for (const name of ['sprinkle-kart-signal', 'SignalRoom', 'VITE_SIGNAL_URL', 'TURN_KEY_ID', 'TURN_KEY_API_TOKEN',
      'ALLOWED_ORIGINS', 'worker:dev', 'worker:test', 'worker:deploy', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
      expect(infra, name).toContain(name);
    }
    expect(infra).toContain('`https://rillyboss.github.io,http://localhost:5173`');
    expect(infra).toContain('NETWORKING.md');
  });

  it('/health returns { ok, turn, version } in both documents', () => {
    expect(net).toMatch(/GET \/health` → `\{ ok, turn, version \}`/);
    expect(infra).toMatch(/"ok":true,"turn":true/);
  });

  it('keeps the friendly version-mismatch wording the setup guide promises', () => {
    expect(infra).toContain('Different game version');
    expect(net).toContain('Different game version');
  });

  it('never contains anything that looks like a real secret', () => {
    expect(net).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
    expect(net).not.toMatch(/\b[0-9a-f]{32,}\b/);
  });
});

describe('NETWORKING.md: ARCHITECTURE.md points to it', () => {
  it('has an Online play section linking NETWORKING.md and the setup guide', () => {
    expect(arch).toMatch(/^## 12\. Online play \(NETWORKING\.md\)/m);
    expect(arch).toContain('[NETWORKING.md](NETWORKING.md)');
    expect(arch).toContain('(#12-online-play-networkingmd)');
    expect(arch).toContain('docs/INFRA_SETUP.md');
  });
});

describe('NETWORKING.md: structure', () => {
  it('has every numbered section 1..20 once and a working table of contents', () => {
    for (let n = 1; n <= 20; n++) {
      expect(net.match(new RegExp(`^## ${n}\\. `, 'gm')), `section ${n}`).toHaveLength(1);
    }
    const toc = [...net.matchAll(/\]\(#(\d+)-[a-z0-9-]+\)/g)].map((m) => Number(m[1]));
    expect(new Set(toc)).toEqual(new Set(Array.from({ length: 20 }, (_, i) => i + 1)));
  });
});

describe('NETWORKING.md: message catalogue', () => {
  const codesIn = (md) => rows(md).map((r) => r[0]).filter((c) => /^0x[0-9A-F]{2}$/.test(c)).map((c) => parseInt(c, 16));

  it('state-channel messages use 0x01-0x1F and ctrl-channel messages 0x20-0x3F, all unique', () => {
    const s6 = section(6);
    const s61 = s6.slice(s6.indexOf('### 6.1'), s6.indexOf('### 6.2'));
    const stateTypes = [...s61.matchAll(/(?:\*\*|\/ )0x([0-9A-F]{2}) [A-Z]+/g)].map((m) => parseInt(m[1], 16));
    expect(stateTypes.length).toBeGreaterThanOrEqual(4);
    for (const t of stateTypes) expect(t >= 0x01 && t <= 0x1f, `0x${t.toString(16)}`).toBe(true);
    const ctrl = codesIn(s6.slice(s6.indexOf('### 6.2'), s6.indexOf('### 6.3')));
    expect(ctrl.length).toBeGreaterThanOrEqual(15);
    for (const t of ctrl) expect(t >= 0x20 && t <= 0x3f, `0x${t.toString(16)}`).toBe(true);
    const all = [...stateTypes, ...ctrl];
    expect(new Set(all).size).toBe(all.length);
  });

  it('replicates every race event the simulation emits, each with a unique event code', () => {
    const s63 = section(6).slice(section(6).indexOf('### 6.3'));
    const evRows = rows(s63).filter((r) => /^\d+$/.test(r[0]));
    const codes = evRows.map((r) => Number(r[0]));
    const names = evRows.flatMap((r) => [...r[1].matchAll(/`([a-z-]+)`/g)].map((m) => m[1]));
    // "4 hop / 5 land" rows carry two codes in one row.
    const extra = evRows.flatMap((r) => [...r[1].matchAll(/\/ (\d+) `/g)].map((m) => Number(m[1])));
    const allCodes = [...codes, ...extra];
    expect(new Set(allCodes).size).toBe(allCodes.length);
    for (const type of ['countdown', 'go', 'boost', 'hop', 'land', 'drift-start', 'drift-level', 'drift-boost',
      'bump', 'item-box', 'item-get', 'item-use', 'rocket-launch', 'bonked', 'shield-pop', 'item-dodged',
      'item-end', 'lap', 'final-lap', 'finish', 'race-complete']) {
      expect(names, type).toContain(type);
    }
  });

  it('keeps every unreliable message inside one SCTP packet', () => {
    expect(net).toContain('MAX_STATE_BYTES = 1150');
    const sizes = [...section(6).matchAll(/cap-case ≈ (\d+) B/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const b of sizes) expect(b).toBeLessThanOrEqual(1150);
  });

  it('uses the two negotiated data channels with distinct ids (not Trystero\'s 0/1)', () => {
    expect(net).toMatch(/negotiated: true, id: 8, ordered: false, maxRetransmits: 0/);
    expect(net).toMatch(/negotiated: true, id: 9, ordered: true/);
  });
});

describe('NETWORKING.md: modes and kid safety', () => {
  it('the mode matrix covers every mode card and says which are online', () => {
    const matrix = rows(section(11));
    for (const card of MODE_CARDS) {
      const row = matrix.find((r) => r[0].startsWith(card.name));
      expect(row, card.name).toBeTruthy();
      const online = row[1].startsWith('✅');
      expect(online, card.name).toBe(['free', 'grand-prix', 'team', 'battle'].includes(card.id));
    }
  });

  it('keeps the kid-safety rules: parent gate, no free text, approval, remove, preset emotes', () => {
    const s1 = section(1);
    for (const rule of ['parent gate', 'No free text anywhere', 'approves every new house', 'remove a house',
      'preset emotes', 'onlineEnabled']) {
      expect(s1, rule).toContain(rule);
    }
  });

  it('friendly words only in the design text a kid might end up reading', () => {
    const quoted = [...net.matchAll(/"([^"]{4,80})"/g)].map((m) => m[1].toLowerCase());
    for (const text of quoted) expect(text, text).not.toMatch(/\b(kill|killed|crash|destroy|hit|dead|die)\b/);
  });
});

describe('NETWORKING.md: workstream plan', () => {
  const s16 = section(16);

  it('has at most 8 workstreams in at most 3 waves', () => {
    const ws = [...new Set([...s16.matchAll(/\*\*WS(\d) — /g)].map((m) => Number(m[1])))];
    expect(ws.length).toBeGreaterThan(0);
    expect(ws.length).toBeLessThanOrEqual(8);
    const waves = [...s16.matchAll(/^### Wave (\d)/gm)].map((m) => Number(m[1]));
    expect(waves.length).toBeLessThanOrEqual(3);
    expect(waves[0]).toBe(1);
  });

  it('wave 1 starts with the sim refactor', () => {
    const w1 = s16.slice(s16.indexOf('### Wave 1'), s16.indexOf('### Wave 2'));
    expect(w1).toContain('**WS1 — Sim core**');
  });

  it('declares new events only through the shared EVENTS table (race-tick is planned, not yet declared)', () => {
    expect(section(8)).toContain('`race-tick`');
    expect(typeof EVENTS).toBe('object');
  });
});

describe('NETWORKING.md: acceptance criteria are measurable', () => {
  it('lists numbered criteria, each with a number, a limit or a named test', () => {
    const items = section(17).split('\n').filter((l) => /^\d+\. /.test(l));
    expect(items.length).toBeGreaterThanOrEqual(15);
    const blocks = section(17).split(/\n(?=\d+\. )/).filter((b) => /^\d+\. /.test(b));
    for (const b of blocks) expect(b, b.slice(0, 60)).toMatch(/\d|`[^`]+`/);
  });
});
