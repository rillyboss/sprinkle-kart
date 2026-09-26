// The CI workflow shape: a fast required gate, a tiered smoke job, one run per ref.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planScenarios, resolveProfile, ORIGINAL_TRACK_IDS } from '../scripts/smoke-plan.mjs';

const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const smokeSrc = readFileSync(new URL('../scripts/smoke.mjs', import.meta.url), 'utf8');
const jobOf = (name) => {
  const start = yml.indexOf(`\n  ${name}:`);
  const rest = yml.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};
const flowNames = [...smokeSrc.slice(smokeSrc.indexOf('const FLOW_TESTS = {')).matchAll(/^\s+'([a-z0-9-]+)':/gm)].map((m) => m[1]);
const prFilters = () => {
  const m = /SMOKE_FILTERS:.*pull_request' && '([^']+)'/.exec(yml);
  return m ? m[1].split(/\s+/) : null;
};

describe('CI workflow', () => {
  it('runs on main pushes, PRs, manual dispatch and a nightly schedule', () => {
    expect(yml).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(yml).toMatch(/\n {2}pull_request:/);
    expect(yml).toMatch(/\n {2}workflow_dispatch:/);
    expect(yml).toMatch(/schedule:\s*\n(\s*#.*\n)*\s*- cron: '[0-9]+ [0-9]+ \* \* \*'/);
  });

  it('one run per ref: a newer push cancels the older run', () => {
    expect(yml).toMatch(/concurrency:\s*\n\s*group: ci-\$\{\{ github\.ref \}\}\s*\n\s*cancel-in-progress: true/);
  });

  it('test-and-build stays the fast gate: coverage suite + build, no smoke, no needs', () => {
    const job = jobOf('test-and-build');
    expect(job).toContain('npm run test:coverage');
    expect(job).toContain('npm run build');
    expect(job).not.toContain('scripts/smoke.mjs');
    expect(job).not.toContain('npm run smoke');
    expect(job).not.toMatch(/needs:/);
    expect(Number(/timeout-minutes:\s*(\d+)/.exec(job)[1])).toBeLessThanOrEqual(20);
  });

  it('smoke runs after the gate and passes its filters to smoke.mjs', () => {
    const job = jobOf('smoke');
    expect(job).toMatch(/needs: test-and-build/);
    expect(job).toContain('node scripts/smoke.mjs $SMOKE_FILTERS');
    // non-PR events get an empty filter list = every scenario
    expect(job).toMatch(/SMOKE_FILTERS: \$\{\{ github\.event_name == 'pull_request' && '[^']+' \|\| '' \}\}/);
  });

  it('the PR subset is short but real: every filter matches at least one scenario', () => {
    const filters = prFilters();
    expect(filters).not.toBe(null);
    const profile = resolveProfile({ CI: 'true' });
    const trackIds = [...ORIGINAL_TRACK_IDS];
    for (const f of filters) {
      expect(planScenarios({ trackIds, filters: [f], profile, flows: flowNames }).length, f).toBeGreaterThan(0);
    }
    const plan = planScenarios({ trackIds, filters, profile, flows: flowNames });
    const full = planScenarios({ trackIds, filters: [], profile, flows: flowNames });
    expect(plan.map((s) => s.name)).toEqual(['cotton-candy-castle-1p', 'menu-flow', 'gamepad-flow', 'results-unlock', 'modes-menu']);
    expect(plan.length).toBeLessThan(full.length / 2);
  });

  it('smoke.mjs lists the flows the PR subset names', () => {
    for (const f of ['menu-flow', 'gamepad-flow', 'results-unlock', 'modes-menu']) expect(flowNames).toContain(f);
  });
});

describe('GitHub Pages workflow', () => {
  const pages = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const viteCfg = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  const infra = readFileSync(new URL('../docs/INFRA_SETUP.md', import.meta.url), 'utf8');

  it('deploys the production build on main pushes and on demand', () => {
    expect(pages).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(pages).toMatch(/\n {2}workflow_dispatch:/);
    expect(pages).toContain('npm run build');
    expect(pages).toMatch(/upload-pages-artifact@v\d+\s*\n\s*with:\s*\n\s*path: dist/);
    expect(pages).toContain('actions/deploy-pages@');
    expect(pages).toMatch(/deploy:\s*\n\s*needs: build/);
  });

  it('has only the permissions Pages needs and never cancels a live deploy', () => {
    expect(pages).toMatch(/permissions:\s*\n\s*contents: read\s*\n\s*pages: write\s*\n\s*id-token: write/);
    expect(pages).toMatch(/concurrency:\s*\n\s*group: pages\s*\n\s*cancel-in-progress: false/);
  });

  it('passes the optional signaling URL as a public variable, never a secret', () => {
    expect(pages).toContain('VITE_SIGNAL_URL: ${{ vars.VITE_SIGNAL_URL }}');
    expect(pages).not.toMatch(/secrets\./);
  });

  it('the build uses a relative base so it works from the /sprinkle-kart/ sub-path', () => {
    expect(viteCfg).toMatch(/base: '\.\/'/);
  });

  it('the infra guide says which steps are ready today and names the workflow', () => {
    expect(infra).toContain('## Status right now');
    expect(infra).toContain('.github/workflows/pages.yml');
    expect(infra).toContain('https://rillyboss.github.io/sprinkle-kart/');
  });
});
