/**
 * Which device a mouse / touch CLICK on a menu acts as.
 *
 * Menus wire clicks to the keyboard players ('kb1' / 'kb2') so a mouse can play. A TAP on
 * a phone or tablet should instead join / drive the touch device (so the touch player gets
 * the on-screen race controls). InputManager remembers the last pointer type; this asks it
 * for a free touch device and falls back to the old keyboard choice for mouse clicks.
 *
 *   const dev = clickDevice(ctx.input, takenIds, 'kb1');
 *
 * A TAP while every touch seat is already taken returns null (the caller ignores it)
 * instead of quietly adding a keyboard player nobody on a phone can use.
 */
export function clickDevice(input, taken = [], fallback = null) {
  let id = null;
  try { id = input?.pointerDevice?.(taken) ?? null; } catch { id = null; }
  if (id) return id;
  if (input?.lastPointerType === 'touch') {
    let devices = [];
    try { devices = input.getDevices?.() ?? []; } catch { devices = []; }
    if (devices.some((d) => d.type === 'touch' && d.connected)) return null;
  }
  return fallback;
}
