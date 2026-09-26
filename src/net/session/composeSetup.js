/**
 * NetRaceSetup (SETUP, host → all; NETWORKING.md §10.5) and fair grid slots (§8.6).
 *
 * Kart order (= race.karts order = kart id, the same on every machine): CPUs in
 * `cpuIds` order, then humans by global player index ascending (the wire order).
 * Grid position is separate: every participant carries a `gridSlot`. CPUs keep
 * the front slots 0..C-1; humans fill C..C+H-1 by a SEEDED SHUFFLE from the race
 * seed (Free Race, Team, Battle and Grand Prix race 1), and in Grand Prix races
 * 2+ by human GP points with the leader LAST (the "leader starts behind"
 * spirit of gpCpuGrid). The first draft ordered humans by join order, which put
 * the host's kids on the best human slot every race.
 *
 * OWNER: WS6 (session, lobby & screens).
 */
import { allPlayers } from './lobby.js';
import { RACERS_PER_RACE } from '../../config.js';

export const NET_SETUP_PROTOCOL = 1;

/** mulberry32 — the same tiny seeded generator the sim uses. */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded rng (pure: returns a new array). */
export function seededShuffle(list, seed) {
  const a = [...list];
  const rng = seededRng((seed ^ 0x9e3779b9) >>> 0);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** How many CPUs fill the grid for `humans` players (rules.cpus: false / a number caps it). */
export function cpuCountFor(humans, rules = {}) {
  const room = Math.max(0, RACERS_PER_RACE - humans);
  if (rules?.cpus === false || rules?.cpus === 0) return 0;
  if (Number.isInteger(rules?.cpus) && rules.cpus >= 0) return Math.min(room, rules.cpus);
  return room;
}

/**
 * Grid slots for the humans (global indices, ascending) behind C CPUs.
 * @param {number[]} pis humans' global indices
 * @param {{ seed: number, cpuCount: number, gp?: { raceIndex?: number, points?: Record<number, number> } }} o
 * @returns {Map<number, number>} globalPi → gridSlot
 */
export function humanGridSlots(pis, { seed, cpuCount, gp = null }) {
  const C = cpuCount;
  const shuffled = seededShuffle(pis, seed >>> 0);
  let order = shuffled;
  if (gp && Number(gp.raceIndex) >= 1 && gp.points) {
    // GP races 2+: fewest points in front, the leader last; ties keep the seeded shuffle order.
    const pts = (pi) => Number(gp.points[pi]) || 0;
    order = [...shuffled].sort((a, b) => pts(a) - pts(b) || shuffled.indexOf(a) - shuffled.indexOf(b));
  }
  const slots = new Map();
  order.forEach((pi, k) => slots.set(pi, C + k));
  return slots;
}

/**
 * @param {object} lobby LobbyState (the roster; §10.3)
 * @param {object} hostChoice { mode, trackId, cupId, arenaId, speedClass, laps, customTrackIds? }
 * @param {{ seed: number, raceId: number, cpuIds: string[], rules?: object,
 *           gp?: { raceIndex: number, raceCount: number, points?: Record<number, number> },
 *           cpuPaints?: Record<string, string> }} o
 * @returns {object} NetRaceSetup
 */
export function composeOnlineSetup(lobby, hostChoice, { seed, raceId, cpuIds = [], rules = {}, gp = null, cpuPaints = null } = /** @type {any} */ ({})) {
  const humans = allPlayers(lobby);
  const C = cpuIds.length;
  const slots = humanGridSlots(humans.map((p) => p.globalPi), { seed, cpuCount: C, gp });
  const participants = [
    ...cpuIds.map((characterId, i) => ({
      kartId: i,
      gridSlot: i,
      playerIndex: null,
      houseId: null,
      seat: null,
      characterId,
      easyDrive: false,
      paintId: cpuPaints?.[characterId] ?? 'original',
    })),
    ...humans.map((p, k) => ({
      kartId: C + k,
      gridSlot: slots.get(p.globalPi),
      playerIndex: p.globalPi,
      houseId: p.houseId,
      seat: p.seat,
      characterId: p.characterId,
      easyDrive: !!p.easyDrive,
      paintId: p.paintId ?? 'original',
    })),
  ];
  const c = hostChoice ?? {};
  const setup = {
    raceId: raceId >>> 0,
    seed: seed >>> 0,
    mode: c.mode ?? 'free',
    speedClass: c.speedClass ?? 'zippy',
    laps: c.laps,
    participants,
    cpuIds: [...cpuIds],
    rules: structuredClone(rules ?? {}),
    protocol: NET_SETUP_PROTOCOL,
  };
  if (setup.mode === 'battle') setup.arenaId = c.arenaId ?? null;
  else setup.trackId = c.trackId ?? null;
  if (c.cupId) setup.cupId = c.cupId;
  if (Array.isArray(c.customTrackIds)) setup.customTrackIds = [...c.customTrackIds];
  if (gp) setup.gp = { raceIndex: gp.raceIndex | 0, raceCount: gp.raceCount | 0 };
  return setup;
}

/**
 * This machine's players inside a NetRaceSetup (each machine maps its own seats to
 * local devices; deviceId is filled locally and never sent).
 * @returns {Array<{ playerIndex: number, seat: number, kartId: number, characterId: string, easyDrive: boolean }>}
 */
export function localParticipants(setup, houseId) {
  return (setup?.participants ?? [])
    .filter((p) => p.houseId === houseId && p.playerIndex !== null)
    .sort((a, b) => a.seat - b.seat);
}
