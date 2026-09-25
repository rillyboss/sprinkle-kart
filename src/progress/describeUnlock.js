/**
 * Friendly, kid-readable unlock hints from an UnlockRule (see ./schema.js).
 *
 *   describeUnlock(rule)  -> hint for tiles/cards, e.g. "Win a race to unlock!"
 *   describeUnlockShort(rule) -> compact hint for crowded grids, e.g. "Top 3: Starlight Galaxy"
 *   unlockDetail(rule, kind) -> a longer sentence for info panels
 *
 * Names come from the content lineup so hints work even for tracks/cups that
 * are not built yet. OWNER: progression/unlocks workstream (may reword freely;
 * keep it short, friendly and without numbers kids can't read where possible).
 */
import { lineupTrack, lineupCup } from '../content/lineup.js';

const trackName = (id) => lineupTrack(id)?.name ?? 'a secret track';
const cupName = (id) => lineupCup(id)?.name ?? 'a secret cup';

const plural = (n, one, many) => (n === 1 ? one : many.replace('#', String(n)));

const STAT_TEXT = {
  racesFinished: (n) => plural(n, 'Finish a race', 'Finish # races'),
  wins: (n) => plural(n, 'Win a race', 'Win # races'),
  podiums: (n) => plural(n, 'Finish in the top 3', 'Finish in the top 3 # times'),
  itemsUsed: (n) => plural(n, 'Use an item', 'Use # items'),
  bonksGiven: (n) => plural(n, 'Bonk a racer with an item', 'Bonk racers # times with items'),
  miniTurbos: (n) => plural(n, 'Do a drift turbo', 'Do # drift turbos'),
  timeTrialsFinished: (n) => plural(n, 'Finish a Time Trial', 'Finish # Time Trials'),
  multiplayerRaces: (n) => plural(n, 'Race with a friend', 'Race # times with a friend'),
  kidAssistFinishes: (n) => plural(n, 'Finish a race with Kid-Assist on', 'Finish # races with Kid-Assist on'),
  grandPrixFinished: (n) => plural(n, 'Finish a Grand Prix', 'Finish # Grand Prix cups'),
  cupsWon: (n) => plural(n, 'Win a Grand Prix cup', 'Win # Grand Prix cups'),
};

const RESULT_ON = { win: 'Win on', top3: 'Finish top 3 on', finish: 'Finish a race on' };
const RESULT_DISTINCT = { win: 'Win on # different tracks', top3: 'Finish top 3 on # different tracks', finish: 'Finish on # different tracks' };

/** Short hint (ends with "to unlock!"). Unknown/invalid rules get a gentle generic hint. */
export function describeUnlock(rule) {
  if (!rule) return '';
  let text = null;
  switch (rule.type) {
    case 'stat': text = STAT_TEXT[rule.stat]?.(rule.count ?? 1) ?? null; break;
    case 'track': text = RESULT_ON[rule.result] ? `${RESULT_ON[rule.result]} ${trackName(rule.trackId)}` : null; break;
    case 'cup-track':
      text = rule.result === 'win' ? `Win on any ${cupName(rule.cupId)} track`
        : rule.result === 'top3' ? `Finish top 3 on any ${cupName(rule.cupId)} track`
          : rule.result === 'finish' ? `Finish a race on any ${cupName(rule.cupId)} track` : null;
      break;
    case 'distinct-tracks': text = RESULT_DISTINCT[rule.result]?.replace('#', String(rule.count)) ?? null; break;
    default: break;
  }
  return text ? `${text} to unlock!` : 'Keep racing to unlock!';
}

/**
 * Longer friendly sentence for info panels.
 * @param {object|null} rule
 * @param {'character'|'track'} [kind]
 */
export function unlockDetail(rule, kind = 'character') {
  if (!rule) return '';
  const who = kind === 'track' ? 'a brand-new track' : 'a sweet new racer';
  if (rule.type === 'stat' && rule.stat === 'wins' && rule.count === 1) return `Finish in 1st place to meet ${who}…`;
  return `${describeUnlock(rule).replace(/ to unlock!$/, '')} to meet ${who}…`;
}

const SHORT_STAT = {
  racesFinished: (n) => plural(n, 'Finish a race', 'Finish # races'),
  wins: (n) => plural(n, 'Win a race', 'Win # races'),
  podiums: (n) => plural(n, 'Top 3 once', 'Top 3 × #'),
  itemsUsed: (n) => plural(n, 'Use an item', 'Use # items'),
  bonksGiven: (n) => plural(n, 'Bonk a racer', 'Bonk # racers'),
  miniTurbos: (n) => plural(n, 'Drift turbo', '# drift turbos'),
  timeTrialsFinished: (n) => plural(n, 'Do a Time Trial', '# Time Trials'),
  multiplayerRaces: (n) => plural(n, 'Race a friend', 'Race friends × #'),
  kidAssistFinishes: (n) => plural(n, 'Finish w/ Kid-Assist', '# Kid-Assist races'),
  grandPrixFinished: (n) => plural(n, 'Finish a Grand Prix', '# Grand Prix'),
  cupsWon: (n) => plural(n, 'Win a cup', 'Win # cups'),
};
const SHORT_RESULT = { win: 'Win', top3: 'Top 3', finish: 'Finish' };

/** Compact hint for crowded grids (no "to unlock!"); the full sentence goes in detail panels. */
export function describeUnlockShort(rule) {
  if (!rule) return '';
  const r = SHORT_RESULT[rule.result];
  switch (rule.type) {
    case 'stat': return SHORT_STAT[rule.stat]?.(rule.count ?? 1) ?? 'Keep racing!';
    case 'track': return r ? `${r}: ${trackName(rule.trackId)}` : 'Keep racing!';
    case 'cup-track': return r ? `${r}: any ${cupName(rule.cupId)}` : 'Keep racing!';
    case 'distinct-tracks': return r ? `${r} on ${rule.count} tracks` : 'Keep racing!';
    default: return 'Keep racing!';
  }
}
