// Throwaway probe: T / P / R / lead around the resume of soak race 2.
import { runNetRace } from '../../tests/helpers/netHarness.js';

let last = null;
runNetRace({
  track: 'cupcake-carnival', houses: [[2], [1]], laps: 1, seed: 102, clockOffsets: [23456.5, 34567.25],
  conditions: { latencyMs: 75, jitterMs: 20, loss: 0.03 }, pauses: [{ atMs: 12000, ms: 30000 }],
  onGuestFrame: ({ g, fr, t }) => {
    if (g.index !== 0 || t < 41800 || t > 42600) return;
    const k = g.replica.karts[0];
    const d = last ? Math.hypot(k.render.position.x - last.x, k.render.position.z - last.z) : 0;
    last = { x: k.render.position.x, z: k.render.position.z };
    console.log(Math.round(t), 'T', fr.T?.toFixed(1), 'P', fr.P?.toFixed(1), 'R', fr.R?.toFixed(1), 'lead', g.driver.lead.lead.toFixed(1),
      'paused', g.timeline.paused, 'pred', g.replica.predictedTick, 'd', d.toFixed(2), 'slack', g.driver.lastSlack, 'frozen', g.driver.lead.frozen);
  },
  maxSeconds: 44,
});
