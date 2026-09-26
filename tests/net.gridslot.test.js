// composeOnlineSetup + fair grid slots (NETWORKING.md §8.6, §10.5; acceptance M1 #5).
import { describe, it, expect } from 'vitest';
import { composeOnlineSetup, humanGridSlots, seededShuffle, cpuCountFor, localParticipants, seededRng } from '../src/net/session/composeSetup.js';
import { createLobby, lobbyReduce } from '../src/net/session/lobby.js';
import { CHARACTERS } from '../src/characters/index.js';

const IDS = CHARACTERS.map((c) => c.id);
const run = (lobby, actions) => actions.reduce((l, a) => lobbyReduce(l, a).lobby, lobby);

/** houses [[2],[1],[1]]: the host house has 2 players, two guest houses have 1 each. */
function lobbyOf(sizes = [2, 1, 1]) {
  let l = createLobby({ label: 'SPRINKLE-4821' });
  sizes.forEach((n, i) => { l = run(l, [{ type: i === 0 ? 'house-join' : 'house-approve', isHost: i === 0, players: n }]); });
  let k = 0;
  for (const h of l.houses) for (const p of h.players) l = run(l, [{ type: 'pick', houseId: h.houseId, seat: p.seat, characterId: IDS[k++ % IDS.length], paintId: `paint-${k}` }]);
  return l;
}

