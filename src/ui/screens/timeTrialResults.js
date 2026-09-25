/**
 * Time Trial results: your time, how it compares to your record (with a
 * friendly delta), the lap splits and whether the ghost got an upgrade.
 * Opened by main.js with menus.open('time-trial-results', params):
 *   { summary: RaceSummary (summary.records from src/systems/timingRecords.js), trackDef,
 *     ghostSaved: boolean, hadGhost: boolean, unlocks: [{kind, def}] }
 * Resolves 'again' | 'next-track' | 'menu'. OWNER: modes + timing workstream.
 */
import { el, escapeHtml, hint, floatiesLayer, confettiLayer } from '../dom.js';
import { formatTime, formatDelta, trialVerdict, trialVerdictText, lapSplits } from '../../modes/timing.js';
import { createPhasedState, phasedTick, phasedReduce } from '../../modes/menus.js';
import { hintsBar } from './_shared.js';
import { portraitFor, nameOf, celebrationQueue, optionButtons } from './_modes.js';

export const TT_OPTIONS = [
  ['again', 'Try again', '🔁'],
  ['next-track', 'Next track', '➡️'],
  ['menu', 'Menu', '🏠'],
];

/** Pure view model for the screen (unit tested). */
export function trialResultModel({ summary, ghostSaved = false, hadGhost = false } = {}) {
  const h = summary?.humans?.[0] ?? null;
  const finished = !!h?.finished && !h?.estimated;
  const time = finished ? h.finishTime : null;
  const rec = summary?.records ?? null;
  const before = rec?.previous?.bestRace ?? null;
  const verdict = trialVerdict(time, before);
  const best = rec?.record?.bestRace ?? null;
  const lapRecord = !!rec?.newBestLap;
  return {
    characterId: h?.characterId ?? null,
    time,
    timeText: formatTime(time),
    verdict,
    headline: trialVerdictText(verdict),
    recordText: best != null ? formatTime(best) : '--:--.--',
    beforeText: before != null ? formatTime(before) : null,
    deltaText: verdict.delta != null ? formatDelta(verdict.delta) : '',
    newRecord: verdict.kind === 'record' || verdict.kind === 'first',
    lapRecord,
    bestLapText: formatTime(rec?.record?.bestLap ?? null),
    splits: lapSplits(h?.lapTimes ?? []).map((s) => ({ ...s, text: formatTime(s.time) })),
    ghostLine: ghostSaved
      ? (hadGhost ? 'Your ghost learned your new speedy line! 👻✨' : 'A sparkly ghost will race you next time! 👻')
      : (hadGhost ? 'Your ghost is still the one to beat! 👻' : ''),
  };
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'time-trial-results',
  mount(ctx, nav, params = {}) {
    const { trackDef = null, unlocks = [], options = TT_OPTIONS } = params;
    const m = trialResultModel(params);
    const splits = m.splits.map((s) => el(`div.sk-tt-split${s.best && m.splits.length > 1 ? '.sk-tt-split-best' : ''}`, {
      '--i': s.lap,
      html: `<span>Lap ${s.lap}</span><b>${s.text}</b>${s.best && m.splits.length > 1 ? '<i>⭐</i>' : ''}`,
    }));
    let state = createPhasedState(options.map((o) => o[0]), { introTime: 1.4 });
    const opts = optionButtons(options, (i) => handle({ deviceId: 'mouse', action: 'select', index: i }));
    const optHost = el('div.sk-gp-opts', {}, opts.node);

    const card = el('div.sk-tt-card', {},
      el('div.sk-tt-hero', { html: `${portraitFor(ctx, m.characterId, 'sk-tt-portrait')}<div class="sk-tt-ghostie">👻</div>` }),
      el('div.sk-tt-info', {},
        el('div.sk-tt-label', { html: 'Your time' }),
        el(`div.sk-tt-time${m.newRecord ? '.sk-tt-time-record' : ''}`, { html: m.timeText }),
        el('div.sk-tt-verdict', { html: escapeHtml(m.headline) }),
        el('div.sk-tt-recs', {
          html: `<span>🏆 Best race <b>${m.recordText}</b></span>`
            + `<span>${m.lapRecord ? '⭐ New best lap' : '🔁 Best lap'} <b>${m.bestLapText}</b></span>`
            + (m.beforeText && m.verdict.kind === 'record' ? `<span>Old record <b>${m.beforeText}</b></span>` : ''),
        }),
        el('div.sk-tt-splits', {}, splits),
        m.ghostLine ? el('div.sk-tt-ghostline', { html: escapeHtml(m.ghostLine) }) : null));

    const node = el('div.sk-screen.sk-tt', {},
      floatiesLayer(16, 57),
      m.newRecord ? confettiLayer(80, 9) : null,
      el('div.sk-results-head', {},
        el('div.sk-gp-kicker', { html: `⏱️ Time Trial${trackDef?.name ? ` · ${escapeHtml(trackDef.name)}` : ''}` }),
        el('h1.sk-h1.sk-results-title', { html: m.newRecord ? 'New record! 🏆' : `Great run, ${escapeHtml(nameOf(ctx, m.characterId))}! 🎉` })),
      card,
      optHost,
      hintsBar([hint('A', 'Enter', 'Choose')]));

    const celebrations = celebrationQueue(ctx, node, unlocks, { delay: 1.8 });
    const sync = () => {
      optHost.classList.toggle('sk-show', state.phase === 'choose');
      opts.sync(state.index);
    };
    const handle = (ev) => {
      if (celebrations.handle(ev)) return;
      if (ev.action === 'back') return;
      const res = phasedReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      sync();
      if (res.go) nav.resolve(res.go);
    };
    ctx.sfx(m.newRecord ? 'timing-record' : 'cheer');
    sync();
    return {
      node,
      cls: 'sk-mode-full sk-mode-results',
      handle,
      update(dt) {
        const before = state.phase;
        state = phasedTick(state, dt);
        if (before !== state.phase) sync();
        celebrations.update(dt);
      },
    };
  },
};
