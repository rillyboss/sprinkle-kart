/**
 * Daily Sprinkle — storage + the per-session controller main.js plugs into a
 * race (`opts.controller`). The controller follows the family's live tally
 * (session.stats), keeps `race.modeInfo.daily` fresh for the HUD, cheers the
 * moment the goal is reached, and on 'race-end' records the day (streak) and
 * adds `summary.daily` (the Fun Goals count `summary.daily.counted`).
 *
 * localStorage key 'sprinkle-kart-daily-v1' (safe fallback to memory).
 * OWNER: showcase features & modes.
 */
import { jsonStore } from './storage.js';
import { dailyProgress, dailyResult, recordDaily, mergeDailyStore, currentStreak } from './daily.js';
import { createGoalToasts } from '../ui/goalToasts.js';

export const DAILY_KEY = 'sprinkle-kart-daily-v1';

/** The saved daily store ({ lastDone, streak, best, days }). */
export function dailyStore(backend) {
  const store = backend === undefined ? jsonStore(DAILY_KEY) : jsonStore(DAILY_KEY, backend);
  return {
    load: () => mergeDailyStore(store.read()),
    save: (s) => store.write(mergeDailyStore(s)),
    clear: () => store.clear(),
  };
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/** Family tally so far (sum over humans) from session.stats + the karts' places. */
export function liveTally(race, session) {
  const humans = (race?.karts || []).filter((k) => !k.isCPU);
  const t = { miniTurbos: 0, itemsUsed: 0, itemBoxes: 0, bonksGiven: 0, boosts: 0, bonked: 0, finished: false, bestPlace: null, clean: false };
  for (const k of humans) {
    const s = session?.stats?.forPlayer?.(k.playerIndex) ?? {};
    for (const key of ['miniTurbos', 'itemsUsed', 'itemBoxes', 'bonksGiven', 'boosts', 'bonked']) t[key] += num(s[key]);
    if (k.finished && !k.finishEstimated) {
      t.finished = true;
      const place = k.finishPlace ?? k.place;
      if (Number.isInteger(place)) t.bestPlace = t.bestPlace === null ? place : Math.min(t.bestPlace, place);
      if (num(s.bonked) === 0) t.clean = true;
    }
  }
  return t;
}

/**
 * @param {object} o
 * @param {object} o.race
 * @param {object} [o.session]    race session (stats, flash, sfx)
 * @param {object} o.challenge    from dailyChallenge()
 * @param {object} [o.store]      dailyStore() (tests pass a memory one)
 * @param {string} [o.today]      'YYYY-MM-DD' (defaults to the challenge id)
 * @param {object} [o.toasts]     createGoalToasts() (tests pass a fake)
 */
export function createDailySession({ race, session = null, challenge, store = dailyStore(), today = challenge?.id, toasts = null } = {}) {
  let cheered = false;
  let acc = 1;
  let last = null;
  const toast = toasts ?? createGoalToasts({ sfx: (n) => { try { session?.audio?.sfx?.(n); } catch { /* ignore */ } } });

  const publish = () => {
    const pr = dailyProgress(challenge, liveTally(race, session));
    // Counting goals are done as soon as they are reached; place goals wait for the line.
    race.modeInfo.daily = { emoji: challenge.goal.emoji, goal: challenge.goal.text, text: pr.text, done: pr.done, current: pr.current, target: pr.target };
    return pr;
  };
  publish();

  function update(dt = 0) {
    acc += dt;
    if (acc < 0.2) return;
    acc = 0;
    last = publish();
    if (last.done && !cheered && race.state !== 'countdown') {
      cheered = true;
      for (const k of race.karts) if (!k.isCPU) { try { session?.flash?.(k, 'Daily Sprinkle done! ☀️'); } catch { /* ignore */ } }
      try { session?.sfx?.('goal-sticker'); } catch { /* ignore */ }
    }
  }

  function decorateSummary(summary) {
    if (!summary || typeof summary !== 'object') return summary;
    const res = dailyResult(challenge, summary);
    const before = store.load();
    const { store: next, counted } = recordDaily(before, today, res.done);
    if (counted) store.save(next);
    summary.daily = {
      id: challenge.id,
      goal: challenge.goal,
      twist: challenge.twist,
      done: res.done,
      counted,
      progress: res.text,
      streak: currentStreak(counted ? next : before, today),
    };
    if (counted) {
      const streak = summary.daily.streak;
      toast?.show?.([{ emoji: '☀️', name: 'Daily Sprinkle complete!', hint: streak > 1 ? `🔥 ${streak} days in a row!` : 'Come back tomorrow for a new one' }]);
    }
    return summary;
  }

  return {
    kind: 'daily',
    update,
    decorateSummary,
    dispose() {},
    get progress() { return last ?? publish(); },
    get challenge() { return challenge; },
  };
}
