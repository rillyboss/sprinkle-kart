import { describe, it, expect } from 'vitest';
import {
  formatTime, formatDelta, bestOf, currentLapTime, raceClock, lapSplits, lapCelebration, lapFlashText,
  raceRecordEligible, recordCandidates, submitRaceRecords, trialVerdict, trialVerdictText,
} from '../src/modes/timing.js';
import { createRecordHolders, recordRows, recordCount } from '../src/modes/recordHolders.js';
import { memoryBackend, jsonStore } from '../src/modes/storage.js';
import { timerModel, SPLITS_SHOWN } from '../src/ui/widgets/timer.js';

const FRIENDLY = /\b(hit|kill|crash|destroy|dead|die|lose|loser|fail)\b/i;

describe('timer formatting', () => {
  it('formats m:ss.cc and never rounds up past the real time', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(83.456)).toBe('1:23.45');
    expect(formatTime(59.999)).toBe('0:59.99');
    expect(formatTime(600)).toBe('10:00.00');
    expect(formatTime(0.1 + 0.2)).toBe('0:00.30'); // float noise
  });

  it('bad input shows a placeholder', () => {
    for (const v of [null, undefined, NaN, -1, Infinity, 'x']) expect(formatTime(v)).toBe('--:--.--');
  });

  it('formats signed deltas (negative = faster)', () => {
    expect(formatDelta(-0.42)).toBe('-0.42');
    expect(formatDelta(1.5)).toBe('+1.50');
    expect(formatDelta(0)).toBe('±0.00');
    expect(formatDelta(0.004)).toBe('±0.00');
    expect(formatDelta(75)).toBe('+1:15.00');
    expect(formatDelta(-61.25)).toBe('-1:01.25');
    expect(formatDelta(NaN)).toBe('');
    expect(formatDelta(null)).toBe('');
  });

  it('bestOf ignores junk', () => {
    expect(bestOf([3, 1.5, 2])).toBe(1.5);
    expect(bestOf([0, -1, NaN, null])).toBe(null);
    expect(bestOf()).toBe(null);
  });
});

describe('race clock + lap time', () => {
  const race = (state, time) => ({ state, time });
  const kart = (o = {}) => ({ finished: false, lapTimes: [], phys: { lastLapStart: 0 }, ...o });

  it('is 0 during the countdown', () => {
    expect(raceClock(kart(), race('countdown', 0))).toBe(0);
    expect(currentLapTime(kart(), race('countdown', 0))).toBe(0);
  });

  it('counts the current lap from the last lap start', () => {
    const k = kart({ lapTimes: [20], phys: { lastLapStart: 20 } });
    expect(currentLapTime(k, race('racing', 27.5))).toBeCloseTo(7.5);
    expect(raceClock(k, race('racing', 27.5))).toBe(27.5);
  });

  it('freezes at the finish time and last lap once finished (not for estimated finishes)', () => {
    const k = kart({ finished: true, finishTime: 61.2, lapTimes: [20, 21, 20.2] });
    expect(raceClock(k, race('racing', 70))).toBe(61.2);
    expect(currentLapTime(k, race('racing', 70))).toBe(20.2);
    const est = kart({ finished: true, finishTime: 99, finishEstimated: true });
    expect(raceClock(est, race('finished', 80))).toBe(80);
  });

  it('lap splits star the fastest lap', () => {
    expect(lapSplits([20, 19, 21])).toEqual([
      { lap: 1, time: 20, best: false }, { lap: 2, time: 19, best: true }, { lap: 3, time: 21, best: false },
    ]);
    expect(lapSplits([])).toEqual([]);
  });
});

