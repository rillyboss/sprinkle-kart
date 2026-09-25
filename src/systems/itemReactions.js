/**
 * Item reactions: item-box roulette, getting and using items, item boosts
 * (race:boost with source 'item'), bonks, shield pops — sounds, HUD callouts and rumble. OWNER: power-up clarity workstream.
 */

const USE_SFX = { gumdrop: 'gumdrop', 'cupcake-rocket': 'rocket', 'rainbow-star': 'star', 'bubble-shield': 'bubble' };

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'item-reactions',
  order: 30,
  install(bus) {
    const offs = [
      bus.on('race:item-box', (e, s) => {
        if (s.isHuman(e.kart) && e.rolling) s.sfx('item-roulette', { pan: s.panFor(e.kart) });
      }),
      bus.on('race:item-get', (e, s) => {
        const k = e.kart;
        if (!s.isHuman(k)) return;
        s.sfx('item-get', { pan: s.panFor(k) });
        if (e.item === 'rainbow-star') s.voice(k, 'yay');
      }),
      bus.on('race:item-use', (e, s) => {
        if (!s.isHuman(e.kart)) return;
        const name = USE_SFX[e.item];
        if (name) s.sfx(name, { pan: s.panFor(e.kart) });
      }),
      bus.on('race:bonked', (e, s) => {
        const k = e.kart;
        if (s.isHuman(k)) {
          s.sfx('bonk', { pan: s.panFor(k) });
          s.voice(k, 'oops');
          s.flash(k, e.cause === 'star' ? 'Twirly-whirly! 🌈' : 'Bonk! 💫');
          s.rumble(k, 0.75, 320);
        }
        if (s.isHuman(e.by) && e.by !== k) s.flash(e.by, 'Boop! 🎯');
      }),
      bus.on('race:boost', (e, s) => {
        // Sprinkle boosts from items (pad / start / drift boosts are drivingReactions.js).
        const k = e.kart;
        if (e.source !== 'item' || !s.isHuman(k)) return;
        s.sfx('boost', { pan: s.panFor(k) });
        s.rumble(k, 0.35, 160);
      }),
      bus.on('race:shield-pop', (e, s) => {
        if (s.isHuman(e.kart)) s.sfx('bubble', { pan: s.panFor(e.kart), volume: 0.8 });
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};
