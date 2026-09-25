/**
 * Lookahead step sequencer ("A Tale of Two Clocks" style). The AudioManager
 * calls `scheduleUntil(ctx.currentTime + lookahead)` from a timer; each call
 * schedules every step whose start time falls inside the window.
 */
import { INSTRUMENTS, playDrum } from './instruments.js';
import { midiToFreq } from './theory.js';
import { STEPS_PER_BEAT } from './compile.js';

const TRACK_PAN = { lead: 0, counter: -0.3, arp: 0.3, pad: -0.2, bass: 0, drums: 0.05 };

export class Sequencer {
  /**
   * @param {{ctx: BaseAudioContext, noise: AudioBuffer, reverbIn: AudioNode}} core
   * @param {ReturnType<import('./compile.js').compileSong>} song compiled song
   * @param {{output: AudioNode, tempo?: number}} opts
   */
  constructor(core, song, { output, tempo = 1 }) {
    this.core = core;
    this.song = song;
    this.tempo = tempo;
    this.step = 0;
    this.nextTime = 0;
    this.running = false;
    this.stopAt = Infinity;

    const { ctx } = core;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(output);
    // Reverb sends go through their own fader so crossfades fade the tail too.
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    if (core.reverbIn) this.wet.connect(core.reverbIn);

    // Optional feedback echo for dreamy songs.
    let echoIn = null;
    if (song.echo) {
      const delay = ctx.createDelay(2);
      delay.delayTime.value = song.echo * (120 / song.bpm);
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      echoIn = ctx.createGain();
      echoIn.gain.value = 0.35;
      echoIn.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(this.gain);
      this._echo = { delay, fb, lp, echoIn };
    }

    // One bus per track: level, pan, reverb send.
    this.buses = {};
    for (const track of Object.keys(TRACK_PAN)) {
      const bus = ctx.createGain();
      bus.gain.value = 1;
      let tail = bus;
      if (typeof ctx.createStereoPanner === 'function' && TRACK_PAN[track]) {
        const p = ctx.createStereoPanner();
        p.pan.value = TRACK_PAN[track];
        bus.connect(p);
        tail = p;
      }
      tail.connect(this.gain);
      const sendAmt = song.reverb[track] ?? (track === 'drums' || track === 'bass' ? 0.04 : 0.2);
      if (core.reverbIn && sendAmt > 0) {
        const send = ctx.createGain();
        send.gain.value = sendAmt;
        tail.connect(send);
        send.connect(this.wet);
      }
      if (echoIn && (track === 'lead' || track === 'arp')) tail.connect(echoIn);
      this.buses[track] = bus;
    }
  }

  get stepDuration() {
    return 60 / (this.song.bpm * this.tempo) / STEPS_PER_BEAT;
  }

  /** Start playing at context time `when`, fading in over `fade` seconds. */
  start(when, fade = 0.4) {
    this.running = true;
    this.step = 0;
    this.nextTime = when;
    for (const g of [this.gain.gain, this.wet.gain]) {
      g.cancelScheduledValues(when);
      g.setValueAtTime(0.0001, when);
      g.linearRampToValueAtTime(1, when + Math.max(0.01, fade));
    }
  }

  /** Fade out and stop scheduling. */
  stop(when, fade = 0.6) {
    for (const g of [this.gain.gain, this.wet.gain]) {
      const v = g.value;
      g.cancelScheduledValues(when);
      g.setValueAtTime(v, when);
      g.linearRampToValueAtTime(0, when + Math.max(0.01, fade));
    }
    this.stopAt = when + fade;
  }

  /** @returns {boolean} true once fully faded out and finished. */
  get done() {
    return !this.running || this.core.ctx.currentTime > this.stopAt + 0.3;
  }

  setTempo(mult) {
    this.tempo = Math.max(0.5, Math.min(2, mult));
  }

  /** Disconnect everything (after stop). */
  dispose() {
    this.running = false;
    try {
      this.gain.disconnect();
      this.wet.disconnect();
      if (this._echo) {
        this._echo.fb.disconnect();
        this._echo.lp.disconnect();
      }
    } catch { /* ignore */ }
  }

  /** Schedule every step starting before `until` (context seconds). */
  scheduleUntil(until) {
    if (!this.running) return;
    const { ctx } = this.core;
    // Resync after the tab was throttled / context suspended — never burst.
    if (this.nextTime < ctx.currentTime - 0.08) this.nextTime = ctx.currentTime + 0.03;
    let guard = 0;
    while (this.nextTime < until && this.nextTime < this.stopAt && guard++ < 256) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += this.stepDuration;
      this.step++;
      if (this.step >= this.song.totalSteps) this.step = this.song.introSteps;
    }
  }

  _playStep(step, time) {
    const events = this.song.byStep[step];
    if (!events || events.length === 0) return;
    const sd = this.stepDuration;
    const swung = this.song.swing && step % 4 === 2 ? time + this.song.swing * sd : time;
    for (const e of events) {
      const dest = this.buses[e.track] || this.buses.lead;
      const vel = e.vel * e.gain;
      try {
        if (e.track === 'drums') {
          playDrum(this.core, dest, swung, e.drum, vel);
        } else {
          const inst = INSTRUMENTS[e.inst] || INSTRUMENTS.lead;
          inst(this.core, dest, swung, midiToFreq(e.midi), e.len * sd, vel);
        }
      } catch {
        // A single bad note must never break the music.
      }
    }
  }
}
