/**
 * Race tuning knobs. Everything that affects "feel" lives here so it can be
 * tweaked in one place. Units: metres, seconds, radians.
 */
export const TUNING = {
  // Simulation
  maxFrameDt: 0.1, // dt spikes (tab switch, GC) are clamped to this
  subStep: 1 / 120, // physics sub-step size

  // Driving
  turnRate: 2.15, // rad/s at full lock and cruising speed
  turnFullSpeed: 9, // speed at which steering reaches full authority
  highSpeedTurnDamp: 0.22, // steering loses this fraction at top speed
  steerSmoothing: 14, // how quickly steering follows the stick
  grip: 10, // sideways velocity decay (higher = grippier)
  gripTransfer: 0.9, // fraction of scrubbed sideways speed kept as forward speed
  brakeDecel: 38,
  reverseAccel: 14,
  reverseMax: 9,
  coastDecel: 7,
  overSpeedDecel: 16,
  offRoadDecel: 28,
  offRoadMult: 0.55,
  offRoadMultEasy: 0.72,
  accelCurve: 0.55, // acceleration fades by this fraction approaching max speed

  // Drift + mini-turbo
  driftMinSpeed: 11,
  hopDuration: 0.26,
  hopHeight: 0.45,
  driftStartWindow: 0.18, // after landing a hop you may still start the drift
  driftGrip: 2.3,
  driftGripTransfer: 0.8,
  driftTurnBase: 0.27, // yaw multiplier when steering against the drift (wide arc)
  driftTurnRange: 0.98, // extra yaw when steering into the drift (tight arc)
  driftLevels: [0.7, 1.55, 2.5], // charge needed for blue, pink, rainbow
  miniTurbo: [0, 0.55, 0.95, 1.4], // boost seconds per level

  // Boosts
  boostMult: 1.32,
  boostAccel: 48,
  padBoost: 1.1,
  itemBoost: 1.35,
  startBoost: 1.1,
  startBoostWindow: 1.2, // press accelerate within the last N seconds of countdown

  // Star
  starDuration: 7,
  starMult: 1.18,

  // Shield
  shieldDuration: 18,

  // Bonks
  spinDuration: 1.2,
  bonkSpeedKeep: 0.6,
  twirlTurns: 2, // full happy twirls per bonk

  // Items
  rouletteDuration: 1.2,
  itemBoxRespawn: 3,
  itemBoxRadius: 2.1,
  gumdropRadius: 1.5,
  gumdropGrace: 0.8,
  maxGumdrops: 16,
  gumdropLife: 45,
  rocketSpeed: 58,
  rocketLife: 11,
  rocketRange: 420, // how far a rocket with nobody to chase flies before fizzling
  rocketHomingRate: 9, // lateral units per second
  rocketHitRadius: 1.7,

  // Walls (the visual barrier sits at halfWidth + wallMargin)
  wallMargin: 3,
  kartHalfWidth: 0.8,
  wallSpring: 18, // how quickly penetration is pushed back
  wallHardExtra: 0.7, // absolute max penetration past the soft limit
  wallBounce: 0.25,
  wallTurn: 3.2, // rad/s the kart is redirected along the wall
  wallSpeedLoss: 0.35,

  // Kart-kart bumping
  kartRadius: 1.1,
  bumpRestitution: 0.55,
  bumpCooldown: 0.5,

  // Visuals
  heightSmoothing: 15,
  pitchSmoothing: 10,
};

/** Character stats (1..5) to physics multipliers — small effect only. */
export function statsToPhysics(stats = {}, speedClass) {
  const st = { speed: 3, accel: 3, handling: 3, weight: 3, ...stats };
  return {
    maxSpeed: speedClass.maxSpeed * (1 + (st.speed - 3) * 0.02),
    accel: speedClass.accel * (1 + (st.accel - 3) * 0.07),
    handling: 1 + (st.handling - 3) * 0.06,
    mass: 1 + (st.weight - 3) * 0.18,
  };
}
