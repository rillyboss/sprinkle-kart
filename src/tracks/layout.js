/**
 * Track layout DSL — shared by every track module (src/tracks/<id>.js).
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
export function tidy(points) {
  return points.map((p) => p.map((v) => Math.round(v * 100) / 100));
}

/**
 * Build a TrackDef from a layout, converting mark distances to fractions.
 * @param {object} def        TrackDef fields except controlPoints/itemBoxRows/boostPads/scenery
 * @param {object} layoutSpec runLayout() spec (start, heading, y0?, emit?, startAt?, ops)
 * @param {(frac:(mark:string, where?:'start'|'mid'|'end')=>number, centroid:(fromMark?:string, toMark?:string)=>[number,number])=>object} extras
 *        returns { itemBoxRows, boostPads, scenery, ... } using mark fractions
 */
export function makeTrack(def, layoutSpec, extras) {
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
