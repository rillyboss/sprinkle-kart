// Regression baselines of the netcode design (NETWORKING.md §5, §8.5, §15 "Regression"), SIM PART (WS5):
// the audit-A measurements (branch net-audit/sim-measure, dev/net-design/measure-*.mjs) re-run as a test
// with thresholds. WS2 adds the codec part (timer fields with an active shield + star) next to these.
//
//   measured (audit A)                                         threshold here
//   quantised-vs-exact replay error after 6/12 ticks: 1.2 cm p50 / 2.1 cm p99      p50 <= 2 cm, p99 <= 4 cm
//   s == path.wrap(distance): max error 0                                           <= 1e-6 m
//   predictTick-only replay = host bit-exactly in 94–98 % of 100–200 ms windows     >= 90 %
//   windows with contact / bonks / items: up to 1.4 m                               p99 <= 1.5 m (6 ticks)
//   replicated events for 8 karts: ≈ 5.3 / s                                        <= 8 / s
//   8-kart snapshot (rev-2 layout): ≈ 370–460 B                                     mean <= 460 B
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race } from '../src/race/Race.js';
import { applyKartRecord } from '../src/net/guest/reconcile.js';
import { createEventLog } from '../src/net/host/eventLog.js';
import { encodeSnapshot, decode } from './helpers/netWire.js';
import { captureSimState, predictTick, makeCountdown, raceTick } from './helpers/netSim.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';
import { createKart } from '../src/race/Kart.js';
import { TUNING as T } from '../src/race/tuning.js';

const cd = makeCountdown(3);

/** One 8-kart race where kart 0 is a "human" driven by a recorded CPU-brain input; every tick recorded. */
function recordRace(trackId, seed) {
  const { def, path } = trackFixture(trackId);
  const ids = defaultRacerIds(8);
  const participants = ids.map((characterId, i) => ({ characterId, playerIndex: i === 0 ? 0 : null }));
  const log = createEventLog();
  let tick = 0;
  const race = new Race({
    scene: new THREE.Scene(), trackDef: def, path, participants, buildKartModel: stubKartModel(), laps: 1, seed,
    onEvent: (e) => log.push(tick, e),
  });
  const me = race.karts[0];
  const inputs = [];
  const states = [];
  const bytes = [];
  let sErr = 0;
  // a deterministic "kid" for kart 0 (steer to the road ahead, full gas, occasional drift taps)
  const v = new THREE.Vector3();
  while (race.state !== 'finished' && tick < 60 * 120) {
    tick++;
    const ahead = path.positionAt(path.wrap(me.s + 14), 0, v);
    const want = Math.atan2(ahead.x - me.position.x, ahead.z - me.position.z);
    let d = want - me.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const inp = { steer: Math.max(-1, Math.min(1, -d * 2.4)), accel: 1, brake: 0, drift: tick % 200 > 185, useItem: false };
    inputs[tick] = inp;
    const arr = [];
    arr[0] = inp;
    raceTick(race, arr);
    states[tick] = captureSimState(race, tick);
    if (tick % 2 === 0) bytes.push(encodeSnapshot(states[tick], { houseTail: { owner: [0] } }).length);
    if (race.state === 'racing') sErr = Math.max(sErr, Math.abs(path.delta(path.wrap(me.distance), me.s)));
  }
  return { race, path, def, inputs, states, bytes, log, ticks: tick, sErr, participants };
}

const RUNS = [recordRace('cotton-candy-castle', 4), recordRace('gumdrop-meadow', 7)];

function replayErr(run, S, n, { quantised }) {
  const { path, race } = run;
  const hostK = run.states[S].karts[0];
  const kart = createKart({ id: 0, participant: run.participants[0], charDef: race.karts[0].charDef, speedClass: race.speedClass, lapsTotal: 1, path, gridS: 0, gridLat: 0 });
  if (quantised) {
    const snap = decode(encodeSnapshot(run.states[S], { houseTail: { owner: [0] } }));
    applyKartRecord(kart, snap.karts[0], snap.owner[0], path);
  } else {
    applyKartRecord(kart, { ...hostK, position: hostK.position.slice(), velocity: hostK.velocity.slice(), phys: { ...hostK.phys } }, { kart: 0, phys: { ...hostK.phys } }, path);
    kart.s = hostK.s; kart.lateral = hostK.lateral;
  }
  kart.lap = hostK.lap;
  const ctx = (t) => ({ path, boostPads: race.boostPads, gameplay: race.gameplay, tick: t, startTick: 1, goTick: cd.goTick, countdownAfter: cd.after, lapsTotal: 1 });
  for (let t = S + 1; t <= S + n; t++) predictTick([kart], [run.inputs[t]], ctx(t));
  const h = run.states[S + n].karts[0];
  return Math.hypot(kart.position.x - h.position[0], kart.position.z - h.position[2]);
}

