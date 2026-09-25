/**
 * Low-level Web Audio building blocks shared by instruments, SFX and voices.
 * Every helper schedules nodes at an absolute context time and lets them be
 * garbage-collected after they stop.
 */

const MIN = 0.0001;

/** Soft white-noise buffer (reused for all noisy sounds). */
export function createNoiseBuffer(ctx, seconds = 2) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Warm stereo reverb impulse: decaying, gently low-passed noise. */
export function createImpulse(ctx, seconds = 1.8, decay = 3.2) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      lp += (white - lp) * 0.35; // one-pole low-pass = softer, less hissy tail
      d[i] = lp * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/**
 * Schedule an amplitude envelope.
 *  shape 'perc': quick attack then exponential decay over `dur`.
 *  shape 'sustain': attack, decay to `sustain * vol`, hold until `dur`, then release.
 * @returns {number} time when the sound is fully silent
 */
export function envelope(param, t, { attack = 0.005, vol = 0.3, dur = 0.2, release = 0.08, shape = 'sustain', sustain = 1, decay = 0.1 }) {
  vol = Math.max(MIN, vol);
  attack = Math.max(0.001, attack);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(vol, t + attack);
  if (shape === 'perc') {
    param.exponentialRampToValueAtTime(MIN, t + attack + Math.max(0.01, dur));
    param.setValueAtTime(0, t + attack + Math.max(0.01, dur) + 0.001);
    return t + attack + dur + 0.01;
  }
  if (sustain < 1) param.setTargetAtTime(vol * sustain, t + attack, Math.max(0.005, decay / 3));
  const end = Math.max(t + attack, t + dur);
  param.setTargetAtTime(0, end, Math.max(0.005, release / 4));
  return end + release * 1.3;
}

function applyFilter(ctx, t, input, f, dur) {
  if (!f) return input;
  const filt = ctx.createBiquadFilter();
  filt.type = f.type || 'lowpass';
  filt.frequency.setValueAtTime(f.freq, t);
  if (f.freqEnd) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f.freqEnd), t + (f.time ?? dur));
  if (f.Q != null) filt.Q.value = f.Q;
  input.connect(filt);
  return filt;
}

/**
 * One enveloped oscillator note.
 * @param {object} o { t, type, freq, freqEnd, glideTime, glide:'exp'|'linear', dur, attack, release,
 *                     vol, shape, sustain, decay, detune, vibrato:{rate, depth(ratio), delay},
 *                     filter:{type,freq,freqEnd,time,Q}, pan }
 */
export function tone(ctx, dest, o) {
  const t = o.t ?? ctx.currentTime;
  const dur = o.dur ?? 0.2;
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  const f0 = Math.max(20, o.freq);
  osc.frequency.setValueAtTime(f0, t);
  if (o.freqEnd) {
    const endT = t + (o.glideTime ?? dur);
    if (o.glide === 'linear') osc.frequency.linearRampToValueAtTime(Math.max(20, o.freqEnd), endT);
    else osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), endT);
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);

  const g = ctx.createGain();
  const end = envelope(g.gain, t, { ...o, dur });

  let lfo = null;
  if (o.vibrato) {
    lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(o.vibrato.rate || 5.5, t);
    const depth = ctx.createGain();
    const delay = o.vibrato.delay || 0;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f0 * (o.vibrato.depth || 0.01), t + delay + 0.08);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end + 0.05);
  }

  const out = applyFilter(ctx, t, osc, o.filter, dur);
  out.connect(g);
  connectPanned(ctx, g, dest, o.pan, t);
  osc.start(t);
  osc.stop(end + 0.05);
  return end;
}

/** Enveloped burst of filtered noise. */
export function noise(ctx, dest, buffer, o) {
  const t = o.t ?? ctx.currentTime;
  const dur = o.dur ?? 0.1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  if (o.rate) src.playbackRate.setValueAtTime(o.rate, t);
  const g = ctx.createGain();
  const end = envelope(g.gain, t, { shape: 'perc', ...o, dur });
  const out = applyFilter(ctx, t, src, o.filter, dur);
  out.connect(g);
  connectPanned(ctx, g, dest, o.pan, t);
  const offset = Math.random() * Math.max(0, buffer.duration - 0.5);
  src.start(t, offset);
  src.stop(end + 0.05);
  return end;
}

/** Connect `node` to `dest`, through a stereo panner if a pan is given & supported. */
export function connectPanned(ctx, node, dest, pan, t = ctx.currentTime) {
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t);
    node.connect(p);
    p.connect(dest);
    return p;
  }
  node.connect(dest);
  return node;
}

/** Semitones -> frequency ratio. */
export const semi = (n) => Math.pow(2, n / 12);
