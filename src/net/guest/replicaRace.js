/**
 * ReplicaRace — the guest's stand-in for Race (NETWORKING.md §9.1, §9.5–9.7, §16 WS5). It offers the Race
 * READ API every presentation system, camera and HUD already uses (karts, getPlayerKart, getStandings with
 * host places, state, countdown, time, clock, lapsTotal, path, racingLine, rules, modeInfo, gameplay, lastDt,
 * items.bursts, rng: null), but simulates nothing authoritative:
 *
 *   own karts        timeline P = T_est + lead: predicted by predictTick with local inputs, reconciled on
 *                    every snapshot (replay S+1..P jointly, emit off), drawn with a decaying error offset
 *   everything else  timeline R = T_est − oneWay − interp: remote karts, CPUs, gumdrops, rockets, boxes,
 *                    drawn from the snapshot buffer (Hermite/slerp, extrapolate ≤ 250 ms, freeze, blend back)
 *   countdown / GO   from P ((goTick − P)/60), emitted as predicted events; host copies dropped
 *   live place       host standings of the NEWEST snapshot (never mixed-timeline distances)
 *   finish / laps    host events (the finish celebration waits for the host's `finish`)
 *
 * An own kart that the host marks `roboDriven` (or that finished: the host's CPU brain drives it home) is
 * drawn like a remote kart; when Robo Driver lets go, prediction re-seeds from the newest snapshot, the
 * input history before it is cleared, the press baseline resets and the kart snaps.
 *
 * Injected (WS1 / WS2 / WS7 provide them; tests pass stand-ins):
 *   predictTick(localKarts, inputs, ctx)  §8.5    quantize(wireInput) → wireInput (the INPUT codec's rounding)
 *   countdownAfter(raceTick)              the host's float countdown after race tick r (default (go − r)/60)
 *   itemView / boxView / bursts           presentation adapters (default: none)
 */
import { createKart } from '../../race/Kart.js';
import { aiDriveInput } from '../../race/Race.js';
import { computeRacingLine } from '../../race/AI.js';
import { normalizeGameplay } from '../../race/gameplay.js';
import { normalizeRules } from '../../modes/rules.js';
import { SPEED_CLASSES, DEFAULT_LAPS } from '../../config.js';
import { getCharacter } from '../../data/characters.js';
import { createSnapshotBuffer, sampleKartPose, createPoseSmoother, createInterpDelay, createArrivalStats } from './interpolation.js';
import { createReconciler, applyKartRecord } from './reconcile.js';
import { createEventPlayer } from './eventPlayer.js';
import { createReplicaItems } from './replicaItems.js';
import { createInputHistory, createLocalResolver } from './inputHistory.js';

export const GRID_SPACING = 6.3; // Race.js GRID_SPACING (metres between grid slots)
const TICK_DT = 1 / 60;
const NO_KART = 255;

function lookupCharacter(id) {
  try { return getCharacter(id) || null; } catch { return null; }
}

const NOOP_BURSTS = Object.freeze({ emit() {}, update() {}, dispose() {}, parts: { blob: [], star: [] } });

