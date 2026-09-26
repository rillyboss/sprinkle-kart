// Shared contract for the online-play simulation state (NETWORKING.md §8.4, "P0" in §16.0).
//
// This file is intentionally tiny and dependency-free. It is merged BEFORE the sim-core (WS1) and wire (WS2)
// workstreams fork, so both code against the same shape:
//   - WS1's captureSimState(race) must return an object for which checkSimStateShape(state) returns [].
//   - WS2's snapshot codec is written and tested against makeSimStateFixture().
// Changing a field here is a NETWORKING.md change (same PR), never a private edit.
//
// All numbers are exact floats (no quantisation here; the codec quantises). Kart references are kart ids
// (index into race.karts), never objects, so a SimState is plain data and structuredClone-able.

/**
 * @typedef {object} KartPhysSim         every field of kart.phys except the unused bumpCooldowns
 * @property {number} boostTime @property {number} spinTime @property {number} spinAngle
 * @property {number} shieldTime @property {number} hopTime @property {number} hopY @property {number} hopLen
 * @property {number} driftWindow @property {boolean} driftHeld @property {number} driftCharge
 * @property {number} driftTime @property {number} slide @property {number} slideDir
 * @property {number} driftSlip @property {number} driftOmega0 @property {number} yawRate   v3.1 drift arc (slip angle, entry turn, last turn rate)
 * @property {boolean} airborne @property {number} airVy @property {number} airTime @property {number} onRamp   v3.1 jumps
 * @property {number} trick @property {number} trickTime @property {number} trickLen @property {boolean} trickDone
 * @property {boolean} trickQueued @property {number} trickCount @property {number} landSquash                   v3.1 tricks
 * @property {number} steerSmoothed @property {number} throttle @property {boolean} braking
 * @property {boolean} reversing @property {number} groundY @property {number} pitch @property {number} roll
 * @property {number} onPad @property {number} wallCooldown @property {number} wrongWayTime
 * @property {number} rouletteTime @property {string|null} pendingItem @property {number} lastLapStart
 * @property {number|null} accelPressedAt @property {boolean} prevAccel
 * @property {number} frameStartX @property {number} frameStartZ
 * @property {{ lane: number, stuck: number, backUp: number }|null} assist   Kid-Assist memory (moved off the AI.js WeakMap)
 *
 * @typedef {object} KartSim
 * @property {number} id                  kart id = index in race.karts
 * @property {number} gridSlot            grid position used at construction (NETWORKING.md §8.6)
 * @property {number[]} position          [x, y, z]
 * @property {number} heading @property {number[]} velocity [x, y, z] @property {number} speed
 * @property {number} s @property {number} lateral @property {number} lap @property {number} distance
 * @property {number} progress @property {number} place
 * @property {boolean} finished @property {number|null} finishTime @property {number|null} finishPlace
 * @property {boolean} finishEstimated @property {number[]} lapTimes
 * @property {string|null} item @property {number} itemCharges @property {number} itemRoulette
 * @property {boolean} boosting @property {boolean} spinning @property {boolean} shielded @property {boolean} drifting
 * @property {number} driftLevel @property {number} driftDir @property {number} starPower
 * @property {boolean} offRoad @property {boolean} wrongWay @property {number} aiSpeedMult
 * @property {boolean} battleOut @property {boolean} roboDriven
 * @property {KartPhysSim} phys
 *
 * @typedef {object} GumdropSim
 * @property {number} id u16 entity id @property {number} x @property {number} y @property {number} z
 * @property {number} s @property {number} lateral @property {number} owner kart id
 * @property {number} grace @property {number} age @property {number} color
 * @property {number[]} near kart ids @property {number[]} dodged kart ids
 *
 * @typedef {object} RocketSim
 * @property {number} id u16 entity id @property {number} owner @property {number} target
 * @property {boolean} chased @property {number} distance @property {number} s @property {number} lateral
 * @property {number} y @property {number} travelled @property {number} life @property {number} age
 *
 * @typedef {object} BattleRacerSim
 * @property {number} id @property {number} bubbles @property {number} max @property {number} pops
 * @property {number} popped @property {number|null} outAt @property {number|null} outOrder
 *
 * @typedef {object} BattleSim             plain-data copy of src/modes/battle.js createBattle() state
 * @property {number} time @property {number} timeLimit @property {number} popsPerBonus
 * @property {BattleRacerSim[]} racers @property {number} outCount
 * @property {number|null} endAt @property {string|null} endReason @property {{ reason: string, time: number }|null} over
 *
 * @typedef {object} SimState
 * @property {number} tick @property {string} state 'countdown'|'racing'|'finished'
 * @property {number} countdown @property {number} countdownShown @property {number} time @property {number} clock
 * @property {number} finishCount @property {number|null} firstFinishTime @property {number|null} firstHumanFinishTime
 * @property {number} rng u32 rng state @property {number} nextEntityId u16
 * @property {Array<[number, number]>} bumpTimes [pairKey, time]
 * @property {KartSim[]} karts
 * @property {{ active: boolean[], respawn: number[] }} boxes
 * @property {GumdropSim[]} gumdrops @property {RocketSim[]} rockets
 * @property {number[]} starOn kart ids @property {Array<[number, string]>} itemBoost [kartId, itemId]
 * @property {BattleSim|null} battle
 * @property {object|null} modeInfo
 */

