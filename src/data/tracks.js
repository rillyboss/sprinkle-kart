/**
 * Sprinkle Kart — track definitions.
 *
 * Layouts are authored with a tiny "turtle" language (straights + arcs) so
 * every curve is a true circular arc with a known radius (easy to keep
 * kid-drivable), then emitted as the plain `controlPoints` array the
 * TrackPath contract expects. Two straights per layout are marked `flex`:
 * their lengths are solved automatically so the loop closes exactly.
 *
 * Heading convention matches TrackPath: forward = (sin h, 0, cos h).
 * A positive `turn` is a LEFT turn (heading increases), negative is RIGHT.
 *
 * Everything the track builder needs to theme the world lives in `theme`
 * (contract fields) and `scenery` (extra, builder-only hints).
 */

const DEG = Math.PI / 180;

/**
 * Run a turtle program and return closed-loop control points.
 * @param {{start:[number,number], heading:number, y0?:number, emit?:number,
 *          ops:Array<object>}} spec
 *   op = { s: length, y?, hump?, flex?, mark? }            straight
 *      | { turn: degrees(+left/-right), r: radius, y?, hump?, mark? }  arc
 *   `y` is the elevation reached at the END of the op (smoothly eased),
 *   `hump` adds a sine bump of that height over the op (bridges).
 * @returns {{points:number[][], length:number, marks:Object<string,{start:number,end:number}>,
 *            closeError:number, flexLengths:number[]}}
 */
export function runLayout(spec) {
  const emit = spec.emit ?? 9;
  const ops = spec.ops;
  const flexIdx = ops.map((o, i) => (o.flex ? i : -1)).filter((i) => i >= 0);
  const totalTurn = ops.reduce((a, o) => a + (o.turn || 0), 0);
  if (Math.abs(Math.abs(totalTurn) - 360) > 1e-6) {
    throw new Error(`layout turns must sum to ±360, got ${totalTurn}`);
  }

  // Pass 1: find where the loop ends, then solve the two flex straights.
  const lengths = ops.map((o) => o.s ?? 0);
  const trial = trace(spec, lengths, 0);
  let flexLengths = [];
  if (flexIdx.length === 2) {
    const [a, b] = flexIdx;
    const ha = trial.headingAtOp[a];
    const hb = trial.headingAtOp[b];
    const ux = Math.sin(ha), uz = Math.cos(ha);
    const vx = Math.sin(hb), vz = Math.cos(hb);
    const ex = -(trial.endX - spec.start[0]);
    const ez = -(trial.endZ - spec.start[1]);
    const det = ux * vz - uz * vx;
    if (Math.abs(det) < 1e-3 && !globalThis.__SPRINKLE_TRACK_DEV__) throw new Error('flex straights must not be parallel');
    const da = (ex * vz - ez * vx) / det;
    const db = (ux * ez - uz * ex) / det;
    lengths[a] += da;
    lengths[b] += db;
    if ((lengths[a] < 5 || lengths[b] < 5) && !globalThis.__SPRINKLE_TRACK_DEV__) {
      throw new Error(`flex straights went too short (${lengths[a].toFixed(1)}, ${lengths[b].toFixed(1)})`);
    }
    flexLengths = [lengths[a], lengths[b]];
  }
  const out = trace(spec, lengths, emit);
  const closeError = Math.hypot(out.endX - spec.start[0], out.endZ - spec.start[1]);
  // Optionally move the start/finish line `startAt` units into the loop so
  // the starting grid (which sits behind the line) is on a straight.
  let points = out.points;
  let marks = out.marks;
  const k = Math.round((spec.startAt ?? 0) / emit);
  if (k > 0) {
    const shift = k * emit;
    const wrapD = (d) => ((d - shift) % out.length + out.length) % out.length;
    points = points.slice(k).concat(points.slice(0, k));
    marks = {};
    for (const [name, m] of Object.entries(out.marks)) {
      const start = wrapD(m.start);
      let end = wrapD(m.end);
      if (end < start) end += out.length;
      marks[name] = { start, end };
    }
  }
  return { points, length: out.length, marks, closeError, flexLengths };
}

