/**
 * Fun Goals — a set of achievement stickers beyond the unlocks ("Drift 100
 * times", "Finish every track", "Win with every racer", "Win a Bubble Battle"
 * ...). Shown on their own page of the Sticker Book and celebrated with a
 * little sticker toast when earned. PURE (no DOM, no storage): the progress
 * object is passed in; src/systems/funGoals.js applies it to the save.
 *
 * Saved inside progress as `goals` (kept by mergeProgress as an unknown key,
 * wiped by "Start a fresh Sticker Book"):
 *
 *   goals: {
 *     earned:   { [goalId]: 'YYYY-MM-DD' },       // when each sticker was earned
 *     counters: { battlesPlayed, battlesWon, bubblesPopped, teamRaces, teamWins, dailyDone, ... },
 *   }
 *
 * GoalRule (plain JSON on each goal):
 *   { type: 'stat', stat, count }            progress.stats[stat] reaches count
 *   { type: 'counter', counter, count }      goals.counters[counter] reaches count
 *   { type: 'every-track', field }           every lineup track has tracks[id][field] > 0
 *   { type: 'every-racer', field }           every lineup racer has racers[id][field] > 0
 *   { type: 'distinct-racers', field, count } that many racers with racers[id][field] > 0
 *   { type: 'every-cup' }                    every cup won at least once
 *   { type: 'full-book' }                    every racer and track earned (not the parent switch)
 *
 * OWNER: showcase features & modes.
 */
import { LINEUP_CHARACTERS, LINEUP_TRACKS, LINEUP_CUPS } from '../content/lineup.js';

/** Extra counters the Fun Goals keep (the rest come from progress.stats). */
export const GOAL_COUNTERS = Object.freeze([
  'battlesPlayed',  // Bubble Pop Battles finished (any humans in them)
  'battlesWon',     // battles a human won (shared 1st counts)
  'bubblesPopped',  // bubbles popped by humans
  'teamRaces',      // Team Races finished
  'teamWins',       // Team Races won by Team Sprinkle
  'dailyDone',      // Daily Sprinkle challenges completed
  'cleanWins',      // wins without getting bonked once
]);

const G = (id, emoji, name, hint, rule, group) => Object.freeze({ id, emoji, name, hint, rule: Object.freeze(rule), group });