export class ReplicaRace {
  /**
   * @param {object} o
   * @param {object} o.scene
   * @param {object} o.trackDef
   * @param {object} o.path
   * @param {object} [o.builtTrack]
   * @param {object} o.setup   NetRaceSetup: { participants: [{ characterId, playerIndex, gridSlot?, easyDrive?, paintId? }],
   *                           laps?, speedClass?, rules?, startTick?, goTick?, raceId? }
   * @param {number[]} o.localKartIds   this machine's karts in seat order
   * @param {Function} [o.buildKartModel]   (charDef, participant) → model
   * @param {Function} [o.onEvent]          presentation events (kart objects, predicted flag on local predictions)
   * @param {Function} o.predictTick
   * @param {Function} [o.quantize]
   * @param {Function} [o.countdownAfter]
   */
  constructor({
    scene = null, trackDef = {}, path, builtTrack = null, setup = {}, localKartIds = [], buildKartModel = null, onEvent = null,
    predictTick, quantize = (x) => x, countdownAfter = null, itemView = null, boxView = null, bursts = null,
  }) {
    this.scene = scene;
    this.trackDef = trackDef;
    this.path = path;
    this.builtTrack = builtTrack;
    this.setup = setup;
    this.onEvent = onEvent;
    this.rules = normalizeRules(setup.rules);
    this.modeInfo = {};
    this.speedClass = typeof setup.speedClass === 'string'
      ? (SPEED_CLASSES[setup.speedClass] || SPEED_CLASSES.zippy)
      : (setup.speedClass || SPEED_CLASSES.zippy);
    this.lapsTotal = Math.max(1, setup.laps ?? trackDef.laps ?? DEFAULT_LAPS);
    this.gameplay = normalizeGameplay(trackDef.gameplay);
    this.racingLine = computeRacingLine(path);
    const L = path.length;
    this.boostPads = (builtTrack?.boostPads ?? (trackDef.boostPads || []).map((b) => ({
      s: path.wrap(b.at * L), lateral: b.lateral ?? 0, length: 6, halfWidth: 2.5,
    }))).map((b) => ({ length: 6, halfWidth: 2.5, ...b }));
    this.rng = null;
    this.lastDt = TICK_DT;
    this.state = 'countdown';
    this.countdown = 3;
    this.time = 0;
    this.clock = 0;
    this.startTick = setup.startTick ?? 1;
    this.goTick = setup.goTick ?? this.startTick + 179;
    this._predictTick = predictTick;
    this._quantize = quantize;
    this._countdownAfter = countdownAfter;

    const hw = path.halfWidth;
    const lane = Math.min(3.4, hw - 1.6);
    this.karts = (setup.participants || []).map((pt, i) => {
      const charDef = lookupCharacter(pt.characterId);
      const slot = Number.isInteger(pt.gridSlot) ? pt.gridSlot : i;
      const kart = createKart({
        id: i, participant: pt, charDef, speedClass: this.speedClass, lapsTotal: this.lapsTotal, path,
        gridS: -7 - slot * GRID_SPACING, gridLat: i % 2 === 0 ? -lane : lane,
      });
      kart.gridSlot = slot;
      kart.roboDriven = false;
      kart.finishEstimated = false;
      kart.place = i + 1;
      kart.render = { position: kart.position.clone(), heading: kart.heading, spinAngle: 0, pitch: 0, roll: 0, hopY: 0 };
      if (buildKartModel) {
        kart.model = buildKartModel(charDef || { id: pt.characterId, name: kart.name, colors: {}, stats: {} }, pt);
        if (kart.model?.group) {
          kart.model.group.rotation.order = 'YXZ';
          scene?.add?.(kart.model.group);
        }
      }
      if (this.rules.startItem && !kart.isCPU) { kart.item = this.rules.startItem; kart.itemCharges = this.rules.startItemCharges; }
      return kart;
    });
    this.localKartIds = localKartIds.filter((id) => this.karts[id]);
    this._local = new Set(this.localKartIds);
    this._standings = [...this.karts];

    this.buffer = createSnapshotBuffer({ capacity: 32 });
    this.arrivals = createArrivalStats();
    this.interp = createInterpDelay();
    this.reconciler = createReconciler();
    this.history = createInputHistory();
    this.resolver = createLocalResolver(this.localKartIds.length);
    this._smoothers = new Map(this.karts.map((k) => [k.id, createPoseSmoother()]));
    this._prevPose = new Map();
    this._predicting = new Set(this.localKartIds); // own karts currently predicted (not Robo-driven)
    this._auto = new Set(); // own karts that finished: the host's CPU brain drives them home, we autopilot the prediction
    this._bumpTimes = new Map();
    this._countdownShown = 4;
    this._goEmitted = false;
    this.predictedTick = this.startTick - 1; // P: the newest predicted tick
    this.renderTick = 0; // R
    this._lastReconciled = -1;
    this._newestSnapTick = -1;
    this._newest = null;
    this.hostFinished = false;
    this.completeTick = null;
    /** Host-confirmed results, from events: kartId → { place, finishTimeMs, estimated } and lap times (ms). */
    this.finishes = new Map();
    this.lapTimesMs = this.karts.map(() => []);
    this.appliedSeqs = []; // seqs released to presentation
    this.acceptedSeqs = []; // every seq accepted once (released or dropped as locally predicted)
    this.stats = { predicted: 0, reseeds: 0, roboOn: 0, snapshots: 0, stale: 0, frames: 0 };

    this.itemsReplica = createReplicaItems({ itemView, boxView });
    const replica = this;
    this.items = {
      bursts: bursts || NOOP_BURSTS,
      get gumdrops() { return replica.itemsReplica.gumdrops; },
      get rockets() { return replica.itemsReplica.rockets; },
      dispose() {},
    };
    this.events = createEventPlayer({
      isMine: (id) => this._predicting.has(id),
      onEvent: (e) => this._releaseEvent(e),
      onGap: (expected, got) => { this.stats.gaps = (this.stats.gaps || 0) + 1; this.onGap?.(expected, got); },
      onAccept: (e) => { this.acceptedSeqs.push(e.seq); if (this.acceptedSeqs.length > 100000) this.acceptedSeqs.splice(0, 50000); },
    });
  }

