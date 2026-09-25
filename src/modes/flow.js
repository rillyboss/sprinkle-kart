/**
 * Menu-flow glue for the modes (pure, unit tested): what picking a mode does
 * to the shared menu draft, and how the RaceSetup a flow finishes with gets
 * its mode. OWNER: modes + timing workstream.
 *
 * - Grand Prix swaps track select for cup select (draft.skip / cup-select's when()).
 * - Time Trial is a solo run: only P1 picks a racer; the rest of the family
 *   stays joined in draft.partyJoin and comes back afterwards
 *   (setup.partyPlayers -> menuPrevious() in src/game/setup.js).
 */
import { modeId } from './rules.js';

/** Put the whole family back into the join state (after a Time Trial pick is undone). */
export function restoreParty(draft) {
  if (draft?.partyJoin) {
    draft.joinState = draft.partyJoin;
    draft.partyJoin = null;
  }
  return draft;
}

/**
 * Apply a mode pick to the menu draft (mutates and returns it).
 * @param {object} draft ctx.draft ({ joinState, skip:Set, mode, ... })
 * @param {'free'|'grand-prix'|'time-trial'} mode
 */
export function applyModeChoice(draft, mode) {
  const m = modeId(mode);
  restoreParty(draft);
  draft.mode = m;
  if (!draft.skip) draft.skip = new Set();
  if (m === 'grand-prix') draft.skip.add('track-select');
  else draft.skip.delete('track-select');
  if (m === 'time-trial') {
    const players = draft.joinState?.players ?? [];
    if (players.length > 1) {
      draft.partyJoin = draft.joinState;
      draft.joinState = { ...draft.joinState, players: players.slice(0, 1).map((p) => ({ ...p, playerIndex: 0 })) };
    }
  }
  return draft;
}

/**
 * The RaceSetup a menu run finished with, completed from the draft: `mode`
 * (track select doesn't know it) and, for a Time Trial, `partyPlayers`.
 */
export function finalizeSetup(setup, draft) {
  if (!setup) return setup;
  const mode = modeId(setup.mode ?? draft?.mode);
  const out = { ...setup, mode };
  if (mode === 'time-trial') {
    out.players = (setup.players || []).slice(0, 1);
    const party = draft?.partyJoin?.players;
    if (party?.length > 1) {
      const picks = new Map((draft.charPicks || []).map((p) => [p.deviceId, p.characterId]));
      for (const p of out.players) picks.set(p.deviceId, p.characterId);
      out.partyPlayers = party.map((p) => ({
        playerIndex: p.playerIndex,
        deviceId: p.deviceId,
        easyDrive: !!p.easyDrive,
        characterId: picks.get(p.deviceId) ?? out.players[0]?.characterId,
      }));
    }
  }
  return out;
}
