import { describe, it, expect, beforeEach } from 'vitest';
import {
  GOALS, GOAL_COUNTERS, getGoal, emptyGoals, mergeGoals, goalProgress, newlyMetGoals, earnGoals,
  applyGoalCounters, todayString, goalsBookModel,
} from '../src/progress/goals.js';
import { emptyProgress, mergeProgress } from '../src/progress/schema.js';
import { LINEUP_CHARACTERS, LINEUP_TRACKS, LINEUP_CUPS } from '../src/content/lineup.js';
import * as progress from '../src/progress/progress.js';
import funGoals from '../src/systems/funGoals.js';
import { createFakeBus } from './helpers/fakeBus.js';
import { toastPlan, createGoalToasts, MAX_TOASTS } from '../src/ui/goalToasts.js';
import { listSystems } from '../src/systems/index.js';

const BAD_WORDS = /\b(hit|kill|crash|destroy|die|dead|loser|fail)\b/i;
const P = () => mergeProgress(emptyProgress());

describe('Fun Goals catalogue', () => {
  it('has 20+ friendly goals with unique ids, emoji, names and hints', () => {
    expect(GOALS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
    for (const g of GOALS) {
      expect(g.emoji).toBeTruthy();
      expect(g.name.length).toBeGreaterThan(3);
      expect(g.hint.length).toBeGreaterThan(5);
      expect(`${g.name} ${g.hint}`).not.toMatch(BAD_WORDS);
      expect(Object.isFrozen(g)).toBe(true);
    }
    expect(getGoal('drift-master').rule).toEqual({ type: 'stat', stat: 'miniTurbos', count: 100 });
    expect(getGoal('nope')).toBe(null);
  });

  it('every rule is measurable on an empty save (0 progress, not done)', () => {
    const p = P();
    for (const g of GOALS) {
      const pr = goalProgress(g, p);
      expect(pr.done, g.id).toBe(false);
      expect(pr.target, g.id).toBeGreaterThanOrEqual(1);
      expect(pr.ratio).toBe(0);
    }
    expect(newlyMetGoals(p)).toEqual([]);
  });

  it('the idea list is covered: drift 100, every track, every racer, battle, team, daily', () => {
    const ids = GOALS.map((g) => g.id);
    for (const id of ['drift-master', 'world-explorer', 'best-friends', 'last-one-bobbing', 'team-spirit', 'daily-sprinkler', 'sticker-superstar']) expect(ids).toContain(id);
  });
});

describe('goalProgress', () => {
  it('stat and counter goals', () => {
    const p = P();
    p.stats.miniTurbos = 42;
    expect(goalProgress(getGoal('drift-master'), p)).toMatchObject({ current: 42, target: 100, done: false });
    p.stats.miniTurbos = 250;
    expect(goalProgress(getGoal('drift-master'), p)).toMatchObject({ current: 100, done: true, ratio: 1 });
    p.goals = { counters: { teamWins: 3 } };
    expect(goalProgress(getGoal('dream-team'), p)).toMatchObject({ current: 3, target: 5, done: false });
    expect(goalProgress(getGoal('team-spirit'), p).done).toBe(true);
  });

  it('every track / every racer / distinct racers / every cup', () => {
    const p = P();
    for (const t of LINEUP_TRACKS.slice(0, -1)) p.tracks[t.id] = { finishes: 1 };
    expect(goalProgress(getGoal('world-explorer'), p)).toMatchObject({ current: LINEUP_TRACKS.length - 1, done: false });
    p.tracks[LINEUP_TRACKS.at(-1).id] = { finishes: 2 };
    expect(goalProgress(getGoal('world-explorer'), p).done).toBe(true);
    for (const c of LINEUP_CHARACTERS.slice(0, 10)) p.racers[c.id] = { races: 1, wins: 0 };
    expect(goalProgress(getGoal('dress-up'), p).done).toBe(true);
    expect(goalProgress(getGoal('best-friends'), p).current).toBe(0);
    for (const c of LINEUP_CHARACTERS) p.racers[c.id] = { races: 1, wins: 1 };
    expect(goalProgress(getGoal('best-friends'), p)).toMatchObject({ current: LINEUP_CHARACTERS.length, done: true });
    for (const c of LINEUP_CUPS) p.cups[c.id] = { wins: 1 };
    expect(goalProgress(getGoal('cup-collector'), p).done).toBe(true);
  });

  it('full book counts earned content only (not the parent unlock-all switch)', () => {
    const p = P();
    p.unlockAll = true;
    expect(goalProgress(getGoal('sticker-superstar'), p).done).toBe(false);
    p.unlocked = [...LINEUP_CHARACTERS, ...LINEUP_TRACKS].filter((x) => x.unlock).map((x) => x.id);
    expect(goalProgress(getGoal('sticker-superstar'), p).done).toBe(true);
  });

  it('an unknown rule type is never done', () => {
    expect(goalProgress({ rule: { type: 'mystery' } }, P())).toMatchObject({ done: false, target: 1 });
    expect(goalProgress(null, P()).done).toBe(false);
  });
});

describe('earning + saved shape', () => {
  it('earnGoals marks newly met goals once, with the date', () => {
    const p = P();
    p.stats.racesFinished = 12;
    p.stats.wins = 1;
    const fresh = earnGoals(p, '2026-09-25');
    expect(fresh.map((g) => g.id)).toEqual(['first-finish', 'race-buddy', 'first-win']);
    expect(p.goals.earned).toEqual({ 'first-finish': '2026-09-25', 'race-buddy': '2026-09-25', 'first-win': '2026-09-25' });
    expect(earnGoals(p, '2026-09-26')).toEqual([]);
  });

  it('mergeGoals drops junk and keeps new counters at 0', () => {
    expect(mergeGoals(null)).toEqual(emptyGoals());
    const m = mergeGoals({ earned: { 'first-win': '2026-01-01', bogus: '2026-01-01', 'race-buddy': 5 }, counters: { teamWins: 2, battlesWon: -1, x: NaN } });
    expect(m.earned).toEqual({ 'first-win': '2026-01-01' });
    expect(m.counters.teamWins).toBe(2);
    expect(m.counters.battlesWon).toBe(0);
    for (const k of GOAL_COUNTERS) expect(Number.isFinite(m.counters[k])).toBe(true);
  });

  it('survives the progress merge (kept as its own key)', () => {
    const saved = { ...emptyProgress(), goals: { earned: { 'first-win': '2026-02-02' }, counters: { teamWins: 1 } } };
    expect(mergeProgress(JSON.parse(JSON.stringify(saved))).goals.earned['first-win']).toBe('2026-02-02');
  });

  it('todayString pads the date', () => {
    expect(todayString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('applyGoalCounters (mode results)', () => {
  const human = (o = {}) => ({ playerIndex: 0, place: 1, finished: true, estimated: false, stats: { bonked: 0 }, ...o });

  it('counts battles, battle wins and bubbles popped by humans', () => {
    const p = P();
    applyGoalCounters(p, { mode: 'battle', humans: [human()], battle: { humanWinner: { playerIndex: 0 }, humanPops: 4 } });
    applyGoalCounters(p, { mode: 'battle', humans: [human()], battle: { humanWinner: null, humanPops: 2 } });
    expect(p.goals.counters).toMatchObject({ battlesPlayed: 2, battlesWon: 1, bubblesPopped: 6, cleanWins: 0 });
  });

  it('counts team races and Team Sprinkle wins', () => {
    const p = P();
    applyGoalCounters(p, { mode: 'team', humans: [human({ place: 3 })], team: { winner: 'sprinkle', homeTeam: 'sprinkle' } });
    applyGoalCounters(p, { mode: 'team', humans: [human({ place: 5 })], team: { winner: 'sparkle' } });
    applyGoalCounters(p, { mode: 'team', humans: [], team: { winner: null } });
    expect(p.goals.counters).toMatchObject({ teamRaces: 3, teamWins: 1 });
  });

  it('clean wins: 1st without a single bonk (not estimated, not in a time trial)', () => {
    const p = P();
    applyGoalCounters(p, { mode: 'free', humans: [human()] });
    applyGoalCounters(p, { mode: 'free', humans: [human({ stats: { bonked: 2 } })] });
    applyGoalCounters(p, { mode: 'free', humans: [human({ estimated: true })] });
    applyGoalCounters(p, { mode: 'time-trial', humans: [human()] });
    applyGoalCounters(p, { mode: 'grand-prix', humans: [human({ stats: null })] });
    expect(p.goals.counters.cleanWins).toBe(1);
  });

  it('daily sprinkles and junk summaries', () => {
    const p = P();
    applyGoalCounters(p, { mode: 'free', humans: [], daily: { done: true, counted: true } });
    applyGoalCounters(p, { mode: 'free', humans: [], daily: { done: true, counted: false } }); // same day again
    applyGoalCounters(p, { mode: 'free', humans: [], daily: { done: false } });
    applyGoalCounters(p, null);
    expect(p.goals.counters.dailyDone).toBe(1);
  });
});

describe('goalsBookModel', () => {
  it('lists every goal with earned flags, dates and progress text', () => {
    const p = P();
    p.stats.miniTurbos = 30;
    p.goals = { earned: { 'first-win': '2026-03-03' } };
    const b = goalsBookModel(p);
    expect(b.total).toBe(GOALS.length);
    expect(b.earned).toBe(1);
    expect(b.goals.find((g) => g.id === 'first-win')).toMatchObject({ earned: true, when: '2026-03-03' });
    expect(b.goals.find((g) => g.id === 'drift-master').count).toBe('30/100');
    expect(b.goals.find((g) => g.id === 'first-finish').count).toBe('');
    expect(goalsBookModel(null).earned).toBe(0);
  });
});

describe('fun-goals system (real progress module, in memory)', () => {
  beforeEach(() => progress.resetProgress());

  function install() {
    const bus = createFakeBus();
    const shown = [];
    const app = { progress, audio: { sfx() {} }, goalToasts: { show: (g) => shown.push(...g.map((x) => x.id)), clear() {} } };
    const off = funGoals.install(bus, app);
    return { bus, shown, off };
  }

  it('is registered after progress-unlocks', () => {
    const list = listSystems();
    const ids = list.map((s) => s.id);
    expect(ids.indexOf('fun-goals')).toBeGreaterThan(ids.indexOf('progress-unlocks'));
  });

  it('earns goals on race-end, pushes their ids and shows a toast; never twice', () => {
    const { bus, shown, off } = install();
    progress.update((p) => { p.stats.racesFinished = 1; p.stats.wins = 1; });
    const summary = { mode: 'free', humans: [{ playerIndex: 0, place: 1, finished: true, estimated: false, stats: { bonked: 0 } }], unlocks: [] };
    bus.emit('race-end', summary);
    expect(summary.goals).toEqual(['first-finish', 'first-win', 'clean-win']);
    expect(shown).toEqual(['first-finish', 'first-win', 'clean-win']);
    bus.emit('race-end', summary); // the same summary again: ignored
    expect(progress.loadProgress().goals.counters.cleanWins).toBe(1);
    expect(Object.keys(progress.loadProgress().goals.earned)).toHaveLength(3);
    off();
  });

  it('battle summaries count toward the battle goals', () => {
    const { bus, off } = install();
    bus.emit('race-end', { mode: 'battle', humans: [], battle: { humanWinner: { playerIndex: 0 }, humanPops: 3 } });
    const g = progress.loadProgress().goals;
    expect(g.earned['bubble-popper']).toBeTruthy();
    expect(g.earned['last-one-bobbing']).toBeTruthy();
    expect(g.counters.bubblesPopped).toBe(3);
    off();
  });

  it('gp-end re-checks goals (cup goals) without counting a race', () => {
    const { bus, off } = install();
    progress.update((p) => { p.stats.grandPrixFinished = 1; });
    const gp = { cupId: 'sprinkle-cup', unlocks: [] };
    bus.emit('gp-end', gp);
    expect(gp.goals).toContain('cup-runner');
    off();
  });

  it('a "fresh Sticker Book" reset wipes the goals', () => {
    progress.update((p) => { p.goals = { earned: { 'first-win': '2026-01-01' } }; });
    progress.resetProgress({ keepSettings: true });
    expect(progress.loadProgress().goals).toBeUndefined();
    expect(goalsBookModel(progress.loadProgress()).earned).toBe(0);
  });

  it('ignores progress modules without update() and odd payloads', () => {
    const bus = createFakeBus();
    const off = funGoals.install(bus, { progress: { loadProgress: () => ({}) } });
    const s = { mode: 'free' };
    bus.emit('race-end', s);
    bus.emit('race-end', null);
    expect(s.goals).toBeUndefined();
    off();
  });
});

describe('goal toasts', () => {
  const g = (n) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, emoji: '⭐', name: `Goal ${i}`, hint: 'do it' }));

  it('shows up to MAX_TOASTS, then folds the rest into one "+N more"', () => {
    expect(toastPlan(g(2)).map((t) => t.name)).toEqual(['Goal 0', 'Goal 1']);
    expect(toastPlan(g(MAX_TOASTS))).toHaveLength(MAX_TOASTS);
    const many = toastPlan(g(7));
    expect(many).toHaveLength(MAX_TOASTS);
    expect(many.at(-1).name).toBe(`${7 - (MAX_TOASTS - 1)} more new stickers!`);
    expect(toastPlan([null, { name: '' }])).toEqual([]);
    expect(toastPlan()).toEqual([]);
  });

  it('is a no-op without a DOM', () => {
    const t = createGoalToasts({ root: null });
    expect(t.show(g(2))).toBe(0);
    expect(() => t.clear()).not.toThrow();
    expect(t.queued).toBe(0);
  });
});

describe('sticker toast placement', () => {
  it('toasts live in the top-left corner (the reveal ribbon is top-right), never centred over the results / standings headline', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/ui/goalToasts.css', 'utf8');
    const rule = /\.skg-toasts \{([^}]*)\}/.exec(css)[1];
    expect(rule).toMatch(/left:\s*1\.2em/);
    expect(rule).not.toMatch(/right:/);
    // the reveal ribbon lives in the top-right corner
    expect(readFileSync('src/ui/screens/progress.css', 'utf8') + readFileSync('src/ui/ui.css', 'utf8')).toMatch(/\.skp-ribbon \{[^}]*right:/);
    expect(rule).not.toMatch(/left:\s*50%/);
    expect(rule).not.toMatch(/translateX\(-50%\)/);
    expect(rule).toMatch(/max-width/);
  });
});