function ease(t) {
  return t * t * (3 - 2 * t);
}

function trace(spec, lengths, emit) {
  let x = spec.start[0];
  let z = spec.start[1];
  let h = spec.heading * DEG;
  let y = spec.y0 ?? 0;
  const points = [];
  const marks = {};
  const headingAtOp = [];
  let dist = 0;
  let nextEmit = 0;
  const stepLen = 0.25;
  for (let i = 0; i < spec.ops.length; i++) {
    const op = spec.ops[i];
    headingAtOp.push(h);
    const len = op.turn !== undefined ? Math.abs(op.turn * DEG) * op.r : lengths[i];
    const y0 = y;
    const y1 = op.y ?? y0;
    const hump = op.hump ?? 0;
    const turnRate = op.turn !== undefined ? (op.turn * DEG) / len : 0; // radians per unit
    const n = Math.max(1, Math.ceil(len / stepLen));
    const ds = len / n;
    const opStart = dist;
    for (let k = 0; k < n; k++) {
      if (emit && dist >= nextEmit - 1e-9) {
        const t = (dist - opStart) / len;
        points.push([x, y0 + (y1 - y0) * ease(t) + hump * Math.sin(Math.PI * t), z]);
        nextEmit += emit;
      }
      // midpoint integration of the arc
      const hm = h + turnRate * ds * 0.5;
      x += Math.sin(hm) * ds;
      z += Math.cos(hm) * ds;
      h += turnRate * ds;
      dist += ds;
    }
    y = y1;
    if (op.mark) marks[op.mark] = { start: opStart, end: dist };
  }
  return { points, length: dist, marks, endX: x, endZ: z, headingAtOp };
}

/** Round control points to 2 decimals so the data stays tidy. */
function tidy(points) {
  return points.map((p) => p.map((v) => Math.round(v * 100) / 100));
}

/** Build a TrackDef from a layout, converting mark distances to fractions. */
function makeTrack(def, layoutSpec, extras) {
  const lay = runLayout(layoutSpec);
  const frac = (name, where = 'mid') => {
    const m = lay.marks[name];
    if (!m) throw new Error(`unknown mark ${name}`);
    const d = where === 'start' ? m.start : where === 'end' ? m.end : (m.start + m.end) / 2;
    return (d / lay.length) % 1;
  };
  if (globalThis.__SPRINKLE_TRACK_DEV__) {
    (globalThis.__SPRINKLE_TRACK_DEV_INFO__ ??= {})[def.id] = { flex: lay.flexLengths, marks: lay.marks, length: lay.length };
  }
  // Average XZ of the control points between two marks (or of the whole loop).
  const centroid = (fromMark, toMark) => {
    const emit = layoutSpec.emit ?? 9;
    const a = fromMark ? lay.marks[fromMark].start : 0;
    let b = toMark ? lay.marks[toMark].end : lay.length;
    if (b < a) b += lay.length;
    let x = 0, z = 0, n = 0;
    lay.points.forEach((p, i) => {
      let d = i * emit;
      if (d < a) d += lay.length;
      if (d >= a && d <= b) { x += p[0]; z += p[2]; n++; }
    });
    return [Math.round((x / n) * 10) / 10, Math.round((z / n) * 10) / 10];
  };
  const resolved = extras(frac, centroid);
  return { ...def, controlPoints: tidy(lay.points), ...resolved };
}

// ---------------------------------------------------------------------------
// 1. Cotton Candy Castle — the star track.
// The castle keep sits at the world origin inside a ring-shaped moat of
// strawberry milk. The road sweeps in over a rainbow hump bridge, through
// the front gatehouse, past the big front doors, out the far gatehouse and
// over a second bridge, then loops around the cotton-candy forest.
// ---------------------------------------------------------------------------
const CASTLE = {
  center: [0, 0],
  moatInner: 60,
  moatOuter: 68,
  chordZ: 32, // the road inside the castle grounds runs along z = 32
};

