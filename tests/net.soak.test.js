// Online soak (NETWORKING.md §15 "Soak", §17 M1-20 / M2-5; WS8). A whole family evening over the real
// netcode (host Race + one ReplicaRace per guest house over the in-memory network, tests/helpers/netHarness.js):
// one room of 3 houses (the host house with 2 players, guest houses with 3 and 2) + CPUs to 8 karts, a
// 4-race Grand Prix followed by 10 Free Races at 150 ms RTT / 3 % loss / 20 ms jitter, with two 30 s
// "Pause everyone" snack breaks. Every race must converge (identical results and RESULT on every machine,
// every replicated event exactly once, final state within 4 cm), every buffer stays bounded, the guests'
// host-clock estimates never drift, and the GP standings every machine computes from its own copy of the
// results are identical (and localizeGp credits only the house that won).
//
// Quick mode (always, part of the main suite): the same room, a 2-race mini cup, one snack break.
// Long mode: SOAK=1 npx vitest run tests/net.soak.test.js   (fake time ≈ 40 min; prints its timings)
import { describe, it, expect } from 'vitest';
import { runNetRace, convergenceProblems, diffResults } from './helpers/netHarness.js';
import { EVENT_LOG_CAPACITY } from '../src/net/host/eventLog.js';
import { createGrandPrix, gpRecordRace, gpNextRace } from '../src/modes/grandPrix.js';
import { CUPS } from '../src/data/cups.js';
import { localizeGp } from '../src/net/session/localize.js';

const LONG = !!process.env.SOAK && process.env.SOAK !== '0';

/** The room: host house 2 players, guest houses of 3 and 2 → 7 humans + 1 CPU. */
const ROOM = Object.freeze({ hostPlayers: 2, houses: [[3], [2]] });
const CONDITIONS = Object.freeze({ latencyMs: 75, jitterMs: 20, loss: 0.03 }); // 150 ms RTT
const HOST_OFFSET = 1000.5; // the harness host clock = t + 1000.5
const GUEST_CLOCKS = [23456.5, 34567.25]; // each guest machine keeps its own clock all evening
const SNACK_MS = 30000;

// Buffer bounds (same limits as the soak-lite in tests/net.sim.soak.test.js)
const BOUNDS = Object.freeze({ eventLog: 512, hostInput: 64, snapshots: 32, history: 128, pendingEvents: 8 });

/** The host's results rebuilt from a COMPLETE copy of its event log (same shape as the harness's results). */
function hostTruth(r, log) {
  const lapsMs = r.host.participants.map(() => []);
  const fin = new Map();
  for (const e of log) {
    if (e.type === 'lap') lapsMs[e.kart].push(e.lapTimeMs);
    if (e.type === 'finish') fin.set(e.kart, { place: e.place, finishTimeMs: e.finishTimeMs, estimated: e.estimated });
  }
  const order = r.results.order;
  return {
    order,
    karts: order.map((id) => {
      const f = fin.get(id) || null;
      const lapTimesMs = lapsMs[id].slice();
      if (f && !f.estimated) lapTimesMs.push(f.finishTimeMs - lapTimesMs.reduce((a, b) => a + b, 0));
      return { id, place: f?.place ?? null, finishTimeMs: f?.finishTimeMs ?? null, estimated: f?.estimated ?? null, lapTimesMs };
    }),
  };
}

/** Each machine's own view of one race as a RaceSummary-shaped standings list (for GP scoring). */
function standingsOf(results, participants) {
  return results.order.map((kartId, i) => {
    const p = participants[kartId];
    return { characterId: p.characterId, playerIndex: p.playerIndex, isCPU: p.playerIndex === null, place: i + 1 };
  });
}

/**
 * One race of the evening; returns what the soak asserts on.
 * @param {{ track: string, laps: number, seed: number, snack?: boolean }} o
 */
