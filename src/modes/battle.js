/**
 * Bubble Pop Battle — the rules (pure, DOM-free, unit tested).
 *
 * Every kart floats a few bubbles. An item that bonks a kart (gumdrop,
 * cupcake rocket, rainbow-star bump) pops ONE of its bubbles; a bubble shield
 * or star power keeps them safe. A kart with no bubbles left is "out": it keeps
 * driving as a cheering ghost (no items, nobody can bump it). The last kart
 * still bobbing wins; when the timer runs out the most bubbles wins (then the
 * most pops). Every second bubble a racer pops earns one of its own back
 * (a "bubble bonus", never above its starting count). If every human is out
 * the battle wraps up quickly so nobody waits around.
 *
 *   createBattle(racers, { timeLimit })      -> BattleState
 *   battlePop(state, victimId, byId, time)   -> { state, result: { kind: 'pop'|'out'|'none', ... } }
 *   battleTick(state, time)                  -> state (sets `over` when the battle ends)
 *   battleRanking(state)                     -> rows best first, shared places for exact ties
 *   battleView(state)                        -> what the HUD shows
 *   battleItem(bubbles, max, rng)            -> ItemId (battle odds: fewer bubbles = more help)
 *   loopTargetAhead(kart, karts, loopLength) -> { target, distance } | null (who a rocket chases)
 *
 * OWNER: showcase features & modes.
 */

/** Bubbles every racer starts with. */
export const BATTLE_BUBBLES = 3;
/** Extra bubbles for a player with Kid-Assist on (a gentle head start for little racers). */
export const KID_ASSIST_BONUS = 1;
/** Seconds a battle lasts at most. */
export const BATTLE_TIME = 120;
/** Seconds between the last human popping out and the end screen. */
export const HUMANS_OUT_GRACE = 2.5;
/** Pops that earn a bubble back (0 = never). */
export const POPS_PER_BONUS = 2;
/** Seconds between the second-to-last kart going out and the end screen. */
export const LAST_BOBBING_GRACE = 1.2;

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/**
 * @typedef {Object} BattleRacer
 * @property {number} id            kart id
 * @property {string} characterId
 * @property {number|null} playerIndex  null for CPUs
 * @property {boolean} isCPU
 * @property {number} bubbles       bubbles left
 * @property {number} max           bubbles at the start
 * @property {number} pops          bubbles this racer popped (others' bubbles only)
 * @property {number} popped        own bubbles lost
 * @property {number|null} outAt    battle time it ran out of bubbles
 * @property {number|null} outOrder 1 = the first one out
 */

/**
 * @param {Array<{id:number, characterId:string, playerIndex?:number|null, isCPU?:boolean, kidAssist?:boolean}>} racers
 * @param {{ timeLimit?: number, bubbles?: number }} [opts]
 */
export function createBattle(racers = [], { timeLimit = BATTLE_TIME, bubbles = BATTLE_BUBBLES, popsPerBonus = POPS_PER_BONUS } = {}) {
  const base = Math.max(1, Math.min(9, Math.round(num(bubbles, BATTLE_BUBBLES))));
  const list = (racers || []).map((r) => {
    const human = !r.isCPU && r.playerIndex !== null && r.playerIndex !== undefined;
    const max = base + (human && r.kidAssist ? KID_ASSIST_BONUS : 0);
    return {
      id: r.id,
      characterId: r.characterId,
      playerIndex: human ? r.playerIndex : null,
      isCPU: !human,
      bubbles: max,
      max,
      pops: 0,
      popped: 0,
      outAt: null,
      outOrder: null,
    };
  });
  return {
    time: 0,
    timeLimit: Math.max(10, num(timeLimit, BATTLE_TIME)),
    popsPerBonus: Math.max(0, Math.round(num(popsPerBonus, POPS_PER_BONUS))),
    racers: list,
    outCount: 0,
    endAt: null,     // battle time the end screen is due (a short grace after the deciding pop)
    endReason: null, // 'last' | 'time' | 'humans-out'
    over: null,      // { reason, time } once the battle has ended
  };
}

