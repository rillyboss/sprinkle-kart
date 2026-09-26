/**
 * Pure view models for the Bubble Battle and Team Race results screens
 * (DOM-free, unit tested). The screens in src/ui/screens/ only render them.
 * OWNER: showcase features & modes.
 */
import { teamInfo, teamResultText, HOME_TEAM, AWAY_TEAM } from './team.js';
import { playerLabel } from '../net/session/playerLabel.js';

export const BATTLE_OPTIONS = Object.freeze([
  ['again', 'Battle again', '🔁'],
  ['next-track', 'Another arena', '🫧'],
  ['menu', 'Menu', '🏠'],
]);

export const TEAM_OPTIONS = Object.freeze([
  ['again', 'Rematch', '🔁'],
  ['next-track', 'Next track', '➡️'],
  ['menu', 'Menu', '🏠'],
]);

const MEDALS = ['🥇', '🥈', '🥉'];
export const medal = (place) => MEDALS[place - 1] ?? '';

/**
 * @param {object} battle summary.battle (src/modes/battleSession.js decorateSummary)
 * @param {(characterId: string) => string} [nameOf]
 * @returns {{ title: string, sub: string, humanWon: boolean, tie: boolean, rows: Array<object> }}
 */
export function battleResultModel(battle, nameOf = (id) => id) {
  const ranking = Array.isArray(battle?.ranking) ? battle.ranking : [];
  const winners = ranking.filter((r) => r.place === 1);
  const humanWinners = winners.filter((r) => !r.isCPU);
  const tie = winners.length > 1;
  const who = (r) => (r.isCPU ? nameOf(r.characterId) : playerLabel(r.playerIndex));
  let title;
  if (!winners.length) title = 'Bubble Battle!';
  else if (tie && humanWinners.length > 1) title = `${humanWinners.map(who).join(' & ')} share the win! 🫧`;
  else if (tie) title = "It's a bubbly tie! 🫧";
  else if (humanWinners.length) title = `${who(humanWinners[0])} is the last one bobbing! 🏆`;
  else title = `${nameOf(winners[0].characterId)} wins this one! 🫧`;
  const reason = battle?.reason;
  const sub = reason === 'time' ? 'Time! Most bubbles wins.'
    : reason === 'humans-out' ? 'All our bubbles popped — rematch? 💪'
      : reason === 'last' ? 'Everyone else is out of bubbles!' : '';
  const rows = ranking.map((r) => ({
    characterId: r.characterId,
    playerIndex: r.playerIndex,
    isCPU: !!r.isCPU,
    place: r.place,
    medal: medal(r.place),
    bubbles: Math.max(0, r.bubbles | 0),
    max: Math.max(1, r.max | 0),
    pops: Math.max(0, r.pops | 0),
    out: !!r.out,
    winner: r.place === 1,
  }));
  return { title, sub, humanWon: humanWinners.length > 0, tie, rows };
}

/**
 * @param {object} team summary.team (src/modes/teamSession.js decorateSummary)
 * @returns {{ title: string, sub: string, won: boolean, tie: boolean, sides: Array<object> }}
 */
export function teamResultModel(team) {
  const { title, sub } = teamResultText(team, team?.series ?? null);
  const rows = Array.isArray(team?.rows) ? team.rows : [];
  const side = (id) => {
    const info = teamInfo(id);
    return {
      id,
      name: info.name,
      emoji: info.emoji,
      color: info.color,
      total: team?.totals?.[id] ?? 0,
      winner: team?.winner === id,
      members: rows.filter((r) => r.team === id).map((r) => ({
        characterId: r.characterId, playerIndex: r.playerIndex ?? null, isCPU: !!r.isCPU, place: r.place, points: r.points ?? 0, medal: medal(r.place),
      })),
    };
  };
  return {
    title,
    sub,
    won: team?.winner === HOME_TEAM,
    tie: !!team && !team.winner,
    sides: [side(HOME_TEAM), side(AWAY_TEAM)],
  };
}
