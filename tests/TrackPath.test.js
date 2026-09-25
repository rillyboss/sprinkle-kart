import { describe, it, expect } from 'vitest';
import { TrackPath } from '../src/track/TrackPath.js';

// A circle of radius 100 traversed counter-clockwise when viewed from +Y.
const circle = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [Math.cos(a) * 100, 0, Math.sin(a) * 100];
});

describe('TrackPath', () => {
  const path = new TrackPath(circle, 20);

  it('has roughly the circumference of the loop', () => {
    expect(path.length).toBeGreaterThan(2 * Math.PI * 100 * 0.97);
    expect(path.length).toBeLessThan(2 * Math.PI * 100 * 1.03);
  });

  it('wraps and computes shortest signed deltas', () => {
    expect(path.wrap(-1)).toBeCloseTo(path.length - 1, 3);
    expect(path.wrap(path.length + 5)).toBeCloseTo(5, 3);
    expect(path.delta(path.length - 5, 5)).toBeCloseTo(10, 3);
    expect(path.delta(5, path.length - 5)).toBeCloseTo(-10, 3);
  });

  it('projects points back to the same s and lateral', () => {
    for (const s of [0, 50, 200, 400, path.length - 3]) {
      for (const lat of [-8, 0, 6]) {
        const p = path.positionAt(s, lat);
        const pr = path.project(p);
        expect(Math.abs(path.delta(pr.s, s))).toBeLessThan(1.5);
        expect(pr.lateral).toBeCloseTo(lat, 0);
        expect(pr.offRoad).toBe(false);
      }
    }
  });

  it('flags off-road beyond half width, and hinted projection agrees', () => {
    const p = path.positionAt(120, 15);
    const pr = path.project(p, 118);
    expect(pr.offRoad).toBe(true);
    expect(Math.abs(path.delta(pr.s, 120))).toBeLessThan(1.5);
  });

  it('right vector is perpendicular to tangent and heading faces tangent', () => {
    const t = path.tangentAt(77);
    const r = path.rightAt(77);
    expect(t.x * r.x + t.z * r.z).toBeCloseTo(0, 5);
    const h = path.headingAt(77);
    expect(Math.sin(h)).toBeCloseTo(t.x, 4);
    expect(Math.cos(h)).toBeCloseTo(t.z, 4);
  });
});
