/**
 * Item reactions: the SOUND, rumble and music-duck side of every item event —
 * box hit, roulette start, "ta-da" reveal, each item's own use sound, item
 * boosts (race:boost with source 'item'), impacts (one sound per cause),
 * shield blocks, dodges and effects ending. OWNER: power-up clarity workstream.
 *
 * Which sound goes with which event lives in src/race/itemCatalog.js
 * (cueFor(event, item)); HUD callouts are src/systems/itemCallouts.js and the
 * continuous sounds (roulette ticks, rocket warning, star tune) are
 * src/systems/itemLoops.js.
 */
import { cueFor } from '../race/itemCatalog.js';

/** @deprecated kept for older imports: item -> its use sound. */
export const USE_SFX = { gumdrop: 'gumdrop', 'cupcake-rocket': 'rocket', 'rainbow-star': 'star', 'bubble-shield': 'bubble', 'sprinkle-boost': 'item-use-sprinkle', 'triple-sprinkle': 'item-use-triple' };

/** Duck the music a little for an important cue (safe on any audio object). */
export function duck(s, cue) {
  if (!cue?.duck) return;
  try { s.audio?.duckMusic?.(cue.duck, 0.5); } catch { /* ignore */ }
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'item-reactions',
  order: 30,
  install(bus) {
    const play = (s, kart, cue, extra = {}) => {
      if (!cue?.sfx) return;
      s.sfx(cue.sfx, { pan: s.panFor(kart), ...extra });
      duck(s, cue);
    };
    const offs = [
      bus.on('race:item-box', (e, s) => {
        if (!s.isHuman(e.kart)) return;
        play(s, e.kart, cueFor('box-hit'));
        if (e.rolling) play(s, e.kart, cueFor('roulette'), { level: 0 });
      }),
      bus.on('race:item-get', (e, s) => {
        const k = e.kart;
        if (!s.isHuman(k)) return;
        play(s, k, cueFor('reveal', e.item));
        s.rumble(k, 0.2, 90);
        if (e.item === 'rainbow-star') s.voice(k, 'yay');
      }),
      bus.on('race:item-use', (e, s) => {
        if (!s.isHuman(e.kart)) return;
        play(s, e.kart, cueFor('use', e.item), e.item === 'triple-sprinkle' ? { level: e.chargesLeft ?? 0 } : {});
      }),
      bus.on('race:bonked', (e, s) => {
        const k = e.kart;
        const cue = cueFor('impact', e.cause) ?? { sfx: 'bonk', duck: 0.6 };
        if (s.isHuman(k)) {
          play(s, k, cue);
          s.voice(k, 'oops');
          s.rumble(k, 0.75, 320);
        }
        if (s.isHuman(e.by) && e.by !== k) {
          s.sfx('item-bonk-score', { pan: s.panFor(e.by), volume: 0.9 });
          s.rumble(e.by, 0.2, 80);
        }
      }),
      bus.on('race:boost', (e, s) => {
        // Sprinkle boosts from items (pad / start / drift boosts are drivingReactions.js).
        const k = e.kart;
        if (e.source !== 'item' || !s.isHuman(k)) return;
        s.sfx('boost', { pan: s.panFor(k) });
        s.rumble(k, 0.35, 160);
      }),
      bus.on('race:shield-pop', (e, s) => {
        const k = e.kart;
        if (e.expired) {
          if (s.isHuman(k)) play(s, k, cueFor('end', 'bubble-shield'), { volume: 0.8 });
          return;
        }
        const cue = cueFor('blocked', e.cause) ?? cueFor('blocked', 'bubble-shield');
        if (s.isHuman(k)) {
          play(s, k, cue);
          s.rumble(k, 0.4, 150);
        }
        if (s.isHuman(e.by) && e.by !== k) s.sfx(cue.sfx, { pan: s.panFor(e.by), volume: 0.55 });
      }),
      bus.on('race:item-dodged', (e, s) => {
        if (s.isHuman(e.kart)) play(s, e.kart, cueFor('dodged', e.item) ?? { sfx: 'item-dodge' });
      }),
      bus.on('race:item-end', (e, s) => {
        const k = e.kart;
        if (!s.isHuman(k)) return;
        const cue = cueFor('end', e.item);
        if (cue) s.sfx(cue.sfx, { pan: s.panFor(k), volume: e.item === 'gumdrop' ? 0.4 : 0.8 });
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};
