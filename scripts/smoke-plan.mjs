/**
 * Pure planning helpers for scripts/smoke.mjs (unit-tested in tests/smoke.plan.test.js).
 *
 * Nothing here touches the browser: it turns (registered track ids, CLI filters,
 * environment) into a profile (viewport, timeouts, how long to drive) and an
 * ordered list of scenarios, so CI and local runs are predictable and testable.
 */

/** The original Sprinkle Cup: always smoke-tested in 1p and (locally) 4p. */
export const ORIGINAL_TRACK_IDS = Object.freeze(['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes']);

/** In CI (no GPU, SwiftShader on 4 vCPUs) only these tracks also run in 4p. */
export const CI_4P_TRACK_IDS = Object.freeze(['cotton-candy-castle', 'starlight-galaxy']);

/** The built-in non-race scenarios, in run order (smoke.mjs passes its FLOW_TESTS keys). Names double as filters. */
export const FLOW_SCENARIOS = Object.freeze(['menu-flow', 'menu-scale', 'gamepad-flow', 'results-unlock']);

const truthy = (v) => v !== undefined && v !== null && v !== '' && v !== '0' && String(v).toLowerCase() !== 'false';

function parseViewport(text, fallback) {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(text || '').trim());
  return m ? { width: Number(m[1]), height: Number(m[2]) } : fallback;
}

/**
 * Resolve the run profile from the environment.
 *
 *   CI=1                 → 'ci' profile: small viewport, generous timeouts, trimmed 4p set
 *   SMOKE_FULL=1         → 'full': 4p on every track (overrides CI trimming)
 *   SMOKE_VIEWPORT=WxH   → override the viewport
 *   SMOKE_TIMEOUT_SCALE  → multiply every timeout (default 1 locally, 4 in CI)
 *   SMOKE_DRIVE_SECONDS  → game seconds each race scenario drives after GO
 *   SMOKE_RETRIES        → re-runs of a failed scenario (default 1)
 *   SMOKE_PORT           → dev-server port (default 5190)
 *
 * @param {Record<string, string | undefined>} env
 */
export function resolveProfile(env = {}) {
  const ci = truthy(env.CI);
  const full = truthy(env.SMOKE_FULL);
  const name = full ? 'full' : ci ? 'ci' : 'local';
  const scale = Number(env.SMOKE_TIMEOUT_SCALE);
  const drive = Number(env.SMOKE_DRIVE_SECONDS);
  const retries = Number(env.SMOKE_RETRIES);
  const port = Number(env.SMOKE_PORT);
  return {
    name,
    ci,
    full,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 5190,
    viewport: parseViewport(env.SMOKE_VIEWPORT, ci ? { width: 800, height: 450 } : { width: 1280, height: 720 }),
    timeoutScale: Number.isFinite(scale) && scale > 0 ? scale : ci ? 4 : 1,
    // game-clock seconds of racing after GO (not wall-clock!)
    driveSeconds: Number.isFinite(drive) && drive > 0 ? drive : ci ? 2.5 : 4,
    retries: Number.isInteger(retries) && retries >= 0 ? Math.min(retries, 3) : 1,
  };
}

/** Scale a base timeout (ms) by the profile, never below the base. */
export function timeoutFor(profile, baseMs) {
  return Math.round(baseMs * Math.max(1, profile?.timeoutScale ?? 1));
}

/** Does a scenario name match the CLI filters (substring match, empty = everything)? */
export function wanted(filters, name) {
  return !filters.length || filters.some((f) => name.includes(f));
}

/**
 * The ordered scenario list.
 * @param {{ trackIds: string[], filters?: string[], profile: ReturnType<typeof resolveProfile>, flows?: string[] }} o
 * @returns {Array<{ name: string, kind: 'race', trackId: string, players: number } | { name: string, kind: 'flow' }>}
 */
export function planScenarios({ trackIds, filters = [], profile, flows = FLOW_SCENARIOS }) {
  const out = [];
  const ids = [...new Set(trackIds)];
  const fourP = (id) => {
    const named = filters.some((f) => f === id || f === `${id}-4p`);
    if (named || profile.full) return true;
    return profile.ci ? CI_4P_TRACK_IDS.includes(id) : ORIGINAL_TRACK_IDS.includes(id);
  };
  for (const id of ids) {
    const one = `${id}-1p`;
    if (wanted(filters, one)) out.push({ name: one, kind: 'race', trackId: id, players: 1 });
    const four = `${id}-4p`;
    if (fourP(id) && wanted(filters, four)) out.push({ name: four, kind: 'race', trackId: id, players: 4 });
  }
  const spectator = 'cotton-candy-castle-3p';
  if (ids.includes('cotton-candy-castle') && wanted(filters, spectator)) {
    out.push({ name: spectator, kind: 'race', trackId: 'cotton-candy-castle', players: 3 });
  }
  for (const name of flows) {
    // legacy short filters keep working: "menu" → menu-flow + menu-scale, "scale", "gamepad", "results"
    if (wanted(filters, name)) out.push({ name, kind: 'flow' });
  }
  return out;
}

/**
 * Did every kart make real forward progress? Returns human-readable problems.
 * @param {Array<{id:string, progress:number}>} before
 * @param {Array<{id:string, progress:number}>} after
 * @param {number} [minGain]
 */
export function stalledKarts(before, after, minGain = 5) {
  const problems = [];
  after.forEach((k, i) => {
    const b = before[i]?.progress ?? 0;
    const a = k.progress;
    if (!Number.isFinite(a)) problems.push(`${k.id} has a broken progress value (${a})`);
    else if (!(a > b + minGain)) problems.push(`${k.id} did not move (progress ${b.toFixed(1)} → ${a.toFixed(1)})`);
  });
  return problems;
}

/** Console noise we never treat as a failure. */
export function isIgnorableError(text) {
  return /favicon/i.test(text) || /fonts\.(googleapis|gstatic)\.com/.test(text);
}
