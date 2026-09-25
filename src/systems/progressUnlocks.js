/**
 * Progress + unlocks on race end. OWNER: progression/unlocks workstream —
 * replace the hard-coded Cotton Candy Girl rule below with the rule engine
 * (evaluate every CharacterDef.unlock / TrackDef.unlock against the stats in
 * src/progress/schema.js) and record the stats from the RaceSummary.
 *
 * Contract: push every newly earned item into `summary.unlocks` as
 * { kind: 'character' | 'track', id }; the results screen celebrates them in order.
 */
import { UNLOCK_CHARACTER_ID } from '../config.js';

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'progress-unlocks',
  order: 40,
  install(bus, app) {
    return bus.on('race-end', (summary) => {
      const progress = app.progress;
      if (!progress || !summary.winner || summary.mode === 'time-trial') return;
      progress.recordWin(summary.trackId);
      if (progress.unlock(UNLOCK_CHARACTER_ID)) summary.unlocks.push({ kind: 'character', id: UNLOCK_CHARACTER_ID });
    });
  },
};
