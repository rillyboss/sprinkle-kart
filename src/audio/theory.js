/**
 * Tiny music-theory helpers (pure, no Web Audio) used by the song compiler.
 */

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Lowest / highest MIDI notes any song is allowed to use (kind to small speakers & ears). */
export const MIDI_MIN = 28; // E1
export const MIDI_MAX = 100; // E7

/** 'C4' -> 60, 'F#5' -> 78, 'Bb3' -> 58. Returns NaN for anything else. */
export function noteToMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(String(name));
  if (!m) return NaN;
  let pc = LETTER_PC[m[1]];
  if (m[2] === '#') pc += 1;
  else if (m[2] === 'b') pc -= 1;
  return 12 * (Number(m[3]) + 1) + pc;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const QUALITIES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  '9': [0, 4, 7, 10, 14],
  m7b5: [0, 3, 6, 10],
};

/**
 * 'F#m7' -> { rootPc: 6, intervals: [0,3,7,10] }. Returns null when not a chord.
 */
export function parseChord(name) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(String(name));
  if (!m) return null;
  const intervals = QUALITIES[m[3]];
  if (!intervals) return null;
  let rootPc = LETTER_PC[m[1]];
  if (m[2] === '#') rootPc += 1;
  else if (m[2] === 'b') rootPc -= 1;
  rootPc = ((rootPc % 12) + 12) % 12;
  return { rootPc, intervals };
}

/**
 * Chord tones as MIDI notes, root placed at or above `floor` (within one octave).
 * Extra octaves are appended until at least `count` notes exist.
 */
export function chordTones(chord, floor, count = chord.intervals.length) {
  let root = floor + ((chord.rootPc - floor) % 12 + 12) % 12;
  const out = [];
  for (let oct = 0; out.length < count; oct += 12) {
    for (const iv of chord.intervals) {
      if (out.length >= count) break;
      out.push(root + iv + oct);
    }
  }
  return out;
}

/** Small deterministic PRNG (mulberry32) so patterns & babble are reproducible. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string hash for seeding. */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