export const RACE_STATES = Object.freeze(['countdown', 'racing', 'finished']);

/** Field lists (and value kinds) of every SimState object. Kinds: num, int, bool, str, nullable variants, arrays. */
export const SIM_STATE_SHAPE = Object.freeze({
  state: {
    tick: 'int', state: 'race-state', countdown: 'num', countdownShown: 'int', time: 'num', clock: 'num',
    finishCount: 'int', firstFinishTime: 'num?', firstHumanFinishTime: 'num?', rng: 'u32', nextEntityId: 'u16',
    bumpTimes: 'pairs', karts: 'karts', boxes: 'boxes', gumdrops: 'gumdrops', rockets: 'rockets',
    starOn: 'ids', itemBoost: 'pairs', battle: 'battle?', modeInfo: 'object?',
  },
  kart: {
    id: 'int', gridSlot: 'int', position: 'vec3', heading: 'num', velocity: 'vec3', speed: 'num', s: 'num',
    lateral: 'num', lap: 'int', distance: 'num', progress: 'num', place: 'int', finished: 'bool',
    finishTime: 'num?', finishPlace: 'int?', finishEstimated: 'bool', lapTimes: 'nums', item: 'str?',
    itemCharges: 'int', itemRoulette: 'num', boosting: 'bool', spinning: 'bool', shielded: 'bool',
    drifting: 'bool', driftLevel: 'int', driftDir: 'num', starPower: 'num', offRoad: 'bool', wrongWay: 'bool',
    aiSpeedMult: 'num', battleOut: 'bool', roboDriven: 'bool', phys: 'phys',
  },
  phys: {
    boostTime: 'num', spinTime: 'num', spinAngle: 'num', shieldTime: 'num', hopTime: 'num', hopY: 'num',
    hopLen: 'num', driftWindow: 'num', driftHeld: 'bool', driftCharge: 'num', driftTime: 'num', slide: 'num',
    slideDir: 'num', driftSlip: 'num', driftOmega0: 'num', yawRate: 'num', airborne: 'bool', airVy: 'num', airTime: 'num', onRamp: 'int', trick: 'int', trickTime: 'num',
    trickLen: 'num', trickDone: 'bool', trickQueued: 'bool', trickCount: 'int', landSquash: 'num', steerSmoothed: 'num', throttle: 'num', braking: 'bool', reversing: 'bool', groundY: 'num',
    pitch: 'num', roll: 'num', onPad: 'int', wallCooldown: 'num', wrongWayTime: 'num', rouletteTime: 'num',
    pendingItem: 'str?', lastLapStart: 'num', accelPressedAt: 'num?', prevAccel: 'bool', frameStartX: 'num',
    frameStartZ: 'num', assist: 'assist?',
  },
  gumdrop: {
    id: 'u16', x: 'num', y: 'num', z: 'num', s: 'num', lateral: 'num', owner: 'int', grace: 'num', age: 'num',
    color: 'int', near: 'ids', dodged: 'ids',
  },
  rocket: {
    id: 'u16', owner: 'int', target: 'int', chased: 'bool', distance: 'num', s: 'num', lateral: 'num', y: 'num',
    travelled: 'num', life: 'num', age: 'num',
  },
  battle: {
    time: 'num', timeLimit: 'num', popsPerBonus: 'int', racers: 'battle-racers', outCount: 'int',
    endAt: 'num?', endReason: 'str?', over: 'object?',
  },
  battleRacer: {
    id: 'int', bubbles: 'int', max: 'int', pops: 'int', popped: 'int', outAt: 'num?', outOrder: 'int?',
  },
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

function checkObject(obj, fields, path, out, ctx) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    out.push(`${path}: expected an object`);
    return;
  }
  for (const key of Object.keys(obj)) {
    if (!(key in fields)) out.push(`${path}.${key}: unknown field`);
  }
  for (const [key, kind] of Object.entries(fields)) {
    const p = `${path}.${key}`;
    if (!(key in obj)) { out.push(`${p}: missing`); continue; }
    checkValue(obj[key], kind, p, out, ctx);
  }
}