  // ------------------------------------------------------------------ read API
  getStandings() { return this._standings.slice(); }

  getPlayerKart(playerIndex) { return this.karts.find((k) => k.playerIndex === playerIndex) || null; }

  isPredicted(kartId) { return this._predicting.has(kartId); }

  /** Own kart that finished and now rolls on with the local autopilot. */
  isAutopiloted(kartId) { return this._auto.has(kartId); }

  get interpDelayMs() { return this.interp.ms; }

  // ------------------------------------------------------------------ timing from the host
  /** START: which host ticks the race starts and says GO on. */
  setStart({ startTick, goTick }) {
    this.startTick = startTick;
    this.goTick = goTick;
    if (this.predictedTick < startTick - 1) this.predictedTick = startTick - 1;
  }

  /**
   * The host timeline moved back a long way (catch-up skip / starved host): stop predicting the future we
   * guessed, continue from `tick`; the next snapshot re-seeds the karts (a > 4 m correction snaps).
   */
  rewind(tick) {
    if (tick >= this.predictedTick) return;
    this.predictedTick = tick;
    this.stats.rewinds = (this.stats.rewinds || 0) + 1;
  }

  _countdownAt(tick) {
    const r = tick - this.startTick + 1;
    const goR = this.goTick - this.startTick + 1;
    if (this._countdownAfter) return this._countdownAfter(r);
    return Math.max(0, (goR - r) / 60);
  }

  _ctxFor(tick, emit) {
    return {
      path: this.path, boostPads: this.boostPads, gameplay: this.gameplay, rules: this.rules, tick,
      startTick: this.startTick, goTick: this.goTick, countdownAfter: this._countdownAfter, emit,
      bumpTimes: this._bumpTimes, lapsTotal: this.lapsTotal, time: Math.max(0, (tick - this.goTick) / 60),
    };
  }

  _predictedKarts() {
    return this.localKartIds.filter((id) => this._predicting.has(id)).map((id) => this.karts[id]);
  }

  /** Resolved inputs of the predicted karts for `tick` from the history (null if missing). */
  _inputsFor(tick) {
    const e = this.history.get(tick);
    if (!e) return null;
    const out = [];
    this.localKartIds.forEach((id, seat) => { if (this._predicting.has(id)) out.push(e.resolved[seat]); });
    return out;
  }

