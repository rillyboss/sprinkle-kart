/**
 * Fun Goal sticker toasts: a little sticker slides in at the top of the
 * screen ("New sticker! Drift Master 🌀") for every Fun Goal earned, one
 * after another. Headless-safe (does nothing without a DOM).
 *
 *   const toasts = createGoalToasts({ root: document.body, sfx: (n) => audio.sfx(n) });
 *   toasts.show(goals)   // queue [{ emoji, name, hint }]
 *   toasts.clear()
 *
 * OWNER: showcase features & modes.
 */
import './goalToasts.css';

/** How many toasts are shown one by one before the rest fold into "+N more". */
export const MAX_TOASTS = 3;
/** Seconds each toast stays up. */
export const TOAST_SECONDS = 3.6;

/**
 * Which toasts to show for a batch of newly earned goals (pure, unit tested):
 * the first MAX_TOASTS, then one summary toast for the rest.
 */
export function toastPlan(goals = [], max = MAX_TOASTS) {
  const list = (goals || []).filter((g) => g && g.name);
  if (list.length <= max) return list.map((g) => ({ emoji: g.emoji || '🏅', title: 'New sticker!', name: g.name, hint: g.hint || '' }));
  const shown = list.slice(0, max - 1).map((g) => ({ emoji: g.emoji || '🏅', title: 'New sticker!', name: g.name, hint: g.hint || '' }));
  const rest = list.length - shown.length;
  shown.push({ emoji: '📒', title: 'Wow!', name: `${rest} more new stickers!`, hint: 'Look in your Sticker Book' });
  return shown;
}

export function createGoalToasts({ root = typeof document !== 'undefined' ? document.body : null, sfx = null, seconds = TOAST_SECONDS } = {}) {
  if (!root || typeof document === 'undefined') return { show() { return 0; }, clear() {}, get queued() { return 0; } };
  let host = null;
  const queue = [];
  let timer = null;
  const ensureHost = () => {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.className = 'skg-toasts';
    root.appendChild(host);
    return host;
  };
  const next = () => {
    timer = null;
    const t = queue.shift();
    if (!t) return;
    const box = ensureHost();
    const node = document.createElement('div');
    node.className = 'skg-toast';
    node.innerHTML = `<span class="skg-sticker">${t.emoji}</span><span class="skg-text"><small>${esc(t.title)}</small><b>${esc(t.name)}</b>${t.hint ? `<i>${esc(t.hint)}</i>` : ''}</span>`;
    box.appendChild(node);
    try { sfx?.('goal-sticker'); } catch { /* ignore */ }
    setTimeout(() => node.classList.add('skg-leaving'), seconds * 1000);
    setTimeout(() => node.remove(), seconds * 1000 + 500);
    timer = setTimeout(next, 900);
  };
  return {
    show(goals) {
      const plan = toastPlan(goals);
      queue.push(...plan);
      if (!timer) next();
      return plan.length;
    },
    clear() {
      queue.length = 0;
      if (timer) clearTimeout(timer);
      timer = null;
      host?.remove();
      host = null;
    },
    get queued() { return queue.length; },
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
