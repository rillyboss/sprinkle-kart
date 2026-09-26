/**
 * Photo Mode: "📸 Photo mode" in the pause menu. OWNER: showcase presentation.
 *
 * The pause menu gets one more option (the system decorates
 * `menus.showPause` so no shared file changes: whatever options the caller
 * passes, Photo mode is appended, and the promise still resolves with the
 * caller's own choices — picking Photo mode opens the photo overlay and then
 * returns to the pause menu). While it is open:
 *   - the paused race is drawn full-screen from a free camera orbiting the
 *     paused player's kart (src/presentation/photo.js), the HUD is hidden and
 *     every racer smiles for the camera;
 *   - A snaps: the frame is composed on a 2D canvas (3D view + frame +
 *     sticker) and saved as a PNG download; game.lastPhoto records it.
 * Needs app.renderer; without it the option is simply not added.
 */
import * as THREE from 'three';
import '../presentation/presentation.css';
import { PAUSE_OPTIONS } from '../ui/screens/pause.js';
import { photoCameraPose, photoFileName, captionDate, drawPhotoFrame, createPhotoState } from '../presentation/photo.js';
import { hideOccluders, restoreKarts } from '../render/occlusion.js';

export const PHOTO_OPTION = Object.freeze(['photo', 'Photo mode', '📸']);
export const PHOTO_CLASS = 'skx-photo-on';

/** Pause options with Photo mode added once (before "Back to menu" if there is one). */
export function withPhotoOption(options = PAUSE_OPTIONS) {
  const list = Array.isArray(options) ? options.filter((o) => Array.isArray(o) && o[0] !== PHOTO_OPTION[0]) : [...PAUSE_OPTIONS];
  const quitAt = list.findIndex((o) => o[0] === 'quit');
  if (quitAt >= 0) list.splice(quitAt, 0, [...PHOTO_OPTION]);
  else list.push([...PHOTO_OPTION]);
  return list;
}

/** Which player paused ("P2" -> 1), else the first human. */
export function pausingPlayer(label, humans = []) {
  const m = /^P(\d)\b/.exec(String(label ?? ''));
  const pi = m ? Number(m[1]) - 1 : null;
  if (pi !== null && humans.some((h) => h.playerIndex === pi)) return pi;
  return humans[0]?.playerIndex ?? 0;
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'photo-mode',
  order: 96,
  install(bus, app) {
    const menus = app.menus;
    if (!menus || typeof menus.showPause !== 'function') return undefined;
    const original = menus.showPause;
    let active = null; // { session, playerIndex, ctl, camera }
    const look = new THREE.Vector3();
    const size = new THREE.Vector2();
    const hidden = [];
    const body = () => (typeof document !== 'undefined' ? document.body : null);

    const available = () => !!app.renderer && !!app.game?.session?.scene;

    async function openPhoto(label) {
      const session = app.game?.session;
      if (!session?.scene) return;
      const playerIndex = pausingPlayer(label, session.humans);
      const kart = session.race?.getPlayerKart?.(playerIndex);
      const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.15, 1600);
      const ctl = {
        state: createPhotoState(),
        info: { title: session.trackDef?.name ?? 'Sprinkle Kart', emoji: kart?.charDef?.emoji ?? '🏎️', date: captionDate(new Date()) },
        pendingSnap: false,
        snap() { ctl.pendingSnap = true; },
        onSaved: null,
      };
      active = { session, playerIndex, ctl, camera };
      body()?.classList.add(PHOTO_CLASS);
      try {
        await menus.open('photo-mode', { ctl });
      } finally {
        active = null;
        body()?.classList.remove(PHOTO_CLASS);
      }
    }

    menus.showPause = function showPauseWithPhoto(label = '', extra = {}) {
      // online the race never stops for a photo (a guest's pause is local; the host's freezes everyone)
      if (!available() || extra?.noPhoto || app.game?.session?.net) return original.call(this, label, extra);
      const self = this;
      return (async () => {
        for (;;) {
          const choice = await original.call(self, label, { ...extra, options: withPhotoOption(extra.options) });
          if (choice !== PHOTO_OPTION[0]) return choice;
          try { await openPhoto(label); } catch (err) { console.warn('[photo] could not open', err); }
        }
      })();
    };

    function snap(renderer, s) {
      const canvas = renderer.domElement;
      if (typeof document === 'undefined' || !canvas?.width) return null;
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const g = out.getContext('2d');
      if (!g) return null;
      g.drawImage(canvas, 0, 0);
      drawPhotoFrame(g, out.width, out.height, active.ctl.state.frame, active.ctl.info);
      const name = photoFileName(s.trackDef?.id, new Date());
      const url = out.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (app.game) app.game.lastPhoto = { name, width: out.width, height: out.height, bytes: url.length, frame: active.ctl.state.frame };
      return name;
    }

    const off = bus.on('frame', (dt) => {
      const renderer = app.renderer;
      if (!active || !renderer) return;
      const s = active.session;
      const kart = s.race?.getPlayerKart?.(active.playerIndex) ?? s.race?.karts?.[0];
      if (!kart) return;
      // everyone smiles for the photo (the race is paused, so nothing else drives the models)
      for (const k of s.race.karts) { try { k.model?.update?.(dt, { happy: true, speed: 0, steer: 0, time: s.race.clock }); } catch { /* ignore */ } }
      const pose = photoCameraPose(kart.position, kart.heading, active.ctl.state);
      const cam = active.camera;
      cam.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
      look.set(pose.look.x, pose.look.y, pose.look.z);
      cam.lookAt(look);
      renderer.getSize(size);
      const aspect = size.x / Math.max(1, size.y);
      if (Math.abs(cam.aspect - aspect) > 1e-4) { cam.aspect = aspect; cam.updateProjectionMatrix(); }
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
      hidden.push(...hideOccluders(s.race.karts, kart, cam));
      try { renderer.render(s.scene, cam); } finally { restoreKarts(hidden); }
      if (active.ctl.pendingSnap) {
        active.ctl.pendingSnap = false;
        let name = null;
        try { name = snap(renderer, s); } catch (err) { console.warn('[photo] could not save', err); }
        try { app.audio?.sfx?.('skx-photo'); } catch { /* ignore */ }
        try { active.ctl.onSaved?.(name); } catch { /* ignore */ }
      }
    });
    if (app.game) app.game.photoMode = () => (active ? { playerIndex: active.playerIndex, state: { ...active.ctl.state } } : null);

    return () => {
      off();
      menus.showPause = original;
      body()?.classList.remove(PHOTO_CLASS);
      active = null;
    };
  },
};