const cottonCandyCastle = makeTrack(
  {
    id: 'cotton-candy-castle',
    name: 'Cotton Candy Castle',
    subtitle: "Princess Peachy Pie's sugary palace",
    laps: 3,
    width: 18,
    previewColor: 0xffa6d8,
    theme: {
      skyTop: 0x8ec9ff,
      skyBottom: 0xffd9f0,
      fogColor: 0xffe0f2,
      fogNear: 160,
      fogFar: 620,
      ground: 0xffd9ef,
      road: 0xffc6e0,
      roadAlt: 0xffb8d8,
      curbA: 0xff5fa8,
      curbB: 0xffffff,
      offRoad: 0xffe7f3,
      music: 'castle',
      sunColor: 0xfff1e0,
      ambientColor: 0xffd6f0,
    },
  },
  {
    start: [-115, -40],
    heading: 0,
    ops: [
      { s: 42, mark: 'start-straight' },
      { turn: 90, r: 30, mark: 'turn-in' },
      { s: 14 },
      { s: 32, hump: 2.2, mark: 'bridge-in' },
      { s: 78, mark: 'courtyard' },
      { s: 32, hump: 2.2, mark: 'bridge-out' },
      { s: 14 },
      { turn: 90, r: 40, mark: 'east-turn' },
      { turn: -35, r: 50 },
      { turn: 35, r: 50, mark: 'east-s' },
      { s: 20 },
      { turn: 90, r: 55, mark: 'south-east' },
      { s: 60, flex: true, mark: 'back-straight' },
      { turn: -18, r: 90 },
      { turn: 36, r: 90, mark: 'forest-wiggle' },
      { turn: -18, r: 90 },
      { turn: -90, r: 26, mark: 'tongue-in' },
      { s: 70, mark: 'tongue-leg' },
      { turn: 180, r: 25, mark: 'hairpin' },
      { s: 150, flex: true, mark: 'return-leg' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('courtyard', 'start') + 0.012, frac('back-straight', 'mid'), frac('return-leg', 'mid')],
    boostPads: [
      { at: frac('courtyard', 'mid') + 0.012, lateral: -4 },
      { at: frac('east-s', 'end'), lateral: 3 },
      { at: frac('tongue-leg', 'mid'), lateral: -3 },
      { at: frac('hairpin', 'end') + 0.01, lateral: 3.5 },
    ],
    scenery: {
      kind: 'castle',
      castle: CASTLE,
      // s-fraction ranges that are bridges (rainbow deck + rainbow arches)
      bridges: [
        [frac('bridge-in', 'start'), frac('bridge-in', 'end')],
        [frac('bridge-out', 'start'), frac('bridge-out', 'end')],
      ],
      gates: [frac('courtyard', 'start') + 0.004, frac('courtyard', 'end') - 0.004],
      terrain: 'flat',
      fence: { post: 0xffffff, postAlt: 0xff7fbf, rail: 0xffa6d8, topper: 'heart', topperColor: 0xff4f9a },
      arch: { a: 0xff7fbf, b: 0xffffff, banner: 0xff5fa8, text: 'SPRINKLE KART' },
      startGridSide: 'straight',
    },
  }),
);

