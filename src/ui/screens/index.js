/**
 * Screen registry. Every file in src/ui/screens/ (except this one and files
 * starting with "_") whose default export has an `id` and a `mount` function
 * is a screen, registered automatically — adding a screen needs no edit to a
 * shared file.
 *
 * ScreenDef:
 *   {
 *     id: 'mode-select',
 *     flow: { order: 25, when?: (ctx) => boolean },   // optional: part of the pre-race flow
 *     mount(ctx, nav, params) -> ScreenInstance,
 *   }
 * ScreenInstance: { node: HTMLElement, cls?: string, handle(ev), update?(dt), refresh?(), destroy?() }
 *
 * Flow screens run in `flow.order` (title 10, join 20, character-select 30,
 * track-select 40). Put a new one between two others by picking an order in
 * between (e.g. mode select at 25). `when(ctx)` or `ctx.draft.skip` (a Set of
 * screen ids) can leave a screen out for the current run (e.g. Grand Prix
 * skips track-select for a cup-select screen).
 *
 * nav (2nd mount argument):
 *   nav.next()            go to the next flow screen (or finish if none)
 *   nav.back()            previous flow screen
 *   nav.goto(id, params)  any screen
 *   nav.finish(setup)     end the flow: Menus.run() resolves with this RaceSetup
 *   nav.resolve(value)    close an overlay/one-off screen (pause, results): its promise resolves
 *
 * @typedef {{ id: string, flow?: { order: number, when?: (ctx: object) => boolean },
 *   mount: (ctx: object, nav: object, params?: object) => object }} ScreenDef
 */

const MODULES = import.meta.glob(['./*.js', '!./index.js', '!./_*.js'], { eager: true });

/** @returns {Map<string, ScreenDef>} */
export function collectScreens(modules = MODULES) {
  const map = new Map();
  for (const file of Object.keys(modules).sort()) {
    const def = modules[file]?.default;
    if (!def || typeof def.id !== 'string' || typeof def.mount !== 'function') continue;
    if (map.has(def.id)) {
      console.warn(`[screens] duplicate screen id "${def.id}" in ${file} (ignored)`);
      continue;
    }
    map.set(def.id, def);
  }
  return map;
}

export const SCREENS = collectScreens();
