/**
 * 3D victory podium on the results screen and the Grand Prix trophy ceremony.
 * OWNER: showcase presentation.
 *
 * While the results screen (or the cup's trophy ceremony) is up, the top three racers are drawn as real 3D
 * models doing their personality dances (src/presentation/podium.js) exactly
 * where the screen's portraits sit (their DOM rects are read every frame, so
 * the layout, scaling and the "rise" animation all just work). The results
 * screen's candy background is swapped for a matching WebGL backdrop with
 * soft light rays behind the winner, and confetti drifts over the champion.
 * The racers cheer in their own voices as they appear (winner first).
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

/** Should the podium be showing on the results screen right now? */
export function podiumWanted(game, menus, renderer) {
  return !!renderer && game?.state === 'results' && menus?.screenId === 'results'
    && Array.isArray(game?.lastResults?.standings) && game.lastResults.standings.length > 0;
}

/**
 * Where the podium goes right now: 'results', 'ceremony' (the final Grand Prix
 * standings once the trophy ceremony is on screen) or null.
 * @param {object} game  window.__game-like state
 * @param {{ screenId?: string }} menus
 * @param {object|null} renderer
 * @param {{ querySelector?: Function }|null} root  DOM to look for the ceremony podium in
 */
export function podiumMode(game, menus, renderer, root = null) {
  if (podiumWanted(game, menus, renderer)) return 'results';
  if (!renderer || game?.state !== 'standings' || menus?.screenId !== 'gp-standings') return null;
  const gp = game?.lastGp;
  if (!gp?.finished || !Array.isArray(gp.standings) || !gp.standings.length) return null;
  return root?.querySelector?.('.sk-cer-podium') ? 'ceremony' : null;
}

/** The standings the podium shows for a mode, and the object that identifies them. */
export function podiumSource(mode, game) {
  if (mode === 'results') return { key: game.lastResults, standings: game.lastResults.standings };
  if (mode === 'ceremony') return { key: game.lastGp, standings: game.lastGp.standings };
  return null;
}

/** When each racer cheers once the podium appears: winner, then 2nd, then 3rd. */
export const CHEER_TIMES = Object.freeze([0.55, 1.35, 1.8]);

/** The voice cheers for the podium racers (best first): [{ at, def, kind, pan }]. */
export function podiumCheers(defs = []) {
  const pans = [0, -0.35, 0.35]; // 1st in the middle, 2nd on the left, 3rd on the right
  return defs.slice(0, 3).filter(Boolean).map((def, i) => ({ at: CHEER_TIMES[i], def, kind: i === 0 ? 'win' : 'yay', pan: pans[i] }));
}

/** Read the portrait rects of the results podium or the trophy ceremony (DOM). */
export function readPodiumRects(root) {
  const rects = [null, null, null];
  let winnerRect = null;
  if (!root?.querySelectorAll) return { rects, winnerRect };
  for (const step of root.querySelectorAll('.sk-step, .sk-cer-step')) {
    const m = /sk-(?:step|cer)-(\d)/.exec(step.className);
    const place = m ? Number(m[1]) : 0;
    const p = step.querySelector('.sk-step-portrait, .sk-cer-portrait');
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
    let mode = null;
    let cheers = [];
    const size = new THREE.Vector2();
    const body = () => (typeof document !== 'undefined' ? document.body : null);

    const teardown = () => {
      cheers = [];
      if (!stage) return;
      try { stage.dispose(); } catch (err) { console.warn('[podium] dispose', err); }
      stage = null;
      key = null;
      mode = null;
      body()?.classList.remove(PODIUM_CLASS);
    };
    if (app.game) {
      app.game.podium = () => (stage ? {
        mode, racers: stage.racers.map((r) => ({ id: r.def.id, dance: r.dance, visible: r.holder.visible })), time: stage.time,
        cheersLeft: cheers.length,
      } : null);
    }

    const off = bus.on('frame', (dt, game) => {
      const renderer = app.renderer;
      if (typeof document === 'undefined') { teardown(); return; }
      const root = app.menus?.el ?? document;
      const want = podiumMode(game, app.menus, renderer, root);
      if (!want) { teardown(); return; }
      const src = podiumSource(want, game);
      if (stage && (key !== src.key || mode !== want)) teardown();
      if (!stage) {
        const defs = podiumCharacters(src.standings);
        if (!defs.length) return;
        try {
          stage = buildPodiumStage({ charDefs: defs, buildKartModel: app.buildKartModel ?? buildKartModel, gentle: effectivePrefs(store.get()).gentle });
        } catch (err) {
          console.warn('[podium] could not build', err);
          stage = null;
          return;
        }
        key = src.key;
        mode = want;
        // the ceremony screen already plays its own trophy fanfare + winner voice
        cheers = want === 'results' ? podiumCheers(defs) : podiumCheers(defs).slice(1);
        body()?.classList.add(PODIUM_CLASS);
        if (want === 'results') { try { app.audio?.sfx?.('skx-podium', { volume: 0.9 }); } catch { /* ignore */ } }
      }
      while (cheers.length && stage.time >= cheers[0].at) {
        const c = cheers.shift();
        try { app.audio?.voice?.(c.def, c.kind, { pan: c.pan, volume: 0.8 }); } catch { /* voices are optional */ }
      }
      const canvas = renderer.domElement;
      const cr = canvas?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const { rects, winnerRect } = readPodiumRects(root);
      stage.update(dt, { width: cr.width, height: cr.height, left: cr.left, top: cr.top, rects, winnerRect });
      renderer.getSize(size);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
      stage.render(renderer);
    });
    return () => { off(); teardown(); };
  },
};
