// Node multi-peer sims (NETWORKING.md §15): the basics of one race end to end, couch siblings colliding
// locally, Robo Driver on an outage, interpolation delay and the wire-byte budgets (acceptance M1-5, M1-7,
// M1-8, M1-11 / WS5 #2, #3, #8, #9).
import { describe, it, expect } from 'vitest';
import { runNetRace, convergenceProblems, pressReport, percentile } from './helpers/netHarness.js';

describe('one guest, clean network', () => {
  const r = runNetRace({ houses: [[1]], laps: 1, seed: 3, conditions: { latencyMs: 25 } });
  const g = r.guests[0];
  const mine = r.host.houseKarts[0][0];

  it('finishes with identical results, every event once and replica states within 4 cm', () => {
    expect(r.finishedAt).not.toBeNull();
    expect(convergenceProblems(r, { rttMs: 50 })).toEqual([]);
    expect(r.results.karts).toHaveLength(8);
    expect(r.results.karts.every((k) => k.place !== null)).toBe(true);
  });

  it('own-kart hop/drift/boost events are predicted on the guest; the host copies are dropped', () => {
    const own = g.events.filter((x) => x.e.kart?.id === mine);
    const hops = own.filter((x) => x.e.type === 'hop');
    expect(hops.length).toBeGreaterThan(0);
    expect(hops.every((x) => x.e.predicted === true)).toBe(true);
    const hostHops = r.host.events.filter((x) => x.e.type === 'hop' && x.e.kart?.id === mine).length;
    expect(Math.abs(hops.length - hostHops)).toBeLessThanOrEqual(2); // predicted once each, never doubled
    // host-only facts about my kart arrive from the host (not predicted)
    const laps = own.filter((x) => x.e.type === 'finish');
    expect(laps).toHaveLength(1);
    expect(laps[0].e.predicted).toBeUndefined();
    // remote karts' events come from the host with kart objects mapped back
    const remote = g.events.filter((x) => x.e.kart && x.e.kart.id !== mine && x.e.type === 'hop');
    expect(remote.length).toBeGreaterThan(0);
    expect(remote.every((x) => typeof x.e.kart.position?.x === 'number' && !x.e.predicted)).toBe(true);
  });

  it('the guest shows host places (from the newest snapshot) and the finish place only from the host finish event', () => {
    const replica = g.replica;
    const hostPlace = new Map(r.results.karts.map((k) => [k.id, k.place]));
    for (const k of replica.getStandings()) expect(k.place).toBe(hostPlace.get(k.id));
    const fin = g.events.find((x) => x.e.type === 'finish' && x.e.kart?.id === mine);
    expect(fin.e.place).toBe(hostPlace.get(mine));
    expect(replica.karts[mine].finishPlace).toBe(hostPlace.get(mine));
    expect(replica.state).toBe('finished');
    expect(replica.rng).toBeNull();
    expect(replica.getPlayerKart(r.host.participants[mine].playerIndex).id).toBe(mine);
  });

  it('reconcile error is tiny outside contact (quantisation only) and INPUT stays within its size', () => {
    expect(g.metrics.reconcile.cleanP99).toBeLessThan(0.25);
    expect(g.metrics.stats.sender.maxBytes).toBeLessThanOrEqual(13 + 4 * 8);
    expect(g.metrics.stats.bad).toBe(0);
  });
});

describe('interpolation delay', () => {
  it('settles at 100 ± 15 ms at 50 ms RTT / 5 ms jitter', () => {
    const r = runNetRace({ houses: [[1]], laps: 1, seed: 4, conditions: { latencyMs: 25, jitterMs: 5 } });
    const log = r.guests[0].metrics.interpLog;
    const tail = log.slice(Math.floor(log.length * 0.6)).map((x) => x.ms);
    expect(Math.min(...tail)).toBeGreaterThanOrEqual(85);
    expect(Math.max(...tail)).toBeLessThanOrEqual(115);
  });

  it('stays within 70..150 ms under 5 % loss and 20 ms jitter, and remote karts never jump > 1.5 m', () => {
    const r = runNetRace({ houses: [[1], [1]], laps: 1, seed: 6, conditions: { latencyMs: 60, jitterMs: 20, loss: 0.05 } });
    for (const g of r.guests) {
      const ms = g.metrics.interpLog.map((x) => x.ms);
      expect(Math.min(...ms)).toBeGreaterThanOrEqual(70);
      expect(Math.max(...ms)).toBeLessThanOrEqual(150);
      expect(g.metrics.maxJump).toBeLessThanOrEqual(1.5);
      expect(g.metrics.jumps.length).toBeGreaterThan(1000);
    }
  });
});

