/**
 * Saved progress (unlocks, trophies, stats) in localStorage. Every access is
 * wrapped so private windows / blocked storage just fall back to memory.
 *
 * Shape: see ./schema.js (emptyProgress). OWNER: progression/unlocks workstream.
 * `isUnlocked(id)` is THE single source of truth for “may a player use this
 * character / track” for every other module.
 */
import { emptyProgress, mergeProgress, defaultSettings } from './schema.js';
import { ID_ALIASES } from '../content/idAliases.js';
import { applyRaceSummary, applyGrandPrix, evaluateUnlocks, lineupEntries } from './engine.js';

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
      if (raw) {
        memory = mergeProgress(JSON.parse(raw));
        // a renamed racer/track id (content/idAliases.js) was migrated: write the new ids back once
        if (Object.keys(ID_ALIASES).some((old) => raw.includes(`"${old}"`))) save();
      }
    } catch { /* ignore corrupt / blocked storage */ }
  }
  return memory;
}

function save() {
  const ls = storage();
  if (!ls) return;
  try { ls.setItem(KEY, JSON.stringify(memory)); } catch { /* ignore */ }
}

/** May a player use this racer / track? Earned, or a grown-up turned on "unlock everything". */
export function isUnlocked(id) {
  const p = loadProgress();
  return p.unlockAll === true || p.unlocked.includes(id);
}

/** Earned by playing (ignores the parent "unlock everything" switch). */
export function isEarned(id) {
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

/**
 * For the "reset progress" option and tests. `keepSettings` keeps the
 * volumes / Kid-Assist default (the Settings screen's reset keeps them).
 */
export function resetProgress({ keepSettings = false } = {}) {
  const settings = keepSettings ? { ...loadProgress().settings } : null;
  memory = emptyProgress();
  if (settings) memory.settings = { ...memory.settings, ...settings };
  save();
}

/* ---------------- v2: stats + rule engine ---------------- */

/**
 * Apply `fn(progress)` to the loaded progress and save. `fn` mutates the
 * object it gets (a merged, sanitised copy) and may return a value.
 */
export function update(fn) {
  loadProgress();
  const draft = mergeProgress(JSON.parse(JSON.stringify(memory)));
  const result = fn(draft);
  memory = mergeProgress(draft);
  save();
  return result;
}

/**
 * Earn every entry whose rule is now met (see engine.js evaluateUnlocks).
 * @param {{kind, id, unlock}[]} [entries] defaults to the whole lineup
 * @returns {{kind:'character'|'track', id:string}[]} newly earned, in order
 */
export function evaluate(entries = lineupEntries()) {
  return update((p) => {
    const fresh = evaluateUnlocks(p, entries);
    for (const u of fresh) p.unlocked.push(u.id);
    return fresh;
  });
}

/**
 * Record a finished race (RaceSummary) and earn what it unlocked.
 * @returns {{kind, id}[]} newly earned
 */
export function recordRace(summary, { entries = lineupEntries(), tallies = null } = {}) {
  update((p) => applyRaceSummary(p, summary, { tallies }));
  return evaluate(entries);
}

/** Record a finished Grand Prix (GrandPrixResult) and earn what it unlocked. */
export function recordGrandPrix(gp, { entries = lineupEntries() } = {}) {
  update((p) => applyGrandPrix(p, gp));
  return evaluate(entries);
}

/** Parent gate switch: every racer and track becomes available (earned list is kept). */
export function setUnlockAll(on) {
  update((p) => { p.unlockAll = !!on; });
  return loadProgress().unlockAll;
}

/** @returns {{ music: number, sfx: number, kidAssistDefault: boolean }} */
export function getSettings() {
  return { ...defaultSettings(), ...(loadProgress().settings || {}) };
}

/** Merge a settings patch (clamped / validated by mergeProgress) and save. */
export function setSettings(patch = {}) {
  update((p) => { p.settings = { ...p.settings, ...patch }; });
  return getSettings();
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
    memory.stats.recordsSet = (Number.isFinite(memory.stats.recordsSet) ? memory.stats.recordsSet : 0) + 1;
    save();
  }
  return { newBestRace, newBestLap, previous, record };
}