  // ------------------------------------------------------------------ per frame
  /**
   * Predict up to tick `P` and move the remote timeline to `R`.
   * @param {number} frameDt seconds
   * @param {(tick: number) => object[]} sample   local seats' PlayerTickInput for a tick (seat order)
   * @param {{ P: number, R: number, maxTicks?: number }} timing
   * @returns {number[]} the ticks predicted this frame
   */
  frame(frameDt, sample, { P, R, maxTicks = 12 } = {}) {
    this.stats.frames++;
    this.clock += frameDt;
    const ticks = [];
    if (Number.isFinite(P)) {
      let target = Math.floor(P);
      if (target - this.predictedTick > maxTicks) {
        // far behind (tab stall / first frame): jump without predicting the gap
        this.predictedTick = target - maxTicks;
      }
      while (this.predictedTick < target) {
        const tick = this.predictedTick + 1;
        this._predictOne(tick, sample);
        this.predictedTick = tick;
        ticks.push(tick);
      }
    }
    if (Number.isFinite(R)) this.renderTick = R;
    this._updateTimeline();
    this.reconciler.decay(frameDt * 1000);
    this.events.release(this.renderTick);
    return ticks;
  }

  _predictOne(tick, sample) {
    const wire = (sample ? sample(tick) : null) || this.localKartIds.map(() => ({ steer: 0, accel: 0, brake: 0, drift: false, itemCount: 0, hopCount: 0 }));
    const q = wire.map((x) => this._quantize(x));
    const resolved = this.resolver.resolve(tick, q);
    // a finished own kart keeps rolling on P with a local autopilot (the host drives it with its CPU brain),
    // so the camera never hops back to the remote timeline at the finish line
    this.localKartIds.forEach((id, seat) => {
      if (this._auto.has(id) && this._predicting.has(id)) resolved[seat] = { ...aiDriveInput(this, this.karts[id], TICK_DT), useItem: false };
    });
    this.history.put(tick, q, resolved);
    const karts = this._predictedKarts();
    if (!karts.length) return;
    for (const k of karts) this._prevPose.set(k.id, { x: k.position.x, y: k.position.y, z: k.position.z, heading: k.heading });
    const inputs = [];
    this.localKartIds.forEach((id, seat) => { if (this._predicting.has(id)) inputs.push(resolved[seat]); });
    const emit = (e) => this._emit({ ...e, predicted: true });
    this._predictTick(karts, inputs, this._ctxFor(tick, emit));
    this.stats.predicted++;
  }

  _updateTimeline() {
    const P = this.predictedTick;
    if (!this.hostFinished) {
      if (P < this.goTick) {
        this.state = 'countdown';
        this.countdown = this._countdownAt(P);
        for (const n of [3, 2, 1]) {
          if (this._countdownShown > n && this.countdown <= n) {
            this._countdownShown = n;
            this._emit({ type: 'countdown', n, predicted: true });
          }
        }
      } else {
        if (!this._goEmitted) {
          this._goEmitted = true;
          this._countdownShown = 0;
          this._emit({ type: 'go', predicted: true });
        }
        this.state = 'racing';
        this.countdown = 0;
        this.time = (P - this.goTick) / 60;
      }
    }
  }

