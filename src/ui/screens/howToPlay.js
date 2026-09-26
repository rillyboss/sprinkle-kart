/**
 * "How to Play" 🎓 — reached from the title screen's menu row. Shows the 6
 * driving tricks with the buttons for the controller that is looking at it,
 * then starts a calm practice race where a coach bubble teaches them one at
 * a time (src/modes/tutorial.js + tutorialSession.js).
 * A / Start = practice race, B = back.
 * OWNER: showcase features & modes.
 */
import '../../modes/showcase.css';
import { el, escapeHtml, glyph, hint } from '../dom.js';
import { tutorialCards, tutorialSetup, pickTutorialRacer } from '../../modes/tutorial.js';
import { backButton, hintsBar } from './_shared.js';

/** The device a menu event came from ('mouse' clicks use the WASD keyboard's names). */
const deviceOf = (ctx, deviceId) => {
  const id = !deviceId || deviceId === 'mouse' ? 'kb1' : deviceId;
  try { return ctx.devices().find((d) => d.id === id) ?? id; } catch { return id; }
};

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'how-to-play',
  menuEntry: { label: 'How to Play', emoji: '🎓', order: 50 },
  mount(ctx, nav, params = {}) {
    const d = ctx.draft;
    let deviceId = d.joinState?.players?.[0]?.deviceId ?? 'kb1';
    const leave = () => { ctx.sfx?.('back'); nav.goto(params.returnTo ?? 'title'); };

    const grid = el('div.skh-steps');
    const render = () => {
      grid.innerHTML = tutorialCards(deviceOf(ctx, deviceId)).map((c, i) => `<div class="skh-step" style="--i:${i}"><span class="skh-step-n">${c.n}</span>`
        + `<span class="skh-step-e">${c.emoji}</span><span class="skh-step-t">${escapeHtml(c.text)}`
        + `${c.key ? `<span class="skh-step-k">${escapeHtml(c.key)}</span>` : ''}</span></div>`).join('');
    };

    const start = (devId) => {
      const dev = !devId || devId === 'mouse' ? deviceId : devId;
      const tracks = ctx.tracks.filter((t) => !t.placeholder && !ctx.isTrackLocked(t)).map((t) => t.id);
      const preferred = d.previous?.players?.[0]?.characterId ?? d.charPicks?.[0]?.characterId ?? null;
      const characterId = pickTutorialRacer(ctx.characters, (c) => ctx.isLocked(c), preferred);
      ctx.sfx?.('confirm');
      nav.finish(tutorialSetup({ deviceId: dev, characterId }, tracks.length ? tracks : ctx.tracks.map((t) => t.id)));
    };

    const goBtn = el('button.sk-bigbtn.sk-race.skh-go.sk-sel', {
      onclick: (e) => { e.stopPropagation(); start('mouse'); },
      html: `<span>Practice race!</span> <span class="sk-flag">🏁</span> <span class="sk-go-k">${glyph('A')}</span>`,
    });

    const node = el('div.sk-screen.skh-screen', {},
      el('div.sk-header', {},
        backButton(() => leave()),
        el('h1.sk-h1', { html: 'How to Play <span class="sk-wiggle">🎓</span>' }),
        el('div.sk-chooser', { html: 'No racers to bump into — just practice!' })),
      el('p.skh-lead', { html: 'Learn these 6 tricks in a little practice race. A friendly coach shows you what to try next! ✨' }),
      grid,
      goBtn,
      hintsBar([hint('A', 'Enter', 'Practice race!'), hint('B', 'Esc', 'Back')]),
    );

    const handle = (ev) => {
      if (ev.deviceId && ev.deviceId !== 'mouse' && ev.deviceId !== deviceId) { deviceId = ev.deviceId; render(); }
      if (ev.action === 'confirm' || ev.action === 'start') start(ev.deviceId);
      else if (ev.action === 'back') leave();
    };

    render();
    return { node, cls: 'sk-mode-full', handle };
  },
};
