/**
 * Continuous driving sounds (OWNER: driving-feel workstream): a cute
 * putt-putt engine per human kart (pitch / volume from speed + throttle,
 * mixed down for 3-4 players), faint engines for CPU karts near a human,
 * the drift slide (pitch rises with the turbo level), off-road rustle voiced
 * per track surface, and state-machine cues (brake squeak, reverse
 * beep-beep). Everything fades out on pause / results and is stopped on
 * race-exit. Event one-shots (hop, land, turbo, bumps, pads) live in
 * drivingReactions.js.
 *
 * The logic is pure and exported for tests; the Web Audio voices come from
 * src/audio/sfx/driving.js and are only built once audio.sfxCore() exists.
 */
import { createEngineVoice, createSlideVoice, createRustleVoice, SLIDE_PITCH } from '../audio/sfx/driving.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Engine loudness per human, by how many humans are racing (3-4 players mix down). */
export function engineMix(humanCount) {
  const n = clamp(Math.round(num(humanCount, 1)), 1, 4);
  return [1, 0.8, 0.64, 0.55][n - 1];
}

/**
 * Engine voice parameters for a kart.
 * @param {{speed:number, maxSpeed:number, throttle:number, boosting?:boolean, offRoad?:boolean}} k
 * @returns {{freq:number, gain:number, putt:number, depth:number, cutoff:number}}
 */
export function engineParams({ speed = 0, maxSpeed = 30, throttle = 0, boosting = false, offRoad = false } = {}) {
  const sf = clamp(Math.abs(num(speed)) / Math.max(1, num(maxSpeed, 30)), 0, 1.4);
  const th = clamp(num(throttle), 0, 1);
  const freq = 70 + 120 * sf + 22 * th + (boosting ? 30 : 0) - (offRoad ? 8 : 0);
  return {
    freq,
    gain: 0.03 + 0.028 * Math.min(1, sf) + 0.022 * th + (boosting ? 0.01 : 0),
    putt: 7 + 22 * Math.min(1.2, sf), // putt-putt at idle, a whirr at speed
    depth: clamp(0.45 - 0.3 * sf, 0.1, 0.45),
    cutoff: 480 + 1500 * Math.min(1.2, sf) + 450 * th,
  };
}

/** Faint engine gain for a CPU kart `dist` metres from the nearest human (0 beyond 30 m). */
export function cpuEngineGain(dist) {
  const d = num(dist, Infinity);
  if (!(d < 30)) return 0;
  const f = 1 - d / 30;
  return 0.35 * f * f;
}

/** Drift slide voice parameters for a drift level 0..3 and speed fraction. */
export function slideParams(level, speedFrac = 1) {
  const l = clamp(num(level) | 0, 0, 3);
  const sf = clamp(num(speedFrac, 1), 0, 1.3);
  return { gain: (0.022 + 0.008 * l) * (0.5 + 0.5 * Math.min(1, sf)), sing: SLIDE_PITCH[l], hiss: 1500 + l * 350 };
}

/** Off-road voices per surface: freq / q of the noise band, flutter rate, loudness. */
export const SURFACES = Object.freeze({
  grass: Object.freeze({ freq: 1100, q: 0.9, flutter: 13, gain: 0.05 }), // leafy rustle
  sand: Object.freeze({ freq: 2600, q: 0.7, flutter: 20, gain: 0.04 }), // sandy hiss
  snow: Object.freeze({ freq: 1700, q: 1.4, flutter: 9, gain: 0.045 }), // soft crunch
  squish: Object.freeze({ freq: 380, q: 3.5, flutter: 7, gain: 0.06 }), // jelly / marshmallow squish
  space: Object.freeze({ freq: 900, q: 6, flutter: 4, gain: 0.03 }), // moon dust fizz
});

const SURFACE_WORDS = [
  ['snow', ['peppermint', 'aurora', 'ice', 'snow', 'sundae', 'frost']],
  ['sand', ['bay', 'beach', 'lagoon', 'canyon', 'sand', 'desert']],
  ['squish', ['jelly', 'gumdrop', 'marshmallow', 'pillow', 'honey', 'cocoa', 'donut', 'cupcake', 'teddy']],
  ['space', ['galaxy', 'moon', 'star', 'space', 'ribbon-sky']],
];

