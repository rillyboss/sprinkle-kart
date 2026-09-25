/**
 * Kid-friendly progress text for locked content + the Sticker Book totals.
 * Pure (no DOM, no storage): pass the progress object in.
 *
 *   progressInfo(rule, p)       ruleProgress + { count: '1/3', best: 'Best so far: 3rd', text, short }
 *   progressLine(rule, p)       "Win 3 races — 1/3 ⭐" (short hint + count)
 *   STAT_BOOK                   [key, emoji, label] rows for the Sticker Book totals page
 */
import { ruleProgress, progressCount } from './engine.js';
import { describeUnlockShort } from './describeUnlock.js';
import { LINEUP_CUPS } from '../content/lineup.js';

const ORD = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** Best place so far that is relevant to a track / cup-track rule ('' if none or not relevant). */
function bestSoFar(rule, p) {
  const tracks = p?.tracks || {};
  if (!rule || (rule.result !== 'win' && rule.result !== 'top3')) return '';
  let ids = [];
  if (rule.type === 'track') ids = [rule.trackId];
  else if (rule.type === 'cup-track') ids = LINEUP_CUPS.find((c) => c.id === rule.cupId)?.trackIds ?? [];
  else return '';
  const places = ids.map((id) => tracks[id]?.bestPlace).filter((x) => Number.isInteger(x) && x >= 1);
  return places.length ? `Best so far: ${ORD(Math.min(...places))}` : '';
}

/**
 * @param {object|null} rule UnlockRule
 * @param {object} p progress
 */
export function progressInfo(rule, p) {
  const pr = ruleProgress(rule, p);
  const count = progressCount(pr);
  const best = pr.done ? '' : bestSoFar(rule, p);
  const text = count ? `${count} ⭐` : best;
  const short = count ? `${count} ⭐` : best.replace('Best so far:', 'Best:');
  return { ...pr, count, best, text, short };
}

/** "Win 3 races — 1/3 ⭐" — short hint plus how far along (hint alone for yes/no rules). */
export function progressLine(rule, p) {
  if (!rule) return '';
  const info = progressInfo(rule, p);
  const hint = describeUnlockShort(rule);
  return info.text ? `${hint} — ${info.text}` : hint;
}

/** Sticker Book "Our totals" rows: [statKey, emoji, label]. */
export const STAT_BOOK = Object.freeze([
  ['racesFinished', '🏁', 'Races finished'],
  ['wins', '🏆', 'Races won'],
  ['podiums', '🥉', 'Top-3 finishes'],
  ['itemsUsed', '🎁', 'Items used'],
  ['bonksGiven', '💫', 'Friendly bonks'],
  ['bonked', '🌀', 'Happy twirls'],
  ['miniTurbos', '🔥', 'Drift turbos'],
  ['itemBoxes', '📦', 'Item boxes popped'],
  ['boosts', '🚀', 'Zoomy boosts'],
  ['multiplayerRaces', '👯', 'Races with friends'],
  ['kidAssistFinishes', '✨', 'Kid-Assist races'],
  ['timeTrialsFinished', '⏱️', 'Time Trials'],
  ['grandPrixFinished', '🏅', 'Grand Prix finished'],
  ['cupsWon', '👑', 'Cups won'],
  ['recordsSet', '⭐', 'Records set'],
]);

/** Drift turbo breakdown rows: [statKey, emoji, label]. */
export const TURBO_BOOK = Object.freeze([
  ['miniTurbos1', '💙', 'Mini'],
  ['miniTurbos2', '💗', 'Super'],
  ['miniTurbos3', '🌈', 'Rainbow'],
]);

export { ORD as ordinalText };
