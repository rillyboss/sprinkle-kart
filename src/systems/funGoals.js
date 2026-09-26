/**
 * Fun Goals (src/progress/goals.js): after every race / battle ('race-end')
 * and every finished Grand Prix ('gp-end') count the mode results into the
 * goal counters, earn every goal that is now met and celebrate each new
 * sticker with a toast (src/ui/goalToasts.js). Runs after progress-unlocks
 * (order 40) so the race is already in the saved stats. The newly earned
 * goal ids are also pushed into `summary.goals` / `gp.goals` (optional collector).
 *
 * A summary / GP result is only ever counted once. Needs a progress module
 * with `update(fn)` (the real one); fakes without it are ignored.
 * OWNER: showcase features & modes.
 */
import { applyGoalCounters, earnGoals, todayString } from '../progress/goals.js';
import { createGoalToasts } from '../ui/goalToasts.js';

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'fun-goals',
  order: 45,
  install(bus, app) {
    const seen = new WeakSet();
    let toasts = null;
    const toast = (goals) => {
      if (!toasts) toasts = app.goalToasts ?? createGoalToasts({ sfx: (n) => app.audio?.sfx?.(n) });
      toasts.show(goals);
    };
    const record = (payload, withCounters) => {
      const progress = app.progress;
      if (!payload || typeof payload !== 'object' || seen.has(payload) || typeof progress?.update !== 'function') return [];
      seen.add(payload);
      const fresh = progress.update((p) => {
        if (withCounters) applyGoalCounters(p, payload);
        return earnGoals(p, todayString());
      }) || [];
      if (!Array.isArray(payload.goals)) payload.goals = [];
      for (const g of fresh) payload.goals.push(g.id);
      if (fresh.length) toast(fresh);
      return fresh;
    };
    const offs = [
      bus.on('race-end', (summary) => { record(summary, true); }),
      bus.on('gp-end', (gp) => { record(gp, false); }),
    ];
    return () => {
      offs.forEach((off) => off());
      toasts?.clear?.();
    };
  },
};
