// The smoke test's planning logic (scripts/smoke-plan.mjs): which scenarios run
// where, and how patient we are. A regression here silently drops coverage in CI.
import { describe, it, expect } from 'vitest';
import {
  ORIGINAL_TRACK_IDS, CI_4P_TRACK_IDS, FLOW_SCENARIOS,
  resolveProfile, timeoutFor, planScenarios, wanted, stalledKarts, isIgnorableError,
} from '../scripts/smoke-plan.mjs';
import { readFileSync } from 'node:fs';
import { TRACKS } from '../src/tracks/index.js';

const names = (plan) => plan.map((s) => s.name);
const V2_TRACKS = [...ORIGINAL_TRACK_IDS, 'bubblegum-bay', 'mermaid-lagoon', 'ribbon-sky'];

describe('resolveProfile', () => {
  it('defaults to the patient-free local profile', () => {
    const p = resolveProfile({});
    expect(p).toMatchObject({ name: 'local', ci: false, full: false, port: 5190, timeoutScale: 1, retries: 1 });
    expect(p.viewport).toEqual({ width: 1280, height: 720 });
    expect(p.driveSeconds).toBeGreaterThan(0);
  });

  it('CI gets a small viewport, generous timeouts and a short drive', () => {
    const p = resolveProfile({ CI: 'true' });
    expect(p).toMatchObject({ name: 'ci', ci: true, timeoutScale: 4 });
    expect(p.viewport.width * p.viewport.height).toBeLessThan(1280 * 720 / 2);
    expect(p.driveSeconds).toBeLessThanOrEqual(resolveProfile({}).driveSeconds);
  });

  it('treats CI=0 / CI=false / empty as not CI', () => {
    for (const v of ['0', 'false', 'FALSE', '']) expect(resolveProfile({ CI: v }).ci).toBe(false);
    expect(resolveProfile({ CI: '1' }).ci).toBe(true);
  });

  it('SMOKE_FULL wins over CI trimming', () => {
    expect(resolveProfile({ CI: 'true', SMOKE_FULL: '1' })).toMatchObject({ name: 'full', full: true, ci: true });
  });

  it('honours valid overrides and ignores garbage', () => {
    const p = resolveProfile({ SMOKE_PORT: '5310', SMOKE_VIEWPORT: '640x360', SMOKE_TIMEOUT_SCALE: '2.5', SMOKE_DRIVE_SECONDS: '6', SMOKE_RETRIES: '2' });
    expect(p).toMatchObject({ port: 5310, viewport: { width: 640, height: 360 }, timeoutScale: 2.5, driveSeconds: 6, retries: 2 });
    const bad = resolveProfile({ SMOKE_PORT: 'lots', SMOKE_VIEWPORT: 'huge', SMOKE_TIMEOUT_SCALE: '-1', SMOKE_DRIVE_SECONDS: 'NaN', SMOKE_RETRIES: '1.5' });
    expect(bad).toMatchObject({ port: 5190, viewport: { width: 1280, height: 720 }, timeoutScale: 1, retries: 1 });
    expect(bad.driveSeconds).toBeGreaterThan(0);
    expect(resolveProfile({ SMOKE_PORT: '70000' }).port).toBe(5190);
    expect(resolveProfile({ SMOKE_RETRIES: '99' }).retries).toBe(3); // capped
    expect(resolveProfile({ SMOKE_RETRIES: '0' }).retries).toBe(0);
  });
});

describe('timeoutFor', () => {
  it('scales up, never down', () => {
    expect(timeoutFor({ timeoutScale: 4 }, 1000)).toBe(4000);
    expect(timeoutFor({ timeoutScale: 0.5 }, 1000)).toBe(1000);
    expect(timeoutFor(undefined, 1000)).toBe(1000);
  });
});

describe('wanted (filters)', () => {
  it('matches by substring and everything when empty', () => {
    expect(wanted([], 'anything')).toBe(true);
    expect(wanted(['menu'], 'menu-flow')).toBe(true);
    expect(wanted(['menu'], 'menu-scale')).toBe(true);
    expect(wanted(['menu'], 'gamepad-flow')).toBe(false);
  });
});