describe('couch siblings on one guest machine', () => {
  it('two local karts bumping into each other: reconcile error <= 0.5 m (they collide in prediction too)', () => {
    let touching = 0;
    const r = runNetRace({
      houses: [[2]], hostPlayers: 0, cpus: 0, laps: 1, seed: 12, conditions: { latencyMs: 50, jitterMs: 10 },
      maxSeconds: 25,
      script: ({ seat, tick, kart, replica }) => {
        if (tick < replica.goTick || tick > replica.goTick + 60 * 20) return null;
        const other = replica.karts[r0.houseKarts(seat)];
        const dx = other.position.x - kart.position.x;
        const dz = other.position.z - kart.position.z;
        const want = Math.atan2(dx, dz);
        let d = want - kart.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        return { steer: Math.max(-1, Math.min(1, -d * 3)), accel: seat === 0 ? 0.7 : 1, drift: false, hopCount: 0, itemCount: 0 };
      },
      onHostTick: ({ race }) => {
        const [a, b] = race.karts;
        if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < 2.3) touching++;
      },
    });
    const bumps = r.host.events.filter((x) => x.e.type === 'bump' && !x.e.wall && x.e.other);
    expect(bumps.length).toBeGreaterThanOrEqual(2);
    expect(touching).toBeGreaterThanOrEqual(2); // they really touch (and bounce off: the bumps are soft pushes)
    const g = r.guests[0];
    const errs = g.metrics.reconcile.all.map((c) => c.err);
    // every correction of this race counts (the only other karts' bumps are none: just the two siblings)
    expect(percentile(errs, 0.99)).toBeLessThanOrEqual(0.5);
    // and during the bumping window specifically
    const bumpWin = g.metrics.reconcile.all.filter((c) => bumps.some((b) => b.tick >= c.tick - 20 && b.tick <= c.P + 2));
    expect(bumpWin.length).toBeGreaterThan(5);
    expect(Math.max(...bumpWin.map((c) => c.err))).toBeLessThanOrEqual(0.5);
  });
});
const r0 = { houseKarts: (seat) => (seat === 0 ? 1 : 0) };

describe('Robo Driver on an outage (M1-11)', () => {
  const OUT = { guest: 0, atMs: 14000, ms: 2500 };
  let pressesDuringOutage = 0;
  const r = runNetRace({
    houses: [[1], [1]], laps: 1, seed: 8, conditions: { latencyMs: 30 },
    outages: [{ ...OUT, both: true }],
    script: ({ guest, t, input }) => {
      if (guest === 0 && t >= OUT.atMs + 500 && t < OUT.atMs + OUT.ms - 300 && Math.floor(t / 400) % 2 === 0) {
        pressesDuringOutage++;
        return { itemCount: (input.itemCount + 1 + Math.floor(t / 800)) & 7 }; // mash the item button while cut off
      }
      return null;
    },
  });
  const robo = r.metrics.roboLog.filter((x) => x.house === 0);
  const guestKart = r.host.houseKarts[0][0];

  it('Robo Driver takes the wheel within 1.6 s of the outage and gives it back when inputs resume', () => {
    expect(robo.map((x) => x.robo)).toEqual([true, false]);
    // 1.5 s of silence after the NEWEST input the host holds (the lead keeps a few ticks in hand) + one-way
    expect(robo[0].t - OUT.atMs).toBeLessThanOrEqual(1700);
    expect(robo[0].t - OUT.atMs).toBeGreaterThan(1400);
    const events = r.host.driver.eventLog.entries().filter((e) => e.type === 'robo' && e.kart === guestKart).map((e) => e.on);
    expect(events).toEqual([true, false]);
    expect(r.guests[1].events.filter((x) => x.e.type === 'robo').map((x) => x.e.on)).toEqual([true, false]);
  });

  it('control comes back on the first tick that has an input again', () => {
    const back = robo[1];
    const takes = r.metrics.takeLog.get(0);
    expect(takes[back.tick - 1]).toBe('on-time');
    expect(takes[back.tick - 2]).toBe('robo');
  });

  it('no phantom press after Robo Driver: buttons mashed during the outage never fire', () => {
    expect(pressesDuringOutage).toBeGreaterThan(0);
    const applied = r.metrics.presses.get('0:0')?.host.item || [];
    const back = robo[1].tick;
    expect(applied.filter((tk) => tk >= back && tk < back + 30)).toEqual([]);
  });

  it('the guest draws its own kart like a remote one while Robo Driver has it, then re-seeds and predicts again', () => {
    const g = r.guests[0];
    expect(g.replica.stats.roboOn).toBeGreaterThanOrEqual(1);
    expect(g.replica.stats.reseeds).toBeGreaterThanOrEqual(1);
    // finished by now: the host brain drives it home, the guest keeps it on P with its autopilot
    expect(g.replica.isPredicted(guestKart)).toBe(true);
    expect(g.replica.isAutopiloted(guestKart)).toBe(true);
    const snaps = g.metrics.reconcile.all.filter((c) => c.snapped);
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    // presses mashed during the outage are dropped on purpose (baseline), and remote karts that froze during a
    // 2.5 s blackout are put back where they are when data resumes; everything else converges
    const probs = convergenceProblems(r, { rttMs: 60, contact: false }).filter((p) => !/guest 0 seat 0 item|remote jump/.test(p));
    expect(probs).toEqual([]);
    for (const x of r.guests) {
      const jumps = x.metrics.jumps.filter((j) => j.d > 1.5 && (j.t < OUT.atMs || j.t > OUT.atMs + OUT.ms + 1500));
      expect(jumps).toEqual([]);
    }
  });
});

