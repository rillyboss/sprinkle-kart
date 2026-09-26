/**
 * Ambient track life: per-track weather around every camera (see
 * src/presentation/weather.js). OWNER: showcase presentation.
 *
 *   race-start  build the track's weather into session.scene (if the
 *               "Weather & sparkles" pref is on and the session has a scene)
 *   race-frame  advance it (frozen while paused)
 *   race-exit   dispose
 * The pref can be flipped at any time; half the particles in gentle motion.
 */
import { prefs as sharedPrefs, effectivePrefs } from '../presentation/prefs.js';
import { weatherFor, weatherSpec, buildWeather } from '../presentation/weather.js';

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'ambient-weather',
  order: 60,
  install(bus, app) {
    const store = app.prefs ?? sharedPrefs;
    let weather = null;
    let session = null;

    const clear = () => {
      try { weather?.dispose(); } catch (err) { console.warn('[weather] dispose', err); }
      weather = null;
    };
    const build = () => {
      clear();
      const scene = session?.scene;
      if (!scene?.add) return;
      const fx = effectivePrefs(store.get());
      if (!fx.weather) return;
      const spec = weatherSpec(weatherFor(session.trackDef), { particleScale: fx.particleScale });
      if (!spec || spec.count <= 0) return;
      try {
        weather = buildWeather(spec, { seed: session.trackDef?.id ?? 'track' });
        scene.add(weather.object);
      } catch (err) {
        console.warn('[weather] could not build', err);
        weather = null;
      }
    };
    if (app.game) app.game.weather = () => (weather ? { kind: weather.kind, count: weather.count, time: weather.time } : null);

    const offs = [
      bus.on('race-start', (info, s) => { session = s; build(); }),
      bus.on('race-frame', (dt, s) => {
        if (!weather || s?.paused) return;
        weather.update(dt);
      }),
      bus.on('race-exit', () => { clear(); session = null; }),
      store.subscribe(() => { if (session) build(); }),
    ];
    return () => { offs.forEach((off) => off()); clear(); };
  },
};
