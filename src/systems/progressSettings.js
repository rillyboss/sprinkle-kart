/**
 * Saved settings -> the running game. OWNER: progression/unlocks workstream.
 *
 *   install     apply the saved music / sound volumes to the AudioManager
 *   frame       "Kid-Assist for new players" default: a player who JOINS in the
 *               menus (title / join screen) starts with Kid-Assist on. Players
 *               carried over from the previous race keep their own choice, and
 *               anyone can still switch it off with Y / Tab.
 *
 * Zero-conflict: this watches `menus.draft.joinState` instead of editing the
 * shared join reducer (see applyKidAssistDefault, unit tested).
 */

/**
 * Turn Kid-Assist on for players whose device has not been seen in this run.
 * Pure: returns the SAME state object when nothing changes.
 * @param {{players: Array<{deviceId:string, easyDrive:boolean}>}} joinState
 * @param {Set<string>} seen device ids already handled (mutated)
 * @param {boolean} on the saved default
 */
export function applyKidAssistDefault(joinState, seen, on) {
  if (!joinState || !Array.isArray(joinState.players)) return joinState;
  let changed = false;
  const players = joinState.players.map((p) => {
    if (!p || seen.has(p.deviceId)) return p;
    seen.add(p.deviceId);
    if (!on || p.easyDrive) return p;
    changed = true;
    return { ...p, easyDrive: true };
  });
  return changed ? { ...joinState, players } : joinState;
}

const JOIN_SCREENS = new Set(['title', 'join']);

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'progress-settings',
  order: 41,
  install(bus, app) {
    const progress = app.progress;
    const settings = () => {
      try { return progress?.getSettings?.() ?? null; } catch { return null; }
    };
    const s = settings();
    if (s) {
      try { app.audio?.setVolume?.({ music: s.music, sfx: s.sfx }); } catch { /* audio is optional */ }
    }
    let draft = null;
    let seen = new Set();
    const off = bus.on('frame', () => {
      const menus = app.menus;
      const d = menus?.draft;
      if (!d || !d.joinState) return;
      if (d !== draft) {
        // A new menu run: players carried over from the last race keep their choice.
        draft = d;
        seen = new Set(d.joinState.players.map((p) => p.deviceId));
        return;
      }
      if (!JOIN_SCREENS.has(menus.screenId)) return;
      if (!d.joinState.players.some((p) => p && !seen.has(p.deviceId))) return; // nobody new: no storage read
      const next = applyKidAssistDefault(d.joinState, seen, !!settings()?.kidAssistDefault);
      if (next !== d.joinState) {
        d.joinState = next;
        try { menus.screen?.refresh?.(); } catch { /* ignore */ }
      }
    });
    return off;
  },
};