/** Every Fun Goal, in Sticker Book order. */
export const GOALS = Object.freeze([
  G('first-finish', '🏁', 'First Finish!', 'Finish your very first race', { type: 'stat', stat: 'racesFinished', count: 1 }, 'race'),
  G('race-buddy', '🎈', 'Race Buddy', 'Finish 10 races', { type: 'stat', stat: 'racesFinished', count: 10 }, 'race'),
  G('race-marathon', '🎡', 'Race Marathon', 'Finish 50 races', { type: 'stat', stat: 'racesFinished', count: 50 }, 'race'),
  G('first-win', '🥇', 'Winner Winner!', 'Win a race', { type: 'stat', stat: 'wins', count: 1 }, 'race'),
  G('champion', '👑', 'Champion Crown', 'Win 10 races', { type: 'stat', stat: 'wins', count: 10 }, 'race'),
  G('podium-pal', '🥉', 'Podium Pal', 'Finish in the top 3 in 10 races', { type: 'stat', stat: 'podiums', count: 10 }, 'race'),
  G('clean-win', '🌟', 'Not a Scratch', 'Win a race without getting bonked once', { type: 'counter', counter: 'cleanWins', count: 1 }, 'race'),
  G('drift-master', '🌀', 'Drift Master', 'Do 100 drift turbos', { type: 'stat', stat: 'miniTurbos', count: 100 }, 'drive'),
  G('rainbow-turbo', '🌈', 'Rainbow Rider', 'Do 10 rainbow drift turbos', { type: 'stat', stat: 'miniTurbos3', count: 10 }, 'drive'),
  G('zoom-zoom', '🚀', 'Zoom Zoom', 'Zoom through 200 boosts', { type: 'stat', stat: 'boosts', count: 200 }, 'drive'),
  G('surprise-fan', '🎁', 'Surprise Box Fan', 'Pop 100 item boxes', { type: 'stat', stat: 'itemBoxes', count: 100 }, 'items'),
  G('friendly-bonker', '🎯', 'Friendly Bonker', 'Bonk racers 50 times with items', { type: 'stat', stat: 'bonksGiven', count: 50 }, 'items'),
  G('world-explorer', '🗺️', 'World Explorer', 'Finish a race on every track', { type: 'every-track', field: 'finishes' }, 'explore'),
  G('dress-up', '🎭', 'Dress-Up Party', 'Race with 10 different racers', { type: 'distinct-racers', field: 'races', count: 10 }, 'explore'),
  G('best-friends', '💞', 'Best Friends Forever', 'Win a race with every racer', { type: 'every-racer', field: 'wins' }, 'explore'),
  G('cup-collector', '🏆', 'Cup Collector', 'Win every Grand Prix cup', { type: 'every-cup' }, 'explore'),
  G('cup-runner', '🎀', 'Cup Runner', 'Finish a whole Grand Prix', { type: 'stat', stat: 'grandPrixFinished', count: 1 }, 'modes'),
  G('ghost-chaser', '👻', 'Ghost Chaser', 'Finish 5 Time Trials', { type: 'stat', stat: 'timeTrialsFinished', count: 5 }, 'modes'),
  G('record-breaker', '📈', 'Record Breaker', 'Set 10 new best times', { type: 'stat', stat: 'recordsSet', count: 10 }, 'modes'),
  G('bubble-popper', '🫧', 'Bubble Popper', 'Play a Bubble Battle', { type: 'counter', counter: 'battlesPlayed', count: 1 }, 'modes'),
  G('last-one-bobbing', '🛁', 'Last One Bobbing', 'Win a Bubble Battle', { type: 'counter', counter: 'battlesWon', count: 1 }, 'modes'),
  G('pop-pop-pop', '💦', 'Pop Pop Pop!', 'Pop 50 bubbles in Bubble Battles', { type: 'counter', counter: 'bubblesPopped', count: 50 }, 'modes'),
  G('team-spirit', '🤝', 'Team Spirit', 'Win a Team Race', { type: 'counter', counter: 'teamWins', count: 1 }, 'modes'),
  G('dream-team', '🎉', 'Dream Team', 'Win 5 Team Races', { type: 'counter', counter: 'teamWins', count: 5 }, 'modes'),
  G('daily-sprinkler', '☀️', 'Daily Sprinkler', 'Complete 3 Daily Sprinkles', { type: 'counter', counter: 'dailyDone', count: 3 }, 'modes'),
  G('family-fun', '👨‍👩‍👧', 'Family Fun', 'Race 10 times with 2 or more players', { type: 'stat', stat: 'multiplayerRaces', count: 10 }, 'family'),
  G('teddy-helper', '🧸', 'Teddy Helper', 'Finish 5 races with Kid-Assist on', { type: 'stat', stat: 'kidAssistFinishes', count: 5 }, 'family'),
  G('sticker-superstar', '📒', 'Sticker Superstar', 'Unlock every racer and track', { type: 'full-book' }, 'family'),
]);

export const getGoal = (id) => GOALS.find((g) => g.id === id) ?? null;

const num = (v) => (Number.isFinite(v) ? v : 0);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function emptyGoals() {
  return { earned: {}, counters: Object.fromEntries(GOAL_COUNTERS.map((k) => [k, 0])) };
}

/** Sanitise a saved `goals` object (junk dropped, new counters start at 0). */
export function mergeGoals(saved) {
  const out = emptyGoals();
  if (!isObj(saved)) return out;
  if (isObj(saved.earned)) {
    for (const [id, when] of Object.entries(saved.earned)) if (getGoal(id) && typeof when === 'string') out.earned[id] = when;
  }
  if (isObj(saved.counters)) {
    for (const [k, v] of Object.entries(saved.counters)) if (Number.isFinite(v) && v >= 0) out.counters[k] = v;
  }
  return out;
}

const lockable = () => [...LINEUP_CHARACTERS, ...LINEUP_TRACKS].filter((x) => x.unlock);

/**
 * How far along a goal is.
 * @returns {{ current: number, target: number, done: boolean, ratio: number }}
 */
