/**
 * Pure helpers that turn a Gamepad API snapshot into a normalized input frame.
 *
 * Standard mapping (gamepad.mapping === 'standard'; Xbox, PlayStation, Switch Pro in Chrome):
 *   Drive:  A (0) or RT (7, analog) = accelerate       B (1) or LT (6, analog) = brake / reverse
 *           left stick X (deadzone 0.2) or d-pad = steer
 *           RB (5) or X (2) = drift (hold)              LB (4) or Y (3) = use item
 *           right-stick click (11) or right stick pulled down = look back
 *           Start (9) = pause
 *   Menu:   left stick / d-pad = move, A = confirm, B = back, Y = toggle (Easy Drive), Start = start
 *
 * Non-standard pads (generic USB / DirectInput / some Switch adapters) use the same button
 * indices as a best guess, read triggers as digital or analog buttons 6/7, accept
 * Select (8) as well as Start (9), and read the d-pad from buttons 12–15 when present or
 * from a POV-hat axis (axes[9], the usual Chrome/Windows layout) otherwise.
 */

export const STICK_DEADZONE = 0.2;
export const TRIGGER_DEADZONE = 0.06;
/** Stick must pass this to count as a menu direction ... */
export const MENU_PRESS_THRESHOLD = 0.5;
/** ... and fall back under this to release it (hysteresis, avoids flicker). */
export const MENU_RELEASE_THRESHOLD = 0.35;
/** Right stick pulled this far down = look back. */
export const LOOKBACK_STICK_THRESHOLD = 0.7;

/**
 * Axial deadzone with rescaling so output ramps smoothly from 0 at the deadzone edge to 1.
 * @param {number} v raw value -1..1
 * @param {number} dz deadzone 0..1
 */
