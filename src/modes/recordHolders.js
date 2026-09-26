/**
 * Who set each best time (the character used), for the Records screen.
 * The times themselves live in saved progress (progress.getRecord /
 * submitRecord, owned by progression); this small store only remembers the
 * racer next to each record time, and only trusts it while the time matches.
 *
 *   localStorage['sprinkle-kart-record-holders-v1'] =
 *     { [trackId]: { race?: { time, characterId }, lap?: { time, characterId } } }
 *
 * OWNER: modes + timing workstream.
 */
import { jsonStore, defaultBackend } from './storage.js';
import { formatTime } from './timing.js';

export const HOLDERS_KEY = 'sprinkle-kart-record-holders-v1';

const same = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.0005;

export function createRecordHolders(backend = defaultBackend()) {
  const store = jsonStore(HOLDERS_KEY, backend);
  return {
    /** Remember who set a time. kind = 'race' | 'lap'. */
    set(trackId, kind, time, characterId) {
      if (!trackId || !Number.isFinite(time) || !characterId || (kind !== 'race' && kind !== 'lap')) return false;
      const all = store.read();
      all[trackId] = { ...(all[trackId] || {}), [kind]: { time, characterId } };
      return store.write(all);
    },
    /** The characterId behind a record time, or null when unknown / out of date. */
    holder(trackId, kind, time) {
      const h = store.read()[trackId]?.[kind];
      return h && same(h.time, time) && typeof h.characterId === 'string' ? h.characterId : null;
    },
    /** Update from a submitRaceRecords() result (only the times that became records). */
    remember(result) {
      if (!result?.trackId) return;
      if (result.newBestRace && result.raceBy) this.set(result.trackId, 'race', result.raceTime, result.raceBy.characterId);
      if (result.newBestLap && result.lapBy) this.set(result.trackId, 'lap', result.bestLap, result.lapBy.characterId);
    },
    clear: () => store.clear(),
  };
}

/** The shared instance (browser localStorage). */
export const recordHolders = createRecordHolders();

/**
 * Rows for the Records screen, grouped by cup.
 * @param {Array<{cup: object|null, tracks: object[]}>} groups from groupTracksByCup()
 * @param {object} o
 * @param {(trackId:string)=>{bestRace:number|null,bestLap:number|null}} o.getRecord
 * @param {(trackId:string, kind:string, time:number)=>string|null} o.holder
 * @param {(trackDef:object)=>boolean} [o.isLocked]
 */
export function recordRows(groups, { getRecord, holder, isLocked = () => false }) {
  return groups.map((g) => ({
    cup: g.cup,
    rows: g.tracks.map((t) => {
      let rec = { bestRace: null, bestLap: null };
      try { rec = getRecord(t.id) || rec; } catch { /* ignore */ }
      const locked = (() => { try { return !!isLocked(t); } catch { return true; } })();
      return {
        track: t,
        locked,
        bestRace: rec.bestRace ?? null,
        bestLap: rec.bestLap ?? null,
        raceText: formatTime(rec.bestRace),
        lapText: formatTime(rec.bestLap),
        raceBy: rec.bestRace != null ? holder(t.id, 'race', rec.bestRace) : null,
        lapBy: rec.bestLap != null ? holder(t.id, 'lap', rec.bestLap) : null,
      };
    }),
  }));
}

/** How many tracks have any saved time. */
export function recordCount(groups) {
  return groups.reduce((n, g) => n + g.rows.filter((r) => r.bestRace != null || r.bestLap != null).length, 0);
}
