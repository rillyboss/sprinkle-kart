/**
 * Pure helpers for the game state machine (kept out of main.js so they can be
 * unit tested in node).
 */
import { RACERS_PER_RACE, MAX_PLAYERS, SPEED_CLASSES, DEFAULT_LAPS, UNLOCK_CHARACTER_ID } from '../config.js';

const TRUE_VALUES = new Set(['', '1', 'true', 'yes', 'on']);

function flag(q, name) {
  if (!q.has(name)) return false;
  return TRUE_VALUES.has(String(q.get(name)).toLowerCase());
}

function intParam(q, name, min, max, fallback) {
  if (!q.has(name)) return fallback;
  const n = parseInt(q.get(name), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Parse the debug URL params.
 * @param {string} search e.g. location.search
 */
export function parseDebugParams(search = '') {
  const q = new URLSearchParams(search);
  let quick = null;
  if (q.has('quick')) {
    const v = String(q.get('quick') || '').trim();
    quick = !v || TRUE_VALUES.has(v.toLowerCase()) ? 'default' : v;
  }
  const speed = q.get('speed');
  return {
    quick,
    players: intParam(q, 'players', 1, MAX_PLAYERS, 1),
    speed: speed && SPEED_CLASSES[speed] ? speed : 'zippy',
    autodrive: flag(q, 'autodrive'),
    fastFinish: flag(q, 'fastfinish'),
    unlockReset: flag(q, 'unlockreset'),
    cpus: q.has('cpus') ? intParam(q, 'cpus', 0, RACERS_PER_RACE - 1, null) : null,
    simSpeed: intParam(q, 'simspeed', 1, 8, 1),
    laps: q.has('laps') ? intParam(q, 'laps', 1, 9, null) : null,
  };
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick CPU racers: distinct characters the humans did not pick, from the
 * selectable (unlocked) list. If there are not enough, repeats are allowed so
 * the grid is always full. The special unlockable racer is only used as a CPU
 * once it has been unlocked (it is only in `selectable` then).
 * @param {string[]} humanIds characters picked by humans (may repeat)
 * @param {Array<{id:string}>} selectable unlocked CharacterDefs
 * @param {number} count
 * @returns {string[]} character ids
 */
export function pickCpuCharacters(humanIds, selectable, count, rng = Math.random) {
  if (count <= 0 || !selectable.length) return [];
  const taken = new Set(humanIds);
  const fresh = shuffle(selectable.filter((c) => !taken.has(c.id)), rng)
    // Keep Cotton Candy Girl as a treat for humans: CPUs only get her last.
    .sort((a, b) => (a.id === UNLOCK_CHARACTER_ID) - (b.id === UNLOCK_CHARACTER_ID));
  const out = fresh.slice(0, count).map((c) => c.id);
  let i = 0;
  const pool = shuffle(selectable, rng);
  while (out.length < count) out.push(pool[i++ % pool.length].id);
  return out;
}

/**
 * Participants in grid order: index 0 is the pole position. Humans start at
 * the back of the grid like classic kart games (P1 right at the very back).
 */
export function buildParticipants(humans, cpuIds) {
  const cpus = cpuIds.map((characterId) => ({ characterId, playerIndex: null, easyDrive: false }));
  const people = [...humans]
    .sort((a, b) => b.playerIndex - a.playerIndex)
    .map((p) => ({ characterId: p.characterId, playerIndex: p.playerIndex, easyDrive: !!p.easyDrive }));
  return [...cpus, ...people];
}

/** The track after `id` (wrapping). */
export function nextTrackId(id, tracks) {
  const i = tracks.findIndex((t) => t.id === id);
  return tracks[(i + 1) % tracks.length].id;
}

export function driftBoostText(level) {
  return ['', 'Mini-Turbo! 💙', 'Super Turbo! 💗', 'Rainbow Turbo! 🌈'][Math.max(0, Math.min(3, level | 0))] || 'Turbo!';
}

/** Device ids used for quick races: two keyboards, then virtual pads. */
export function quickDeviceIds(players) {
  return ['kb1', 'kb2', 'v2', 'v3'].slice(0, Math.max(1, Math.min(MAX_PLAYERS, players)));
}

/**
 * RaceSetup for ?quick=... (skips the menus).
 * @param {ReturnType<typeof parseDebugParams>} params
 * @param {{ addVirtualDevice?: Function }|null} input
 */
export function quickSetup(params, input, characters, tracks) {
  const track = tracks.find((t) => t.id === params.quick) || tracks[0];
  const selectable = characters.filter((c) => !c.locked);
  const players = quickDeviceIds(params.players).map((deviceId, i) => {
    if (deviceId.startsWith('v')) {
      try { input?.addVirtualDevice?.(deviceId, `Robo Driver ${i + 1}`); } catch { /* ignore */ }
    }
    return {
      playerIndex: i,
      deviceId,
      characterId: selectable[i % selectable.length].id,
      easyDrive: false,
    };
  });
  return {
    players,
    trackId: track.id,
    speedClass: params.speed,
    laps: params.laps ?? track.laps ?? DEFAULT_LAPS,
  };
}
