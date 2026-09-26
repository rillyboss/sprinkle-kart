// Strict mock Web Audio for the driving-sound tests: validates the arguments a
// real browser would reject (non-finite values, bad ramps, double start) and
// records sources / params so tests can check lifecycles.
export function makeMockAudio() {
  const stats = { nodes: 0, started: 0, stopped: 0, errors: [], sources: [], gains: [] };
  let now = 0;
  const check = (cond, msg) => { if (!cond) { stats.errors.push(msg); throw new Error(msg); } };
  const finite = (v, what) => check(Number.isFinite(v), `${what} not finite: ${v}`);

  class Param {
    constructor(v = 0) { this.value = v; this.target = v; this.events = []; }
    _t(t, name) { finite(t, `${name} time`); check(t >= 0, `${name} negative time`); }
    setValueAtTime(v, t) { finite(v, 'setValueAtTime value'); this._t(t, 'setValueAtTime'); this.value = v; this.target = v; this.events.push(['set', v, t]); return this; }
    linearRampToValueAtTime(v, t) { finite(v, 'linearRamp value'); this._t(t, 'linearRamp'); this.target = v; this.events.push(['lin', v, t]); return this; }
    exponentialRampToValueAtTime(v, t) {
      finite(v, 'expRamp value'); this._t(t, 'expRamp');
      check(v > 0, `expRamp to non-positive ${v}`);
      this.target = v; this.events.push(['exp', v, t]); return this;
    }
    setTargetAtTime(v, t, tc) {
      finite(v, 'setTarget value'); this._t(t, 'setTarget'); finite(tc, 'timeConstant'); check(tc > 0, 'timeConstant <= 0');
      this.target = v; this.events.push(['target', v, t]); return this;
    }
    cancelScheduledValues(t) { this._t(t, 'cancel'); return this; }
  }
  class Node {
    constructor() { stats.nodes++; this.outputs = []; this.disconnected = false; }
    connect(n) { check(n && (n instanceof Node || n instanceof Param), 'connect to non-node'); this.outputs.push(n); return n; }
    disconnect() { this.outputs = []; this.disconnected = true; }
  }
  class Source extends Node {
    constructor() { super(); stats.sources.push(this); }
    start(t = 0) { finite(t, 'start'); check(!this._started, 'start twice'); this._started = true; this._startT = t; stats.started++; }
    stop(t = 0) { finite(t, 'stop'); check(this._started, 'stop before start'); check(t >= this._startT, 'stop before start time'); check(!this._stopped, 'stop twice'); this._stopped = true; stats.stopped++; }
  }
  const ctx = {
    sampleRate: 44100,
    state: 'running',
    get currentTime() { return now; },
    destination: new Node(),
    advance(dt) { now += dt; },
    createGain() { const n = new Node(); n.gain = new Param(1); stats.gains.push(n); return n; },
    createOscillator() { const n = new Source(); n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0); return n; },
    createBufferSource() { const n = new Source(); n.buffer = null; n.loop = false; n.playbackRate = new Param(1); return n; },
    createBiquadFilter() { const n = new Node(); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); return n; },
    createStereoPanner() { const n = new Node(); n.pan = new Param(0); return n; },
    createBuffer(ch, len, sr) {
      check(len > 0, 'empty buffer');
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
    },
  };
  const noise = ctx.createBuffer(1, 44100, 44100);
  const out = ctx.createGain();
  const wet = ctx.createGain();
  return { ctx, stats, core: { ctx, noise, out, wet } };
}
