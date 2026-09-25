/**
 * Driving reactions: boosts (pads, drift turbos, Rocket Start; item boosts are
 * handled by itemReactions.js), hops / landings, drift start + turbos,
 * fence boings and kart bumps — one-shot sounds, HUD callouts and rumble.
 * OWNER: driving-feel workstream. The continuous engine / slide / rustle
 * sounds and brake / reverse cues live in drivingSounds.js ('race-frame').
 */
import { driftBoostText } from '../game/setup.js';

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'driving-reactions',
  order: 20,
  install(bus) {
    const offs = [
      bus.on('race:go', (e, s) => {
        // A happy "vrrrm" for every human who is on the gas at GO.
        for (const p of s?.humans || []) {
          const k = s.race?.getPlayerKart?.(p.playerIndex);
          if (k && s.isHuman(k) && k.phys?.prevAccel) s.sfx('drive-rev', { pan: s.panFor(k), volume: 0.9 });
        }
      }),
      bus.on('race:boost', (e, s) => {
        const k = e.kart;
        // Item boosts (Sprinkle Boost / Triple Sprinkle) belong to itemReactions.js.
        if (!s.isHuman(k) || e.source === 'item') return;
        s.sfx('boost', { pan: s.panFor(k) });
        s.rumble(k, 0.35, 160);
        if (e.source === 'start') {
          s.flash(k, 'Rocket Start! 🚀');
          s.sfx('drive-rocket-sparkle', { pan: s.panFor(k) });
        } else if (e.source === 'pad') {
          s.sfx('drive-pad-zing', { pan: s.panFor(k) });
        }
      }),
      bus.on('race:hop', (e, s) => {
        if (s.isHuman(e.kart)) s.sfx('drive-hop', { pan: s.panFor(e.kart), volume: 0.6 });
      }),
      bus.on('race:land', (e, s) => {
        if (s.isHuman(e.kart)) s.sfx('drive-land', { pan: s.panFor(e.kart), level: e.strength ?? 0.5, volume: 0.7 });
      }),
      bus.on('race:drift-start', (e, s) => {
        if (s.isHuman(e.kart)) s.sfx('drive-drift-squeal', { pan: s.panFor(e.kart), volume: 0.8 });
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
        const strength = e.strength || 0.3;
        if (e.wall) {
          s.sfx('drive-wall-boing', { volume: 0.4 + 0.6 * strength, pan: s.panFor(k) });
        } else {
          const who = s.isHuman(k) ? k : e.other;
          s.sfx('bump', { volume: 0.4 + 0.6 * strength, pan: s.panFor(who) });
          s.sfx('drive-honk', { volume: 0.5 + 0.4 * strength, pan: s.panFor(who) });
        }
        s.rumble(k, 0.2 + 0.5 * (e.strength || 0), 90);
        if (s.isHuman(e.other)) s.rumble(e.other, 0.2 + 0.5 * (e.strength || 0), 90);
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};
