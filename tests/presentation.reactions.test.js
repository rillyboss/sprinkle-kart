// Showcase presentation: character reactions (lines, bubble timing, overtake detection)
// and the character-reactions system wired to the bus.
import { describe, it, expect } from 'vitest';
import {
  REACTION_LINES, REACTION_PRIORITY, REACTION_VOICE, lineFor, shortName, createBubbleQueue, createPlaceTracker,
} from '../src/presentation/reactions.js';
import characterReactions, { createReactionState, createBubbleWidget } from '../src/systems/characterReactions.js';
import { createPrefsStore } from '../src/presentation/prefs.js';
import { CHARACTERS, getCharacter } from '../src/characters/index.js';
import { installSystems } from '../src/systems/index.js';
import { createFakeApp, fakeSession, runHeadlessSession } from './helpers/headlessSession.js';

const UNFRIENDLY = /\b(hit|hits|kill|killed|crash|crashed|destroy|destroyed|dead|die|hurt|stupid|loser|hate)\b/i;
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const memStore = (init = {}) => {
  const data = new Map();
  const s = createPrefsStore({ storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }, reducedMotion: false });
  s.set(init);
  return s;
};

describe('reaction lines', () => {
  it('every kind has friendly lines, a priority, and {name} only where a rival exists', () => {
    for (const [kind, lines] of Object.entries(REACTION_LINES)) {
      expect(lines.length, kind).toBeGreaterThan(1);
      expect(REACTION_PRIORITY[kind], kind).toBeGreaterThan(0);
      for (const l of lines) {
        expect(l, `${kind}: ${l}`).not.toMatch(UNFRIENDLY);
        expect(l.length).toBeLessThanOrEqual(34); // fits a bubble in 4-player split-screen
        if (l.includes('{name}')) expect(['overtake', 'overtaken', 'bonker']).toContain(kind);
      }
    }
    for (const kind of Object.keys(REACTION_VOICE)) expect(REACTION_LINES[kind]).toBeTruthy();
  });
  it('fills in the rival name', () => {
    expect(lineFor('overtake', null, seq(0.9, 0), { rival: 'Lenny' })).toBe('Beep beep, Lenny!');
    expect(lineFor('bonker', null, seq(0.9, 0))).toBe('Oopsie, friend!');
  });
  it('uses the racer’s own quotes for wins (mostly), bonks and the start', () => {
    const rocco = getCharacter('rocco');
    expect(lineFor('finish-win', rocco, seq(0.1))).toBe(rocco.quotes.win);
    expect(lineFor('finish-win', rocco, seq(0.9, 0))).toBe(REACTION_LINES['finish-win'][0]);
    expect(lineFor('bonked', rocco, seq(0.2))).toBe(rocco.quotes.oops);
    expect(lineFor('go', rocco, seq(0.2))).toBe(rocco.quotes.select);
    expect(lineFor('overtake', rocco, seq(0.1, 0.99))).toBe(REACTION_LINES.overtake.at(-1).replace('{name}', 'friend'));
  });
  it('every racer’s own quotes are friendly too', () => {
    for (const c of CHARACTERS) {
      for (const kind of ['finish-win', 'bonked', 'go']) expect(lineFor(kind, c, () => 0), `${c.id} ${kind}`).not.toMatch(UNFRIENDLY);
    }
  });
  it('unknown kinds give null', () => {
    expect(lineFor('nope', null)).toBe(null);
  });
  it('shortName drops titles and keeps it short', () => {
    expect(shortName({ id: 'rocco', name: 'Rocco Ravioli' })).toBe('Rocco');
    expect(shortName({ id: 'captain-crumbs', name: 'Captain Crumbs' })).toBe('Crumbs');
    expect(shortName({ id: 'peachy', name: 'Princess Peachy Pie' })).toBe('Peachy');
    expect(shortName({ id: 'puff', name: 'Puff the Sprinkle Dragon' })).toBe('Puff');
    expect(shortName({ id: 'cotton-candy-girl', name: 'Cotton Candy Girl' })).toBe('Cotton Candy');
    expect(shortName({ id: 'x', name: 'X', shortName: 'Xy' })).toBe('Xy');
    expect(shortName({ id: 'x', name: 'Princess' })).toBe('Princess');
    expect(shortName(null)).toBe('friend');
    expect(shortName({ id: 'y' })).toBe('friend');
    for (const c of CHARACTERS) expect(shortName(c).length, c.id).toBeLessThanOrEqual(12);
  });
});