describe('wire-byte budgets (M1-5, 8 karts)', () => {
  it('7 guests x 1 player: guest up <= 45 kbps, down <= 140 kbps, host up <= 1.0 Mbps, ctrl payload < 3 kbps', () => {
    const r = runNetRace({ houses: [[1], [1], [1], [1], [1], [1], [1]], laps: 1, seed: 14, conditions: { latencyMs: 40, jitterMs: 5 } });
    const w = r.metrics.wire;
    for (const up of w.guestUpKbps) expect(up).toBeLessThanOrEqual(45);
    for (const down of w.guestDownKbps) expect(down).toBeLessThanOrEqual(140);
    expect(w.hostUpKbps).toBeLessThanOrEqual(1000);
    // ctrl in race is small payload (EVENTS, TIMEBASE, the end-of-race RESULT); its per-packet overhead is part
    // of the guest-down wire budget above (§9.4 row "+ EVENTS, NETSTAT, TIMEBASE, PONG")
    for (const c of w.ctrlPayloadKbps) expect(c).toBeLessThan(3);
    for (const c of w.ctrlDownKbps) expect(c).toBeLessThan(10);
    expect(convergenceProblems(r, { rttMs: 80, contact: false })).toEqual([]);
  });

  it('a 4-player guest house uploads <= 90 kbps', () => {
    const r = runNetRace({ houses: [[4], [1], [1]], laps: 1, seed: 15, conditions: { latencyMs: 40 } });
    expect(r.metrics.wire.guestUpKbps[0]).toBeLessThanOrEqual(90);
    expect(r.metrics.wire.guestUpKbps[0]).toBeGreaterThan(r.metrics.wire.guestUpKbps[1]);
  });

  it('cap-case (24 gumdrops, 8 rockets, 4 own karts): guest down <= 220 kbps; 7 guests: host up <= 1.6 Mbps', () => {
    const extra = (state) => {
      for (let i = 0; i < 24; i++) state.gumdrops.push({ id: 60000 + i, x: i * 3, y: 1, z: 5, s: 0, lateral: 0, owner: 0, grace: 0, age: 1, color: i % 5, near: [], dodged: [] });
      for (let i = 0; i < 8; i++) state.rockets.push({ id: 61000 + i, owner: 0, target: 1, chased: true, distance: 0, s: 0, lateral: 0, y: 1, travelled: 0, life: 5, age: 1, x: i * 4, z: 9, heading: 0 });
      return state;
    };
    const four = runNetRace({ houses: [[4], [1], [1]], laps: 1, seed: 16, conditions: { latencyMs: 40 }, captureExtra: extra, maxSeconds: 40 });
    expect(four.metrics.wire.guestDownKbps[0]).toBeLessThanOrEqual(220);
    expect(four.metrics.wire.guestDownKbps[0]).toBeGreaterThan(170); // it really is the cap case
    const seven = runNetRace({ houses: [[1], [1], [1], [1], [1], [1], [1]], laps: 1, seed: 17, conditions: { latencyMs: 40 }, captureExtra: extra, maxSeconds: 40 });
    expect(seven.metrics.wire.hostUpKbps).toBeLessThanOrEqual(1600);
    expect(seven.guests[0].replica.itemsReplica.stats.gumdropsSpawned).toBeGreaterThanOrEqual(24);
    expect(seven.guests[0].replica.itemsReplica.stats.rocketsSpawned).toBeGreaterThanOrEqual(8);
  });
});

describe('presses end to end', () => {
  it('item and hop presses under 5 % loss in 3-packet bursts at 100 ms: each applied exactly once, <= 6 ticks late', () => {
    const r = runNetRace({ houses: [[2], [1]], laps: 1, seed: 19, conditions: { latencyMs: 50, loss: 0.05, burstLen: 3, burstExact: true } });
    const rep = pressReport(r);
    expect(rep.reduce((n, p) => n + p.sent, 0)).toBeGreaterThan(20);
    for (const p of rep) {
      expect(p.applied, `${p.guest}/${p.seat}/${p.kind}`).toBe(p.sent);
      expect(p.extra).toBe(0);
      expect(Math.max(0, ...p.late)).toBeLessThanOrEqual(6);
    }
  });

  it('under Gilbert–Elliott bursts (mean 3) presses are still applied exactly once; p99 <= 6 ticks late', () => {
    const late = [];
    for (const seed of [31, 32]) {
      const r = runNetRace({ houses: [[2], [1]], laps: 1, seed, conditions: { latencyMs: 40, jitterMs: 10, loss: 0.05, burstLen: 3 } });
      for (const p of pressReport(r)) {
        expect(p.applied).toBe(p.sent);
        late.push(...p.late);
      }
      expect(convergenceProblems(r, { rttMs: 80, bursts: true, maxLate: 60, contact: false })).toEqual([]);
    }
    expect(percentile(late, 0.99)).toBeLessThanOrEqual(6);
  });
});
