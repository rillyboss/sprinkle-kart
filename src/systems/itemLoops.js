/**
 * Item loops: the CONTINUOUS power-up sounds, paced every frame for each human:
 *   - roulette ticks that slow down with the slot (then itemReactions' "ta-da")
 *   - rocket warning: soft beeps that get faster + a whistle that rises in
 *     pitch and pans toward the rocket as it closes in
 *   - the twinkly Rainbow Star tune, bar after bar, while invincible
 *   - a soft shimmer every few seconds while a Bubble Shield is up
 *   - a jelly "boing" hint when a gumdrop is on the road just ahead
 * Everything stops on pause, finish and race exit. OWNER: power-up clarity.
 */
import { rouletteTicks, rouletteProgress, threatsFor, ROULETTE_TICKS } from '../ui/widgets/itemHudLogic.js';

export const STAR_BAR = 0.48; // seconds per bar of the star tune
export const SHIELD_HUM_EVERY = 3.2;
/** A gumdrop this far ahead (track units) and near your line gets a warning boing. */
export const GUMDROP_HINT = { min: 14, max: 42, lateral: 5 };

/** Fresh per-player loop state. */
export function createLoopState() {
  return { lastTick: 0, beepAcc: 0, starAcc: STAR_BAR, starBar: 0, humAcc: 0, warnedGumdrops: new WeakSet(), threatOn: false };
}

/**
 * Advance one player's loops by dt. Pure apart from the `play(name, opts)` /
 * `whistle(threat|null)` callbacks, so the pacing is unit-tested.
 * @returns {object} the (mutated) loop state
 */
export function stepLoops(st, kart, race, dt, { play, whistle = () => {}, pan = 0, path = null } = {}) {
  if (!kart || !race || kart.finished || race.state === 'finished') {
    whistle(null);
    st.threatOn = false;
    return st;
  }
  // roulette ticks
  if ((kart.itemRoulette ?? 0) > 0) {
    const tick = rouletteTicks(rouletteProgress(kart));
    if (tick > st.lastTick) play('item-roulette', { level: tick / ROULETTE_TICKS, pan });
    st.lastTick = tick;
  } else {
    st.lastTick = 0;
  }

  // rocket warning
  const th = threatsFor(kart, race.items?.rockets)[0] ?? null;
  if (th) {
    if (!st.threatOn) { st.beepAcc = th.interval; st.threatOn = true; }
    st.beepAcc += dt;
    if (st.beepAcc >= th.interval) {
      st.beepAcc = 0;
      play('item-threat-beep', { level: th.closeness, pan: clampPan(pan + Math.sin(th.bearing) * 0.6) });
    }
    whistle(th);
  } else {
    st.threatOn = false;
    whistle(null);
  }

  // star tune
  if (kart.starPower > 0) {
    st.starAcc += dt;
    if (st.starAcc >= STAR_BAR) {
      st.starAcc -= STAR_BAR;
      play('item-star-loop', { n: st.starBar++, pan, volume: 0.9 });
    }
  } else {
    st.starAcc = STAR_BAR;
    st.starBar = 0;
  }

  // shield shimmer
  if (kart.shielded) {
    st.humAcc += dt;
    if (st.humAcc >= SHIELD_HUM_EVERY) { st.humAcc = 0; play('item-shield-hum', { pan }); }
  } else {
    st.humAcc = 0;
  }

  // gumdrop ahead
  if (path && race.items?.gumdrops?.length) {
    for (const g of race.items.gumdrops) {
      if (g.owner === kart || st.warnedGumdrops.has(g)) continue;
      const ahead = path.delta(kart.s, g.s);
      if (ahead > GUMDROP_HINT.min && ahead < GUMDROP_HINT.max && Math.abs((g.lateral ?? 0) - (kart.lateral ?? 0)) < GUMDROP_HINT.lateral) {
        st.warnedGumdrops.add(g);
        play('item-gumdrop-wobble', { pan: clampPan(pan + Math.sign((g.lateral ?? 0) - (kart.lateral ?? 0)) * -0.3) });
      }
    }
  }
  return st;
}

const clampPan = (p) => Math.max(-1, Math.min(1, p));

/** Whistle pitch (Hz) / volume for a threat closeness 0..1. */
export function whistleParams(closeness) {
  const c = Math.max(0, Math.min(1, Number.isFinite(closeness) ? closeness : 0));
  return { freq: 620 + c * 1100, gain: 0.012 + c * c * 0.05 };
}

/** One continuous "incoming cupcake" whistle for a player (Web Audio nodes). */
function makeWhistle(core) {
  const { ctx } = core;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 9;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 18;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.value = 0;
  let pan = null;
  osc.connect(g);
  if (typeof ctx.createStereoPanner === 'function') {
    pan = ctx.createStereoPanner();
    g.connect(pan);
    pan.connect(core.out);
  } else {
    g.connect(core.out);
  }
  osc.start();
  lfo.start();
  return {
    set(th, basePan) {
      const t = ctx.currentTime;
      const p = whistleParams(th ? th.closeness : 0);
      osc.frequency.setTargetAtTime(p.freq, t, 0.08);
      g.gain.setTargetAtTime(th ? p.gain : 0, t, th ? 0.08 : 0.05);
      if (pan && th) pan.pan.setTargetAtTime(clampPan(basePan + Math.sin(th.bearing) * 0.7), t, 0.08);
    },
    stop() {
      try {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.03);
        osc.stop(t + 0.2);
        lfo.stop(t + 0.2);
      } catch { /* ignore */ }
    },
  };
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'item-loops',
  order: 34,
  install(bus, app = {}) {
    const loops = new Map(); // playerIndex -> loop state
    const whistles = new Map(); // playerIndex -> whistle
    const stopAll = () => {
      for (const w of whistles.values()) w.stop();
      whistles.clear();
    };
    const whistleFor = (pi, s, kart) => (th) => {
      let w = whistles.get(pi);
      if (!th) { if (w) w.set(null, 0); return; }
      if (!w) {
        const core = app.audio?.sfxCore?.() ?? s.audio?.sfxCore?.() ?? null;
        if (!core) return;
        try { w = makeWhistle(core); } catch { return; }
        whistles.set(pi, w);
      }
      w.set(th, s.panFor(kart));
    };
    const offs = [
      bus.on('race-start', () => { loops.clear(); stopAll(); }),
      bus.on('race-pause', () => { for (const w of whistles.values()) w.set(null, 0); }),
      bus.on('race-exit', () => { loops.clear(); stopAll(); }),
      bus.on('race-frame', (dt, s) => {
        if (!s?.race || s.paused || s.resultsShown) {
          for (const w of whistles.values()) w.set(null, 0);
          return;
        }
        for (const h of s.humans ?? []) {
          const kart = s.race.getPlayerKart?.(h.playerIndex);
          if (!kart) continue;
          let st = loops.get(h.playerIndex);
          if (!st) loops.set(h.playerIndex, (st = createLoopState()));
          stepLoops(st, kart, s.race, dt, {
            play: (name, opts) => s.sfx(name, opts),
            whistle: whistleFor(h.playerIndex, s, kart),
            pan: s.panFor(kart),
            path: s.path ?? s.race.path ?? null,
          });
        }
      }),
    ];
    return () => { offs.forEach((off) => off()); stopAll(); };
  },
};