function checkValue(v, kind, p, out, ctx) {
  const optional = kind.endsWith('?');
  const k = optional ? kind.slice(0, -1) : kind;
  if (v === null) {
    if (!optional) out.push(`${p}: must not be null`);
    return;
  }
  const bad = (what) => out.push(`${p}: expected ${what}`);
  const ids = (arr) => Array.isArray(arr) && arr.every((id) => isInt(id) && id >= 0 && id < ctx.kartCount);
  switch (k) {
    case 'num': if (!isNum(v)) bad('a finite number'); break;
    case 'int': if (!isInt(v)) bad('an integer'); break;
    case 'u16': if (!isInt(v) || v < 0 || v > 0xffff) bad('a u16'); break;
    case 'u32': if (!isInt(v) || v < 0 || v > 0xffffffff) bad('a u32'); break;
    case 'bool': if (typeof v !== 'boolean') bad('a boolean'); break;
    case 'str': if (typeof v !== 'string') bad('a string'); break;
    case 'object': if (typeof v !== 'object' || Array.isArray(v)) bad('an object'); break;
    case 'race-state': if (!RACE_STATES.includes(v)) bad(`one of ${RACE_STATES.join('/')}`); break;
    case 'vec3': if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) bad('[x, y, z] numbers'); break;
    case 'nums': if (!Array.isArray(v) || !v.every(isNum)) bad('an array of numbers'); break;
    case 'ids': if (!ids(v)) bad('an array of kart ids'); break;
    case 'pairs': if (!Array.isArray(v) || !v.every((e) => Array.isArray(e) && e.length === 2)) bad('an array of pairs'); break;
    case 'assist':
      if (typeof v !== 'object' || !['lane', 'stuck', 'backUp'].every((f) => isNum(v[f]))) bad('{ lane, stuck, backUp }');
      break;
    case 'boxes':
      if (!v || !Array.isArray(v.active) || !Array.isArray(v.respawn) || v.active.length !== v.respawn.length
        || !v.active.every((b) => typeof b === 'boolean') || !v.respawn.every(isNum)) bad('{ active: bool[], respawn: number[] } of equal length');
      break;
    case 'phys': checkObject(v, SIM_STATE_SHAPE.phys, p, out, ctx); break;
    case 'karts':
      if (!Array.isArray(v)) { bad('an array'); break; }
      v.forEach((kart, i) => {
        checkObject(kart, SIM_STATE_SHAPE.kart, `${p}[${i}]`, out, ctx);
        if (kart && kart.id !== i) out.push(`${p}[${i}].id: must equal its index (${i})`);
      });
      break;
    case 'gumdrops':
    case 'rockets': {
      if (!Array.isArray(v)) { bad('an array'); break; }
      const shape = k === 'gumdrops' ? SIM_STATE_SHAPE.gumdrop : SIM_STATE_SHAPE.rocket;
      const seen = new Set();
      v.forEach((e, i) => {
        checkObject(e, shape, `${p}[${i}]`, out, ctx);
        if (e && seen.has(e.id)) out.push(`${p}[${i}].id: duplicate entity id ${e.id}`);
        if (e) seen.add(e.id);
      });
      break;
    }
    case 'battle': checkObject(v, SIM_STATE_SHAPE.battle, p, out, ctx); break;
    case 'battle-racers':
      if (!Array.isArray(v)) { bad('an array'); break; }
      v.forEach((r, i) => checkObject(r, SIM_STATE_SHAPE.battleRacer, `${p}[${i}]`, out, ctx));
      break;
    default: out.push(`${p}: unknown kind ${kind}`);
  }
}