describe('best lap / new record celebrations', () => {
  it('lap 1 alone is nothing special without a record', () => {
    expect(lapCelebration({ lapTime: 20, earlierLaps: [], recordLap: null })).toBe(null);
  });
  it('a faster lap than your earlier ones is a best lap', () => {
    expect(lapCelebration({ lapTime: 19, earlierLaps: [20], recordLap: null })).toBe('best-lap');
    expect(lapCelebration({ lapTime: 21, earlierLaps: [20], recordLap: null })).toBe(null);
    expect(lapCelebration({ lapTime: 19, earlierLaps: [20], recordLap: 15 })).toBe('best-lap');
  });
  it('beating the saved record lap wins over a best lap', () => {
    expect(lapCelebration({ lapTime: 18, earlierLaps: [], recordLap: 18.5 })).toBe('record-lap');
    expect(lapCelebration({ lapTime: 18.5, earlierLaps: [], recordLap: 18.5 })).toBe(null); // a tie is not a record
  });
  it('junk lap times are ignored', () => {
    expect(lapCelebration({ lapTime: NaN, earlierLaps: [20] })).toBe(null);
    expect(lapCelebration({ lapTime: 0, earlierLaps: [20] })).toBe(null);
  });
  it('flash texts are friendly and include the time', () => {
    expect(lapFlashText('best-lap', 19.5)).toMatch(/Best lap!.*0:19\.50/);
    expect(lapFlashText('record-lap', 18)).toMatch(/record/i);
    expect(lapFlashText(null, 1)).toBe('');
    for (const k of ['best-lap', 'record-lap']) expect(lapFlashText(k, 1)).not.toMatch(FRIENDLY);
  });
});

describe('records submit logic', () => {
  const trackDef = { id: 'gumdrop-meadow', laps: 3 };
  const human = (o) => ({ playerIndex: 0, characterId: 'rocco', finished: true, estimated: false, finishTime: 60, lapTimes: [21, 19.5, 19.5], ...o });
  const summary = (humans, laps = 3) => ({ trackId: 'gumdrop-meadow', laps, humans });

  it('race times count only for the track\'s normal lap count', () => {
    expect(raceRecordEligible(3, trackDef)).toBe(true);
    expect(raceRecordEligible(1, trackDef)).toBe(false);
    expect(raceRecordEligible(3, {})).toBe(true); // DEFAULT_LAPS
    expect(raceRecordEligible(NaN, trackDef)).toBe(false);
  });

  it('picks the best race and lap across humans, with who set them', () => {
    const c = recordCandidates(summary([
      human({ playerIndex: 0, characterId: 'rocco', finishTime: 62, lapTimes: [21, 20, 21] }),
      human({ playerIndex: 1, characterId: 'stella', finishTime: 61, lapTimes: [20.5, 20.2, 20.3] }),
    ]), trackDef);
    expect(c).toEqual({ raceTime: 61, bestLap: 20, raceBy: { playerIndex: 1, characterId: 'stella' }, lapBy: { playerIndex: 0, characterId: 'rocco' } });
  });

  it('estimated / unfinished humans give no race time but keep their real laps', () => {
    const c = recordCandidates(summary([human({ estimated: true, finishTime: 70, lapTimes: [22] })]), trackDef);
    expect(c.raceTime).toBe(null);
    expect(c.bestLap).toBe(22);
    const d = recordCandidates(summary([human({ finished: false, finishTime: null, lapTimes: [] })]), trackDef);
    expect(d).toMatchObject({ raceTime: null, bestLap: null });
  });

  it('a short race still offers its best lap', () => {
    const c = recordCandidates(summary([human({ finishTime: 20, lapTimes: [20] })], 1), trackDef);
    expect(c.raceTime).toBe(null);
    expect(c.bestLap).toBe(20);
  });

  it('submits through the progress API and reports what became a record', () => {
    const calls = [];
    let saved = { bestRace: 65, bestLap: 19 };
    const progress = {
      getRecord: () => saved,
      submitRecord(trackId, times) {
        calls.push([trackId, times]);
        const previous = saved;
        const newBestRace = times.raceTime !== null && times.raceTime < previous.bestRace;
        const newBestLap = times.bestLap !== null && times.bestLap < previous.bestLap;
        saved = { bestRace: newBestRace ? times.raceTime : previous.bestRace, bestLap: newBestLap ? times.bestLap : previous.bestLap };
        return { newBestRace, newBestLap, previous, record: saved };
      },
    };
    const res = submitRaceRecords(progress, summary([human()]), trackDef);
    expect(calls).toEqual([['gumdrop-meadow', { raceTime: 60, bestLap: 19.5 }]]);
    expect(res).toMatchObject({ trackId: 'gumdrop-meadow', newBestRace: true, newBestLap: false, previous: { bestRace: 65, bestLap: 19 }, record: { bestRace: 60, bestLap: 19 } });
  });

  it('never throws when progress is missing or broken', () => {
    expect(submitRaceRecords(null, summary([human()]), trackDef)).toMatchObject({ newBestRace: false, newBestLap: false });
    const broken = { submitRecord() { throw new Error('storage full'); } };
    expect(submitRaceRecords(broken, summary([human()]), trackDef)).toMatchObject({ newBestRace: false });
    expect(submitRaceRecords({ getRecord: () => ({ bestRace: 5, bestLap: 2 }) }, summary([]), trackDef).previous).toEqual({ bestRace: 5, bestLap: 2 });
  });

  it('works end-to-end with the real progress records', async () => {
    const progress = await import('../src/progress/progress.js');
    progress.resetProgress();
    const first = submitRaceRecords(progress, summary([human({ finishTime: 70, lapTimes: [24, 23, 23] })]), trackDef);
    expect(first).toMatchObject({ newBestRace: true, newBestLap: true, previous: { bestRace: null, bestLap: null } });
    const second = submitRaceRecords(progress, summary([human({ finishTime: 72, lapTimes: [22.5, 25, 24.5] })]), trackDef);
    expect(second).toMatchObject({ newBestRace: false, newBestLap: true, record: { bestRace: 70, bestLap: 22.5 } });
    expect(progress.getRecord('gumdrop-meadow')).toEqual({ bestRace: 70, bestLap: 22.5 });
    progress.resetProgress();
  });
});

