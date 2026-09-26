/**
 * Acceptance 7 (NETWORKING.md §3 + kid-safety rule 1): the Trystero packages load only in lazy
 * chunks. Builds (in memory) (a) the online entry point src/net/signaling/index.js and (b) the
 * real game, and checks that no entry chunk contains Trystero code.
 */
import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Minified output has no comments, so these strings can only come from Trystero's own code.
const TRYSTERO_MARKERS = [/Trystero/, /torrent tracker/];
const hasTrystero = (code) => TRYSTERO_MARKERS.some((re) => re.test(code));

async function bundle(input, preserve) {
  const res = await build({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    base: './',
    build: {
      write: false,
      minify: true,
      emptyOutDir: false,
      rollupOptions: input ? { input, preserveEntrySignatures: preserve ? 'strict' : false } : undefined,
    },
  });
  const outputs = (Array.isArray(res) ? res : [res]).flatMap((r) => r.output);
  return outputs.filter((o) => o.type === 'chunk');
}

describe('Trystero is lazy (separate chunks only)', () => {
  it('the online entry keeps torrent and nostr in their own dynamic chunks', async () => {
    const chunks = await bundle(join(ROOT, 'src/net/signaling/index.js'), true);
    const byName = new Map(chunks.map((c) => [c.fileName, c]));
    const entry = chunks.filter((c) => c.isEntry);
    expect(entry).toHaveLength(1);
    expect(hasTrystero(entry[0].code)).toBe(false);
    // public.js itself is lazy too (index.js imports it with import()).
    const pub = chunks.find((c) => c.code.includes('sk-role'));
    expect(pub).toBeTruthy();
    expect(pub.isEntry).toBe(false);
    expect(pub.isDynamicEntry).toBe(true);
    expect(entry[0].imports).not.toContain(pub.fileName);
    // public.js dynamically imports exactly the two strategies, each its own chunk.
    const strategies = pub.dynamicImports.map((f) => byName.get(f));
    expect(strategies).toHaveLength(2);
    for (const st of strategies) {
      expect(st.isDynamicEntry).toBe(true);
      expect(st.isEntry).toBe(false);
    }
    expect(strategies.some((st) => /torrent tracker/.test(st.code))).toBe(true);
    // Trystero code (the shared core included) lives only outside the entry's static graph.
    const staticGraph = new Set([entry[0].fileName, ...entry[0].imports]);
    for (const f of staticGraph) expect(hasTrystero(byName.get(f).code)).toBe(false);
    expect(chunks.some((c) => !staticGraph.has(c.fileName) && hasTrystero(c.code))).toBe(true);
  }, 60000);

  it('the game build (index.html) has no Trystero in its entry chunk', async () => {
    const chunks = await bundle(null);
    const entry = chunks.filter((c) => c.isEntry);
    expect(entry.length).toBeGreaterThanOrEqual(1);
    for (const c of entry) expect(hasTrystero(c.code)).toBe(false);
  }, 60000);
});
