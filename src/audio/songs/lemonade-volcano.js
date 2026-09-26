// Lemonade Volcano: a sunny calypso. Steel-pan-style bells bounce over
// off-beat plucks and a clappy island groove. C major, fizzy and bright.
export default {
  id: 'lemonade-volcano',
  bpm: 132,
  instruments: { lead: 'bell', arp: 'pluck', pad: 'pluck', bass: 'bass' },
  mix: { lead: 0.6, arp: 0.12, pad: 0.15, bass: 0.44, drums: 0.4 },
  reverb: { lead: 0.35, arp: 0.2, pad: 0.15 },
  kit: {
    A: 'k . h . c . h k . k h . c . h .',
    B: 'k . h t c . h k . k h t c . t t',
    F: 'k . h . c . m m . m m . c c c c',
  },
  main: {
    bassStyle: 'bounce',
    arpStyle: 'updown8',
    padStyle: 'stabs',
    chords: ['C', 'F', 'G', 'C', 'Am', 'F', 'G7', 'C', 'F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'],
    drums: 'ABABABAF ABABABAF',
    lead: [
      'G5 . E5 G5 - C6 - G5',
      'A5 . F5 A5 - C6 - A5',
      'B5 . G5 B5 - D6 - B5',
      'C6 - - . G5 . E5 .',
      'E5 . E5 G5 - E5 C5 .',
      'F5 . F5 A5 - F5 C5 .',
      'D5 . F5 G5 - B5 - D6',
      'C6 - - - . . . .',
      'A5 . C6 A5 - F5 - A5',
      'B5 . D6 B5 - G5 - B5',
      'G5 . B5 G5 - E5 - G5',
      'A5 - C6 - E6 - C6 A5',
      'F5 . A5 C6 - A5 F5 .',
      'G5 . B5 D6 - B5 G5 .',
      'E6 - D6 C6 G5 - E5 G5',
      'C6 - - - . . . .',
    ],
  },
};
