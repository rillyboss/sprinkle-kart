import { describe, it, expect } from 'vitest';
import {
  createGate, gateReduce, gateAnswer, GATE_TRIES, GATE_MAX,
  createSettingsState, settingsReduce, SETTINGS_ROWS, VOLUME_STEPS,
  createBookState, bookReduce, BOOK_TABS,
} from '../src/progress/screenState.js';
import { bookModel, medalEmoji } from '../src/progress/collection.js';
import { progressInfo, progressLine, STAT_BOOK, ordinalText } from '../src/progress/progressText.js';
import { emptyProgress, STAT_KEYS } from '../src/progress/schema.js';
import { unlockCopy, teaserData, lockProgressHtml, barHtml, cupLabel, unlockSubline } from '../src/ui/screens/unlock.js';
import { applySettingsEffects } from '../src/ui/screens/settings.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { menuEntries } from '../src/ui/screenFlow.js';
import { CHARACTERS } from '../src/characters/index.js';
import { TRACKS } from '../src/tracks/index.js';

const BAD_WORDS = /\b(hit|kill|killed|destroy|crash|die|dead|attack|weapon|shoot)\b/i;
const ev = (action, extra = {}) => ({ deviceId: 'kb1', action, ...extra });
const run = (reduce, state, actions) => actions.reduce((s, a) => reduce(s, typeof a === 'string' ? ev(a) : a).state, state);

describe('parent gate', () => {
  it('asks a two-digit addition (11..17) and is deterministic per seed', () => {
    for (let seed = 1; seed < 400; seed += 7) {
      const g = createGate(seed);
      expect(gateAnswer(g)).toBeGreaterThanOrEqual(11);
      expect(gateAnswer(g)).toBeLessThanOrEqual(17);
      expect(g.a).toBeGreaterThanOrEqual(5);
      expect(g.b).toBeGreaterThanOrEqual(3);
      expect(g.value).toBe(0);
    }
    expect(createGate(42)).toEqual(createGate(42));
  });

  it('the d-pad dials the answer and A checks it', () => {
    let g = createGate(3);
    const target = gateAnswer(g);
    for (let i = 0; i < target; i++) g = gateReduce(g, ev('up')).state;
    expect(g.value).toBe(target);
    expect(gateReduce(g, ev('confirm')).go).toBe('pass');
    // down / left step back, wrapping 0 <-> GATE_MAX
    expect(gateReduce({ ...g, value: 0 }, ev('down')).state.value).toBe(GATE_MAX);
    expect(gateReduce({ ...g, value: GATE_MAX }, ev('right')).state.value).toBe(0);
    expect(gateReduce(g, ev('set', { value: 99 })).state.value).toBe(GATE_MAX);
  });

  it('a wrong answer wiggles; three wrong answers give a fresh question', () => {
    let g = createGate(9);
    g = { ...g, value: gateAnswer(g) - 1 };
    let r = gateReduce(g, ev('confirm'));
    expect(r.go).toBe(null);
    expect(r.shake).toBe(true);
    expect(r.fx).toEqual(['gate-oops']);
    expect(r.state.tries).toBe(1);
    for (let i = 1; i < GATE_TRIES; i++) r = gateReduce(r.state, ev('confirm'));
    expect(r.fresh).toBe(true);
    expect(r.state.tries).toBe(0);
    expect(r.state.value).toBe(0);
  });

  it('mashing A never passes, B cancels', () => {
    let g = createGate(11);
    for (let i = 0; i < 50; i++) {
      const r = gateReduce(g, ev('confirm'));
      expect(r.go).not.toBe('pass'); // value stays 0, the answer is >= 11
      g = r.state;
    }
    expect(gateReduce(g, ev('back')).go).toBe('cancel');
  });
});