/**
 * Validate a SimState against SIM_STATE_SHAPE.
 * @param {unknown} state
 * @returns {string[]} problems (empty = the state matches the contract)
 */
export function checkSimStateShape(state) {
  const out = [];
  const kartCount = Array.isArray(state?.karts) ? state.karts.length : 0;
  checkObject(state, SIM_STATE_SHAPE.state, 'state', out, { kartCount });
  if (Array.isArray(state?.gumdrops) && Array.isArray(state?.rockets)) {
    const entityIds = [...state.gumdrops, ...state.rockets].map((e) => e?.id);
    if (new Set(entityIds).size !== entityIds.length) out.push('state: gumdrop and rocket entity ids must be unique together');
  }
  return out;
}

// --- canonical fixture -----------------------------------------------------------------------------------

function makeRand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deterministic, valid SimState for codec and contract tests.
 * @param {{ karts?: number, boxes?: number, gumdrops?: number, rockets?: number, battle?: boolean, seed?: number,
 *           state?: 'countdown'|'racing'|'finished', tick?: number }} [o]
 * @returns {SimState}
 */
export function makeSimStateFixture({
  karts = 8, boxes = 32, gumdrops = 0, rockets = 0, battle = false, seed = 1, state = 'racing', tick = 1200,
} = {}) {
  const r = makeRand(seed);
  const between = (lo, hi) => lo + (hi - lo) * r();
  const round = (v, step = 1 / 1024) => Math.round(v / step) * step; // tidy but still unquantised-looking floats
  const kartList = Array.from({ length: karts }, (_, id) => {
    const heading = round(between(-Math.PI, Math.PI));
    const speed = round(between(0, 34));
    return {
      id,
      gridSlot: id,
      position: [round(between(-400, 400)), round(between(0, 15)), round(between(-400, 400))],
      heading,
      velocity: [round(Math.sin(heading) * speed), 0, round(Math.cos(heading) * speed)],
      speed,
      s: round(between(0, 900)),
      lateral: round(between(-6, 6)),
      lap: 1 + (id % 3),
      distance: round(between(0, 2700)),
      progress: round(between(0, 2700)),
      place: id + 1,
      finished: false,
      finishTime: null,
      finishPlace: null,
      finishEstimated: false,
      lapTimes: id % 3 ? [round(between(40, 70))] : [],
      item: id % 4 === 1 ? 'gumdrop' : null,
      itemCharges: id % 4 === 1 ? 1 : 0,
      itemRoulette: 0,
      boosting: id % 5 === 2,
      spinning: false,
      shielded: id % 6 === 3,
      drifting: id % 2 === 0,
      driftLevel: id % 4,
      driftDir: id % 2 === 0 ? 1 : 0,
      starPower: 0,
      offRoad: false,
      wrongWay: false,
      aiSpeedMult: 1,
      battleOut: false,
      roboDriven: false,
      phys: {
        boostTime: id % 5 === 2 ? 0.75 : 0,
        spinTime: 0,
        spinAngle: 0,
        shieldTime: id % 6 === 3 ? 17.5 : 0, // longer than the first draft's 7.97 s wire range, on purpose
        hopTime: 0,
        hopY: 0,
        hopLen: 0.3,
        driftWindow: 0,
        driftHeld: id % 2 === 0,
        driftCharge: round(between(0, 1)),
        driftTime: round(between(0, 3)),
        slide: round(between(0, 1)),
        slideDir: 0,
        driftSlip: id % 2 === 0 ? 0.3125 : 0,
        driftOmega0: 0,
        yawRate: id % 2 === 0 ? 0.875 : 0,
        airborne: id === 3,
        airVy: id === 3 ? 4.25 : 0,
        airTime: id === 3 ? 0.25 : 0,
        onRamp: -1,
        trick: id === 3 ? 2 : 0,
        trickTime: id === 3 ? 0.125 : 0,
        trickLen: id === 3 ? 0.5 : 0,
        trickDone: false,
        trickQueued: false,
        trickCount: id === 3 ? 2 : 0,
        landSquash: id === 5 ? 0.5 : 0,
        steerSmoothed: round(between(-1, 1)),
        throttle: 1,
        braking: false,
        reversing: false,
        groundY: round(between(0, 15)),
        pitch: 0,
        roll: 0,
        onPad: -1,
        wallCooldown: 0,
        wrongWayTime: 0,
        rouletteTime: 0,
        pendingItem: null,
        lastLapStart: round(between(0, 60)),
        accelPressedAt: null,
        prevAccel: true,
        frameStartX: 0,
        frameStartZ: 0,
        assist: id === 0 ? { lane: 0, stuck: 0, backUp: 0 } : null,
      },
    };
  });
  for (const k of kartList) { k.phys.frameStartX = k.position[0]; k.phys.frameStartZ = k.position[2]; }
  let nextId = 1;
  const gumdropList = Array.from({ length: gumdrops }, (_, i) => ({
    id: nextId++,
    x: round(between(-400, 400)), y: round(between(0, 15)), z: round(between(-400, 400)),
    s: round(between(0, 900)), lateral: round(between(-6, 6)),
    owner: i % karts, grace: 0, age: round(between(0, 20)), color: i % 6, near: [], dodged: [],
  }));
  const rocketList = Array.from({ length: rockets }, (_, i) => ({
    id: nextId++,
    owner: i % karts, target: (i + 1) % karts, chased: true,
    distance: round(between(0, 2700)), s: round(between(0, 900)), lateral: 0, y: 1,
    travelled: round(between(0, 200)), life: round(between(0, 6)), age: round(between(0, 6)),
  }));
  return {
    tick,
    state,
    countdown: state === 'countdown' ? 2.5 : 0,
    countdownShown: state === 'countdown' ? 3 : 0,
    time: state === 'countdown' ? 0 : round(tick / 60 - 3),
    clock: round(tick / 60),
    finishCount: 0,
    firstFinishTime: null,
    firstHumanFinishTime: null,
    rng: (seed * 2654435761) >>> 0,
    nextEntityId: nextId,
    bumpTimes: karts > 1 ? [[0 * 64 + 1, 10.5]] : [],
    karts: kartList,
    boxes: {
      active: Array.from({ length: boxes }, (_, i) => i % 7 !== 0),
      respawn: Array.from({ length: boxes }, (_, i) => (i % 7 !== 0 ? 0 : 1.5)),
    },
    gumdrops: gumdropList,
    rockets: rocketList,
    starOn: [],
    itemBoost: [],
    battle: battle ? {
      time: 30,
      timeLimit: 150,
      popsPerBonus: 3,
      racers: kartList.map((k) => ({ id: k.id, bubbles: 3, max: 3, pops: 0, popped: 0, outAt: null, outOrder: null })),
      outCount: 0,
      endAt: null,
      endReason: null,
      over: null,
    } : null,
    modeInfo: battle ? { mode: 'battle' } : null,
  };
}
