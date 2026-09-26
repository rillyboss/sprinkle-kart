// The signal worker's configuration, tooling pins and workflows (NETWORKING.md §3, §15, docs/INFRA_SETUP.md).
// Binding names are exact: the grown-up setup guide and the game both rely on them.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const W = 'infra/signal-worker';
const toml = read(`${W}/wrangler.toml`);
const pkg = JSON.parse(read(`${W}/package.json`));
const lock = JSON.parse(read(`${W}/package-lock.json`));
const workerYml = read('.github/workflows/worker.yml');
const ciYml = read('.github/workflows/ci.yml');
const tomlLines = toml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l));
const tomlBody = tomlLines.join('\n');

describe('wrangler.toml', () => {
  it('names the worker sprinkle-kart-signal with src/index.js as main', () => {
    expect(tomlBody).toMatch(/^name = "sprinkle-kart-signal"$/m);
    expect(tomlBody).toMatch(/^main = "src\/index\.js"$/m);
    expect(tomlBody).toMatch(/^compatibility_date = "\d{4}-\d{2}-\d{2}"$/m);
  });

  it('binds the SignalRoom Durable Object and creates it with the SQLite migration v1', () => {
    expect(tomlBody).toMatch(/\[\[durable_objects\.bindings\]\]\s*\nname = "SIGNAL_ROOM"\s*\nclass_name = "SignalRoom"/);
    expect(tomlBody).toMatch(/\[\[migrations\]\]\s*\ntag = "v1"\s*\nnew_sqlite_classes = \["SignalRoom"\]/);
    expect(tomlBody).not.toMatch(/new_classes/); // KV-backed classes are not allowed on the free plan
  });

  it('never uses the [exports] config style (it cannot be mixed with migrations)', () => {
    expect(tomlBody).not.toMatch(/^\s*\[+exports/m);
  });

  it('has the exact production ALLOWED_ORIGINS and the Cloudflare TURN API base', () => {
    expect(tomlBody).toMatch(/^\[vars\]$/m);
    expect(tomlBody).toContain('ALLOWED_ORIGINS = "https://rillyboss.github.io,http://localhost:5173"');
    expect(tomlBody).toContain('TURN_API_BASE = "https://rtc.live.cloudflare.com"');
  });

  it('documents the local dev port', () => {
    expect(tomlBody).toMatch(/^\[dev\]\s*\nport = 8787$/m);
  });

  it('holds no secrets (they are set with npm run worker:secret)', () => {
    expect(tomlBody).not.toMatch(/TURN_KEY_ID\s*=/);
    expect(tomlBody).not.toMatch(/TURN_KEY_API_TOKEN\s*=/);
    expect(tomlBody).not.toMatch(/account_id/);
  });
});

describe('.dev.vars.example', () => {
  const dev = read(`${W}/.dev.vars.example`);

  it('allows any localhost / 127.0.0.1 port for local dev, and nothing else', () => {
    const lines = dev.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
    expect(lines).toEqual(['ALLOWED_ORIGINS=http://localhost:*,http://127.0.0.1:*']);
  });

  it('the real .dev.vars stays gitignored', () => {
    expect(read('.gitignore').split(/\r?\n/)).toContain('.dev.vars');
  });
});

describe('worker package and pins', () => {
  it('is its own private ESM package with a test script', () => {
    expect(pkg.name).toBe('sprinkle-kart-signal');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.engines.node).toBe('>=22');
    expect(read(`${W}/.nvmrc`).trim()).toBe('24');
  });

  it('pins wrangler 4.141.x, @cloudflare/vitest-plugin 1.2.8 and vitest 4.1.x', () => {
    const dev = pkg.devDependencies;
    expect(dev.wrangler).toMatch(/^~?4\.141\.\d+$/);
    expect(dev['@cloudflare/vitest-plugin']).toBe('1.2.8');
    expect(dev.vitest).toMatch(/^[~^]?4\.1\.\d+$/);
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]); // nothing ships but the worker source
    expect(lock.packages['node_modules/wrangler'].version).toMatch(/^4\.141\.\d+$/);
    expect(lock.packages['node_modules/@cloudflare/vitest-plugin'].version).toBe('1.2.8');
    expect(lock.packages['node_modules/vitest'].version).toMatch(/^4\.1\.\d+$/);
  });

  it('tests use the cloudflareTest plugin with the wrangler config and a local TURN mock', () => {
    const cfg = read(`${W}/vitest.config.js`);
    expect(cfg).toContain("import { cloudflareTest } from '@cloudflare/vitest-plugin'");
    expect(cfg).toMatch(/configPath: here\('\.\/wrangler\.toml'\)/);
    expect(cfg).toContain("TURN_API_BASE: inject('turnMockUrl')");
    expect(cfg).not.toContain('rtc.live.cloudflare.com'); // tests never reach the real TURN API
  });

  it('has the source files NETWORKING.md names', () => {
    for (const f of ['index.js', 'SignalRoom.js', 'room.js', 'guard.js', 'turn.js', 'origin.js']) {
      expect(existsSync(join(root, W, 'src', f)), f).toBe(true);
    }
    expect(read(`${W}/src/SignalRoom.js`)).toMatch(/export class SignalRoom extends DurableObject/);
    expect(read(`${W}/src/index.js`)).toMatch(/export \{ SignalRoom \}/);
  });

  it('room.js and guard.js stay pure (no Cloudflare runtime imports, no clocks or randomness)', () => {
    for (const f of ['room.js', 'guard.js', 'origin.js']) {
      const src = read(`${W}/src/${f}`);
      expect(src, f).not.toMatch(/cloudflare:/);
      expect(src, f).not.toMatch(/Date\.now|Math\.random|crypto\.|fetch\(/);
    }
  });

  it('uses the hibernation WebSocket API', () => {
    const src = read(`${W}/src/SignalRoom.js`);
    for (const s of ['ctx.acceptWebSocket(', 'webSocketMessage(', 'webSocketClose(', 'serializeAttachment(', "setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))"]) {
      expect(src, s).toContain(s);
    }
    expect(src).not.toMatch(/server\.accept\(\)/); // accept() would pin the object in memory
  });
});

