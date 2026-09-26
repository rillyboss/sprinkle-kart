/**
 * Paint Shop 🎨 — give every racer's kart a new coat of paint. The choice is
 * per racer (whoever drives Rocco gets Rocco's paint, CPUs too) and is saved
 * in localStorage. "Original" keeps the racer's own colours.
 *
 * Pure helpers (DOM-free, unit tested):
 *   PAINTS                              the paint pots, in shop order
 *   getPaint(id)                        -> paint | null
 *   paintedDef(charDef, paintId)        -> a copy of the CharacterDef with the kart repainted
 *                                          (colors.kart + def.paint, which the shared kart
 *                                          base honours for every racer; see characters/model.js)
 *   paintStore(backend)                 -> { load(): {racerId: paintId}, save(map), set(racerId, paintId) }
 *   createPaintShopState({ racerIds, paints, racerId }) / paintShopReduce(state, ev)
 * Screen: src/ui/screens/paintShop.js. Races: main.js wraps buildKartModel.
 *
 * OWNER: showcase features & modes.
 */
import { jsonStore } from './storage.js';

export const PAINT_KEY = 'sprinkle-kart-paint-v1';
export const ORIGINAL = 'original';

const P = (id, name, emoji, color) => Object.freeze({ id, name, emoji, color });

/** Paint pots, in shop order. `color: null` = the racer's own colours. */
export const PAINTS = Object.freeze([
  P(ORIGINAL, 'Original', '🎨', null),
  P('bubblegum', 'Bubblegum Pink', '🩷', 0xff7ac8),
  P('strawberry', 'Strawberry Red', '🍓', 0xf2475a),
  P('peach', 'Peachy Orange', '🍑', 0xffa062),
  P('lemon', 'Lemon Yellow', '🍋', 0xffdf4a),
  P('mint', 'Minty Green', '🌿', 0x55d99c),
  P('sky', 'Sky Blue', '🩵', 0x62bdf5),
  P('grape', 'Grape Purple', '🍇', 0xa274f2),
  P('cocoa', 'Cocoa Brown', '🍫', 0x9a6644),
  P('snow', 'Snowy White', '⛄', 0xf6f7ff),
  P('midnight', 'Midnight Blue', '🌙', 0x34407e),
]);

const BY_ID = new Map(PAINTS.map((p) => [p.id, p]));
export const getPaint = (id) => BY_ID.get(id) ?? null;

/**
 * The CharacterDef with its kart repainted (the original is never touched).
 * Unknown / 'original' paint returns the def itself.
 */
export function paintedDef(def, paintId) {
  const paint = getPaint(paintId);
  if (!def || !paint || paint.color === null) return def;
  return { ...def, colors: { ...(def.colors || {}), kart: paint.color }, paint: paint.color, paintId: paint.id };
}

/** Saved paints: { racerId: paintId } (unknown paints / 'original' are dropped). */
export function paintStore(backend) {
  const store = backend === undefined ? jsonStore(PAINT_KEY) : jsonStore(PAINT_KEY, backend);
  const clean = (v) => {
    const out = {};
    const src = v && typeof v === 'object' && v.racers && typeof v.racers === 'object' ? v.racers : {};
    for (const [id, paint] of Object.entries(src)) if (typeof id === 'string' && getPaint(paint) && paint !== ORIGINAL) out[id] = paint;
    return out;
  };
  const api = {
    load: () => clean(store.read()),
    save: (map) => store.write({ racers: clean({ racers: map }) }),
    set(racerId, paintId) {
      const map = api.load();
      if (!getPaint(paintId) || paintId === ORIGINAL) delete map[racerId];
      else map[racerId] = paintId;
      api.save(map);
      return map;
    },
  };
  return api;
}

/** The paint a racer wears (from a loaded map). */
export const paintFor = (map, racerId) => (map && getPaint(map[racerId]) ? map[racerId] : ORIGINAL);

const wrap = (i, n) => ((i % n) + n) % n;
const out = (state, fx = [], go = null) => ({ state, fx, go });

/**
 * Paint Shop screen state: two rows — racers (row 0) and paints (row 1).
 * @param {{ racerIds: string[], paints?: Record<string,string>, racerId?: string|null, controllerId?: string|null }} o
 */
export function createPaintShopState({ racerIds = [], paints = {}, racerId = null, controllerId = null } = {}) {
  const ids = [...new Set(racerIds)];
  const racer = Math.max(0, ids.indexOf(racerId));
  const pick = {};
  for (const id of ids) pick[id] = paintFor(paints, id);
  return { racerIds: ids, racer, row: 0, pick, controllerId };
}

export const currentRacer = (s) => s.racerIds[s.racer] ?? null;
export const currentPaint = (s) => s.pick[currentRacer(s)] ?? ORIGINAL;
export const paintIndex = (s) => Math.max(0, PAINTS.findIndex((p) => p.id === currentPaint(s)));

/**
 * Left/Right: next racer (row 0) or next paint (row 1 — saved straight away,
 * `changed` tells the screen). Up/Down: switch rows. A on the racers row goes
 * down to the paints; A on the paints row is a happy "done" (back).
 * Y: back to Original. B: back.
 * Pointer: { action: 'set', key: 'racer' | 'paint', value: index }.
 * @returns {{ state, fx, go: 'back'|null, changed?: { racerId, paintId } }}
 */
export function paintShopReduce(s, ev) {
  if (s.controllerId && ev.deviceId !== s.controllerId && ev.deviceId !== 'mouse') return out(s);
  const n = s.racerIds.length;
  if (!n) return ev.action === 'back' ? out(s, ['back'], 'back') : out(s);
  const setPaint = (st, paintId, fx = ['move']) => {
    const racerId = currentRacer(st);
    if (st.pick[racerId] === paintId) return out(st);
    return { ...out({ ...st, row: 1, pick: { ...st.pick, [racerId]: paintId } }, fx), changed: { racerId, paintId } };
  };
  switch (ev.action) {
    case 'left': case 'right': {
      const d = ev.action === 'right' ? 1 : -1;
      if (s.row === 0) return out({ ...s, racer: wrap(s.racer + d, n) }, ['move']);
      return setPaint(s, PAINTS[wrap(paintIndex(s) + d, PAINTS.length)].id);
    }
    case 'up': return s.row === 0 ? out(s) : out({ ...s, row: 0 }, ['move']);
    case 'down': return s.row === 1 ? out(s) : out({ ...s, row: 1 }, ['move']);
    case 'confirm':
      if (s.row === 0) return out({ ...s, row: 1 }, ['confirm']);
      return out(s, ['confirm'], 'back');
    case 'start': return out(s, ['confirm'], 'back');
    case 'toggle': return setPaint(s, ORIGINAL, ['back']);
    case 'set':
      if (ev.key === 'racer' && ev.value >= 0 && ev.value < n) return out({ ...s, racer: ev.value, row: 0 }, ['move']);
      if (ev.key === 'paint' && ev.value >= 0 && ev.value < PAINTS.length) return setPaint(s, PAINTS[ev.value].id);
      return out(s);
    case 'back': return out(s, ['back'], 'back');
    default: return out(s);
  }
}
