// Throwaway preview harness for the UI area. ?screen=title|join|chars1|chars4|tracks|pause|results|unlock|hud1|hud2|hud3|hud4
import { Menus } from '../../src/ui/Menus.js';
import { Hud } from '../../src/ui/Hud.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { TRACKS } from '../../src/data/tracks.js';
import { TrackPath } from '../../src/track/TrackPath.js';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') || 'title';
const noPortraits = params.has('noportraits');

class StubInput {
  constructor() { this.q = []; }
  consumeMenuEvents() { const e = this.q; this.q = []; return e; }
  getDevices() {
    return [
      { id: 'kb1', type: 'keyboard', name: 'Keyboard (WASD)', connected: true },
      { id: 'kb2', type: 'keyboard', name: 'Keyboard (Arrows)', connected: true },
      { id: 'gp0', type: 'gamepad', name: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', connected: true },
      { id: 'gp1', type: 'gamepad', name: 'Pro Controller (STANDARD GAMEPAD)', connected: true },
      { id: 'gp2', type: 'gamepad', name: 'DualSense Wireless Controller', connected: true },
    ];
  }
}
const input = new StubInput();
window.__push = (deviceId, action) => input.q.push({ deviceId, action });
const audio = { sfx: (n) => console.log('sfx', n), voice: (d, k) => console.log('voice', d.id, k) };

// Fake portraits: cute face on a coloured circle (skip two to exercise the fallback).
function fakePortrait(def) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const hex = `#${def.colors.primary.toString(16).padStart(6, '0')}`;
  g.fillStyle = '#ffe0c8';
  g.beginPath(); g.arc(128, 140, 80, 0, Math.PI * 2); g.fill();
  g.fillStyle = hex;
  g.beginPath(); g.ellipse(128, 70, 90, 45, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#3a2340';
  for (const x of [98, 158]) { g.beginPath(); g.ellipse(x, 140, 11, 16, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#fff';
  for (const x of [102, 162]) { g.beginPath(); g.arc(x, 134, 5, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(255,120,150,0.6)';
  for (const x of [80, 176]) { g.beginPath(); g.arc(x, 170, 12, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#3a2340'; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.arc(128, 170, 20, 0.2, Math.PI - 0.2); g.stroke();
  return c.toDataURL();
}
const portraits = new Map();
if (!noPortraits) {
  for (const d of CHARACTERS) if (!['dino', 'bizzy'].includes(d.id)) portraits.set(d.id, fakePortrait(d));
}

let unlocked = params.has('unlocked');
const progress = {
  isUnlocked: () => unlocked,
  loadProgress: () => ({ wins: 3, trophies: { 'cotton-candy-castle': 2 }, unlocked: [] }),
};

const root = document.getElementById('ui');
const menus = new Menus(root, { input, audio, portraits, characters: CHARACTERS, tracks: TRACKS, progress });
window.__menus = menus;
window.__chars = CHARACTERS;
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  menus.update(dt);
  if (window.__hudTick) window.__hudTick(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function steps(list, done = true) {
  for (const [dev, action] of list) { window.__push(dev, action); await wait(320); }
  if (done) window.__ready = true;
}

const two = { players: [{ deviceId: 'gp0' }, { deviceId: 'kb1', easyDrive: true }] };
const four = { players: [{ deviceId: 'gp0' }, { deviceId: 'kb1', easyDrive: true }, { deviceId: 'gp1' }, { deviceId: 'kb2' }] };

function fakeStandings(humans = [0, 1]) {
  const ids = ['peachy', 'rocco', 'stella', 'lenny', 'gumbo', 'muffin', 'dino', 'bizzy'];
  return ids.map((id, i) => ({
    characterId: id,
    name: CHARACTERS.find((c) => c.id === id).name,
    playerIndex: i === 0 ? humans[0] : i === 3 ? humans[1] : null,
    isCPU: !(i === 0 || i === 3),
    finished: i < 7,
    finishTime: 92.31 + i * 2.17,
    finishPlace: i + 1,
    place: i + 1,
  }));
}

(async () => {
  switch (screen) {
    case 'title':
      menus.run().then((s) => console.log('setup', JSON.stringify(s)));
      window.__ready = true;
      break;
    case 'join':
      menus.run({ skipTitle: true }).then((s) => console.log('setup', JSON.stringify(s)));
      await wait(300);
      await steps([['gp0', 'confirm'], ['kb1', 'confirm'], ['kb1', 'toggle'], ['gp1', 'confirm']]);
      break;
    case 'chars1':
      menus.run({ skipTitle: true, previous: { players: [{ deviceId: 'gp0' }] } });
      await wait(300);
      await steps([['gp0', 'confirm'], ['gp0', 'right'], ['gp0', 'right'], ['gp0', 'right']]);
      break;
    case 'chars2':
      menus.run({ skipTitle: true, previous: two });
      await wait(300);
      await steps([['gp0', 'confirm'], ['gp0', 'right'], ['gp0', 'right'], ['gp0', 'confirm'], ['kb1', 'left'], ['kb1', 'left']]);
      break;
    case 'chars4':
      menus.run({ skipTitle: true, previous: four });
      await wait(300);
      await steps([['gp0', 'confirm'], ['kb1', 'right'], ['kb1', 'right'], ['kb1', 'confirm'], ['gp1', 'left'],
        ['gp1', 'left'], ['gp1', 'left'], ['kb2', 'right'], ['kb2', 'confirm'], ['gp0', 'left']]);
      break;
    case 'tracks':
      menus.run({ skipTitle: true, previous: two }).then((s) => console.log('setup', JSON.stringify(s)));
      await wait(300);
      await steps([['gp0', 'confirm'], ['gp0', 'confirm'], ['kb1', 'confirm']], false);
      await wait(1600);
      await steps([['gp0', 'right'], ['gp0', 'down']]);
      break;
    case 'pause':
      showFakeHud(2);
      menus.showPause('P2').then((r) => console.log('pause', r));
      await wait(300);
      await steps([['gp1', 'down']]);
      break;
    case 'results':
      menus.showResults({ standings: fakeStandings(), trackDef: TRACKS[0], humanWinner: fakeStandings()[0], newlyUnlocked: null })
        .then((r) => console.log('results', r));
      await wait(1500);
      window.__ready = true;
      break;
    case 'unlock':
      menus.showResults({
        standings: fakeStandings(), trackDef: TRACKS[0], humanWinner: fakeStandings()[0],
        newlyUnlocked: CHARACTERS.find((c) => c.id === 'cotton-candy-girl'),
      }).then((r) => console.log('results', r));
      await wait(3200);
      window.__ready = true;
      break;
    default:
      if (screen.startsWith('hud')) showFakeHud(Number(screen.slice(3)) || 1);
  }
})();

function showFakeHud(n) {
  const W = innerWidth, H = innerHeight;
  const rects = n === 1 ? [{ playerIndex: 0, x: 0, y: 0, w: W, h: H }]
    : n === 2 ? [{ playerIndex: 0, x: 0, y: 0, w: W, h: H / 2 }, { playerIndex: 1, x: 0, y: H / 2, w: W, h: H / 2 }]
      : [0, 1, 2, 3].slice(0, n).map((i) => ({ playerIndex: i, x: (i % 2) * W / 2, y: Math.floor(i / 2) * H / 2, w: W / 2, h: H / 2 }));
  const game = document.getElementById('game');
  for (const r of rects) {
    const v = document.createElement('div');
    v.className = 'fakeview';
    Object.assign(v.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    game.appendChild(v);
  }
  const hud = new Hud(root, { characters: CHARACTERS });
  window.__hud = hud;
  hud.layout(rects);
  hud.show();
  const track = TRACKS[Number(params.get('track') || 0)];
  const path = new TrackPath(track.controlPoints, track.width);
  const ids = ['rocco', 'peachy', 'stella', 'lenny', 'gumbo', 'muffin', 'dino', 'bizzy'];
  const karts = ids.map((id, i) => ({
    characterId: id, name: id, playerIndex: i < n ? i : null, isCPU: i >= n,
    s: path.length * (0.3 - i * 0.03), lap: 2, lapsTotal: 3, place: [1, 4, 2, 7, 3, 5, 6, 8][i],
    item: [null, 'gumdrop', 'triple-sprinkle', 'cupcake-rocket'][i] ?? null, itemRoulette: i === 0 ? 1 : 0,
    finished: false, position: null,
  }));
  karts.forEach((k) => { k.position = path.pointAt(k.s); });
  const state = params.get('state') || 'racing';
  const race = {
    state, countdown: Number(params.get('cd') || 1.6), time: state === 'countdown' ? 0 : 12, karts,
    getPlayerKart: (pi) => karts.find((k) => k.playerIndex === pi),
  };
  if (n >= 3) { karts[2].lap = 3; }
  if (n >= 4) { karts[3].finished = true; karts[3].finishPlace = 2; karts[3].lap = 3; }
  hud.update(race, path, { playerIndices: rects.map((r) => r.playerIndex), portraits });
  window.__hudTick = (dt) => {
    if (race.state === 'countdown') { race.countdown -= dt; if (race.countdown <= 0) { race.state = 'racing'; race.time = 0; } }
    else if (state === 'countdown') race.time += dt;
    for (const k of karts) { if (!k.finished) { k.s += 0.4; k.position = path.pointAt(k.s); } }
    hud.update(race, path, { playerIndices: rects.map((r) => r.playerIndex), portraits });
  };
  setTimeout(() => { hud.flash(0, 'Mini-Turbo! ✨'); if (n > 1) hud.flash(1, 'Bonk! 💫'); }, 200);
  setTimeout(() => { window.__ready = true; }, 700);
}
