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
