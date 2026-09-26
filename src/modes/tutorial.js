/**
 * "How to Play" — a gentle practice race that teaches the controls one trick
 * at a time. A friendly coach bubble on the HUD says what to try next ("Hold
 * GAS to zoom!"), shows the button for P1's controller, and cheers when it
 * happens. No CPU racers, 2 laps on the easiest track, Cozy speed.
 *
 * Pure logic here (DOM-free, unit tested):
 *   TUTORIAL_STEPS                     the tricks, in order
 *   createTutorial()                   -> state
 *   tutorialObserve(kart, stats)       -> Observation (what P1 is doing right now)
 *   tutorialStep(state, obs, dt)       -> { state, events: Array<'step'|'complete'> }
 *   tutorialCoach(state, device)       -> what the coach bubble shows
 *   tutorialResult(state)              -> { learned, total, done, steps }
 *   controlLabel(device, action)       -> 'W' / 'A' / 'RB' ... for P1's controller
 *   tutorialTrackId(trackIds), tutorialSetup(player, trackIds)
 * The race controller is src/modes/tutorialSession.js; the intro screen is
 * src/ui/screens/howToPlay.js; the coach bubble is TUTORIAL_WIDGET
 * (src/ui/widgets/showcaseModes.js).
 *
 * A practice race is not a real race: it never counts wins, records or
 * unlock progress (only the fun counters, and the "Sprinkle Scholar" sticker
 * once every trick is learned).
 *
 * OWNER: showcase features & modes.
 */
import { gamepadLabels } from '../input/gamepadMapping.js';
import { KEYBOARD_LAYOUTS } from '../input/keyboardLayouts.js';

export const TUTORIAL_MODE = 'tutorial';
export const TUTORIAL_LAPS = 2;
export const TUTORIAL_SPEED = 'cozy';
/** Easiest first: the practice track is the first of these that is available. */
export const TUTORIAL_TRACKS = Object.freeze(['gumdrop-meadow', 'cotton-candy-castle']);
/** Seconds the coach says "Yay!" before the next trick. */
export const CHEER_TIME = 1.6;
/** How long (s) P1 must hold a good speed / a drift. */
export const GO_TIME = 0.6;
export const DRIFT_TIME = 0.7;
export const STEER_MIN = 0.35;
export const GO_FRACTION = 0.45;

const S = (id, emoji, text, action, cheer) => Object.freeze({ id, emoji, text, action, cheer });

/** The tricks, in order. `action` = which button to show (see controlLabel). */
export const TUTORIAL_STEPS = Object.freeze([
  S('go', '🚗', 'Hold GAS to zoom!', 'accel', 'Vroom vroom!'),
  S('steer', '↔️', 'Steer left AND right!', 'steer', 'Great steering!'),
  S('drift', '🌀', 'Hold DRIFT in a turn!', 'drift', 'Sparkly drift!'),
  S('box', '🎁', 'Drive into a surprise box!', null, 'Ooh, a surprise!'),
  S('item', '✨', 'Use your surprise!', 'item', 'Ta-da!'),
  S('finish', '🏁', 'Zoom over the finish line!', null, 'You did it!'),
]);

const num = (v) => (Number.isFinite(v) ? v : 0);

export function createTutorial() {
  return { index: 0, learned: [], cheer: 0, cheerText: '', goTime: 0, driftTime: 0, left: false, right: false, complete: false };
}

/**
 * What P1 is doing right now (a plain object, so the rules stay testable).
 * @param {object} kart the P1 kart
 * @param {object} [stats] session.stats.forPlayer(P1)
 */
export function tutorialObserve(kart, stats = {}) {
  const max = num(kart?.stats?.maxSpeed) || num(kart?.stats?.topSpeed) || 30;
  return {
    speed: num(kart?.speed),
    maxSpeed: max,
    steer: num(kart?.phys?.steerSmoothed),
    drifting: !!kart?.drifting,
    miniTurbos: num(stats?.miniTurbos),
    itemBoxes: num(stats?.itemBoxes),
    itemsUsed: num(stats?.itemsUsed),
    hasItem: !!kart?.item,
    finished: !!kart?.finished,
  };
}

/** Is the current trick done? (mutates the timers / flags on `st`) */
function stepMet(st, id, obs, dt) {
  switch (id) {
    case 'go':
      st.goTime = obs.speed >= obs.maxSpeed * GO_FRACTION ? st.goTime + dt : 0;
      return st.goTime >= GO_TIME;
    case 'steer':
      if (obs.steer <= -STEER_MIN) st.left = true;
      if (obs.steer >= STEER_MIN) st.right = true;
      return st.left && st.right;
    case 'drift':
      st.driftTime = obs.drifting ? st.driftTime + dt : 0;
      return st.driftTime >= DRIFT_TIME || obs.miniTurbos > 0;
    case 'box': return obs.itemBoxes > 0 || obs.hasItem;
    case 'item': return obs.itemsUsed > 0;
    case 'finish': return obs.finished;
    default: return false;
  }
}

