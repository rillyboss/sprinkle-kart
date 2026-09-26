/**
 * 3D victory podium on the results screen. OWNER: showcase presentation.
 *
 * While the results screen is up, the top three racers are drawn as real 3D
 * models doing their personality dances (src/presentation/podium.js) exactly
 * where the screen's portraits sit (their DOM rects are read every frame, so
 * the layout, scaling and the "rise" animation all just work). The results
 * screen's candy background is swapped for a matching WebGL backdrop with
 * soft light rays behind the winner, and confetti drifts over the champion.
 *
 * Needs `app.renderer` (main.js passes it); without it (tests / headless) it
 * does nothing. Draws on the `frame` event, after the race view was drawn.
 */
import '../presentation/presentation.css';
import * as THREE from 'three';
import { prefs as sharedPrefs, effectivePrefs } from '../presentation/prefs.js';
import { buildPodiumStage } from '../presentation/podium.js';
import { getCharacter } from '../characters/index.js';
import { buildKartModel } from '../characters/model.js';

export const PODIUM_CLASS = 'skx-podium3d';

/** The characters on the podium, best first, from lastResults.standings. */
export function podiumCharacters(standings, lookup = getCharacter) {
  if (!Array.isArray(standings)) return [];
  return [...standings]
    .filter((s) => s && s.characterId)
    .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
    .slice(0, 3)
    .map((s) => lookup(s.characterId))
    .filter(Boolean);
}

/** Should the podium be showing right now? */
export function podiumWanted(game, menus, renderer) {
  return !!renderer && game?.state === 'results' && menus?.screenId === 'results'
    && Array.isArray(game?.lastResults?.standings) && game.lastResults.standings.length > 0;
}

/** Read the portrait rects of the results podium (DOM). */
export function readPodiumRects(root) {
  const rects = [null, null, null];
  let winnerRect = null;
  if (!root?.querySelectorAll) return { rects, winnerRect };
  for (const step of root.querySelectorAll('.sk-step')) {
    const m = /sk-step-(\d)/.exec(step.className);
    const place = m ? Number(m[1]) : 0;
    const p = step.querySelector('.sk-step-portrait');
    if (!p || place < 1 || place > 3) continue;
    const r = p.getBoundingClientRect();
    rects[place - 1] = { left: r.left, top: r.top, width: r.width, height: r.height };
    if (place === 1) winnerRect = rects[0];
  }
  return { rects, winnerRect };
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'victory-podium',
  order: 90,
  install(bus, app) {
    const store = app.prefs ?? sharedPrefs;
    let stage = null;
    let key = null;
    const size = new THREE.Vector2();
    const body = () => (typeof document !== 'undefined' ? document.body : null);

    const teardown = () => {
      if (!stage) return;
      try { stage.dispose(); } catch (err) { console.warn('[podium] dispose', err); }
      stage = null;
      key = null;
      body()?.classList.remove(PODIUM_CLASS);
    };
    if (app.game) app.game.podium = () => (stage ? { racers: stage.racers.map((r) => ({ id: r.def.id, dance: r.dance, visible: r.holder.visible })), time: stage.time } : null);

    const off = bus.on('frame', (dt, game) => {
      const renderer = app.renderer;
      if (!podiumWanted(game, app.menus, renderer) || typeof document === 'undefined') { teardown(); return; }
      const results = game.lastResults;
      if (stage && key !== results) teardown();
      if (!stage) {
        const defs = podiumCharacters(results.standings);
        if (!defs.length) return;
        try {
          stage = buildPodiumStage({ charDefs: defs, buildKartModel: app.buildKartModel ?? buildKartModel, gentle: effectivePrefs(store.get()).gentle });
        } catch (err) {
          console.warn('[podium] could not build', err);
          stage = null;
          return;
        }
        key = results;
        body()?.classList.add(PODIUM_CLASS);
        try { app.audio?.sfx?.('skx-podium', { volume: 0.9 }); } catch { /* ignore */ }
      }
      const canvas = renderer.domElement;
      const cr = canvas?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const { rects, winnerRect } = readPodiumRects(app.menus?.el ?? document);
      stage.update(dt, { width: cr.width, height: cr.height, left: cr.left, top: cr.top, rects, winnerRect });
      renderer.getSize(size);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
      stage.render(renderer);
    });
    return () => { off(); teardown(); };
  },
};
