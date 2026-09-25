/**
 * Driving reactions: boosts (pads, drift turbos, Rocket Start; item boosts are
 * handled by itemReactions.js), drift sparks and
 * drift turbos, kart-kart bumps — sounds, HUD callouts and rumble.
 * OWNER: driving-feel workstream. Per-frame engine / tyre / brake sounds go in
 * their own system file (e.g. src/systems/drivingSounds.js) via 'race-frame'.
 */
import { driftBoostText } from '../game/setup.js';

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'driving-reactions',
  order: 20,
  install(bus) {
    const offs = [
      bus.on('race:boost', (e, s) => {
        const k = e.kart;
        // Item boosts (Sprinkle Boost / Triple Sprinkle) belong to itemReactions.js.
        if (!s.isHuman(k) || e.source === 'item') return;
        s.sfx('boost', { pan: s.panFor(k) });
        s.rumble(k, 0.35, 160);
        if (e.source === 'start') s.flash(k, 'Rocket Start! 🚀');
      }),
      bus.on('race:drift-level', (e, s) => {
        if (s.isHuman(e.kart) && e.level > 0) s.sfx('drift-spark', { level: e.level, pan: s.panFor(e.kart), volume: 0.7 });
      }),
      bus.on('race:drift-boost', (e, s) => {
        const k = e.kart;
        if (!s.isHuman(k)) return;
        s.sfx('drift-boost', { level: e.level, pan: s.panFor(k) });
        s.flash(k, driftBoostText(e.level));
        s.rumble(k, 0.25 + e.level * 0.1, 140);
      }),
      bus.on('race:bump', (e, s) => {
        const k = e.kart;
        if (!s.isHuman(k) && !s.isHuman(e.other)) return;
        s.sfx('bump', { volume: 0.4 + 0.6 * (e.strength || 0.3), pan: s.panFor(k) });
        s.rumble(k, 0.2 + 0.5 * (e.strength || 0), 90);
        if (s.isHuman(e.other)) s.rumble(e.other, 0.2 + 0.5 * (e.strength || 0), 90);
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};
