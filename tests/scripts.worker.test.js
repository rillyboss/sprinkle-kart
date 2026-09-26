// scripts/worker.mjs: the root wrappers for the signal worker's pinned tooling (NETWORKING.md §3, P0).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  planWorkerCommand, runPlan, nodeMajor, MIN_NODE_MAJOR, WORKER_DIR, SECRET_NAMES,
} from '../scripts/worker.mjs';

const ready = { nodeVersion: 'v24.1.0', hasWorkerDir: true, hasModules: true, hasDevVars: true, hasDevVarsExample: true };
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const runs = (plan) => plan.steps.filter((s) => s.kind === 'run');

describe('nodeMajor', () => {
  it('reads process.version strings', () => {
    expect(nodeMajor('v20.20.0')).toBe(20);
    expect(nodeMajor('25.4.0')).toBe(25);
    expect(nodeMajor('')).toBeNaN();
    expect(nodeMajor(undefined)).toBeNaN();
  });
});

describe('planWorkerCommand', () => {
  it('runs the pinned wrangler (never an unpinned download) inside the worker package', () => {
    for (const [cmd, wrangler] of [['dev', ['dev']], ['deploy', ['deploy']], ['login', ['login']], ['whoami', ['whoami']]]) {
      const plan = planWorkerCommand([cmd], ready);
      expect(plan.ok, cmd).toBe(true);
      expect(runs(plan)).toEqual([{ kind: 'run', cmd: 'npx', args: ['--no-install', 'wrangler', ...wrangler], cwd: WORKER_DIR }]);
    }
  });

  it('passes extra arguments through to wrangler', () => {
    const plan = planWorkerCommand(['dev', '--port', '8788'], ready);
    expect(runs(plan)[0].args).toEqual(['--no-install', 'wrangler', 'dev', '--port', '8788']);
  });

  it('installs the worker package first when it has never been installed', () => {
    const plan = planWorkerCommand(['deploy'], { ...ready, hasModules: false });
    expect(runs(plan).map((s) => [s.cmd, s.args[0]])).toEqual([['npm', 'ci'], ['npx', '--no-install']]);
    expect(plan.steps[0].cwd).toBe(WORKER_DIR);
  });

  it('runs the worker test suite with npm test', () => {
    expect(runs(planWorkerCommand(['test'], ready))).toEqual([{ kind: 'run', cmd: 'npm', args: ['test'], cwd: WORKER_DIR }]);
  });

  it('only stores the two known secrets, by name', () => {
    for (const name of SECRET_NAMES) {
      expect(runs(planWorkerCommand(['secret', name], ready))[0].args).toEqual(['--no-install', 'wrangler', 'secret', 'put', name]);
    }
    for (const bad of [[], ['CLOUDFLARE_API_TOKEN'], ['turn_key_id']]) {
      const plan = planWorkerCommand(['secret', ...bad], ready);
      expect(plan.ok).toBe(false);
      expect(plan.message).toContain('TURN_KEY_ID');
    }
  });

  it('seeds the gitignored .dev.vars from the template for local dev only', () => {
    const plan = planWorkerCommand(['dev'], { ...ready, hasDevVars: false });
    expect(plan.steps[0]).toEqual({ kind: 'copy', from: join(WORKER_DIR, '.dev.vars.example'), to: join(WORKER_DIR, '.dev.vars') });
    expect(planWorkerCommand(['deploy'], { ...ready, hasDevVars: false }).steps.some((s) => s.kind === 'copy')).toBe(false);
    expect(planWorkerCommand(['dev'], { ...ready, hasDevVars: false, hasDevVarsExample: false }).steps.some((s) => s.kind === 'copy')).toBe(false);
  });

  it(`refuses Node older than ${MIN_NODE_MAJOR} with a friendly, actionable message`, () => {
    const plan = planWorkerCommand(['dev'], { ...ready, nodeVersion: 'v20.20.0' });
    expect(plan.ok).toBe(false);
    expect(plan.message).toMatch(/Node\.js 22 or newer/);
    expect(plan.message).toContain('v20.20.0');
  });

  it('explains when the worker has not landed yet', () => {
    const plan = planWorkerCommand(['deploy'], { ...ready, hasWorkerDir: false });
    expect(plan.ok).toBe(false);
    expect(plan.message).toContain('infra/signal-worker');
    expect(plan.message).toContain('docs/INFRA_SETUP.md');
  });

  it('rejects unknown commands with the list of real ones', () => {
    for (const argv of [[], ['destroy']]) {
      const plan = planWorkerCommand(argv, ready);
      expect(plan.ok).toBe(false);
      expect(plan.message).toContain('worker:dev');
    }
  });

  it('uses friendly words only', () => {
    const messages = [
      planWorkerCommand(['x'], ready), planWorkerCommand(['dev'], { ...ready, nodeVersion: 'v18.0.0' }),
      planWorkerCommand(['dev'], { ...ready, hasWorkerDir: false }), planWorkerCommand(['secret'], ready),
    ].map((p) => p.message.toLowerCase());
    for (const m of messages) expect(m).not.toMatch(/\b(error|fatal|fail|crash|kill|abort)\b/);
  });
});

describe('runPlan', () => {
  it('runs steps in order from the repo root and stops at the first failure', () => {
    const calls = [];
    const spawn = vi.fn((cmd, args, opts) => { calls.push([cmd, args[0], opts.cwd]); return { status: calls.length === 1 ? 0 : 3 }; });
    const copy = vi.fn();
    const plan = { ok: true, steps: [
      { kind: 'copy', from: 'a', to: 'b' },
      { kind: 'run', cmd: 'npm', args: ['ci'], cwd: WORKER_DIR },
      { kind: 'run', cmd: 'npx', args: ['--no-install'], cwd: WORKER_DIR },
      { kind: 'run', cmd: 'never', args: [], cwd: WORKER_DIR },
    ] };
    expect(runPlan(plan, { root: '/repo', spawn, copy })).toBe(3);
    expect(copy).toHaveBeenCalledWith(join('/repo', 'a'), join('/repo', 'b'));
    expect(calls).toEqual([['npm', 'ci', join('/repo', WORKER_DIR)], ['npx', '--no-install', join('/repo', WORKER_DIR)]]);
  });

  it('prints the message and returns 1 for a refused plan', () => {
    const log = vi.fn();
    expect(runPlan({ ok: false, message: 'hello' }, { root: '/repo', log })).toBe(1);
    expect(log).toHaveBeenCalledWith('hello');
  });
});

describe('root package.json wires the worker scripts through the wrapper', () => {
  it.each([
    ['worker:dev', 'dev'], ['worker:test', 'test'], ['worker:deploy', 'deploy'],
    ['worker:login', 'login'], ['worker:secret', 'secret'],
  ])('%s → node scripts/worker.mjs %s', (script, cmd) => {
    expect(pkg.scripts[script]).toBe(`node scripts/worker.mjs ${cmd}`);
  });

  it('keeps the root install light (no wrangler in the root package)', () => {
    expect(pkg.dependencies?.wrangler).toBeUndefined();
    expect(pkg.devDependencies?.wrangler).toBeUndefined();
  });
});
