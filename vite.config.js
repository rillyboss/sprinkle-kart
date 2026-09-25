import { defineConfig } from 'vite';

/**
 * Coverage quality gate (`npm run test:coverage`, run in CI). Thresholds apply to the
 * pure-logic modules only (rendering / DOM screens are covered by the smoke test).
 * They sit a few points under today's numbers so honest new code passes while a
 * big untested addition (or deleted tests) fails the build. Raise them, never lower
 * them without a note in the PR.
 */
const LOGIC_THRESHOLDS = {
  'src/race/**/*.js': { statements: 88, branches: 80, functions: 80, lines: 90 },
  'src/progress/**/*.js': { statements: 85, branches: 70, functions: 80, lines: 85 },
  'src/input/**/*.js': { statements: 85, branches: 75, functions: 70, lines: 88 },
  'src/ui/{menuState,screenFlow,hudLogic}.js': { statements: 88, branches: 78, functions: 85, lines: 90 },
  'src/track/**/*.js': { statements: 90, branches: 78, functions: 85, lines: 90 },
  'src/tracks/{layout,pathTools}.js': { statements: 90, branches: 78, functions: 85, lines: 90 },
  'src/audio/compile.js': { statements: 90, branches: 75, functions: 90, lines: 90 },
};

export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text-summary', 'html', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: LOGIC_THRESHOLDS,
    },
  },
});