const find = (state, id) => state.racers.find((r) => r.id === id) || null;
export const aliveRacers = (state) => state.racers.filter((r) => r.bubbles > 0);
const humansOf = (state) => state.racers.filter((r) => !r.isCPU);

/**
 * Pop one of `victimId`'s bubbles (credited to `byId` unless it popped itself).
 * Ignored when the battle is over, the victim is unknown or already out.
 * Every `popsPerBonus`-th pop gives the popper a bubble back (`bonus: true`, up to its max).
 * @returns {{ state, result: { kind: 'pop'|'out'|'none', victim?: BattleRacer, by?: BattleRacer|null, left?: number, bonus?: boolean } }}
 */
export function battlePop(state, victimId, byId = null, time = state.time) {
  const none = { state, result: { kind: 'none' } };
  if (state.over) return none;
  const v = find(state, victimId);
  if (!v || v.bubbles <= 0) return none;
  const t = Math.max(state.time, num(time, state.time));
  const byRow = byId !== null && byId !== undefined && byId !== victimId ? find(state, byId) : null;
  let outCount = state.outCount;
  let bonus = false;
  const racers = state.racers.map((r) => {
    if (r === v) {
      const bubbles = r.bubbles - 1;
      const out = bubbles <= 0;
      if (out) outCount += 1;
      return { ...r, bubbles, popped: r.popped + 1, outAt: out ? t : r.outAt, outOrder: out ? outCount : r.outOrder };
    }
    if (r === byRow) {
      const pops = r.pops + 1;
      bonus = r.bubbles > 0 && state.popsPerBonus > 0 && pops % state.popsPerBonus === 0 && r.bubbles < r.max;
      return { ...r, pops, bubbles: r.bubbles + (bonus ? 1 : 0) };
    }
    return r;
  });
  const next = { ...state, time: t, racers, outCount };
  const victim = find(next, victimId);
  const by = byRow ? find(next, byRow.id) : null;
  return { state: scheduleEnd(next, t), result: { kind: victim.bubbles <= 0 ? 'out' : 'pop', victim, by, left: victim.bubbles, bonus } };
}

/** Work out whether (and when) the battle should end after a change. */
function scheduleEnd(state, t) {
  if (state.over || state.endAt !== null) return state;
  const alive = aliveRacers(state);
  if (alive.length <= 1 && state.racers.length > 1) return { ...state, endAt: t + LAST_BOBBING_GRACE, endReason: 'last' };
  const humans = humansOf(state);
  if (humans.length && humans.every((h) => h.bubbles <= 0)) return { ...state, endAt: t + HUMANS_OUT_GRACE, endReason: 'humans-out' };
  return state;
}

/**
 * Advance the battle clock; sets `over` = { reason, time } when it ends
 * ('last' = one kart still bobbing, 'time' = the timer ran out, 'humans-out').
 */
export function battleTick(state, time) {
  if (state.over) return state;
  const t = Math.max(state.time, num(time, state.time));
  let next = { ...state, time: t };
  if (next.endAt !== null && t >= next.endAt) return { ...next, over: { reason: next.endReason, time: t } };
  if (t >= next.timeLimit) return { ...next, over: { reason: 'time', time: t } };
  next = scheduleEnd(next, t);
  return next;
}

/** Seconds left on the battle clock (0..timeLimit). */
export const timeLeft = (state) => Math.max(0, state.timeLimit - state.time);

/**
 * Ranking, best first. Racers still bobbing come first (more bubbles, then
 * more pops, then fewer bubbles lost); then the ones that went out, the last
 * one out first. Exactly tied survivors share a place.
 * @returns {Array<BattleRacer & { place: number, out: boolean }>}
 */
