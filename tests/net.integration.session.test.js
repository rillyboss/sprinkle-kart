/**
 * WS7 acceptance M1-1 (NETWORKING.md §17 M1, §12): a host house and two guest houses ([[1], [2], [1]]) race a
 * whole Free Race over the in-memory transport at 150 ms RTT / 3 % loss using the real glue — sessions with
 * approval, composeSetup, SETUP / LOADED / START, host driver + ReplicaRaces, RESULT — and:
 *   - every machine sees exactly the host's results (order, places, finish times in ms),
 *   - every machine records only ITS OWN players (a guest never gets the host's win, and vice versa),
 *   - multiplayerRaces counts on every machine,
 *   - no system threw on any machine.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runHeadlessNetSession } from './helpers/headlessSession.js';

let s;
beforeAll(() => {
  s = runHeadlessNetSession({
    houses: [[1], [2], [1]], seed: 3, laps: 1,
    conditions: { latencyMs: 75, jitterMs: 10, loss: 0.03 },
  });
});

describe('online Free Race end to end (host + 2 guest houses, 150 ms / 3 % loss)', () => {
  it('both guests were let in with the same match check on both screens', () => {
    expect(s.approvals).toHaveLength(2);
    for (const a of s.approvals) {
      expect(a.promptAnimals).toBeTruthy();
      expect(a.promptAnimals).toBe(a.guestAnimals);
    }
  });

  it('the setup has 4 humans (global indices 0..3, one per seat) + 4 CPUs, CPUs first', () => {
    const humans = s.setup.participants.filter((p) => p.playerIndex !== null);
    expect(humans.map((p) => p.playerIndex)).toEqual([0, 1, 2, 3]);
    expect(humans.map((p) => p.houseId)).toEqual([0, 1, 1, 2]);
    expect(s.setup.participants.slice(0, 4).every((p) => p.playerIndex === null)).toBe(true);
    expect(s.setup.participants.every((p, i) => p.kartId === i)).toBe(true);
  });

  it('the race finished and every machine got the RESULT', () => {
    expect(s.hostSummary).toBeTruthy();
    expect(s.hostSummary.online).toBe(true);
    expect(s.hostSummary.humans.map((h) => h.playerIndex)).toEqual([0, 1, 2, 3]);
    for (const g of s.guests) expect(g.resultMsg).toEqual(s.hostSummary);
  });

  it('results are identical on every machine (order, places, finish times in ms)', () => {
    expect(s.host.results.karts.every((k) => Number.isInteger(k.place))).toBe(true);
    for (const g of s.guests) expect(g.results).toEqual(s.host.results);
  });

  it('each machine records only its own players', () => {
    const [host, g1, g2] = s.machines;
    expect(host.raceEnds.map((e) => e.humans.map((h) => h.playerIndex))).toEqual([[0]]);
    expect(g1.raceEnds.map((e) => e.humans.map((h) => h.playerIndex))).toEqual([[1, 2]]);
    expect(g2.raceEnds.map((e) => e.humans.map((h) => h.playerIndex))).toEqual([[3]]);
    // a win is credited only on the machine whose player won
    const winnerPi = s.hostSummary.winner?.playerIndex ?? null;
    const owner = [[0], [1, 2], [3]].findIndex((pis) => pis.includes(winnerPi));
    s.machines.forEach((m, i) => {
      const summary = m.raceEnds[0];
      expect(summary.winner?.playerIndex ?? null).toBe(i === owner ? winnerPi : null);
      expect(m.progress.state.stats.wins ?? 0).toBe(i === owner ? 1 : 0);
    });
  });

  it('local rows carry the host tallies (never the guest\'s own predicted guesses)', () => {
    s.guests.forEach((g) => {
      for (const h of g.localSummary.humans) {
        const hostRow = s.hostSummary.humans.find((x) => x.playerIndex === h.playerIndex);
        expect(h.stats).toEqual(hostRow.stats);
      }
    });
  });

  it('multiplayerRaces counts on every machine (humanCount = all 4 humans)', () => {
    for (const m of s.machines) {
      expect(m.raceEnds[0].humanCount).toBe(4);
      expect(m.raceEnds[0].online).toBe(true);
      expect(m.progress.state.stats.multiplayerRaces).toBe(1);
      expect(m.progress.state.stats.racesFinished).toBe(1);
    }
  });

  it('local devices are re-attached to this machine\'s rows only', () => {
    expect(s.machines[1].raceEnds[0].humans.map((h) => h.deviceId)).toEqual(['gp0', 'gp1']);
    expect(s.hostSummary.humans.every((h) => h.deviceId === null)).toBe(true);
  });

  it('no system threw on any machine and no undecodable message arrived', () => {
    expect(s.errors).toEqual([]);
    expect(s.host.net.stats().badMessages).toBe(0);
    for (const g of s.guests) expect(g.net.stats().bad).toBe(0);
  });

  it('every guest saw the host\'s finish events for every kart', () => {
    for (const g of s.guests) expect(g.replica.finishes.size).toBe(8);
  });
});