/** Which off-road surface a track sounds like (theme.surface wins, then id keywords, else grass). */
export function surfaceFor(trackDef) {
  const own = trackDef?.theme?.surface ?? trackDef?.surface;
  if (typeof own === 'string' && SURFACES[own]) return own;
  const id = String(trackDef?.id ?? '').toLowerCase();
  for (const [surface, words] of SURFACE_WORDS) if (words.some((w) => id.includes(w))) return surface;
  return 'grass';
}

/** Off-road rustle parameters (0 gain when on the road or crawling). */
export function rustleParams(surface, { offRoad = false, speed = 0, maxSpeed = 30 } = {}) {
  const sfc = SURFACES[surface] || SURFACES.grass;
  const sf = clamp(Math.abs(num(speed)) / Math.max(1, num(maxSpeed, 30)), 0, 1.2);
  const on = offRoad && sf > 0.08;
  return { gain: on ? sfc.gain * (0.4 + 0.6 * Math.min(1, sf)) : 0, freq: sfc.freq * (0.85 + 0.3 * Math.min(1, sf)), q: sfc.q, flutter: sfc.flutter * (0.6 + 0.6 * Math.min(1, sf)) };
}

/** Timing of the state-machine cues. */
export const CUES = Object.freeze({
  squeakMinSpeed: 8, // brake squeak only when actually slowing from speed
  squeakCooldown: 0.6,
  beepEvery: 0.55, // reverse beep-beep interval
  beepAfter: 0.15, // reversing this long before the first beep
});

export function createKartSoundState() {
  return { braking: false, squeakCd: 0, reverseFor: 0, beepIn: 0 };
}

/**
 * Advance one kart's sound state. Returns the one-shot cues to play this
 * frame: 'drive-brake-squeak' when braking starts from speed, and
 * 'drive-reverse-beep' at intervals while reversing.
 * @param {object} st from createKartSoundState()
 * @param {{speed:number, phys?:{braking?:boolean, reversing?:boolean}, spinning?:boolean}} kart
 * @param {number} dt
 * @returns {string[]}
 */
export function stepKartSound(st, kart, dt) {
  const cues = [];
  const d = clamp(num(dt), 0, 0.25);
  const p = kart?.phys || {};
  const speed = num(kart?.speed);
  st.squeakCd = Math.max(0, st.squeakCd - d);
  const braking = !!p.braking && !kart?.spinning;
  if (braking && !st.braking && speed > CUES.squeakMinSpeed && st.squeakCd <= 0) {
    cues.push('drive-brake-squeak');
    st.squeakCd = CUES.squeakCooldown;
  }
  st.braking = braking;
  if (p.reversing) {
    st.reverseFor += d;
    if (st.reverseFor >= CUES.beepAfter) {
      st.beepIn -= d;
      if (st.beepIn <= 0) {
        cues.push('drive-reverse-beep');
        st.beepIn = CUES.beepEvery;
      }
    }
  } else {
    st.reverseFor = 0;
    st.beepIn = 0;
  }
  return cues;
}

/** Every continuous voice is silent in these session states. */
export function shouldBeSilent(session) {
  return !session || !!session.paused || !!session.resultsShown || session.race?.state === 'finished';
}

const CPU_VOICES = 2;

/**
 * Pick the CPU karts nearest to any human (within 30 m): [{ kart, dist, human }].
 * @returns {Array<{kart:object, dist:number, human:object}>}
 */
export function nearestCpus(karts, humansKarts, n = CPU_VOICES) {
  const out = [];
  for (const k of karts || []) {
    if (!k?.isCPU || !k.position) continue;
    let best = Infinity, who = null;
    for (const h of humansKarts) {
      const d = Math.hypot(k.position.x - h.position.x, k.position.z - h.position.z);
      if (d < best) { best = d; who = h; }
    }
    if (best < 30) out.push({ kart: k, dist: best, human: who });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, n);
}

/**
 * The live mixer, separate from the bus wiring so tests can drive it with a
 * mock AudioContext.
 */
