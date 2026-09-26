/**
 * Team Race results: the big team scoreboard (Team Sprinkle vs Team Sparkle),
 * every racer's place and points, and the running series score.
 * Opened by the team controller with menus.open('team-results', { summary, team, trackDef, unlocks }).
 * Resolves 'again' | 'next-track' | 'menu'. OWNER: showcase features & modes.
 */
import '../../modes/showcase.css';
import { el, escapeHtml, hint, floatiesLayer, confettiLayer } from '../dom.js';
import { createPhasedState, phasedTick, phasedReduce } from '../../modes/menus.js';
import { teamResultModel, TEAM_OPTIONS } from '../../modes/showcaseResults.js';
import { hintsBar } from './_shared.js';
import { portraitFor, nameOf, playerTag, celebrationQueue, optionButtons } from './_modes.js';

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'team-results',
  mount(ctx, nav, params = {}) {
    const { trackDef = null, unlocks = [], options = TEAM_OPTIONS } = params;
    const team = params.team ?? params.summary?.team ?? null;
    const m = teamResultModel(team);

    const sideEl = (s, i) => el(`div.skt-side.skt-side-${s.id}${s.winner ? '.skt-side-win' : ''}`, { '--tc': s.color, '--i': i },
      el('div.skt-side-head', { html: `<span class="skt-emoji">${s.emoji}</span><span class="skt-team">${escapeHtml(s.name)}</span>${s.winner ? '<span class="skt-crown">👑</span>' : ''}` }),
      el('div.skt-total', { html: `<b class="skt-count" data-to="${s.total}">0</b><small>points</small>` }),
      el('div.skt-members', {}, s.members.map((r, k) => el(`div.skt-member${r.isCPU ? '' : '.skt-member-human'}`, {
        '--k': k,
        html: `<span class="skt-place">${r.medal || r.place}</span>${portraitFor(ctx, r.characterId, 'skt-portrait')}`
          + `<span class="skt-name">${playerTag(r)}${escapeHtml(nameOf(ctx, r.characterId))}</span><span class="skt-pts">+${r.points}</span>`,
      }))));

    let state = createPhasedState(options.map((o) => o[0]), { introTime: 1.6 });
    const opts = optionButtons(options, (i) => handle({ deviceId: 'mouse', action: 'select', index: i }));
    const optHost = el('div.sk-gp-opts', {}, opts.node);
    const counters = [];

    const board = el('div.skt-board', {}, sideEl(m.sides[0], 0), el('div.skt-vs', { html: 'VS' }), sideEl(m.sides[1], 1));
    board.querySelectorAll?.('.skt-count').forEach((n) => counters.push({ n, to: Number(n.dataset.to) || 0 }));

    const node = el('div.sk-screen.skt-results', {},
      floatiesLayer(16, 67),
      m.won ? confettiLayer(90, 17) : null,
      el('div.sk-results-head', {},
        el('div.sk-gp-kicker', { html: `🤝 Team Race${trackDef?.name ? ` · ${escapeHtml(trackDef.name)}` : ''}` }),
        el('h1.sk-h1.sk-results-title', { html: escapeHtml(m.title) }),
        m.sub ? el('div.skb-sub', { html: escapeHtml(m.sub) }) : null),
      board,
      optHost,
      hintsBar([hint('A', 'Enter', 'Choose')]));

    const celebrations = celebrationQueue(ctx, node, unlocks, { delay: 2.2 });
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
    ctx.sfx(m.won ? 'team-cheer' : 'cheer');
    sync();
    let t = 0;
    return {
      node,
      cls: 'sk-mode-full sk-mode-results',
      handle,
      update(dt) {
        t += dt;
        const f = Math.min(1, t / 1.3);
        for (const c of counters) c.n.textContent = String(Math.round(c.to * (1 - (1 - f) ** 3)));
        const before = state.phase;
        state = phasedTick(state, dt);
        if (before !== state.phase) sync();
        celebrations.update(dt);
      },
    };
  },
};
