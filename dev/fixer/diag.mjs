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
const tid = process.argv[2]||'cotton-candy-castle', speed=process.argv[3]||'zippy', N=+process.argv[4]||16;
const trackDef = TRACKS.find(t=>t.id===tid);
const path = new TrackPath(trackDef.controlPoints, trackDef.width); const built = buildTrack(trackDef, path);
let wins=0; const out=[];
for (let seed=1; seed<=N; seed++){
  const rng = makeRng(seed*7919);
  const human = { playerIndex: 0, deviceId: 'd0', characterId: CHARACTERS[seed % 8].id, easyDrive: false };
  const cpus = pickCpuCharacters([human.characterId], CHARACTERS.filter((c) => !c.locked), 7, rng);
  const race = new Race({ scene: new THREE.Scene(), trackDef, path, builtTrack: built, participants: buildParticipants([human], cpus), speedClass: speed, buildKartModel: stub, laps: 3, seed });
  const h = race.karts.find(k=>!k.isCPU); const tp=new THREE.Vector3(); let held=0,t=0, bonks=0, off=0, walls=0;
  race.onEvent = (e)=>{ if(e.type==='bonked'&&e.kart===h) bonks++; };
  while(race.state!=='finished'&&t<400){ path.positionAt(h.s+8+Math.max(0,h.speed)*0.45, Math.sin(t*0.4)*2, tp); held=h.item&&h.itemRoulette<=0?held+DT:0;
    race.update(DT,[{steer:steerToward(h,tp.x,tp.z,2),accel:1,useItem:held>1&&held<1+DT*1.5}]); t+=DT; if(h.offRoad) off+=DT; }
  const st=race.getStandings(); const w=st[0];
  if(h.finishPlace===1) wins++;
  out.push(`seed${seed} place ${h.finishPlace} t ${h.finishTime.toFixed(1)} win ${w.finishTime.toFixed(1)} ${w.characterId} bonks ${bonks} off ${off.toFixed(1)} laps ${h.lapTimes.map(x=>x.toFixed(1))}`);
}
console.log(out.join('\n')); console.log('wins',wins,'/',N);
