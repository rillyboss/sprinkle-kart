import * as THREE from 'three';
import { Race, makeRng } from '../../src/race/Race.js';
import { TRACKS } from '../../src/data/tracks.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { steerToward } from '../../src/race/AI.js';
import { pickCpuCharacters, buildParticipants } from '../../src/game/setup.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildTrack } from '../../src/render/trackBuilder.js';
const stub = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
const DT=1/60;
const tid = process.argv[2]||'cotton-candy-castle', seed=+process.argv[3]||5;
const trackDef = TRACKS.find(t=>t.id===tid);
const path = new TrackPath(trackDef.controlPoints, trackDef.width); const built = buildTrack(trackDef, path);
  const rng = makeRng(seed*7919);
  const human = { playerIndex: 0, deviceId: 'd0', characterId: CHARACTERS[seed % 8].id, easyDrive: false };
  const cpus = pickCpuCharacters([human.characterId], CHARACTERS.filter((c) => !c.locked), 7, rng);
  const race = new Race({ scene: new THREE.Scene(), trackDef, path, builtTrack: built, participants: buildParticipants([human], cpus), speedClass: 'zippy', buildKartModel: stub, laps: 3, seed });
  const h = race.karts.find(k=>!k.isCPU); const tp=new THREE.Vector3(); let held=0,t=0;
  race.onEvent = (e)=>{ if(['bonked','boost','drift-boost','item-use'].includes(e.type)) console.log(t.toFixed(1), e.type, e.kart?.characterId, e.item||e.cause||e.source||e.level||'', e.kart===h?'<<KID':''); };
  let next=0;
  while(race.state!=='finished'&&t<400){ path.positionAt(h.s+8+Math.max(0,h.speed)*0.45, Math.sin(t*0.4)*2, tp); held=h.item&&h.itemRoulette<=0?held+DT:0;
    race.update(DT,[{steer:steerToward(h,tp.x,tp.z,2),accel:1,useItem:held>1&&held<1+DT*1.5}]); t+=DT;
    if(t>next){ next+=4; const st=race.getStandings(); console.log(`t${t.toFixed(0)} kid P${h.place} spd ${h.speed.toFixed(1)} s ${h.s.toFixed(0)} lead ${st[0].characterId} +${(st[0].distance-h.distance).toFixed(1)} m ${st.map(k=>k.isCPU?(k.aiSpeedMult.toFixed(2)+'/'+k.speed.toFixed(0)):'KID').join(' ')}`);}
  }
console.log('place', h.finishPlace);
