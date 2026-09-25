/**
 * Visual regression guard for the ORIGINAL content (Sprinkle Cup tracks and
 * the original 9 racers): the built scene graphs must match the recorded
 * fingerprints in tests/golden/visual.json exactly.
 *
 * If you changed shared building code ON PURPOSE (e.g. prettier trees in the
 * scenery kit), look at the game, then refresh the goldens:
 *
 *   UPDATE_GOLDEN=1 npx vitest run tests/visual.golden.test.js     (bash)
 *   $env:UPDATE_GOLDEN=1; npx vitest run tests/visual.golden.test.js (PowerShell)
 *
 * and commit the updated JSON together with the change that caused it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fingerprint, digest } from './helpers/fingerprint.js';
import { TRACKS } from '../src/data/tracks.js';
import { CHARACTERS } from '../src/data/characters.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack } from '../src/render/trackBuilder.js';
import { buildKartModel } from '../src/render/characterModels.js';

const ORIGINAL_TRACKS = ['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes'];
const ORIGINAL_CHARACTERS = ['rocco', 'lenny', 'stella', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy', 'cotton-candy-girl'];

const GOLDEN = path.resolve(__dirname, 'golden', 'visual.json');
const UPDATE = !!process.env.UPDATE_GOLDEN;
const DUMP = process.env.GOLDEN_DUMP; // optional dir: write full fingerprints for diffing

function current() {
  const out = { tracks: {}, characters: {} };
  const lines = { tracks: {}, characters: {} };
  for (const id of ORIGINAL_TRACKS) {
    const def = TRACKS.find((t) => t.id === id);
    const built = buildTrack(def, new TrackPath(def.controlPoints, def.width));
    built.update(0.5, 3.25); // run the animators once too (deterministic)
    const fp = fingerprint(built.group);
    out.tracks[id] = digest(fp);
    lines.tracks[id] = fp;
    built.dispose();
  }
  for (const id of ORIGINAL_CHARACTERS) {
    const def = CHARACTERS.find((c) => c.id === id);
    const m = buildKartModel(def);
    const fp = fingerprint(m.group, { animated: true });
    out.characters[id] = digest(fp);
    lines.characters[id] = fp;
    m.dispose();
  }
  return { out, lines };
}

describe('visual golden fingerprints (original content)', () => {
  const { out, lines } = current();
  if (DUMP) {
    mkdirSync(DUMP, { recursive: true });
    for (const kind of ['tracks', 'characters']) {
      for (const [id, fp] of Object.entries(lines[kind])) writeFileSync(path.join(DUMP, `${kind}-${id}.txt`), fp.join('\n'));
    }
  }
  if (UPDATE || !existsSync(GOLDEN)) {
    mkdirSync(path.dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, `${JSON.stringify(out, null, 2)}\n`);
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

  for (const id of ORIGINAL_TRACKS) {
    it(`track ${id} builds exactly the recorded scene`, () => {
      expect(out.tracks[id]).toBe(golden.tracks[id]);
    });
  }
  for (const id of ORIGINAL_CHARACTERS) {
    it(`character ${id} builds exactly the recorded model`, () => {
      expect(out.characters[id]).toBe(golden.characters[id]);
    });
  }
});
