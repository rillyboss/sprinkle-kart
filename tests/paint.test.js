import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  PAINTS, ORIGINAL, PAINT_KEY, getPaint, paintedDef, paintStore, paintFor,
  createPaintShopState, paintShopReduce, currentRacer, currentPaint, paintIndex,
} from '../src/modes/paint.js';
import { memoryBackend } from '../src/modes/storage.js';
import { buildKartModel } from '../src/characters/model.js';
import { getCharacter, CHARACTERS } from '../src/data/characters.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { menuEntries } from '../src/ui/screenFlow.js';

const BAD_WORDS = /\b(hit|kill|crash|destroy|die|dead|blood|fight)\b/i;
const ev = (action, extra = {}) => ({ deviceId: 'kb1', action, ...extra });
const run = (s, ...events) => events.reduce((st, e) => paintShopReduce(st, typeof e === 'string' ? ev(e) : e).state, s);

/** Does the model use colour `hex` anywhere (material colours or baked vertex colours; linear or sRGB)? */
function usesColor(model, hex) {
  const lin = new THREE.Color(hex);
  const srgb = { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 };
  const near = (r, g, b) => [lin, srgb].some((t) => Math.abs(t.r - r) < 0.01 && Math.abs(t.g - g) < 0.01 && Math.abs(t.b - b) < 0.01);
  let found = false;
  model.group.traverse((o) => {
    if (found) return;
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (m.color && near(m.color.r, m.color.g, m.color.b)) found = true;
    const c = o.geometry?.attributes?.color;
    if (c) for (let i = 0; i < c.count && !found; i += 1) if (near(c.getX(i), c.getY(i), c.getZ(i))) found = true;
  });
  return found;
}
describe('Paint Shop: paints', () => {
  it('a friendly box of paints: Original first, unique ids, real colours, kid-safe names', () => {
    expect(PAINTS[0]).toMatchObject({ id: ORIGINAL, color: null });
    expect(PAINTS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(PAINTS.map((p) => p.id)).size).toBe(PAINTS.length);
    expect(new Set(PAINTS.map((p) => p.color)).size).toBe(PAINTS.length);
    for (const p of PAINTS.slice(1)) {
      expect(Number.isInteger(p.color) && p.color >= 0 && p.color <= 0xffffff).toBe(true);
      expect(p.name).not.toMatch(BAD_WORDS);
      expect(p.emoji).toBeTruthy();
    }
    expect(getPaint('mint')).toMatchObject({ name: 'Minty Green' });
    expect(getPaint('nope')).toBeNull();
  });

  it('paintedDef repaints a copy (colours + paint), never the racer itself', () => {
    const rocco = getCharacter('rocco');
    const before = JSON.stringify(rocco.colors);
    const p = paintedDef(rocco, 'mint');
    expect(p).not.toBe(rocco);
    expect(p.colors.kart).toBe(0x55d99c);
    expect(p.paint).toBe(0x55d99c);
    expect(p.paintId).toBe('mint');
    expect(p.colors.primary).toBe(rocco.colors.primary);
    expect(p.id).toBe('rocco');
    expect(JSON.stringify(rocco.colors)).toBe(before);
    expect(paintedDef(rocco, ORIGINAL)).toBe(rocco);
    expect(paintedDef(rocco, 'bogus')).toBe(rocco);
    expect(paintedDef(null, 'mint')).toBeNull();
    expect(paintedDef({ id: 'x' }, 'sky').colors).toEqual({ kart: 0x62bdf5 });
  });

  it('the painted kart really wears the paint (every racer, even special karts)', () => {
    for (const id of ['rocco', 'captain-crumbs', 'marina', 'cotton-candy-girl', 'stella']) {
      const def = getCharacter(id);
      if (!def) continue;
      const plain = buildKartModel(def);
      const painted = buildKartModel(paintedDef(def, 'grape'));
      expect(usesColor(painted, 0xa274f2), id).toBe(true);
      expect(usesColor(plain, 0xa274f2), id).toBe(false);
      expect(painted.triangles).toBe(plain.triangles); // same model, new colour
      plain.dispose();
      painted.dispose();
    }
  });

  it('every racer can be painted, and shows the paint', () => {
    for (const c of CHARACTERS) {
      const m = buildKartModel(paintedDef(c, 'lemon'));
      expect(m.group).toBeTruthy();
      expect(usesColor(m, 0xffdf4a), c.id).toBe(true);
      m.dispose();
    }
  });
});

describe('Paint Shop: saved paints', () => {
  it('saves per racer, drops Original / unknown paints, survives junk', () => {
    const backend = memoryBackend();
    const store = paintStore(backend);
    expect(store.load()).toEqual({});
    expect(store.set('rocco', 'mint')).toEqual({ rocco: 'mint' });
    store.set('stella', 'grape');
    expect(paintStore(backend).load()).toEqual({ rocco: 'mint', stella: 'grape' });
    store.set('rocco', ORIGINAL);
    expect(store.load()).toEqual({ stella: 'grape' });
    store.set('stella', 'rainbow-glitter'); // unknown: back to own colours
    expect(store.load()).toEqual({});
    backend.setItem(PAINT_KEY, JSON.stringify({ racers: { a: 'sky', b: 'nope', c: 42, d: ORIGINAL } }));
    expect(store.load()).toEqual({ a: 'sky' });
    backend.setItem(PAINT_KEY, '{broken');
    expect(store.load()).toEqual({});
    backend.setItem(PAINT_KEY, JSON.stringify([1, 2]));
    expect(store.load()).toEqual({});
    store.save({ z: 'cocoa', y: 'bad' });
    expect(JSON.parse(backend.getItem(PAINT_KEY))).toEqual({ racers: { z: 'cocoa' } });
  });

  it('paintFor falls back to Original', () => {
    expect(paintFor({ rocco: 'mint' }, 'rocco')).toBe('mint');
    expect(paintFor({ rocco: 'mint' }, 'lenny')).toBe(ORIGINAL);
    expect(paintFor({ rocco: 'zzz' }, 'rocco')).toBe(ORIGINAL);
    expect(paintFor(null, 'rocco')).toBe(ORIGINAL);
  });
});