describe('createBubbleQueue', () => {
  it('shows a line for its duration, then clears', () => {
    const q = createBubbleQueue({ cooldown: 3, duration: 2 });
    const b = q.offer('overtake', 'Zoom!', 10);
    expect(b).toMatchObject({ kind: 'overtake', text: 'Zoom!', at: 10, until: 12 });
    expect(q.current(11.9)).toBe(b);
    expect(q.update(12)).toBe(null);
    expect(q.current(12)).toBe(null);
  });
  it('low-priority chatter waits for the cooldown; important lines skip it', () => {
    const q = createBubbleQueue({ cooldown: 3, duration: 1 });
    q.offer('overtake', 'a', 0);
    expect(q.offer('overtake', 'b', 0.5)).toBe(null); // busy, same priority
    expect(q.offer('overtake', 'c', 2)).toBe(null); // free but cooling down
    expect(q.offer('overtake', 'd', 3.1)).toBeTruthy();
    expect(q.offer('bonked', 'Hmph!', 3.5)).toMatchObject({ text: 'Hmph!' }); // interrupts
    expect(q.offer('finish', 'Yay!', 3.6)).toMatchObject({ text: 'Yay!' });
    expect(q.offer('bonked', 'x', 3.7)).toBe(null); // lower than the finish on screen
    expect(q.offer('bonked', 'later', 5)).toBeTruthy(); // priority 2 ignores the cooldown once free
  });
  it('ignores empty text and bad clocks', () => {
    const q = createBubbleQueue();
    expect(q.offer('go', '', 1)).toBe(null);
    expect(q.offer('go', 'hi', NaN)).toBe(null);
    q.schedule('giggle', '', 1);
    q.schedule('giggle', 'x', NaN);
    expect(q.pending).toEqual([]);
  });
  it('scheduled follow-ups (the giggle after a pout) always get their moment, in time order', () => {
    const q = createBubbleQueue({ duration: 2 });
    q.offer('bonked', 'Hmph!', 0);
    q.schedule('giggle', 'hehe', 1.7);
    q.schedule('giggle', 'first', 1.0);
    expect(q.pending.map((p) => p.text)).toEqual(['first', 'hehe']);
    expect(q.update(1.2)).toMatchObject({ text: 'first' });
    expect(q.update(1.8)).toMatchObject({ text: 'hehe', kind: 'giggle' });
    expect(q.pending).toEqual([]);
    q.clear();
    expect(q.current(1.9)).toBe(null);
  });
  it('custom durations and priorities are honoured', () => {
    const q = createBubbleQueue({ duration: 1 });
    expect(q.offer('finish', 'Done', 0, { duration: 5 }).until).toBe(5);
    expect(q.offer('overtake', 'x', 1, { priority: 10 })).toBeTruthy();
  });
});

describe('createPlaceTracker', () => {
  it('reports a gained place only once it has held', () => {
    const t = createPlaceTracker({ hold: 0.5 });
    expect(t.update(5, 0)).toBe(null);
    expect(t.update(4, 1)).toBe(null);
    expect(t.update(4, 1.4)).toBe(null);
    expect(t.update(4, 1.5)).toBe('up');
    expect(t.place).toBe(4);
    expect(t.update(4, 3)).toBe(null);
  });
  it('side-by-side flip-flopping never counts', () => {
    const t = createPlaceTracker({ hold: 0.5 });
    t.update(3, 0);
    for (let i = 1; i < 40; i++) expect(t.update(i % 2 ? 2 : 3, i * 0.1)).toBe(null);
  });
  it('reports lost places, ignores junk and resets', () => {
    const t = createPlaceTracker({ hold: 0.2 });
    t.update(2, 0);
    t.update(4, 1);
    expect(t.update(4, 1.3)).toBe('down');
    expect(t.update(NaN, 2)).toBe(null);
    expect(t.update(3, undefined)).toBe(null);
    t.reset();
    expect(t.place).toBe(null);
    expect(t.update(1, 5)).toBe(null);
  });
});

