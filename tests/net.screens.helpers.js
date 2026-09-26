/**
 * Shared bits for the online screen tests: a fake document (tests/helpers/fakeDom.js,
 * made forgiving of attribute selectors the real screens also use) and a fake menu ctx.
 */
import { vi } from 'vitest';
import { createFakeDocument, htmlOf } from './helpers/fakeDom.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { CHARACTERS } from '../src/characters/index.js';

export function installDoc() {
  const doc = createFakeDocument();
  const forgiving = (n) => {
    const q = n.querySelectorAll.bind(n);
    n.querySelectorAll = (s) => { try { return q(s); } catch { return []; } };
    n.querySelector = (s) => n.querySelectorAll(s)[0] ?? null;
    n.toggleAttribute = (k, on) => { if (on) n.setAttribute(k, ''); else n.removeAttribute(k); return !!on; };
    return n;
  };
  const ce = doc.createElement;
  doc.createElement = (t) => forgiving(ce(t));
  const dq = doc.querySelectorAll;
  doc.querySelectorAll = (s) => { try { return dq(s); } catch { return []; } };
  doc.querySelector = (s) => doc.querySelectorAll(s)[0] ?? null;
  const listeners = [];
  doc.addEventListener = (type, fn) => listeners.push({ type, fn });
  doc.removeEventListener = (type, fn) => { const i = listeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); };
  doc.fire = (type, e) => listeners.filter((l) => l.type === type).forEach((l) => l.fn({ preventDefault() {}, ...e }));
  doc.listenerCount = () => listeners.length;
  vi.stubGlobal('document', doc);
  return doc;
}

/** Every piece of text / markup under a node (text nodes, textContent and innerHTML strings). */
export function allText(node) {
  if (!node) return '';
  return `${node.textContent ?? ''} ${htmlOf(node)}`;
}

/** A minimal Menus-like ctx for mounting one screen. */
export function fakeCtx({ settings = {}, net = null, online = null } = {}) {
  let saved = { music: 0.7, sfx: 0.85, kidAssistDefault: false, onlineEnabled: false, approvalGate: false, relayOnly: false, ...settings };
  const ctx = {
    screens: SCREENS,
    characters: CHARACTERS,
    portraits: new Map(),
    draft: { skip: new Set(), joinState: { players: [] } },
    time: 0,
    net,
    online,
    progress: {
      getSettings: () => ({ ...saved }),
      setSettings: (p) => { saved = { ...saved, ...p }; return { ...saved }; },
      loadProgress: () => ({ unlockAll: false, wins: 0 }),
      isUnlocked: () => true,
    },
    sfx: vi.fn(),
    fx: vi.fn(),
    char: (id) => CHARACTERS.find((c) => c.id === id) ?? null,
    isLocked: () => false,
    setCooldown: vi.fn(),
    devices: () => [],
  };
  return ctx;
}

export function fakeNav() {
  return { next: vi.fn(), back: vi.fn(), goto: vi.fn(), finish: vi.fn(), resolve: vi.fn() };
}

export const ev = (action, extra = {}) => ({ deviceId: 'pad0', action, ...extra });
