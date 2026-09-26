// Quick flex-solver exploration: node dev/tracks-cozy/explore.mjs
globalThis.__SPRINKLE_TRACK_DEV__ = true;
const { runLayout } = await import('../../src/tracks/layout.js');
const mk = (inner, tip, R, outerTurn, ri) => ({
  start: [0, 0], heading: 0, ops: [
    { s: 60, flex: true },
    { turn: outerTurn, r: R },
    { s: 30, flex: true },
    { turn: 180 - (outerTurn / 2) + inner / 2, r: tip },
    { turn: -inner, r: ri },
    { turn: 180 - (outerTurn / 2) + inner / 2, r: tip },
  ],
});
for (const R of [160, 170]) for (const outerTurn of [250, 260]) for (const inner of [140, 160]) for (const ri of [50, 60]) {
  const l = runLayout(mk(inner, 32, R, outerTurn, ri));
  console.log(R, outerTurn, inner, ri, l.flexLengths.map((v) => v.toFixed(0)).join(','), l.length.toFixed(0));
}