describe('settings reducer', () => {
  const fresh = () => createSettingsState({ music: 0.7, sfx: 0.85, kidAssistDefault: false }, false, { seed: 5 });

  it('starts from the saved settings', () => {
    const s = fresh();
    expect(s).toMatchObject({ row: 0, music: 7, sfx: 9, kidAssist: false, unlockAll: false, modal: null });
    expect(createSettingsState({}, true).unlockAll).toBe(true);
  });

  it('up/down move rows (wrapping); left/right change volumes with effects', () => {
    let s = fresh();
    s = settingsReduce(s, ev('up')).state;
    expect(SETTINGS_ROWS[s.row]).toBe('back');
    s = settingsReduce(s, ev('down')).state;
    const r = settingsReduce(s, ev('left'));
    expect(r.state.music).toBe(6);
    expect(r.effects).toEqual([{ type: 'volume', music: 0.6, sfx: 0.9 }]);
    let t = r.state;
    for (let i = 0; i < 20; i++) t = settingsReduce(t, ev('left')).state;
    expect(t.music).toBe(0);
    expect(settingsReduce(t, ev('left')).effects).toEqual([]); // already at 0
    const p = settingsReduce(t, ev('set', { key: 'sfx', value: 3 }));
    expect(p.state).toMatchObject({ sfx: 3, row: 1 });
    expect(p.effects[0]).toMatchObject({ type: 'volume', sfx: 0.3 });
    expect(settingsReduce(t, ev('set', { key: 'nope', value: 3 })).effects).toEqual([]);
  });

  it('Kid-Assist default toggles with left/right or A', () => {
    let s = run(settingsReduce, fresh(), ['down', 'down']);
    expect(SETTINGS_ROWS[s.row]).toBe('kidAssist');
    let r = settingsReduce(s, ev('confirm'));
    expect(r.effects).toEqual([{ type: 'kidAssist', on: true }]);
    r = settingsReduce(r.state, ev('right'));
    expect(r.effects).toEqual([{ type: 'kidAssist', on: false }]);
  });

  it('unlock everything needs the parent gate; switching it off does not', () => {
    let s = run(settingsReduce, fresh(), ['down', 'down', 'down']);
    expect(SETTINGS_ROWS[s.row]).toBe('unlockAll');
    let r = settingsReduce(s, ev('confirm'));
    expect(r.state.modal).toBe('gate');
    expect(r.effects).toEqual([]);
    // a wrong answer: still gated, nothing unlocked
    r = settingsReduce(r.state, ev('confirm'));
    expect(r.state.modal).toBe('gate');
    expect(r.effects).toEqual([]);
    expect(r.shake).toBe(true);
    // dial the right answer
    s = { ...r.state, gate: { ...r.state.gate, value: gateAnswer(r.state.gate) } };
    r = settingsReduce(s, ev('confirm'));
    expect(r.effects).toEqual([{ type: 'unlockAll', on: true }]);
    expect(r.state).toMatchObject({ modal: 'done', unlockAll: true });
    r = settingsReduce(r.state, ev('confirm'));
    expect(r.state.modal).toBe(null);
    r = settingsReduce(r.state, ev('confirm'));
    expect(r.effects).toEqual([{ type: 'unlockAll', on: false }]);
    expect(r.state.modal).toBe(null);
  });

  it('B inside the gate closes it without doing anything', () => {
    const s = run(settingsReduce, fresh(), ['down', 'down', 'down', 'confirm']);
    const r = settingsReduce(s, ev('back'));
    expect(r.state.modal).toBe(null);
    expect(r.effects).toEqual([]);
    expect(r.go).toBe(null); // B closed the gate, it did not leave the screen
  });

  it('reset asks first (default "Keep it!"), then the parent gate, then resets', () => {
    let s = run(settingsReduce, fresh(), ['up', 'up']);
    expect(SETTINGS_ROWS[s.row]).toBe('reset');
    let r = settingsReduce(s, ev('confirm'));
    expect(r.state).toMatchObject({ modal: 'confirm-reset', confirmIndex: 0 });
    // A on "Keep it!" closes safely
    expect(settingsReduce(r.state, ev('confirm')).state.modal).toBe(null);
    r = settingsReduce(r.state, ev('right'));
    expect(r.state.confirmIndex).toBe(1);
    r = settingsReduce(r.state, ev('confirm'));
    expect(r.state).toMatchObject({ modal: 'gate', gateFor: 'reset' });
    expect(r.effects).toEqual([]);
    s = { ...r.state, gate: { ...r.state.gate, value: gateAnswer(r.state.gate) } };
    r = settingsReduce(s, ev('confirm'));
    expect(r.effects).toEqual([{ type: 'reset' }]);
    expect(r.state.modal).toBe('done');
  });

  it('pointer: select a row / a confirm button', () => {
    let r = settingsReduce(fresh(), ev('select', { index: SETTINGS_ROWS.indexOf('reset') }));
    expect(r.state.modal).toBe('confirm-reset');
    r = settingsReduce(r.state, ev('select', { index: 1 }));
    expect(r.state.modal).toBe('gate');
    expect(settingsReduce(fresh(), ev('select', { index: 99 })).state).toEqual(fresh());
  });

  it('back leaves from the list; back row too', () => {
    expect(settingsReduce(fresh(), ev('back')).go).toBe('back');
    const s = run(settingsReduce, fresh(), ['up']);
    expect(settingsReduce(s, ev('confirm')).go).toBe('back');
  });

  it('VOLUME_STEPS is 10 and every row has a label', () => {
    expect(VOLUME_STEPS).toBe(10);
    expect(SETTINGS_ROWS).toEqual(['music', 'sfx', 'kidAssist', 'unlockAll', 'reset', 'back']);
  });
});

