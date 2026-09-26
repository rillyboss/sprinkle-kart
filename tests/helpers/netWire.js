/**
 * TEMPORARY wire stand-in for WS2 (src/net/{codec,messages,enums,frag}.js), used by the WS5 netcode tests
 * until WS2 lands (NETWORKING.md §5, §6). It follows the §6 layouts byte for byte where the sizes matter
 * (INPUT 13 + 4·n·p B, SNAPSHOT 15 B header + 41 B per kart + boxes + items + 20 B owner tail, EVENTS
 * 10 + ~4 B per event, TIMEBASE 15 B, PAUSE 8 B, START 14 B, PING 11 B, PONG 27 B) so the harness's wire-byte
 * budgets measure the real thing, and it quantises exactly as §5 says (reconcile error is realistic).
 *
 * The decoded shapes below are what the WS5 modules consume (the contract WS2's decoders must match; see
 * the PR notes). The netcode never imports this file: it receives a `wire` object (this module, or WS2's).
 *
 * Decoded SNAPSHOT:
 *   { type, tick, epoch, countdown, flags: { racing, finished, battle, paused, teleport }, lastInputTick, inputSlack,
 *     karts: [KartRec], boxes: boolean[], gumdrops: [{ id, x, y, z }], rockets: [{ id, x, y, z, heading, target, flags }],
 *     battle: null | { timeLeft, karts: [{ bubbles, out }] }, owner: [{ kart, phys: OwnerPhys, aiSpeedMult }] }
 *   KartRec = { id, position: [x, y, z], heading, velocity: [vx, 0, vz], speed, distance, lap, place, finishPlace,
 *     finished, finishEstimated, item, itemCharges, itemRoulette, hasPending, boosting, spinning, shielded, drifting,
 *     driftLevel, driftDir, starPower, offRoad, wrongWay, battleOut, roboDriven,
 *     phys: { boostTime, spinTime, shieldTime, hopTime, hopY, spinAngle, driftCharge, steerSmoothed, slide, pitch, roll,
 *             throttle, braking, reversing } }
 *   OwnerPhys = { driftHeld, prevAccel, driftWindow, hopLen, onPad, wallCooldown, accelPressedAt, slideDir, wrongWayTime,
 *     lastLapStart, driftTime, groundY, pendingItem, rouletteTime }
 * Decoded INPUT: { type, seq, newestTick, n, p, lastSnapTick, ticks: [{ tick, players: [PlayerTickInput] }] } newest first.
 * Decoded EVENTS: { type, firstSeq, baseTick, events: [{ seq, tick, type, kart, ...payload }] }.
 */
import { ITEM_ORDER } from '../../src/race/itemCatalog.js';

export const MSG = Object.freeze({
  INPUT: 0x01, SNAPSHOT: 0x02, PING: 0x03, PONG: 0x04,
  HELLO: 0x20, WELCOME: 0x21, REJECT: 0x22, BYE: 0x23, LOBBY: 0x24, INTENT: 0x25, EMOTE: 0x26, KICK: 0x27,
  PHASE: 0x28, SETUP: 0x29, LOADED: 0x2a, START: 0x2b, EVENTS: 0x2c, RESYNC: 0x2d, RESULT: 0x2e, GP: 0x2f,
  PAUSE: 0x30, CHOICE: 0x31, FOCUS: 0x32, NETSTAT: 0x33, TIMEBASE: 0x34, FRAG: 0x3f,
});
export const MAX_STATE_BYTES = 1150;
export const CTRL_FRAGMENT_BYTES = 1024;
const JSON_CTRL = new Set([MSG.HELLO, MSG.WELCOME, MSG.REJECT, MSG.LOBBY, MSG.INTENT, MSG.PHASE, MSG.SETUP, MSG.RESYNC, MSG.RESULT, MSG.GP, MSG.CHOICE, MSG.FOCUS]);