  // ------------------------------------------------------------------ snapshots
  /**
   * A decoded SNAPSHOT arrived.
   * @param {object} snap
   * @param {number} [recvMs]
   */
  onSnapshot(snap, recvMs = 0) {
    this.stats.snapshots++;
    this.arrivals.onSnapshot(snap.tick, recvMs);
    if (!this.buffer.insert(snap)) { this.stats.stale++; return false; }
    if (snap.tick <= this._newestSnapTick) return true; // older (reordered): only useful for interpolation
    this._newestSnapTick = snap.tick;
    this._newest = snap;

    // host-authoritative display state from the newest snapshot
    if (snap.flags?.finished && !this.hostFinished) {
      this.hostFinished = true;
      this.state = 'finished';
    }
    const byPlace = [...this.karts];
    for (const k of this.karts) {
      const r = snap.karts[k.id];
      if (!r) continue;
      k.place = r.finishPlace && r.finished ? r.finishPlace : r.place;
      if (r.finished && !k.finished) {
        k.finished = true;
        k.finishPlace = r.finishPlace;
        k.finishEstimated = !!r.finishEstimated;
      }
    }
    byPlace.sort((a, b) => a.place - b.place || a.id - b.id);
    this._standings = byPlace;

    // own karts: Robo Driver / finish hand-over, then reconcile
    const handBack = [];
    for (const id of this.localKartIds) {
      const r = snap.karts[id];
      if (!r) continue;
      const wasPredicting = this._predicting.has(id);
      if (r.finished) this._auto.add(id);
      const shouldPredict = !r.roboDriven;
      if (wasPredicting && !shouldPredict) {
        // hand the drawn pose over to interpolation so the kart glides back to the remote timeline
        const k = this.karts[id];
        const d = this.reconciler.drawn(k);
        this._smoothers.get(id).seed({ ...d, vx: k.velocity.x, vz: k.velocity.z });
        this._predicting.delete(id);
        this.reconciler.clear(id);
        if (r.roboDriven) this.stats.roboOn++;
      } else if (!wasPredicting && shouldPredict) {
        this._predicting.add(id);
        handBack.push(id);
      }
    }
    if (handBack.length) {
      // re-seed from this snapshot: older inputs are meaningless, the press baseline starts over, snap
      this.stats.reseeds++;
      this.history.clearBefore(snap.tick + 1);
      for (const id of handBack) {
        const seat = this.localKartIds.indexOf(id);
        const e = this.history.get(this.predictedTick);
        const w = e?.wire?.[seat];
        this.resolver.rebaseline(seat, w?.itemCount ?? 0, w?.hopCount ?? 0, snap.tick);
      }
    }
    const karts = this._predictedKarts();
    if (karts.length && snap.owner?.length && snap.tick > this._lastReconciled) {
      if (snap.tick > this.predictedTick) this.predictedTick = snap.tick; // (re)start from the snapshot
      this._lastReconciled = snap.tick;
      const res = this.reconciler.reconcile({
        karts, snap, inputsFor: (t) => this._inputsFor(t), toTick: this.predictedTick, predictTick: this._predictTick,
        ctxFor: (t) => this._ctxFor(t, () => {}), forceSnap: handBack.length > 0, path: this.path,
        normalizeOwner: (o) => this._normalizeOwner(o),
      });
      this.lastCorrections = res.errors;
      for (const e of res.errors) e.auto = this._auto.has(e.kart);
      this.onCorrection?.(snap, res.errors);
    }
    return true;
  }

  /**
   * The host's accelPressedAt is always one of its own countdown values (the countdown when accelerate was
   * pressed). The wire carries it in whole ticks; put it back onto the host's exact float so the rocket-start
   * window test (`at <= startBoostWindow`) decides exactly like the host at the boundary tick.
   */
  _normalizeOwner(o) {
    const at = o.phys?.accelPressedAt;
    if (at === null || at === undefined || !this._countdownAfter) return o;
    // race tick r whose countdown value this is: countdownAfter(0) is the full countdown (3 s)
    const r = Math.max(0, Math.round((this._countdownAfter(0) - at) * 60));
    return { ...o, phys: { ...o.phys, accelPressedAt: this._countdownAfter(r) } };
  }

  /** A decoded EVENTS batch arrived (ctrl, ordered). */
  onEvents(batch) {
    const events = batch.events || batch;
    this.events.push(events);
  }

  /** RESYNC (M2): cold state for (re)joining mid-race. M1 keeps the event seq and finishes. */
  onResync(r) {
    if (Number.isInteger(r?.lastEventSeq)) this.events.resetTo(r.lastEventSeq);
    for (const k of r?.karts || []) {
      const kart = this.karts[k.id ?? -1];
      if (!kart) continue;
      if (Array.isArray(k.lapTimes)) this.lapTimesMs[kart.id] = k.lapTimes.map((t) => Math.round(t * 1000));
    }
  }

  _mapEvent(e) {
    const kartOf = (id) => (id === NO_KART || id === undefined ? null : this.karts[id] || null);
    const out = { ...e, kart: kartOf(e.kart) };
    if ('other' in e) { out.other = kartOf(e.other); if (e.other === NO_KART && e.type === 'bump') out.wall = true; }
    if ('by' in e) out.by = kartOf(e.by);
    if ('target' in e) out.target = kartOf(e.target);
    delete out.seq;
    delete out.tick;
    return out;
  }

