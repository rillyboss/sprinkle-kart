/**
 * Race timer HUD widget (anchor 'top-center'): the race clock, the current
 * lap time, the latest lap splits (fastest one starred), the gap to your
 * Time Trial ghost and the sprinkle boosts left. Installed by
 * src/systems/timingHud.js. OWNER: modes + timing workstream.
 *
 * All the "what to show" logic is the pure `timerModel(kart, race)` (unit
 * tested); the widget only writes text when it changes.
 */
import './timer.css';
import { formatTime, formatDelta, currentLapTime, raceClock, lapSplits } from '../../modes/timing.js';

/** How many recent lap splits are shown. */
export const SPLITS_SHOWN = 3;

/**
 * @returns {{ main: string, lapLabel: string, lap: string, splits: Array<{lap:number, text:string, best:boolean}>,
 *   splitsSig: string, ghost: string|null, ghostAhead: boolean, boosts: number|null, finished: boolean, counting: boolean }}
 */
export function timerModel(kart, race) {
  const counting = race?.state === 'countdown';
  const finished = !!kart?.finished;
  const all = lapSplits(kart?.lapTimes || []);
  const splits = all.slice(-SPLITS_SHOWN).map((s) => ({ lap: s.lap, text: formatTime(s.time), best: s.best && all.length > 1 }));
  const gap = race?.modeInfo?.ghostGap;
  const rules = race?.rules;
  let boosts = null;
  if (rules?.startItem) boosts = kart?.item === rules.startItem ? Math.max(0, kart.itemCharges || 0) : 0;
  return {
    main: formatTime(raceClock(kart, race)),
    lapLabel: finished ? 'FINISH' : `LAP ${Math.max(1, kart?.lap ?? 1)}`,
    lap: formatTime(currentLapTime(kart, race)),
    splits,
    splitsSig: splits.map((s) => `${s.lap}${s.best ? '*' : ''}`).join(','),
    ghost: Number.isFinite(gap) ? formatDelta(gap) : null,
    ghostAhead: Number.isFinite(gap) && gap < 0,
    boosts,
    finished,
    counting,
  };
}

const canDom = () => typeof document !== 'undefined';

function mk(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  parent?.appendChild(n);
  return n;
}

/** @type {{ id: string, anchor: string, order: number, create: Function }} */
export const TIMER_WIDGET = {
  id: 'race-timer',
  anchor: 'top-center',
  order: 10,
  create(node) {
    if (!canDom() || !node?.appendChild) return { update() {}, reset() {}, destroy() {} };
    const root = mk('div', 'sk-timer', node);
    const main = mk('div', 'sk-timer-main', root);
    mk('span', 'sk-timer-ico', main, '⏱️');
    const mainT = mk('b', 'sk-timer-t', main, '0:00.00');
    const sub = mk('div', 'sk-timer-sub', root);
    const lapL = mk('span', 'sk-timer-lapn', sub, 'LAP 1');
    const lapT = mk('span', 'sk-timer-lapt', sub, '0:00.00');
    const splits = mk('div', 'sk-timer-splits', root);
    const extras = mk('div', 'sk-timer-extras', root);
    const ghost = mk('span', 'sk-timer-ghost', extras);
    const boosts = mk('span', 'sk-timer-boosts', extras);
    let cache = {};
    const set = (n, key, v) => { if (cache[key] !== v) { cache[key] = v; n.textContent = v; } };
    return {
      update(kart, race) {
        const m = timerModel(kart, race);
        set(mainT, 'main', m.main);
        set(lapL, 'lapL', m.lapLabel);
        set(lapT, 'lap', m.lap);
        root.classList.toggle('sk-timer-done', m.finished);
        root.classList.toggle('sk-timer-wait', m.counting);
        if (cache.splits !== m.splitsSig) {
          const grew = (cache.splitCount ?? 0) < m.splits.length || cache.splits === undefined;
          cache.splits = m.splitsSig;
          cache.splitCount = m.splits.length;
          splits.innerHTML = '';
          m.splits.forEach((s, i) => {
            const chip = mk('span', `sk-split${s.best ? ' sk-split-best' : ''}${grew && i === m.splits.length - 1 ? ' sk-split-new' : ''}`, splits);
            mk('small', null, chip, `L${s.lap}`);
            mk('span', null, chip, s.text);
            if (s.best) mk('i', null, chip, '⭐');
          });
        }
        const g = m.ghost ? `👻 ${m.ghost}` : '';
        set(ghost, 'ghost', g);
        ghost.hidden = !g;
        ghost.classList.toggle('sk-ahead', m.ghostAhead);
        const b = m.boosts === null ? '' : `🍬 × ${m.boosts}`;
        set(boosts, 'boosts', b);
        boosts.hidden = !b;
        boosts.classList.toggle('sk-empty', m.boosts === 0);
        extras.hidden = !g && !b;
      },
      reset() {
        cache = {};
        splits.innerHTML = '';
      },
      destroy() { root.remove(); },
    };
  },
};

export default TIMER_WIDGET;