describe('applySettingsEffects', () => {
  it('routes every effect to progress / audio', () => {
    const log = [];
    const ctx = {
      progress: {
        setSettings: (p) => log.push(['settings', p]),
        setUnlockAll: (on) => log.push(['all', on]),
        resetProgress: (o) => log.push(['reset', o]),
      },
      audio: { setVolume: (v) => log.push(['volume', v]) },
    };
    applySettingsEffects(ctx, [
      { type: 'volume', music: 0.5, sfx: 0.2 }, { type: 'kidAssist', on: true }, { type: 'unlockAll', on: true }, { type: 'reset' },
    ]);
    expect(log).toEqual([
      ['settings', { music: 0.5, sfx: 0.2 }], ['volume', { music: 0.5, sfx: 0.2 }],
      ['settings', { kidAssistDefault: true }], ['all', true], ['reset', { keepSettings: true }],
    ]);
    expect(() => applySettingsEffects({}, [{ type: 'reset' }])).not.toThrow();
  });
});

describe('sticker book reducer', () => {
  const fresh = () => createBookState({ racers: 21, tracks: 20, racerCols: 7, trackCols: 4 });

  it('arrows walk the grid; up from the top row reaches the tabs', () => {
    let s = fresh();
    s = bookReduce(s, ev('right')).state;
    expect(s.index[0]).toBe(1);
    s = bookReduce(s, ev('down')).state;
    expect(s.index[0]).toBe(8);
    s = bookReduce(s, ev('up')).state;
    s = bookReduce(s, ev('up')).state;
    expect(s.focus).toBe('tabs');
    s = bookReduce(s, ev('right')).state; // tabs: next page
    expect(BOOK_TABS[s.tab]).toBe('tracks');
    s = bookReduce(s, ev('down')).state;
    expect(s.focus).toBe('grid');
    expect(s.index[1]).toBe(0);
    expect(s.index[0]).toBe(1); // each page keeps its own cursor
  });

  it('left/right wrap across the whole list; down on the last row stays', () => {
    let s = bookReduce(fresh(), ev('left')).state;
    expect(s.index[0]).toBe(20);
    expect(bookReduce(s, ev('down')).state.index[0]).toBe(20);
    expect(bookReduce({ ...s, index: [15, 0, 0] }, ev('down')).state.index[0]).toBe(15); // last full row: stays
    const partial = { ...createBookState({ racers: 19, racerCols: 7 }), index: [12, 0, 0] }; // row 1, col 5
    expect(bookReduce(partial, ev('down')).state.index[0]).toBe(18); // lands on the last sticker of a short row
  });

  it('Y flips pages from anywhere; the totals page has no grid', () => {
    let s = bookReduce(fresh(), ev('toggle')).state;
    expect(BOOK_TABS[s.tab]).toBe('tracks');
    expect(bookReduce(fresh(), ev('toggle')).fx).toEqual(['book-page']);
    s = bookReduce(s, ev('toggle')).state;
    expect(BOOK_TABS[s.tab]).toBe('stats');
    expect(s.focus).toBe('tabs');
    expect(bookReduce(s, ev('down')).state.focus).toBe('tabs');
    s = bookReduce(s, ev('right')).state;
    expect(BOOK_TABS[s.tab]).toBe('racers');
  });

  it('A on a sticker cheers; B / Start go back; pointer picks', () => {
    expect(bookReduce(fresh(), ev('confirm')).cheer).toBe(true);
    expect(bookReduce(fresh(), ev('back')).go).toBe('back');
    expect(bookReduce(fresh(), ev('start')).go).toBe('back');
    expect(bookReduce(fresh(), ev('pick', { index: 12 })).state.index[0]).toBe(12);
    expect(bookReduce(fresh(), ev('pick', { index: 99 })).state).toEqual(fresh());
    const t = bookReduce(fresh(), ev('set', { key: 'tab', value: 2 })).state;
    expect(t).toMatchObject({ tab: 2, focus: 'tabs' });
  });
});

