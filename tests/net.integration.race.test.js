/**
 * WS7 acceptance M1-4 / M1-5 (NETWORKING.md §9.1, §10.4, §9.9) with the real glue in the headless net session:
 *   - the HUD place on a guest is the host's place from the newest snapshot (never a mixed-timeline guess),
 *   - the finish celebration waits for the host's finish (the guest's `race:finish` is never predicted, the
 *     neutral "Finish! ✨" shows while it waits), flashes / rumble only ever go to THIS machine's players,
 *   - "Pause everyone" freezes every machine and the guests' host-tick estimate recovers after the resume,
 *   - a guest's local pause (robo bit) hands its karts to Robo Driver on the host and back.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runHeadlessNetSession } from './helpers/headlessSession.js';
import { netHudModel } from '../src/systems/netHud.js';

describe('HUD place, finish hold and local-only feedback (host + [2] + [1], 100 ms RTT, 2 % loss)', () => {
  let s;
  const placeChecks = [];
  const holds = new Map(); // `${guest}:${kartId}` → { holdFrames, firstHoldT, finishedT }
  beforeAll(() => {
    s = runHeadlessNetSession({
      houses: [[1], [2], [1]], seed: 11, conditions: { latencyMs: 50, jitterMs: 8, loss: 0.02 },
      onGuestFrame: ({ guest, replica, humans, t }) => {
        const snap = replica._newest;
        for (const h of humans) {
          const k = replica.karts[h.kartId];
          if (snap?.karts?.[k.id] && !k.finished) placeChecks.push({ shown: k.place, host: snap.karts[k.id].place });
          const key = `${guest}:${k.id}`;
          const rec = holds.get(key) ?? { holdFrames: 0, firstHoldT: null, finishedT: null };
          const m = netHudModel({ kart: k, race: replica, net: { role: 'guest', paused: false } });
          if (m.finishHold) { rec.holdFrames++; rec.firstHoldT ??= t; }
          if (k.finished && rec.finishedT === null) rec.finishedT = t;
          holds.set(key, rec);
        }
      },
    });
  });

  it('the race ran to identical results with no errors', () => {
    expect(s.errors).toEqual([]);
    for (const g of s.guests) expect(g.results).toEqual(s.host.results);
  });

  it('every place a guest showed for its own kart was the host place of the newest snapshot', () => {
    expect(placeChecks.length).toBeGreaterThan(500);
    expect(placeChecks.filter((c) => c.shown !== c.host)).toEqual([]);
  });

  it('a guest\'s race:finish is always the host\'s (never predicted), and never before its snapshot/event said so', () => {
    for (const g of s.guests) {
      const fin = g.machine.bus.emitted('race:finish').map(([e]) => e);
      expect(fin.length).toBe(8);
      expect(fin.every((e) => e.predicted !== true)).toBe(true);
    }
    // the own karts that finished for real waited: any "Finish! ✨" hold came before the host's finish
    for (const rec of holds.values()) {
      if (rec.firstHoldT !== null && rec.finishedT !== null) expect(rec.firstHoldT).toBeLessThanOrEqual(rec.finishedT);
    }
  });

  it('flashes and rumble only ever reach the players on the same machine', () => {
    const local = [[0], [1, 2], [3]];
    s.machines.forEach((m, i) => {
      for (const f of m.hud.flashes) expect(local[i]).toContain(f.playerIndex);
      const devs = new Set(m.app.input.rumbles.map((r) => r.deviceId));
      for (const d of devs) expect(['gp0', 'gp1', 'gp2', 'gp3']).toContain(d);
    });
    // a guest's session says a friend's kart is not "human" here (so their sounds never play as yours)
    const g1 = s.guests[0].raceSession;
    const remote = s.guests[0].replica.karts.find((k) => k.playerIndex === 0);
    const mine = s.guests[0].replica.karts.find((k) => k.playerIndex === 1);
    expect(g1.isHuman(remote)).toBe(false);
    expect(g1.isAnyHuman(remote)).toBe(true);
    expect(g1.isHuman(mine)).toBe(true);
    expect(g1.allHumans.map((h) => h.playerIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe('Pause everyone (host + [1] at 150 ms RTT)', () => {
  let s;
  beforeAll(() => {
    s = runHeadlessNetSession({ houses: [[1], [1]], seed: 5, conditions: { latencyMs: 75, jitterMs: 10, loss: 0.01 }, pauses: [{ atMs: 8000, ms: 4000 }] });
  });

  it('the pause happened once and resumed once', () => {
    expect(s.pauseLog.map((p) => p.on)).toEqual([true, false]);
    expect(s.errors).toEqual([]);
  });

  it('every machine is frozen while paused (host sim and the guest prediction stop)', () => {
    const [pauseOn, pauseOff] = s.pauseLog;
    const settled = s.frozen.filter((f) => f.t > pauseOn.t + 600 && f.t < pauseOff.t);
    expect(settled.length).toBeGreaterThan(100);
    const host = new Set(settled.map((f) => f.hostTick));
    expect(host.size).toBe(1);
    const guestTicks = settled.map((f) => f.guests[0]);
    expect(Math.max(...guestTicks) - Math.min(...guestTicks)).toBeLessThanOrEqual(1);
  });

  it('the guest\'s host-tick estimate recovers within 1 s of the resume (±1 tick)', () => {
    const off = s.pauseLog[1].t;
    const after = s.guests[0].timelineErr.filter((e) => e.t > off + 1000 && e.t < off + 6000);
    expect(after.length).toBeGreaterThan(100);
    expect(Math.max(...after.map((e) => Math.abs(e.err)))).toBeLessThanOrEqual(1.5);
  });

  it('results still match after the snack break', () => {
    expect(s.guests[0].results).toEqual(s.host.results);
  });
});

describe('a guest pauses locally (robo bit): Robo Driver drives, the race goes on', () => {
  let s;
  beforeAll(() => {
    s = runHeadlessNetSession({ houses: [[1], [1]], seed: 8, conditions: { latencyMs: 30 }, guestRobo: [{ guest: 0, atMs: 7000, ms: 4000 }] });
  });

  it('the host handed the guest\'s kart to Robo Driver and gave it back; the guest was told', () => {
    const robo = s.guests[0].machine.bus.emitted('race:robo').map(([e]) => e.on);
    expect(robo).toEqual([true, false]);
    const flashes = s.guests[0].machine.hud.flashes.map((f) => f.text);
    expect(flashes).toContain('🤖 Robo Driver has the wheel!');
    expect(flashes).toContain('You have the wheel again! 🏎️');
    expect(s.guests[0].results).toEqual(s.host.results);
    expect(s.errors).toEqual([]);
  });
});
