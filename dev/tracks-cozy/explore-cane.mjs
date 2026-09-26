// Candy-cane layout exploration: node dev/tracks-cozy/explore-cane.mjs
globalThis.__SPRINKLE_TRACK_DEV__ = true;
const { runLayout } = await import('../../src/tracks/layout.js');
const mk = (R, tip, inner, bend, br) => ({
  start: [0, 0], heading: 0, ops: [
    { s: 200, flex: true },
    { turn: 180, r: R },
    { s: 40 },
    { turn: 180, r: tip },
    { s: 40 },
    { turn: -180, r: inner },
    { s: 120 },
    { turn: bend, r: 200 },
    { turn: 90 - bend / 2, r: br },
    { s: 10, flex: true },
    { turn: 90 - bend / 2, r: br },
  ],
});
for (const bend of [-30, -40, -50]) for (const br of [52, 58]) {
  const l = runLayout(mk(136, 42, 52, bend, br));
  console.log(bend, br, l.flexLengths.map((v) => v.toFixed(0)).join(','), l.length.toFixed(0));
}