describe('sticker book model', () => {
  it('lists all 21 racers and 20 tracks (cup order), with free content open', () => {
    const b = bookModel(emptyProgress(), { characters: CHARACTERS, tracks: TRACKS });
    expect(b.racers).toHaveLength(21);
    expect(b.tracks).toHaveLength(20);
    expect(b.total).toBe(41);
    expect(b.tracks.slice(0, 4).map((t) => t.id)).toEqual(['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes']);
    expect(b.tracks[4].id).toBe('bubblegum-bay');
    expect(b.racers.find((r) => r.id === 'rocco')).toMatchObject({ open: true, free: true, built: true });
    expect(b.racers.find((r) => r.id === 'cotton-candy-girl')).toMatchObject({ open: false, free: false, built: true });
    expect(b.stickers).toBe(8 + 4); // 8 free racers + the Sprinkle Cup
    expect(b.cups.map((c) => c.id)).toEqual(['sprinkle-cup', 'bubble-cup', 'cozy-cup', 'adventure-cup', 'superstar-cup']);
  });

  it('shows progress, tallies, trophies and records', () => {
    const p = emptyProgress();
    p.stats.wins = 1;
    p.unlocked = ['cotton-candy-girl'];
    p.tracks['gumdrop-meadow'] = { finishes: 3, wins: 1, top3: 2, bestPlace: 1, timeTrials: 0 };
    p.trophies['gumdrop-meadow'] = 1;
    p.records['gumdrop-meadow'] = { bestRace: 80.5, bestLap: -2 };
    p.racers.rocco = { races: 3, wins: 1, podiums: 2 };
    p.cups['sprinkle-cup'] = { bestPlace: 2, wins: 0, finished: 1 };
    const b = bookModel(p, { characters: CHARACTERS, tracks: TRACKS });
    const twiggy = b.racers.find((r) => r.id === 'twiggy');
    expect(twiggy.info).toMatchObject({ current: 1, target: 3, count: '1/3', text: '1/3 ⭐' });
    expect(b.racers.find((r) => r.id === 'cotton-candy-girl').open).toBe(true);
    const gm = b.tracks.find((t) => t.id === 'gumdrop-meadow');
    expect(gm).toMatchObject({ trophies: 1, record: { bestRace: 80.5, bestLap: null }, tally: { finishes: 3, bestPlace: 1 } });
    expect(b.racers.find((r) => r.id === 'rocco').tally).toEqual({ races: 3, wins: 1, podiums: 2 });
    expect(b.cups[0]).toMatchObject({ bestPlace: 2, finished: 1 });
    expect(b.stickers).toBe(13);
  });

  it('unlock everything opens every page', () => {
    const b = bookModel({ ...emptyProgress(), unlockAll: true }, { characters: CHARACTERS, tracks: TRACKS });
    expect(b.stickers).toBe(41);
    expect(b.unlockAll).toBe(true);
  });

  it('medals', () => {
    expect([1, 2, 3, 5, null].map(medalEmoji)).toEqual(['🥇', '🥈', '🥉', '🎀', '']);
  });
});

