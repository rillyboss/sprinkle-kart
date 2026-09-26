/**
 * Version identity for the online handshake (NETWORKING.md §7.2).
 *
 *   PROTOCOL_VERSION  bumped by any wire change.
 *   buildId()         the deploy (`__SK_BUILD__`, a git sha baked in by vite.config.js; 'dev' elsewhere). Shown
 *                     in the debug overlay; a different build with the same content still plays together.
 *   contentHash()     FNV-1a 32 over everything that makes two machines simulate or draw the same race: racer
 *                     ids + stats, track ids + laps + width + control points + item-box rows + boost pads,
 *                     TUNING, SPEED_CLASSES, RACERS_PER_RACE and PROTOCOL_VERSION. Every push to main redeploys
 *                     Pages, so a friend whose tab was opened before a content change gets the friendly
 *                     "Different game version — everyone refresh the page 🔄" instead of racing on a different
 *                     track (net review #9).
 *
 * Pure and deterministic (object keys are sorted, functions skipped, numbers rounded to 6 decimals so float
 * printing can never differ between engines).
 * OWNER: WS7 (online game integration).
 */
import { TRACKS } from '../tracks/index.js';
import { CHARACTERS } from '../characters/index.js';
import { TUNING } from '../race/tuning.js';
import { SPEED_CLASSES, RACERS_PER_RACE } from '../config.js';
import { PROTOCOL } from './session/wire.js';

export const PROTOCOL_VERSION = PROTOCOL;

/** FNV-1a 32 of a string (UTF-16 code units). */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A canonical string for plain data (sorted keys, no functions, rounded numbers). */
export function canonical(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'function') return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => typeof v[k] !== 'function').map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return 'null';
}

/** The simulated content, as plain data (exported for tests). */
export function contentSummary({ tracks = TRACKS, characters = CHARACTERS, tuning = TUNING, speedClasses = SPEED_CLASSES } = {}) {
  return {
    protocol: PROTOCOL_VERSION,
    racersPerRace: RACERS_PER_RACE,
    racers: [...characters].map((c) => ({ id: c.id, stats: c.stats ?? null })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    tracks: [...tracks].map((t) => ({
      id: t.id, laps: t.laps ?? null, width: t.width ?? null, controlPoints: t.controlPoints ?? null,
      itemBoxRows: t.itemBoxRows ?? null, boostPads: t.boostPads ?? null,
    })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    tuning,
    speedClasses,
  };
}

let cached = null;
/** This bundle's content hash (u32; computed once). */
export function contentHash(opts) {
  if (opts) return fnv1a32(canonical(contentSummary(opts)));
  cached ??= fnv1a32(canonical(contentSummary()));
  return cached;
}

/** The deploy id baked in at build time (vite.config.js `define`), or 'dev'. */
export function buildId() {
  // eslint-disable-next-line no-undef
  return typeof __SK_BUILD__ !== 'undefined' && __SK_BUILD__ ? String(__SK_BUILD__) : 'dev';
}

/** Ids this bundle knows (a SETUP naming anything else came from a different version). */
export const knownTrackIds = () => new Set(TRACKS.map((t) => t.id));
export const knownCharacterIds = () => new Set(CHARACTERS.map((c) => c.id));

/**
 * Does this machine have everything a NetRaceSetup names? (An old tab must never fall back to TRACKS[0] or an
 * unknown racer online.) Returns the list of unknown ids (empty = fine).
 * @param {object} setup
 * @param {{ trackIds?: Set<string>, characterIds?: Set<string> }} [known]
 */
export function unknownSetupIds(setup, { trackIds = knownTrackIds(), characterIds = knownCharacterIds() } = {}) {
  const out = [];
  if (setup?.mode !== 'battle' && !trackIds.has(setup?.trackId)) out.push(`track:${setup?.trackId}`);
  for (const p of setup?.participants ?? []) if (!characterIds.has(p.characterId)) out.push(`racer:${p.characterId}`);
  for (const id of setup?.cpuIds ?? []) if (!characterIds.has(id)) out.push(`racer:${id}`);
  return [...new Set(out)];
}