/* ---------------- the system ---------------- */

function kart(id, pi, place, extra = {}) {
  return { characterId: id, charDef: getCharacter(id), playerIndex: pi, isCPU: pi === null, place, finished: false, ...extra };
}

function rig({ prefs = {}, rng = () => 0 } = {}) {
  const store = memStore(prefs);
  const app = createFakeApp({ prefs: store, rng, game: { state: 'race', errors: [] } });
  const uninstall = installSystems(app.bus, app, [characterReactions]);
  const me = kart('rocco', 0, 3);
  const cpuA = kart('lenny', null, 2);
  const cpuB = kart('muffin', null, 4);
  const race = {
    state: 'racing', clock: 5, lapsTotal: 3,
    karts: [cpuA, me, cpuB],
    getPlayerKart: (pi) => (pi === 0 ? me : null),
    getStandings: () => [...race.karts].sort((a, b) => a.place - b.place),
  };
  const session = { ...fakeSession(app, { humans: 1, race }), race };
  app.bus.emit('race-start', {}, session);
  const frame = (dt = 0.1) => { race.clock += dt; app.bus.emit('race-frame', dt, session); };
  const bubble = () => app.game.reactions()?.players.get(0)?.queue.current(app.game.reactions().clock) ?? null;
  return { app, store, me, cpuA, cpuB, race, session, frame, bubble, uninstall };
}

