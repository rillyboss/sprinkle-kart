import * as THREE from 'three';
import { SPEED_CLASSES, DEFAULT_LAPS } from '../config.js';
import { getCharacter } from '../data/characters.js';
import { TUNING as T } from './tuning.js';
import { createKart, stepKart, giveBoost, NEUTRAL_INPUT } from './Kart.js';
import { CpuBrain, computeRacingLine, applyEasyDrive, aiDriveInput, cpuDriftChance } from './AI.js';
import { ItemSystem, rollItem } from './Items.js';
import { ItemBoxes } from './ItemBoxes.js';
import { KartFx } from './KartFx.js';
import { normalizeGameplay } from './gameplay.js';
import { normalizeRules } from '../modes/rules.js';

export { aiDriveInput };

/** Small seedable PRNG (mulberry32) so tests are deterministic. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lookupCharacter(id) {
  try {
    return getCharacter(id) || null;
  } catch {
    return null;
  }
}

/** How long after the first human finishes before the race wraps up. */
export const FINISH_GRACE = 30;
const CPU_ONLY_GRACE = 60;
const COUNTDOWN = 3;
/** Metres between grid slots (roomy, so chase cameras are not nose-to-tail at the countdown). */
export const GRID_SPACING = 6.3;

/**
 * One race: karts, physics, laps, items, AI and standings.
 * See ARCHITECTURE.md for the contract.
 */
export class Race {
  constructor({
    scene, trackDef = {}, path, builtTrack = null, participants = [], speedClass = 'zippy',
    buildKartModel, onEvent, laps, seed, rng, rules,
  }) {
    this.scene = scene;
    /** Mode rules (src/modes/rules.js): items on/off, CPUs on/off, starting items. */
    this.rules = normalizeRules(rules);
    /** Free-form info for HUD widgets set by the mode (e.g. { ghostGap }). */
    this.modeInfo = {};
    /**
     * Optional mode hooks (src/modes/battleSession.js, teamSession.js):
     *   itemRoller(kart, rng) -> ItemId   replaces the place-based item odds
     *   friendly(a, b) -> boolean         team-mates never bonk each other (items + star bumps)
     *   rocketTarget(kart) -> { target, distance } | null   who a cupcake rocket chases
     * Karts with `battleOut = true` (Bubble Pop Battle, out of bubbles) drive on as
     * cheering ghosts: no items, no item boxes, no bumps.
     */
    this.itemRoller = null;
    this.friendly = null;
    this.rocketTarget = null;
    if (!this.rules.cpus) participants = participants.filter((p) => p.playerIndex !== null && p.playerIndex !== undefined);
    this.trackDef = trackDef;
    this.path = path;
    this.builtTrack = builtTrack;
    this.onEvent = onEvent || null;
    this.speedClass = typeof speedClass === 'string'
      ? (SPEED_CLASSES[speedClass] || SPEED_CLASSES.zippy)
      : (speedClass || SPEED_CLASSES.zippy);
    this.rng = rng || (seed !== undefined ? makeRng(seed) : Math.random);
    this.lapsTotal = Math.max(1, laps ?? trackDef.laps ?? DEFAULT_LAPS);
    this.state = 'countdown';
    this.countdown = COUNTDOWN;
    this.time = 0;
    this.clock = 0; // total seconds including countdown (for animation)
    this.lastDt = 1 / 60;
    this.finishCount = 0;
    this.firstFinishTime = null;
    this.firstHumanFinishTime = null;
    this._countdownShown = 4;
    this._bumpTimes = new Map();
    this._emitFn = (e) => this._emit(e);

    const L = path.length;
    this.racingLine = computeRacingLine(path);
    this.boostPads = (builtTrack?.boostPads ?? (trackDef.boostPads || []).map((b) => ({
      s: path.wrap(b.at * L), lateral: b.lateral ?? 0, length: 6, halfWidth: 2.5,
    }))).map((b) => ({ length: 6, halfWidth: 2.5, ...b }));

    // --- karts on the grid (two staggered columns behind the line) ---
    const hw = path.halfWidth;
    const lane = Math.min(3.4, hw - 1.6);
    this.karts = participants.map((pt, i) => {
      const charDef = lookupCharacter(pt.characterId);
      const kart = createKart({
        id: i,
        participant: pt,
        charDef,
        speedClass: this.speedClass,
        lapsTotal: this.lapsTotal,
        path,
        gridS: -7 - i * GRID_SPACING,
        gridLat: i % 2 === 0 ? -lane : lane,
      });
      if (buildKartModel) {
        kart.model = buildKartModel(charDef || { id: pt.characterId, name: kart.name, colors: {}, stats: {} });
        kart.model.group.rotation.order = 'YXZ';
        scene.add(kart.model.group);
      }
      kart.place = i + 1;
      if (this.rules.startItem && !kart.isCPU) {
        kart.item = this.rules.startItem;
        kart.itemCharges = this.rules.startItemCharges;
      }
      return kart;
    });

    this.brains = new Map();
    for (const k of this.karts) {
      if (k.isCPU) {
        const skill = this.speedClass.aiSkill + (this.rng() - 0.5) * 0.24;
        const driftChance = cpuDriftChance(skill, this.speedClass.id === 'zoomy');
        this.brains.set(k, new CpuBrain(k, { skill, rng: this.rng, driftChance }));
      }
    }

    this.items = new ItemSystem({
      scene, path, emit: this._emitFn, rng: this.rng, getStandings: () => this._standings,
    });
    this.items.isFriendly = (a, b) => !!(this.friendly && this.friendly(a, b));
    this.items.pickTarget = (k) => (this.rocketTarget ? this.rocketTarget(k) : null);
    const slots = this.rules.items ? (builtTrack?.itemBoxSlots ?? defaultItemSlots(trackDef, path)) : [];
    this.itemBoxes = new ItemBoxes({ scene, slots });
    this.fx = this.karts.map(() => new KartFx(scene));

    this._standings = [...this.karts];
    /** Track gameplay modifiers (see ./gameplay.js), also handed to stepKart via env.gameplay. */
    this.gameplay = normalizeGameplay(trackDef.gameplay);
    this._env = { path, boostPads: this.boostPads, emit: this._emitFn, gameplay: this.gameplay };
    this._syncVisuals(0);
  }

