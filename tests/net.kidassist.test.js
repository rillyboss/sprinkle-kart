// Kid-Assist players online (net review #8): the guest used to predict the RAW stick while the host drove the
// kart with Kid-Assist (full gas, racing-line steering, auto rocket start), so a hands-off kid lurched 0.4–2.8 m
// at every GO and a wobbly stick corrected 3× more than without assist. The guest now runs Kid-Assist itself
// before predicting and sends the assisted input (`assisted: true`); the host uses it as is.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { runNetRace, percentile } from './helpers/netHarness.js';
import { Race } from '../src/race/Race.js';
import { trackFixture, defaultRacerIds, stubKartModel } from './helpers/raceHarness.js';

const STYLES = {
  'hands off (Kid-Assist does the gas)': () => ({ steer: 0, accel: 0, brake: 0 }),
  'wobbly stick': ({ tick }) => ({ steer: Math.sin(tick / 25) * 0.6, accel: 1, brake: 0 }),
};

function kidRun(latencyMs, script) {
  const r = runNetRace({ houses: [[1]], laps: 1, seed: 5, conditions: { latencyMs, jitterMs: 5 }, easyGuests: true, script, maxSeconds: 40 });
  const g = r.guests[0];
  const goTick = r.host.goTick;
  const all = g.metrics.reconcile.all;
  const errs = all.map((c) => c.err);
  const atGo = all.filter((c) => c.tick >= goTick - 5 && c.tick <= goTick + 90).map((c) => c.err);
  return { r, p99: percentile(errs, 0.99), cleanP99: g.metrics.reconcile.cleanP99, goMax: atGo.length ? Math.max(...atGo) : 0, n: errs.length };
}

describe('Kid-Assist guests predict what the host drives (review #8)', () => {
  for (const [name, script] of Object.entries(STYLES)) {
    for (const rtt of [50, 150]) {
      it(`${name} at ${rtt} ms RTT: no lurch at GO, small corrections`, () => {
        const k = kidRun(rtt / 2, script);
        expect(k.n).toBeGreaterThan(50);
        expect(k.goMax).toBeLessThan(0.15); // was 0.36 m (50 ms) / 1.37 m (150 ms) hands-off
        // corrections outside kart contact (a Kid-Assist kart on the racing line meets CPUs more often; contact
        // corrections are the same for everyone): was p99 0.34 / 0.47 m with a wobbly stick
        expect(k.cleanP99).toBeLessThan(0.2);
        expect(k.p99).toBeLessThan(0.35);
      });
    }
  }

  it('the host drives an assisted input as is (never assists it twice); a raw one gets Kid-Assist', () => {
    const { def, path } = trackFixture('gumdrop-meadow');
    const ids = defaultRacerIds(2);
    const race = new Race({
      scene: new THREE.Scene(), trackDef: def, path, participants: [{ characterId: ids[0], playerIndex: 0, easyDrive: true }, { characterId: ids[1], playerIndex: null }],
      speedClass: 'zippy', buildKartModel: stubKartModel(), laps: 1, seed: 1, onEvent: () => {},
    });
    race.state = 'racing';
    const k = race.getPlayerKart(0);
    const assisted = { steer: 0.3, accel: 0, brake: 0, drift: false, useItem: false, assisted: true };
    expect(race._inputFor(k, [assisted], 1 / 60)).toBe(assisted);
    const raw = { steer: 0.3, accel: 0, brake: 0, drift: false, useItem: false };
    expect(race._inputFor(k, [raw], 1 / 60).accel).toBe(1); // Kid-Assist's full gas
    race.dispose();
  });

  it('the guest sends Kid-Assist inputs marked assisted', () => {
    let sawAssisted = 0;
    let sawRaw = 0;
    runNetRace({
      houses: [[1]], laps: 1, seed: 5, conditions: { latencyMs: 25 }, easyGuests: true, maxSeconds: 12,
      onGuestFrame: ({ g }) => {
        const e = g.replica.history.get(g.replica.predictedTick);
        for (const w of e?.wire ?? []) { if (w.assisted) sawAssisted++; else sawRaw++; }
      },
    });
    expect(sawAssisted).toBeGreaterThan(100);
    expect(sawRaw).toBe(0);
  });
});
