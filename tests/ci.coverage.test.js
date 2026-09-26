// The coverage gate (vite.config.js LOGIC_THRESHOLDS, enforced by `npm run test:coverage` in
// CI) covers every logic area and never drifts back down to the old, far-below-reality
// numbers (v2.0: race 88 % statements while the suite reached 99 %). Lowering a floor here
// needs a note in the PR, like lowering the threshold itself.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';

const thresholds = config.test.coverage.thresholds;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_FILES = readdirSync(`${ROOT}/src`, { recursive: true }).map((f) => `src/${String(f).replace(/\\/g, '/')}`);

/** Minimal glob -> RegExp for the threshold keys (**, *, {a,b}). */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else if (c === '*') re += '[^/]*';
    else if (c === '{') { const end = glob.indexOf('}', i); re += `(?:${glob.slice(i + 1, end).split(',').join('|')})`; i = end; } else re += c.replace(/[.+?^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Minimum statements / lines per area (the thresholds may be higher, never lower). */
const FLOORS = {
  'src/race/**/*.js': 95,
  'src/progress/**/*.js': 93,
  'src/input/**/*.js': 90,
  'src/modes/**/*.js': 92,
  'src/game/**/*.js': 94,
  'src/systems/**/*.js': 88,
  'src/ui/widgets/**/*.js': 80,
  'src/characters/**/*.js': 96,
  'src/tracks/**/*.js': 94,
};

describe('coverage gate', () => {
  it('has thresholds for every logic area', () => {
    for (const glob of Object.keys(FLOORS)) expect(Object.keys(thresholds), glob).toContain(glob);
  });

  it('never drops back below the floors', () => {
    for (const [glob, floor] of Object.entries(FLOORS)) {
      expect(thresholds[glob].statements, `${glob} statements`).toBeGreaterThanOrEqual(floor);
      expect(thresholds[glob].lines, `${glob} lines`).toBeGreaterThanOrEqual(floor);
    }
  });

  it('every threshold is complete and every glob matches real files', () => {
    for (const [glob, t] of Object.entries(thresholds)) {
      if (typeof t !== 'object') continue;
      for (const k of ['statements', 'branches', 'functions', 'lines']) {
        expect(t[k], `${glob} ${k}`).toBeGreaterThanOrEqual(75);
        expect(t[k], `${glob} ${k}`).toBeLessThanOrEqual(100);
      }
      const re = globToRegExp(glob);
      expect(SRC_FILES.filter((f) => re.test(f)).length, `${glob} matches no file`).toBeGreaterThan(0);
    }
  });
});
