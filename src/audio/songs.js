/**
 * Sprinkle Kart song book. Pure data — compiled into step events by compile.js.
 *
 * Notation
 *  - One bar = 16 steps (16th notes). `lead` / `counter` bars are 8 tokens of 8th notes.
 *  - Tokens: a note ('C5', 'F#4', 'Bb5'), '.' rest, '-' hold the previous note.
 *  - `chords`: one chord name per bar (see theory.js QUALITIES). Bass, arps and
 *    pads are generated from the chords using the named styles.
 *  - Drums: `kit` maps a letter to a 16-token bar; `drums` is one letter per bar.
 *    Drum tokens combine hits: k kick, s snare, h hat, o open hat, c clap,
 *    t shaker, m tom, '.' nothing (e.g. 'kh').
 *  - An optional `intro` section plays once, then the main section loops.
 */

export const SONGS = {
  // Sweet and inviting: music box over soft strings, gentle shaker groove.
  menu: {
    id: 'menu',
    bpm: 106,
    instruments: { lead: 'musicbox', arp: 'pluck', pad: 'pad', bass: 'bass' },
    mix: { lead: 0.55, arp: 0.16, pad: 0.13, bass: 0.4, drums: 0.34 },
    reverb: { lead: 0.45, arp: 0.3, pad: 0.4 },
    kit: {
      A: 'k . t . c . t . k . t k c . t .',
      F: 'k . t . c . t . k . c . c c c c',
    },
    main: {
      bassStyle: 'soft',
      arpStyle: 'musicbox',
      padStyle: 'whole',
      chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm7', 'G', 'F', 'G', 'Em', 'Am', 'Dm7', 'G', 'C', 'G7'],
      drums: 'AAAAAAAF AAAAAAAF',
      lead: [
        'E5 . G5 . C6 - B5 -',
        'A5 - G5 E5 - . C5 D5',
        'E5 - F5 - A5 - G5 F5',
        'G5 - - - D5 . B4 .',
        'E5 . G5 . C6 - D6 -',
        'E6 - C6 A5 - . A5 B5',
        'C6 - A5 - F5 - D5 E5',
        'D5 - B4 - G4 - . .',
        'C6 - A5 - F5 - A5 C6',
        'B5 - G5 - D5 - G5 B5',
        'G5 - E5 - B4 - E5 G5',
        'A5 - - - C6 - B5 A5',
        'F5 - A5 - C6 - D6 -',
        'B5 - - - A5 - G5 -',
        'E5 - G5 - C6 - E6 -',
        'D6 - - - B5 - G5 -',
      ],
    },
  },

  // Cotton Candy Castle: regal but bubbly. Glockenspiel lead, music-box arps,
  // strings, royal snare fills.
  castle: {
    id: 'castle',
    bpm: 118,
    instruments: { lead: 'bell', counter: 'whistle', arp: 'musicbox', pad: 'pad', bass: 'bass' },
    mix: { lead: 0.6, counter: 0.14, arp: 0.14, pad: 0.12, bass: 0.42, drums: 0.4 },
    reverb: { lead: 0.35, counter: 0.3, arp: 0.3, pad: 0.35 },
    kit: {
      A: 'k . h . s . h . k . h k s . h .',
      B: 'k . h . s . h t k . h k s . h h',
      F: 'k . h . s . h . m . m . s s s s',
    },
    main: {
      bassStyle: 'bounce',
      arpStyle: 'up16',
      padStyle: 'whole',
      chords: ['F', 'Bb', 'C', 'F', 'Dm', 'Bb', 'Gm', 'C', 'F', 'Bb', 'C', 'Am', 'Dm', 'Gm', 'C', 'F'],
      drums: 'ABABABAF ABABABAF',
      lead: [
        'C5 - F5 - A5 - C6 -',
        'D6 - - C6 Bb5 - A5 -',
        'G5 - C6 - E5 - G5 -',
        'F5 - - - . . C5 .',
        'D5 - F5 - A5 - D6 -',
        'C6 Bb5 A5 G5 F5 - D5 -',
        'G5 - Bb5 - D6 - C6 Bb5',
        'G5 - E5 - C5 - . .',
        'A5 . A5 C6 - . A5 .',
        'Bb5 . Bb5 D6 - . Bb5 .',
        'C6 . C6 E6 - . D6 C6',
        'E6 - C6 - A5 - . .',
        'F6 - D6 - A5 - F5 -',
        'G5 A5 Bb5 C6 D6 - Bb5 -',
        'C6 - G5 - E5 - G5 -',
        'F5 - - - A5 . C6 .',
      ],
      counter: [
        '. . . . . . . .',
        '. . . . . . . .',
        '. . . . . . . .',
        '. . . . . . . .',
        'A4 - - - - - - -',
        'Bb4 - - - - - - -',
        'Bb4 - - - - - - -',
        'C5 - - - - - - -',
        'F4 - - - A4 - - -',
        'D4 - - - F4 - - -',
        'E4 - - - G4 - - -',
        'E4 - - - C5 - - -',
        'D5 - - - A4 - - -',
        'Bb4 - - - D5 - - -',
        'E5 - - - C5 - - -',
        'A4 - - - - - . .',
      ],
    },
  },

  // Gumdrop Meadow: sunny and skippy. Whistle lead, ukulele off-beat strums.
  meadow: {
    id: 'meadow',
    bpm: 126,
    instruments: { lead: 'whistle', arp: 'pluck', pad: 'pluck', bass: 'bass' },
    mix: { lead: 0.42, arp: 0.12, pad: 0.16, bass: 0.42, drums: 0.4 },
    reverb: { lead: 0.25, arp: 0.2, pad: 0.15 },
    kit: {
      A: 'k . h t s . h t k k h t s . h t',
      F: 'k . h t s . h t k . s . s s m m',
    },
    main: {
      bassStyle: 'bounce',
      arpStyle: 'none',
      padStyle: 'stabs',
      chords: ['G', 'C', 'G', 'D7', 'G', 'C', 'D', 'G', 'Em', 'C', 'G', 'D', 'C', 'D', 'G', 'G'],
      drums: 'AAAAAAAF AAAAAAAF',
      lead: [
        'D5 . G5 . B5 - A5 G5',
        'E5 - G5 - E5 - C5 -',
        'D5 . G5 . B5 - D6 -',
        'C6 - B5 A5 - - . .',
        'D5 . G5 . B5 - A5 G5',
        'E5 - E5 F#5 G5 - E5 -',
        'F#5 - A5 - D6 - C6 A5',
        'G5 - - - . . D5 E5',
        'G5 - E5 - B4 - E5 G5',
        'A5 - G5 - E5 - G5 -',
        'B5 - A5 G5 D5 - G5 A5',
        'F#5 - - - A5 - . .',
        'E6 - D6 C6 G5 - C6 -',
        'D6 - C6 B5 A5 - F#5 -',
        'G5 . B5 . D6 - B5 -',
        'G5 - - - . . . .',
      ],
    },
  },

  // Starlight Galaxy: dreamy, floaty, sparkly arpeggios with echoes.
  galaxy: {
    id: 'galaxy',
    bpm: 92,
    echo: 0.32,
    instruments: { lead: 'glass', arp: 'bell', pad: 'pad', bass: 'bass' },
    mix: { lead: 0.5, arp: 0.13, pad: 0.16, bass: 0.36, drums: 0.3 },
    reverb: { lead: 0.55, arp: 0.5, pad: 0.5 },
    kit: {
      A: 'k . t . h . t . . . k . h . t .',
      F: 'k . t . h . t . k . k . o . . .',
    },
    main: {
      bassStyle: 'soft',
      arpStyle: 'sparkle',
      padStyle: 'whole',
      chords: ['Dmaj7', 'Bm7', 'Gmaj7', 'A', 'Dmaj7', 'F#m7', 'Gmaj7', 'A7', 'Bm7', 'Gmaj7', 'Em7', 'A', 'Dmaj7', 'Gmaj7', 'Em7', 'A'],
      drums: 'AAAAAAAF AAAAAAAF',
      lead: [
        'F#5 - - - A5 - C#6 -',
        'D6 - - - B5 - A5 -',
        'B5 - - - D6 - F#6 -',
        'E6 - - - - - . .',
        'F#5 - A5 - D6 - C#6 -',
        'C#6 - A5 - E5 - F#5 -',
        'G5 - B5 - D6 - F#6 -',
        'E6 - C#6 - A5 - G5 -',
        'F#5 - - - D5 - F#5 -',
        'B5 - - - A5 - F#5 -',
        'G5 - B5 - D6 - E6 -',
        'C#6 - - - - - A5 -',
        'D6 - F#6 - E6 - D6 -',
        'B5 - - - D6 - B5 -',
        'G5 - A5 - B5 - D6 -',
        'C#6 - - - E6 - - -',
      ],
    },
  },

  // Sundae Slopes: jazzy-bouncy swing with vibes, walking bass and piano comps.
  sundae: {
    id: 'sundae',
    bpm: 144,
    swing: 0.33,
    instruments: { lead: 'vibes', arp: 'pluck', pad: 'pluck', bass: 'bass' },
    mix: { lead: 0.5, arp: 0.1, pad: 0.16, bass: 0.46, drums: 0.36 },
    reverb: { lead: 0.3, pad: 0.2 },
    kit: {
      A: 'kh . . . sh . h . kh . . . sh . h .',
      F: 'kh . . . sh . h . k . s . s . s s',
    },
    main: {
      bassStyle: 'walk',
      arpStyle: 'none',
      padStyle: 'stabs',
      chords: ['C6', 'A7', 'Dm7', 'G7', 'C6', 'A7', 'Dm7', 'G7', 'F6', 'Fm6', 'C6', 'A7', 'Dm7', 'G7', 'C6', 'G7'],
      drums: 'AAAAAAAF AAAAAAAF',
      lead: [
        'G5 . E5 G5 A5 - G5 .',
        'G5 - F5 E5 C#5 - A4 .',
        'D5 . F5 A5 C6 - A5 .',
        'B5 - A5 G5 F5 - D5 .',
        'E5 . G5 C6 E6 - D6 C6',
        'C#6 - A5 - E5 - G5 .',
        'F5 - A5 - D6 - C6 A5',
        'G5 - - - . . G4 .',
        'A5 . A5 C6 D6 - C6 .',
        'Ab5 . Ab5 C6 D6 - C6 .',
        'E6 . D6 C6 A5 - G5 .',
        'C#6 - E6 - G5 - A5 .',
        'F5 . E5 F5 A5 - F5 .',
        'G5 . F#5 G5 B5 - D6 .',
        'E6 - C6 - G5 - A5 -',
        'G5 - - - . . . .',
      ],
    },
  },

  // Victory fanfare jingle, then a happy little celebration loop.
  victory: {
    id: 'victory',
    bpm: 132,
    instruments: { lead: 'bell', arp: 'musicbox', pad: 'pad', bass: 'bass' },
    mix: { lead: 0.55, arp: 0.12, pad: 0.14, bass: 0.4, drums: 0.38 },
    reverb: { lead: 0.35, arp: 0.3, pad: 0.35 },
    kit: {
      V: 'k . . . s . . . k . . . s s s s',
      W: 'k . . . s . . . k . . . k . . .',
      A: 'k . h . c . h . k . h k c . h .',
    },
    intro: {
      instruments: { lead: 'brass' },
      mix: { lead: 0.42 },
      bassStyle: 'soft',
      arpStyle: 'none',
      padStyle: 'whole',
      chords: ['C', 'C', 'F', 'G', 'C'],
      drums: 'VVVVW',
      lead: [
        'G4 G4 G4 C5 - - E5 -',
        'G5 - - E5 G5 - - -',
        'A5 - A5 - G5 F5 E5 D5',
        'D5 - E5 - F5 - B4 -',
        'C5 - - - - - - .',
      ],
    },
    main: {
      bassStyle: 'bounce',
      arpStyle: 'musicbox',
      padStyle: 'none',
      chords: ['C', 'F', 'G', 'C'],
      drums: 'AAAA',
      lead: [
        'E5 . G5 . C6 . G5 .',
        'A5 . C6 . F5 . A5 .',
        'B5 . D6 . G5 . B5 .',
        'C6 - - - G5 . E5 .',
      ],
    },
  },
};

export const SONG_IDS = Object.keys(SONGS);