describe('no secrets anywhere in the worker', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      if (name === 'node_modules' || name === '.dev.vars' || name === '.wrangler') continue;
      const p = `${dir}/${name}`;
      if (statSync(join(root, p)).isDirectory()) walk(p); else if (!name.endsWith('package-lock.json')) files.push(p);
    }
  };
  walk(W);

  it('finds the worker files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('contains no token-like values', () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/Bearer [A-Za-z0-9_-]{30,}/);
      expect(src, f).not.toMatch(/TURN_KEY_(ID|API_TOKEN)\s*[=:]\s*['"]?[A-Za-z0-9_-]{20,}/);
      expect(src, f).not.toMatch(/CLOUDFLARE_API_TOKEN\s*[=:]\s*['"]?[A-Za-z0-9_-]{20,}/);
    }
  });
});

describe('.github/workflows/worker.yml (optional auto-deploy)', () => {
  it('runs on worker changes on main (and by hand) with wrangler-action v4', () => {
    expect(workerYml).toMatch(/push:\s*\n\s*branches: \[main\]\s*\n\s*paths:\s*\n\s*- 'infra\/signal-worker\/\*\*'/);
    expect(workerYml).toMatch(/\n {2}workflow_dispatch:/);
    expect(workerYml).toContain('uses: cloudflare/wrangler-action@v4');
    expect(workerYml).toContain('workingDirectory: infra/signal-worker');
    expect(workerYml).toContain('command: deploy');
  });

  it('deploys only when both Cloudflare secrets exist (job-level if on an env mirror)', () => {
    expect(workerYml).toContain("HAS_CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN != '' }}");
    expect(workerYml).toContain("HAS_CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID != '' }}");
    const deploy = workerYml.slice(workerYml.indexOf('\n  deploy:'));
    expect(deploy).toMatch(/needs: check\s*\n\s*if: needs\.check\.outputs\.ready == 'true'/);
    expect(deploy).toContain('apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(deploy).toContain('accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
  });

  it('tests before deploying, on Node 24, and never touches the TURN secrets', () => {
    const deploy = workerYml.slice(workerYml.indexOf('\n  deploy:'));
    expect(deploy.indexOf('run: npm test')).toBeGreaterThan(0);
    expect(deploy.indexOf('run: npm test')).toBeLessThan(deploy.indexOf('wrangler-action'));
    expect(deploy).toMatch(/node-version: 24/);
    expect(workerYml).not.toMatch(/secrets\.TURN_/);
    expect(workerYml).toMatch(/permissions:\s*\n\s*contents: read/);
  });
});

describe('docs/INFRA_SETUP.md matches the worker', () => {
  const infra = read('docs/INFRA_SETUP.md');
  const statusRow = (label) => infra.split(/\r?\n/).find((l) => l.startsWith(`| ${label}`));

  it('marks deploy + secrets and the optional auto-deploy as ready', () => {
    expect(statusRow('5–6. Deploy + worker secrets')).toMatch(/\| ✅ \*\*Ready now\*\* \|/);
    expect(statusRow('Optional auto-deploy')).toMatch(/\| ✅ \*\*Ready\*\* \|/);
    expect(statusRow('3. Log in with wrangler')).toContain('npm run worker:login');
    expect(infra).not.toContain('npx wrangler@'); // everything goes through the pinned npm scripts now
  });

  it('keeps every binding name and documents the local port', () => {
    for (const name of ['sprinkle-kart-signal', 'SignalRoom', 'new_sqlite_classes', 'TURN_KEY_ID', 'TURN_KEY_API_TOKEN',
      'ALLOWED_ORIGINS', 'VITE_SIGNAL_URL', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', '.github/workflows/worker.yml',
      'worker:dev', 'worker:test', 'worker:deploy', 'worker:login', 'worker:secret']) {
      expect(infra, name).toContain(name);
    }
    expect(infra).toContain('http://localhost:8787');
    expect(infra).toContain('npm run worker:dev -- --port 8792');
  });

  it('states the worker limits the code enforces', () => {
    expect(infra).toMatch(/1 host \+ 7 guests per room/);
    expect(infra).toMatch(/12 guest joins\/min per room/);
    expect(infra).toMatch(/30 room joins\/min and 5 `\/ice`\/min per address/);
    expect(infra).toMatch(/500 relay passwords per day/);
  });
});

describe('ci.yml worker-test job', () => {
  const job = ciYml.slice(ciYml.indexOf('\n  worker-test:'), ciYml.indexOf('\n  smoke:'));

  it('runs the worker suite on Node 24 only when the worker changed', () => {
    expect(job).toContain('run: npm run worker:test');
    expect(job).toMatch(/node-version: 24/);
    expect(job).toContain('git diff --name-only "$BASE" HEAD -- infra/signal-worker');
    expect(job).toMatch(/if: steps\.changed\.outputs\.run == 'true'\s*\n\s*run: npm run worker:test/);
  });

  it('is not part of the required fast gate', () => {
    const gate = ciYml.slice(ciYml.indexOf('\n  test-and-build:'), ciYml.indexOf('\n  worker-test:'));
    expect(gate).not.toContain('worker:test');
    expect(job).not.toMatch(/needs:/);
  });
});
