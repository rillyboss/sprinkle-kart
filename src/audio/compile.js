/**
 * Song compiler (pure): turns the human-friendly notation in songs.js into
 * flat step events the Sequencer can play. No Web Audio here, so it is fully
 * unit-testable in node.
 */
import { noteToMidi, parseChord, chordTones } from './theory.js';

export const STEPS_PER_BAR = 16;
export const STEPS_PER_BEAT = 4;
export const DRUM_TYPES = ['k', 's', 'h', 'o', 'c', 't', 'm'];

const DEFAULT_MIX = { lead: 0.5, counter: 0.2, arp: 0.15, pad: 0.12, bass: 0.4, drums: 0.35 };

function tokens(str) {
  return String(str).trim().split(/\s+/).filter(Boolean);
}

/**
 * Parse a melody line into note events.
 * @param {string} line  tokens separated by spaces
 * @param {number} div   steps per token (2 = 8th notes)
 * @returns {{events: {step:number, midi:number, len:number}[], length:number}}
 */
export function parseLine(line, div = 2) {
  const events = [];
  let last = null;
  let step = 0;
  for (const tok of tokens(line)) {
    if (tok === '.') {
      last = null;
    } else if (tok === '-') {
      if (last) last.len += div;
    } else {
      const midi = noteToMidi(tok);
      if (!Number.isFinite(midi)) throw new Error(`Bad note token "${tok}"`);
      last = { step, midi, len: div };
      events.push(last);
    }
    step += div;
  }
  return { events, length: step };
}

/** Parse one 16-token drum bar. */
export function parseDrumBar(line) {
  const toks = tokens(line);
  const events = [];
  toks.forEach((tok, step) => {
    if (tok === '.') return;
    for (const ch of tok) {
      if (!DRUM_TYPES.includes(ch)) throw new Error(`Bad drum token "${tok}"`);
      events.push({ step, drum: ch });
    }
  });
  return { events, length: toks.length };
}

function chordAt(chords, bar) {
  const c = parseChord(chords[bar % chords.length]);
  if (!c) throw new Error(`Bad chord "${chords[bar % chords.length]}"`);
  return c;
}

function bassRoot(chord) {
  // Root between A1 (33) and G#2 (44): warm but not muddy.
  return chordTones(chord, 33, 1)[0];
}

/** Generate bass events for every bar. */
export function genBass(chords, style) {
  const out = [];
  const n = chords.length;
  for (let bar = 0; bar < n; bar++) {
    const c = chordAt(chords, bar);
    const next = chordAt(chords, bar + 1);
    const r = bassRoot(c);
    const fifth = r + 7;
    const third = r + c.intervals[1];
    const b = bar * STEPS_PER_BAR;
    const push = (s, midi, len, vel = 1) => out.push({ step: b + s, midi, len, vel });
    switch (style) {
      case 'none':
        break;
      case 'soft':
        push(0, r, 7, 1);
        push(8, fifth, 6, 0.8);
        break;
      case 'pulse':
        for (let s = 0; s < 16; s += 2) push(s, r, 1, s % 4 === 0 ? 1 : 0.75);
        break;
      case 'walk': {
        const nr = bassRoot(next);
        const approach = nr > r ? nr - 1 : nr + 1;
        push(0, r, 3, 1);
        push(4, third, 3, 0.85);
        push(8, fifth, 3, 0.9);
        push(12, approach === r ? fifth + 2 : approach, 3, 0.85);
        break;
      }
      case 'bounce':
      default:
        push(0, r, 3, 1);
        push(4, fifth, 2, 0.8);
        push(8, r + 12, 2, 0.9);
        push(12, fifth, 2, 0.8);
        push(14, r, 1, 0.65);
        break;
    }
  }
  return out;
}

const ARP_PATTERNS = {
  up16: { every: 1, order: [0, 1, 2, 3, 4, 3, 2, 1], vel: [0.9, 0.6, 0.7, 0.6] },
  sparkle: { every: 1, order: [0, 2, 4, 5, 3, 1, 4, 2], vel: [0.9, 0.55, 0.7, 0.55] },
  musicbox: { every: 2, order: [0, 2, 1, 2, 3, 2, 1, 2], vel: [0.9, 0.7] },
  updown8: { every: 2, order: [0, 1, 2, 3, 2, 1, 0, 1], vel: [0.9, 0.7] },
};

/** Generate arpeggio events (octave ~C5) from the chords. */
export function genArp(chords, style) {
  const pat = ARP_PATTERNS[style];
  if (!pat) return [];
  const out = [];
  for (let bar = 0; bar < chords.length; bar++) {
    const tones = chordTones(chordAt(chords, bar), style === 'sparkle' ? 74 : 67, 6);
    for (let s = 0, i = 0; s < STEPS_PER_BAR; s += pat.every, i++) {
      out.push({
        step: bar * STEPS_PER_BAR + s,
        midi: tones[pat.order[i % pat.order.length]],
        len: pat.every,
        vel: pat.vel[i % pat.vel.length],
      });
    }
  }
  return out;
}