describe('planScenarios', () => {
  it('local: every track in 1p, the Sprinkle Cup in 4p, spectator run and all flows', () => {
    const plan = planScenarios({ trackIds: V2_TRACKS, profile: resolveProfile({}) });
    for (const id of V2_TRACKS) expect(names(plan)).toContain(`${id}-1p`);
    for (const id of ORIGINAL_TRACK_IDS) expect(names(plan)).toContain(`${id}-4p`);
    expect(names(plan)).not.toContain('bubblegum-bay-4p');
    expect(names(plan)).toContain('cotton-candy-castle-3p');
    for (const f of FLOW_SCENARIOS) expect(names(plan)).toContain(f);
  });

  it('CI: every track in 1p but only a couple of 4p runs', () => {
    const plan = planScenarios({ trackIds: V2_TRACKS, profile: resolveProfile({ CI: '1' }) });
    for (const id of V2_TRACKS) expect(names(plan)).toContain(`${id}-1p`);
    const fourP = plan.filter((s) => s.players === 4).map((s) => s.trackId);
    expect(fourP).toEqual(CI_4P_TRACK_IDS.filter((id) => V2_TRACKS.includes(id)));
    expect(fourP.length).toBeGreaterThanOrEqual(1);
    expect(fourP.length).toBeLessThanOrEqual(3);
    for (const f of FLOW_SCENARIOS) expect(names(plan)).toContain(f);
  });

  it('CI plan stays small even with the whole v2 lineup (20 tracks)', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => (i < 4 ? ORIGINAL_TRACK_IDS[i] : `new-track-${i}`));
    const plan = planScenarios({ trackIds: twenty, profile: resolveProfile({ CI: '1' }) });
    expect(plan.filter((s) => s.kind === 'race' && s.players > 1).length).toBeLessThanOrEqual(3);
    expect(plan.length).toBe(20 + CI_4P_TRACK_IDS.length + 1 + FLOW_SCENARIOS.length);
  });

  it('full: 4p for every track', () => {
    const plan = planScenarios({ trackIds: V2_TRACKS, profile: resolveProfile({ SMOKE_FULL: '1' }) });
    for (const id of V2_TRACKS) expect(names(plan)).toContain(`${id}-4p`);
  });

  it('naming a track runs it in 1p + 4p (even in CI) and nothing else', () => {
    const plan = planScenarios({ trackIds: V2_TRACKS, filters: ['bubblegum-bay'], profile: resolveProfile({ CI: '1' }) });
    expect(names(plan)).toEqual(['bubblegum-bay-1p', 'bubblegum-bay-4p']);
  });

  it('flow filters keep their legacy short names', () => {
    const p = resolveProfile({});
    expect(names(planScenarios({ trackIds: V2_TRACKS, filters: ['menu'], profile: p }))).toEqual(['menu-flow', 'menu-scale']);
    expect(names(planScenarios({ trackIds: V2_TRACKS, filters: ['results'], profile: p }))).toEqual(['results-unlock']);
    expect(names(planScenarios({ trackIds: V2_TRACKS, filters: ['gamepad', 'scale'], profile: p }))).toEqual(['menu-scale', 'gamepad-flow']);
    expect(names(planScenarios({ trackIds: V2_TRACKS, filters: ['cotton-candy-castle-3p'], profile: p }))).toEqual(['cotton-candy-castle-3p']);
  });

  it('dedupes track ids and skips the spectator run without Cotton Candy Castle', () => {
    const plan = planScenarios({ trackIds: ['gumdrop-meadow', 'gumdrop-meadow'], profile: resolveProfile({ CI: '1' }) });
    expect(names(plan).filter((n) => n === 'gumdrop-meadow-1p')).toHaveLength(1);
    expect(names(plan)).not.toContain('cotton-candy-castle-3p');
  });

  it('race scenarios carry trackId + players; unknown filters give an empty plan', () => {
    const plan = planScenarios({ trackIds: V2_TRACKS, profile: resolveProfile({}) });
    for (const s of plan.filter((x) => x.kind === 'race')) {
      expect(V2_TRACKS).toContain(s.trackId);
      expect([1, 3, 4]).toContain(s.players);
      expect(s.name).toBe(`${s.trackId}-${s.players}p`);
    }
    expect(planScenarios({ trackIds: V2_TRACKS, filters: ['nope-nope'], profile: resolveProfile({}) })).toEqual([]);
  });

  it('custom flow lists (smoke.mjs FLOW_TESTS keys) are planned in order and filterable', () => {
    const flows = ['menu-flow', 'settings-screen', 'results-unlock'];
    const p = resolveProfile({});
    expect(names(planScenarios({ trackIds: [], profile: p, flows }))).toEqual(flows);
    expect(names(planScenarios({ trackIds: [], filters: ['settings'], profile: p, flows }))).toEqual(['settings-screen']);
  });

  it('smoke.mjs registers a test for every built-in flow scenario', () => {
    const src = readFileSync(new URL('../scripts/smoke.mjs', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('const FLOW_TESTS = {'), src.indexOf('};', src.indexOf('const FLOW_TESTS = {')));
    const keys = [...block.matchAll(/'([a-z0-9-]+)':\s*\w+/g)].map((m) => m[1]);
    expect(keys.slice(0, FLOW_SCENARIOS.length)).toEqual([...FLOW_SCENARIOS]);
  });

  it('the CI 4p tracks and original ids are real registered tracks', () => {
    const ids = TRACKS.map((t) => t.id);
    for (const id of [...ORIGINAL_TRACK_IDS, ...CI_4P_TRACK_IDS]) expect(ids).toContain(id);
  });
});

describe('stalledKarts', () => {
  const k = (id, progress) => ({ id, progress });
  it('flags karts that did not gain enough progress, or broke', () => {
    const before = [k('a', 0), k('b', 10), k('c', -5)];
    const after = [k('a', 30), k('b', 12), k('c', NaN)];
    const problems = stalledKarts(before, after);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^b did not move/);
    expect(problems[1]).toMatch(/^c has a broken progress/);
  });
  it('is happy when everyone moved, and treats a missing "before" as 0', () => {
    expect(stalledKarts([k('a', -40)], [k('a', -20), k('b', 6)])).toEqual([]);
  });
});

describe('isIgnorableError', () => {
  it('ignores favicons and web fonts only', () => {
    expect(isIgnorableError('GET /favicon.ico 404')).toBe(true);
    expect(isIgnorableError('requestfailed: https://fonts.gstatic.com/s/x.woff2')).toBe(true);
    expect(isIgnorableError('TypeError: kart is undefined')).toBe(false);
  });
});
