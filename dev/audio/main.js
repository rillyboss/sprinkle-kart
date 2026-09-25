import { AudioManager, SFX_NAMES, SONG_IDS, VOICE_KINDS } from '../../src/audio/AudioManager.js';
import { VOICE_STYLES } from '../../src/audio/voice.js';

const am = new AudioManager();
window.__am = am;
const $ = (id) => document.getElementById(id);
const btn = (parent, label, fn) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { am.unlock(); fn(); };
  parent.appendChild(b);
};
for (const id of SONG_IDS) btn($('music'), id, () => am.playMusic(id));
btn($('music'), 'stop', () => am.playMusic(null));
document.querySelectorAll('[data-tempo]').forEach((b) => (b.onclick = () => am.setMusicTempo(Number(b.dataset.tempo))));
for (const n of SFX_NAMES) btn($('sfx'), n, () => am.sfx(n, { level: 3, n: 1 }));
const pitches = { giggle: 1.8, hoho: 0.7, yay: 1.4, boing: 1.2, hum: 1.0 };
for (const style of VOICE_STYLES) {
  const row = document.createElement('div');
  row.textContent = `${style}: `;
  $('voices').appendChild(row);
  for (const kind of VOICE_KINDS) btn(row, kind, () => am.voice({ id: style, voice: { pitch: pitches[style], style } }, kind));
}
$('mv').oninput = (e) => am.setVolume({ music: Number(e.target.value) });
$('sv').oninput = (e) => am.setVolume({ sfx: Number(e.target.value) });

// ---- Offline analysis harness (used by the automated check) ----
async function renderOffline(seconds, fn) {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const m = new AudioManager({ createContext: () => ctx, startTimer: false, autoUnlock: false });
  m.unlock();
  // Start the sounds at 0.5 s so the dynamics processors are settled (like in the real game).
  ctx.suspend(0.5).then(() => {
    fn(m);
    for (let t = 1; t <= seconds; t += 0.5) m.tick(t);
    ctx.resume();
  });
  const buf = await ctx.startRendering();
  let peak = 0, sum = 0, nan = 0, n = 0;
  const win = Math.floor(sr * 0.05);
  let loudestWin = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let ws = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v; n++;
      ws += v * v;
      if (i % win === win - 1) { loudestWin = Math.max(loudestWin, Math.sqrt(ws / win)); ws = 0; }
    }
  }
  return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4), maxWinRms: +loudestWin.toFixed(3), nan };
}
window.__analyze = async () => {
  const out = {};
  for (const id of SONG_IDS) out[`music:${id}`] = await renderOffline(14, (m) => m.playMusic(id));
  out['music:castle@1.15'] = await renderOffline(8, (m) => { m.playMusic('castle'); m.setMusicTempo(1.15); });
  for (const n of SFX_NAMES) out[`sfx:${n}`] = await renderOffline(3, (m) => m.sfx(n, { level: 3, n: 1 }));
  for (const style of VOICE_STYLES) for (const kind of VOICE_KINDS) {
    out[`voice:${style}:${kind}`] = await renderOffline(2.5, (m) => m.voice({ id: style, voice: { pitch: pitches[style], style } }, kind));
  }
  out['worst-case-mix'] = await renderOffline(6, (m) => {
    m.playMusic('castle');
    m.sfx('win'); m.sfx('boost'); m.sfx('bonk'); m.sfx('finish');
    for (const style of VOICE_STYLES) m.voice({ id: style, voice: { pitch: pitches[style], style } }, 'win');
  });
  $('stats').textContent = JSON.stringify(out, null, 1);
  return out;
};
