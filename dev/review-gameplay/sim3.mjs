import * as THREE from 'three';
import { Race } from '../../src/race/Race.js';
import { TRACKS } from '../../src/data/tracks.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { steerToward, aiDriveInput } from '../../src/race/AI.js';
import { pickCpuCharacters, buildParticipants } from '../../src/game/setup.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildTrack } from '../../src/render/trackBuilder.js';

const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
const DT = 1 / 60;
function makeRace(track, { humans = 1, speed = 'zippy', laps = 3, easy = false, cpus = 7, seed = 1, built = null } = {}) {
  const path = new TrackPath(track.controlPoints, track.width);
  const hs = Array.from({ length: humans }, (_, i) => ({ playerIndex: i, deviceId: `d${i}`, characterId: CHARACTERS[i].id, easyDrive: easy }));
  const cpuIds = pickCpuCharacters(hs.map((h) => h.characterId), CHARACTERS.filter((c) => !c.locked), cpus, Math.random);
  const events = [];
  let builtTrack = null;
  if (built) { try { builtTrack = buildTrack(track, path); } catch (e) { console.log('buildTrack failed in node:', e.message); } }
  const race = new Race({ scene: new THREE.Scene(), trackDef: track, path, builtTrack, participants: buildParticipants(hs, cpuIds), speedClass: speed, buildKartModel: stub, onEvent: (e) => events.push(e), laps, seed });
  race.__events = events;
  return { race, path, builtTrack };
}
const kid = (race, k) => { const tp = race.path.positionAt(k.s + 8 + Math.max(0, k.speed) * 0.45, 0, new THREE.Vector3()); return { steer: steerToward(k, tp.x, tp.z, 2), accel: 1 }; };

// Event tally in an autodrive race with the real built track (boost pads + item slots)
for (const tr of TRACKS) {
  const { race, builtTrack } = makeRace(tr, { built: true, seed: 5 });
  let t = 0;
  while (race.state !== 'finished' && t < 400) { const h = race.karts.find((k) => !k.isCPU); race.update(DT, [aiDriveInput(race, h, DT)]); t += DT; }
  const tally = {};
  for (const e of race.__events) {
    let key = e.type;
    if (e.type === 'drift-boost') key += e.level;
    if (e.type === 'item-use' || e.type === 'item-get') key += ':' + e.item;
    if (e.type === 'boost') key += ':' + e.source;
    if (e.type === 'bonked') key += ':' + e.cause;
    tally[key] = (tally[key] || 0) + 1;
  }
  console.log(tr.id, 'slots', builtTrack?.itemBoxSlots?.length, 'pads', builtTrack?.boostPads?.length, JSON.stringify(tally));
}

// Individual items on castle: give item to human, use it, observe.
const tr = TRACKS[0];
for (const item of ['sprinkle-boost', 'triple-sprinkle', 'gumdrop', 'bubble-shield', 'cupcake-rocket', 'rainbow-star']) {
  const { race } = makeRace(tr, { seed: 7 });
  const h = race.karts.find((k) => !k.isCPU);
  // human 2nd-to-last in grid; run 8s so pack spreads
  let t = 0;
  while (t < 8) { race.update(DT, [kid(race, h)]); t += DT; }
  h.item = item; h.itemCharges = item === 'triple-sprinkle' ? 3 : 1;
  const sp0 = h.speed; const n0 = race.__events.length;
  let uses = 0;
  const log = [];
  for (let i = 0; i < 60 * 6; i++) {
    const inp = kid(race, h);
    const press = (i === 0 || (item === 'triple-sprinkle' && (i === 90 || i === 180)));
    inp.useItem = press;
    race.update(DT, [inp]);
    if (i === 30) log.push(`after0.5s speed ${sp0.toFixed(1)}->${h.speed.toFixed(1)} boosting=${h.boosting} shield=${h.shielded} star=${h.starPower.toFixed(1)} item=${h.item} charges=${h.itemCharges} gumdrops=${race.items.gumdrops.length} rockets=${race.items.rockets.length}`);
  }
  const ev = race.__events.slice(n0).filter((e) => ['item-use', 'bonked', 'shield-pop', 'rocket-launch', 'boost'].includes(e.type))
    .map((e) => `${e.type}${e.item ? ':' + e.item : ''}${e.cause ? ':' + e.cause : ''}${e.kart === h ? '(me)' : `(${e.kart.characterId})`}${e.by ? ' by ' + (e.by === h ? 'me' : e.by.characterId) : ''}`);
  console.log(`\n[${item}] place=${h.place}`, log.join(' | '), '\n  events:', ev.slice(0, 12).join(', '), `final item=${h.item}`);
}

// Rocket target when fired from 1st place; rocket at a shielded target
{
  const { race } = makeRace(tr, { cpus: 1, seed: 2 });
  const h = race.karts.find((k) => !k.isCPU); const c = race.karts.find((k) => k.isCPU);
  let t = 0; while (t < 6) { race.update(DT, [kid(race, h)]); t += DT; }
  // put CPU 20m ahead with a shield
  console.log('\nplaces', h.place, c.place);
}

// Lap counting: drive backwards across the line and forward again; lap must not increment falsely
{
  const { race } = makeRace(tr, { cpus: 0, laps: 2 });
  const h = race.karts[0];
  let t = 0; while (race.state === 'countdown') race.update(DT, [{}]);
  // cross the line forward
  while (h.distance < 20) race.update(DT, [kid(race, h)]);
  // turn around: brake+reverse back across the line
  for (let i = 0; i < 60 * 5; i++) race.update(DT, [{ brake: 1, steer: 0 }]);
  const d1 = h.distance, lap1 = h.lap;
  for (let i = 0; i < 60 * 3; i++) race.update(DT, [kid(race, h)]);
  console.log(`\nreverse test: after reversing dist=${d1.toFixed(1)} lap=${lap1}; forward again dist=${h.distance.toFixed(1)} lap=${h.lap} lapEvents=${race.__events.filter((e) => e.type === 'lap').length}`);
  // continue to finish
  while (race.state !== 'finished' && t < 200) { race.update(DT, [kid(race, h)]); t += DT; }
  console.log(`finished=${h.finished} place=${h.finishPlace} laps=${h.lapTimes.map((x) => x.toFixed(1))} events=${race.__events.filter((e) => ['lap', 'final-lap', 'finish', 'race-complete'].includes(e.type)).map((e) => e.type + (e.lap ?? '')).join(',')}`);
}