function race({ track, laps, seed, snack = false }) {
  const pauses = snack ? [{ atMs: 9000, ms: SNACK_MS }] : [];
  // The host's event log keeps only its last EVENT_LOG_CAPACITY entries (for RESYNC), and the harness builds
  // the host's results / RESULT from it, so a long race (> 512 events) would lose its early lap times there.
  // Keep our own unbounded copy of every host log entry and judge the guests against that.
  const seen = new Map();
  let lastSeq = 0;
  const onHostTick = ({ driver }) => {
    const entries = driver.eventLog.entries();
    for (let i = entries.length - 1; i >= 0 && entries[i].seq > lastSeq; i--) seen.set(entries[i].seq, entries[i]);
    if (entries.length) lastSeq = Math.max(lastSeq, entries[entries.length - 1].seq);
  };
  const r = runNetRace({ track, ...ROOM, laps, seed, clockOffsets: GUEST_CLOCKS, conditions: CONDITIONS, pauses, onHostTick });
  const hs = r.metrics.hostStats;
  const localPis = r.host.houseKarts.map((karts) => karts.map((k) => r.host.participants[k].playerIndex));
  const full = [...seen.values()].sort((a, b) => a.seq - b.seq);
  const overflowed = full.length > EVENT_LOG_CAPACITY;
  const truth = hostTruth(r, full);
  let problems = convergenceProblems(r, { rttMs: 150, contact: false });
  if (overflowed) problems = problems.filter((p) => !/results differ|RESULT differs/.test(p));
  r.guests.forEach((g, gi) => {
    const d = diffResults(truth, g.results);
    if (d) problems.push(`guest ${gi} results differ from the host's full log: ${d}`);
  });
  if (full.length !== r.lastSeq || full.some((e, i) => e.seq !== i + 1)) problems.push(`host log copy has ${full.length} of ${r.lastSeq} entries`);
  return {
    r,
    track,
    fakeMs: r.t,
    events: full.length,
    overflowed,
    problems,
    finished: r.finishedAt !== null,
    snackBreaks: r.metrics.pauseLog.filter((p) => p.reason === 0).length / 2,
    buffers: {
      eventLog: hs.eventLogSize,
      hostInput: Math.max(0, ...Object.values(hs.houses).map((h) => h.buffer.occupancy)),
      snapshots: Math.max(...r.guests.map((g) => g.metrics.bufferSize)),
      history: Math.max(...r.guests.map((g) => g.metrics.historySize)),
      pendingEvents: Math.max(...r.guests.map((g) => g.metrics.pendingEvents)),
    },
    clockErr: r.guests.map((g, gi) => {
      const est = g.metrics.stats.clock;
      return est.ready ? Math.abs(est.offset - (HOST_OFFSET - GUEST_CLOCKS[gi])) : Infinity;
    }),
    seqsOnce: r.guests.every((g) => g.acceptedSeqs.length === r.lastSeq),
    hostStandings: standingsOf(r.results, r.host.participants),
    guestStandings: r.guests.map((g) => standingsOf(g.results, r.host.participants)),
    localPis,
    hostPis: r.host.hostKarts.map((k) => r.host.participants[k].playerIndex),
  };
}

/**
 * The evening: a cup of `gpRaces` races, then `freeRaces` Free Races; snack breaks in the races listed.
 * Returns every race's report + each machine's GP result.
 */
function evening({ gpRaces, freeRaces, laps, snacks, seed = 900 }) {
  const cup = CUPS[0];
  const cupTracks = cup.trackIds.slice(0, gpRaces);
  const freeTracks = CUPS.flatMap((c) => c.trackIds);
  const machines = 1 + ROOM.houses.length;
  let gps = Array.from({ length: machines }, () => createGrandPrix({ cupId: cup.id, trackIds: cupTracks }));
  const races = [];
  let n = 0;
  for (let i = 0; i < gpRaces; i++, n++) {
    const rep = race({ track: cupTracks[i], laps, seed: seed + n, snack: snacks.includes(n) });
    races.push({ kind: 'gp', ...rep });
    const views = [rep.hostStandings, ...rep.guestStandings];
    gps = gps.map((gp, m) => {
      const next = gpRecordRace(gp, { standings: views[m] });
      return next.phase === 'standings' ? gpNextRace(next) : next;
    });
  }
  for (let i = 0; i < freeRaces; i++, n++) {
    const rep = race({ track: freeTracks[(i * 3 + 1) % freeTracks.length], laps, seed: seed + n, snack: snacks.includes(n) });
    races.push({ kind: 'free', ...rep });
  }
  return { races, gps, cup };
}

