/**
 * HUD widgets for the showcase modes (anchor 'top-center', installed by
 * src/systems/showcaseHud.js). Both stay empty/hidden unless their mode's
 * controller publishes `race.modeInfo.battle` / `race.modeInfo.team`.
 *
 *   BATTLE_WIDGET   the battle clock, YOUR bubbles (big) and a strip of every
 *                   racer's bubbles (little dots; out = a sleepy 💤)
 *   TEAM_WIDGET     live team score "🍭 36 — 22 ⭐" with your team highlighted
 *
 * The "what to show" logic is pure (battleHudModel / teamHudModel, unit tested).
 * OWNER: showcase features & modes.
 */
import '../../modes/showcase.css';
import { teamInfo, HOME_TEAM, AWAY_TEAM } from '../../modes/team.js';

/** @returns {null | { clock, hurry, mine: {bubbles, max, out} | null, alive, total, strip: Array<{id, bubbles, max, out, me, human}> }} */
export function battleHudModel(kart, race) {
  const v = race?.modeInfo?.battle;
  if (!v) return null;
  const mineRow = v.racers.find((r) => r.id === kart?.id) ?? null;
  return {
    clock: v.clock,
    hurry: !!v.hurry,
    waiting: race?.state === 'countdown',
    mine: mineRow ? { bubbles: mineRow.bubbles, max: mineRow.max, out: mineRow.out } : null,
    alive: v.alive,
    total: v.total,
    strip: v.racers.map((r) => ({ id: r.id, bubbles: r.bubbles, max: r.max, out: r.out, me: r.id === kart?.id, human: !r.isCPU })),
  };
}

/** @returns {null | { mine: string, home: number, away: number, leader: string|null, sig: string }} */
export function teamHudModel(kart, race) {
  const v = race?.modeInfo?.team;
  if (!v) return null;
  const home = v.totals?.[HOME_TEAM] ?? 0;
  const away = v.totals?.[AWAY_TEAM] ?? 0;
  const mine = kart?.team ?? HOME_TEAM;
  return { mine, home, away, leader: v.leader ?? null, sig: `${mine}|${home}|${away}|${v.leader}` };
}

const canDom = () => typeof document !== 'undefined';
const noop = { update() {}, reset() {}, destroy() {} };

function mk(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  parent?.appendChild(n);
  return n;
}

export const BATTLE_WIDGET = {
  id: 'battle-hud',
  anchor: 'top-center',
  order: 5,
  create(node) {
    if (!canDom() || !node?.appendChild) return noop;
    const root = mk('div', 'skb-hud', node);
    root.hidden = true;
    const top = mk('div', 'skb-hud-top', root);
    mk('span', 'skb-hud-ico', top, '⏱️');
    const clock = mk('b', 'skb-hud-clock', top, '2:00');
    const mine = mk('div', 'skb-hud-mine', root);
    const strip = mk('div', 'skb-hud-strip', root);
    let cache = {};
    return {
      update(kart, race) {
        const m = battleHudModel(kart, race);
        root.hidden = !m;
        if (!m) return;
        if (cache.clock !== m.clock) { cache.clock = m.clock; clock.textContent = m.clock; }
        root.classList.toggle('skb-hurry', m.hurry);
        const mineSig = m.mine ? `${m.mine.bubbles}/${m.mine.max}/${m.mine.out}` : '';
        if (cache.mine !== mineSig) {
          const lost = cache.mineBubbles !== undefined && m.mine && m.mine.bubbles < cache.mineBubbles;
          cache.mine = mineSig;
          cache.mineBubbles = m.mine?.bubbles;
          mine.innerHTML = '';
          if (m.mine?.out) mk('span', 'skb-hud-out', mine, '💤 Out — cheer them on!');
          else if (m.mine) {
            for (let i = 0; i < m.mine.max; i++) mk('i', `skb-hud-bub${i < m.mine.bubbles ? '' : ' skb-gone'}`, mine);
          }
          if (lost) { mine.classList.remove('skb-shake'); void mine.offsetWidth; mine.classList.add('skb-shake'); }
        }
        const stripSig = m.strip.map((r) => `${r.bubbles}${r.me ? '*' : ''}`).join(',');
        if (cache.strip !== stripSig) {
          cache.strip = stripSig;
          strip.innerHTML = '';
          for (const r of m.strip) {
            const chip = mk('span', `skb-chip${r.out ? ' skb-chip-out' : ''}${r.me ? ' skb-chip-me' : ''}${r.human ? ' skb-chip-human' : ''}`, strip);
            if (r.out) chip.textContent = '💤';
            else for (let i = 0; i < r.bubbles; i++) mk('i', null, chip);
          }
        }
      },
      reset() { cache = {}; mine.innerHTML = ''; strip.innerHTML = ''; root.hidden = true; },
      destroy() { root.remove(); },
    };
  },
};

export const TEAM_WIDGET = {
  id: 'team-hud',
  anchor: 'top-center',
  order: 20,
  create(node) {
    if (!canDom() || !node?.appendChild) return noop;
    const root = mk('div', 'skt-hud', node);
    root.hidden = true;
    const home = mk('span', 'skt-hud-side skt-hud-home', root);
    mk('span', 'skt-hud-dash', root, '—');
    const away = mk('span', 'skt-hud-side skt-hud-away', root);
    let sig = null;
    return {
      update(kart, race) {
        const m = teamHudModel(kart, race);
        root.hidden = !m;
        if (!m || m.sig === sig) return;
        sig = m.sig;
        home.innerHTML = `${teamInfo(HOME_TEAM).emoji} <b>${m.home}</b>`;
        away.innerHTML = `<b>${m.away}</b> ${teamInfo(AWAY_TEAM).emoji}`;
        home.classList.toggle('skt-mine', m.mine === HOME_TEAM);
        away.classList.toggle('skt-mine', m.mine === AWAY_TEAM);
        home.classList.toggle('skt-lead', m.leader === HOME_TEAM);
        away.classList.toggle('skt-lead', m.leader === AWAY_TEAM);
      },
      reset() { sig = null; root.hidden = true; },
      destroy() { root.remove(); },
    };
  },
};