  _releaseEvent(e) {
    this.onReleased?.(e);
    this.appliedSeqs.push(e.seq);
    if (this.appliedSeqs.length > 100000) this.appliedSeqs.splice(0, 50000);
    this.itemsReplica.onEvent(e);
    const k = this.karts[e.kart];
    if (e.type === 'lap' && k) this.lapTimesMs[k.id].push(e.lapTimeMs);
    if (e.type === 'finish' && k) {
      this.finishes.set(k.id, { place: e.place, finishTimeMs: e.finishTimeMs, estimated: !!e.estimated });
      k.finished = true;
      k.finishPlace = e.place;
      k.finishTime = e.finishTimeMs / 1000;
      k.finishEstimated = !!e.estimated;
    }
    if (e.type === 'race-complete') this.completeTick = e.tick;
    if (e.type === 'robo' && k) k.roboDriven = !!e.on;
    this._emit(this._mapEvent(e));
  }

  _emit(e) {
    if (this.onEvent) this.onEvent(e);
  }

  // ------------------------------------------------------------------ visuals
  /**
   * Visual pass: remote karts at R (interpolated), own karts at P (+ decaying correction offset).
   * @param {number} alpha   fraction into the current predicted tick (0..1)
   * @param {number} frameDt seconds
   */
  present(alpha = 1, frameDt = 0) {
    const R = this.renderTick;
    const dtMs = frameDt * 1000;
    this.interp.update(dtMs, { intervalMs: this.arrivals.intervalMs, jitterMs: this.arrivals.jitterMs, lossPct: this.arrivals.lossPct });
    this.buffer.prune(R - 2);
    for (const k of this.karts) {
      if (this._predicting.has(k.id)) {
        const d = this.reconciler.drawn(k);
        const prev = this._prevPose.get(k.id);
        let x = d.x, y = d.y, z = d.z, heading = d.heading;
        if (prev && alpha < 1) {
          const o = this.reconciler.offset(k.id);
          x = prev.x + (k.position.x - prev.x) * alpha + o.x;
          y = prev.y + (k.position.y - prev.y) * alpha + o.y;
          z = prev.z + (k.position.z - prev.z) * alpha + o.z;
        }
        this._setRender(k, x, y, z, heading, frameDt);
        continue;
      }
      const pose = sampleKartPose(this.buffer, k.id, R);
      if (!pose) continue;
      const teleport = !!pose.snap?.flags?.teleport;
      const drawn = this._smoothers.get(k.id).step(pose, dtMs, { teleport });
      // discrete fields step at the older snapshot (and physics-ish fields for HUD/sound)
      const rec = pose.rec;
      applyKartRecord(k, rec, null);
      k.position.set(drawn.x, drawn.y, drawn.z);
      k.heading = drawn.heading;
      k.velocity.set(pose.vx, 0, pose.vz);
      this._setRender(k, drawn.x, drawn.y, drawn.z, drawn.heading, frameDt);
    }
    this.itemsReplica.update(this.buffer, R);
    this.items.bursts?.update?.(frameDt);
  }

  _setRender(k, x, y, z, heading, dt) {
    const r = k.render;
    r.position.set(x, y, z);
    r.heading = heading;
    r.spinAngle = k.phys.spinAngle;
    r.pitch = k.phys.pitch;
    r.roll = k.phys.roll;
    r.hopY = k.phys.hopY;
    if (k.model?.group) {
      k.model.group.position.set(x, y, z);
      k.model.group.rotation.set(k.phys.pitch, heading + k.phys.spinAngle, k.phys.roll);
      k.model.update?.(dt, {
        speed: k.speed, steer: k.phys.steerSmoothed, drifting: k.drifting, driftLevel: k.driftLevel, spinning: k.spinning,
        boosting: k.boosting, shielded: k.shielded, time: this.clock, star: k.starPower > 0, driftDir: k.driftDir,
        hop: k.phys.hopY, offRoad: k.offRoad,
      });
    }
  }

  dispose() {
    for (const k of this.karts) {
      if (k.model?.group) { this.scene?.remove?.(k.model.group); k.model.dispose?.(); }
    }
    this.itemsReplica.dispose();
    this.items.bursts?.dispose?.();
  }
}
