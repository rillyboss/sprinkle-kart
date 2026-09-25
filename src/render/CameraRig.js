import * as THREE from 'three';

/**
 * CameraRig — a friendly chase camera for one human kart.
 *
 *  - Smooth follow behind/above. The yaw lags the kart a little (more while
 *    drifting so you can see the slide), the position does not lag, so the
 *    kart never jitters in frame.
 *  - Looks a little ahead of the kart.
 *  - FOV opens up with speed and kicks on boosts.
 *  - Look-back flips the camera to face behind the kart.
 *  - Start-of-race swoop: during the countdown it glides from a front 3/4 view
 *    of the driver's face round to the chase position.
 *  - Very wide viewports (2-player top/bottom) get a narrower vertical FOV so
 *    the picture is not fish-eyed.
 */

/**
 * Per-character camera nudge (CharacterDef.camera = { height, lookHeight },
 * metres added to the defaults) so tall hats / hair sit below the horizon.
 */
export function cameraTweak(kart) {
  const t = kart?.charDef?.camera;
  return { height: Number(t?.height) || 0, lookHeight: Number(t?.lookHeight) || 0 };
}

export const CAMERA_DEFAULTS = {
  fov: 62,
  maxHorizontalFov: 100,
  near: 0.15,
  far: 1400,
  distance: 5.9,
  height: 2.75,
  lookAhead: 5,
  lookHeight: 1.3,
  yawRate: 7,
  yawRateDrift: 3.2,
  heightRate: 8,
  boostFov: 9,
  speedFov: 6,
};

const TAU = Math.PI * 2;

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a) {
  a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a;
}

/** Exponential smoothing factor for a rate (1/s) and a time step. */
export function smoothing(rate, dt) {
  return 1 - Math.exp(-rate * Math.max(0, dt));
}

