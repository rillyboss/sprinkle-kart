// Can a child who never drifts still win (and unlock Cotton Candy Girl)?
// The per-track races live in tests/race.fairness.<cup-id>.test.js (one file per cup, so
// vitest runs them in parallel — together they were the suite's critical path); the shared
// kid driver is tests/helpers/kidRace.js. This file keeps the pure AI checks, makes sure
// every registered track is covered by exactly one of those files, and races any track
// that is in no cup.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rubberBandMult, cpuDriftChance } from '../src/race/AI.js';
import { TRACKS } from '../src/data/tracks.js';
import { CUPS } from '../src/data/cups.js';
import { fairnessCase, tracksOutsideCups, MIN_WINS, MAX_MEAN_PLACE, FAIRNESS_SEEDS } from './helpers/kidRace.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('race fairness for non-drifting kids', () => {
  it('rubber band never lets CPUs outrun the human speed class', () => {
    for (const gap of [-400, -100, -31, -10, 0, 10, 80, 300]) {
      expect(rubberBandMult(0.95, gap)).toBeLessThanOrEqual(1.0);
    }
    expect(rubberBandMult(0.95, -10)).toBeLessThan(0.98); // on the kid's tail: a touch slower
    expect(rubberBandMult(0.92, 80)).toBeCloseTo(0.92 - 0.22, 5); // eased back firmly when ahead
    expect(rubberBandMult(0.95, -10, 1, true)).toBeLessThanOrEqual(0.9); // polite on the final lap
    expect(rubberBandMult(0.92, 40)).toBeLessThan(0.82);
  });

  it('CPUs drift less at Cozy/Zippy than at Zoomy', () => {
    expect(cpuDriftChance(0.75, false)).toBeLessThan(0.45);
    expect(cpuDriftChance(0.92, true)).toBeGreaterThan(0.7);
  });

  it('the bar is still "3 of 8 wins, near the front on average"', () => {
    expect(MIN_WINS).toBe(3);
    expect(FAIRNESS_SEEDS).toHaveLength(8);
    expect(MAX_MEAN_PLACE).toBeLessThanOrEqual(3);
  });

  it('every cup has its own fairness file, so every registered track is raced', () => {
    const files = readdirSync(HERE).filter((f) => /^race\.fairness\..+\.test\.js$/.test(f));
    const cupFiles = files.map((f) => f.replace(/^race\.fairness\.|\.test\.js$/g, ''));
    for (const cup of CUPS) expect(cupFiles, `add tests/race.fairness.${cup.id}.test.js`).toContain(cup.id);
    for (const id of cupFiles) expect(CUPS.map((c) => c.id), `stale fairness file for "${id}"`).toContain(id);
    const covered = new Set([...CUPS.flatMap((c) => c.trackIds), ...tracksOutsideCups().map((t) => t.id)]);
    for (const t of TRACKS) expect(covered.has(t.id), t.id).toBe(true);
  });

  // Tracks outside the 5 cups (none today) are raced here.
  for (const trackDef of tracksOutsideCups()) fairnessCase(trackDef);
});
