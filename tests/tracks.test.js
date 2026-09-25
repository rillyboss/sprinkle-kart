import { describe, it, expect } from 'vitest';
import { TRACKS, getTrack, runLayout } from '../src/data/tracks.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { SONG_IDS } from '../src/audio/songs.js';
import { computeItemBoxSlots, computeBoostPads, createPathIndex, FENCE_OFFSET } from '../src/render/trackBuilder.js';

const paths = new Map(TRACKS.map((t) => [t.id, new TrackPath(t.controlPoints, t.width)]));

/** Minimum radius of curvature (world units), measured over a ±3 unit window. */
function minRadius(path) {
  const n = path.count;
  const w = Math.max(1, Math.round(3 / path.step));
  let min = Infinity;
  let at = 0;
  for (let i = 0; i < n; i++) {
    const a = (i - w + n) % n, b = (i + w) % n;
    let d = Math.atan2(path.tx[b], path.tz[b]) - Math.atan2(path.tx[a], path.tz[a]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const r = (2 * w * path.step) / Math.max(1e-9, Math.abs(d));
    if (r < min) { min = r; at = i * path.step; }
  }
  return { min, at };
}

describe('track definitions', () => {
  it('starts with the four Sprinkle Cup tracks, all ids unique', () => {
    expect(TRACKS.slice(0, 4).map((t) => t.id)).toEqual(['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes']);
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
  });

  it('getTrack finds by id and falls back to the first track', () => {
    expect(getTrack('sundae-slopes').name).toBe('Sundae Slopes');
    expect(getTrack('nope').id).toBe('cotton-candy-castle');
  });

  it.each(TRACKS.map((t) => [t.id, t]))('%s has every contract field', (id, t) => {
    expect(typeof t.name).toBe('string');
    expect(typeof t.subtitle).toBe('string');
    expect(t.laps).toBeGreaterThanOrEqual(1);
    expect(t.width).toBeGreaterThanOrEqual(16);
    expect(typeof t.previewColor).toBe('number');
    for (const key of ['skyTop', 'skyBottom', 'fogColor', 'fogNear', 'fogFar', 'ground', 'road', 'roadAlt',
      'curbA', 'curbB', 'offRoad', 'sunColor', 'ambientColor']) {
      expect(typeof t.theme[key], key).toBe('number');
    }
    expect(SONG_IDS).toContain(t.theme.music);
    expect(t.theme.music).not.toBe('menu');
    expect(t.theme.music).not.toBe('victory');
    expect(t.theme.fogFar).toBeGreaterThan(t.theme.fogNear);
    expect(Array.isArray(t.itemBoxRows)).toBe(true);
    expect(t.itemBoxRows.length).toBeGreaterThanOrEqual(3);
    expect(t.boostPads.length).toBeGreaterThanOrEqual(2);
    for (const f of t.itemBoxRows) expect(f).toBeGreaterThanOrEqual(0), expect(f).toBeLessThan(1);
    for (const b of t.boostPads) expect(b.at).toBeGreaterThanOrEqual(0), expect(b.at).toBeLessThan(1);
    for (const p of t.controlPoints) {
      expect(p).toHaveLength(3);
      p.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    }
  });

  it('uses only friendly words in names', () => {
    const text = TRACKS.map((t) => `${t.name} ${t.subtitle}`).join(' ').toLowerCase();
    for (const bad of ['kill', 'die', 'dead', 'crash', 'destroy', 'hit']) expect(text).not.toMatch(new RegExp(`\\b${bad}\\b`));
  });
});

describe.each(TRACKS.map((t) => [t.id, t]))('layout of %s', (id, t) => {
  const path = paths.get(id);

  it('loads into TrackPath with a length of 900–1600', () => {
    expect(path.length).toBeGreaterThanOrEqual(900);
    expect(path.length).toBeLessThanOrEqual(1600);
  });

  it('is a closed loop with no gap or elevation jump at the seam', () => {
    const first = t.controlPoints[0];
    const last = t.controlPoints[t.controlPoints.length - 1];
    expect(Math.hypot(first[0] - last[0], first[2] - last[2])).toBeLessThan(15);
    expect(Math.abs(first[1] - last[1])).toBeLessThan(1);
  });

  it('never comes close to itself (unless separated by a tall bridge)', () => {
    const n = path.count;
    const minGap = t.width * 1.5;
    let worst = Infinity;
    for (let i = 0; i < n; i += 2) {
      for (let j = i + 2; j < n; j += 2) {
        let ds = Math.abs(i - j) * path.step;
        ds = Math.min(ds, path.length - ds);
        if (ds <= 60) continue;
        if (Math.abs(path.py[i] - path.py[j]) >= 8) continue;
        worst = Math.min(worst, Math.hypot(path.px[i] - path.px[j], path.pz[i] - path.pz[j]));
      }
    }
    expect(worst).toBeGreaterThan(minGap);
  });

  it('has curves gentle enough for its width (and the fences never fold)', () => {
    const { min } = minRadius(path);
    expect(min).toBeGreaterThan(t.width * 1.15);
    expect(min).toBeGreaterThan(path.halfWidth + FENCE_OFFSET + 5);
  });

  it('keeps elevation gentle (max ~15 units, soft slopes)', () => {
    let lo = Infinity, hi = -Infinity, slope = 0;
    for (let i = 0; i < path.count; i++) {
      lo = Math.min(lo, path.py[i]);
      hi = Math.max(hi, path.py[i]);
      slope = Math.max(slope, Math.abs(path.py[(i + 1) % path.count] - path.py[i]) / path.step);
    }
    expect(hi - lo).toBeLessThanOrEqual(16);
    expect(slope).toBeLessThan(0.25);
  });

  it('starts on a straight so the grid lines up nicely', () => {
    // the grid sits up to ~45 units behind the line
    const t0 = path.tangentAt(-45);
    for (let s = -45; s <= 10; s += 5) {
      const tt = path.tangentAt(s);
      expect(t0.x * tt.x + t0.z * tt.z).toBeGreaterThan(0.97);
    }
  });

  it('puts every item box inside the road', () => {
    const slots = computeItemBoxSlots(t, path);
    expect(slots.length).toBe(t.itemBoxRows.length * (t.width >= 18 ? 5 : 4));
    for (const slot of slots) {
      expect(Math.abs(slot.lateral) + 1).toBeLessThanOrEqual(path.halfWidth);
      const pr = path.project(slot.position, slot.s);
      expect(pr.offRoad).toBe(false);
      expect(Math.abs(path.delta(pr.s, slot.s))).toBeLessThan(1);
    }
  });

  it('puts every boost pad fully inside the road and away from item rows and the start', () => {
    const pads = computeBoostPads(t, path);
    expect(pads.length).toBe(t.boostPads.length);
    for (const pad of pads) {
      expect(pad.length).toBe(6);
      expect(pad.halfWidth).toBe(2.5);
      expect(Math.abs(pad.lateral) + pad.halfWidth).toBeLessThanOrEqual(path.halfWidth);
      // the def itself should already be inside (no silent clamping)
      const def = t.boostPads[pads.indexOf(pad)];
      expect(Math.abs(def.lateral ?? 0) + 2.5).toBeLessThanOrEqual(path.halfWidth);
      expect(Math.abs(path.delta(pad.s, 0))).toBeGreaterThan(12);
      for (const f of t.itemBoxRows) {
        expect(Math.abs(path.delta(pad.s, f * path.length))).toBeGreaterThan(8);
      }
    }
  });

  it('spreads item rows out around the lap', () => {
    const rows = [...t.itemBoxRows].sort((a, b) => a - b);
    for (let i = 0; i < rows.length; i++) {
      const next = i + 1 < rows.length ? rows[i + 1] : rows[0] + 1;
      expect((next - rows[i]) * path.length).toBeGreaterThan(80);
    }
  });
});

describe('Cotton Candy Castle specifics', () => {
  const t = getTrack('cotton-candy-castle');
  const path = paths.get(t.id);
  const c = t.scenery.castle;

  it('crosses the strawberry-milk moat only on raised bridges', () => {
    let crossings = 0;
    let wasOver = false;
    for (let i = 0; i < path.count; i++) {
      const r = Math.hypot(path.px[i] - c.center[0], path.pz[i] - c.center[1]);
      const over = r > c.moatInner - 0.5 && r < c.moatOuter + 0.5;
      if (over) expect(path.py[i]).toBeGreaterThan(1.2);
      if (over && !wasOver) crossings++;
      wasOver = over;
    }
    expect(crossings).toBe(2);
  });

  it('keeps the castle keep clear of the road', () => {
    const index = createPathIndex(path);
    expect(index.nearest(c.center[0], c.center[1], 200).dist).toBeGreaterThan(path.halfWidth + FENCE_OFFSET + 16);
  });

  it('has bridge ranges that line up with the moat', () => {
    for (const [a, b] of t.scenery.bridges) {
      const mid = path.pointAt(((a + b) / 2) * path.length);
      const r = Math.hypot(mid.x - c.center[0], mid.z - c.center[1]);
      expect(r).toBeGreaterThan(c.moatInner - 2);
      expect(r).toBeLessThan(c.moatOuter + 2);
      expect(mid.y).toBeGreaterThan(1.8);
    }
  });
});

describe('runLayout', () => {
  it('solves flex straights so the loop closes exactly', () => {
    const lay = runLayout({
      start: [0, 0], heading: 0,
      ops: [
        { s: 50, flex: true }, { turn: 90, r: 30 }, { s: 70, flex: true }, { turn: 90, r: 30 },
        { s: 40 }, { turn: 90, r: 30 }, { s: 20 }, { turn: 90, r: 30 },
      ],
    });
    expect(lay.closeError).toBeLessThan(1e-6);
    expect(lay.flexLengths[0]).toBeGreaterThan(5);
  });

  it('rejects loops whose turns do not add up to a full circle', () => {
    expect(() => runLayout({ start: [0, 0], heading: 0, ops: [{ s: 10 }, { turn: 90, r: 10 }] })).toThrow();
  });

  it('records marks and applies humps', () => {
    const lay = runLayout({
      start: [0, 0], heading: 0, emit: 1,
      ops: [{ s: 40, hump: 3, mark: 'bump' }, { turn: 180, r: 20 }, { s: 40 }, { turn: 180, r: 20 }],
    });
    expect(lay.marks.bump.end - lay.marks.bump.start).toBeCloseTo(40, 3);
    const peak = Math.max(...lay.points.slice(0, 40).map((p) => p[1]));
    expect(peak).toBeGreaterThan(2.9);
  });
});

describe('createPathIndex', () => {
  it('agrees with a brute-force nearest search', () => {
    const path = paths.get('gumdrop-meadow');
    const index = createPathIndex(path);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const b = path.getBounds();
    for (let k = 0; k < 60; k++) {
      const x = b.minX - 30 + rnd() * (b.maxX - b.minX + 60);
      const z = b.minZ - 30 + rnd() * (b.maxZ - b.minZ + 60);
      let best = Infinity;
      for (let i = 0; i < path.count; i++) best = Math.min(best, Math.hypot(x - path.px[i], z - path.pz[i]));
      const got = index.nearest(x, z, 1e6).dist;
      expect(got).toBeCloseTo(best, 5);
    }
  });
});