// ---------------------------------------------------------------------------
// 2. Gumdrop Meadow — sunny rolling hills, the gentle first track.
// The road is shaped like a big heart (look at the minimap!).
// ---------------------------------------------------------------------------
const gumdropMeadow = makeTrack(
  {
    id: 'gumdrop-meadow',
    name: 'Gumdrop Meadow',
    subtitle: 'Rolling hills of gumdrops and lollipops',
    laps: 3,
    width: 20,
    previewColor: 0x8fe08a,
    theme: {
      skyTop: 0x5fb8ff,
      skyBottom: 0xdff4ff,
      fogColor: 0xe4f6ff,
      fogNear: 170,
      fogFar: 650,
      ground: 0x93e07f,
      road: 0xf5dcae,
      roadAlt: 0xeccd9a,
      curbA: 0xff4d5e,
      curbB: 0xffffff,
      offRoad: 0xb8ec94,
      music: 'meadow',
      sunColor: 0xfff4d6,
      ambientColor: 0xd8f0ff,
    },
  },
  {
    start: [0, 0],
    heading: 135,
    startAt: 54,
    ops: [
      { s: 170, y: 3, flex: true, mark: 'start-straight' },
      { turn: 90, r: 82, y: 8, mark: 'right-lobe' },
      { turn: 90, r: 82, y: 6, mark: 'right-lobe-2' },
      { s: 20, y: 5 },
      { turn: -90, r: 30, y: 4, mark: 'dip' },
      { s: 20, y: 5, mark: 'dip-exit' },
      { turn: 90, r: 82, y: 9, mark: 'left-lobe' },
      { turn: 90, r: 82, y: 7, mark: 'left-lobe-2' },
      { s: 170, y: 1, flex: true, mark: 'left-side' },
      { turn: 90, r: 40, y: 0, mark: 'tip' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('start-straight', 'end') - 0.03, frac('dip-exit', 'mid'), frac('left-side', 'start') + 0.02, frac('left-side', 'end') - 0.03],
    boostPads: [
      { at: frac('start-straight', 'mid'), lateral: 4 },
      { at: frac('right-lobe-2', 'end'), lateral: -3 },
      { at: frac('left-lobe', 'end'), lateral: 3 },
      { at: frac('left-side', 'mid'), lateral: -4 },
    ],
    scenery: {
      kind: 'meadow',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 10, scale: 0.011 },
      fence: { post: 0xffffff, postAlt: 0xff3b4f, rail: 0xffffff, topper: 'cane', topperColor: 0xff3b4f },
      arch: { a: 0xff3b4f, b: 0xffffff, banner: 0x4fc3ff, text: 'SPRINKLE KART' },
    },
  }),
);

// ---------------------------------------------------------------------------
// 3. Starlight Galaxy — a glowing star road floating in space ("lollipop"
// layout: up the stem, round a giant swooping loop, back down the stem).
// ---------------------------------------------------------------------------
const starlightGalaxy = makeTrack(
  {
    id: 'starlight-galaxy',
    name: 'Starlight Galaxy',
    subtitle: "Stella's twinkly road among the planets",
    laps: 3,
    width: 18,
    previewColor: 0x7b6cff,
    theme: {
      skyTop: 0x0c0630,
      skyBottom: 0x5a2c8f,
      fogColor: 0x2a1654,
      fogNear: 200,
      fogFar: 800,
      ground: 0x3a1f6e,
      road: 0x3a36a6,
      roadAlt: 0x322e94,
      curbA: 0x6ff3ff,
      curbB: 0xff8ce6,
      offRoad: 0x4a3a9a,
      music: 'galaxy',
      sunColor: 0xd8d0ff,
      ambientColor: 0x8a7cff,
    },
  },
  {
    start: [0, 0],
    heading: 0,
    y0: 4,
    startAt: 54,
    ops: [
      { s: 110, y: 4, mark: 'start-straight' },
      { turn: -30, r: 60, y: 5 },
      { turn: 30, r: 60, y: 6, mark: 'stem-s' },
      { turn: -45, r: 60, y: 8 },
      { turn: 135, r: 95, y: 15, mark: 'loop-rise' },
      { turn: 135, r: 95, y: 9, mark: 'loop-fall' },
      { turn: -45, r: 60, y: 6, mark: 'loop-exit' },
      { s: 90, y: 2, flex: true, mark: 'stem-down' },
      { turn: 90, r: 34, y: 1, mark: 'bottom-left' },
      { s: 40, y: 1, flex: true, mark: 'bottom' },
      { turn: 90, r: 34, y: 4, mark: 'bottom-right' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('stem-s', 'end') + 0.01, frac('loop-rise', 'end'), frac('stem-down', 'mid')],
    boostPads: [
      { at: frac('start-straight', 'mid') + 0.02, lateral: -3.5 },
      { at: frac('loop-rise', 'mid'), lateral: 3 },
      { at: frac('loop-exit', 'end') + 0.01, lateral: -3 },
      { at: frac('bottom', 'mid'), lateral: 0 },
    ],
    scenery: {
      kind: 'galaxy',
      center: centroid('loop-rise', 'loop-fall'),
      terrain: 'void',
      fence: { post: 0xfff6a8, postAlt: 0x9ff7ff, rail: 0x9ff7ff, topper: 'star', topperColor: 0xfff27a, glow: true },
      arch: { a: 0x9f8cff, b: 0xfff27a, banner: 0x6a4cff, text: 'SPRINKLE KART' },
    },
  }),
);