describe('Paint Shop: screen reducer', () => {
  const IDS = ['rocco', 'lenny', 'stella'];

  it('starts on your racer with the saved paints', () => {
    const s = createPaintShopState({ racerIds: IDS, paints: { lenny: 'sky' }, racerId: 'lenny' });
    expect(currentRacer(s)).toBe('lenny');
    expect(currentPaint(s)).toBe('sky');
    expect(paintIndex(s)).toBe(PAINTS.findIndex((p) => p.id === 'sky'));
    expect(s.row).toBe(0);
    expect(currentRacer(createPaintShopState({ racerIds: IDS, racerId: 'nobody' }))).toBe('rocco');
    expect(currentPaint(createPaintShopState({ racerIds: IDS }))).toBe(ORIGINAL);
  });

  it('racer row: left/right wraps; A / Down go to the paints', () => {
    let s = createPaintShopState({ racerIds: IDS });
    s = run(s, 'left');
    expect(currentRacer(s)).toBe('stella');
    s = run(s, 'right', 'right');
    expect(currentRacer(s)).toBe('lenny');
    expect(run(s, 'up')).toBe(s);
    expect(run(s, 'confirm').row).toBe(1);
    expect(run(s, 'down').row).toBe(1);
  });

  it('paint row: left/right repaints straight away (reported as changed); A is done', () => {
    let s = run(createPaintShopState({ racerIds: IDS }), 'down');
    let r = paintShopReduce(s, ev('right'));
    expect(currentPaint(r.state)).toBe(PAINTS[1].id);
    expect(r.changed).toEqual({ racerId: 'rocco', paintId: PAINTS[1].id });
    r = paintShopReduce(r.state, ev('left'));
    expect(currentPaint(r.state)).toBe(ORIGINAL);
    r = paintShopReduce(r.state, ev('left')); // wraps to the last pot
    expect(currentPaint(r.state)).toBe(PAINTS[PAINTS.length - 1].id);
    s = r.state;
    expect(run(s, 'up').row).toBe(0);
    expect(run(s, 'down')).toBe(s);
    expect(paintShopReduce(s, ev('confirm'))).toMatchObject({ go: 'back', fx: ['confirm'] });
    expect(paintShopReduce(s, ev('start')).go).toBe('back');
    // each racer keeps their own paint
    s = run(s, 'up', 'right');
    expect(currentRacer(s)).toBe('lenny');
    expect(currentPaint(s)).toBe(ORIGINAL);
    expect(s.pick.rocco).toBe(PAINTS[PAINTS.length - 1].id);
  });

  it('Y puts the Original colours back; nothing to change = no change', () => {
    const s = createPaintShopState({ racerIds: IDS, paints: { rocco: 'mint' } });
    const r = paintShopReduce(s, ev('toggle'));
    expect(currentPaint(r.state)).toBe(ORIGINAL);
    expect(r.changed).toEqual({ racerId: 'rocco', paintId: ORIGINAL });
    expect(r.fx).toEqual(['back']);
    expect(paintShopReduce(r.state, ev('toggle')).changed).toBeUndefined();
  });

  it('pointer: pick a racer or a paint; bad values are ignored', () => {
    const s = createPaintShopState({ racerIds: IDS });
    let r = paintShopReduce(s, { deviceId: 'mouse', action: 'set', key: 'racer', value: 2 });
    expect(currentRacer(r.state)).toBe('stella');
    r = paintShopReduce(r.state, { deviceId: 'mouse', action: 'set', key: 'paint', value: 3 });
    expect(r.changed).toEqual({ racerId: 'stella', paintId: PAINTS[3].id });
    expect(r.state.row).toBe(1);
    expect(paintShopReduce(s, { deviceId: 'mouse', action: 'set', key: 'paint', value: 99 }).state).toBe(s);
    expect(paintShopReduce(s, { deviceId: 'mouse', action: 'set', key: 'racer', value: -1 }).state).toBe(s);
    expect(paintShopReduce(s, { deviceId: 'mouse', action: 'set', key: 'hat', value: 0 }).state).toBe(s);
  });

  it('only the chooser drives it (mouse always can); B goes back; no racers is safe', () => {
    const s = createPaintShopState({ racerIds: IDS, controllerId: 'kb1' });
    expect(paintShopReduce(s, { deviceId: 'gp2', action: 'right' }).state).toBe(s);
    expect(paintShopReduce(s, ev('back')).go).toBe('back');
    expect(paintShopReduce(s, ev('noise')).state).toBe(s);
    const empty = createPaintShopState({ racerIds: [] });
    expect(paintShopReduce(empty, ev('right')).state).toBe(empty);
    expect(paintShopReduce(empty, ev('back')).go).toBe('back');
    expect(currentRacer(empty)).toBeNull();
  });

  it('the Paint Shop is a title menu entry', () => {
    const s = SCREENS.get('paint-shop');
    expect(typeof s?.mount).toBe('function');
    expect(s.flow).toBeUndefined();
    expect(menuEntries(SCREENS, 'title').find((e) => e.id === 'paint-shop')).toMatchObject({ label: 'Paint Shop', emoji: '🎨' });
  });
});