describe('composeOnlineSetup', () => {
  it('orders karts: CPUs in cpuIds order, then humans by global index; the §10.5 fields', () => {
    const lobby = lobbyOf([2, 1, 1]);
    const cpuIds = IDS.slice(10, 14);
    const setup = composeOnlineSetup(lobby, { ...lobby.hostChoice, trackId: 'gumdrop-meadow', laps: 2 }, { seed: 1234, raceId: 7, cpuIds, rules: { items: true } });
    expect(setup).toMatchObject({ raceId: 7, seed: 1234, mode: 'free', trackId: 'gumdrop-meadow', speedClass: 'zippy', laps: 2, cpuIds, rules: { items: true }, protocol: 1 });
    expect(setup.participants.map((p) => p.kartId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(setup.participants.slice(0, 4).map((p) => p.characterId)).toEqual(cpuIds);
    expect(setup.participants.slice(0, 4).every((p) => p.playerIndex === null && p.houseId === null && p.seat === null && p.paintId === 'original')).toBe(true);
    expect(setup.participants.slice(4).map((p) => p.playerIndex)).toEqual([0, 1, 2, 3]);
    expect(setup.participants.slice(4).map((p) => p.houseId)).toEqual([0, 0, 1, 2]);
    expect(setup.participants[4]).toMatchObject({ seat: 0, paintId: 'paint-1', easyDrive: false });
    // CPUs keep the front slots 0..C-1; humans fill C..C+H-1
    expect(setup.participants.slice(0, 4).map((p) => p.gridSlot)).toEqual([0, 1, 2, 3]);
    expect(setup.participants.slice(4).map((p) => p.gridSlot).sort()).toEqual([4, 5, 6, 7]);
    expect(setup).not.toHaveProperty('arenaId');
    expect(JSON.parse(JSON.stringify(setup))).toEqual(setup); // plain data for SETUP
    expect(localParticipants(setup, 0).map((p) => p.playerIndex)).toEqual([0, 1]);
    expect(localParticipants(setup, 2).map((p) => p.kartId)).toEqual([7]);
  });

  it('battle uses arenaId; gp and cup fields travel; CPU paints come from the host', () => {
    const lobby = lobbyOf([1, 1]);
    const b = composeOnlineSetup(lobby, { mode: 'battle', arenaId: 'bubble-bath', speedClass: 'cozy', laps: 1 }, { seed: 1, raceId: 1, cpuIds: [IDS[5]], cpuPaints: { [IDS[5]]: 'mint' } });
    expect(b.arenaId).toBe('bubble-bath');
    expect(b).not.toHaveProperty('trackId');
    expect(b.participants[0].paintId).toBe('mint');
    const g = composeOnlineSetup(lobby, { mode: 'grand-prix', cupId: 'sprinkle-cup', trackId: 'cotton-candy-castle', laps: 3 }, { seed: 1, raceId: 2, cpuIds: [], gp: { raceIndex: 1, raceCount: 4, points: {} } });
    expect(g).toMatchObject({ cupId: 'sprinkle-cup', gp: { raceIndex: 1, raceCount: 4 } });
  });

  it('the same seed gives the same grid on every machine; different seeds differ', () => {
    const lobby = lobbyOf([2, 1, 1]);
    const a = composeOnlineSetup(lobby, lobby.hostChoice, { seed: 99, raceId: 1, cpuIds: IDS.slice(0, 4) });
    const b = composeOnlineSetup(structuredClone(lobby), lobby.hostChoice, { seed: 99, raceId: 1, cpuIds: IDS.slice(0, 4) });
    expect(a).toEqual(b);
    const grids = new Set();
    for (let s = 0; s < 40; s++) grids.add(composeOnlineSetup(lobby, lobby.hostChoice, { seed: s, raceId: 1, cpuIds: IDS.slice(0, 4) }).participants.map((p) => p.gridSlot).join());
    expect(grids.size).toBeGreaterThan(10);
  });

  it('fairness: over 400 seeded races with houses [[2],[1],[1]] each house\'s mean human slot is equal within ±0.15', () => {
    const lobby = lobbyOf([2, 1, 1]);
    const cpuIds = IDS.slice(0, 4);
    const sums = { 0: 0, 1: 0, 2: 0 };
    const counts = { 0: 0, 1: 0, 2: 0 };
    const front = { 0: 0, 1: 0, 2: 0 }; // races in which this house has the front-most human
    const N = 400;
    const rng = seededRng(2026);
    for (let r = 0; r < N; r++) {
      const seed = Math.floor(rng() * 2 ** 32);
      const setup = composeOnlineSetup(lobby, lobby.hostChoice, { seed, raceId: r, cpuIds });
      const humans = setup.participants.filter((p) => p.playerIndex !== null);
      for (const p of humans) { sums[p.houseId] += p.gridSlot; counts[p.houseId]++; }
      front[humans.reduce((a, b) => (b.gridSlot < a.gridSlot ? b : a)).houseId]++;
    }
    const means = [0, 1, 2].map((h) => sums[h] / counts[h]);
    const overall = means.reduce((a, b) => a + b, 0) / 3;
    for (const m of means) expect(Math.abs(m - overall)).toBeLessThanOrEqual(0.15);
    expect(Math.max(...means) - Math.min(...means)).toBeLessThanOrEqual(0.3);
    // no house starts in front of all the others more than its fair share + 5 %
    const fair = { 0: 2 / 4, 1: 1 / 4, 2: 1 / 4 };
    for (const h of [0, 1, 2]) expect(front[h] / N).toBeLessThanOrEqual(fair[h] + 0.05);
  });

  it('GP races 2+: fewest points in front, the leader starts last; race 1 is a seeded shuffle', () => {
    const pis = [0, 1, 2, 3];
    const points = { 0: 40, 1: 12, 2: 25, 3: 25 };
    const slots = humanGridSlots(pis, { seed: 5, cpuCount: 4, gp: { raceIndex: 2, points } });
    expect(slots.get(1)).toBe(4); // fewest points: the front human slot
    expect(slots.get(0)).toBe(7); // the leader: last
    expect([slots.get(2), slots.get(3)].sort()).toEqual([5, 6]); // a tie keeps the seeded order
    const race1 = humanGridSlots(pis, { seed: 5, cpuCount: 4, gp: { raceIndex: 0, points } });
    const shuffle = seededShuffle(pis, 5);
    expect(shuffle.map((pi) => race1.get(pi))).toEqual([4, 5, 6, 7]);
  });

  it('cpuCountFor fills the grid to 8 karts unless the rules say otherwise', () => {
    expect(cpuCountFor(4)).toBe(4);
    expect(cpuCountFor(8)).toBe(0);
    expect(cpuCountFor(2, { cpus: false })).toBe(0);
    expect(cpuCountFor(2, { cpus: 3 })).toBe(3);
    expect(cpuCountFor(7, { cpus: 3 })).toBe(1);
  });
});
