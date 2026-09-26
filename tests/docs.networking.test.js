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

// ---------------------------------------------------------------------------------------------------------
// Revision 2 (design review): keep the fixes from silently regressing in later doc edits.

const subsection = (sec, title) => {
  const body = section(sec);
  const start = body.indexOf(`### ${title}`);
  if (start < 0) return '';
  const rest = body.slice(start + 4);
  const next = rest.search(/^### /m);
  return next < 0 ? rest : rest.slice(0, next);
};

describe('NETWORKING.md rev 2: timelines and the host timebase', () => {
  it('assigns countdown, GO, rocket start, race timer and live place to explicit timelines', () => {
    const t = rows(subsection(9, '9.1'));
    const find = (label) => t.find((r) => r[0].toLowerCase().includes(label));
    expect(find('countdown')[1]).toMatch(/\*\*P\*\*/);
    expect(find('rocket-start')[1]).toMatch(/\*\*P\*\*/);
    expect(find('race timer')[1]).toMatch(/\*\*P\*\*/);
    expect(find('live place')[1]).toMatch(/host standings/);
    expect(find('finish celebration')[1]).toMatch(/finish/);
  });

  it('has a re-anchorable TIMEBASE message and PAUSE carries ticks', () => {
    const ctrl = rows(subsection(6, '6.2'));
    const tb = ctrl.find((r) => r[1] === 'TIMEBASE');
    expect(tb[0]).toBe('0x34');
    expect(tb[4]).toMatch(/epoch/);
    expect(ctrl.find((r) => r[1] === 'PAUSE')[4]).toMatch(/pauseTick/);
    expect(ctrl.find((r) => r[1] === 'FRAG')[0]).toBe('0x3F');
    expect(section(7)).toMatch(/30 s host pause/);
    expect(section(9)).toMatch(/MAX_BACKLOG_TICKS = 30/);
  });

  it('acceptance no longer promises GO within 25 ms across machines', () => {
    expect(section(17)).not.toMatch(/within 25 ms across machines/);
    expect(section(17)).toMatch(/lands on host tick `goTick` ± 1/);
  });
});

describe('NETWORKING.md rev 2: bandwidth is counted in wire bytes', () => {
  it('uses the 93-byte per-packet overhead and the budget table matches acceptance M1-5', () => {
    expect(net).toContain('WIRE_OVERHEAD_BYTES = 93');
    const m15 = section(17).split(/\n(?=\d+\. )/).find((b) => b.includes('**M1-5**'));
    for (const n of ['45 kbps', '90 kbps', '140 kbps', '220 kbps', '1.0 Mbps', '1.6 Mbps']) expect(m15, n).toContain(n);
    const s94 = subsection(9, '9.4');
    for (const n of ['≤ 45 kbps', '≤ 90 kbps', '≤ 140 kbps', '≤ 220 kbps', '≤ 1.0 Mbps', '≤ 1.6 Mbps']) expect(s94, n).toContain(n);
  });

  it('the stated budgets hold for the stated packet sizes (arithmetic check)', () => {
    const kbps = (payload, perSec, extra = 16) => ((payload + 93 + extra) * perSec * 8) / 1000;
    expect(kbps(37, 30) + 6).toBeLessThanOrEqual(45); // guest up, 1 player
    expect(kbps(141, 30) + 6).toBeLessThanOrEqual(90); // guest up, 4 players worst
    expect(kbps(370, 30) + 10).toBeLessThanOrEqual(140); // guest down typical
    expect(kbps(730, 30) + 10).toBeLessThanOrEqual(220); // guest down cap-case
    expect((7 * (kbps(730, 30) + 10)) / 1000).toBeLessThanOrEqual(1.6); // host up cap-case
    expect((7 * (kbps(370, 30) + 10)) / 1000).toBeLessThanOrEqual(1.0); // host up typical
  });

  it('INPUT is sent at 30 Hz and the redundancy claim is honest (no 10^-12)', () => {
    expect(subsection(6, '6.1')).toMatch(/\*\*0x01 INPUT\*\* guest → host, \*\*30 Hz\*\*/);
    expect(net).not.toMatch(/10⁻¹²/);
    expect(subsection(9, '9.2')).toMatch(/1 \+ floor\(slack \/ 2\)/);
  });

  it('state backpressure is a couple of messages, not 64 KiB of stale snapshots', () => {
    expect(net).toContain('STATE_BUFFER_LIMIT = max(1024,');
    expect(net).not.toMatch(/on\s+`state`, when `bufferedAmount > 64 KiB`/);
  });
});

describe('NETWORKING.md rev 2: codec timers fit tuning', () => {
  it('item timers are u16 milliseconds, wide enough for every TUNING duration', async () => {
    const { TUNING } = await import('../src/race/tuning.js');
    expect(section(5)).toMatch(/`boostTime, spinTime, shieldTime, starPower` \| \*\*u16 milliseconds\*\*/);
    for (const [k, v] of Object.entries(TUNING)) {
      if (/Duration$/.test(k)) expect(2 * v * 1000, k).toBeLessThanOrEqual(65535);
    }
  });
});

describe('NETWORKING.md rev 2: kid safety and abuse', () => {
  it('rooms need a non-enumerable secret and the old reversible room id is gone', () => {
    const s42 = subsection(4, '4.2');
    expect(s42).toMatch(/PBKDF2-SHA256/);
    expect(s42).toContain('ROOM_KDF_ITERATIONS = 150 000');
    expect(net).not.toMatch(/SHA-256\('sprinkle-kart-room:' \+ code\)/);
    expect(section(1)).toContain('secret sweets');
    expect(section(10)).toContain('#join=');
  });

  it('approval is always on, shows a match check, and remove locks the room', () => {
    const s1 = section(1);
    expect(s1).toContain('approves every new house — always');
    expect(s1).toContain('match check');
    expect(s1).toContain('locks the room');
    expect(s1).not.toMatch(/removed peers are blocked for the rest/);
  });

  it('the privacy sentence names who can see the address', () => {
    const rule6 = section(1).split(/\n(?=\d+\. )/).find((b) => b.startsWith('6. '));
    for (const who of ['friends', 'public matchmaking', 'STUN', 'Cloudflare']) expect(rule6, who).toContain(who);
    expect(rule6).toMatch(/never raw IP/);
  });

  it('TURN credentials are for rooms; /ice is rate-limited with a short ttl', () => {
    expect(section(3)).toMatch(/"ttl": 1800/);
    expect(net).not.toMatch(/"ttl": 14400/);
    expect(subsection(4, '4.2')).toMatch(/joined', you, host, peers: \[\], iceServers/);
    expect(section(19)).toMatch(/`\/ice` 5\/min\/IP/);
  });

  it('the Origin check is described honestly and dev origins come from .dev.vars', () => {
    const s42 = subsection(4, '4.2');
    expect(s42).toMatch(/It is \*\*not\*\* abuse protection/);
    expect(s42).toContain('.dev.vars');
  });
});

describe('NETWORKING.md rev 2: fairness, prediction and progress', () => {
  it('grid slots are drawn from the seed, not from join order', () => {
    expect(section(8)).toMatch(/\*\*seeded shuffle\*\*/);
    expect(section(8)).toContain('gridSlot');
    expect(section(10)).toMatch(/participants: \[ \{ kartId, gridSlot/);
  });

  it('predicts local karts jointly, hands Robo-driven own karts to interpolation, tags predicted events', () => {
    expect(section(8)).toMatch(/predictTick\(localKarts, inputs, ctx\)/);
    const s96 = subsection(9, '9.6');
    expect(s96).toContain('roboDriven');
    expect(s96).toContain('predicted: true');
  });

  it('press counters cover item use and hop/drift, with the multi-press and baseline rules', () => {
    expect(subsection(6, '6.1')).toMatch(/hop\/drift press counter mod 8/);
    const t = rows(subsection(9, '9.3')).map((r) => r[0]).join('\n');
    expect(t).toMatch(/counter delta of 2\+/);
    expect(t).toMatch(/Robo Driver \/ reconnect/);
  });
});

describe('NETWORKING.md rev 2: plan hygiene', () => {
  const s16 = section(16);

  it('has P0, hotspot rules, and a ship ladder with M1 before M2 and M3', () => {
    expect(s16).toContain('### 16.0 P0');
    expect(s16).toContain('### 16.1 Hotspot rules');
    const ladder = rows(subsection(16, '16.2 Ship ladder')).map((r) => r[0]);
    expect(ladder.slice(1)).toEqual(['**M1 — "Play with friends"**', '**M2 — "Cups together"**', '**M3 — "Everything"**']);
    const s17 = section(17);
    expect(s17.indexOf('### M1')).toBeLessThan(s17.indexOf('### M2'));
    expect(s17.indexOf('### M2')).toBeLessThan(s17.indexOf('### M3'));
    const m1 = s17.slice(s17.indexOf('### M1'), s17.indexOf('### M2')).match(/\*\*M1-\d+\*\*/g);
    expect(m1.length).toBeGreaterThanOrEqual(20);
  });

  it('every acceptance id cited elsewhere exists in §17', () => {
    const cited = new Set([...net.matchAll(/acceptance (M\d-\d+)/g)].map((m) => m[1]));
    expect(cited.size).toBeGreaterThan(0);
    for (const id of cited) expect(section(17), id).toContain(`**${id}**`);
  });

  it('no file is owned by two workstreams of the same wave', () => {
    const expand = (p) => {
      const m = /\{([^}]+)\}/.exec(p);
      return m ? m[1].split(',').flatMap((x) => expand(p.replace(m[0], x))) : [p];
    };
    const noFences = s16.replace(/```[\s\S]*?```/g, '');
    const waves = noFences.split(/^### Wave /m).slice(1);
    expect(waves).toHaveLength(3);
    let checked = 0;
    for (const wave of waves) {
      const owners = new Map();
      for (const block of wave.split(/(?=\*\*WS\d — )/).filter((b) => b.startsWith('**WS'))) {
        const ws = block.slice(2, 5);
        const cut = block.search(/Interfaces:|Delivers|Implements|Talks to|Glue only|Starts in|Codes the/);
        const owned = cut < 0 ? block : block.slice(0, cut);
        for (const tok of [...owned.matchAll(/`([^`\s]+\/[^`\s]*)`/g)].flatMap((m) => expand(m[1]))) {
          if (!/\.(js|mjs|json|yml|md|toml)$|\/\*\*$/.test(tok)) continue;
          const prev = owners.get(tok);
          expect(prev === undefined || prev === ws, `${tok} owned by ${prev} and ${ws}`).toBe(true);
          owners.set(tok, ws);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('the P0 contract files exist and .dev.vars is gitignored', () => {
    expect(read('src/race/simState.types.js')).toContain('export function checkSimStateShape');
    expect(read('scripts/worker.mjs')).toContain('export function planWorkerCommand');
    expect(read('.gitignore').split(/\r?\n/)).toContain('.dev.vars');
  });

  it('workstreams branch from the latest origin/main', () => {
    expect(s16).toMatch(/from the \*\*latest\s+`origin\/main`\*\*/);
  });
});

describe('docs/INFRA_SETUP.md rev 2', () => {
  it('asks for Node 22+ and never claims Node 20 works', () => {
    expect(infra).toMatch(/Node\.js 22 or newer/);
    expect(infra).not.toMatch(/Node\.js 20 or newer/);
  });

  it('installs the worker sub-package and uses the pinned wrangler through npm scripts', () => {
    expect(infra).toContain('infra/signal-worker');
    expect(infra).toContain('npm ci');
    for (const s of ['npm run worker:login', 'npm run worker:deploy', 'npm run worker:secret -- TURN_KEY_ID']) {
      expect(infra, s).toContain(s);
    }
    expect(infra).not.toMatch(/^npx wrangler secret put/m);
  });

  it('deploys before storing secrets, names Realtime → TURN Server, and warns about usage', () => {
    expect(infra.indexOf('## 5. Deploy the worker')).toBeGreaterThan(0);
    expect(infra.indexOf('## 5. Deploy the worker')).toBeLessThan(infra.indexOf('## 6. Store the secrets'));
    expect(infra).toContain('Realtime → TURN Server');
    expect(infra).toMatch(/usage notification/);
  });

  it('explains the invite, the secret sweets, the match check and what other computers can see', () => {
    for (const s of ['Copy invite link', 'secret sweets', 'do you see', 'What other computers can see', '.dev.vars']) {
      expect(infra, s).toContain(s);
    }
  });
});
