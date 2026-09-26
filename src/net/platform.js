/**
 * Platform checks for online play (NETWORKING.md §13.5). Pure and DOM-free:
 * the caller passes what the browser reports.
 *
 * iPadOS Safari reports a desktop Mac user agent ("Macintosh … Safari") by
 * default, so a user-agent test alone would let iPads host. The rule is
 *   isAppleMobile = /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
 * (real Macs report maxTouchPoints = 0). iOS / iPadOS suspends WebRTC when the
 * screen locks or the tab goes to the background, so those devices may join
 * a room but never host one.
 *
 * OWNER: WS6 (session, lobby & screens).
 */

/** Friendly text when an iPad / iPhone tries to host (§13.5). */
export const HOST_NEEDS_COMPUTER_TEXT = 'Hosting needs a computer 💻 — you can still join!';

/**
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }} [nav]
 * @returns {boolean} true for iPhone / iPod / iPad (incl. iPadOS in desktop mode)
 */
export function isAppleMobile({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent ?? '');
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return platform === 'MacIntel' && Number(maxTouchPoints) > 1;
}

/**
 * May this device host a room?
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }} [nav]
 */
export function canHost(nav = {}) {
  return !isAppleMobile(nav);
}

/** What this browser reports (safe in node: empty values). */
export function currentPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return { userAgent: '', platform: '', maxTouchPoints: 0 };
  return {
    userAgent: String(nav.userAgent ?? ''),
    platform: String(nav.platform ?? ''),
    maxTouchPoints: Number(nav.maxTouchPoints ?? 0) || 0,
  };
}
