/**
 * WS7: main.js online wiring, checked at the source level (main.js boots a WebGL renderer, so it can't be
 * imported in node; the browser smoke + online e2e drive it for real):
 *   - `#join=` is read ONCE at start-up with WS6's startupInvite and cleared with history.replaceState,
 *   - no network code is imported up front: only `import('./online/index.js')`, and only for online,
 *   - offline races never go near the online path (startRace delegates only with `opts.net`),
 *   - online races ignore ?simspeed / ?autodrive / quick start, and a napping controller is Robo Driver
 *     locally instead of a pause for everyone,
 *   - the online chunk exports everything main.js reaches for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as online from '../src/online/index.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const netRaceSrc = main.slice(main.indexOf('function startNetRace('), main.indexOf('\nboot();'));

describe('main.js online wiring', () => {
  it('reads the invite fragment once at start-up and clears it', () => {
    expect(main.match(/startupInvite\(/g)).toHaveLength(1);
    expect(main).toMatch(/hash: location\.hash/);
    expect(main).toMatch(/history\.replaceState\(/);
    expect(main).toMatch(/const startInvite = readStartupInvite\(\);/);
    // an invite never falls through to a quick-start race
    expect(main).toMatch(/wantsQuickStart\(params\) && !startAt/);
  });

  it('imports no network code up front (the online chunk is loaded lazily)', () => {
    const staticImports = [...main.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    for (const p of staticImports) expect(p, p).not.toMatch(/net\/(signaling|transport|host|guest)|online\/|tickPump|debugOverlay/);
    expect(main).toContain("import('./online/index.js')");
  });

  it('offline races never take the online path', () => {
    expect(main).toMatch(/function startRace\(setup, done, opts = \{\}\) \{\n {2}if \(opts\.net\) return startNetRace\(setup, done, opts\);/);
    expect(main.match(/net: \{ mod, room, role: '(host|guest)', deviceIds \}/g)).toHaveLength(2);
  });

  it('online races ignore ?simspeed and ?autodrive; a napping controller never pauses everyone', () => {
    expect(netRaceSrc.length).toBeGreaterThan(2000);
    expect(netRaceSrc).not.toMatch(/params\.simSpeed|params\.autodrive/);
    expect(netRaceSrc).not.toMatch(/openPause\(/);
    expect(netRaceSrc).toMatch(/controllerNap/);
    expect(netRaceSrc).toMatch(/robo: pauseOpen \|\| unplugged\.has/);
  });

  it('host: "Pause everyone" + tick pump; guest: RESULT localized, host CHOICE resolves results', () => {
    expect(netRaceSrc).toMatch(/link\.pauseAll\(true\)/);
    expect(netRaceSrc).toMatch(/createTickPump\(/);
    expect(netRaceSrc).toMatch(/clock\.usePump\(hidden\)/);
    expect(netRaceSrc).toMatch(/localRaceSummary\(hostSummary, playerIndices, humans\)/);
    expect(netRaceSrc).toMatch(/menus\.resolveCurrent\(`host:\$\{c\}`\)/);
    expect(netRaceSrc).toMatch(/renewIceIfRelayed|transport\.send/);
    expect(main).toMatch(/renewIceIfRelayed/);
  });

  it('the lazy online chunk exports what main.js uses', () => {
    const used = [...new Set([...main.matchAll(/\bmod\.([A-Za-z_]+)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(20);
    for (const name of used) expect(online[name], name).toBeDefined();
  });
});
