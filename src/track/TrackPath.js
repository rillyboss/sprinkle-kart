import * as THREE from 'three';

/**
 * TrackPath — the single source of truth for "where is the road".
 *
 * Built from a closed loop of control points (Catmull-Rom). Everything is
 * measured in arc length `s` (world units along the centre line), 0..length,
 * wrapping. s = 0 is the start/finish line; karts race toward increasing s.
 *
 * Conventions (shared by every module):
 *   - World up is +Y. The road surface height at a point is the centre-line y.
 *   - tangent = unit direction of travel (XZ-flattened, y = 0).
 *   - right   = unit vector to the driver's right: (tangent × up) → (-tz, 0, tx).
 *   - lateral = signed distance from centre line along `right` (+ = right side).
 *   - heading (yaw) for a kart facing `tangent` = Math.atan2(tangent.x, tangent.z),
 *     i.e. forward = (sin h, 0, cos h) and model.rotation.y = h.
 */
export class TrackPath {
  /**
   * @param {Array<[number,number,number]>} controlPoints closed loop, in race order
   * @param {number} width road width in world units
   * @param {number} [samples=1200]
   */
  constructor(controlPoints, width, samples = 1200) {
    this.width = width;
    this.halfWidth = width / 2;
    const pts = controlPoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    this.count = samples;
    this.step = this.length / samples;

    // Evenly spaced (by arc length) samples.
    const spaced = this.curve.getSpacedPoints(samples); // samples+1 points, last == first
    this.px = new Float32Array(samples);
    this.py = new Float32Array(samples);
    this.pz = new Float32Array(samples);
    this.tx = new Float32Array(samples);
    this.tz = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      this.px[i] = spaced[i].x;
      this.py[i] = spaced[i].y;
      this.pz[i] = spaced[i].z;
    }
    for (let i = 0; i < samples; i++) {
      const a = (i - 1 + samples) % samples;
      const b = (i + 1) % samples;
      let dx = this.px[b] - this.px[a];
      let dz = this.pz[b] - this.pz[a];
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
    }
  }

  /** Wrap any s into [0, length). */
  wrap(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Signed shortest distance from s1 to s2 along the loop (-L/2..L/2). */
  delta(s1, s2) {
    let d = this.wrap(s2) - this.wrap(s1);
    const L = this.length;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  _idx(s) {
    const f = this.wrap(s) / this.step;
    const i0 = Math.floor(f) % this.count;
    return { i0, i1: (i0 + 1) % this.count, t: f - Math.floor(f) };
  }

  /** Centre-line point at arc length s. */
  pointAt(s, out = new THREE.Vector3()) {
    const { i0, i1, t } = this._idx(s);
    return out.set(
      this.px[i0] + (this.px[i1] - this.px[i0]) * t,
      this.py[i0] + (this.py[i1] - this.py[i0]) * t,
      this.pz[i0] + (this.pz[i1] - this.pz[i0]) * t,
    );
  }

  /** Unit XZ tangent (direction of travel) at s. */
  tangentAt(s, out = new THREE.Vector3()) {
    const { i0, i1, t } = this._idx(s);
    const x = this.tx[i0] + (this.tx[i1] - this.tx[i0]) * t;
    const z = this.tz[i0] + (this.tz[i1] - this.tz[i0]) * t;
    const len = Math.hypot(x, z) || 1;
    return out.set(x / len, 0, z / len);
  }

  /** Unit XZ vector to the driver's right at s. */
  rightAt(s, out = new THREE.Vector3()) {
    this.tangentAt(s, out);
    return out.set(-out.z, 0, out.x);
  }

  /** Heading (yaw) that faces along the track at s. */
  headingAt(s) {
    const t = this.tangentAt(s, _tmp);
    return Math.atan2(t.x, t.z);
  }

  /** World position at (s, lateral), on the road surface. */
  positionAt(s, lateral = 0, out = new THREE.Vector3()) {
    this.pointAt(s, out);
    const r = this.rightAt(s, _tmp);
    out.x += r.x * lateral;
    out.z += r.z * lateral;
    return out;
  }

  /**
   * Find the nearest centre-line location to a world position.
   * @param {{x:number,z:number}} pos
   * @param {number} [hintS] previous s — searches locally (fast, and avoids
   *   snapping to a different part of the track where the loop passes close by).
   * @returns {{s:number, lateral:number, height:number, offRoad:boolean}}
   */
  project(pos, hintS) {
    const n = this.count;
    let best = -1;
    let bestD = Infinity;
    if (hintS === undefined || hintS === null || Number.isNaN(hintS)) {
      for (let i = 0; i < n; i++) {
        const dx = pos.x - this.px[i];
        const dz = pos.z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    } else {
      const c = Math.round(this.wrap(hintS) / this.step);
      const win = Math.ceil(40 / this.step) + 4; // search ±40 world units
      for (let k = -win; k <= win; k++) {
        const i = (((c + k) % n) + n) % n;
        const dx = pos.x - this.px[i];
        const dz = pos.z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    // Refine between neighbouring samples by projecting onto the segments.
    let bestS = best * this.step;
    let bestLat = 0;
    let bestDist = Infinity;
    for (const j of [(best - 1 + n) % n, best]) {
      const j1 = (j + 1) % n;
      const ax = this.px[j], az = this.pz[j];
      const bx = this.px[j1], bz = this.pz[j1];
      const vx = bx - ax, vz = bz - az;
      const vv = vx * vx + vz * vz || 1;
      let t = ((pos.x - ax) * vx + (pos.z - az) * vz) / vv;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + vx * t, cz = az + vz * t;
      const d = Math.hypot(pos.x - cx, pos.z - cz);
      if (d < bestDist) {
        bestDist = d;
        bestS = (j + t) * this.step;
      }
    }
    bestS = this.wrap(bestS);
    const c = this.pointAt(bestS, _tmp2);
    const r = this.rightAt(bestS, _tmp);
    bestLat = (pos.x - c.x) * r.x + (pos.z - c.z) * r.z;
    return {
      s: bestS,
      lateral: bestLat,
      height: c.y,
      offRoad: Math.abs(bestLat) > this.halfWidth,
    };
  }

  /** Array of [x, z] points (every `every`-th sample) for drawing a minimap. */
  getMinimapPoints(every = 8) {
    const out = [];
    for (let i = 0; i < this.count; i += every) out.push([this.px[i], this.pz[i]]);
    return out;
  }

  /** Axis-aligned XZ bounds of the centre line. */
  getBounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.count; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    return { minX, maxX, minZ, maxZ };
  }
}

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
