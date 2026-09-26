/**
 * Character reactions: speech bubbles (and a few extra voice giggles) for the
 * human racers — a cheer when they overtake someone, a pout-then-giggle when
 * they get bonked, "Boop! Sorry, Lenny!" when their item lands, star power,
 * rainbow turbos, the final lap and the finish. OWNER: showcase presentation.
 *
 * Lines + timing rules are pure (src/presentation/reactions.js); this file
 * wires them to the bus and draws one bubble per player viewport, next to the
 * place badge (a HUD widget). The "Racer chatter" pref switches it off.
 */
import '../presentation/presentation.css';
import { prefs as sharedPrefs, effectivePrefs } from '../presentation/prefs.js';
import {
  lineFor, shortName, createBubbleQueue, createPlaceTracker, REACTION_VOICE,
} from '../presentation/reactions.js';

const SHAPES = ['♥', '★', '◆', '●'];
const canDom = () => typeof document !== 'undefined';

/**
 * The reaction state for one race: a bubble queue + place tracker per human.
 * Exposed for tests and the HUD widget.
 */
export function createReactionState({ rng = Math.random } = {}) {
  const players = new Map(); // playerIndex -> { queue, tracker }
  const get = (pi) => {
    let p = players.get(pi);
    if (!p) {
      p = { queue: createBubbleQueue(), tracker: createPlaceTracker() };
      players.set(pi, p);
    }
    return p;
  };
  return { players, get, rng, clock: 0 };
}

