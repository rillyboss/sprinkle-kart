# Extra songs

Each `*.js` file here default-exports ONE song object in the song-book notation
documented at the top of `src/audio/songs.js`, with `id` equal to the file name:

```js
// src/audio/songs/bubblegum-bay.js
export default {
  id: 'bubblegum-bay',
  bpm: 120,
  instruments: { lead: 'bell', arp: 'pluck', pad: 'pad', bass: 'bass' },
  mix: { lead: 0.6, arp: 0.15, pad: 0.12, bass: 0.4, drums: 0.38 },
  kit: { A: 'k . h . s . h . k . h k s . h .' },
  main: { bassStyle: 'soft', arpStyle: 'musicbox', padStyle: 'whole', chords: ['C', 'Am', 'F', 'G'], drums: 'AAAA', lead: [/* 4 bars */] },
};
```

Songs are registered automatically (`import.meta.glob`), so a track builder can
give their track its own tune (`theme.music: 'bubblegum-bay'`) without editing
any shared file. `tests/audioSongs.test.js` compiles and checks every song.
Happy, major-key, never harsh.
