/**
 * "Who's playing?" — every device presses A to join (P1..P4), Y toggles the
 * driving helper per player, B leaves. Flow order 20.
 */
import * as S from '../menuState.js';
import { el, escapeHtml, glyph, kbd, hint, floatiesLayer } from '../dom.js';
import { prettyDeviceName, deviceIcon, keyHintsFor } from '../hudLogic.js';
import { pc, hintsBar, backButton, shake, JOIN_UNPLUG_DROP } from './_shared.js';

/**
 * Label of the per-player driving helper toggle. OWNER: driving-feel
 * workstream may rename it to Kid-Assist here (the only place it is shown).
 */
export const ASSIST_LABEL = { name: 'Magic Steering', emoji: '✨' };

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'join',
  flow: { order: 20 },
  mount(ctx, nav) {
    const d = ctx.draft;
    const slotEls = [];
    const sigs = [];
    const slots = el('div.sk-slots');
    for (let i = 0; i < 4; i++) {
      const s = el('div.sk-slot', {
        '--pc': pc(i),
        onclick: (e) => joinClick(i, e.target.closest('[data-act]')?.dataset.act),
      });
      slotEls.push(s);
      slots.appendChild(s);
    }
    const goBtn = el('button.sk-bigbtn.sk-go', {
      onclick: (e) => {
        e.stopPropagation();
        let st = d.joinState;
        if (!st.players.length) st = S.joinReduce(st, { deviceId: 'kb1', action: 'confirm' }).state;
        d.joinState = st;
        handle({ deviceId: st.players[0].deviceId, action: 'start' });
      },
    });
    const node = el('div.sk-screen.sk-join',
      {},
      floatiesLayer(24, 5),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: '__nobody', action: 'back', force: true })),
        el('h1.sk-h1', { html: 'Who\'s playing? <span class="sk-wiggle">🎈</span>' })),
      el('p.sk-lead', { html: `Everyone press ${glyph('A')} or ${kbd('Enter')} to hop in!` }),
      slots,
      goBtn,
      hintsBar([
        hint('A', 'Enter', 'Join'),
        hint('Y', 'Tab', `${ASSIST_LABEL.name} ${ASSIST_LABEL.emoji}`),
        hint('B', 'Esc', 'Leave'),
      ]),
    );

    let devTimer = 0;
    const unpluggedFor = new Map(); // deviceId -> seconds unplugged
    const sync = (force = false) => {
      const devices = ctx.devices();
      const { players } = d.joinState;
      for (let i = 0; i < 4; i++) {
        const p = players[i];
        let html;
        let sig;
        if (p) {
          const dev = devices.find((x) => x.id === p.deviceId) ?? { id: p.deviceId, type: /^kb/.test(p.deviceId) ? 'keyboard' : 'gamepad' };
          const unplugged = dev.connected === false;
          const kh = keyHintsFor(p.deviceId);
          const key = (letter, name) => (kh ? kbd(kh[name]) : glyph(letter));
          sig = `${p.deviceId}|${p.easyDrive}|${dev.name}|${unplugged}`;
          html = `<div class="sk-slot-tag">P${i + 1}</div>`
            + `<div class="sk-slot-icon">${deviceIcon(p.deviceId, devices)}</div>`
            + `<div class="sk-slot-name">${escapeHtml(prettyDeviceName(dev))}</div>`
            + (unplugged ? '<div class="sk-slot-warn">💤 unplugged — leaving soon</div>' : '<div class="sk-slot-ready">Ready to roll!</div>')
            + `<button class="sk-easy ${p.easyDrive ? 'on' : ''}" data-act="toggle">`
            + `<span class="sk-easy-emoji">${ASSIST_LABEL.emoji}</span><span class="sk-easy-t">${escapeHtml(ASSIST_LABEL.name)}<b>${p.easyDrive ? 'ON' : 'OFF'}</b></span>`
            + `<span class="sk-easy-k">${key('Y', 'toggle')}</span></button>`
            + `<button class="sk-slot-leave" data-act="leave">${key('B', 'back')} leave</button>`;
        } else {
          sig = 'empty';
          html = '<div class="sk-slot-plus">+</div>'
            + `<div class="sk-slot-join">Press ${glyph('A')} to join!</div>`
            + `<div class="sk-slot-keys">🎮 ${glyph('A')} &nbsp;·&nbsp; ⌨️ ${kbd('Enter')} or ${kbd('/')}</div>`;
        }
        if (force || sigs[i] !== sig) {
          const wasEmpty = sigs[i] === 'empty' || sigs[i] === undefined;
          sigs[i] = sig;
          slotEls[i].innerHTML = html;
          slotEls[i].classList.toggle('sk-slot-on', !!p);
          if (p && wasEmpty) { slotEls[i].classList.remove('sk-pop'); void slotEls[i].offsetWidth; slotEls[i].classList.add('sk-pop'); }
        }
      }
      const n = players.length;
      goBtn.classList.toggle('sk-disabled', n === 0);
      goBtn.innerHTML = n === 0
        ? '<span>Waiting for racers…</span>'
        : `<span>Let's go!</span> <span class="sk-go-k">P1 ${glyph('A')}</span>`;
    };

    const handle = (ev) => {
      if (ev.force && ev.action === 'back') {
        ctx.sfx('back');
        nav.back();
        return;
      }
      const res = S.joinReduce(d.joinState, ev);
      d.joinState = res.state;
      ctx.fx(res);
      if (res.shake != null) shake(slotEls[res.shake]);
      sync();
      if (res.go === 'next') nav.next();
      else if (res.go === 'back') nav.back();
    };

    function joinClick(slot, act) {
      const p = d.joinState.players[slot];
      if (p) {
        if (act === 'toggle') handle({ deviceId: p.deviceId, action: 'toggle' });
        else if (act === 'leave') handle({ deviceId: p.deviceId, action: 'back' });
        return;
      }
      const free = ['kb1', 'kb2'].find((id) => !d.joinState.players.some((q) => q.deviceId === id));
      if (free) handle({ deviceId: free, action: 'confirm' });
    }

    sync(true);
    return {
      node,
      cls: 'sk-mode-full',
      handle,
      update: (dt) => {
        devTimer -= dt;
        if (devTimer <= 0) { devTimer = 0.5; sync(); }
        // A joined controller that stays unplugged for a few seconds leaves by
        // itself, so nobody needs a mouse to clear a flat-battery pad.
        const devices = ctx.devices();
        for (const p of [...d.joinState.players]) {
          const dev = devices.find((x) => x.id === p.deviceId);
          const off = dev?.connected === false;
          const t = off ? (unpluggedFor.get(p.deviceId) ?? 0) + dt : 0;
          if (off) unpluggedFor.set(p.deviceId, t); else unpluggedFor.delete(p.deviceId);
          if (t >= JOIN_UNPLUG_DROP) {
            unpluggedFor.delete(p.deviceId);
            handle({ deviceId: p.deviceId, action: 'back' });
          }
        }
      },
      refresh: () => sync(true),
    };
  },
};