export const ITEMS = Object.freeze([null, ...ITEM_ORDER]);
export const BOOST_SOURCES = Object.freeze(['start', 'pad', 'item', 'other']);
export const CAUSES = Object.freeze(['other', 'gumdrop', 'cupcake-rocket', 'star', 'expired', 'rocket']);
export const WHYS = Object.freeze(['popped', 'bonked', 'rocketed', 'evicted', 'expired', 'gone', 'hit', 'fizzle', 'gumdrop', 'dispose']);
export const EV = Object.freeze({
  countdown: 1, go: 2, boost: 3, hop: 4, land: 5, 'drift-start': 6, 'drift-level': 7, 'drift-boost': 8, bump: 9,
  'item-box': 10, 'item-get': 11, 'item-use': 12, 'rocket-launch': 13, bonked: 14, 'shield-pop': 15, 'item-dodged': 16,
  'item-end': 17, lap: 18, 'final-lap': 19, finish: 20, 'race-complete': 21, 'gumdrop-spawn': 22, 'gumdrop-despawn': 23,
  'rocket-despawn': 24, 'box-respawn': 25, 'battle-pop': 26, 'battle-out': 27, 'battle-bonus': 28, robo: 29,
});
const EV_NAME = Object.fromEntries(Object.entries(EV).map(([k, v]) => [v, k]));

