/**
 * A tiny fake DOM for testing HUD widgets in node (no jsdom dependency).
 *
 *   const doc = createFakeDocument();
 *   vi.stubGlobal('document', doc);            // widgets call document.createElement
 *   const node = doc.createElement('div');
 *   const w = TIMER_WIDGET.create(node, 0, node);
 *   w.update(kart, race);
 *   node.querySelector('.sk-timer-t').textContent   // '0:12.34'
 *   node.querySelectorAll('.sk-split').length
 *   doc.writes                                    // textContent / innerHTML writes so far
 *
 * Supports: className, classList (add/remove/toggle/contains), textContent (get = own +
 * descendants), innerHTML (set '' clears children; other strings are kept verbatim and
 * readable back, class names inside are NOT parsed into nodes — use querySelector on real
 * children only, or `htmlOf(node)` to search the markup), appendChild / append / prepend /
 * remove / replaceChildren, children, firstChild, parentNode, dataset, hidden, style
 * (+ setProperty / removeProperty), setAttribute / getAttribute, addEventListener (records),
 * querySelector / querySelectorAll for simple `.class` / `tag` / `.a.b` selectors,
 * offsetWidth / clientWidth / clientHeight (settable numbers, default 0).
 */

function matches(node, sel) {
  const s = sel.trim();
  const m = /^([a-z0-9-]*)((?:\.[\w-]+)*)$/i.exec(s);
  if (!m) throw new Error(`fakeDom: unsupported selector "${sel}"`);
  const [, tag, cls] = m;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  const want = cls ? cls.split('.').filter(Boolean) : [];
  return want.every((c) => node.classList.contains(c));
}

function walk(node, fn) {
  for (const c of node.children) {
    fn(c);
    walk(c, fn);
  }
}

export function createFakeDocument() {
  const doc = { writes: 0, created: 0 };

  function createElement(tag = 'div') {
    doc.created++;
    let text = '';
    let html = '';
    let className = '';
    const style = {
      setProperty(k, v) { style[k] = String(v); },
      removeProperty(k) { delete style[k]; },
      getPropertyValue(k) { return style[k] ?? ''; },
    };
    const attrs = new Map();
    const node = {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      children: [],
      parentNode: null,
      dataset: {},
      style,
      hidden: false,
      listeners: [],
      offsetWidth: 0,
      clientWidth: 0,
      clientHeight: 0,
      get className() { return className; },
      set className(v) { className = String(v ?? ''); },
      classList: {
        _list: () => className.split(/\s+/).filter(Boolean),
        contains: (c) => node.classList._list().includes(c),
        add: (...cs) => { const l = node.classList._list(); for (const c of cs) if (!l.includes(c)) l.push(c); className = l.join(' '); },
        remove: (...cs) => { className = node.classList._list().filter((c) => !cs.includes(c)).join(' '); },
        toggle: (c, force) => {
          const on = force === undefined ? !node.classList.contains(c) : !!force;
          if (on) node.classList.add(c); else node.classList.remove(c);
          return on;
        },
      },
      get firstChild() { return node.children[0] ?? null; },
      get textContent() { return text + node.children.map((c) => c.textContent).join(''); },
      set textContent(v) { doc.writes++; text = String(v ?? ''); html = ''; node._detachAll(); },
      get innerHTML() { return html; },
      set innerHTML(v) { doc.writes++; html = String(v ?? ''); text = ''; node._detachAll(); },
      _detachAll() { for (const c of node.children) c.parentNode = null; node.children.length = 0; },
      appendChild(c) {
        if (c.parentNode) c.remove();
        c.parentNode = node;
        node.children.push(c);
        return c;
      },
      append(...cs) { for (const c of cs) node.appendChild(typeof c === 'string' ? Object.assign(createElement('#text'), { textContent: c }) : c); },
      prepend(...cs) { for (const c of cs.reverse()) { if (c.parentNode) c.remove(); c.parentNode = node; node.children.unshift(c); } },
      replaceChildren(...cs) { node._detachAll(); node.append(...cs); },
      insertBefore(c, ref) {
        if (c.parentNode) c.remove();
        const i = ref ? node.children.indexOf(ref) : -1;
        c.parentNode = node;
        if (i < 0) node.children.push(c); else node.children.splice(i, 0, c);
        return c;
      },
      removeChild(c) { c.remove(); return c; },
      remove() {
        const p = node.parentNode;
        if (!p) return;
        const i = p.children.indexOf(node);
        if (i >= 0) p.children.splice(i, 1);
        node.parentNode = null;
      },
      contains(other) { let n = other; while (n) { if (n === node) return true; n = n.parentNode; } return false; },
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'class') className = String(v); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener(type, fn) { node.listeners.push({ type, fn }); },
      removeEventListener(type, fn) { node.listeners = node.listeners.filter((l) => l.type !== type || l.fn !== fn); },
      getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: node.clientWidth, bottom: node.clientHeight, width: node.clientWidth, height: node.clientHeight }; },
      querySelectorAll(sel) {
        const out = [];
        const sels = sel.split(',');
        for (const s of sels) matches(node, s); // validate even when there is nothing to match
        walk(node, (c) => { if (sels.some((s) => matches(c, s))) out.push(c); });
        return out;
      },
      querySelector(sel) { return node.querySelectorAll(sel)[0] ?? null; },
    };
    return node;
  }

  doc.createElement = createElement;
  doc.createTextNode = (t) => Object.assign(createElement('#text'), { textContent: t });
  doc.body = createElement('body');
  doc.documentElement = createElement('html');
  return doc;
}

/** Markup of a node and its descendants' innerHTML strings (to search set-by-innerHTML content). */
export function htmlOf(node) {
  return node.innerHTML + node.children.map(htmlOf).join('');
}