describe('time trial verdict', () => {
  it('first run, record, close and slower', () => {
    expect(trialVerdict(60, null)).toEqual({ kind: 'first', delta: null });
    expect(trialVerdict(58, 60)).toEqual({ kind: 'record', delta: -2 });
    expect(trialVerdict(61, 60).kind).toBe('close');
    expect(trialVerdict(64, 60).kind).toBe('slower');
    expect(trialVerdict(null, 60)).toEqual({ kind: 'dnf', delta: null });
  });
  it('texts are friendly, with an unsigned gap', () => {
    expect(trialVerdictText(trialVerdict(58, 60))).toBe('New record! 🏆 2.00s faster!');
    expect(trialVerdictText(trialVerdict(61, 60))).toMatch(/close.*1\.00s behind/);
    for (const v of [trialVerdict(58, 60), trialVerdict(61, 60), trialVerdict(70, 60), trialVerdict(60, null), trialVerdict(null, 1)]) {
      expect(trialVerdictText(v)).not.toMatch(FRIENDLY);
      expect(trialVerdictText(v).length).toBeGreaterThan(5);
    }
  });
});

describe('record holders store', () => {
  it('remembers who set a record while the time still matches', () => {
    const h = createRecordHolders(memoryBackend());
    expect(h.holder('gumdrop-meadow', 'race', 60)).toBe(null);
    h.remember({ trackId: 'gumdrop-meadow', newBestRace: true, raceTime: 60, raceBy: { characterId: 'stella' }, newBestLap: false, bestLap: 19, lapBy: { characterId: 'rocco' } });
    expect(h.holder('gumdrop-meadow', 'race', 60)).toBe('stella');
    expect(h.holder('gumdrop-meadow', 'lap', 19)).toBe(null); // not a new lap record
    expect(h.holder('gumdrop-meadow', 'race', 59)).toBe(null); // someone else's newer record time
  });
  it('rejects bad input and survives corrupt storage', () => {
    const be = memoryBackend();
    const h = createRecordHolders(be);
    expect(h.set('', 'race', 1, 'rocco')).toBe(false);
    expect(h.set('x', 'podium', 1, 'rocco')).toBe(false);
    expect(h.set('x', 'race', NaN, 'rocco')).toBe(false);
    be.setItem('sprinkle-kart-record-holders-v1', '{not json');
    expect(h.holder('x', 'race', 1)).toBe(null);
    expect(h.set('x', 'race', 1, 'rocco')).toBe(true);
    expect(h.holder('x', 'race', 1)).toBe('rocco');
  });
  it('jsonStore falls back to memory without storage', () => {
    const s = jsonStore('k', null);
    expect(s.read()).toEqual({});
    s.write({ a: 1 });
    expect(s.read()).toEqual({ a: 1 });
    s.clear();
    expect(s.read()).toEqual({});
  });
  it('builds Records screen rows per cup', () => {
    const t1 = { id: 'a', name: 'A' };
    const t2 = { id: 'b', name: 'B' };
    const rows = recordRows([{ cup: { id: 'c' }, tracks: [t1, t2] }], {
      getRecord: (id) => (id === 'a' ? { bestRace: 61.5, bestLap: 20 } : { bestRace: null, bestLap: null }),
      holder: (id, kind) => (id === 'a' && kind === 'race' ? 'luna' : null),
      isLocked: (t) => t.id === 'b',
    });
    expect(rows[0].rows[0]).toMatchObject({ locked: false, raceText: '1:01.50', lapText: '0:20.00', raceBy: 'luna', lapBy: null });
    expect(rows[0].rows[1]).toMatchObject({ locked: true, raceText: '--:--.--', raceBy: null });
    expect(recordCount(rows)).toBe(1);
  });
});