/** Did anything the prediction cannot see touch kart 0 in (S, S+n]? */
function disturbed(run, S, n) {
  // resting contact with another kart (the host pushes us, no 'bump' event below 2.5 m/s) is just as invisible
  // to a one-kart replay as a bump; it showed up once the v3.1 drift reshuffled the CPU pack
  const touch = 2 * T.kartRadius + 0.05;
  for (let t = S; t <= S + n; t++) {
    const ks = run.states[t]?.karts;
    if (!ks) continue;
    for (let i = 1; i < ks.length; i++) {
      if (Math.hypot(ks[i].position[0] - ks[0].position[0], ks[i].position[2] - ks[0].position[2]) < touch) return true;
    }
  }
  return run.log.entries().some((e) => e.tick > S - 1 && e.tick <= S + n && (e.kart === 0 || e.other === 0 || e.by === 0)
    && ['bump', 'bonked', 'shield-pop', 'item-use', 'item-box', 'item-get', 'item-dodged', 'boost'].includes(e.type)
    && !(e.type === 'bump' && e.other === 255) && !(e.type === 'boost' && e.source === 'pad'));
}

const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

describe('netcode baselines (sim part)', () => {
  it('reconciling from the quantised snapshot costs <= 2 cm p50 / 4 cm p99 and does not grow over 6–12 ticks', () => {
    for (const n of [6, 12]) {
      const errs = [];
      for (const run of RUNS) {
        for (let S = cd.goTick + 30; S < run.ticks - n; S += 7) {
          if (disturbed(run, S, n)) continue;
          errs.push(replayErr(run, S, n, { quantised: true }));
        }
      }
      expect(errs.length).toBeGreaterThan(200);
      expect(pct(errs, 0.5), `${n} ticks p50`).toBeLessThanOrEqual(0.02);
      expect(pct(errs, 0.99), `${n} ticks p99`).toBeLessThanOrEqual(0.04);
    }
  });

  it('s is exactly wrap(distance) (so the wire never sends s)', () => {
    for (const run of RUNS) expect(run.sErr).toBeLessThanOrEqual(1e-6);
  });

  it('predictTick alone reproduces the host bit-exactly in >= 90 % of 100–200 ms windows; disturbed windows stay <= 1.5 m p99', () => {
    for (const n of [6, 12]) {
      let exact = 0;
      let total = 0;
      const disturbedErrs = [];
      for (const run of RUNS) {
        for (let S = cd.goTick + 30; S < run.ticks - n; S += 5) {
          const e = replayErr(run, S, n, { quantised: false });
          total++;
          if (e < 1e-9) exact++;
          else if (n === 6 && disturbed(run, S, n)) disturbedErrs.push(e);
        }
      }
      expect(exact / total, `${n} ticks`).toBeGreaterThanOrEqual(0.9);
      if (n === 6 && disturbedErrs.length) expect(pct(disturbedErrs, 0.99)).toBeLessThanOrEqual(1.5);
    }
  });

  it('8 karts replicate <= 8 events per second', () => {
    for (const run of RUNS) {
      const seconds = (run.ticks - cd.goTick) / 60;
      expect(run.log.stats.pushed / seconds).toBeLessThanOrEqual(8);
      expect(run.log.stats.pushed / seconds).toBeGreaterThan(2);
    }
  });

  it('8-kart snapshots average <= 460 B and never exceed 1150 B', () => {
    for (const run of RUNS) {
      const mean = run.bytes.reduce((a, b) => a + b, 0) / run.bytes.length;
      expect(mean).toBeLessThanOrEqual(460);
      expect(Math.max(...run.bytes)).toBeLessThanOrEqual(1150);
    }
  });
});
