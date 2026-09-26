/**
 * Menu music per screen: the title screen gets its own bouncy theme
 * (src/audio/songs/skx-title.js); every other menu screen keeps the gentle
 * 'menu' tune main.js starts. Only swaps between those two, so race music,
 * the victory tune and anything another system plays are never touched.
 * OWNER: showcase presentation.
 */

export const TITLE_SONG = 'skx-title';
export const MENU_SONG = 'menu';

/** The song a menu screen wants, or null to leave the music alone. */
export function menuSongFor(state, screenId, current) {
  if (state !== 'menu') return null;
  if (current !== MENU_SONG && current !== TITLE_SONG) return null;
  const want = screenId === 'title' ? TITLE_SONG : MENU_SONG;
  return want === current ? null : want;
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'menu-music',
  order: 97,
  install(bus, app) {
    return bus.on('frame', (dt, game) => {
      const audio = app.audio;
      if (!audio?.playMusic || !app.menus?.screenId) return;
      const want = menuSongFor(game?.state, app.menus.screenId, audio.currentMusic);
      if (want) { try { audio.playMusic(want); } catch { /* audio is optional */ } }
    });
  },
};
