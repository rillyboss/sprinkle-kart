/**
 * Saved progress (unlocks, trophies, stats) in localStorage. Every access is
 * wrapped so private windows / blocked storage just fall back to memory.
 *
 * Shape: see ./schema.js (emptyProgress). OWNER: progression/unlocks workstream.
 * `isUnlocked(id)` is THE single source of truth for “may a player use this
 * character / track” for every other module.
 */
import { emptyProgress } from './schema.js';

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
      if (raw) memory = { ...memory, ...JSON.parse(raw) };
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
