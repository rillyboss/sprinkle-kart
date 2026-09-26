// "Good try!" tune for the results screen when nobody at home made the top 3.
// Still sunny and proud (a little "ta-da!" intro, then a swingy, huggy loop with
// vibes and a whistle), just cosier than the big victory fanfare, so finishing
// 6th still feels like a party. OWNER: showcase presentation. F major.
export default {
  id: 'skx-goodtry',
  bpm: 112,
  swing: 0.18,
  instruments: { lead: 'vibes', counter: 'whistle', arp: 'musicbox', pad: 'pad', bass: 'bass' },
  mix: { lead: 0.55, counter: 0.15, arp: 0.12, pad: 0.14, bass: 0.4, drums: 0.32 },
  reverb: { lead: 0.4, counter: 0.3, arp: 0.35, pad: 0.4 },
  kit: {
    T: 'k . . . s . . . k . . . s . s s',
    E: 'k . . . . . . . c . . . . . . .',
    A: 'k . t . c . t . k . t k c . t .',
    F: 'k . t . c . t . k . c . c c c c',
  },
  intro: {
    bassStyle: 'soft',
    arpStyle: 'none',
    padStyle: 'whole',
    chords: ['F', 'Bb', 'C7', 'F'],
    drums: 'TTTE',
    lead: [
      'C5 . C5 . F5 - A5 -',
      'Bb5 - A5 - G5 - F5 -',
      'E5 - G5 - Bb5 - C6 -',
      'A5 - - - - - . .',
    ],
  },
  main: {
    bassStyle: 'bounce',
    arpStyle: 'musicbox',
    padStyle: 'whole',
    chords: ['F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'Gm7', 'C7'],
    drums: 'AAAF AAAF',
    lead: [
      'A5 . C6 . A5 - F5 -',
      'D5 - F5 - A5 - - .',
      'Bb5 - A5 - G5 - F5 D5',
      'E5 - - - C5 . . .',
      'A5 . C6 . D6 - C6 A5',
      'F5 - A5 - D6 - - .',
      'C6 - Bb5 - G5 - Bb5 A5',
      'G5 - - - E5 - C5 -',
    ],
    counter: [
      '. . . . . . C6 .',
      '. . . . . . F5 .',
      '. . . . . . D6 .',
      '. . . . G5 . C6 .',
      '. . . . . . F6 .',
      '. . . . . . A5 .',
      '. . . . . . D6 .',
      'C6 . . . Bb5 . G5 .',
    ],
  },
};
