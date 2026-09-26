/**
 * Race-flow reactions: countdown beeps, GO, lap / final-lap callouts (+ music
 * tempo), finish and win celebrations. OWNER: modes + timing workstream.
 */

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'race-flow-reactions',
  order: 10,
  install(bus, app) {
    let tempoUp = false;
    const offs = [
      bus.on('race-start', () => { tempoUp = false; }),
      bus.on('race:countdown', (e, s) => s.sfx('countdown', { n: e.n })),
      bus.on('race:go', (e, s) => s.sfx('go')),
      bus.on('race:lap', (e, s) => {
        const k = e.kart;
        if (s.isHuman(k) && e.lap < s.race.lapsTotal) {
          s.sfx('lap', { pan: s.panFor(k) });
          s.flash(k, `Lap ${e.lap}! 🍭`);
        }
      }),
      bus.on('race:final-lap', (e, s) => {
        if (!s.isHuman(e.kart)) return;
        s.sfx('final-lap', { pan: s.panFor(e.kart) });
        if (!tempoUp) {
          tempoUp = true;
          try { app.audio?.setMusicTempo?.(1.12); } catch { /* ignore */ }
        }
      }),
      // every CPU is home: cheer on whoever is still driving (the race wraps up after e.seconds)
      bus.on('race:keep-going', (e, s) => {
        for (const k of e.karts || []) if (s.isHuman(k)) s.flash(k, 'Keep going, you can do it! 💪');
      }),
      bus.on('race:finish', (e, s) => {
        const k = e.kart;
        if (!s.isHuman(k)) return;
        const pan = s.panFor(k);
        if (e.place === 1) {
          s.sfx('win', { pan });
          s.voice(k, 'win');
          s.rumble(k, 0.6, 500);
        } else {
          s.sfx('finish', { pan });
          s.voice(k, 'yay');
          s.rumble(k, 0.4, 250);
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};