describe('character-reactions system', () => {
  it('registers a speech-bubble HUD widget and removes it on uninstall', () => {
    const r = rig();
    expect(r.app.hud.widgets.map((w) => w.id)).toContain('skx-speech-bubble');
    r.uninstall();
    expect(r.app.hud.widgets.map((w) => w.id)).not.toContain('skx-speech-bubble');
  });

  it('cheers (and says "yay") after a real overtake, naming the racer just passed', () => {
    const r = rig();
    r.frame();
    r.me.place = 2; r.cpuA.place = 3; // passed Lenny
    r.frame();
    expect(r.bubble()).toBe(null); // not held long enough yet
    for (let i = 0; i < 6; i++) r.frame();
    expect(r.bubble()).toMatchObject({ kind: 'overtake' });
    expect(r.bubble().text).toBe('Beep beep, Lenny!');
    expect(r.app.audio.calls.voice).toContainEqual(expect.objectContaining({ id: 'rocco', kind: 'yay' }));
  });

  it('pouts when bonked, then giggles 1.7 s later (with a giggle voice)', () => {
    const r = rig();
    r.app.bus.emit('race:bonked', { type: 'bonked', kart: r.me, by: r.cpuA, cause: 'gumdrop' }, r.session);
    expect(r.bubble()).toMatchObject({ kind: 'bonked' });
    expect(r.app.audio.calls.voice).toHaveLength(0); // the "oops" voice belongs to item reactions
    for (let i = 0; i < 18; i++) r.frame();
    expect(r.bubble()).toMatchObject({ kind: 'giggle' });
    expect(r.app.audio.calls.voice).toContainEqual(expect.objectContaining({ id: 'rocco', kind: 'select' }));
  });

  it('says sorry-ish when the human’s item bonks someone', () => {
    const r = rig();
    r.app.bus.emit('race:bonked', { type: 'bonked', kart: r.cpuB, by: r.me, cause: 'cupcake-rocket' }, r.session);
    expect(r.bubble()).toMatchObject({ kind: 'bonker', text: 'Oopsie, Muffin!' });
  });

  it('reacts to GO, stars, rainbow turbos, the final lap and the finish', () => {
    const r = rig();
    r.app.bus.emit('race:go', { type: 'go' }, r.session);
    expect(r.bubble()).toMatchObject({ kind: 'go' });
    const q = r.app.game.reactions().players.get(0).queue;
    const clear = () => { q.clear(); };
    clear();
    r.app.bus.emit('race:item-get', { type: 'item-get', kart: r.me, item: 'rainbow-star' }, r.session);
    expect(r.bubble()).toMatchObject({ kind: 'star' });
    clear();
    r.app.bus.emit('race:item-get', { type: 'item-get', kart: r.me, item: 'gumdrop' }, r.session);
    expect(r.bubble()).toBe(null);
    r.app.bus.emit('race:drift-boost', { type: 'drift-boost', kart: r.me, level: 2 }, r.session);
    expect(r.bubble()).toBe(null);
    r.app.bus.emit('race:drift-boost', { type: 'drift-boost', kart: r.me, level: 3 }, r.session);
    expect(r.bubble()).toMatchObject({ kind: 'rainbow-turbo' });
    clear();
    r.app.bus.emit('race:final-lap', { type: 'final-lap', kart: r.me }, r.session);
    expect(r.bubble()).toMatchObject({ kind: 'final-lap' });
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 1 }, r.session);
    expect(r.bubble()).toMatchObject({ kind: 'finish-win' });
    expect(r.bubble().until - r.bubble().at).toBeCloseTo(3.2);
  });

  it('podium and plain finishes get their own kinds', () => {
    const r = rig();
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 3 }, r.session);
    expect(r.bubble()).toMatchObject({ kind: 'podium' });
    const r2 = rig();
    r2.app.bus.emit('race:finish', { type: 'finish', kart: r2.me, place: 6 }, r2.session);
    expect(r2.bubble()).toMatchObject({ kind: 'finish' });
  });

  it('CPU karts never get bubbles', () => {
    const r = rig();
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.cpuA, place: 1 }, r.session);
    r.app.bus.emit('race:bonked', { type: 'bonked', kart: r.cpuA, by: r.cpuB }, r.session);
    expect([...r.app.game.reactions().players.keys()]).toEqual([]);
  });

  it('the "Racer chatter" pref silences everything, live', () => {
    const r = rig({ prefs: { bubbles: false } });
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 1 }, r.session);
    expect(r.bubble()).toBe(null);
    r.store.set({ bubbles: true });
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 1 }, r.session);
    expect(r.bubble()).toMatchObject({ kind: 'finish-win' });
  });

  it('rng gates the optional chatter', () => {
    const r = rig({ rng: () => 0.99 });
    r.app.bus.emit('race:go', { type: 'go' }, r.session); // 60% chance -> skipped
    expect(r.bubble()).toBe(null);
  });

  it('a paused race freezes the bubbles; race-exit clears the state', () => {
    const r = rig();
    r.app.bus.emit('race:go', { type: 'go' }, r.session);
    const b = r.bubble();
    for (let i = 0; i < 40; i++) r.app.bus.emit('race-frame', 0.1, { ...r.session, paused: true });
    expect(r.bubble()).toBe(b);
    r.app.bus.emit('race-exit', { outcome: 'menu' }, r.session);
    expect(r.app.game.reactions()).toBe(null);
  });

  it('survives a whole headless 4-player race with no handler errors', () => {
    const s = runHeadlessSession('gumdrop-meadow', { humans: 4, laps: 1, systems: [characterReactions] });
    expect(s.errors).toEqual([]);
    expect(s.summary).toBeTruthy();
  });
});

describe('bubble widget', () => {
  it('is a no-op without a DOM (node) and reads state safely', () => {
    const state = createReactionState();
    const w = createBubbleWidget(() => state).create({}, 0, {});
    expect(() => { w.update({}); w.destroy(); }).not.toThrow();
    expect(state.get(1)).toBe(state.get(1));
  });
});