/** Smoothstep-ish ease for the countdown swoop. */
export function easeInOutCubic(t) {
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Vertical FOV (degrees) that keeps the horizontal FOV at or below `maxH`
 * for the given aspect ratio.
 */
export function fitVerticalFov(vfov, aspect, maxH = CAMERA_DEFAULTS.maxHorizontalFov) {
  const toRad = Math.PI / 180;
  const h = 2 * Math.atan(Math.tan((vfov * toRad) / 2) * aspect);
  if (h <= maxH * toRad) return vfov;
  return (2 * Math.atan(Math.tan((maxH * toRad) / 2) / aspect)) / toRad;
}

/**
 * Where the swoop puts the camera for a countdown value (3 → 0).
 * @returns {{ orbit:number, distMult:number, lift:number }} orbit = extra yaw (radians)
 */
export function swoopAt(countdown) {
  if (countdown == null) return { orbit: 0, distMult: 1, lift: 0 };
  const t = (3 - countdown) / 2.6;
  const e = easeInOutCubic(t);
  const k = 1 - e;
  return { orbit: k * Math.PI * 0.82, distMult: 1 - k * 0.12, lift: k * 0.6 };
}

export class CameraRig {
  /** @param {Partial<typeof CAMERA_DEFAULTS> & {aspect?:number}} [opts] */
  constructor(opts = {}) {
    this.opts = { ...CAMERA_DEFAULTS, ...opts };
    this.camera = new THREE.PerspectiveCamera(this.opts.fov, opts.aspect ?? 16 / 9, this.opts.near, this.opts.far);
    this.aspect = this.camera.aspect;
    this.yaw = 0;
    this.camY = 0;
    this.fovKick = 0;
    this.speedFov = 0;
    this._snapped = false;
    this._look = new THREE.Vector3();
    this._lookSmoothed = new THREE.Vector3();
  }

  setAspect(aspect) {
    this.aspect = Math.max(0.1, aspect || 1);
    this.camera.aspect = this.aspect;
    this._applyFov();
  }

  _applyFov() {
    const base = fitVerticalFov(this.opts.fov, this.aspect, this.opts.maxHorizontalFov);
    // Keep the kart a similar size on screen when the FOV had to be narrowed.
    this._distScale = Math.sqrt(this.opts.fov / base) * 0.92 + 0.08;
    const extra = (this.fovKick + this.speedFov) * (base / this.opts.fov);
    this.camera.fov = base + extra;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the resting chase position (no smoothing). */
  snap(kart) {
    this.yaw = kart.heading;
    this.camY = kart.position.y + this.opts.height + cameraTweak(kart).height;
    this.fovKick = 0;
    this.speedFov = 0;
    this._snapped = true;
    this._applyFov();
    this._place(kart, 0, 1, 0, false, true);
  }

  /**
   * @param {number} dt
   * @param {object} kart KartState
   * @param {{ lookBack?: boolean, countdown?: number|null }} [opts]
   */
  update(dt, kart, { lookBack = false, countdown = null } = {}) {
    if (!kart) return;
    if (!this._snapped) this.snap(kart);
    const o = this.opts;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);

    // Yaw follows the kart heading (not the happy-twirl spin angle).
    const rate = kart.drifting ? o.yawRateDrift : kart.spinning ? 2 : o.yawRate;
    this.yaw += wrapAngle(kart.heading - this.yaw) * smoothing(rate, dt);
    this.yaw = wrapAngle(this.yaw);

    // FOV: gently wider with speed, kick on boost.
    const speed = Math.max(0, kart.speed || 0);
    const maxSpeed = kart.stats?.maxSpeed || 33;
    const targetSpeedFov = Math.min(1.2, speed / maxSpeed) * o.speedFov;
    const targetKick = kart.boosting || kart.starPower > 0 ? o.boostFov : 0;
    this.speedFov += (targetSpeedFov - this.speedFov) * smoothing(3, dt);
    this.fovKick += (targetKick - this.fovKick) * smoothing(targetKick > this.fovKick ? 8 : 2.5, dt);
    this._applyFov();

    const sw = swoopAt(countdown);
    const distMult = sw.distMult * (1 + Math.min(1, speed / maxSpeed) * 0.08);
    this._place(kart, sw.orbit, distMult, sw.lift, lookBack, false, dt);
  }

  _place(kart, orbit, distMult, lift, lookBack, instant, dt = 0) {
    const o = this.opts;
    const cam = this.camera;
    const yaw = lookBack ? kart.heading + Math.PI : this.yaw + orbit;
    const dist = o.distance * distMult * (this._distScale || 1);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const kp = kart.position;
    const tw = cameraTweak(kart);

    const targetY = kp.y + (o.height + tw.height) * (this._distScale || 1) + lift;
    if (instant) this.camY = targetY;
    else this.camY += (targetY - this.camY) * smoothing(o.heightRate, dt);
    this.camY = Math.max(this.camY, kp.y + 1.0);

    cam.position.set(kp.x - fx * dist, this.camY, kp.z - fz * dist);

    const ahead = lookBack ? 2 : o.lookAhead;
    const lookFx = lookBack ? fx : Math.sin(this.yaw);
    const lookFz = lookBack ? fz : Math.cos(this.yaw);
    this._look.set(kp.x + lookFx * ahead, kp.y + o.lookHeight + tw.lookHeight, kp.z + lookFz * ahead);
    if (orbit > 0.05 && !lookBack) {
      // During the swoop, keep the driver centred.
      this._look.set(kp.x, kp.y + 1.1, kp.z);
    }
    cam.lookAt(this._look);
  }
}

/**
 * SpectatorCam — a TV-style camera circling the race leader (the 3-player
 * 4th quadrant). Falls back to a high orbit of the whole track.
 */
export class SpectatorCam {
  constructor(path, { far = 2200, aspect = 16 / 9, fov = 50 } = {}) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 1, far);
    const b = path.getBounds();
    this.center = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    let sy = 0;
    for (let i = 0; i < path.count; i += 10) sy += path.py[i];
    this.center.y = sy / Math.ceil(path.count / 10);
    this.extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 120);
    this.angle = 0.6;
    this._focus = this.center.clone();
  }

  setAspect(aspect) {
    this.camera.aspect = aspect || 1;
    this.camera.updateProjectionMatrix();
  }

  /** @param {number} dt @param {{ getStandings?: Function }} [race] */
  update(dt, race = null) {
    dt = dt || 0;
    this.angle += dt * 0.12;
    // A TV "blimp" camera that circles the race leader.
    const leader = race?.getStandings?.()[0];
    const target = leader ? leader.position : this.center;
    if (!this._hasFocus) { this._focus.copy(target); this._hasFocus = true; }
    this._focus.lerp(target, smoothing(8, dt));
    const r = leader ? 34 : this.extent * 0.62;
    const h = leader ? 20 : this.extent * 0.55;
    this.camera.position.set(
      this._focus.x + Math.sin(this.angle) * r,
      this._focus.y + h,
      this._focus.z + Math.cos(this.angle) * r,
    );
    // Aim a little in front of the leader (towards the camera) so the pack
    // sits in the upper half of the view, clear of the minimap corner.
    const pull = leader ? 0.3 : 0;
    this.camera.lookAt(
      this._focus.x + (this.camera.position.x - this._focus.x) * pull,
      this._focus.y + 1 - (leader ? 3 : 0),
      this._focus.z + (this.camera.position.z - this._focus.z) * pull,
    );
  }
}

const _v = new THREE.Vector3();
