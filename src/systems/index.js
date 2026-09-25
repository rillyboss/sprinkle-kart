/**
 * Systems = self-contained subscribers to the game event bus (sounds, HUD
 * callouts, rumble, progress tracking, per-frame engine sounds, ...).
 *
 * Every file in src/systems/ (except this one and files starting with "_")
 * that default-exports a SystemDef is installed automatically at boot, in
 * `order` (then file name) order. Adding a system never needs an edit to a
 * shared file: create src/systems/<yourThing>.js, e.g.
 *
 *   export default {
 *     id: 'engine-sounds',
 *     order: 50,                       // optional, default 100 (lower = earlier)
 *     install(bus, app) {              // app = { audio, input, hud, menus, progress, params, game }
 *       const off = bus.on('race-frame', (dt, session) => { ... });
 *       return () => off();            // optional uninstall
 *     },
 *   };
 *
 * @typedef {{ id: string, order?: number, install: (bus: object, app: object) => (void|(() => void)) }} SystemDef
 */

const MODULES = import.meta.glob(['./*.js', '!./index.js', '!./_*.js'], { eager: true });

/** @returns {SystemDef[]} every system, sorted by order then file name. */
export function listSystems(modules = MODULES) {
  return Object.entries(modules)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, m]) => m?.default)
    .filter((s) => s && typeof s.id === 'string' && typeof s.install === 'function')
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/**
 * Install every system on the bus. A system that throws while installing is
 * reported and skipped. Returns an uninstall-all function.
 */
export function installSystems(bus, app, systems = listSystems()) {
  const offs = [];
  for (const s of systems) {
    try {
      const off = s.install(bus, app);
      if (typeof off === 'function') offs.push(off);
    } catch (err) {
      console.error(`[systems] ${s.id} failed to install:`, err);
    }
  }
  return () => {
    for (const off of offs.reverse()) {
      try { off(); } catch { /* ignore */ }
    }
  };
}
