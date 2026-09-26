/**
 * Music director (OWNER: showcase presentation). Pure rules + one small system
 * that make the music fit what is on screen, on top of the songs main.js picks:
 *
 *  - Title screen: its own bouncy theme (src/audio/songs/skx-title.js); every other
 *    menu screen keeps the gentle 'menu' tune main.js starts. Only swaps between
 *    those two, so race music, the victory tune and other systems' songs are safe.
 *  - Layers (AudioManager.setMusicLayers): the band thins out or joins in per screen.
 *    "Who's playing?" is lighter, grown-up corners (Settings, Sticker Book, Effects,
 *    Records, Item guide) are calm with no drums, the pause menu and Photo mode go
 *    soft and dreamy, the countdown is just pads + a heartbeat until GO brings the
 *    whole band in, and the final lap gets extra drums, bass and sparkle (main.js /
 *    race-flow already speed it up).
 *  - Results: when nobody at home made the top 3, the big victory fanfare becomes
 *    the cosier "Good try!" tune (src/audio/songs/skx-goodtry.js). Time Trials and
 *    podium finishes keep the fanfare.
 */

export const TITLE_SONG = 'skx-title';
export const MENU_SONG = 'menu';
export const VICTORY_SONG = 'victory';
export const GOOD_TRY_SONG = 'skx-goodtry';

/** Layer mixes (AudioManager.setMusicLayers levels; missing = 1). */
export const LAYERS = Object.freeze({
  full: Object.freeze({}),
  join: Object.freeze({ drums: 0.55, counter: 0.7 }),
  calm: Object.freeze({ drums: 0, bass: 0.6, arp: 0.75, counter: 0.6 }),
  paused: Object.freeze({ drums: 0, bass: 0.45, lead: 0.55, counter: 0.5, arp: 0.7, pad: 1.15 }),
  countdown: Object.freeze({ lead: 0, counter: 0, drums: 0.35, arp: 0.9, bass: 0.8, pad: 1.1 }),
  finalLap: Object.freeze({ drums: 1.2, bass: 1.1, arp: 1.2, counter: 1.2 }),
});

/** Menu screens that are quiet grown-up / browsing corners. */
export const CALM_SCREENS = new Set(['settings', 'collection', 'records', 'effects', 'item-guide']);

/** The song a menu screen wants, or null to leave the music alone. */
export function menuSongFor(state, screenId, current) {
  if (state !== 'menu') return null;
  if (current !== MENU_SONG && current !== TITLE_SONG) return null;
  const want = screenId === 'title' ? TITLE_SONG : MENU_SONG;
  return want === current ? null : want;
}

/**
 * Which layer mix fits right now.
 * @param {{ state?: string, screenId?: string|null, raceState?: string|null, finalLap?: boolean }} at
 * @returns {keyof LAYERS}
 */
export function layersFor({ state, screenId = null, raceState = null, finalLap = false } = {}) {
  if (state === 'paused') return 'paused';
  if (state === 'menu') {
    if (screenId === 'join') return 'join';
    if (CALM_SCREENS.has(screenId)) return 'calm';
    return 'full';
  }
  if (state === 'race') {
    if (raceState === 'countdown') return 'countdown';
    if (finalLap && raceState === 'racing') return 'finalLap';
  }
  return 'full';
}

/** Best (lowest) real place of a human in a RaceSummary, or null. */
function bestHumanPlace(summary) {
  const places = (summary?.humans || [])
    .filter((h) => h && h.finished !== false && Number.isFinite(h.place))
    .map((h) => h.place);
  return places.length ? Math.min(...places) : null;
}

/**
 * The results song for a finished race: the fanfare for a podium (or a Time Trial,
 * or when we can't tell), the "Good try!" tune when every human finished 4th or lower.
 */
export function resultsSongFor(summary) {
  if (!summary || summary.mode === 'time-trial') return VICTORY_SONG;
  const best = bestHumanPlace(summary);
  return best != null && best > 3 ? GOOD_TRY_SONG : VICTORY_SONG;
}

/** The song for the end of a Grand Prix (GrandPrixResult.bestHumanPlace). */
export function cupSongFor(gp) {
  const best = Number(gp?.bestHumanPlace);
  return Number.isFinite(best) && best > 3 ? GOOD_TRY_SONG : VICTORY_SONG;
}

const sameLayers = (a, b) => Object.keys(b).every((k) => Math.abs((a?.[k] ?? 1) - b[k]) < 1e-6);

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'menu-music',
  order: 97,
  install(bus, app) {
    let finalLap = false;
    /** victory-tune swaps waiting for their screen: game.state -> song */
    const swaps = new Map();
    const wantFull = (name) => {
      const full = {};
      for (const k of ['lead', 'counter', 'arp', 'pad', 'bass', 'drums']) full[k] = LAYERS[name][k] ?? 1;
      return full;
    };
    const queue = (state, song) => { if (song === VICTORY_SONG) swaps.delete(state); else swaps.set(state, song); };
    const offs = [
      bus.on('race-start', () => { finalLap = false; swaps.clear(); }),
      bus.on('race:final-lap', (e, s) => { if (!s?.isHuman || s.isHuman(e?.kart)) finalLap = true; }),
      bus.on('race-end', (summary) => queue('results', resultsSongFor(summary))),
      bus.on('gp-end', (gp) => queue('standings', cupSongFor(gp))),
      bus.on('race-exit', () => { finalLap = false; swaps.delete('results'); }),
      bus.on('frame', (dt, game) => {
        const audio = app.audio;
        if (!audio?.playMusic) return;
        const state = game?.state;
        const screenId = app.menus?.screenId ?? null;
        try {
          // 1) the song
          if (swaps.has(state) && audio.currentMusic === VICTORY_SONG) {
            audio.playMusic(swaps.get(state));
            swaps.delete(state);
          }
          if (state === 'menu') swaps.clear(); // left before the results showed up
          if (screenId) {
            const want = menuSongFor(state, screenId, audio.currentMusic);
            if (want) audio.playMusic(want);
          }
          // 2) the layers
          if (typeof audio.setMusicLayers !== 'function') return;
          const current = audio.musicLayers;
          if (!current) return; // no song yet (audio still locked)
          const name = layersFor({ state, screenId, raceState: game?.race?.state ?? null, finalLap });
          const want = wantFull(name);
          if (!sameLayers(current, want)) audio.setMusicLayers(want, name === 'full' && state === 'race' ? 0.35 : 0.8);
        } catch { /* music is decoration; never break a frame */ }
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};