export function battleRanking(state) {
  const alive = aliveRacers(state).sort((a, b) => b.bubbles - a.bubbles || b.pops - a.pops || a.popped - b.popped || a.id - b.id);
  const out = state.racers.filter((r) => r.bubbles <= 0).sort((a, b) => num(b.outOrder) - num(a.outOrder));
  const rows = [];
  alive.forEach((r, i) => {
    const prev = alive[i - 1];
    const tie = prev && prev.bubbles === r.bubbles && prev.pops === r.pops && prev.popped === r.popped;
    rows.push({ ...r, out: false, place: tie ? rows[i - 1].place : i + 1 });
  });
  out.forEach((r, i) => rows.push({ ...r, out: true, place: alive.length + i + 1 }));
  return rows;
}

/** Everyone sharing 1st place. */
export const battleWinners = (state) => battleRanking(state).filter((r) => r.place === 1);

/**
 * HUD model: the clock and every racer's bubbles (in kart order).
 * @returns {{ timeLeft: number, clock: string, hurry: boolean, alive: number, total: number,
 *   racers: Array<{ id, characterId, playerIndex, isCPU, bubbles, max, out }>, over: boolean }}
 */
export function battleView(state) {
  const left = timeLeft(state);
  return {
    timeLeft: left,
    clock: clockText(left),
    hurry: left <= 15 && !state.over,
    alive: aliveRacers(state).length,
    total: state.racers.length,
    racers: state.racers.map((r) => ({
      id: r.id, characterId: r.characterId, playerIndex: r.playerIndex, isCPU: r.isCPU, bubbles: r.bubbles, max: r.max, out: r.bubbles <= 0,
    })),
    over: !!state.over,
  };
}

/** 83.4 -> "1:24" (whole seconds, rounded up so "0:00" only shows at the very end). */
export function clockText(sec) {
  const s = Math.max(0, Math.ceil(num(sec) - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Battle item odds: poppers everywhere, and a kart with fewer bubbles gets more shields and stars. */
export function battleItemWeights(bubbles, max) {
  const m = Math.max(1, num(max, BATTLE_BUBBLES));
  const need = Math.max(0, Math.min(1, 1 - num(bubbles, m) / m)); // 0 = all bubbles, ~1 = last bubble
  return {
    'sprinkle-boost': 1.5,
    'triple-sprinkle': 0.5 + need,
    gumdrop: 4,
    'bubble-shield': 1.5 + need * 2.5,
    'cupcake-rocket': 3.5,
    'rainbow-star': 0.3 + need * 1.7,
  };
}

/** Pick a battle item. `rng` returns [0,1). */
export function battleItem(bubbles, max, rng = Math.random) {
  const w = battleItemWeights(bubbles, max);
  const entries = Object.entries(w);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  let x = rng() * total;
  for (const [id, v] of entries) {
    x -= v;
    if (x < 0) return id;
  }
  return entries[entries.length - 1][0];
}

/**
 * On a loop arena "ahead" wraps around: the nearest kart ahead along the road
 * (by arc length `s`), skipping `kart`, karts that are out and `skip(k)`.
 * Returns the target and the rocket's start distance in the TARGET's frame
 * (so ItemSystem's `target.distance - rocket.distance` is the real gap).
 * @param {object} kart the thrower ({ s, distance })
 * @param {object[]} karts
 * @param {number} loopLength path.length
 * @param {{ lead?: number, skip?: (k) => boolean }} [opts] lead = how far in front of the thrower the rocket spawns
 */
export function loopTargetAhead(kart, karts, loopLength, { lead = 2.5, skip = null } = {}) {
  const L = num(loopLength);
  if (!kart || !(L > 0)) return null;
  let best = null;
  let bestGap = Infinity;
  for (const k of karts || []) {
    if (!k || k === kart || k.battleOut || (skip && skip(k))) continue;
    let gap = (num(k.s) - num(kart.s)) % L;
    if (gap < 0) gap += L;
    if (gap < lead + 0.5) gap += L; // right alongside / just behind the spawn point: it's a full loop away
    if (gap < bestGap) { bestGap = gap; best = k; }
  }
  if (!best) return null;
  return { target: best, distance: num(best.distance) - (bestGap - lead) };
}
