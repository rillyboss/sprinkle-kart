/**
 * Progress + unlocks. OWNER: progression/unlocks workstream.
 *
 *   race-start   reset this race's own event tally
 *   race:*       tally items / bonks / drift turbos / boosts per human (fallback
 *                for summaries without `stats`; see src/game/raceStats.js)
 *   race-end     record the RaceSummary (stats, per-track and per-racer results)
 *                with the rule engine and push every newly earned racer / track
 *                into `summary.unlocks` as { kind, id } (the results screen
 *                celebrates them in order)
 *   gp-end       record the Grand Prix (grandPrixFinished / cupsWon / cups[cupId])
 *                and push newly earned content into `gp.unlocks`
 *
 * Unlocks happen when ANY human player reaches a rule (a shared family save).
 * Only REGISTERED content is evaluated, so a racer / track that is not built
 * yet gets its own celebration the first race after it ships. A summary or GP
 * result is only ever counted once (idempotent if an event is re-emitted).
 * With the parent "unlock everything" switch on, earned ids are still saved
 * but not celebrated (everything is already playable).
 */
import { createRaceStats } from '../game/raceStats.js';
import { entriesFrom } from '../progress/engine.js';
import { CHARACTERS } from '../characters/index.js';
import { TRACKS } from '../tracks/index.js';

/** Race events that feed the per-human tally. */
export const TALLY_EVENTS = Object.freeze(['item-use', 'bonked', 'drift-boost', 'boost', 'item-box', 'bump']);

/** Engine entries for the registered content (app.unlockEntries overrides, for tests / tools). */
export function registeredEntries(app = {}) {
  if (typeof app.unlockEntries === 'function') return app.unlockEntries();
  if (Array.isArray(app.unlockEntries)) return app.unlockEntries;
  return entriesFrom(CHARACTERS, TRACKS);
}

const celebrate = (progress) => {
  try { return !progress.loadProgress?.()?.unlockAll; } catch { return true; }
};

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'progress-unlocks',
  order: 40,
  install(bus, app) {
    let tally = createRaceStats();
    const seen = new WeakSet();
    const push = (list, fresh) => {
      if (!Array.isArray(list)) return;
      for (const u of fresh) if (!list.some((x) => x?.id === u.id)) list.push({ kind: u.kind, id: u.id });
    };
    const offs = [
      bus.on('race-start', () => { tally = createRaceStats(); }),
      ...TALLY_EVENTS.map((type) => bus.on(`race:${type}`, (e) => tally.onEvent({ type, ...e }))),
      bus.on('race-end', (summary) => {
        const progress = app.progress;
        if (!progress || !summary || typeof summary !== 'object' || seen.has(summary)) return;
        seen.add(summary);
        const t = tally;
        tally = createRaceStats(); // a restart without race-start never double-counts
        if (typeof progress.recordRace !== 'function') {
          // Minimal progress API (older saves module / fakes): legacy trophy + Cotton Candy Girl.
          if (!summary.winner || summary.mode === 'time-trial') return;
          progress.recordWin?.(summary.trackId);
          if (progress.unlock?.('cotton-candy-girl')) push(summary.unlocks, [{ kind: 'character', id: 'cotton-candy-girl' }]);
          return;
        }
        const fresh = progress.recordRace(summary, { entries: registeredEntries(app), tallies: (pi) => t.forPlayer(pi) });
        if (celebrate(progress)) push(summary.unlocks, fresh);
      }),
      bus.on('gp-end', (gp) => {
        const progress = app.progress;
        if (!progress?.recordGrandPrix || !gp || typeof gp !== 'object' || seen.has(gp)) return;
        seen.add(gp);
        const fresh = progress.recordGrandPrix(gp, { entries: registeredEntries(app) });
        if (!Array.isArray(gp.unlocks)) gp.unlocks = [];
        if (celebrate(progress)) push(gp.unlocks, fresh);
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};
