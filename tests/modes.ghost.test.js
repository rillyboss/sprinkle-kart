import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createGhostRecorder, encodeGhost, decodeGhost, ghostPoseAt, ghostTimeAtDistance, ghostGap,
  quantizeSample, createGhostStore, isBetterRun, GHOST_HZ, QUANT,
} from '../src/modes/ghost.js';
import { memoryBackend } from '../src/modes/storage.js';
import { createGhostKart, ghostFade, GHOST_OPACITY } from '../src/modes/ghostKart.js';

/** A kart driving a wobbly circle at ~30 m/s. */
function drive(t) {
  const a = t * 0.12;
  return {
    position: { x: Math.cos(a) * 250, y: 3 + Math.sin(t) * 0.8, z: Math.sin(a) * 250 },
    heading: -a + Math.PI, // wraps past ±π as it goes round
    distance: -7 + t * 30,
  };
}

function record(duration, frameDt = 1 / 60) {
  const rec = createGhostRecorder();
  let t = 0;
  while (t < duration) { rec.record(t, drive(t)); t += frameDt; }
  rec.finish(duration, drive(duration));
  return rec;
}

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return Math.abs(d); };

describe('ghost recording', () => {
  it('samples on a steady 20 Hz grid', () => {
    const rec = record(10);
    expect(rec.hz).toBe(GHOST_HZ);
    expect(rec.samples.length).toBeGreaterThanOrEqual(10 * GHOST_HZ + 1);
    rec.samples.forEach((s, i) => expect(s.t).toBeCloseTo(i / GHOST_HZ, 9));
  });

  it('long frames (slow devices, ?simspeed) are filled in, so time is never squashed', () => {
    const fast = record(12, 1 / 60);
    const slow = record(12, 0.137); // ~7 fps
    expect(Math.abs(slow.samples.length - fast.samples.length)).toBeLessThanOrEqual(1);
    // the pose at 6 s matches the real drive closely in both
    for (const rec of [fast, slow]) {
      const s = rec.samples[6 * GHOST_HZ];
      expect(s.t).toBeCloseTo(6);
      expect(Math.hypot(s.x - drive(6).position.x, s.z - drive(6).position.z)).toBeLessThan(0.6);
      expect(s.distance).toBeCloseTo(drive(6).distance, 0);
    }
  });

  it('ignores junk and time going backwards', () => {
    const rec = createGhostRecorder();
    expect(rec.record(NaN, drive(0))).toBe(0);
    expect(rec.record(0, null)).toBe(0);
    expect(rec.record(-1, drive(0))).toBe(0);
    rec.record(1, drive(1));
    const n = rec.samples.length;
    expect(rec.record(0.5, drive(0.5))).toBe(0);
    expect(rec.samples.length).toBe(n);
  });

  it('caps very long runs', () => {
    const rec = createGhostRecorder({ maxSeconds: 2 });
    for (let t = 0; t < 10; t += 0.05) rec.record(t, drive(t));
    expect(rec.samples.length).toBe(2 * GHOST_HZ + 1);
  });
});