const enumIndex = (list, v) => { const i = list.indexOf(v); return i < 0 ? 0 : i; };
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- byte writer / reader
class W {
  constructor(cap = 1500) { this.buf = new Uint8Array(cap); this.dv = new DataView(this.buf.buffer); this.o = 0; }
  need(n) {
    if (this.o + n <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.o + n));
    b.set(this.buf);
    this.buf = b;
    this.dv = new DataView(b.buffer);
  }
  u8(v) { this.need(1); this.dv.setUint8(this.o, clampInt(v, 0, 255)); this.o += 1; }
  i8(v) { this.need(1); this.dv.setInt8(this.o, clampInt(v, -128, 127)); this.o += 1; }
  u16(v) { this.need(2); this.dv.setUint16(this.o, clampInt(v, 0, 0xffff), true); this.o += 2; }
  i16(v) { this.need(2); this.dv.setInt16(this.o, clampInt(v, -32768, 32767), true); this.o += 2; }
  u32(v) { this.need(4); this.dv.setUint32(this.o, Math.max(0, Math.min(0xffffffff, Math.round(v))) >>> 0, true); this.o += 4; }
  i32(v) { this.need(4); this.dv.setInt32(this.o, clampInt(v, -0x80000000, 0x7fffffff), true); this.o += 4; }
  f64(v) { this.need(8); this.dv.setFloat64(this.o, v, true); this.o += 8; }
  bytes(u8) { this.need(u8.length); this.buf.set(u8, this.o); this.o += u8.length; }
  finish() { return this.buf.slice(0, this.o); }
}
class R {
  constructor(u8) { this.u8a = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.o = 0; this.ok = true; }
  has(n) { if (this.o + n > this.u8a.length) { this.ok = false; return false; } return true; }
  u8() { if (!this.has(1)) return 0; const v = this.dv.getUint8(this.o); this.o += 1; return v; }
  i8() { if (!this.has(1)) return 0; const v = this.dv.getInt8(this.o); this.o += 1; return v; }
  u16() { if (!this.has(2)) return 0; const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  i16() { if (!this.has(2)) return 0; const v = this.dv.getInt16(this.o, true); this.o += 2; return v; }
  u32() { if (!this.has(4)) return 0; const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  i32() { if (!this.has(4)) return 0; const v = this.dv.getInt32(this.o, true); this.o += 4; return v; }
  f64() { if (!this.has(8)) return 0; const v = this.dv.getFloat64(this.o, true); this.o += 8; return v; }
  rest() { const b = this.u8a.slice(this.o); this.o = this.u8a.length; return b; }
}
function clampInt(v, lo, hi) {
  const n = Math.round(Number(v) || 0);
  return n < lo ? lo : n > hi ? hi : n;
}
const q = (v, scale) => Math.round((Number(v) || 0) * scale);
const angleU16 = (a) => Math.round((((a % TAU) + TAU) % TAU) / TAU * 65536) & 0xffff;
const u16Angle = (v) => { const a = (v / 65536) * TAU; return a > Math.PI ? a - TAU : a; };
const msU16 = (sec) => clampInt((sec || 0) * 1000, 0, 0xffff);
const ceilPos = (v, scale) => (v > 0 ? Math.max(1, Math.ceil(v * scale)) : 0);

// ---------------------------------------------------------------- INPUT
/** Quantise one player-tick exactly as the wire does (the guest predicts with these values). */
export function quantizeInput(x) {
  return {
    steer: clampInt((x.steer || 0) * 127, -127, 127) / 127,
    accel: clampInt((x.accel || 0) * 15, 0, 15) / 15,
    brake: clampInt((x.brake || 0) * 15, 0, 15) / 15,
    drift: !!x.drift, lookBack: !!x.lookBack, robo: !!x.robo, assisted: !!x.assisted,
    itemCount: (x.itemCount | 0) & 7, hopCount: (x.hopCount | 0) & 7,
  };
}

export function encodeInput({ seq = 0, newestTick, lastSnapTick = 0, ticks }) {
  const n = ticks.length;
  const p = n ? ticks[0].players.length : 0;
  const w = new W(13 + 4 * n * p);
  w.u8(MSG.INPUT); w.u16(seq & 0xffff); w.u32(newestTick); w.u8(n); w.u8(p); w.u32(lastSnapTick);
  for (const t of ticks) {
    for (let i = 0; i < p; i++) {
      const x = quantizeInput(t.players[i] || {});
      w.i8(Math.round(x.steer * 127));
      w.u8((Math.round(x.accel * 15) << 4) | Math.round(x.brake * 15));
      w.u8((x.drift ? 1 : 0) | (x.lookBack ? 2 : 0) | (x.robo ? 4 : 0) | (x.assisted ? 8 : 0));
      w.u8((x.itemCount & 7) | ((x.hopCount & 7) << 3));
    }
  }
  return w.finish();
}

function decodeInput(r) {
  const seq = r.u16(); const newestTick = r.u32(); const n = r.u8(); const p = r.u8(); const lastSnapTick = r.u32();
  if (n > 8 || p < 1 || p > 4) return null;
  const ticks = [];
  for (let k = 0; k < n; k++) {
    const players = [];
    for (let i = 0; i < p; i++) {
      const steer = r.i8() / 127; const ped = r.u8(); const fl = r.u8(); const pr = r.u8();
      players.push({
        steer, accel: (ped >> 4) / 15, brake: (ped & 15) / 15,
        drift: !!(fl & 1), lookBack: !!(fl & 2), robo: !!(fl & 4), assisted: !!(fl & 8),
        itemCount: pr & 7, hopCount: (pr >> 3) & 7,
      });
    }
    ticks.push({ tick: newestTick - k, players });
  }
  return { type: MSG.INPUT, seq, newestTick, n, p, lastSnapTick, ticks };
}

// ---------------------------------------------------------------- SNAPSHOT
const bodyCache = new WeakMap();

function encodeBody(s, { epoch = 0, flags = {} } = {}) {
  const w = new W(900);
  const nb = s.boxes.active.length;
  const fl = (s.state === 'racing' ? 1 : 0) | (s.state === 'finished' ? 2 : 0) | (s.battle ? 4 : 0)
    | (flags.paused ? 8 : 0) | (flags.teleport ? 16 : 0);
  w.u8(MSG.SNAPSHOT); w.u32(s.tick); w.u8(fl); w.u8(epoch & 0xff); w.u8(clampInt((s.countdown || 0) * 64, 0, 255));
  w.u32(0); w.i8(0); // per-house lastInputTick + inputSlack (patched per house)
  w.u8(s.karts.length); w.u8(nb);
  for (const k of s.karts) {
    const p = k.phys;
    w.i16(q(k.position[0], 32)); w.i16(q(k.position[2], 32)); w.i16(q(k.position[1], 64)); w.u16(angleU16(k.heading));
    w.i16(q(k.velocity[0], 256)); w.i16(q(k.velocity[2], 256)); w.i16(q(k.speed, 256)); w.i32(Math.round(k.distance * 100));
    const dd = k.driftDir < 0 ? 1 : k.driftDir > 0 ? 2 : 0;
    w.u16((k.boosting ? 1 : 0) | (k.spinning ? 2 : 0) | (k.shielded ? 4 : 0) | (k.drifting ? 8 : 0) | (k.offRoad ? 16 : 0)
      | (k.wrongWay ? 32 : 0) | (k.finished ? 64 : 0) | (k.finishEstimated ? 128 : 0) | (k.battleOut ? 256 : 0)
      | (p.braking ? 512 : 0) | (p.reversing ? 1024 : 0) | (k.starPower > 0 ? 2048 : 0) | (dd << 12) | (k.roboDriven ? 1 << 14 : 0));
    w.u16(msU16(p.boostTime)); w.u16(msU16(p.spinTime)); w.u16(msU16(p.shieldTime)); w.u16(msU16(k.starPower));
    w.u8(clampInt(p.hopTime * 256, 0, 255)); w.u8(clampInt(p.hopY * 128, 0, 255));
    w.u8(Math.round((((p.spinAngle % TAU) + TAU) % TAU) / TAU * 256) & 0xff); w.u8(clampInt(p.driftCharge * 64, 0, 255));
    w.i8(q(p.steerSmoothed, 127)); w.u8(clampInt(p.slide * 255, 0, 255)); w.i8(q(p.pitch, 254)); w.i8(q(p.roll, 254));
    w.u8(clampInt(p.throttle * 255, 0, 255));
    w.u8(enumIndex(ITEMS, k.item) | ((k.itemCharges & 3) << 3) | ((k.driftLevel & 3) << 5) | (p.pendingItem ? 128 : 0));
    w.u8((Math.min(15, k.lap) & 15) | ((Math.min(15, k.place) & 15) << 4));
    w.u8(Math.min(15, k.finishPlace || 0) & 15);
    w.u8(clampInt(k.itemRoulette * 255, 0, 255));
  }
  for (let i = 0; i < nb; i += 8) {
    let b = 0;
    for (let j = 0; j < 8 && i + j < nb; j++) if (s.boxes.active[i + j]) b |= 1 << j;
    w.u8(b);
  }
  w.u8(s.gumdrops.length);
  for (const g of s.gumdrops) { w.u16(g.id); w.i16(q(g.x, 32)); w.i16(q(g.z, 32)); w.i16(q(g.y, 64)); }
  w.u8(s.rockets.length);
  for (const r of s.rockets) {
    w.u16(r.id); w.i16(q(r.x ?? 0, 32)); w.i16(q(r.z ?? 0, 32)); w.i16(q(r.y, 64)); w.u16(angleU16(r.heading ?? 0));
    w.u8(r.target ?? 255); w.u8(r.chased ? 1 : 0);
  }
  if (s.battle) {
    w.u16(clampInt((s.battle.timeLimit - s.battle.time) * 10, 0, 0xffff));
    for (const r of s.battle.racers) w.u8((r.bubbles & 15) | (r.outAt !== null ? 16 : 0));
  }
  return w.finish();
}

function encodeOwner(w, s, ownerIds = []) {
  const own = ownerIds.filter((id) => s.karts[id]);
  w.u8(own.length);
  for (const id of own) {
    const k = s.karts[id];
    const p = k.phys;
    w.u8(id);
    w.u8((p.driftHeld ? 1 : 0) | (p.prevAccel ? 2 : 0) | (p.driftWindow > 0 ? 4 : 0) | (p.wallCooldown > 0 ? 8 : 0));
    w.u8(Math.min(255, ceilPos(p.driftWindow, 256))); w.u8(clampInt(p.hopLen * 256, 0, 255)); w.i8(p.onPad ?? -1);
    w.u8(Math.min(255, ceilPos(p.wallCooldown, 256)));
    w.i8(p.accelPressedAt === null || p.accelPressedAt === undefined ? -128 : clampInt(p.accelPressedAt * 32, -127, 127));
    w.i8(Math.sign(p.slideDir || 0)); w.u8(clampInt(p.wrongWayTime * 32, 0, 255)); w.u32(Math.round((p.lastLapStart || 0) * 1000));
    w.u16(clampInt(p.driftTime * 256, 0, 0xffff)); w.i16(q(p.groundY, 64)); w.u8(enumIndex(ITEMS, p.pendingItem));
    w.u8(clampInt(p.rouletteTime * 32, 0, 255)); w.u8(clampInt((k.aiSpeedMult ?? 1) * 128, 0, 255));
  }
}

/**
 * @param {object} s SimState (exact floats)
 * @param {{ epoch?: number, flags?: { paused?: boolean, teleport?: boolean },
 *           houseTail?: { lastInputTick?: number, inputSlack?: number, owner?: number[] } }} [o]
 */
export function encodeSnapshot(s, { epoch = 0, flags = {}, houseTail = {} } = {}) {
  const key = `${epoch}|${flags.paused ? 1 : 0}|${flags.teleport ? 1 : 0}`;
  let cached = bodyCache.get(s);
  if (!cached || cached.key !== key) { cached = { key, body: encodeBody(s, { epoch, flags }) }; bodyCache.set(s, cached); }
  const w = new W(cached.body.length + 1 + 20 * (houseTail.owner?.length || 0));
  w.bytes(cached.body);
  w.dv.setUint32(8, (houseTail.lastInputTick || 0) >>> 0, true);
  w.dv.setInt8(12, clampInt(houseTail.inputSlack ?? -128, -128, 127));
  encodeOwner(w, s, houseTail.owner || []);
  return w.finish();
}

function decodeSnapshot(r) {
  const tick = r.u32(); const fl = r.u8(); const epoch = r.u8(); const countdown = r.u8() / 64;
  const lastInputTick = r.u32(); const inputSlack = r.i8(); const kc = r.u8(); const nb = r.u8();
  if (kc > 32) return null;
  const karts = [];
  for (let id = 0; id < kc; id++) {
    const x = r.i16() / 32; const z = r.i16() / 32; const y = r.i16() / 64; const heading = u16Angle(r.u16());
    const vx = r.i16() / 256; const vz = r.i16() / 256; const speed = r.i16() / 256; const distance = r.i32() / 100;
    const f = r.u16();
    const boostTime = r.u16() / 1000; const spinTime = r.u16() / 1000; const shieldTime = r.u16() / 1000; const starPower = r.u16() / 1000;
    const hopTime = r.u8() / 256; const hopY = r.u8() / 128; const spinAngle = (r.u8() / 256) * TAU; const driftCharge = r.u8() / 64;
    const steerSmoothed = r.i8() / 127; const slide = r.u8() / 255; const pitch = r.i8() / 254; const roll = r.i8() / 254;
    const throttle = r.u8() / 255;
    const ib = r.u8(); const lb = r.u8(); const fb = r.u8(); const itemRoulette = r.u8() / 255;
    const dd = (f >> 12) & 3;
    karts.push({
      id, position: [x, y, z], heading, velocity: [vx, 0, vz], speed, distance,
      boosting: !!(f & 1), spinning: !!(f & 2), shielded: !!(f & 4), drifting: !!(f & 8), offRoad: !!(f & 16),
      wrongWay: !!(f & 32), finished: !!(f & 64), finishEstimated: !!(f & 128), battleOut: !!(f & 256),
      driftDir: dd === 1 ? -1 : dd === 2 ? 1 : 0, roboDriven: !!(f & (1 << 14)), starPower,
      item: ITEMS[ib & 7] ?? null, itemCharges: (ib >> 3) & 3, driftLevel: (ib >> 5) & 3, hasPending: !!(ib & 128),
      lap: lb & 15, place: lb >> 4, finishPlace: (fb & 15) || null, itemRoulette,
      phys: {
        boostTime, spinTime, shieldTime, hopTime, hopY, spinAngle, driftCharge, steerSmoothed, slide, pitch, roll, throttle,
        braking: !!(f & 512), reversing: !!(f & 1024),
      },
    });
  }
  const boxes = [];
  for (let i = 0; i < nb; i += 8) { const b = r.u8(); for (let j = 0; j < 8 && i + j < nb; j++) boxes.push(!!(b & (1 << j))); }
  const gumdrops = [];
  const ng = r.u8();
  for (let i = 0; i < ng; i++) gumdrops.push({ id: r.u16(), x: r.i16() / 32, z: r.i16() / 32, y: r.i16() / 64 });
  const rockets = [];
  const nr = r.u8();
  for (let i = 0; i < nr; i++) {
    rockets.push({ id: r.u16(), x: r.i16() / 32, z: r.i16() / 32, y: r.i16() / 64, heading: u16Angle(r.u16()), target: r.u8(), flags: r.u8() });
  }
  let battle = null;
  if (fl & 4) {
    battle = { timeLeft: r.u16() / 10, karts: [] };
    for (let i = 0; i < kc; i++) { const b = r.u8(); battle.karts.push({ bubbles: b & 15, out: !!(b & 16) }); }
  }
  const owner = [];
  const no = r.u8();
  for (let i = 0; i < no; i++) {
    const kart = r.u8(); const bf = r.u8();
    const dw = r.u8() / 256; const hopLen = r.u8() / 256; const onPad = r.i8(); const wc = r.u8() / 256;
    const apa = r.i8(); const slideDir = r.i8(); const wrongWayTime = r.u8() / 32; const lastLapStart = r.u32() / 1000;
    const driftTime = r.u16() / 256; const groundY = r.i16() / 64; const pendingItem = ITEMS[r.u8() & 7] ?? null;
    const rouletteTime = r.u8() / 32; const aiSpeedMult = r.u8() / 128;
    owner.push({
      kart, aiSpeedMult,
      phys: {
        driftHeld: !!(bf & 1), prevAccel: !!(bf & 2), driftWindow: bf & 4 ? dw : 0, hopLen, onPad,
        wallCooldown: bf & 8 ? wc : 0, accelPressedAt: apa === -128 ? null : apa / 32, slideDir, wrongWayTime, lastLapStart,
        driftTime, groundY, pendingItem, rouletteTime,
      },
    });
  }
  return {
    type: MSG.SNAPSHOT, tick, epoch, countdown, lastInputTick, inputSlack,
    flags: { racing: !!(fl & 1), finished: !!(fl & 2), battle: !!(fl & 4), paused: !!(fl & 8), teleport: !!(fl & 16) },
    karts, boxes, gumdrops, rockets, battle, owner,
  };
}

// ---------------------------------------------------------------- EVENTS
const PAYLOAD = {
  countdown: [(w, e) => w.u8(e.n), (r) => ({ n: r.u8() })],
  boost: [(w, e) => w.u8(enumIndex(BOOST_SOURCES, e.source)), (r) => ({ source: BOOST_SOURCES[r.u8()] ?? 'other' })],
  'drift-start': [(w, e) => w.i8(e.dir), (r) => ({ dir: r.i8() })],
  'drift-level': [(w, e) => w.u8(e.level), (r) => ({ level: r.u8() })],
  'drift-boost': [(w, e) => w.u8(e.level), (r) => ({ level: r.u8() })],
  bump: [(w, e) => { w.u8(e.other); w.u8(q(e.strength, 255)); }, (r) => ({ other: r.u8(), strength: r.u8() / 255 })],
  'item-box': [(w, e) => { w.u8(e.boxIndex); w.u8(e.rolling ? 1 : 0); }, (r) => ({ boxIndex: r.u8(), rolling: !!r.u8() })],
  'item-get': [(w, e) => w.u8(enumIndex(ITEMS, e.item)), (r) => ({ item: ITEMS[r.u8()] ?? null })],
  'item-use': [(w, e) => { w.u8(enumIndex(ITEMS, e.item)); w.u8(e.chargesLeft); }, (r) => ({ item: ITEMS[r.u8()] ?? null, chargesLeft: r.u8() })],
  'rocket-launch': [(w, e) => { w.u16(e.rocketId); w.u8(e.target); }, (r) => ({ rocketId: r.u16(), target: r.u8() })],
  bonked: [(w, e) => { w.u8(enumIndex(CAUSES, e.cause)); w.u8(e.by); }, (r) => ({ cause: CAUSES[r.u8()] ?? 'other', by: r.u8() })],
  'shield-pop': [(w, e) => { w.u8(enumIndex(CAUSES, e.cause)); w.u8(e.by); w.u8(e.expired ? 1 : 0); },
    (r) => ({ cause: CAUSES[r.u8()] ?? 'other', by: r.u8(), expired: !!r.u8() })],
  'item-dodged': [(w, e) => { w.u8(enumIndex(ITEMS, e.item)); w.u8(e.by); }, (r) => ({ item: ITEMS[r.u8()] ?? null, by: r.u8() })],
  'item-end': [(w, e) => w.u8(enumIndex(ITEMS, e.item)), (r) => ({ item: ITEMS[r.u8()] ?? null })],
  lap: [(w, e) => { w.u8(e.lap); w.u32(e.lapTimeMs); }, (r) => ({ lap: r.u8(), lapTimeMs: r.u32() })],
  finish: [(w, e) => { w.u8(e.place); w.u32(e.finishTimeMs); w.u8(e.estimated ? 1 : 0); },
    (r) => ({ place: r.u8(), finishTimeMs: r.u32(), estimated: !!r.u8() })],
  'gumdrop-spawn': [(w, e) => { w.u16(e.id); w.i16(q(e.x, 32)); w.i16(q(e.y, 64)); w.i16(q(e.z, 32)); w.u8(e.color); },
    (r) => ({ id: r.u16(), x: r.i16() / 32, y: r.i16() / 64, z: r.i16() / 32, color: r.u8() })],
  'gumdrop-despawn': [(w, e) => { w.u16(e.id); w.u8(enumIndex(WHYS, e.why)); }, (r) => ({ id: r.u16(), why: WHYS[r.u8()] ?? 'popped' })],
  'rocket-despawn': [(w, e) => { w.u16(e.id); w.u8(enumIndex(WHYS, e.why)); }, (r) => ({ id: r.u16(), why: WHYS[r.u8()] ?? 'gone' })],
  'box-respawn': [(w, e) => w.u8(e.boxIndex), (r) => ({ boxIndex: r.u8() })],
  'battle-pop': [(w, e) => { w.u8(e.by); w.u8(e.bubblesLeft); }, (r) => ({ by: r.u8(), bubblesLeft: r.u8() })],
  robo: [(w, e) => w.u8(e.on ? 1 : 0), (r) => ({ on: !!r.u8() })],
};

/** Events must have consecutive seqs and ticks within baseTick..baseTick+255 (the caller batches). */
export function encodeEvents(events) {
  const w = new W(10 + events.length * 8);
  const baseTick = events.length ? events[0].tick : 0;
  w.u8(MSG.EVENTS); w.u32(events.length ? events[0].seq : 0); w.u32(baseTick); w.u8(events.length);
  for (const e of events) {
    w.u8(e.tick - baseTick); w.u8(EV[e.type] ?? 0); w.u8(e.kart ?? 255);
    PAYLOAD[e.type]?.[0](w, e);
  }
  return w.finish();
}

function decodeEvents(r) {
  const firstSeq = r.u32(); const baseTick = r.u32(); const count = r.u8();
  const events = [];
  for (let i = 0; i < count; i++) {
    const dTick = r.u8(); const type = EV_NAME[r.u8()]; const kart = r.u8();
    if (!type) return null;
    events.push({ seq: (firstSeq + i) >>> 0, tick: baseTick + dTick, type, kart, ...(PAYLOAD[type]?.[1](r) ?? {}) });
  }
  return { type: MSG.EVENTS, firstSeq, baseTick, events };
}

// ---------------------------------------------------------------- ctrl + ping/pong
export function encodeCtrl(type, o = {}) {
  if (JSON_CTRL.has(type)) {
    const json = new TextEncoder().encode(JSON.stringify(o));
    const out = new Uint8Array(json.length + 1);
    out[0] = type;
    out.set(json, 1);
    return out;
  }
  const w = new W(32);
  w.u8(type);
  switch (type) {
    case MSG.TIMEBASE: w.u8(o.epoch); w.u32(o.tick); w.f64(o.hostMs); w.u8(o.reason); break;
    case MSG.PAUSE: w.u8(o.paused ? 1 : 0); w.u8(o.reason); w.u32(o.tick); w.u8(o.epoch); break;
    case MSG.START: w.u32(o.raceId); w.u32(o.startTick); w.u32(o.goTick); w.u8(o.epoch); break;
    case MSG.BYE: w.u8(o.reason); break;
    case MSG.PING: w.u16(o.id); w.f64(o.t0); break;
    case MSG.PONG: w.u16(o.id); w.f64(o.t0); w.f64(o.t1); w.f64(o.t2); break;
    case MSG.FRAG: w.u16(o.msgId); w.u8(o.index); w.u8(o.count); w.bytes(o.bytes); break;
    default: throw new RangeError(`netWire: no encoder for ${type}`);
  }
  return w.finish();
}

/** Decode any message (state or ctrl). Never throws: junk → null. */
export function decode(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length < 1) return null;
    const r = new R(bytes);
    const type = r.u8();
    let m = null;
    if (JSON_CTRL.has(type)) {
      m = { type, ...JSON.parse(new TextDecoder().decode(bytes.subarray(1))) };
    } else {
      switch (type) {
        case MSG.INPUT: m = decodeInput(r); break;
        case MSG.SNAPSHOT: m = decodeSnapshot(r); break;
        case MSG.EVENTS: m = decodeEvents(r); break;
        case MSG.TIMEBASE: m = { type, epoch: r.u8(), tick: r.u32(), hostMs: r.f64(), reason: r.u8() }; break;
        case MSG.PAUSE: m = { type, paused: !!r.u8(), reason: r.u8(), tick: r.u32(), epoch: r.u8() }; break;
        case MSG.START: m = { type, raceId: r.u32(), startTick: r.u32(), goTick: r.u32(), epoch: r.u8() }; break;
        case MSG.BYE: m = { type, reason: r.u8() }; break;
        case MSG.PING: m = { type, id: r.u16(), t0: r.f64() }; break;
        case MSG.PONG: m = { type, id: r.u16(), t0: r.f64(), t1: r.f64(), t2: r.f64() }; break;
        case MSG.FRAG: m = { type, msgId: r.u16(), index: r.u8(), count: r.u8(), bytes: r.rest() }; break;
        default: return null;
      }
    }
    return m && r.ok ? m : null;
  } catch {
    return null;
  }
}
export const decodeSnapshotBytes = (b) => { const m = decode(b); return m?.type === MSG.SNAPSHOT ? m : null; };
export const decodeInputBytes = (b) => { const m = decode(b); return m?.type === MSG.INPUT ? m : null; };
export const decodeEventsBytes = (b) => { const m = decode(b); return m?.type === MSG.EVENTS ? m : null; };