function assertEvening({ races, gps }, { gpRaces, snacks }) {
  // every race converged, finished, and every replicated event was applied exactly once on every guest
  races.forEach((x, i) => {
    expect(x.problems, `race ${i} (${x.kind} ${x.track})`).toEqual([]);
    expect(x.finished, `race ${i} finished`).toBe(true);
    expect(x.seqsOnce, `race ${i} event seqs`).toBe(true);
    for (const [k, lim] of Object.entries(BOUNDS)) expect(x.buffers[k], `race ${i} ${k}`).toBeLessThanOrEqual(lim);
    for (const e of x.clockErr) expect(e, `race ${i} clock offset error (ms)`).toBeLessThan(15);
  });
  // both snack breaks happened (pause + resume)
  expect(races.reduce((s, x) => s + x.snackBreaks, 0)).toBe(snacks.length);
  // no drift over the evening: the offset error of the last races is no worse than the first ones (+ 5 ms)
  const errs = races.map((x) => Math.max(...x.clockErr));
  const head = Math.max(...errs.slice(0, 2));
  const tail = Math.max(...errs.slice(-2));
  expect(tail).toBeLessThanOrEqual(head + 5);
  // buffers do not grow race over race (a leak would ratchet them up)
  const last = races[races.length - 1].buffers;
  const first = races[0].buffers;
  expect(last.snapshots).toBeLessThanOrEqual(Math.max(first.snapshots, BOUNDS.snapshots));
  // the cup: every machine computed the same standings, points and podium from its own copy of the results
  const [hostGp, ...guestGps] = gps;
  expect(hostGp.phase).toBe('done');
  expect(hostGp.result.races.length).toBe(gpRaces);
  for (const g of guestGps) expect(g.result.standings).toEqual(hostGp.result.standings);
  // localizeGp: only the winning house is credited the cup, never the others
  const top = hostGp.result.standings[0];
  const x = races[0];
  const housesPis = [x.hostPis, ...x.localPis];
  const credited = housesPis.map((pis) => localizeGp(hostGp.result, pis).humanWinner);
  if (top.isCPU) expect(credited.every((c) => c === null)).toBe(true);
  else {
    expect(credited.filter(Boolean)).toHaveLength(1);
    expect(credited.find(Boolean).playerIndex).toBe(top.playerIndex);
    housesPis.forEach((pis, h) => expect(!!credited[h], `house ${h}`).toBe(pis.includes(top.playerIndex)));
  }
}

describe('online soak (quick): one room, a 2-race mini cup with a snack break', () => {
  it('converges, keeps buffers bounded, no clock drift, identical cup standings on every machine', () => {
    const plan = { gpRaces: 2, freeRaces: 0, laps: 1, snacks: [1] };
    const ev = evening(plan);
    assertEvening(ev, plan);
    // 7 humans across 3 houses + 1 CPU
    expect(ev.races[0].r.host.participants).toHaveLength(8);
    expect(ev.races[0].r.host.participants.filter((p) => p.playerIndex === null)).toHaveLength(1);
    expect(ev.races[0].r.guests).toHaveLength(2);
    // short races never overflow the host's 512-entry log, so the harness's own RESULT checks ran unfiltered
    expect(ev.races.every((x) => !x.overflowed)).toBe(true);
  }, 120000);
});

describe.runIf(LONG)('online soak (SOAK=1): a 4-race Grand Prix + 10 Free Races ≈ 40 fake minutes', () => {
  it('a whole evening with two 30 s snack breaks: zero divergence, bounded buffers, no drift', () => {
    const plan = { gpRaces: 4, freeRaces: 10, laps: 5, snacks: [2, 9] };
    const t0 = Date.now();
    const ev = evening(plan);
    const realS = (Date.now() - t0) / 1000;
    const fakeMin = ev.races.reduce((s, x) => s + x.fakeMs, 0) / 60000;
    console.log(`[soak] ${ev.races.length} races (${plan.gpRaces} GP + ${plan.freeRaces} free, ${plan.laps} laps) = ${fakeMin.toFixed(1)} fake min in ${realS.toFixed(1)} s real`);
    console.log(`[soak] clock offset error max ${Math.max(...ev.races.flatMap((x) => x.clockErr)).toFixed(2)} ms; buffers max ${JSON.stringify(Object.fromEntries(Object.keys(BOUNDS).map((k) => [k, Math.max(...ev.races.map((x) => x.buffers[k]))])))}`);
    console.log(`[soak] replicated events per race: ${ev.races.map((x) => x.events).join(', ')} (${ev.races.filter((x) => x.overflowed).length} races longer than the host's ${EVENT_LOG_CAPACITY}-entry log)`);
    console.log(`[soak] cup ${ev.cup.id} podium: ${ev.gps[0].result.standings.slice(0, 3).map((r) => `${r.characterId}${r.isCPU ? ' (CPU)' : ` (P${r.playerIndex + 1})`} ${r.points}`).join(', ')}`);
    assertEvening(ev, plan);
    expect(fakeMin).toBeGreaterThan(35);
    expect(fakeMin).toBeLessThan(60);
  }, 900000);
});
