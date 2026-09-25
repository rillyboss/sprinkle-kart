/**
 * Auto-repeat for held menu directions: fires once on press, then after `delay` ms,
 * then every `interval` ms while still held. At most one fire per update (no bursts
 * after a slow frame).
 */
export const MENU_REPEAT_DELAY = 350;
export const MENU_REPEAT_INTERVAL = 120;

export class RepeatTimer {
  constructor({ delay = MENU_REPEAT_DELAY, interval = MENU_REPEAT_INTERVAL } = {}) {
    this.delay = delay;
    this.interval = interval;
    this.active = false;
    this.nextAt = 0;
  }

  /**
   * @param {boolean} held direction currently held
   * @param {number} now ms timestamp
   * @param {boolean} [tapped] pressed since last update (catches taps shorter than a frame
   *                           and quick re-presses)
   * @returns {boolean} true if a menu move should fire this update
   */
  update(held, now, tapped = false) {
    if (tapped || (held && !this.active)) {
      this.active = held;
      this.nextAt = now + this.delay;
      return true;
    }
    if (!held) {
      this.active = false;
      return false;
    }
    if (now >= this.nextAt) {
      this.nextAt = now + this.interval;
      return true;
    }
    return false;
  }

  reset() {
    this.active = false;
  }
}
