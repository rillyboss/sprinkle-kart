import { describe, it, expect } from 'vitest';
import { SONGS, SONG_IDS } from '../src/audio/songs.js';
import { compileSong, parseLine, parseDrumBar, genBass, genArp, genPad, STEPS_PER_BAR, DRUM_TYPES } from '../src/audio/compile.js';
import { noteToMidi, midiToFreq, parseChord, chordTones, MIDI_MIN, MIDI_MAX, makeRng } from '../src/audio/theory.js';
import { INSTRUMENTS } from '../src/audio/instruments.js';

describe('music theory helpers', () => {
  it('converts note names', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('H2')).toBeNaN();
    expect(midiToFreq(69)).toBeCloseTo(440);
  });

  it('parses chords', () => {
    expect(parseChord('C')).toEqual({ rootPc: 0, intervals: [0, 4, 7] });
    expect(parseChord('F#m7')).toEqual({ rootPc: 6, intervals: [0, 3, 7, 10] });
    expect(parseChord('Bb')).toEqual({ rootPc: 10, intervals: [0, 4, 7] });
    expect(parseChord('Cxyz')).toBeNull();
    expect(chordTones(parseChord('G'), 60, 4)).toEqual([67, 71, 74, 79]);
  });

  it('rng is deterministic', () => {
    const a = makeRng(42), b = makeRng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

describe('song parsing', () => {
  it('parses holds and rests', () => {
    const { events, length } = parseLine('C5 - . E5 - - G5 .', 2);
    expect(length).toBe(16);
    expect(events).toEqual([
      { step: 0, midi: 72, len: 4 },
      { step: 6, midi: 76, len: 6 },
      { step: 12, midi: 79, len: 2 },
    ]);
  });

  it('rejects bad tokens', () => {
    expect(() => parseLine('C5 X9')).toThrow();
    expect(() => parseDrumBar('k z')).toThrow();
  });

  it('parses combined drum hits', () => {
    const { events, length } = parseDrumBar('kh . s .');
    expect(length).toBe(4);
    expect(events).toEqual([{ step: 0, drum: 'k' }, { step: 0, drum: 'h' }, { step: 2, drum: 's' }]);
  });

  it('generators produce one bar per chord', () => {
    const chords = ['C', 'Am', 'F', 'G7'];
    for (const style of ['bounce', 'walk', 'soft', 'pulse']) {
      const ev = genBass(chords, style);
      expect(ev.length).toBeGreaterThan(0);
      expect(Math.max(...ev.map((e) => e.step))).toBeLessThan(chords.length * STEPS_PER_BAR);
    }
    expect(genArp(chords, 'up16')).toHaveLength(chords.length * 16);
    expect(genArp(chords, 'musicbox')).toHaveLength(chords.length * 8);
    expect(genArp(chords, 'none')).toHaveLength(0);
    expect(genPad(chords, 'whole').length).toBeGreaterThan(chords.length * 2);
  });
});

describe.each(SONG_IDS)('song "%s"', (id) => {
  const song = SONGS[id];
  const compiled = compileSong(song);

  it('has consistent bar lengths in every section', () => {
    for (const sec of [song.intro, song.main].filter(Boolean)) {
      const bars = sec.chords.length;
      expect(sec.lead).toHaveLength(bars);
      for (const bar of sec.lead) expect(parseLine(bar, 2).length).toBe(STEPS_PER_BAR);
      if (sec.counter) {
        expect(sec.counter).toHaveLength(bars);
        for (const bar of sec.counter) expect(parseLine(bar, 2).length).toBe(STEPS_PER_BAR);
      }
      expect(String(sec.drums).replace(/\s+/g, '')).toHaveLength(bars);
      for (const c of sec.chords) expect(parseChord(c)).not.toBeNull();
    }
    for (const pattern of Object.values(song.kit)) expect(parseDrumBar(pattern).length).toBe(STEPS_PER_BAR);
    expect(compiled.totalSteps).toBe(compiled.introSteps + compiled.loopSteps);
    expect(compiled.loopSteps % STEPS_PER_BAR).toBe(0);
    expect(compiled.byStep).toHaveLength(compiled.totalSteps);
  });

  it('keeps every note in a friendly range and inside the song', () => {
    const notes = compiled.events.filter((e) => e.track !== 'drums');
    expect(notes.length).toBeGreaterThan(50);
    for (const e of notes) {
      expect(Number.isInteger(e.midi)).toBe(true);
      expect(e.midi).toBeGreaterThanOrEqual(MIDI_MIN);
      expect(e.midi).toBeLessThanOrEqual(MIDI_MAX);
      expect(e.len).toBeGreaterThan(0);
      expect(e.step).toBeGreaterThanOrEqual(0);
      expect(e.step).toBeLessThan(compiled.totalSteps);
      expect(e.vel).toBeGreaterThan(0);
      expect(e.vel).toBeLessThanOrEqual(1);
      expect(typeof INSTRUMENTS[e.inst]).toBe('function');
    }
    // A section never plays into the next one (except sustained pads/melody ending at the loop point).
    const lead = notes.filter((e) => e.track === 'lead');
    for (const e of lead) expect(e.step + e.len).toBeLessThanOrEqual(compiled.totalSteps);
  });

  it('has a melody that sticks to its key (few chromatic surprises)', () => {
    const lead = compiled.events.filter((e) => e.track === 'lead');
    const pcs = new Set(lead.map((e) => e.midi % 12));
    expect(pcs.size).toBeLessThanOrEqual(song.swing ? 10 : 9); // the jazzy song may use a few blue notes
    expect(lead.length).toBeGreaterThan(song.main.chords.length * 2);
  });

  it('has sane tempo, mix and drums', () => {
    expect(song.bpm).toBeGreaterThanOrEqual(80);
    expect(song.bpm).toBeLessThanOrEqual(160);
    for (const v of Object.values(song.mix)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(0.7);
    }
    const drums = compiled.events.filter((e) => e.track === 'drums');
    expect(drums.length).toBeGreaterThan(0);
    for (const d of drums) expect(DRUM_TYPES).toContain(d.drum);
  });
});
