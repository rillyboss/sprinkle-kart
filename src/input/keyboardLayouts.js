/**
 * Keyboard layouts for Sprinkle Kart. Two players can share one keyboard.
 * Bindings use `KeyboardEvent.code` (physical key position), so they work
 * the same on QWERTY, AZERTY, etc. The two layouts never share a key.
 *
 * ┌──────────────┬──────────────────────────────┬────────────────────────────────────────┐
 * │ Action       │ kb1 "WASD" (left side)       │ kb2 "Arrows" (right side)              │
 * ├──────────────┼──────────────────────────────┼────────────────────────────────────────┤
 * │ Accelerate   │ W                            │ Arrow Up                               │
 * │ Brake/Reverse│ S                            │ Arrow Down                             │
 * │ Steer        │ A / D                        │ Arrow Left / Arrow Right               │
 * │ Drift (hold) │ Space or Left Shift          │ Right Shift                            │
 * │ Use item     │ E                            │ /  or Right Ctrl                       │
 * │ Look back    │ Q                            │ .  (period)                            │
 * │ Pause        │ Esc or P                     │ Backspace or \  (backslash)            │
 * ├──────────────┼──────────────────────────────┼────────────────────────────────────────┤
 * │ Menu move    │ W A S D                      │ Arrow keys                             │
 * │ Confirm/Join │ Space or Enter               │ /  or Right Shift or Numpad Enter      │
 * │ Back/Leave   │ Esc                          │ Backspace                              │
 * │ Start        │ P                            │ \  (backslash)                         │
 * │ Toggle (Easy)│ Tab                          │ '  (quote) or Right Ctrl               │
 * └──────────────┴──────────────────────────────┴────────────────────────────────────────┘
 */

/** @typedef {'steerLeft'|'steerRight'|'accel'|'brake'|'drift'|'item'|'lookBack'|'pause'|
 *            'up'|'down'|'left'|'right'|'confirm'|'back'|'start'|'toggle'} BindingName */

export const KEYBOARD_LAYOUTS = {
  kb1: {
    id: 'kb1',
    name: 'Keyboard (WASD)',
    short: 'WASD',
    bindings: {
      accel: ['KeyW'],
      brake: ['KeyS'],
      steerLeft: ['KeyA'],
      steerRight: ['KeyD'],
      drift: ['Space', 'ShiftLeft'],
      item: ['KeyE'],
      lookBack: ['KeyQ'],
      pause: ['Escape', 'KeyP'],
      up: ['KeyW'],
      down: ['KeyS'],
      left: ['KeyA'],
      right: ['KeyD'],
      confirm: ['Space', 'Enter'],
      back: ['Escape'],
      start: ['KeyP'],
      toggle: ['Tab'],
    },
    labels: {
      accel: 'W', brake: 'S', steer: 'A/D', drift: 'Space', item: 'E', lookBack: 'Q',
      pause: 'Esc', confirm: 'Space', back: 'Esc', start: 'P', toggle: 'Tab', move: 'WASD',
    },
  },
  kb2: {
    id: 'kb2',
    name: 'Keyboard (Arrows)',
    short: 'Arrows',
    bindings: {
      accel: ['ArrowUp'],
      brake: ['ArrowDown'],
      steerLeft: ['ArrowLeft'],
      steerRight: ['ArrowRight'],
      drift: ['ShiftRight'],
      item: ['Slash', 'ControlRight'],
      lookBack: ['Period'],
      pause: ['Backspace', 'Backslash'],
      up: ['ArrowUp'],
      down: ['ArrowDown'],
      left: ['ArrowLeft'],
      right: ['ArrowRight'],
      confirm: ['Slash', 'ShiftRight', 'NumpadEnter'],
      back: ['Backspace'],
      start: ['Backslash'],
      toggle: ['Quote', 'ControlRight'],
    },
    labels: {
      accel: '↑', brake: '↓', steer: '←/→', drift: 'R-Shift', item: '/', lookBack: '.',
      pause: 'Backspace', confirm: '/', back: 'Backspace', start: '\\', toggle: "'", move: 'Arrows',
    },
  },
};

export const KEYBOARD_IDS = Object.keys(KEYBOARD_LAYOUTS);

/** Every key code used by a layout (deduplicated). */
export function layoutCodes(layout) {
  const set = new Set();
  for (const codes of Object.values(layout.bindings)) for (const c of codes) set.add(c);
  return [...set];
}

/** Map of KeyboardEvent.code -> keyboard device id ('kb1' | 'kb2'). */
export const CODE_TO_KEYBOARD = (() => {
  const map = new Map();
  for (const layout of Object.values(KEYBOARD_LAYOUTS)) {
    for (const code of layoutCodes(layout)) map.set(code, layout.id);
  }
  return map;
})();

/** True when `code` is a key the game uses (so browser default should be prevented). */
export function isGameKey(code) {
  return CODE_TO_KEYBOARD.has(code);
}

const BUTTON_NAMES = ['drift', 'item', 'lookBack', 'pause', 'up', 'down', 'left', 'right', 'confirm', 'back', 'start', 'toggle'];

/**
 * Build a normalized input frame for one keyboard layout.
 * @param {object} layout one of KEYBOARD_LAYOUTS
 * @param {Set<string>} heldCodes codes currently held down
 * @param {Set<string>} tappedCodes codes that went down since the last frame (even if already released)
 * @returns {{steer:number, accel:number, brake:number, held:Record<string,boolean>, taps:Set<string>}}
 */
export function readKeyboardFrame(layout, heldCodes, tappedCodes) {
  const b = layout.bindings;
  const isHeld = (name) => b[name].some((c) => heldCodes.has(c) || tappedCodes.has(c));
  const isTapped = (name) => b[name].some((c) => tappedCodes.has(c));
  const held = {};
  const taps = new Set();
  for (const name of BUTTON_NAMES) {
    held[name] = isHeld(name);
    if (isTapped(name)) taps.add(name);
  }
  const steer = (isHeld('steerRight') ? 1 : 0) - (isHeld('steerLeft') ? 1 : 0);
  return {
    steer,
    accel: isHeld('accel') ? 1 : 0,
    brake: isHeld('brake') ? 1 : 0,
    held,
    taps,
  };
}
