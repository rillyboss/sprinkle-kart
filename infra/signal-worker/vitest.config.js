// Worker tests run inside the real Workers runtime (workerd via Miniflare) with @cloudflare/vitest-plugin.
// Needs Node 22+ (`npm run worker:test` from the repo root checks that). No Cloudflare account is used:
// TURN_API_BASE points at a local mock (test/turnMock.global.js) and the TURN "secrets" are fake test values.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const wranglerToml = readFileSync(here('./wrangler.toml'), 'utf8');
const devVarsExample = readFileSync(here('./.dev.vars.example'), 'utf8');

/** The production ALLOWED_ORIGINS, exactly as wrangler.toml has it. */
export const prodAllowedOrigins = /^ALLOWED_ORIGINS\s*=\s*"([^"]*)"/m.exec(wranglerToml)?.[1] ?? '';
/** The local-dev value from .dev.vars.example. */
export const devAllowedOrigins = /^ALLOWED_ORIGINS=(.*)$/m.exec(devVarsExample)?.[1]?.trim() ?? '';

export default defineConfig({
  plugins: [
    cloudflareTest(({ inject }) => ({
      wrangler: { configPath: here('./wrangler.toml') },
      miniflare: {
        bindings: {
          // Pin the production value even if a developer has a local .dev.vars with the dev wildcard.
          ALLOWED_ORIGINS: prodAllowedOrigins,
          TURN_API_BASE: inject('turnMockUrl'),
          TURN_KEY_ID: 'test-turn-key-id',
          TURN_KEY_API_TOKEN: 'test-turn-api-token',
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.js'],
    globalSetup: ['./test/turnMock.global.js'],
    provide: { prodAllowedOrigins, devAllowedOrigins },
    testTimeout: 30000,
  },
});