// ---------------------------------------------------------------- FRAG
export function createFragmenter({ maxBytes = CTRL_FRAGMENT_BYTES } = {}) {
  let msgId = 0;
  return {
    split(bytes) {
      const count = Math.ceil(bytes.length / maxBytes);
      if (count > 16) throw new RangeError('netWire: message too large for fragments');
      msgId = (msgId + 1) & 0xffff;
      const out = [];
      for (let i = 0; i < count; i++) out.push(encodeCtrl(MSG.FRAG, { msgId, index: i, count, bytes: bytes.subarray(i * maxBytes, (i + 1) * maxBytes) }));
      return out;
    },
  };
}

export function createReassembler({ timeoutMs = 10000 } = {}) {
  let cur = null;
  return {
    /** @returns {Uint8Array|null} the whole message once its last piece arrives */
    push(frag, nowMs = 0) {
      if (!frag || frag.count < 1 || frag.count > 16 || frag.index >= frag.count) return null;
      if (!cur || cur.msgId !== frag.msgId || nowMs - cur.at > timeoutMs) cur = { msgId: frag.msgId, count: frag.count, parts: new Array(frag.count), got: 0, at: nowMs };
      if (!cur.parts[frag.index]) { cur.parts[frag.index] = frag.bytes; cur.got++; }
      if (cur.got < cur.count) return null;
      const total = cur.parts.reduce((n, p) => n + p.length, 0);
      if (total > 16384) { cur = null; return null; }
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of cur.parts) { out.set(p, o); o += p.length; }
      cur = null;
      return out;
    },
  };
}

/** The whole stand-in as one `wire` object for the netcode factories. */
export const wire = Object.freeze({
  MSG, EV, encodeInput, encodeSnapshot, encodeEvents, encodeCtrl, decode, quantizeInput, createFragmenter, createReassembler,
  MAX_STATE_BYTES, CTRL_FRAGMENT_BYTES,
});
