/**
 * Saved progress (unlocks + trophies) in localStorage. Every access is
 * wrapped so private windows / blocked storage just fall back to memory.
 */
const KEY = 'sprinkle-kart-progress-v1';

let memory = { unlocked: [], wins: 0, trophies: {} };

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
  memory = { unlocked: [], wins: 0, trophies: {} };
  save();
}
