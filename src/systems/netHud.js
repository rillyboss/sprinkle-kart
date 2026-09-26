/**
 * Online HUD bits (NETWORKING.md §9.1, §10.4, §13.1). Only does anything in an online race (the session
 * carries `session.net`); offline races never see it.
 *
 *   - "Finish! ✨": a guest's own kart crossed the line on its predicted timeline but the host has not
 *     confirmed the finish yet. The built-in finish banner and place ("1st!") wait for the host's `finish`
 *     (the replica only marks a kart finished from host data), so a kid never sees "1st" turn into "2nd".
 *   - Snack break banner while "Pause everyone" freezes the race (guests: "Snack break at the host's
 *     house 🍪", host: "Everyone is on a snack break 🍪").
 *   - 🤖 Robo Driver flashes when the host hands one of THIS machine's karts to Robo Driver (and back).
 *   - A gentle line when a connection gets wobbly, and "Keep this tab open, you're the host! 🏁" when the
 *     host comes back to a hidden tab.
 *
 * The live place itself needs nothing here: on a guest the ReplicaRace sets every kart's `place` from the
 * host's newest snapshot, and the built-in badge shows it.
 *
 * session.net (set by main.js for online races): { role: 'host'|'guest', paused, wobbly, hostHidden }.
 * OWNER: WS7 (online game integration).
 */
const TEXT = Object.freeze({
  finishWait: 'Finish! ✨',
  snackGuest: "Snack break at the host's house 🍪",
  snackHost: 'Everyone is on a snack break 🍪',
  robo: '🤖 Robo Driver has the wheel!',
  roboBack: 'You have the wheel again! 🏎️',
  wobbly: 'A friend\'s connection is a bit wobbly… 📶',
  keepTab: "Keep this tab open, you're the host! 🏁",
});
export const NET_HUD_TEXT = TEXT;

/**
 * What the net HUD shows for one player's kart (pure).
 * @param {{ kart: object, race: object, net: object|null }} o
 * @returns {{ finishHold: boolean, banner: string|null }}
 */
export function netHudModel({ kart, race, net }) {
  if (!net || !kart) return { finishHold: false, banner: null };
  const L = race?.path?.length;
  const total = race?.lapsTotal ?? 0;
  const predicted = typeof race?.isPredicted === 'function' && race.isPredicted(kart.id);
  const crossed = predicted && Number.isFinite(L) && L > 0 && total > 0 && kart.distance >= total * L;
  const finishHold = !!(crossed && !kart.finished && race?.state === 'racing');
  let banner = null;
  if (net.paused) banner = net.role === 'host' ? TEXT.snackHost : TEXT.snackGuest;
  return { finishHold, banner };
}

const canDom = () => typeof document !== 'undefined';

function makeWidget(getNet) {
  return {
    id: 'net-hud',
    anchor: 'callout',
    order: 5,
    create(node) {
      if (!canDom() || !node?.appendChild) return { update() {}, reset() {}, destroy() {} };
      const box = document.createElement('div');
      box.className = 'sk-net-hud';
      box.style.cssText = 'display:none;padding:0.35em 0.9em;border-radius:1em;background:rgba(255,255,255,0.88);'
        + 'color:#8a3f9e;font-weight:800;font-size:1.6em;box-shadow:0 0.15em 0.4em rgba(120,40,140,0.25);text-align:center;';
      node.appendChild(box);
      let shown = '';
      return {
        update(kart, race) {
          const m = netHudModel({ kart, race, net: getNet() });
          const text = m.banner ?? (m.finishHold ? TEXT.finishWait : '');
          if (text === shown) return;
          shown = text;
          box.textContent = text;
          box.style.display = text ? 'block' : 'none';
        },
        reset() { shown = ''; box.textContent = ''; box.style.display = 'none'; },
        destroy() { box.remove(); },
      };
    },
  };
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'net-hud',
  order: 17,
  install(bus, app) {
    let session = null;
    let lastWobbly = false;
    let lastHidden = false;
    const getNet = () => session?.net ?? null;
    const removeWidget = typeof app?.hud?.addWidget === 'function' ? app.hud.addWidget(makeWidget(getNet)) : null;
    const flashAll = (text) => {
      for (const pi of session?.playerIndices ?? []) { try { app.hud?.flash?.(pi, text); } catch { /* ignore */ } }
    };
    const offs = [
      bus.on('race-start', (info, s) => { session = s ?? null; lastWobbly = false; lastHidden = false; }),
      bus.on('race-frame', (dt, s) => {
        session = s ?? session;
        const net = getNet();
        if (!net) return;
        if (net.wobbly && !lastWobbly) flashAll(TEXT.wobbly);
        lastWobbly = !!net.wobbly;
        if (lastHidden && !net.hostHidden && net.role === 'host') flashAll(TEXT.keepTab);
        lastHidden = !!net.hostHidden;
      }),
      // replicated from the host (guests): one of OUR karts got Robo Driver, or got it back
      bus.on('race:robo', (e, s) => {
        if (!s?.net || !e?.kart || !s.isHuman?.(e.kart)) return;
        s.flash?.(e.kart, e.on ? TEXT.robo : TEXT.roboBack);
      }),
      bus.on('race-exit', () => { session = null; }),
    ];
    return () => { offs.forEach((off) => off()); removeWidget?.(); };
  },
};
