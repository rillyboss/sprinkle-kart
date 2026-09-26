/**
 * Lap / race records during a race: "Best lap!" and "New record!" flashes,
 * then on race-end the best human times go to the saved records
 * (progress.submitRecord) and who set them to the record-holders store.
 * The outcome is attached to the summary as `summary.records`
 * (see submitRaceRecords() in src/modes/timing.js) for the results screens.
 *
 * OWNER: modes + timing workstream.
 */
import { lapCelebration, lapFlashText, raceRecordEligible, submitRaceRecords, formatTime } from '../modes/timing.js';
import { recordHolders as sharedHolders } from '../modes/recordHolders.js';

/** Build the system (tests pass their own holders store). */
export function createTimingRecords({ holders = sharedHolders } = {}) {
  return {
    id: 'timing-records',
    order: 20,
    install(bus, app) {
      let recordLap = null;
      let recordRace = null;
      let eligible = false;

      const lapDone = (e, s) => {
        const k = e.kart;
        if (!s?.isHuman?.(k) || !k.lapTimes?.length) return;
        const lapTime = k.lapTimes[k.lapTimes.length - 1];
        const kind = lapCelebration({ lapTime, earlierLaps: k.lapTimes.slice(0, -1), recordLap });
        if (kind === 'record-lap') recordLap = lapTime;
        if (!kind) return;
        s.flash(k, lapFlashText(kind, lapTime));
        s.sfx(kind === 'record-lap' ? 'timing-record' : 'timing-best-lap', { pan: s.panFor?.(k) ?? 0 });
      };

      const offs = [
        bus.on('race-start', (info, s) => {
          let rec = { bestRace: null, bestLap: null };
          try { rec = app.progress?.getRecord?.(info.trackId) ?? rec; } catch { /* ignore */ }
          recordLap = rec.bestLap ?? null;
          recordRace = rec.bestRace ?? null;
          eligible = raceRecordEligible(info.laps, s?.trackDef);
        }),
        bus.on('race:lap', lapDone),
        bus.on('race:finish', (e, s) => {
          lapDone(e, s);
          const k = e.kart;
          if (!s?.isHuman?.(k) || !eligible || !(recordRace > 0) || !(k.finishTime < recordRace)) return;
          recordRace = k.finishTime;
          s.flash(k, `New record! 🏆 ${formatTime(k.finishTime)}`);
          s.sfx('timing-record', { pan: s.panFor?.(k) ?? 0 });
        }),
        bus.on('race-end', (summary, s) => {
          if (summary?.mode === 'battle') return; // no finish line, no best times
          const res = submitRaceRecords(app.progress, summary, s?.trackDef);
          try { holders?.remember(res); } catch { /* ignore */ }
          summary.records = res;
        }),
      ];
      return () => offs.forEach((off) => off());
    },
  };
}

export default createTimingRecords();
