/**
 * Adds the race timer widget (src/ui/widgets/timer.js) to every player's HUD.
 * OWNER: modes + timing workstream.
 */
import { TIMER_WIDGET } from '../ui/widgets/timer.js';

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'timing-hud',
  order: 15,
  install(bus, app) {
    if (typeof app?.hud?.addWidget !== 'function') return undefined;
    const remove = app.hud.addWidget(TIMER_WIDGET);
    return () => remove?.();
  },
};