export function goalProgress(goal, p) {
  const rule = goal?.rule;
  const goals = mergeGoals(p?.goals);
  let current = 0;
  let target = 1;
  switch (rule?.type) {
    case 'stat': current = num(p?.stats?.[rule.stat]); target = rule.count; break;
    case 'counter': current = num(goals.counters[rule.counter]); target = rule.count; break;
    case 'every-track':
      target = LINEUP_TRACKS.length;
      current = LINEUP_TRACKS.filter((t) => num(p?.tracks?.[t.id]?.[rule.field]) > 0).length;
      break;
    case 'every-racer':
      target = LINEUP_CHARACTERS.length;
      current = LINEUP_CHARACTERS.filter((c) => num(p?.racers?.[c.id]?.[rule.field]) > 0).length;
      break;
    case 'distinct-racers':
      target = rule.count;
      current = Object.values(p?.racers || {}).filter((r) => num(r?.[rule.field]) > 0).length;
      break;
    case 'every-cup':
      target = LINEUP_CUPS.length;
      current = LINEUP_CUPS.filter((c) => num(p?.cups?.[c.id]?.wins) > 0).length;
      break;
    case 'full-book': {
      const all = lockable();
      target = all.length;
      const earned = new Set(Array.isArray(p?.unlocked) ? p.unlocked : []);
      current = all.filter((x) => earned.has(x.id)).length;
      break;
    }
    default: break;
  }
  target = Math.max(1, target);
  const done = current >= target;
  return { current: Math.min(current, target), target, done, ratio: Math.max(0, Math.min(1, current / target)) };
}

/** Goals whose rule is met but that are not earned yet (in GOALS order). */
export function newlyMetGoals(p) {
  const earned = mergeGoals(p?.goals).earned;
  return GOALS.filter((g) => !earned[g.id] && goalProgress(g, p).done);
}

/**
 * Mark goals earned (mutates and returns p.goals). `today` = 'YYYY-MM-DD'.
 * @returns {object[]} the goals that were newly earned
 */
export function earnGoals(p, today = todayString()) {
  const fresh = newlyMetGoals(p);
  p.goals = mergeGoals(p.goals);
  for (const g of fresh) p.goals.earned[g.id] = today;
  return fresh;
}

/**
 * Count the mode results a RaceSummary carries into goal counters (mutates p.goals).
 *   summary.battle  -> battlesPlayed, battlesWon, bubblesPopped
 *   summary.team    -> teamRaces, teamWins
 *   summary.daily   -> dailyDone (when summary.daily.done)
 *   a win where the winning human never got bonked -> cleanWins
 */
export function applyGoalCounters(p, summary) {
  p.goals = mergeGoals(p.goals);
  const c = p.goals.counters;
  if (!summary || typeof summary !== 'object') return p;
  const humans = Array.isArray(summary.humans) ? summary.humans : [];
  if (summary.mode === 'battle' && summary.battle) {
    c.battlesPlayed += 1;
    if (summary.battle.humanWinner) c.battlesWon += 1;
    c.bubblesPopped += Math.max(0, num(summary.battle.humanPops));
  }
  if (summary.mode === 'team' && summary.team) {
    c.teamRaces += 1;
    if (summary.team.winner === (summary.team.homeTeam ?? 'sprinkle')) c.teamWins += 1;
  }
  if (summary.daily?.done) c.dailyDone += 1;
  if (summary.mode !== 'battle' && summary.mode !== 'time-trial') {
    const clean = humans.some((h) => h.finished && !h.estimated && h.place === 1 && h.stats && num(h.stats.bonked) === 0);
    if (clean) c.cleanWins += 1;
  }
  return p;
}

/** Local date as 'YYYY-MM-DD'. */
export function todayString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Sticker Book model for the Fun Goals page. */
export function goalsBookModel(p) {
  const earned = mergeGoals(p?.goals).earned;
  const goals = GOALS.map((g) => {
    const pr = goalProgress(g, p);
    return { ...g, earned: !!earned[g.id], when: earned[g.id] ?? null, progress: pr, count: pr.target > 1 ? `${pr.current}/${pr.target}` : '' };
  });
  return { goals, earned: goals.filter((g) => g.earned).length, total: goals.length };
}
