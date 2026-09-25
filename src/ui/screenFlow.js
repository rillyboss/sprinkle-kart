/**
 * Pure flow logic for the menu screen router (DOM-free, unit tested).
 */

/**
 * The ordered list of flow screen ids for this run.
 * @param {Map<string, {id:string, flow?:{order:number, when?:Function}}>|Array} screens
 * @param {object} ctx menu context (ctx.draft.skip: Set of ids to leave out)
 * @returns {string[]}
 */
export function flowOrder(screens, ctx = {}) {
  const list = screens instanceof Map ? [...screens.values()] : [...screens];
  const skip = ctx?.draft?.skip;
  return list
    .filter((s) => s.flow && Number.isFinite(s.flow.order))
    .filter((s) => !(skip && typeof skip.has === 'function' && skip.has(s.id)))
    .filter((s) => {
      if (typeof s.flow.when !== 'function') return true;
      try { return !!s.flow.when(ctx); } catch { return false; }
    })
    .sort((a, b) => a.flow.order - b.flow.order || (a.id < b.id ? -1 : 1))
    .map((s) => s.id);
}

/** Next flow id after `current` (null at the end). An unknown current starts at the beginning. */
export function nextInFlow(order, current) {
  const i = order.indexOf(current);
  if (i < 0) return order[0] ?? null;
  return order[i + 1] ?? null;
}

/** Previous flow id before `current` (null at the start or when unknown). */
export function prevInFlow(order, current) {
  const i = order.indexOf(current);
  if (i <= 0) return null;
  return order[i - 1];
}

/** Where run() starts: the first flow screen, or the one after 'title' when skipping it. */
export function flowStart(order, { skipTitle = false } = {}) {
  if (!order.length) return null;
  if (skipTitle && order[0] === 'title') return order[1] ?? null;
  return order[0];
}

/**
 * Menu entries: screens that are not part of the linear flow but should be
 * reachable from a menu (Settings / parent gate, Collection ...) declare
 *   menuEntry: { label: 'Grown-ups', emoji: '⚙️', order?: 50, where?: 'title' }
 * on their ScreenDef. The title screen shows every `where: 'title'` entry
 * (the default) as a small button row; other screens (e.g. mode select) may
 * render their own with menuEntries(ctx.screens, '<their id>').
 * An entry screen is opened with params `{ returnTo }` and goes back with
 * `nav.goto(params.returnTo ?? 'title')`.
 * @returns {{id:string, label:string, emoji:string, order:number}[]}
 */
export function menuEntries(screens, where = 'title') {
  const list = screens instanceof Map ? [...screens.values()] : [...(screens || [])];
  return list
    .filter((s) => s && s.menuEntry && typeof s.menuEntry.label === 'string' && (s.menuEntry.where ?? 'title') === where)
    .map((s) => ({ id: s.id, label: s.menuEntry.label, emoji: s.menuEntry.emoji ?? '', order: Number.isFinite(s.menuEntry.order) ? s.menuEntry.order : 100 }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

/**
 * Title-screen focus reducer. focus = -1 ("Press A" to play) or the index of a
 * menu entry. Returns { focus, play, open } where `open` is an entry index.
 * @param {number} focus
 * @param {string} action menu action (up|down|left|right|confirm|start|back)
 * @param {number} count number of menu entries
 */
export function titleFocusReduce(focus, action, count) {
  const res = { focus, play: false, open: null };
  if (action === 'start') { res.play = true; return res; }
  if (focus < 0 || !count) {
    if (action === 'confirm') res.play = true;
    else if (action === 'down' && count) res.focus = 0;
    return res;
  }
  if (action === 'left') res.focus = (focus - 1 + count) % count;
  else if (action === 'right') res.focus = (focus + 1) % count;
  else if (action === 'up' || action === 'back') res.focus = -1;
  else if (action === 'confirm') res.open = focus;
  return res;
}