describe('ghost packing (quantize + delta + varint + base64)', () => {
  it('round-trips within the quantization steps', () => {
    const rec = record(20);
    const packed = encodeGhost(rec.samples, { trackId: 'gumdrop-meadow', laps: 3, characterId: 'luna', speedClass: 'zippy', time: 20 });
    const g = decodeGhost(JSON.parse(JSON.stringify(packed)));
    expect(g).not.toBe(null);
    expect(g.n).toBe(rec.samples.length);
    expect(g.meta).toMatchObject({ trackId: 'gumdrop-meadow', laps: 3, characterId: 'luna', speedClass: 'zippy', time: 20, v: 1 });
    expect(g.meta.data).toBeUndefined();
    const posTol = 0.5 / QUANT.pos + 1e-4;
    rec.samples.forEach((s, i) => {
      expect(Math.abs(g.x[i] - s.x)).toBeLessThanOrEqual(posTol);
      expect(Math.abs(g.y[i] - s.y)).toBeLessThanOrEqual(posTol);
      expect(Math.abs(g.z[i] - s.z)).toBeLessThanOrEqual(posTol);
      expect(angDiff(g.heading[i], s.heading)).toBeLessThanOrEqual(0.5 / QUANT.heading + 1e-4);
      expect(Math.abs(g.distance[i] - s.distance)).toBeLessThanOrEqual(0.5 / QUANT.dist + 1e-3);
    });
  });

  it('is compact: well under 8 bytes per sample', () => {
    const rec = record(90);
    const packed = encodeGhost(rec.samples, { trackId: 't', laps: 3, time: 90 });
    const bytesPerSample = JSON.stringify(packed).length / rec.samples.length;
    expect(bytesPerSample).toBeLessThan(8);
    // a 90 s run fits easily in localStorage many times over
    expect(JSON.stringify(packed).length).toBeLessThan(15000);
  });

  it('quantizes headings into one turn', () => {
    expect(quantizeSample({ x: 0, y: 0, z: 0, heading: TAU, distance: 0 })[3]).toBe(0);
    expect(quantizeSample({ x: 0, y: 0, z: 0, heading: -Math.PI / 2, distance: 0 })[3]).toBe(3072);
    expect(quantizeSample({ x: 1.26, y: -0.5, z: 0, heading: 0, distance: 12.34 })).toEqual([25, -10, 0, 0, 123]);
  });

  it('rejects malformed ghosts', () => {
    const ok = encodeGhost(record(2).samples, { trackId: 't', laps: 1, time: 2 });
    expect(decodeGhost(null)).toBe(null);
    expect(decodeGhost({ ...ok, v: 99 })).toBe(null);
    expect(decodeGhost({ ...ok, n: 0 })).toBe(null);
    expect(decodeGhost({ ...ok, n: ok.n + 50 })).toBe(null); // data too short
    expect(decodeGhost({ ...ok, data: 42 })).toBe(null);
    expect(decodeGhost({ ...ok, n: 1e9 })).toBe(null);
  });
});

describe('ghost replay', () => {
  const g = decodeGhost(encodeGhost(record(30).samples, { trackId: 't', laps: 3, time: 30 }));

  it('interpolates smoothly between samples and follows the real drive', () => {
    for (const t of [0.013, 1.5, 7.77, 15.02, 29.4]) {
      const p = ghostPoseAt(g, t);
      const d = drive(t);
      expect(Math.hypot(p.x - d.position.x, p.z - d.position.z)).toBeLessThan(0.3);
      expect(angDiff(p.heading, d.heading)).toBeLessThan(0.02);
      expect(p.done).toBe(false);
      expect(p.speed).toBeGreaterThan(20);
    }
  });

  it('takes the short way round when the heading wraps', () => {
    const two = decodeGhost(encodeGhost([
      { x: 0, y: 0, z: 0, heading: Math.PI - 0.05, distance: 0 },
      { x: 1, y: 0, z: 0, heading: -Math.PI + 0.05, distance: 1 },
    ], { time: 0.05 }));
    const mid = ghostPoseAt(two, 0.025);
    expect(angDiff(mid.heading, Math.PI)).toBeLessThan(0.01);
  });

  it('clamps before the start and after the end', () => {
    const a = ghostPoseAt(g, -5);
    expect(a.x).toBeCloseTo(g.x[0]);
    const z = ghostPoseAt(g, 999);
    expect(z.done).toBe(true);
    expect(z.x).toBeCloseTo(g.x[g.n - 1]);
    expect(z.speed).toBe(0);
  });

  it('knows when the ghost reached a distance, and the gap to you', () => {
    expect(ghostTimeAtDistance(g, drive(10).distance)).toBeCloseTo(10, 1);
    expect(ghostTimeAtDistance(g, -100)).toBe(0);
    expect(ghostTimeAtDistance(g, 1e6)).toBe(null);
    // you are where the ghost was 1 s ago -> 1 s behind
    expect(ghostGap(g, 11, drive(10).distance)).toBeCloseTo(1, 1);
    // you are where the ghost will be in 2 s -> 2 s ahead
    expect(ghostGap(g, 8, drive(10).distance)).toBeCloseTo(-2, 1);
    expect(ghostGap(g, 0.2, 0)).toBe(null); // too early to say
    expect(ghostGap(null, 5, 5)).toBe(null);
    // past the ghost's finish while it has stopped: behind by the time since it finished
    expect(ghostGap(g, 35, 1e6)).toBeCloseTo(35 - g.duration, 5);
  });
});

