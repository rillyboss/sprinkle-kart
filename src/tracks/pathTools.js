import * as THREE from 'three';
import { APRON_Y } from './constants.js';

/**
 * Pure path / terrain helpers shared by the track core and scenery modules:
 * seeded RNG, the road spatial index, terrain height models, item-box slots
 * and boost pads. No rendering, safe in node tests.
 */

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Uniform-grid spatial index over the path samples, for fast
 * "how far is this point from the road?" queries.
 */
export function createPathIndex(path, cell = 12) {
  const grid = new Map();
  const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
  for (let i = 0; i < path.count; i++) {
    const k = key(Math.floor(path.px[i] / cell), Math.floor(path.pz[i] / cell));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  return {
    /** @returns {{dist:number, i:number, s:number, y:number}} dist = Infinity if nothing within maxR */
    nearest(x, z, maxR = 60) {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      const rings = Math.ceil(maxR / cell) + 1;
      let best = -1;
      let bestD2 = Infinity;
      for (let r = 0; r <= rings; r++) {
        for (let ix = cx - r; ix <= cx + r; ix++) {
          for (let iz = cz - r; iz <= cz + r; iz++) {
            if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
            const arr = grid.get(key(ix, iz));
            if (!arr) continue;
            for (const i of arr) {
              const dx = x - path.px[i];
              const dz = z - path.pz[i];
              const d2 = dx * dx + dz * dz;
              if (d2 < bestD2) { bestD2 = d2; best = i; }
            }
          }
        }
        if (best >= 0 && Math.sqrt(bestD2) <= r * cell) break;
      }
      const dist = Math.sqrt(bestD2);
      if (best < 0 || dist > maxR) return { dist: Infinity, i: -1, s: 0, y: 0 };
      return { dist, i: best, s: best * path.step, y: path.py[best] };
    },
  };
}

/** Per-sample weight: 0 on bridges, easing to 1 away from them. */
export function bridgeWeights(def, path) {
  const w = new Float32Array(path.count).fill(1);
  const ranges = def.scenery?.bridges || [];
  const L = path.length;
  for (let i = 0; i < path.count; i++) {
    const s = i * path.step;
    for (const [a, b] of ranges) {
      const sa = a * L, sb = b * L;
      let d = 0;
      if (s < sa) d = Math.min(sa - s, s + L - sb);
      else if (s > sb) d = Math.min(s - sb, sa + L - s);
      w[i] = Math.min(w[i], smoothstep(2, 14, d));
    }
  }
  return w;
}

/**
 * Terrain height model for a track. `height(x,z)` returns null over the void.
 * - flat: y = 0 (castle: the moat is a basin)
 * - hills: rolling noise that blends into the road so it never floats
 * - void: nothing (space)
 */
export function createTerrain(def, path, index) {
  const kind = def.scenery?.terrain || 'flat';
  const hw = path.halfWidth;
  if (kind === 'void') return { kind, height: () => null, base: () => null };
  if (kind === 'flat') {
    // optional ring-shaped basin (a moat / lagoon): scenery.basin, or the castle's moat
    const c = def.scenery?.basin ?? def.scenery?.castle;
    return {
      kind,
      height(x, z) {
        if (c) {
          const r = Math.hypot(x - c.center[0], z - c.center[1]);
          if (r > c.moatInner && r < c.moatOuter) return c.depth ?? -1.6;
        }
        return 0;
      },
      base: () => 0,
    };
  }
  const amp = def.scenery?.hills?.amp ?? 6;
  const sc = def.scenery?.hills?.scale ?? 0.012;
  const rng = makeRng(seedFromString(def.id + ':hills'));
  const ph = Array.from({ length: 6 }, () => rng() * Math.PI * 2);
  const b = path.getBounds();
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const reach = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 150;
  const bw = bridgeWeights(def, path);
  const river = def.scenery?.riverLine; // optional channel polyline [[x,z],...] (see a module `prepare` hook)
  const base = (x, z) => {
    let n = 0.5 + 0.28 * Math.sin(x * sc + ph[0]) * Math.cos(z * sc * 1.3 + ph[1])
      + 0.18 * Math.sin((x + z) * sc * 2.1 + ph[2])
      + 0.1 * Math.cos((x - z) * sc * 3.7 + ph[3]);
    // fade to flat at the far edge so the terrain meets the outer plane
    const edge = 1 - smoothstep(reach - 120, reach, Math.hypot(x - cx, z - cz));
    let h = amp * n * edge + APRON_Y * (1 - edge);
    if (river && river.length) {
      const d = distToPolyline(x, z, river);
      h = THREE.MathUtils.lerp(-2.4, h, smoothstep(8, 22, d));
    }
    return h;
  };
  return {
    kind,
    base,
    height(x, z) {
      const bh = base(x, z);
      const n = index.nearest(x, z, hw + 46);
      if (n.i < 0) return bh;
      const conform = (1 - smoothstep(hw + 6, hw + 40, n.dist)) * bw[n.i];
      let h = THREE.MathUtils.lerp(bh, n.y - 0.3, conform);
      // under / beside bridges keep the ground well below the deck
      if (bw[n.i] < 1) {
        const k = (1 - bw[n.i]) * (1 - smoothstep(hw + 6, hw + 30, n.dist));
        h = THREE.MathUtils.lerp(h, Math.min(h, n.y - 3.2), k);
      }
      return h;
    },
  };
}

export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Item box slots from `itemBoxRows`: a row of boxes across the road.
 * position = road surface point (the race lifts boxes above it).
 */
export function computeItemBoxSlots(def, path) {
  const count = path.width >= 18 ? 5 : 4;
  const span = path.halfWidth * 0.72;
  const slots = [];
  for (const f of def.itemBoxRows || []) {
    const s = path.wrap(f * path.length);
    for (let k = 0; k < count; k++) {
      const lateral = -span + (2 * span * k) / (count - 1);
      slots.push({ s, lateral, position: path.positionAt(s, lateral) });
    }
  }
  return slots;
}

/** Boost pads from `boostPads` defs (length 6, halfWidth 2.5), clamped inside the road. */
export function computeBoostPads(def, path) {
  return (def.boostPads || []).map((b) => {
    const s = path.wrap(b.at * path.length);
    const max = path.halfWidth - 2.5 - 0.3;
    const lateral = Math.max(-max, Math.min(max, b.lateral ?? 0));
    return { s, lateral, length: 6, halfWidth: 2.5, position: path.positionAt(s, lateral) };
  });
}