export function createDrivingMixer() {
  let core = null;
  let surface = 'grass';
  const players = new Map(); // playerIndex -> { engine, slide, rustle, st }
  const cpus = []; // [{ engine }]

  function stopAll() {
    for (const v of players.values()) { v.engine.stop(); v.slide.stop(); v.rustle.stop(); }
    for (const v of cpus) v.engine.stop();
    players.clear();
    cpus.length = 0;
    core = null;
  }

  function silenceAll() {
    if (!core) return;
    const t = core.ctx.currentTime;
    for (const v of players.values()) { v.engine.silence(t); v.slide.silence(t); v.rustle.silence(t); }
    for (const v of cpus) v.engine.silence(t);
  }

  function ensure(c, playerIndex) {
    if (core && core.ctx !== c.ctx) stopAll();
    core = c;
    let v = players.get(playerIndex);
    if (!v) {
      v = { engine: createEngineVoice(c), slide: createSlideVoice(c), rustle: createRustleVoice(c), st: createKartSoundState() };
      players.set(playerIndex, v);
    }
    return v;
  }

  return {
    get voiceCount() { return players.size * 3 + cpus.length; },
    get surface() { return surface; },
    setSurface(s) { surface = SURFACES[s] ? s : 'grass'; },
    reset() { stopAll(); },
    silence: silenceAll,
    /**
     * @param {object} c sfxCore()
     * @param {object} session race session (race, humans, panFor, sfx, paused, resultsShown)
     * @param {number} dt
     */
    frame(c, session, dt) {
      if (!c || !session?.race) return;
      if (shouldBeSilent(session)) { silenceAll(); return; }
      const race = session.race;
      const humans = session.humans || [];
      const mix = engineMix(humans.length);
      const t = c.ctx.currentTime;
      const humanKarts = [];
      for (const h of humans) {
        const k = race.getPlayerKart?.(h.playerIndex);
        if (!k) continue;
        humanKarts.push(k);
        const v = ensure(c, h.playerIndex);
        const pan = num(session.panFor?.(k), 0);
        const maxSpeed = k.stats?.maxSpeed ?? 30;
        const throttle = race.state === 'countdown' ? 0 : num(k.phys?.throttle);
        const e = engineParams({ speed: k.speed, maxSpeed, throttle, boosting: k.boosting, offRoad: k.offRoad });
        v.engine.set({ ...e, gain: e.gain * mix, pan }, t);
        const sf = Math.abs(num(k.speed)) / Math.max(1, maxSpeed);
        const sl = slideParams(k.driftLevel, sf);
        v.slide.set({ ...sl, gain: k.drifting ? sl.gain * mix : 0, pan }, t);
        const r = rustleParams(surface, { offRoad: k.offRoad && k.phys?.hopTime <= 0, speed: k.speed, maxSpeed });
        v.rustle.set({ ...r, gain: r.gain * mix, pan }, t);
        if (race.state === 'racing') {
          for (const cue of stepKartSound(v.st, k, dt)) session.sfx?.(cue, { pan, volume: 0.8 * mix + 0.2 });
        }
      }
      // Faint engines for CPU karts right next to a human.
      const near = nearestCpus(race.karts, humanKarts);
      while (cpus.length < near.length) cpus.push({ engine: createEngineVoice(c) });
      for (let i = 0; i < cpus.length; i++) {
        const n = near[i];
        if (!n) { cpus[i].engine.silence(t); continue; }
        const k = n.kart;
        const e = engineParams({ speed: k.speed, maxSpeed: k.stats?.maxSpeed ?? 30, throttle: 1, boosting: k.boosting, offRoad: k.offRoad });
        const side = clamp((k.lateral - n.human.lateral) / 12, -0.6, 0.6);
        const pan = clamp(num(session.panFor?.(n.human), 0) + side, -1, 1);
        // CPU engines sit a little lower so they read as "someone else".
        cpus[i].engine.set({ ...e, freq: e.freq * 0.92, gain: e.gain * cpuEngineGain(n.dist) * mix, pan }, t);
      }
    },
  };
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'driving-sounds',
  order: 50,
  install(bus, app) {
    const mixer = createDrivingMixer();
    const core = () => {
      try { return app?.audio?.sfxCore?.() ?? null; } catch { return null; }
    };
    const offs = [
      bus.on('race-start', (info, s) => {
        mixer.reset();
        mixer.setSurface(surfaceFor(s?.trackDef ?? { id: info?.trackId }));
      }),
      bus.on('race-frame', (dt, s) => {
        try { mixer.frame(core(), s, dt); } catch { /* a sound glitch never breaks the race */ }
      }),
      bus.on('race-pause', () => mixer.silence()),
      bus.on('race-end', () => mixer.silence()),
      bus.on('race-exit', () => mixer.reset()),
    ];
    return () => {
      offs.forEach((off) => off());
      mixer.reset();
    };
  },
};