describe('progress text', () => {
  it('"Win 3 races — 1/3 ⭐" style lines and best-so-far hints', () => {
    const p = emptyProgress();
    p.stats.wins = 1;
    expect(progressLine({ type: 'stat', stat: 'wins', count: 3 }, p)).toBe('Win 3 races — 1/3 ⭐');
    expect(progressLine({ type: 'stat', stat: 'wins', count: 1 }, p)).toBe('Win a race');
    p.tracks['starlight-galaxy'] = { finishes: 2, bestPlace: 4 };
    const info = progressInfo({ type: 'track', trackId: 'starlight-galaxy', result: 'top3' }, p);
    expect(info).toMatchObject({ done: false, best: 'Best so far: 4th', text: 'Best so far: 4th', short: 'Best: 4th' });
    p.tracks['mermaid-lagoon'] = { finishes: 1, bestPlace: 2 };
    expect(progressInfo({ type: 'cup-track', cupId: 'bubble-cup', result: 'win' }, p).best).toBe('Best so far: 2nd');
    expect(progressInfo({ type: 'track', trackId: 'pillow-fort', result: 'finish' }, p).text).toBe('');
    expect(progressLine(null, p)).toBe('');
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinalText)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });

  it('the totals page covers real stat keys with friendly labels', () => {
    for (const [k, emoji, label] of STAT_BOOK) {
      expect(STAT_KEYS).toContain(k);
      expect(emoji.length).toBeGreaterThan(0);
      expect(label).not.toMatch(BAD_WORDS);
    }
  });
});

describe('unlock celebration copy', () => {
  const ccg = CHARACTERS.find((c) => c.id === 'cotton-candy-girl');
  const meadow = TRACKS.find((t) => t.id === 'gumdrop-meadow');

  it('distinct character / track variants', () => {
    const c = unlockCopy({ kind: 'character', def: ccg });
    expect(c).toMatchObject({ kicker: 'NEW FRIEND UNLOCKED!', name: 'Cotton Candy Girl', ribbon: '', press: 'to continue' });
    expect(c.sub).toBe(unlockSubline(ccg));
    const t = unlockCopy({ kind: 'track', def: meadow });
    expect(t).toMatchObject({ kicker: 'NEW TRACK UNLOCKED!', name: 'Gumdrop Meadow', cup: '🍭 Sprinkle Cup' });
    expect(t.sub).toContain('Sprinkle Cup');
    expect(cupLabel({ id: 'bubblegum-bay' })).toBe('🫧 Bubble Cup');
    expect(cupLabel(null)).toBe('');
  });

  it('a sequence shows "Surprise n of N" and teases the next one', () => {
    expect(unlockCopy({ kind: 'track', def: meadow }, { index: 0, total: 3 })).toMatchObject({ ribbon: 'Surprise 1 of 3!', press: 'for the next surprise! 🎁' });
    expect(unlockCopy({ kind: 'track', def: meadow }, { index: 2, total: 3 })).toMatchObject({ ribbon: 'Surprise 3 of 3!', press: 'to continue' });
  });

  it('pronouns in the sub line', () => {
    expect(unlockSubline({ pronoun: 'he' })).toBe('He can race with you now! Pick him on the racer screen 💖');
    expect(unlockSubline({})).toMatch(/^They can race/);
  });

  it('all copy is kid-safe', () => {
    for (const u of [{ kind: 'character', def: ccg }, { kind: 'track', def: meadow }, { kind: 'track', def: null }]) {
      for (const v of Object.values(unlockCopy(u, { index: 0, total: 2 }))) expect(String(v)).not.toMatch(BAD_WORDS);
    }
  });
});