/**
 * Advance the lesson. Tricks go in order; each one done gives a short cheer
 * before the next. Crossing the line ends the lesson (tricks not done yet are
 * simply not learned — no pressure!).
 * @returns {{ state: object, events: string[] }}
 */
export function tutorialStep(state, obs, dt = 0) {
  if (state.complete || !obs) return { state, events: [] };
  const st = { ...state, learned: [...state.learned] };
  const events = [];
  const d = Math.max(0, num(dt));
  if (st.cheer > 0) {
    st.cheer = Math.max(0, st.cheer - d);
  }
  const step = TUTORIAL_STEPS[st.index];
  if (step && st.cheer <= 0 && stepMet(st, step.id, obs, d)) {
    st.learned.push(step.id);
    st.cheerText = step.cheer;
    st.cheer = CHEER_TIME;
    st.index += 1;
    events.push('step');
  }
  if (obs.finished && !st.complete) {
    if (!st.learned.includes('finish')) {
      st.learned.push('finish');
      events.push('step');
      st.cheerText = TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].cheer;
      st.cheer = CHEER_TIME;
    }
    st.index = TUTORIAL_STEPS.length;
    st.complete = true;
    events.push('complete');
  }
  return { state: st, events };
}

/**
 * The button name for an action on P1's device ('accel' | 'steer' | 'drift' | 'item' ...).
 * @param {{id?:string, type?:string, kind?:string, labels?:Record<string,string>}|string|null} device
 */
export function controlLabel(device, action) {
  if (!action) return '';
  if (typeof device === 'string') device = { id: device };
  if (device?.labels?.[action]) return device.labels[action];
  const kb = KEYBOARD_LAYOUTS[device?.id];
  if (kb || device?.type === 'keyboard') return (kb ?? KEYBOARD_LAYOUTS.kb1).labels[action] ?? '';
  return gamepadLabels(device?.kind)?.[action] ?? '';
}

/**
 * What the coach bubble shows.
 * @returns {{ emoji, text, key, index, total, cheering: boolean, done: boolean, sig: string }}
 */
export function tutorialCoach(state, device) {
  const total = TUTORIAL_STEPS.length;
  const cheering = state.cheer > 0;
  const step = TUTORIAL_STEPS[state.index];
  let out;
  if (cheering) out = { emoji: '🎉', text: state.cheerText, key: '' };
  else if (state.complete || !step) out = { emoji: '🎓', text: 'You are a Sprinkle Star!', key: '' };
  else out = { emoji: step.emoji, text: step.text, key: controlLabel(device, step.action) };
  const index = Math.min(state.index, total);
  const res = { ...out, index, total, cheering, done: !!state.complete, learned: state.learned.length };
  return { ...res, sig: `${res.emoji}|${res.text}|${res.key}|${index}|${res.learned}` };
}

/** The lesson's result (for summary.tutorial and the results screen). */
export function tutorialResult(state) {
  const learned = TUTORIAL_STEPS.filter((s) => state.learned.includes(s.id)).map((s) => s.id);
  return { learned, total: TUTORIAL_STEPS.length, done: learned.length === TUTORIAL_STEPS.length, complete: !!state.complete };
}

/** The practice track: the first friendly one that is available (else the first track). */
export function tutorialTrackId(trackIds = []) {
  return TUTORIAL_TRACKS.find((id) => trackIds.includes(id)) ?? trackIds[0] ?? null;
}

/**
 * The RaceSetup for a practice race: P1 alone.
 * @param {{ deviceId: string, characterId: string }} player
 * @param {string[]} trackIds available tracks
 */
export function tutorialSetup(player, trackIds) {
  return {
    players: [{ playerIndex: 0, deviceId: player.deviceId, characterId: player.characterId, easyDrive: false }],
    trackId: tutorialTrackId(trackIds),
    speedClass: TUTORIAL_SPEED,
    laps: TUTORIAL_LAPS,
    mode: TUTORIAL_MODE,
  };
}

/** The 6 tricks as cards for the How to Play screen (button names for `device`). */
export function tutorialCards(device) {
  return TUTORIAL_STEPS.map((s, i) => ({ id: s.id, n: i + 1, emoji: s.emoji, text: s.text, key: controlLabel(device, s.action) }));
}

/**
 * Who drives the practice race: the preferred racer when it is unlocked,
 * else the first unlocked racer, else the first racer.
 * @param {Array<{id:string}>} characters
 * @param {(c: object) => boolean} isLocked
 * @param {string|null} [preferredId]
 */
export function pickTutorialRacer(characters = [], isLocked = () => false, preferredId = null) {
  const open = characters.filter((c) => { try { return !isLocked(c); } catch { return true; } });
  return (open.find((c) => c.id === preferredId) ?? open[0] ?? characters[0])?.id ?? null;
}