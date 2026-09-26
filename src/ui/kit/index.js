/**
 * Candy Arcade UI kit — tokens, icons, components and the HUD toast lane.
 * Import from here in screens:  import { buttonHtml, icon, tabBar } from '../kit/index.js';
 * Importing this module loads the kit stylesheets (tokens -> components -> legacy bridge -> HUD).
 * Docs page: run the dev server and open ?uikit=1. Contract: src/ui/kit/README.md.
 */
import './tokens.css';
import './kit.css';
import './bridge.css';
import './hud.css';

export { icon, ICON_NAMES, hasIcon, iconForEmoji, modeIcon, itemIcon, entryIcon, starPath, gearPath } from './icons.js';
export {
  PAD_GLYPHS, glyphHtml, keyHtml, inputsHtml, hintHtml, titleHtml, badgeHtml, buttonHtml, button, tabBar,
  panel, segmented, meterHtml, starsHtml, toastHtml, modal, footbar, topbar,
} from './components.js';
export {
  LANE_MAX, LANE_TTL, LANE_TTL_MAX, createLaneModel, createToastLane, laneFor, toastFromText, toneForText, toToast,
} from './toastLane.js';

/** Google Fonts for the kit: Lilita One (display) + Fredoka (body). */
export const KIT_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Lilita+One&display=swap';
