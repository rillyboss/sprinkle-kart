// Build output stays warning-free (net review #21): the online code pushed the single game chunk past Vite's
// 1500 kB warning. three.js now builds into its own chunk (also cached across game-only deploys) and the
// network code stays lazy (import('./online/index.js') only once Online is opened).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import config from '../vite.config.js';

describe('vite build chunks', () => {
  it('three.js is its own chunk; the warning limit is not raised', () => {
    const cfg = typeof config === 'function' ? config({ mode: 'production', command: 'build' }) : config;
    expect(cfg.build.chunkSizeWarningLimit).toBe(1500);
    const groups = cfg.build.rolldownOptions.output.codeSplitting.groups;
    const three = groups.find((g) => g.name === 'three');
    expect(three).toBeTruthy();
    expect(three.test.test('/x/node_modules/three/build/three.module.js')).toBe(true);
    expect(three.test.test('C:\\x\\node_modules\\three\\src\\Three.js')).toBe(true);
    expect(three.test.test('/x/src/race/Race.js')).toBe(false);
    expect(three.test.test('/x/node_modules/threejs-other/x.js')).toBe(false);
  });

  it('main.js still imports no network code up front', () => {
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    expect(main).toContain("import('./online/index.js')");
    expect(main).not.toMatch(/^import .*net\/version\.js/m);
  });
});
