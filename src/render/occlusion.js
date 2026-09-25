/**
 * Chase-camera occlusion: karts that would fill the screen (right next to the
 * lens, or parked between the camera and your own kart) are hidden for that
 * one viewport render, then shown again. Pure maths + a tiny helper so it can
 * be unit tested in node.
 */

export const OCCLUSION_DEFAULTS = {
  nearRadius: 5.0, // any kart this close to the lens is hidden (own kart sits ~5.9 m away)
  laneRadius: 1.4, // ...or this close to the camera → own-kart sight line
  aimHeight: 1.2, // the sight line aims at the driver, not the ground
  kartHeight: 0.8, // centre of a kart+driver above its ground position
};

/**
 * Does a kart at `kartPos` block the view from `camPos` to `ownPos`?
 * All arguments are {x,y,z}.
 */
export function blocksView(camPos, ownPos, kartPos, opts = OCCLUSION_DEFAULTS) {
  const o = opts === OCCLUSION_DEFAULTS ? opts : { ...OCCLUSION_DEFAULTS, ...opts };
  const kx = kartPos.x - camPos.x;
  const ky = kartPos.y + o.kartHeight - camPos.y;
  const kz = kartPos.z - camPos.z;
  const d2 = kx * kx + ky * ky + kz * kz;
  if (d2 < o.nearRadius * o.nearRadius) return true;
  const sx = ownPos.x - camPos.x;
  const sy = ownPos.y + o.aimHeight - camPos.y;
  const sz = ownPos.z - camPos.z;
  const len2 = sx * sx + sy * sy + sz * sz;
  if (len2 < 1e-6) return false;
  const t = (kx * sx + ky * sy + kz * sz) / len2;
  if (t <= 0 || t >= 1) return false;
  const px = kx - sx * t;
  const py = ky - sy * t;
  const pz = kz - sz * t;
  return px * px + py * py + pz * pz < o.laneRadius * o.laneRadius;
}

/**
 * Hide every kart (except `own`) that blocks `camera`'s view of `own`.
 * @returns {Array<{visible:boolean}>} the groups that were hidden (pass to restoreKarts)
 */
export function hideOccluders(karts, own, camera, opts) {
  const hidden = [];
  if (!own || !camera) return hidden;
  for (const k of karts) {
    if (k === own) continue;
    const g = k.model?.group;
    if (!g || !g.visible) continue;
    if (blocksView(camera.position, own.position, k.position, opts)) {
      g.visible = false;
      hidden.push(g);
    }
  }
  return hidden;
}

export function restoreKarts(hidden) {
  for (const g of hidden) g.visible = true;
  hidden.length = 0;
}
