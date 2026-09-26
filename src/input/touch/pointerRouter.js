/**
 * TouchPointerRouter — turns raw multi-touch pointers into TouchDevice presses using a
 * touch layout (pure, no DOM; the overlay in src/ui/touch/ forwards events and draws
 * router.view()).
 *
 *   const router = new TouchPointerRouter();
 *   router.setLayout(layout, [{ deviceId: 'touch1', device }]);
 *   router.down(pointerId, x, y, t); router.move(pointerId, x, y); router.up(pointerId);
 *
 * Every pointer belongs to ONE player set (the zone it landed in) and ONE control for its
 * whole life, so two thumbs (or two kids) never steal each other's presses.
 *   - held buttons (gas, brake, drift, ◀, ▶) press on down, release on up;
 *     a thumb sliding from ◀ to ▶ switches direction;
 *   - item / pause are taps (fire on down, like a pad button);
 *   - joystick style: a press anywhere in the steer zone starts a floating stick there;
 *   - buttons style: a press in the steer zone that misses the buttons picks the nearer
 *     of ◀ / ▶ (forgiving for small hands);
 *   - recenter (tilt style) calls onRecenter().
 */
import { FloatingStick } from './joystick.js';
import { hitControl, inSteerZone, zoneAt } from './touchLayout.js';

const HELD = new Set(['gas', 'brake', 'drift', 'left', 'right']);
const TAP = new Set(['item', 'pause']);

export class TouchPointerRouter {
  constructor({ onRecenter = null, onPress = null } = {}) {
    this.onRecenter = onRecenter;
    this.onPress = onPress;
    this.layout = null;
    this.sets = [];
    this.owners = new Map();
  }

  /**
   * @param {object} layout computeTouchLayout() result
   * @param {{deviceId:string, device:import('./TouchDevice.js').TouchDevice}[]} players one per layout set
   */
  setLayout(layout, players = []) {
    this.cancelAll();
    this.layout = layout;
    this.sets = (layout?.players ?? []).map((set, i) => {
      const p = players[i] ?? null;
      const stick = set.stick ? new FloatingStick({ radius: set.stick.r }) : null;
      return { set, deviceId: p?.deviceId ?? null, device: p?.device ?? null, stick, pressed: new Map() };
    });
  }

  _pressCount(s, id) {
    return s.pressed.get(id) ?? 0;
  }

  _hold(s, id, t) {
    s.pressed.set(id, this._pressCount(s, id) + 1);
    s.device?.press(id, t);
  }

  _unhold(s, id) {
    const n = this._pressCount(s, id) - 1;
    if (n > 0) { s.pressed.set(id, n); return; }
    s.pressed.delete(id);
    s.device?.release(id);
  }

  /** @returns {string|null} what the pointer grabbed ('item', 'stick', ...) */
  down(pointerId, x, y, t) {
    if (this.owners.has(pointerId)) this.up(pointerId);
    const si = zoneAt(this.layout, x, y);
    if (si < 0) return null;
    const s = this.sets[si];
    if (!s?.device) return null;
    const c = hitControl(s.set, x, y);
    if (c) return this._grab(pointerId, si, c.id, t);
    if (!inSteerZone(s.set, x, y)) return null;
    const style = s.device.settings.style;
    if (style === 'joystick' && s.stick && s.stick.start(pointerId, x, y)) {
      this.owners.set(pointerId, { si, id: 'stick' });
      s.device.setStickSteer(0);
      s.device._touch?.(t);
      return 'stick';
    }
    if (style === 'buttons') {
      const l = s.set.controls.find((q) => q.id === 'left');
      const r = s.set.controls.find((q) => q.id === 'right');
      if (l && r) return this._grab(pointerId, si, x < (l.cx + r.cx) / 2 ? 'left' : 'right', t);
    }
    return null;
  }

  _grab(pointerId, si, id, t) {
    const s = this.sets[si];
    if (TAP.has(id)) {
      s.device.tap(id, t);
      s.device.rumble?.(0.3, 25);
      this.owners.set(pointerId, { si, id, tap: true });
      s.pressed.set(id, this._pressCount(s, id) + 1);
    } else if (HELD.has(id)) {
      this._hold(s, id, t);
      this.owners.set(pointerId, { si, id });
    } else if (id === 'recenter') {
      this.owners.set(pointerId, { si, id, tap: true });
      s.pressed.set(id, this._pressCount(s, id) + 1);
      try { this.onRecenter?.(s.deviceId); } catch (err) { console.error(err); }
    } else {
      return null;
    }
    try { this.onPress?.(s.deviceId, id); } catch { /* optional */ }
    return id;
  }

  move(pointerId, x, y) {
    const o = this.owners.get(pointerId);
    if (!o) return;
    const s = this.sets[o.si];
    if (o.id === 'stick') {
      s.stick.move(pointerId, x, y);
      s.device.setStickSteer(s.stick.steer());
      return;
    }
    if (o.id === 'left' || o.id === 'right') {
      // slide between ◀ and ▶ (anywhere in the steer zone counts)
      const l = s.set.controls.find((q) => q.id === 'left');
      const r = s.set.controls.find((q) => q.id === 'right');
      if (!l || !r) return;
      const want = x < (l.cx + r.cx) / 2 ? 'left' : 'right';
      if (want !== o.id) {
        this._unhold(s, o.id);
        this._hold(s, want);
        o.id = want;
      }
    }
  }

  up(pointerId) {
    const o = this.owners.get(pointerId);
    if (!o) return;
    this.owners.delete(pointerId);
    const s = this.sets[o.si];
    if (o.id === 'stick') {
      s.stick.end(pointerId);
      s.device.setStickSteer(0);
    } else if (o.tap) {
      const n = this._pressCount(s, o.id) - 1;
      if (n > 0) s.pressed.set(o.id, n); else s.pressed.delete(o.id);
    } else {
      this._unhold(s, o.id);
    }
  }

  cancelAll() {
    for (const id of [...this.owners.keys()]) this.up(id);
    for (const s of this.sets) {
      s.pressed.clear();
      s.stick?.reset();
      s.device?.releaseAll();
    }
  }

  /** What the overlay draws: per set, pressed control ids and the stick. */
  view() {
    return this.sets.map((s) => ({
      deviceId: s.deviceId,
      pressed: new Set(s.pressed.keys()),
      stick: s.stick && s.stick.active
        ? { active: true, origin: { ...s.stick.origin }, thumb: { ...s.stick.thumb }, steer: s.stick.steer() }
        : { active: false },
    }));
  }
}