describe('timer HUD widget model', () => {
  const kart = (o = {}) => ({ lap: 1, finished: false, lapTimes: [], phys: { lastLapStart: 0 }, item: null, itemCharges: 0, ...o });
  it('shows clock, lap and the latest splits', () => {
    const m = timerModel(kart({ lap: 3, lapTimes: [20, 19, 21, 22], phys: { lastLapStart: 82 } }), { state: 'racing', time: 90, rules: {} });
    expect(m.main).toBe('1:30.00');
    expect(m.lapLabel).toBe('LAP 3');
    expect(m.lap).toBe('0:08.00');
    expect(m.splits).toHaveLength(SPLITS_SHOWN);
    expect(m.splits.map((s) => s.lap)).toEqual([2, 3, 4]);
    expect(m.splits.find((s) => s.best).lap).toBe(2);
    expect(m.ghost).toBe(null);
    expect(m.boosts).toBe(null);
  });
  it('one lap is not "best" yet; countdown and finish states', () => {
    expect(timerModel(kart({ lapTimes: [20] }), { state: 'racing', time: 25 }).splits[0].best).toBe(false);
    expect(timerModel(kart(), { state: 'countdown', time: 0 })).toMatchObject({ main: '0:00.00', counting: true });
    expect(timerModel(kart({ finished: true, finishTime: 61, lapTimes: [20, 21, 20] }), { state: 'racing', time: 70 })).toMatchObject({ main: '1:01.00', lapLabel: 'FINISH', finished: true });
  });
  it('time trial: ghost gap and boosts left', () => {
    const race = { state: 'racing', time: 10, modeInfo: { ghostGap: -0.42 }, rules: { startItem: 'triple-sprinkle' } };
    expect(timerModel(kart({ item: 'triple-sprinkle', itemCharges: 2 }), race)).toMatchObject({ ghost: '-0.42', ghostAhead: true, boosts: 2 });
    expect(timerModel(kart(), race).boosts).toBe(0);
    expect(timerModel(kart(), { ...race, modeInfo: { ghostGap: 1.2 } })).toMatchObject({ ghost: '+1.20', ghostAhead: false });
  });
  it('the widget is headless-safe', async () => {
    const { TIMER_WIDGET } = await import('../src/ui/widgets/timer.js');
    const inst = TIMER_WIDGET.create(null, 0, null);
    expect(() => { inst.update(kart(), { state: 'racing', time: 1 }); inst.reset(); inst.destroy(); }).not.toThrow();
    expect(TIMER_WIDGET.anchor).toBe('top-center');
  });
});
