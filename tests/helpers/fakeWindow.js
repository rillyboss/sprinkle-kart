/**
 * A small fake browser window/document for the mobile platform tests (src/platform/*): event targets that
 * record listeners and can dispatch, a documentElement with style + dataset, createElement nodes with
 * classList / hidden / children / click listeners, matchMedia, navigator, screen, location, timers.
 *
 *   const win = createFakeWindow({ innerWidth: 390, innerHeight: 844, navigator: { ... } });
 *   win.document.fire('touchmove', { touches: [{}], target });   // → the event object (defaultPrevented)
 */
export function createTarget(extra = {}) {
  const listeners = new Map();
  const t = {
    listeners,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    count(type) { return listeners.get(type)?.size ?? 0; },
    fire(type, props = {}) {
      const ev = { type, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...props };
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
      return ev;
    },
    ...extra,
  };
  return t;
}

export function createFakeElement(tag = 'div') {
  const classes = new Set();
  const el = createTarget({
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    parentElement: null,
    dataset: {},
    hidden: false,
    textContent: '',
    type: '',
    attrs: {},
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : !!on; if (want) classes.add(c); else classes.delete(c); return want; },
      contains: (c) => classes.has(c),
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    remove() { const p = this.parentElement; if (p) p.children = p.children.filter((x) => x !== this); this.parentElement = null; this.removed = true; },
    click() { this.fire('click'); },
    querySelector(sel) {
      const cls = sel.replace(/^\./, '');
      const walk = (n) => { for (const c of n.children) { if (c.classList.contains(cls)) return c; const r = walk(c); if (r) return r; } return null; };
      return walk(this);
    },
  });
  // accessors must be defined on the object itself (createTarget spreads plain values)
  Object.defineProperty(el, 'className', {
    get: () => [...classes].join(' '),
    set: (v) => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
  });
  return el;
}

export function createFakeWindow({
  innerWidth = 1280, innerHeight = 720, navigator = {}, media = {}, location = { protocol: 'https:', hostname: 'example.org', search: '' },
  screen = {}, devicePixelRatio = 1, visualViewport = null,
} = {}) {
  const documentElement = createFakeElement('html');
  const body = createFakeElement('body');
  documentElement.appendChild(body);
  const document = createTarget({
    documentElement,
    body,
    visibilityState: 'visible',
    fullscreenElement: null,
    createElement: (tag) => createFakeElement(tag),
  });
  const timers = [];
  const win = createTarget({
    document,
    navigator: { userAgent: '', platform: '', maxTouchPoints: 0, ...navigator },
    location,
    innerWidth,
    innerHeight,
    devicePixelRatio,
    screen: { width: innerWidth, height: innerHeight, ...screen },
    visualViewport,
    matchMedia: (q) => ({ matches: !!media[q] }),
    getComputedStyle: (el) => el.computed ?? { overflowX: 'visible', overflowY: 'visible' },
    requestAnimationFrame: (fn) => { fn(); return 1; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    setInterval: (fn, ms) => { timers.push({ fn, ms, repeat: true }); return timers.length; },
    timers,
  });
  return win;
}
