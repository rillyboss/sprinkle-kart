/**
 * "May a player use this?" for characters AND tracks.
 *
 *   isAvailable(def, isUnlocked?)   true if the content has no unlock rule, or has been earned
 *
 * `isUnlocked` defaults to the saved progress (src/progress/progress.js). Menus,
 * CPU fill and cups all go through this, so the progression engine only has
 * to keep `progress.isUnlocked(id)` right (including a parent "unlock all").
 */
import { isUnlocked as savedIsUnlocked } from './progress.js';

export function isLockable(def) {
  return !!def && (!!def.unlock || def.locked === true);
}

export function isAvailable(def, isUnlocked = savedIsUnlocked) {
  if (!def) return false;
  if (!isLockable(def)) return true;
  try {
    return !!isUnlocked(def.id);
  } catch {
    return false;
  }
}
