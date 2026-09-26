import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
// Mobile platform (PWA + offline): self-hosted fonts and the generated service worker (build/*.js).
import { selfHostFonts } from './build/fonts.js';
import { pwaServiceWorker } from './build/pwa.js';

/** The deploy id every build announces online (NETWORKING.md §7.2): the commit, or 'dev'. */
function skBuildId() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

/**
 * Coverage quality gate (`npm run test:coverage`, run in CI). Thresholds apply to the
 * logic modules (DOM screens in src/ui/screens and the main.js boot/loop are covered by
 * the smoke test instead). Each sits 2-4 points under the measured numbers (v2.0 test
 * hardening, noted per line as s/b/f/l) so honest new code passes while a big untested
 * addition (or deleted tests) fails the build. Raise them, never lower them without a
 * note in the PR.
 */
const LOGIC_THRESHOLDS = {
  'src/race/**/*.js': { statements: 96, branches: 92, functions: 94, lines: 97 }, // 99.0/95.2/96.8/99.2
  'src/progress/**/*.js': { statements: 94, branches: 87, functions: 95, lines: 94 }, // 96.8/90.5/97.8/96.6
  'src/input/**/*.js': { statements: 91, branches: 86, functions: 83, lines: 94 }, // 93.8/89.1/85.9/96.4
  'src/ui/{menuState,screenFlow,hudLogic,hudWidgets}.js': { statements: 93, branches: 84, functions: 93, lines: 95 }, // ~96/88/96/97
  'src/ui/widgets/**/*.js': { statements: 80, branches: 79, functions: 88, lines: 83 }, // 83.0/82.2/91.1/86.0
  'src/track/**/*.js': { statements: 93, branches: 82, functions: 90, lines: 95 }, // 95.9/85.7/92.3/97.0
  'src/tracks/{layout,pathTools}.js': { statements: 95, branches: 85, functions: 92, lines: 96 }, // 97.4/88.5/94.3/98.6
  'src/tracks/**/*.js': { statements: 95, branches: 84, functions: 95, lines: 96 }, // 98.0/86.9/98.7/98.9
  'src/characters/**/*.js': { statements: 97, branches: 91, functions: 97, lines: 97 }, // 99.7/94.8/100/99.7
  'src/audio/compile.js': { statements: 94, branches: 80, functions: 98, lines: 97 }, // 96.2/82.2/100/99.2
  'src/modes/**/*.js': { statements: 93, branches: 85, functions: 92, lines: 95 }, // 96.1/88.6/95.4/97.2
  'src/game/**/*.js': { statements: 95, branches: 86, functions: 92, lines: 97 }, // 97.7/89.6/95.1/99.5
  'src/systems/**/*.js': { statements: 89, branches: 83, functions: 93, lines: 92 }, // 92.5/86.0/96.5/94.8
  'src/presentation/**/*.js': { statements: 97, branches: 92, functions: 97, lines: 97 }, // 99.8/95.3/100/100
  'src/fx/**/*.js': { statements: 97, branches: 91, functions: 97, lines: 97 }, // 100/94.4/100/100
  'src/data/**/*.js': { statements: 97, branches: 92, functions: 97, lines: 97 }, // 100/95.7/100/100
};

export default defineConfig({
  base: './',
  server: { port: 5173 },
  plugins: [selfHostFonts(), pwaServiceWorker({ buildId: skBuildId })],
  build: {
    chunkSizeWarningLimit: 1500,
    // three.js in its own chunk: the game chunk stays under the warning limit (net review #21), and returning
    // players keep the cached engine when only game code changed between deploys
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }] } } },
  },
  define: { __SK_BUILD__: JSON.stringify(skBuildId()) },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Headless races and whole-registry suites are CPU-heavy and every worker competes for
    // cores, so a single test may take several seconds (more on 4-vCPU CI runners).
    testTimeout: process.env.CI ? 90000 : 45000,
    hookTimeout: process.env.CI ? 90000 : 45000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text-summary', 'html', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: LOGIC_THRESHOLDS,
    },
  },
});
