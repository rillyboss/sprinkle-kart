#!/usr/bin/env node
// Wrapper for the signal worker's tooling (NETWORKING.md §3, docs/INFRA_SETUP.md).
//
//   npm run worker:dev                      local `wrangler dev` (no Cloudflare account needed)
//   npm run worker:test                     the worker's own test suite (@cloudflare/vitest-plugin)
//   npm run worker:deploy                   `wrangler deploy`
//   npm run worker:login                    `wrangler login` (also: node scripts/worker.mjs whoami)
//   npm run worker:secret -- TURN_KEY_ID    `wrangler secret put TURN_KEY_ID` (TURN_KEY_API_TOKEN likewise)
//
// Why a wrapper: the worker lives in its own package (infra/signal-worker, pinned wrangler) so the game's
// root `npm ci` stays light. This script checks for Node 22+, installs that package on first use, and runs
// the PINNED wrangler with `npx --no-install`, so nobody accidentally runs whatever wrangler is newest today.
import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIN_NODE_MAJOR = 22;
export const WORKER_DIR = join('infra', 'signal-worker');
export const SECRET_NAMES = Object.freeze(['TURN_KEY_ID', 'TURN_KEY_API_TOKEN']);

const WRANGLER = {
  dev: ['dev'],
  deploy: ['deploy'],
  login: ['login'],
  whoami: ['whoami'],
};

const HELP = 'Try: worker:dev, worker:test, worker:deploy, worker:login, or worker:secret -- TURN_KEY_ID';

/** Major version from a `process.version` style string ('v22.1.0' → 22); NaN when unreadable. */
export function nodeMajor(version) {
  const m = /^v?(\d+)\./.exec(String(version ?? ''));
  return m ? Number(m[1]) : NaN;
}

/**
 * Work out what to run. Pure, so it is unit-tested without spawning anything.
 * @param {string[]} argv  arguments after the script name, e.g. ['secret', 'TURN_KEY_ID']
 * @param {{ nodeVersion: string, hasWorkerDir: boolean, hasModules: boolean, hasDevVars?: boolean,
 *           hasDevVarsExample?: boolean }} env
 * @returns {{ ok: true, steps: Array<{ kind: 'run', cmd: string, args: string[], cwd: string }
 *                                   | { kind: 'copy', from: string, to: string }> }
 *         | { ok: false, message: string }}
 */
export function planWorkerCommand(argv, env) {
  const [cmd, ...rest] = argv;
  if (!cmd || !(cmd in WRANGLER || cmd === 'test' || cmd === 'secret')) {
    return { ok: false, message: `Unknown worker command "${cmd ?? ''}". ${HELP}` };
  }
  const major = nodeMajor(env.nodeVersion);
  if (!(major >= MIN_NODE_MAJOR)) {
    return {
      ok: false,
      message: `The signal worker tools need Node.js ${MIN_NODE_MAJOR} or newer (you have ${env.nodeVersion}). `
        + 'Install Node 24 LTS (or run `nvm use 25.4.0` on the family PC) and try again.',
    };
  }
  if (!env.hasWorkerDir) {
    return {
      ok: false,
      message: `The signal worker is not built yet (${WORKER_DIR.replace(/\\/g, '/')} is missing). `
        + 'It arrives with the online-play code; see docs/INFRA_SETUP.md for what you can do today.',
    };
  }
  const steps = [];
  if (!env.hasModules) {
    steps.push({ kind: 'run', cmd: 'npm', args: ['ci', '--no-audit', '--no-fund'], cwd: WORKER_DIR });
  }
  if (cmd === 'test') {
    steps.push({ kind: 'run', cmd: 'npm', args: ['test'], cwd: WORKER_DIR });
    return { ok: true, steps };
  }
  let args;
  if (cmd === 'secret') {
    const name = rest[0];
    if (!SECRET_NAMES.includes(name)) {
      return {
        ok: false,
        message: `worker:secret needs the name of the secret: ${SECRET_NAMES.join(' or ')} `
          + '(for example `npm run worker:secret -- TURN_KEY_ID`). You paste the value when wrangler asks.',
      };
    }
    args = ['secret', 'put', name];
  } else {
    args = [...WRANGLER[cmd], ...rest];
  }
  if (cmd === 'dev' && !env.hasDevVars && env.hasDevVarsExample) {
    // Local dev origins (any localhost port) live in the gitignored .dev.vars; seed it from the template.
    steps.push({ kind: 'copy', from: join(WORKER_DIR, '.dev.vars.example'), to: join(WORKER_DIR, '.dev.vars') });
  }
  steps.push({ kind: 'run', cmd: 'npx', args: ['--no-install', 'wrangler', ...args], cwd: WORKER_DIR });
  return { ok: true, steps };
}

/** Run a plan's steps (stops at the first failure). Returns the exit code. */
export function runPlan(plan, { root, spawn = spawnSync, copy = copyFileSync, log = console.error } = {}) {
  if (!plan.ok) {
    log(plan.message);
    return 1;
  }
  for (const step of plan.steps) {
    if (step.kind === 'copy') {
      copy(join(root, step.from), join(root, step.to));
      continue;
    }
    const res = spawn(step.cmd, step.args, {
      cwd: join(root, step.cwd), stdio: 'inherit', shell: process.platform === 'win32',
    });
    if (res.status !== 0) return res.status ?? 1;
  }
  return 0;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = join(root, WORKER_DIR);
  const plan = planWorkerCommand(process.argv.slice(2), {
    nodeVersion: process.version,
    hasWorkerDir: existsSync(join(dir, 'package.json')),
    hasModules: existsSync(join(dir, 'node_modules', '.bin')),
    hasDevVars: existsSync(join(dir, '.dev.vars')),
    hasDevVarsExample: existsSync(join(dir, '.dev.vars.example')),
  });
  process.exitCode = runPlan(plan, { root });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
