/**
 * Adds the Bubble Battle, Team Race and Daily Sprinkle and How to Play HUD widgets (src/ui/widgets/showcaseModes.js)
 * to every player's HUD. They stay hidden unless their mode is running.
 * OWNER: showcase features & modes.
 */
import { BATTLE_WIDGET, TEAM_WIDGET, DAILY_WIDGET, TUTORIAL_WIDGET } from '../ui/widgets/showcaseModes.js';

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'showcase-hud',
  order: 16,
  install(bus, app) {
    if (typeof app?.hud?.addWidget !== 'function') return undefined;
    const removers = [app.hud.addWidget(BATTLE_WIDGET), app.hud.addWidget(TEAM_WIDGET), app.hud.addWidget(DAILY_WIDGET), app.hud.addWidget(TUTORIAL_WIDGET)];
    return () => removers.forEach((r) => r?.());
  },
};
