/**
 * "Turn your device sideways" overlay for phones held upright (mobile platform). OWNER: mobile platform;
 * the phase-2 responsive UI engineer may restyle it freely (markup + class names below are the contract).
 *
 *   rotateOverlayState({ phone, width, height, dismissed, locked })  PURE → { visible, reason }
 *   const ov = createRotateOverlay({ doc, onDismiss });  ov.set(visible);  ov.destroy();
 *
 * Rules: only phones (tablets play fine upright), only in portrait, not after the family tapped
 * "Play anyway" (for this page load), not when the orientation is already locked to landscape.
 *
 * Markup (styles in src/platform/platform.css, all prefixed .sk-rotate):
 *   <div class="sk-rotate" role="dialog" aria-live="polite" hidden>
 *     <div class="sk-rotate-card">
 *       <div class="sk-rotate-phone" aria-hidden="true">📱</div>
 *       <div class="sk-rotate-title">Turn me sideways!</div>
 *       <div class="sk-rotate-text">Sprinkle Kart plays best with your phone on its side.</div>
 *       <button class="sk-rotate-skip" type="button">Play anyway</button>
 *     </div>
 *   </div>
 */

export const ROTATE_TEXT = Object.freeze({
  title: 'Turn me sideways!',
  text: 'Sprinkle Kart plays best with your phone on its side.',
  skip: 'Play anyway',
});

/**
 * @param {{ phone?: boolean, width?: number, height?: number, dismissed?: boolean, locked?: boolean }} s
 * @returns {{ visible: boolean, reason: string }}
 */
export function rotateOverlayState({ phone = false, width = 0, height = 0, dismissed = false, locked = false } = {}) {
  if (!phone) return { visible: false, reason: 'not-phone' };
  if (locked) return { visible: false, reason: 'locked' };
  if (!(Number(height) > Number(width))) return { visible: false, reason: 'landscape' };
  if (dismissed) return { visible: false, reason: 'dismissed' };
  return { visible: true, reason: 'portrait' };
}

/**
 * The overlay element (appended to <body>). Safe without a document (returns a no-op handle).
 * @param {{ doc?: any, onDismiss?: () => void, text?: typeof ROTATE_TEXT }} [opts]
 */
export function createRotateOverlay({ doc = typeof document !== 'undefined' ? document : null, onDismiss, text = ROTATE_TEXT } = {}) {
  if (!doc?.createElement || !doc.body) return { node: null, visible: false, set() {}, destroy() {} };
  const node = doc.createElement('div');
  node.className = 'sk-rotate';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-live', 'polite');
  node.hidden = true;
  const card = doc.createElement('div');
  card.className = 'sk-rotate-card';
  const add = (cls, content, tag = 'div') => {
    const e = doc.createElement(tag);
    e.className = cls;
    e.textContent = content;
    card.appendChild(e);
    return e;
  };
  add('sk-rotate-phone', '📱').setAttribute('aria-hidden', 'true');
  add('sk-rotate-title', text.title);
  add('sk-rotate-text', text.text);
  const skip = add('sk-rotate-skip', text.skip, 'button');
  skip.type = 'button';
  const dismiss = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); try { onDismiss?.(); } catch { /* ignore */ } };
  skip.addEventListener('click', dismiss);
  node.appendChild(card);
  doc.body.appendChild(node);
  const handle = {
    node,
    visible: false,
    set(visible) {
      handle.visible = !!visible;
      node.hidden = !visible;
      node.classList.toggle('sk-rotate-on', !!visible);
    },
    destroy() { skip.removeEventListener('click', dismiss); node.remove(); },
  };
  return handle;
}
