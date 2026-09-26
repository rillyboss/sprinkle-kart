/**
 * Mobile platform ↔ race sessions. OWNER: mobile platform. Reads `app.game.platform` (src/platform/index.js,
 * created by main.js); without it (node tests, headless sessions) the system does nothing.
 *
 *   race-start   apply the quality preset to the freshly built scene: scenery outlines, scenery thinning by
 *                distance from the road, fog scale, weather density; set up kart outline LOD; full resolution
 *   race-frame   kart outline LOD against this frame's cameras
 *   race-exit    restore, and on phones / tablets free the race's GPU memory right away
 *   platform 'hidden' (tab switch, lock, home button) or 'contextlost' → pause an OFFLINE race via
 *                session.requestPause(label). Online races are never paused here: the host clock and heartbeat
 *                handle a hidden tab (NETWORKING.md §7.4 / §9.9).
 *   frame        on the title screen for a while → the PWA install hint (never during play)
 * Marks <html data-sk-racing="1"> during races so the platform's bubbles stay off the HUD.
 */
import '../platform/platform.css';
import {
  setOutlines, findAnimatedInstances, thinScenery, roadProximity, scaleFog, createKartLod, disposeTree,
} from '../platform/sceneTuning.js';

export const HIDDEN_PAUSE_LABEL = 'Paused while you were away 💤';
export const GL_NAP_TEXT = 'Taking a tiny nap… 💤';
/** Seconds on the title screen before the install hint may appear. */
export const HINT_AFTER_TITLE_SECONDS = 8;

/**
 * Apply a preset to a race session's scene. Exported for tests. Returns what it did.
 * @param {{ scene?: any, built?: any, path?: any }} session
 * @param {ReturnType<typeof import('../platform/quality.js').resolveQuality>} q
 */
export function tuneRaceScene(session, q) {
  const out = { outlinesHidden: 0, thinned: null, fog: false, particles: 0 };
  const group = session?.built?.group;
  if (!group || !q) return out;
  if (!q.sceneryOutlines) out.outlinesHidden = setOutlines(group, false);
  if (Number.isFinite(q.sceneryRadius)) {
    const animated = findAnimatedInstances(group, (dt, t) => session.built.update?.(dt, t));
    out.thinned = thinScenery(group, { keep: roadProximity(session.path, q.sceneryRadius), skip: animated });
  }
  const restoreFog = scaleFog(session.scene, q.fogScale);
  out.fog = q.fogScale !== 1 && !!session.scene?.fog;
  out.restoreFog = restoreFog;
  out.particles = scaleParticles(session.scene, q.particleScale, group);
  return out;
}

/** Weather / sparkle THREE.Points outside the track group: draw only `scale` of them. */
export function scaleParticles(scene, scale, skipRoot = null) {
  if (!scene?.traverse || !(scale < 1)) return 0;
  let n = 0;
  scene.traverse((o) => {
    if (!o.isPoints || !o.geometry) return;
    for (let p = o; p; p = p.parent) if (p === skipRoot) return;
    const count = o.geometry.attributes?.position?.count ?? 0;
    if (!count) return;
    o.geometry.setDrawRange(0, Math.max(1, Math.ceil(count * scale)));
    n++;
  });
  return n;
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'platform-quality',
  order: 99, // after the weather (60) and everything else that builds into the scene on race-start
  install(bus, app) {
    const platform = app.game?.platform;
    if (!platform) return undefined;
    const doc = typeof document !== 'undefined' ? document : null;
    const root = doc?.documentElement ?? null;
    let session = null;
    let lod = null;
    let tuning = null;
    let titleTime = 0;
    let nap = null;

    const pauseOffline = (label) => {
      const s = session;
      if (!s || s.net || s.paused || s.resultsShown) return false;
      try { s.requestPause?.(label); return true; } catch { return false; }
    };

    const offs = [
      bus.on('race-start', (info, s) => {
        session = s;
        if (root?.dataset) root.dataset.skRacing = '1';
        try { platform.pwa?.hideHint?.(); } catch { /* ignore */ }
        platform.resetResolution?.();
        const q = platform.quality;
        try {
          tuning = tuneRaceScene(s, q);
        } catch (err) { console.warn('[platform] scene tuning failed', err); tuning = null; }
        lod = Number.isFinite(q.kartOutlineDistance) ? createKartLod(() => s.race?.karts ?? [], q.kartOutlineDistance) : null;
        if (app.game) {
          app.game.platformTuning = tuning
            ? { quality: q.id, outlinesHidden: tuning.outlinesHidden, thinned: tuning.thinned, fog: tuning.fog, particles: tuning.particles }
            : null;
        }
      }),
      bus.on('race-frame', (dt, s) => {
        if (!lod || !s?.rigs) return;
        const cams = s.rigs.map((r) => r.camera);
        if (s.spectator?.camera) cams.push(s.spectator.camera);
        lod.update(cams);
      }),
      bus.on('race-exit', (e, s) => {
        try { lod?.restore(); } catch { /* ignore */ }
        try { tuning?.restoreFog?.(); } catch { /* ignore */ }
        lod = null;
        tuning = null;
        if (root?.dataset) root.dataset.skRacing = '0';
        // Phones / tablets: give the race's GPU memory back now instead of whenever GC gets to it.
        if (platform.caps?.mobile && s?.scene) {
          try {
            const freed = disposeTree(s.scene);
            platform.renderer?.renderLists?.dispose?.();
            if (app.game) app.game.platformFreed = freed;
          } catch (err) { console.warn('[platform] dispose failed', err); }
        }
        session = null;
      }),
      bus.on('frame', (dt) => {
        if (app.menus?.screenId === 'title' && !session) {
          titleTime += dt;
          if (titleTime >= HINT_AFTER_TITLE_SECONDS) { titleTime = -Infinity; try { platform.pwa?.showHint?.(); } catch { /* ignore */ } }
        } else if (titleTime > 0) titleTime = 0;
      }),
      platform.on('hidden', () => { pauseOffline(HIDDEN_PAUSE_LABEL); }),
      platform.on('contextlost', () => {
        pauseOffline(GL_NAP_TEXT);
        if (!doc?.createElement) return;
        if (!nap) {
          nap = doc.createElement('div');
          nap.className = 'sk-glnap';
          nap.textContent = GL_NAP_TEXT;
          doc.body?.appendChild(nap);
        }
        nap.hidden = false;
      }),
      platform.on('contextrestored', () => { if (nap) nap.hidden = true; }),
    ];
    return () => { offs.forEach((off) => off()); nap?.remove?.(); };
  },
};