/** Generate pads: sustained chords ('whole') or bouncy off-beat stabs ('stabs'). */
export function genPad(chords, style) {
  const out = [];
  if (style === 'none' || !style) return out;
  for (let bar = 0; bar < chords.length; bar++) {
    const c = chordAt(chords, bar);
    const tones = chordTones(c, 55, Math.min(4, c.intervals.length));
    const b = bar * STEPS_PER_BAR;
    if (style === 'stabs') {
      for (const s of [2, 6, 10, 14]) {
        for (const midi of tones) out.push({ step: b + s, midi, len: 1, vel: s === 6 || s === 14 ? 0.8 : 0.95 });
      }
    } else {
      for (const midi of tones) out.push({ step: b, midi, len: 16, vel: 0.9 });
    }
  }
  return out;
}

function compileSection(sec, song, offset) {
  const bars = sec.chords.length;
  const len = bars * STEPS_PER_BAR;
  const inst = { ...song.instruments, ...(sec.instruments || {}) };
  const mix = { ...DEFAULT_MIX, ...(song.mix || {}), ...(sec.mix || {}) };
  const events = [];
  const add = (track, list) => {
    for (const e of list) {
      events.push({ ...e, step: e.step + offset, track, inst: track === 'drums' ? 'drums' : inst[track], gain: mix[track] });
    }
  };

  const checkLen = (what, got) => {
    if (got !== len) throw new Error(`${song.id}: ${what} is ${got} steps, expected ${len}`);
  };

  const lead = parseLine((sec.lead || []).join(' '), 2);
  checkLen('lead', lead.length);
  add('lead', lead.events.map((e, i) => ({ ...e, vel: e.step % STEPS_PER_BAR === 0 || i === 0 ? 1 : 0.88 })));

  if (sec.counter) {
    const counter = parseLine(sec.counter.join(' '), 2);
    checkLen('counter', counter.length);
    add('counter', counter.events.map((e) => ({ ...e, vel: 0.8 })));
  }

  add('bass', genBass(sec.chords, sec.bassStyle || 'bounce'));
  add('arp', genArp(sec.chords, sec.arpStyle || 'none'));
  add('pad', genPad(sec.chords, sec.padStyle || 'none'));

  const plan = String(sec.drums || '').replace(/\s+/g, '');
  if (plan) {
    if (plan.length !== bars) throw new Error(`${song.id}: drum plan has ${plan.length} bars, expected ${bars}`);
    const drumEvents = [];
    [...plan].forEach((key, bar) => {
      const pattern = song.kit && song.kit[key];
      if (!pattern) throw new Error(`${song.id}: unknown drum pattern "${key}"`);
      const parsed = parseDrumBar(pattern);
      if (parsed.length !== STEPS_PER_BAR) throw new Error(`${song.id}: drum pattern "${key}" has ${parsed.length} steps`);
      for (const e of parsed.events) {
        drumEvents.push({ step: bar * STEPS_PER_BAR + e.step, drum: e.drum, len: 1, vel: e.step % 4 === 0 ? 1 : 0.75 });
      }
    });
    add('drums', drumEvents);
  }
  return { events, length: len };
}

/**
 * Compile a song definition.
 * @returns {{id, bpm, swing, echo, reverb, introSteps, loopSteps, totalSteps,
 *            events: object[], byStep: object[][]}}
 *   Steps [0, introSteps) play once; [introSteps, totalSteps) loop forever.
 */
export function compileSong(song) {
  const events = [];
  let introSteps = 0;
  if (song.intro) {
    const intro = compileSection(song.intro, song, 0);
    introSteps = intro.length;
    events.push(...intro.events);
  }
  const main = compileSection(song.main, song, introSteps);
  events.push(...main.events);
  const totalSteps = introSteps + main.length;
  const byStep = Array.from({ length: totalSteps }, () => []);
  for (const e of events) byStep[e.step].push(e);
  return {
    id: song.id,
    bpm: song.bpm,
    swing: song.swing || 0,
    echo: song.echo || 0,
    reverb: { ...(song.reverb || {}) },
    introSteps,
    loopSteps: main.length,
    totalSteps,
    events,
    byStep,
  };
}

const cache = new Map();
/** Compile once and cache (songs are static data). */
export function getCompiledSong(songs, id) {
  if (!cache.has(id)) cache.set(id, compileSong(songs[id]));
  return cache.get(id);
}