describe('results teaser + lock progress', () => {
  it('teaserData picks the closest registered locked item', () => {
    const p = emptyProgress();
    const t = teaserData(p, { characters: CHARACTERS, tracks: TRACKS });
    expect(t).toMatchObject({ kind: 'character', id: 'cotton-candy-girl', name: 'Cotton Candy Girl', hint: 'Win a race', ratio: 0 });
    expect(teaserData({ ...p, unlockAll: true }, { characters: CHARACTERS, tracks: TRACKS })).toBe(null);
    expect(teaserData(null, {})).toBe(null);
    const custom = teaserData({ ...p, stats: { ...p.stats, racesFinished: 2 } }, {
      characters: [], tracks: [{ id: 'teddy-toyland', name: 'Teddy Toyland', unlock: { type: 'stat', stat: 'racesFinished', count: 3 } }],
    });
    expect(custom).toMatchObject({ kind: 'track', id: 'teddy-toyland', text: '2/3 ⭐' });
    expect(custom.ratio).toBeCloseTo(2 / 3);
  });

  it('lockProgressHtml shows a bar only for locked, in-progress items', () => {
    const p = emptyProgress();
    p.stats.wins = 1;
    const twiggy = { id: 'twiggy', unlock: { type: 'stat', stat: 'wins', count: 3 } };
    const html = lockProgressHtml(twiggy, null, { progress: p, cls: 'x' });
    expect(html).toContain('1/3 ⭐');
    expect(html).toContain('width:33%');
    expect(lockProgressHtml(twiggy, null, { progress: { ...p, unlocked: ['twiggy'] } })).toBe('');
    expect(lockProgressHtml(twiggy, null, { progress: { ...p, unlockAll: true } })).toBe('');
    expect(lockProgressHtml({ id: 'rocco', unlock: null }, null, { progress: p })).toBe('');
    expect(lockProgressHtml({ id: 'lulu', unlock: { type: 'track', trackId: 'pillow-fort', result: 'finish' } }, null, { progress: p })).toBe('');
    // from ctx.progress when no progress object is passed
    expect(lockProgressHtml(twiggy, { progress: { loadProgress: () => p } })).toContain('1/3');
    expect(lockProgressHtml(twiggy, { progress: { loadProgress: () => { throw new Error('x'); } } })).toBe('');
  });

  it('barHtml clamps and escapes', () => {
    expect(barHtml(2, '<b>')).toContain('width:100%');
    expect(barHtml(-1)).toContain('width:0%');
    expect(barHtml(0.5, '<b>')).toContain('&lt;b&gt;');
  });
});

describe('screens are registered as title menu entries', () => {
  it('Sticker Book then Grown-ups', () => {
    expect(SCREENS.has('collection')).toBe(true);
    expect(SCREENS.has('settings')).toBe(true);
    expect(SCREENS.get('collection').flow).toBeUndefined();
    expect(SCREENS.get('settings').flow).toBeUndefined();
    const entries = menuEntries(SCREENS, 'title').map((e) => e.id);
    expect(entries.indexOf('collection')).toBeGreaterThanOrEqual(0);
    expect(entries.indexOf('collection')).toBeLessThan(entries.indexOf('settings'));
  });
});
