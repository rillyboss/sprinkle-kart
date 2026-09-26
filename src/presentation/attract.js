/**
 * Title-screen "attract mode": a real CPU race runs behind the logo and a
 * little TV director cuts between camera shots. Pure logic (shot list,
 * timing, camera poses, track choice) — src/systems/titleAttract.js owns the
 * scene. OWNER: showcase presentation.
 *
 *   const d = createDirector({ seed: 3 });
 *   const shot = d.update(dt);                 // { kind, t, index, cut, starIndex }
 *   const pose = shotPose(shot, targets);      // { pos, look, fov } plain objects
 */

/** Camera shots, in the order the director plays them (then loops). */
export const SHOTS = Object.freeze([
  { kind: 'front-pack', length: 5.5 }, // in front of the leader, the pack racing at you
  { kind: 'star-orbit', length: 6.5 }, // circle one racer ("Starring ...")
  { kind: 'trackside', length: 5 }, // a camera by the fence as the karts zoom past
  { kind: 'heli', length: 6 }, // high and wide over the track
  { kind: 'chase-low', length: 5 }, // low behind the leader
  { kind: 'star-orbit', length: 6.5 },
]);

/** Small deterministic RNG. */
export function rng32(seed = 1) {
  let a = (Math.floor(Math.abs(seed)) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The shot director.
 * @param {{ seed?: number, shots?: typeof SHOTS, racers?: number }} [opts]
 */
export function createDirector({ seed = 1, shots = SHOTS, racers = 8 } = {}) {
  const rand = rng32(seed);
  let index = 0;
  let t = 0;
  let starIndex = Math.floor(rand() * Math.max(1, racers));
  const shot = { kind: shots[0].kind, t: 0, index: 0, cut: true, starIndex, length: shots[0].length };
  return {
    get shot() { return shot; },
    /** Advance time; `cut` is true on the frame a new shot starts. */
    update(dt) {
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      t += dt;
      shot.cut = false;
      if (t >= shots[index].length) {
        t -= shots[index].length;
        index = (index + 1) % shots.length;
        shot.cut = true;
        if (shots[index].kind === 'star-orbit') {
          // a different star each time
          const n = Math.max(1, racers);
          starIndex = (starIndex + 1 + Math.floor(rand() * Math.max(1, n - 1))) % n;
        }
      }
      shot.kind = shots[index].kind;
      shot.t = t;
      shot.index = index;
      shot.starIndex = starIndex;
      shot.length = shots[index].length;
      return shot;
    },
    /** Jump straight to a shot (tests / debugging). */
    jump(i) {
      index = ((i % shots.length) + shots.length) % shots.length;
      t = 0;
      shot.cut = true;
      shot.kind = shots[index].kind;
      shot.index = index;
      shot.t = 0;
      shot.length = shots[index].length;
      return shot;
    },
  };
}

const fwd = (h) => ({ x: Math.sin(h), z: Math.cos(h) });
const right = (h) => ({ x: -Math.cos(h), z: Math.sin(h) });

/**
 * Camera pose for a shot.
 * @param {{ kind: string, t: number, length?: number }} shot
 * @param {{
 *   leader: { position: {x,y,z}, heading: number },
 *   star?: { position: {x,y,z}, heading: number },
 *   center?: {x,y,z}, extent?: number,
 *   trackside?: { pos: {x,y,z} }    // fixed trackside camera spot for this shot
 * }} tg
 * @returns {{ pos: {x,y,z}, look: {x,y,z}, fov: number }}
 */
export function shotPose(shot, tg) {
  const t = Number.isFinite(shot?.t) ? shot.t : 0;
  const L = tg?.leader;
  if (!L?.position) {
    const c = tg?.center ?? { x: 0, y: 0, z: 0 };
    const r = (tg?.extent ?? 100) * 0.7;
    return { pos: { x: c.x + Math.sin(t * 0.1) * r, y: c.y + r * 0.5, z: c.z + Math.cos(t * 0.1) * r }, look: { ...c }, fov: 50 };
  }
  const p = L.position;
  const f = fwd(L.heading);
  const rt = right(L.heading);
  switch (shot?.kind) {
    case 'front-pack': {
      // ahead of the leader, low, drifting slowly sideways; looks back at the pack
      const d = 8.5 - Math.min(2, t * 0.2);
      const side = Math.sin(t * 0.35) * 2.2;
      return {
        pos: { x: p.x + f.x * d + rt.x * side, y: p.y + 1.6, z: p.z + f.z * d + rt.z * side },
        look: { x: p.x - f.x * 6, y: p.y + 1.0, z: p.z - f.z * 6 },
        fov: 52,
      };
    }
    case 'star-orbit': {
      const S = tg.star?.position ? tg.star : L;
      const sp = S.position;
      const a = S.heading + Math.PI * 0.12 + t * 0.1; // front three-quarter (faces the camera), slowly circling
      const r = 7;
      return {
        pos: { x: sp.x + Math.sin(a) * r, y: sp.y + 1.9, z: sp.z + Math.cos(a) * r },
        look: { x: sp.x, y: sp.y + 1.0, z: sp.z },
        fov: 45,
      };
    }
    case 'trackside': {
      const spot = tg.trackside?.pos ?? { x: p.x + f.x * 30 + rt.x * 12, y: p.y + 2.5, z: p.z + f.z * 30 + rt.z * 12 };
      return { pos: { ...spot }, look: { x: p.x, y: p.y + 0.9, z: p.z }, fov: 40 };
    }
    case 'heli': {
      const a = L.heading + Math.PI + 0.5 + t * 0.06;
      return {
        pos: { x: p.x + Math.sin(a) * 30, y: p.y + 22 + t * 0.4, z: p.z + Math.cos(a) * 30 },
        look: { x: p.x + f.x * 6, y: p.y, z: p.z + f.z * 6 },
        fov: 48,
      };
    }
    case 'chase-low':
    default: {
      const d = 4.6;
      const side = 1.2;
      return {
        pos: { x: p.x - f.x * d + rt.x * side, y: p.y + 1.15, z: p.z - f.z * d + rt.z * side },
        look: { x: p.x + f.x * 10, y: p.y + 1.1, z: p.z + f.z * 10 },
        fov: 58,
      };
    }
  }
}

/**
 * Where the shot's subject sits on screen (fractions of the view, 0,0 = top
 * left), so the karts play beside and below the logo instead of behind it.
 */
export const SHOT_FRAMING = Object.freeze({
  'front-pack': { u: 0.5, v: 0.74 },
  'star-orbit': { u: 0.77, v: 0.6 },
  trackside: { u: 0.24, v: 0.64 },
  heli: { u: 0.5, v: 0.66 },
  'chase-low': { u: 0.5, v: 0.72 },
});

/**
 * THREE.PerspectiveCamera.setViewOffset arguments that put the look target at
 * (u, v) of a W x H view, plus the vertical FOV that keeps the subject the same
 * size as an un-offset camera with `fov`.
 * @returns {{ fullWidth:number, fullHeight:number, x:number, y:number, width:number, height:number, fov:number }}
 */
export function framingOffset(W, H, { u = 0.5, v = 0.5 } = {}, fov = 50) {
  W = Math.max(1, W);
  H = Math.max(1, H);
  u = Math.min(0.95, Math.max(0.05, u));
  v = Math.min(0.95, Math.max(0.05, v));
  const fullWidth = W * 2 * Math.max(u, 1 - u);
  const fullHeight = H * 2 * Math.max(v, 1 - v);
  const x = fullWidth / 2 - u * W;
  const y = fullHeight / 2 - v * H;
  const k = fullHeight / H;
  const full = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * k) * 180) / Math.PI;
  return { fullWidth, fullHeight, x, y, width: W, height: H, fov: full };
}

/**
 * Which track the title show uses on its `visit`-th appearance: walks the
 * available tracks, starting from `start`.
 * @param {Array<{id:string}>} tracks available tracks
 */
export function pickAttractTrack(tracks, visit = 0, start = 0) {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  const n = tracks.length;
  return tracks[(((Math.floor(start) + Math.floor(visit)) % n) + n) % n];
}

/** Friendly caption for a starring racer. */
export function starCaption(def) {
  if (!def) return null;
  return { title: `⭐ Starring ${def.name}`, sub: def.tagline || def.personality || '' };
}
