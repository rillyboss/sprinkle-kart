/**
 * Per-track gameplay modifiers (TrackDef.gameplay), normalised once per race.
 *
 * The Race puts the result on `env.gameplay` (the 3rd argument of
 * `stepKart(kart, input, env, dt)`) and on `race.gameplay`, so physics code
 * reads track modifiers without knowing about tracks:
 *
 *   const g = env.gameplay ?? DEFAULT_GAMEPLAY;
 *   p.hopY = Math.sin(...) * T.hopHeight * g.hopBoost;
 *
 * Fields (all multipliers, 1 = normal):
 *   gravity   how strongly karts are pulled down (hop / airtime / landing); Moonbounce Base uses ~0.55
 *   hopBoost  drift-hop height
 * Any extra keys a track sets are passed through untouched (agree new ones in
 * ARCHITECTURE.md §10 first). OWNER: architect (shape); the driving-feel
 * workstream decides what the multipliers do in Kart.js.
 */

export const DEFAULT_GAMEPLAY = Object.freeze({ gravity: 1, hopBoost: 1 });

/** Range each known multiplier is clamped to (keeps a typo from breaking physics). */
export const GAMEPLAY_LIMITS = Object.freeze({ gravity: [0.2, 2], hopBoost: [0.5, 3] });

/**
 * @param {object|null|undefined} gameplay TrackDef.gameplay
 * @returns {Readonly<{gravity:number, hopBoost:number}>}
 */
export function normalizeGameplay(gameplay) {
  const out = { ...DEFAULT_GAMEPLAY };
  if (gameplay && typeof gameplay === 'object') {
    for (const [k, v] of Object.entries(gameplay)) {
      const lim = GAMEPLAY_LIMITS[k];
      if (!lim) { out[k] = v; continue; }
      if (Number.isFinite(v)) out[k] = Math.min(lim[1], Math.max(lim[0], v));
    }
  }
  return Object.freeze(out);
}