  _emit(e) {
    if (this.onEvent) this.onEvent(e);
  }

  getStandings() {
    return this._standings.slice();
  }

  getPlayerKart(playerIndex) {
    return this.karts.find((k) => k.playerIndex === playerIndex) || null;
  }

  _brainFor(kart) {
    let b = this.brains.get(kart);
    if (!b) {
      b = new CpuBrain(kart, { skill: 0.7, rng: this.rng });
      this.brains.set(kart, b);
    }
    return b;
  }

  _inputFor(kart, inputs, dt) {
    if (kart.isCPU || kart.finished) return this._brainFor(kart).think(this, dt);
    const raw = (inputs && inputs[kart.playerIndex]) || NEUTRAL_INPUT;
    return kart.easyDrive ? applyEasyDrive(this, kart, raw) : raw;
  }

  /**
   * @param {number} dt seconds since last frame (clamped + sub-stepped)
   * @param {Array<DriveInput>} inputs indexed by playerIndex
   */
  update(dt, inputs = []) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, T.maxFrameDt);
    this.lastDt = dt;
    this.clock += dt;

    if (this.state === 'countdown') {
      this._updateCountdown(dt, inputs);
      this._syncVisuals(dt);
      return;
    }

    this.time += dt;
    const frameInputs = this.karts.map((k) => this._inputFor(k, inputs, dt));

    // Items are used once per frame (useItem is an edge).
    this.karts.forEach((k, i) => {
      if (frameInputs[i].useItem && k.item && k.itemRoulette <= 0 && !k.spinning && !k.battleOut) this.items.use(k);
    });

    for (const k of this.karts) { k.phys.frameStartX = k.position.x; k.phys.frameStartZ = k.position.z; }
    const n = Math.max(1, Math.ceil(dt / T.subStep - 1e-6));
    const h = dt / n;
    for (let step = 0; step < n; step++) {
      this._collideKarts();
      for (let i = 0; i < this.karts.length; i++) stepKart(this.karts[i], frameInputs[i], this._env, h);
      for (const k of this.karts) this._updateLap(k);
    }

    const active = this.rules.battle ? this.karts.filter((k) => !k.battleOut) : this.karts;
    this.items.update(dt, active);
    this.itemBoxes.update(dt, active, (k) => this._onBoxBreak(k));
    this._updateRoulettes(dt);
    this._updateStandings();
    this._checkComplete();
    this._syncVisuals(dt);
  }

  _updateCountdown(dt, inputs) {
    this.countdown = Math.max(0, this.countdown - dt);
    for (const n of [3, 2, 1]) {
      if (this._countdownShown > n && this.countdown <= n) {
        this._countdownShown = n;
        this._emit({ type: 'countdown', n });
      }
    }
    // Track accelerate presses for the sparkly rocket start.
    for (const k of this.karts) {
      const inp = this._inputFor(k, inputs, dt);
      const held = (inp.accel || 0) > 0.5;
      if (held && !k.phys.prevAccel) k.phys.accelPressedAt = this.countdown;
      if (!held) k.phys.accelPressedAt = null;
      k.phys.prevAccel = held;
    }
    if (this.countdown <= 0) {
      this.state = 'racing';
      this.countdown = 0;
      this._emit({ type: 'go' });
      for (const k of this.karts) {
        const at = k.phys.accelPressedAt;
        if (k.phys.prevAccel && at !== null && at <= T.startBoostWindow) {
          giveBoost(k, T.startBoost);
          this._emit({ type: 'boost', kart: k, source: 'start' });
        }
      }
    }
  }

  _updateLap(k) {
    k.progress = k.distance;
    if (k.finished || this.rules.battle) return; // a battle has no laps
    const L = this.path.length;
    const lapNow = Math.floor(Math.max(0, k.distance) / L) + 1;
    if (lapNow <= k.lap) return;
    k.lapTimes.push(this.time - k.phys.lastLapStart);
    k.phys.lastLapStart = this.time;
    if (lapNow > this.lapsTotal) {
      this._finishKart(k);
      return;
    }
    k.lap = lapNow;
    this._emit({ type: 'lap', kart: k, lap: k.lap });
    if (k.lap === this.lapsTotal && this.lapsTotal > 1) this._emit({ type: 'final-lap', kart: k });
  }

  _finishKart(k) {
    k.finished = true;
    k.finishTime = this.time;
    k.finishPlace = ++this.finishCount;
    k.lap = this.lapsTotal;
    k.place = k.finishPlace;
    if (this.firstFinishTime === null) this.firstFinishTime = this.time;
    if (!k.isCPU && this.firstHumanFinishTime === null) this.firstHumanFinishTime = this.time;
    this._emit({ type: 'finish', kart: k, place: k.finishPlace });
  }

  _onBoxBreak(k) {
    const canRoll = !k.item && k.phys.rouletteTime <= 0;
    this._emit({ type: 'item-box', kart: k, rolling: canRoll });
    if (!canRoll) return;
    k.phys.rouletteTime = T.rouletteDuration;
    const rolled = this.itemRoller ? this.itemRoller(k, this.rng) : null;
    k.phys.pendingItem = rolled || rollItem(k.place || this.karts.length, this.karts.length, this.rng);
    k.itemRoulette = 1;
  }

  _updateRoulettes(dt) {
    for (const k of this.karts) {
      const p = k.phys;
      if (p.rouletteTime <= 0) continue;
      p.rouletteTime -= dt;
      k.itemRoulette = Math.max(0, p.rouletteTime / T.rouletteDuration);
      if (p.rouletteTime <= 0) {
        p.rouletteTime = 0;
        k.itemRoulette = 0;
        k.item = p.pendingItem;
        k.itemCharges = k.item === 'triple-sprinkle' ? 3 : 1;
        p.pendingItem = null;
        this._emit({ type: 'item-get', kart: k, item: k.item });
      }
    }
  }

  _collideKarts() {
    const R = T.kartRadius * 2;
    const karts = this.karts;
    for (let i = 0; i < karts.length; i++) {
      const a = karts[i];
      if (a.battleOut) continue;
      for (let j = i + 1; j < karts.length; j++) {
        const b = karts[j];
        if (b.battleOut) continue;
        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        if (Math.abs(dx) > R || Math.abs(dz) > R || Math.abs(b.position.y - a.position.y) > 2) continue;
        let d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (d2 < 1e-6) { dx = 0.01; dz = 0; d2 = 1e-4; }
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const overlap = R - d;
        const ma = a.stats.mass, mb = b.stats.mass;
        const wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.position.x -= nx * overlap * wa; a.position.z -= nz * overlap * wa;
        b.position.x += nx * overlap * wb; b.position.z += nz * overlap * wb;
        const vrel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
        if (vrel < 0) {
          const jImp = (-(1 + T.bumpRestitution) * vrel) / (1 / ma + 1 / mb);
          a.velocity.x -= (nx * jImp) / ma; a.velocity.z -= (nz * jImp) / ma;
          b.velocity.x += (nx * jImp) / mb; b.velocity.z += (nz * jImp) / mb;
        }
        // Rainbow star power twirls whoever you bump.
        const pals = !!(this.friendly && this.friendly(a, b));
        if (pals) { /* team-mates: a friendly nudge, never a twirl */ } else if (a.starPower > 0 && b.starPower <= 0) this.items.bonk(b, 'star', a);
        else if (b.starPower > 0 && a.starPower <= 0) this.items.bonk(a, 'star', b);
        const key = i * 64 + j;
        const last = this._bumpTimes.get(key) ?? -Infinity;
        if (-vrel > 2.5 && this.time - last > T.bumpCooldown) {
          this._bumpTimes.set(key, this.time);
          this._emit({ type: 'bump', kart: a, other: b, strength: Math.min(1, -vrel / 15) });
        }
      }
    }
  }

  _updateStandings() {
    const s = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishPlace - b.finishPlace;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.distance - a.distance;
    });
    s.forEach((k, i) => { k.place = i + 1; });
    this._standings = s;
  }

  _checkComplete() {
    if (this.state !== 'racing' || this.rules.battle) return; // a battle ends via completeWith()
    const humans = this.karts.filter((k) => !k.isCPU);
    let done;
    if (humans.length) {
      done = humans.every((k) => k.finished)
        || (this.firstHumanFinishTime !== null && this.time - this.firstHumanFinishTime >= FINISH_GRACE);
    } else {
      done = this.karts.every((k) => k.finished)
        || (this.firstFinishTime !== null && this.time - this.firstFinishTime >= CPU_ONLY_GRACE);
    }
    if (done) this._complete();
  }

  _complete() {
    const L = this.path.length;
    for (const k of this._standings) {
      if (k.finished) continue;
      // Everyone still driving gets placed by how far they got.
      k.finished = true;
      k.finishPlace = ++this.finishCount;
      const remaining = Math.max(0, this.lapsTotal * L - k.distance);
      k.finishTime = this.time + remaining / Math.max(8, k.stats.maxSpeed * 0.85);
      k.finishEstimated = true;
    }
    this._updateStandings();
    this.state = 'finished';
    this._emit({ type: 'race-complete', standings: this.getStandings() });
  }

  /**
   * End the race now with this finishing order (Bubble Pop Battle: the battle
   * ranking). Karts missing from `order` follow in standings order. Places are
   * 1..n, nobody is "estimated", finish times = now. Emits 'race-complete' once.
   * @param {object[]} order karts, best first
   */
  completeWith(order = []) {
    if (this.state === 'finished') return;
    if (this.state === 'countdown') { this.state = 'racing'; this.countdown = 0; }
    const list = order.filter((k) => this.karts.includes(k));
    for (const k of this._standings) if (!list.includes(k)) list.push(k);
    this.finishCount = 0;
    list.forEach((k) => {
      k.finished = true;
      k.finishPlace = ++this.finishCount;
      k.place = k.finishPlace;
      k.finishTime = this.time;
      k.finishEstimated = false;
    });
    this._standings = list;
    this.state = 'finished';
    this._emit({ type: 'race-complete', standings: this.getStandings() });
  }

  _syncVisuals(dt) {
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      const p = k.phys;
      if (k.model) {
        const g = k.model.group;
        g.position.copy(k.position);
        g.rotation.set(p.pitch, k.heading + p.spinAngle, p.roll);
        k.model.update(dt, {
          speed: k.speed,
          steer: p.steerSmoothed,
          drifting: k.drifting,
          driftLevel: k.driftLevel,
          spinning: k.spinning,
          boosting: k.boosting,
          shielded: k.shielded,
          time: this.clock,
          star: k.starPower > 0,
          driftDir: k.driftDir,
          hop: p.hopY,
          offRoad: k.offRoad,
        });
      }
      this.fx[i]?.update(k, this.clock);
    }
  }

  dispose() {
    for (const k of this.karts) {
      if (k.model) {
        this.scene.remove(k.model.group);
        k.model.dispose?.();
      }
    }
    for (const f of this.fx) f.dispose();
    this.items.dispose();
    this.itemBoxes.dispose();
  }
}

/** Fallback item-box slots if the built track does not provide any. */
export function defaultItemSlots(trackDef, path) {
  const rows = trackDef?.itemBoxRows || [0.15, 0.42, 0.7];
  const hw = path.halfWidth;
  const lats = [-0.6, -0.2, 0.2, 0.6].map((f) => f * hw);
  const out = [];
  for (const r of rows) {
    const s = path.wrap(r * path.length);
    for (const lateral of lats) out.push({ s, lateral, position: path.positionAt(s, lateral, new THREE.Vector3()) });
  }
  return out;
}
