/**
 * Tiny typed pub/sub for game-wide events.
 *
 *   import { bus } from './events.js';
 *   const off = bus.on('race-end', (summary, session) => { ... });
 *   bus.emit('race-end', summary, session);
 *   off();
 *
 * "Typed" = event names must be declared: the built-ins are in EVENTS below;
 * a module that emits its own event declares it once with
 * `bus.define('my-event', 'payload description')` in its own file (declare it
 * at import time, and prefer asking the architect to add shared events here so
 * a subscriber installed before the emitter never hits an undeclared name).
 * The 'race:*' namespace is open: every Race event is forwarded as
 * `race:<type>` with the Race event object (see ARCHITECTURE.md), so new Race
 * event types need no declaration here.
 *
 * Handlers run synchronously in subscription order. A handler that throws
 * is reported once (console.error by default) and never stops the others —
 * one buggy sound effect must not freeze a race.
 */

/** Built-in events: name → payload (arguments) description. */
export const EVENTS = Object.freeze({
  // --- app / flow -------------------------------------------------------------
  frame: '(dt, game) — every animation frame, menus and races alike',
  'menu-enter': '({ skipTitle, previous }) — the pre-race menus open',
  'race-start': '(info: RaceStartInfo, session) — a race was built, countdown begins',
  'race-frame': '(dt, session) — every frame while a race session is on screen (session.paused tells if paused)',
  'race-pause': '({ label }, session) — pause menu opened',
  'race-resume': '({ choice }, session) — pause menu closed (choice resume|restart|quit)',
  'race-end': '(summary: RaceSummary, session) — race complete, BEFORE the results screen; push unlocks into summary.unlocks',
  'race-exit': '({ outcome }, session) — session torn down (again|next-track|restart|menu)',
  'results-choice': '({ choice }, session) — player picked on the results screen',

  // --- Grand Prix (emitted by the modes workstream, consumed by progression) ---
  'gp-race-end': '(gp: GrandPrixResult, session) — a Grand Prix race finished; gp.standings = points so far (after race-end)',
  'gp-end': '(gp: GrandPrixResult, session) — all races of a cup done, BEFORE the GP standings screen; push unlocks into gp.unlocks',
});

/**
 * Payload of 'gp-race-end' and 'gp-end' (built with scoreGrandPrix() from
 * src/data/cups.js so both workstreams agree on it):
 *
 * @typedef {{
 *   cupId: string,
 *   raceIndex: number,                      // 0-based index of the race just run
 *   raceCount: number,                      // races in this cup (4)
 *   finished: boolean,                      // true for 'gp-end'
 *   races: object[],                        // RaceSummary of every race so far, in order
 *   standings: Array<{ characterId: string, playerIndex: number|null, isCPU: boolean,
 *                      points: number, place: number, racePoints: number[] }>,  // best first
 *   humanWinner: { playerIndex: number, characterId: string } | null,   // a human 1st on points
 *   bestHumanPlace: number | null,
 *   unlocks: Array<{ kind: 'character'|'track', id: string }>,          // collector (gp-end)
 * }} GrandPrixResult
 */

/**
 * @param {{ onError?: (err: unknown, name: string) => void }} [opts]
 */
export function createEventBus({ onError } = {}) {
  const known = new Map(Object.entries(EVENTS));
  const handlers = new Map(); // name -> fn[]
  const reported = new WeakSet();
  const report = onError || ((err, name) => console.error(`[events] handler for "${name}" threw:`, err));

  const isKnown = (name) => typeof name === 'string' && (known.has(name) || name.startsWith('race:'));
  const check = (name) => {
    if (!isKnown(name)) throw new Error(`[events] unknown event "${name}" — declare it with bus.define(name, description)`);
  };

  const bus = {
    /** Declare a custom event (idempotent). */
    define(name, description = '') {
      if (typeof name !== 'string' || !name) throw new Error('[events] event name must be a non-empty string');
      if (!known.has(name)) known.set(name, description);
      return name;
    },
    /** Is this a declared (or race:*) event name? */
    has: isKnown,
    /** All declared event names (race:* not listed). */
    names: () => [...known.keys()],
    /** Subscribe. Returns an unsubscribe function. */
    on(name, fn) {
      check(name);
      if (typeof fn !== 'function') throw new Error(`[events] handler for "${name}" must be a function`);
      let list = handlers.get(name);
      if (!list) handlers.set(name, (list = []));
      list.push(fn);
      return () => bus.off(name, fn);
    },
    /** Subscribe for one call only. */
    once(name, fn) {
      const off = bus.on(name, (...args) => { off(); fn(...args); });
      return off;
    },
    off(name, fn) {
      const list = handlers.get(name);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    /** Emit to every handler. Returns the number of handlers called. */
    emit(name, ...args) {
      check(name);
      const list = handlers.get(name);
      if (!list || !list.length) return 0;
      const snapshot = list.slice();
      for (const fn of snapshot) {
        try {
          fn(...args);
        } catch (err) {
          if (!reported.has(fn)) {
            reported.add(fn);
            try { report(err, name); } catch { /* ignore */ }
          }
        }
      }
      return snapshot.length;
    },
    /** Number of handlers for a name (handy in tests). */
    count: (name) => handlers.get(name)?.length ?? 0,
    /** Remove every handler (tests). */
    clear() { handlers.clear(); },
  };
  return bus;
}

/** The game-wide bus (main.js emits; systems in src/systems/ subscribe). */
export const bus = createEventBus();
