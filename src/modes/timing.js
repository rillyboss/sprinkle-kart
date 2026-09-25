/**
 * Race timing helpers (pure, DOM-free, unit tested): time formatting, lap
 * splits, "Best lap!" / "New record!" decisions and which times of a race are
 * offered to the saved records (progress.submitRecord).
 *
 * OWNER: modes + timing workstream.
 */
import { DEFAULT_LAPS } from '../config.js';

const valid = (t) => Number.isFinite(t) && t > 0;

/** 83.456 -> "1:23.45" (minutes:seconds.centiseconds). Bad input -> "--:--.--". */
export function formatTime(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--.--';
  const cs = Math.floor(sec * 100 + 1e-6);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/**
 * Signed gap: -0.42 -> "-0.42", 1.5 -> "+1.50", 75 -> "+1:15.00", 0 -> "±0.00".
 * (negative = faster / ahead). Bad input -> "".
 */
export function formatDelta(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  const cs = Math.round(Math.abs(sec) * 100);
  if (cs === 0) return '±0.00';
  const sign = sec < 0 ? '-' : '+';
  const a = cs / 100;
  if (a >= 60) return `${sign}${formatTime(a)}`;
  return `${sign}${a.toFixed(2)}`;
}

/** Smallest valid time of a list, or null. */
export function bestOf(times = []) {
  let best = null;
  for (const t of times || []) if (valid(t) && (best === null || t < best)) best = t;
  return best;
}

/** Seconds on the lap the kart is driving now (0 before GO; frozen at the last lap once finished). */
export function currentLapTime(kart, race) {
  if (!kart || !race || race.state === 'countdown') return 0;
  if (kart.finished) return kart.lapTimes?.length ? kart.lapTimes[kart.lapTimes.length - 1] : 0;
  const start = kart.phys?.lastLapStart ?? 0;
  return Math.max(0, (race.time ?? 0) - start);
}

/** Race clock shown for a kart: race time while driving, its finish time once finished. */
export function raceClock(kart, race) {
  if (!race || race.state === 'countdown') return 0;
  if (kart?.finished && Number.isFinite(kart.finishTime) && !kart.finishEstimated) return kart.finishTime;
  return Math.max(0, race.time ?? 0);
}

/** Completed laps as [{ lap, time, best }] (best = the fastest lap so far). */
export function lapSplits(lapTimes = []) {
  const best = bestOf(lapTimes);
  return (lapTimes || []).map((time, i) => ({ lap: i + 1, time, best: best !== null && time === best }));
}

/**
 * What to celebrate when a human completes a lap.
 *   'record-lap'  faster than the saved record lap (and than every lap this race so far)
 *   'best-lap'    faster than this kart's earlier laps this race (not on lap 1)
 *   null          nothing special
 * @param {object} o
 * @param {number} o.lapTime       the lap just completed
 * @param {number[]} o.earlierLaps this kart's earlier laps this race
 * @param {number|null} o.recordLap the best lap to beat for a record (saved record, lowered live as the race goes)
 */
export function lapCelebration({ lapTime, earlierLaps = [], recordLap = null }) {
  if (!valid(lapTime)) return null;
  if (valid(recordLap) && lapTime < recordLap) return 'record-lap';
  const own = bestOf(earlierLaps);
  if (own !== null && lapTime < own) return 'best-lap';
  return null;
}

/** Friendly flash text for a lap celebration. */
export function lapFlashText(kind, lapTime) {
  if (kind === 'record-lap') return `New record lap! ⭐ ${formatTime(lapTime)}`;
  if (kind === 'best-lap') return `Best lap! ✨ ${formatTime(lapTime)}`;
  return '';
}

/** Race times only count as a record when the race had the track's normal lap count. */
export function raceRecordEligible(laps, trackDef) {
  const normal = trackDef?.laps || DEFAULT_LAPS;
  return Number.isFinite(laps) && laps === normal;
}

/**
 * The best times of a race to offer to the saved records, with who set them.
 * Humans only; a race time needs a real (not estimated) finish and the
 * normal lap count; a lap time needs a completed lap.
 * @param {object} summary RaceSummary (src/game/summary.js)
 * @param {object} trackDef
 * @returns {{ raceTime: number|null, bestLap: number|null,
 *   raceBy: {playerIndex:number, characterId:string}|null, lapBy: {playerIndex:number, characterId:string}|null }}
 */
export function recordCandidates(summary, trackDef) {
  const out = { raceTime: null, bestLap: null, raceBy: null, lapBy: null };
  if (!summary) return out;
  const eligible = raceRecordEligible(summary.laps, trackDef);
  for (const h of summary.humans || []) {
    const who = { playerIndex: h.playerIndex, characterId: h.characterId };
    if (eligible && h.finished && !h.estimated && valid(h.finishTime) && (out.raceTime === null || h.finishTime < out.raceTime)) {
      out.raceTime = h.finishTime;
      out.raceBy = who;
    }
    const lap = bestOf(h.lapTimes);
    if (lap !== null && (out.bestLap === null || lap < out.bestLap)) {
      out.bestLap = lap;
      out.lapBy = who;
    }
  }
  return out;
}

/**
 * Offer a race's times to the saved records via the progress API.
 * @param {{ getRecord: Function, submitRecord: Function }} progress
 * @returns {{ trackId, previous, record, newBestRace, newBestLap, raceTime, bestLap, raceBy, lapBy }}
 */
export function submitRaceRecords(progress, summary, trackDef) {
  const c = recordCandidates(summary, trackDef);
  const trackId = summary?.trackId ?? trackDef?.id;
  const empty = { bestRace: null, bestLap: null };
  let res = { newBestRace: false, newBestLap: false, previous: empty, record: empty };
  try {
    if (progress?.submitRecord && trackId) res = progress.submitRecord(trackId, { raceTime: c.raceTime, bestLap: c.bestLap }) || res;
    else if (progress?.getRecord && trackId) { const r = progress.getRecord(trackId); res = { ...res, previous: r, record: r }; }
  } catch { /* storage problems must never break the results */ }
  return { trackId, ...c, ...res };
}

/**
 * Time Trial verdict for the results screen.
 * @param {number|null} time    this run (null = did not finish)
 * @param {number|null} before  the record before this run (null = first run)
 * @returns {{ kind: 'first'|'record'|'close'|'slower'|'dnf', delta: number|null }}
 */
export function trialVerdict(time, before) {
  if (!valid(time)) return { kind: 'dnf', delta: null };
  if (!valid(before)) return { kind: 'first', delta: null };
  const delta = time - before;
  if (delta < 0) return { kind: 'record', delta };
  return { kind: delta <= 1.5 ? 'close' : 'slower', delta };
}

/** Kid-friendly line for a verdict. */
export function trialVerdictText(v) {
  switch (v?.kind) {
    case 'record': return `New record! 🏆 ${formatDelta(v.delta)} faster!`;
    case 'first': return 'Your very first time here! 🌟';
    case 'close': return `Sooo close! Only ${formatDelta(v.delta)} 💖`;
    case 'slower': return `${formatDelta(v.delta)} — you can do it! 💪`;
    default: return 'Keep zooming, superstar! 🍭';
  }
}
