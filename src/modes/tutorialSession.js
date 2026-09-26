/**
 * "How to Play" race controller (main.js `opts.controller`). Every frame it
 * watches P1 (tutorialObserve), moves the lesson on (tutorialStep), keeps
 * `race.modeInfo.tutorial` fresh for the coach bubble (TUTORIAL_WIDGET),
 * cheers each learned trick (kart flash + a happy sound) and on race end adds
 * `summary.tutorial` ({ learned, total, done } — the Fun Goals count a
 * finished lesson).
 * OWNER: showcase features & modes.
 */
import { createTutorial, tutorialObserve, tutorialStep, tutorialCoach, tutorialResult } from './tutorial.js';

/**
 * @param {object} o
 * @param {object} o.race
 * @param {object} [o.session]  race session (stats, flash, sfx)
 * @param {object|string|null} [o.device] P1's input device (for button names)
 */
export function createTutorialSession({ race, session = null, device = null } = {}) {
  let state = createTutorial();
  const p1 = () => (race?.karts || []).find((k) => !k.isCPU && k.playerIndex === 0) ?? (race?.karts || []).find((k) => !k.isCPU) ?? null;

  const publish = () => {
    race.modeInfo = race.modeInfo || {};
    race.modeInfo.tutorial = tutorialCoach(state, device);
  };
  publish();

  function update(dt = 0) {
    const kart = p1();
    if (!kart || race.state === 'countdown') { publish(); return; }
    const stats = session?.stats?.forPlayer?.(kart.playerIndex) ?? {};
    const res = tutorialStep(state, tutorialObserve(kart, stats), dt);
    state = res.state;
    if (res.events.includes('step')) {
      try { session?.flash?.(kart, `${state.cheerText} ⭐`); } catch { /* ignore */ }
      try { session?.sfx?.('goal-sticker'); } catch { /* ignore */ }
    }
    publish();
  }

  function decorateSummary(summary) {
    if (!summary || typeof summary !== 'object') return summary;
    summary.tutorial = tutorialResult(state);
    return summary;
  }

  return {
    kind: 'tutorial',
    update,
    decorateSummary,
    dispose() { if (race?.modeInfo) delete race.modeInfo.tutorial; },
    get state() { return state; },
  };
}
