/**
 * online-join — "Join a friend" (NETWORKING.md §10.1): "Games you can join" as big buttons (one press to
 * join) with "Type a code" as the fallback.
 *
 * The list comes from our Worker's open-games list through `ctx.online.listRooms()` →
 * `{ supported, rooms: [{ code, who, players }] | null }` and refreshes every ROOMS_POLL_MS while the screen
 * is open. When the list is not supported (a build without our Worker, or an older Worker without /rooms)
 * the screen just shows "Type a code". A room's name is its host P1's racer ("Luna Lollicorn's game") when
 * this game knows that racer, else "A friend's game" — never free text.
 *
 * Params: { returnTo?, rooms?: object (a fixed list result, for tests / screenshots) }.
 * OWNER: online session & screens.
 */
import './online.css';
import { el, escapeHtml, hint, kbd, floatiesLayer, portraitHtml } from '../dom.js';
import { hintsBar, backButton } from './_shared.js';
import { TEXT } from '../../net/session/texts.js';

export const ROOMS_POLL_S = 4;
const wrap = (i, n) => (n ? ((i % n) + n) % n : 0);

/**
 * The buttons for a list result (pure): open games first (at most 8), then "Type a code".
 * @param {{ supported?: boolean, rooms?: Array<{ code: string, who: string|null, players: number }>|null }|null} result
 * @param {(id: string) => ({ name: string }|null)} [charOf]
 */
export function joinItems(result, charOf = () => null) {
  const items = [];
  if (result?.supported && Array.isArray(result.rooms)) {
    for (const r of result.rooms.slice(0, 8)) {
      const def = r.who ? charOf(r.who) : null;
      items.push({
        kind: 'room', code: r.code, players: r.players, who: def ? r.who : null,
        title: def ? TEXT.friendsGame(def.name) : TEXT.someonesGame,
      });
    }
  }
  items.push({ kind: 'type', title: TEXT.typeCode });
  return items;
}

/** What the list says right now (pure): 'looking' | 'list' | 'empty' | 'off'. */
export function joinStatus(result) {
  if (!result) return 'looking';
  if (!result.supported) return 'off';
  return result.rooms?.length ? 'list' : 'empty';
}

/**
 * Screen reducer: arrows move (the list wraps), A / Start picks, B leaves.
 * @returns {{ state: { index: number }, fx: string[], go: null | 'back' | { join: string } | 'type' }}
 */
export function joinReduce(s, ev, items) {
  const n = items.length;
  const pick = (i) => {
    const it = items[i];
    if (!it) return { state: s, fx: [], go: null };
    return { state: { ...s, index: i }, fx: ['confirm'], go: it.kind === 'room' ? { join: it.code } : 'type' };
  };
  switch (ev.action) {
    case 'up': case 'left': return { state: { ...s, index: wrap(s.index - 1, n) }, fx: ['move'], go: null };
    case 'down': case 'right': return { state: { ...s, index: wrap(s.index + 1, n) }, fx: ['move'], go: null };
    case 'confirm': case 'start': return pick(wrap(s.index, n));
    case 'select': return Number.isInteger(ev.index) && ev.index >= 0 && ev.index < n ? pick(ev.index) : { state: s, fx: [], go: null };
    case 'back': return { state: s, fx: ['back'], go: 'back' };
    default: return { state: s, fx: [], go: null };
  }
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'online-join',
  mount(ctx, nav, params = {}) {
    let result = params.rooms ?? null;
    let state = { index: 0 };
    let items = joinItems(result, (id) => ctx.char?.(id) ?? null);
    let since = 0;
    let asking = false;
    let gone = false;

    const status = el('div.skn-join-status', { role: 'status' });
    const list = el('div.skn-join-list');
    const node = el('div.sk-screen.skn-screen.skn-join', {},
      floatiesLayer(12, 23),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Join a friend <span class="sk-wiggle">🏡</span>' })),
      el('h2.skn-join-h', {}, TEXT.openGames),
      status,
      list,
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('A', 'Enter', 'Join'),
        hint('B', 'Esc', 'Back'),
      ]),
    );

    const render = () => {
      const st = joinStatus(result);
      node.classList.toggle('skn-join-off', st === 'off');
      status.textContent = st === 'looking' ? TEXT.lookingForGames : st === 'empty' ? TEXT.noOpenGames : st === 'off' ? TEXT.codeHelp : '';
      list.innerHTML = '';
      items.forEach((it, i) => {
        const def = it.who ? ctx.char?.(it.who) : null;
        const face = def ? portraitHtml(def, ctx.portraits, { cls: 'skn-join-face' }) : `<span class="skn-join-face">${it.kind === 'room' ? '🏰' : '⌨️'}</span>`;
        const body = it.kind === 'room'
          ? `<span class="skn-join-t">${escapeHtml(it.title)}</span><span class="skn-join-code">${escapeHtml(it.code)}</span><span class="skn-join-n">${'🏎️'.repeat(Math.min(it.players, 8))}</span>`
          : `<span class="skn-join-t">${escapeHtml(it.title)}</span><span class="skn-join-sub">${escapeHtml(TEXT.codeHelp)}</span>`;
        const b = el(`button.skn-join-item.skn-join-${it.kind}`, {
          onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: i }); },
          onmouseenter: () => { if (state.index !== i) { state = { index: i }; sync(); } },
          html: `${face}<span class="skn-join-body">${body}</span>`,
        });
        list.appendChild(b);
      });
      sync();
    };
    const sync = () => [...list.children].forEach((b, i) => b.classList.toggle('sk-sel', i === state.index));

    /** Keep the cursor on the same game when the list refreshes. */
    const setResult = (next) => {
      if (gone) return;
      const was = items[state.index];
      // a 429 (asked too often) keeps the last list
      result = next && next.supported && next.rooms === null ? { ...next, rooms: result?.rooms ?? [] } : next;
      items = joinItems(result, (id) => ctx.char?.(id) ?? null);
      const again = was ? items.findIndex((it) => it.kind === was.kind && it.code === was.code) : -1;
      state = { index: again >= 0 ? again : Math.min(state.index, items.length - 1) };
      render();
    };

    const ask = () => {
      if (asking || typeof ctx.online?.listRooms !== 'function') return;
      asking = true;
      Promise.resolve()
        .then(() => ctx.online.listRooms())
        .then((r) => setResult(r ?? { supported: false, rooms: [] }), () => setResult({ supported: false, rooms: [] }))
        .finally(() => { asking = false; });
    };

    const handle = (ev) => {
      const res = joinReduce(state, ev, items);
      state = res.state;
      ctx.fx?.(res);
      sync();
      if (res.go === 'back') nav.goto(params.returnTo ?? 'online-hub');
      else if (res.go === 'type') nav.goto('code-entry', { returnTo: 'online-join' });
      else if (res.go?.join) {
        if (ctx.online?.join) ctx.online.join(res.go.join);
        else status.textContent = TEXT.comingSoon;
      }
    };

    if (!params.rooms) {
      if (typeof ctx.online?.listRooms === 'function') ask();
      else result = { supported: false, rooms: [] };
      items = joinItems(result, (id) => ctx.char?.(id) ?? null);
    }
    render();
    return {
      node,
      cls: 'sk-mode-full skn-mode-online',
      handle,
      update(dt = 1 / 60) {
        if (params.rooms || !result?.supported) return; // an old worker / no worker: nothing to refresh
        since += dt;
        if (since >= ROOMS_POLL_S) { since = 0; ask(); }
      },
      destroy() { gone = true; },
    };
  },
};
