/**
 * Saved progress (unlocks, trophies, stats) in localStorage. Every access is
 * wrapped so private windows / blocked storage just fall back to memory.
 *
 * Shape: see ./schema.js (emptyProgress). OWNER: progression/unlocks workstream.
 * `isUnlocked(id)` is THE single source of truth for “may a player use this
 * character / track” for every other module.
 */
import { emptyProgress, mergeProgress } from './schema.js';

export const PROGRESS_KEY = 'sprinkle-kart-progress-v1';
const KEY = PROGRESS_KEY;

let memory = emptyProgress();

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadProgress() {
  const ls = storage();
  if (ls) {
    try {
      const raw = ls.getItem(KEY);
      if (raw) memory = mergeProgress(JSON.parse(raw));
    } catch { /* ignore corrupt / blocked storage */ }
  }
  return memory;
}

function save() {
  const ls = storage();
  if (!ls) return;
  try { ls.setItem(KEY, JSON.stringify(memory)); } catch { /* ignore */ }
}

export function isUnlocked(id) {
  return loadProgress().unlocked.includes(id);
}

/** @returns {boolean} true if this call newly unlocked it. */
export function unlock(id) {
  loadProgress();
  if (memory.unlocked.includes(id)) return false;
  memory.unlocked.push(id);
  save();
  return true;
}

/** Record a human win on a track; returns updated progress. */
export function recordWin(trackId) {
  loadProgress();
  memory.wins += 1;
  memory.trophies[trackId] = (memory.trophies[trackId] || 0) + 1;
  save();
  return memory;
}

/** For the "reset progress" option and tests. */
export function resetProgress() {
  memory = emptyProgress();
  save();
}

/* ---------------- best-time records (written by modes+timing, stored here) ---------------- */

const validTime = (t) => Number.isFinite(t) && t > 0;

/**
 * Best times for a track (seconds), or nulls when none yet.
 * @param {string} trackId
 * @returns {{ bestRace: number|null, bestLap: number|null }}
 */
export function getRecord(trackId) {
  const r = loadProgress().records?.[trackId];
  return { bestRace: validTime(r?.bestRace) ? r.bestRace : null, bestLap: validTime(r?.bestLap) ? r.bestLap : null };
}

/**
 * Offer a finished run's times; keeps whichever is better and saves.
 * Invalid / missing times are ignored (e.g. an estimated finish passes no raceTime).
 * @param {string} trackId
 * @param {{ raceTime?: number|null, bestLap?: number|null }} times
 * @returns {{ newBestRace: boolean, newBestLap: boolean, previous: {bestRace:number|null, bestLap:number|null}, record: {bestRace:number|null, bestLap:number|null} }}
 */
export function submitRecord(trackId, { raceTime = null, bestLap = null } = {}) {
  const previous = getRecord(trackId);
  const newBestRace = validTime(raceTime) && (previous.bestRace === null || raceTime < previous.bestRace);
  const newBestLap = validTime(bestLap) && (previous.bestLap === null || bestLap < previous.bestLap);
  const record = {
    bestRace: newBestRace ? raceTime : previous.bestRace,
    bestLap: newBestLap ? bestLap : previous.bestLap,
  };
  if (newBestRace || newBestLap) {
    memory.records = { ...(memory.records || {}), [trackId]: record };
    save();
  }
  return { newBestRace, newBestLap, previous, record };
}