describe('ghost store (best run per track + laps)', () => {
  const ghostOf = (time, laps = 3, trackId = 'gumdrop-meadow') => encodeGhost(record(1).samples, { trackId, laps, time, characterId: 'rocco' });

  it('keeps only faster runs', () => {
    const store = createGhostStore(memoryBackend());
    expect(store.load('gumdrop-meadow', 3)).toBe(null);
    expect(store.offer(ghostOf(60))).toBe(true);
    expect(store.offer(ghostOf(61))).toBe(false);
    expect(store.load('gumdrop-meadow', 3).time).toBe(60);
    expect(store.offer(ghostOf(59.5))).toBe(true);
    expect(store.load('gumdrop-meadow', 3).time).toBe(59.5);
  });

  it('keeps separate ghosts per lap count and track', () => {
    const store = createGhostStore(memoryBackend());
    store.offer(ghostOf(60, 3));
    store.offer(ghostOf(20, 1));
    store.offer(ghostOf(70, 3, 'sundae-slopes'));
    expect(store.load('gumdrop-meadow', 3).time).toBe(60);
    expect(store.load('gumdrop-meadow', 1).time).toBe(20);
    expect(store.load('sundae-slopes', 3).time).toBe(70);
    expect(store.load('sundae-slopes', 1)).toBe(null);
  });

  it('ignores bad offers and corrupt storage', () => {
    const be = memoryBackend();
    const store = createGhostStore(be);
    expect(store.offer(null)).toBe(false);
    expect(store.offer({ ...ghostOf(60), trackId: null })).toBe(false);
    expect(store.offer({ ...ghostOf(60), laps: 'three' })).toBe(false);
    expect(store.offer(ghostOf(NaN))).toBe(false);
    be.setItem('sprinkle-kart-ghosts-v1', '[1,2');
    expect(store.load('gumdrop-meadow', 3)).toBe(null);
    expect(store.offer(ghostOf(50))).toBe(true);
  });

  it('isBetterRun', () => {
    expect(isBetterRun(10, null)).toBe(true);
    expect(isBetterRun(10, { time: 11 })).toBe(true);
    expect(isBetterRun(10, { time: 10 })).toBe(false);
    expect(isBetterRun(0, null)).toBe(false);
    expect(isBetterRun(10, { time: null })).toBe(true);
  });
});

describe('ghost kart (3D)', () => {
  const stubModel = () => {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    const m = { group, updates: 0, disposed: false, update() { m.updates++; }, dispose() { m.disposed = true; } };
    m.sharedMat = mat;
    return m;
  };

  it('is a translucent copy that never changes the shared materials, replays and cleans up', () => {
    const scene = new THREE.Scene();
    let built = null;
    const g = decodeGhost(encodeGhost(record(5).samples, { time: 5 }));
    const ghost = createGhostKart({ scene, decoded: g, charDef: { id: 'rocco' }, buildKartModel: () => (built = stubModel()) });
    expect(scene.children.length).toBeGreaterThan(1); // kart + sparkles
    expect(built.sharedMat.transparent).toBe(false); // cloned, not mutated
    const mesh = ghost.group.children[0];
    expect(mesh.material).not.toBe(built.sharedMat);
    expect(mesh.material.transparent).toBe(true);
    ghost.update(0.1, 1 / 60, null, 0);
    expect(ghost.group.visible).toBe(false); // appears just after GO
    for (let i = 0; i < 60; i++) ghost.update(1 + i / 60, 1 / 60, { x: 1e4, y: 0, z: 1e4 }, i / 60);
    expect(ghost.group.visible).toBe(true);
    expect(mesh.material.opacity).toBeGreaterThan(0.3);
    expect(mesh.material.opacity).toBeLessThanOrEqual(GHOST_OPACITY + 1e-6);
    expect(ghost.group.position.x).toBeCloseTo(ghost.pose.x);
    expect(built.updates).toBeGreaterThan(0);
    ghost.dispose();
    expect(scene.children.length).toBe(0);
    expect(built.disposed).toBe(true);
  });

  it('fades right next to the player', () => {
    expect(ghostFade(0)).toBeLessThan(ghostFade(10));
    expect(ghostFade(10)).toBeCloseTo(GHOST_OPACITY);
    expect(ghostFade(NaN)).toBe(GHOST_OPACITY);
    expect(ghostFade(0)).toBeGreaterThan(0);
  });
});
