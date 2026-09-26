/**
 * "Daily Sprinkle" ☀️ — today's challenge card: the track, the goal, the
 * silly twist, the speed and your streak.
 *
 * Two ways in (one screen):
 *   - from the mode select button row (menuEntry where 'mode-select'): A picks
 *     the Daily Sprinkle mode and goes on to character select; B goes back.
 *   - in the flow (order 40, when draft.mode === 'daily', after character
 *     select): A finishes the menus with the Daily Sprinkle RaceSetup.
 * OWNER: showcase features & modes.
 */
import '../../modes/showcase.css';
import * as S from '../menuState.js';
import { SPEED_CLASSES } from '../../config.js';
import { el, escapeHtml, glyph, hint, floatiesLayer } from '../dom.js';
import { cssColor, lighten, trackOutlinePoints } from '../hudLogic.js';
import { dailyChallenge, dailyScreenReduce, currentStreak, doneToday } from '../../modes/daily.js';
import { dailyStore } from '../../modes/dailySession.js';
import { applyModeChoice } from '../../modes/flow.js';
import { todayString } from '../../progress/goals.js';
import { pc, hintsBar, backButton, trackArt } from './_shared.js';

/** The RaceSetup the Daily Sprinkle finishes the menus with. */
export function dailyRaceSetup(draft, challenge) {
  const picks = draft.charState ? S.charSelections(draft.charState) : [];
  return {
    players: draft.joinState.players.map((p) => ({
      playerIndex: p.playerIndex,
      deviceId: p.deviceId,
      characterId: picks.find((q) => q.playerIndex === p.playerIndex)?.characterId
        ?? draft.charPicks?.find((q) => q.playerIndex === p.playerIndex)?.characterId,
      easyDrive: p.easyDrive,
    })),
    trackId: challenge.trackId,
    // little racers with Kid-Assist never get a Zoomy day
    speedClass: challenge.speedClass === 'zoomy' && draft.joinState.players.some((p) => p.easyDrive) ? 'zippy' : challenge.speedClass,
    laps: null,
    mode: 'daily',
    daily: challenge,
  };
}

/** Today's challenge from the tracks this family may race. */
export function todaysChallenge(ctx, today = todayString()) {
  const ids = (ctx.tracks || []).filter((t) => !t.placeholder && !ctx.isTrackLocked?.(t)).map((t) => t.id);
  return dailyChallenge(today, ids);
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'daily',
  menuEntry: { label: 'Daily Sprinkle', emoji: '☀️', order: 20, where: 'mode-select' },
  flow: { order: 40, when: (ctx) => ctx?.draft?.mode === 'daily' },
  mount(ctx, nav, params = {}) {
    const d = ctx.draft;
    const entry = !!params.returnTo; // opened from the mode select buttons (not the flow)
    const today = todayString();
    const challenge = d.daily && d.daily.id === today && !entry ? d.daily : todaysChallenge(ctx, today);
    let store = null;
    try { store = dailyStore().load(); } catch { /* ignore */ }
    const streak = store ? currentStreak(store, today) : 0;
    const done = store ? doneToday(store, today) : false;
    const track = (ctx.tracks || []).find((t) => t.id === challenge.trackId) ?? null;
    const sc = SPEED_CLASSES[challenge.speedClass] ?? { name: challenge.speedClass, emoji: '' };
    const base = cssColor(track?.previewColor, '#ffd23f');
    const art = trackArt(track);
    const outline = track?.controlPoints ? trackOutlinePoints(track.controlPoints, 100, 60, 0.12) : '';
    const p1 = d.joinState?.players?.[0];
    const state = { controllerId: p1?.deviceId ?? null };

    const goBtn = el('button.sk-bigbtn.sk-race', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'confirm' }); },
      html: `<span>${entry ? "Let's do it!" : 'Race!'}</span> <span class="sk-flag">☀️</span> <span class="sk-go-k">${glyph('A')}</span>`,
    });
    const node = el('div.sk-screen.skd-daily', {},
      floatiesLayer(18, 71),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Daily Sprinkle <span class="sk-wiggle">☀️</span>' }),
        el('div.sk-chooser', { html: `<b class="sk-tag" style="--pc:${pc(0)}">P1</b> ${escapeHtml(formatDay(today))}` })),
      el('div.skd-card', {},
        el('div.skd-track', { '--c1': lighten(base, 0.55), '--c2': base,
          html: `<div class="skd-art">${outline ? `<svg viewBox="0 0 100 60" aria-hidden="true"><polygon points="${outline}"/></svg>` : ''}`
            + `<span class="a1">${art[0]}</span><span class="a2">${art[1]}</span><span class="a3">${art[2]}</span></div>`
            + `<div class="skd-track-name">${escapeHtml(track?.name ?? 'A surprise track')}</div>`
            + `<div class="skd-speed">${sc.emoji} ${escapeHtml(sc.name)}</div>` }),
        el('div.skd-info', {},
          el('div.skd-label', { html: "Today's goal" }),
          el('div.skd-goal', { html: `<span class="skd-goal-e">${challenge.goal.emoji}</span>${escapeHtml(challenge.goal.text)}` }),
          el('div.skd-label', { html: 'Silly twist' }),
          el('div.skd-twist', { html: `<span>${challenge.twist.emoji}</span> ${escapeHtml(challenge.twist.text)}` }),
          el('div.skd-status', {
            html: (done ? '<span class="skd-done">✔ Done today! Play again just for fun</span>' : '<span class="skd-new">✨ A brand new challenge!</span>')
              + (streak > 0 ? `<span class="skd-streak">🔥 ${streak} day${streak === 1 ? '' : 's'} in a row</span>` : ''),
          }))),
      el('div.sk-gorow', {}, goBtn),
      hintsBar([hint('A', 'Enter', entry ? "Let's go" : 'Race!'), hint('B', 'Esc', 'Back')]),
    );

    const handle = (ev) => {
      const res = dailyScreenReduce(state, ev);
      ctx.fx(res);
      if (res.go === 'go') {
        if (entry) {
          applyModeChoice(d, 'daily');
          d.daily = challenge;
          d.trackPrev = { ...(d.trackPrev || {}), speedClass: challenge.speedClass };
          nav.goto('character-select');
        } else {
          nav.finish(dailyRaceSetup(d, challenge));
        }
      } else if (res.go === 'back') {
        if (entry) nav.goto(params.returnTo);
        else nav.back();
      }
    };
    return { node, cls: 'sk-mode-full', handle };
  },
};

function formatDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
}