// ---------------------------------------------------------------------------
// 4. Sundae Slopes — up an ice-cream mountain and down past chocolate rivers.
// ---------------------------------------------------------------------------
const sundaeSlopes = makeTrack(
  {
    id: 'sundae-slopes',
    name: 'Sundae Slopes',
    subtitle: 'Ice-cream mountains with a cherry on top',
    laps: 3,
    width: 18,
    previewColor: 0x9fe8ff,
    theme: {
      skyTop: 0x7fc4ff,
      skyBottom: 0xfff0f6,
      fogColor: 0xf4f0ff,
      fogNear: 160,
      fogFar: 620,
      ground: 0xfff8ee,
      road: 0xb9774f, // milk chocolate
      roadAlt: 0xc98a5e,
      curbA: 0xffffff, // whipped cream
      curbB: 0xffe9f2,
      offRoad: 0xfde7f0,
      music: 'sundae',
      sunColor: 0xffffff,
      ambientColor: 0xe6f0ff,
    },
  },
  {
    start: [0, 0],
    heading: 0,
    startAt: 54,
    ops: [
      { s: 70, flex: true, mark: 'start-straight' },
      { turn: -90, r: 60, y: 2, mark: 'first-turn' },
      { s: 60, y: 6, mark: 'climb' },
      { turn: 180, r: 28, y: 9, mark: 'hairpin' },
      { s: 100, y: 12, mark: 'summit-run' },
      { turn: -90, r: 60, y: 14, mark: 'summit' },
      { turn: -90, r: 60, y: 12, mark: 'summit-2' },
      { s: 80, y: 7, flex: true, mark: 'slide' },
      { turn: -90, r: 55, y: 4, mark: 'valley-turn' },
      { s: 100, y: 2.5, mark: 'approach' },
      { s: 34, y: 2.5, mark: 'bridge' },
      { s: 107, y: 0.5, mark: 'riverside' },
      { turn: -90, r: 55, y: 0, mark: 'top-turn' },
      { s: 100, y: 0, mark: 'top' },
      { turn: -90, r: 55, y: 0, mark: 'last-turn' },
    ],
  },
  (frac, centroid) => ({
    itemBoxRows: [frac('climb', 'mid'), frac('summit-run', 'mid'), frac('slide', 'mid'), frac('top', 'mid')],
    boostPads: [
      { at: frac('first-turn', 'end') + 0.006, lateral: -3 },
      { at: frac('hairpin', 'end') + 0.01, lateral: 3 },
      { at: frac('slide', 'start') + 0.01, lateral: -3.5 },
      { at: frac('riverside', 'mid'), lateral: 3 },
    ],
    scenery: {
      kind: 'sundae',
      center: centroid(),
      terrain: 'hills',
      hills: { amp: 8, scale: 0.013 },
      bridges: [[frac('bridge', 'start') - 0.02, frac('bridge', 'end') + 0.02]],
      river: { at: frac('bridge', 'mid') },
      fence: { post: 0xfff4e0, postAlt: 0xffb3d1, rail: 0xfff4e0, topper: 'cherry', topperColor: 0xe8203a },
      arch: { a: 0xe0a860, b: 0xfff4e0, banner: 0xff8cc6, text: 'SPRINKLE KART' },
    },
  }),
);

export const TRACKS = [cottonCandyCastle, gumdropMeadow, starlightGalaxy, sundaeSlopes];

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