export function applyDeadzone(v, dz = STICK_DEADZONE) {
  if (!Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  if (a <= dz) return 0;
  const out = Math.min(1, (a - dz) / (1 - dz));
  return v < 0 ? -out : out;
}

/**
 * Decode a POV-hat axis value (8 directions in steps of 2/7 from -1 = up, clockwise;
 * anything outside about ±1.1 means "centred", commonly 1.2857).
 * @returns {{x:number, y:number}} x: -1 left..1 right, y: -1 up..1 down
 */
export function decodeHat(v) {
  if (!Number.isFinite(v) || v < -1.1 || v > 1.1) return { x: 0, y: 0 };
  const idx = Math.round(((v + 1) * 7) / 2) % 8; // 0 up, 1 up-right, 2 right ... 7 up-left
  const DIRS = [
    [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];
  const [x, y] = DIRS[idx];
  return { x, y };
}

function button(gp, i) {
  const b = gp.buttons && gp.buttons[i];
  if (b == null) return { pressed: false, value: 0 };
  if (typeof b === 'number') return { pressed: b > 0.5, value: b }; // very old implementations
  const value = typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0;
  return { pressed: !!b.pressed || value > 0.5, value };
}

function pressed(gp, i) {
  return button(gp, i).pressed;
}

/** Analog trigger 0..1 (falls back to digital pressed state). */
function trigger(gp, i) {
  const b = button(gp, i);
  const v = b.value > 0 ? b.value : b.pressed ? 1 : 0;
  return applyDeadzone(v, TRIGGER_DEADZONE);
}

function axis(gp, i) {
  const v = gp.axes && gp.axes[i];
  return Number.isFinite(v) ? v : 0;
}

/**
 * Menu direction from a stick with hysteresis + dominant-axis selection
 * (so a diagonal push moves the cursor only one way).
 */
function stickDirs(x, y, prev) {
  const thr = (dir) => (prev && prev[dir] ? MENU_RELEASE_THRESHOLD : MENU_PRESS_THRESHOLD);
  const d = {
    left: x < -thr('left'),
    right: x > thr('right'),
    up: y < -thr('up'),
    down: y > thr('down'),
  };
  const horiz = d.left || d.right;
  const vert = d.up || d.down;
  if (horiz && vert) {
    if (Math.abs(x) >= Math.abs(y)) d.up = d.down = false;
    else d.left = d.right = false;
  }
  return d;
}

/**
 * Normalize a Gamepad snapshot.
 * @param {Gamepad} gp
 * @param {{stickDirs?:Record<string,boolean>}} [prev] previous frame from this function (for hysteresis)
 * @returns {{steer:number, accel:number, brake:number, held:Record<string,boolean>,
 *            taps:Set<string>, anyButton:boolean, stickX:number, stickY:number,
 *            stickDirs:Record<string,boolean>}}
 */
export function readGamepad(gp, prev) {
  const standard = gp.mapping === 'standard';
  const lx = axis(gp, 0);
  const ly = axis(gp, 1);
  const ry = axis(gp, 3);

  // D-pad
  let dpad = { x: 0, y: 0 };
  const nButtons = gp.buttons ? gp.buttons.length : 0;
  if (standard || nButtons >= 16) {
    dpad = {
      x: (pressed(gp, 15) ? 1 : 0) - (pressed(gp, 14) ? 1 : 0),
      y: (pressed(gp, 13) ? 1 : 0) - (pressed(gp, 12) ? 1 : 0),
    };
  }
  if (!standard && dpad.x === 0 && dpad.y === 0 && gp.axes && gp.axes.length >= 10) {
    dpad = decodeHat(axis(gp, 9));
  }

  const stickSteer = applyDeadzone(lx, STICK_DEADZONE);
  const steer = dpad.x !== 0 ? dpad.x : stickSteer;

  const accel = Math.max(pressed(gp, 0) ? 1 : 0, trigger(gp, 7));
  const brake = Math.max(pressed(gp, 1) ? 1 : 0, trigger(gp, 6));

  const startBtn = standard ? pressed(gp, 9) : pressed(gp, 9) || pressed(gp, 8);

  const sd = stickDirs(lx, ly, prev && prev.stickDirs);

  const held = {
    drift: pressed(gp, 5) || pressed(gp, 2),
    item: pressed(gp, 4) || pressed(gp, 3),
    lookBack: pressed(gp, 11) || (standard && ry > LOOKBACK_STICK_THRESHOLD),
    pause: startBtn,
    confirm: pressed(gp, 0),
    back: pressed(gp, 1),
    start: startBtn,
    toggle: pressed(gp, 3),
    up: dpad.y < 0 || sd.up,
    down: dpad.y > 0 || sd.down,
    left: dpad.x < 0 || sd.left,
    right: dpad.x > 0 || sd.right,
  };

  let anyButton = false;
  for (let i = 0; i < nButtons; i++) {
    if (pressed(gp, i)) {
      anyButton = true;
      break;
    }
  }

  return { steer, accel, brake, held, taps: new Set(), anyButton, stickX: lx, stickY: ly, stickDirs: sd };
}

/**
 * Friendly name + family for a Gamepad.id string, for UI icons / button glyphs.
 * @returns {{name:string, kind:'xbox'|'playstation'|'switch'|'generic'}}
 */
export function describeGamepad(id = '') {
  const s = String(id).toLowerCase();
  if (/xbox|xinput|045e/.test(s)) return { name: 'Xbox Controller', kind: 'xbox' };
  if (/dualsense|dualshock|playstation|054c|wireless controller|ps[345]/.test(s)) {
    return { name: 'PlayStation Controller', kind: 'playstation' };
  }
  if (/pro controller|joy-?con|nintendo|057e|switch/.test(s)) return { name: 'Switch Controller', kind: 'switch' };
  return { name: 'Game Controller', kind: 'generic' };
}

/**
 * Button labels to show in UI prompts ("Press A to join!").
 * With standard mapping the bottom face button is index 0 on every pad, so on a Switch pad
 * the physical button printed "B" is the confirm button.
 */
export function gamepadLabels(kind) {
  switch (kind) {
    case 'playstation':
      return { confirm: '✕', back: '○', toggle: '△', start: 'Options', accel: '✕', brake: '○', drift: 'R1', item: 'L1', lookBack: 'R3', pause: 'Options', steer: 'Stick', move: 'Stick' };
    case 'switch':
      return { confirm: 'B', back: 'A', toggle: 'X', start: '+', accel: 'B', brake: 'A', drift: 'R', item: 'L', lookBack: 'RS', pause: '+', steer: 'Stick', move: 'Stick' };
    default:
      return { confirm: 'A', back: 'B', toggle: 'Y', start: 'Start', accel: 'A', brake: 'B', drift: 'RB', item: 'LB', lookBack: 'RS', pause: 'Start', steer: 'Stick', move: 'Stick' };
  }
}
