/**
 * A tiny fake DOM, just enough to mount overlay helpers in node tests
 * (createElement, classList, style.setProperty, innerHTML as a string,
 * appendChild / remove, addEventListener). NOT a real HTML parser:
 * `innerHTML` is stored as text and `querySelector` only finds appended
 * element children by class.
 *
 *   const dom = installFakeDom();   // vi.stubGlobal('document', ...)
 *   const host = document.createElement('div');
 */
import { vi } from 'vitest';

export function fakeElement(tag = 'div') {
  const classes = new Set();
  const props = new Map();
  const listeners = {};
  const node = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    innerHTML: '',
    textContent: '',
    attributes: {},
    dataset: {},
    style: { setProperty: (k, v) => props.set(k, v), getPropertyValue: (k) => props.get(k) ?? '' },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : !!on; if (want) classes.add(c); else classes.delete(c); return want; },
    },
    setAttribute: (k, v) => { node.attributes[k] = String(v); },
    getAttribute: (k) => node.attributes[k] ?? null,
    addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    removeEventListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    dispatch: (ev, e = {}) => (listeners[ev] || []).forEach((fn) => fn({ stopPropagation() {}, ...e })),
    appendChild: (c) => { c.parentNode?.removeChild?.(c); node.children.push(c); c.parentNode = node; return c; },
    insertBefore: (c, ref) => { const i = node.children.indexOf(ref); node.children.splice(i < 0 ? node.children.length : i, 0, c); c.parentNode = node; return c; },
    removeChild: (c) => { node.children = node.children.filter((x) => x !== c); c.parentNode = null; return c; },
    remove: () => node.parentNode?.removeChild(node),
    get offsetWidth() { return 0; },
    get childElementCount() { return node.children.length; },
    get firstElementChild() { return node.children[0] ?? null; },
    querySelector: (sel) => node.querySelectorAll(sel)[0] ?? null,
    querySelectorAll: (sel) => {
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (cls && c.classList.contains(cls)) out.push(c); walk(c); } };
      walk(node);
      return out;
    },
  };
  return node;
}

export function installFakeDom() {
  const body = fakeElement('body');
  const doc = { createElement: (t) => fakeElement(t), createTextNode: (t) => ({ textContent: t, nodeType: 3 }), body };
  vi.stubGlobal('document', doc);
  return doc;
}