/** HUD widget drawing player `pi`'s bubble from the shared reaction state. */
export function createBubbleWidget(getState) {
  return {
    id: 'skx-speech-bubble',
    create(node, playerIndex, vpNode) {
      if (!canDom() || !vpNode?.appendChild) return { update() {}, destroy() {} };
      const wrap = document.createElement('div');
      wrap.className = 'skx-bubble-wrap';
      const bubble = document.createElement('div');
      bubble.className = 'skx-bubble';
      wrap.appendChild(bubble);
      vpNode.appendChild(wrap);
      let shownId = null;
      return {
        update(kart) {
          const st = getState();
          const cur = st?.enabled ? st.players.get(playerIndex)?.queue.current(st.clock) : null;
          const id = cur ? cur.id : null;
          if (id === shownId) return;
          shownId = id;
          if (!cur) { wrap.classList.remove('skx-on'); return; }
          const shape = SHAPES[playerIndex] ?? '';
          bubble.className = `skx-bubble skx-k-${cur.kind}`;
          bubble.innerHTML = '';
          const s = document.createElement('span');
          s.className = 'skx-shape';
          s.textContent = shape;
          const t = document.createElement('span');
          t.className = 'skx-bubble-t';
          t.textContent = cur.text;
          bubble.append(s, t);
          wrap.classList.remove('skx-on');
          void wrap.offsetWidth; // restart the pop-in
          wrap.classList.add('skx-on');
          if (kart?.characterId) wrap.dataset.char = kart.characterId;
        },
        reset() { shownId = null; wrap.classList.remove('skx-on'); },
        destroy() { wrap.remove(); },
      };
    },
  };
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'character-reactions',
  order: 70,
  install(bus, app) {
    const store = app.prefs ?? sharedPrefs;
    let state = null;
    const enabled = () => effectivePrefs(store.get()).bubbles;
    const rng = app.rng ?? Math.random;

    const say = (s, kart, kind, { rival = null, chance = 1, voice = true } = {}) => {
      if (!state?.enabled || !s?.isHuman?.(kart) || rng() > chance) return null;
      const def = kart.charDef ?? null;
      const text = lineFor(kind, def, rng, { rival: rival ? shortName(rival.charDef ?? rival) : 'friend' });
      const shown = state.get(kart.playerIndex).queue.offer(kind, text, state.clock);
      if (shown && voice && REACTION_VOICE[kind]) s.voice(kart, REACTION_VOICE[kind]);
      return shown;
    };
    const standingsOf = (s) => { try { return s.race?.getStandings?.() ?? []; } catch { return []; } };

    let removeWidget = null;
    try { removeWidget = app.hud?.addWidget?.(createBubbleWidget(() => state)) ?? null; } catch (err) { console.warn('[reactions] widget', err); }
    if (app.game) app.game.reactions = () => state;

    const offs = [
      bus.on('race-start', () => {
        state = createReactionState({ rng });
        state.enabled = enabled();
      }),
      bus.on('race-frame', (dt, s) => {
        if (!state || s?.paused) return;
        const race = s.race;
        state.clock = Number.isFinite(race?.clock) ? race.clock : state.clock + (dt || 0);
        for (const [, p] of state.players) p.queue.update(state.clock);
        if (!state.enabled || race?.state !== 'racing') return;
        for (const h of s.humans ?? []) {
          const kart = race.getPlayerKart?.(h.playerIndex);
          if (!kart || kart.finished) continue;
          const dir = state.get(h.playerIndex).tracker.update(kart.place, state.clock);
          if (!dir) continue;
          const st = standingsOf(s);
          const at = st.indexOf(kart);
          if (dir === 'up') {
            const passed = at >= 0 ? st[at + 1] ?? null : null; // the kart right behind now
            say(s, kart, 'overtake', { rival: passed, chance: 0.8 });
          } else {
            const ahead = at > 0 ? st[at - 1] : null; // who went by
            say(s, kart, 'overtaken', { rival: ahead, chance: 0.4, voice: false });
          }
        }
      }),
      bus.on('race:go', (e, s) => {
        if (!state?.enabled) return;
        for (const h of s.humans ?? []) {
          const kart = s.race?.getPlayerKart?.(h.playerIndex);
          if (kart) say(s, kart, 'go', { chance: 0.6, voice: false });
        }
      }),
      bus.on('race:bonked', (e, s) => {
        if (!state?.enabled) return;
        const k = e.kart;
        if (s.isHuman(k)) {
          const shown = say(s, k, 'bonked', { voice: false }); // item reactions already say "oops"
          if (shown) {
            const giggle = lineFor('giggle', k.charDef, rng);
            state.get(k.playerIndex).queue.schedule('giggle', giggle, state.clock + 1.7);
            state.get(k.playerIndex).giggleVoiceAt = state.clock + 1.7;
          }
        }
        if (e.by && e.by !== k && s.isHuman(e.by)) say(s, e.by, 'bonker', { rival: k, chance: 0.85 });
      }),
      bus.on('race-frame', (dt, s) => {
        // the giggle's voice plays when its bubble appears
        if (!state?.enabled || s?.paused) return;
        for (const [pi, p] of state.players) {
          if (p.giggleVoiceAt != null && state.clock >= p.giggleVoiceAt) {
            p.giggleVoiceAt = null;
            const kart = s.race?.getPlayerKart?.(pi);
            if (kart) s.voice(kart, 'select');
          }
        }
      }),
      bus.on('race:item-get', (e, s) => { if (e.item === 'rainbow-star') say(s, e.kart, 'star', { voice: false }); }),
      bus.on('race:drift-boost', (e, s) => { if (e.level >= 3) say(s, e.kart, 'rainbow-turbo', { chance: 0.6, voice: false }); }),
      bus.on('race:final-lap', (e, s) => say(s, e.kart, 'final-lap', { chance: 0.7, voice: false })),
      bus.on('race:finish', (e, s) => {
        const kind = e.place === 1 ? 'finish-win' : e.place <= 3 ? 'podium' : 'finish';
        // finishing voices come from race-flow reactions; the bubble lingers a little longer
        if (!state?.enabled || !s.isHuman(e.kart)) return;
        const text = lineFor(kind, e.kart.charDef, rng);
        state.get(e.kart.playerIndex).queue.offer(kind, text, state.clock, { duration: 3.2 });
      }),
      bus.on('race-exit', () => { state = null; }),
      store.subscribe(() => { if (state) state.enabled = enabled(); }),
    ];
    return () => {
      offs.forEach((off) => off());
      try { removeWidget?.(); } catch { /* ignore */ }
      state = null;
    };
  },
};
