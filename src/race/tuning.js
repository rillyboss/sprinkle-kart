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

  // Drift + mini-turbo (family feedback: "too harsh initially" -> everything eases in)
  driftMinSpeed: 11,
  hopDuration: 0.3, // a soft little bunny hop
  hopHeight: 0.32,
  driftStartWindow: 0.32, // after landing a hop you may still start the drift (forgiving)
  driftSteerStart: 0.3, // |steer| needed to pick a drift direction
  driftEaseIn: 0.38, // seconds for grip + drift yaw to blend from normal to full slide
  driftEaseOut: 0.2, // seconds to regain full grip after letting go
  driftGrip: 4.5, // sideways grip while sliding (steady slide angle ~30 deg, never a spin-out)
  driftGripTransfer: 0.93, // speed kept while sliding (no sudden slow-down)
  driftTurnBase: 0.36, // yaw multiplier when steering against the drift (wide, forgiving arc)
  driftTurnRange: 0.9, // extra yaw when steering into the drift (tight arc)
  driftCharge: [0.8, 0.55], // charge per second = a + b * into (0 = steering out, 1 = in)
  driftLevels: [0.5, 1.35, 2.35], // charge needed for blue, pink, rainbow (blue comes quickly!)
  miniTurbo: [0, 0.6, 0.95, 1.4], // boost seconds per level

  // Kid-Assist (easyDrive karts)
  kidAssistBrake: 0.5, // brake must be pressed at least this hard to override the auto-gas
  kidAssistTurn: 1.12, // a little extra steering authority so full gas still makes the bends
  kidAssistStartAt: 0.9, // auto-press the gas this many seconds before GO (free Rocket Start)

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
