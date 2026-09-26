/**
 * Title-screen show ("attract mode"): while the title screen is up, a real
 * 8-CPU race runs on one of the family's unlocked tracks behind the logo, and
 * a little TV director (src/presentation/attract.js) cuts between shots — the
 * pack racing at the camera, a slow orbit of a "starring" racer (with a name
 * caption), a trackside camera, a helicopter view and a low chase cam.
 * OWNER: showcase presentation.
 *
 *  - built lazily a moment after the title appears, kept while any menu screen
 *    is open (so Back to the title is instant), torn down as soon as a race
 *    starts or the "Title show" pref is switched off; the next build uses the
 *    next unlocked track;
 *  - needs app.renderer (main.js passes it); `?attract=0` switches it off (tests);
 *  - body class `skx-attract-on` lets the title's candy background turn
 *    see-through while the show is drawing.
 */
import * as THREE from 'three';
import '../presentation/presentation.css';
import { prefs as sharedPrefs, effectivePrefs } from '../presentation/prefs.js';
import { createDirector, shotPose, pickAttractTrack, starCaption, framingOffset, SHOT_FRAMING, avoidProps } from '../presentation/attract.js';
import { TRACKS } from '../tracks/index.js';
import { CHARACTERS } from '../characters/index.js';
import { isAvailable } from '../progress/access.js';
import { TrackPath } from '../track/TrackPath.js';
import { buildTrack } from '../tracks/core.js';
import { buildKartModel } from '../characters/model.js';
import { paintedBuilder } from '../modes/paint.js';
import { Race } from '../race/Race.js';
import { hideOccluders, restoreKarts } from '../render/occlusion.js';

export const ATTRACT_CLASS = 'skx-attract-on';
/** Seconds on the title before the show is built (lets the screen settle first). */
export const ATTRACT_DELAY = 0.35;

/** Is the show switched off by the URL (`?attract=0`)? */
export function attractDisabledByUrl(search = typeof location !== 'undefined' ? location.search : '') {
  try { return new URLSearchParams(search).get('attract') === '0'; } catch { return false; }
}

/** Up to `n` CPU racers from the unlocked roster, deterministic for a seed. */
export function pickAttractRacers(characters, isUnlocked, n = 8, seed = 1) {
  const pool = characters.filter((c) => isAvailable(c, isUnlocked));
  let a = (seed >>> 0) || 1;
  const rand = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  const list = [...pool];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, Math.min(n, list.length));
}

/**
 * Build the show: scene, track, race (countdown skipped, pack already rolling).
 * @returns {{ scene, camera, race, built, path, trackDef, director, dispose(), update(dt), render(renderer, w, h) }}
 */
export function buildAttractShow({ trackDef, racers, seed = 1, preroll = 3.5, deps = {} }) {
  const { buildTrackFn = buildTrack, buildKartModelFn = paintedBuilder(buildKartModel) } = deps;
  const theme = trackDef.theme || {};
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.skyBottom ?? 0xffd6ec);
  if (theme.fogColor !== undefined) scene.fog = new THREE.Fog(theme.fogColor, theme.fogNear ?? 120, theme.fogFar ?? 700);
  const path = new TrackPath(trackDef.controlPoints, trackDef.width);
  const built = buildTrackFn(trackDef, path);
  if (built?.group) scene.add(built.group);
  const participants = racers.map((c) => ({ characterId: c.id, playerIndex: null, easyDrive: false }));
  const race = new Race({
    scene, trackDef, path, builtTrack: built?.itemBoxSlots ? built : null, participants, speedClass: 'zippy',
    buildKartModel: buildKartModelFn, laps: 99, seed,
  });
  // skip the countdown and let the pack get going
  for (let i = 0; i < 40 && race.state === 'countdown'; i++) race.update(0.1, []);
  for (let tt = 0; tt < preroll; tt += 1 / 20) race.update(1 / 20, []);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 1600);
  const director = createDirector({ seed, racers: race.karts.length });
  const b = path.getBounds();
  const center = { x: (b.minX + b.maxX) / 2, y: 0, z: (b.minZ + b.maxZ) / 2 };
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 120);
  let trackside = null;
  const look = new THREE.Vector3();
  const hidden = [];
  let disposed = false;

  const show = {
    scene, camera, race, built, path, trackDef, director,
    pose: null,
    get disposed() { return disposed; },
    /** The kart the current shot is about. */
    focusKart() {
      const s = director.shot;
      if (s.kind === 'star-orbit') return race.karts[s.starIndex % race.karts.length] ?? null;
      return race.getStandings()[0] ?? null;
    },
    update(dt) {
      if (disposed) return director.shot;
      dt = Math.min(Math.max(dt || 0, 0), 0.1);
      race.update(dt, []);
      try { built?.update?.(dt, race.clock); } catch { /* scenery animation is optional */ }
      const shot = director.update(dt);
      const leader = race.getStandings()[0];
      if (shot.cut || !trackside) {
        // a fresh trackside spot a little ahead of the leader, just off the road
        const s = (leader?.s ?? 0) + 34;
        const side = shot.index % 2 ? 1 : -1;
        const p = path.positionAt(path.wrap(s), side * (path.halfWidth + 3.5));
        trackside = { pos: { x: p.x, y: p.y + 2.4, z: p.z } };
      }
      const star = race.karts[shot.starIndex % race.karts.length];
      const boxes = race.itemBoxes?.boxes?.filter((bx) => bx.active).map((bx) => bx.mesh.position) ?? [];
      const raw = shotPose(shot, { leader, star, center, extent, trackside });
      const pose = shot.kind === 'heli' ? raw : avoidProps(raw, boxes); // never a wall of "?" boxes in the lens
      camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
      look.set(pose.look.x, pose.look.y, pose.look.z);
      camera.lookAt(look);
      show.pose = pose;
      return shot;
    },
    render(renderer, w, h) {
      if (disposed || !renderer) return;
      // frame the subject beside / below the logo (setViewOffset), same apparent size
      const shot = director.shot;
      const fr = framingOffset(w, h, SHOT_FRAMING[shot.kind], show.pose?.fov ?? 50);
      camera.aspect = fr.fullWidth / fr.fullHeight;
      camera.fov = fr.fov;
      camera.setViewOffset(fr.fullWidth, fr.fullHeight, fr.x, fr.y, fr.width, fr.height);
      const focus = show.focusKart();
      if (focus) hidden.push(...hideOccluders(race.karts, focus, camera));
      try { renderer.render(scene, camera); } finally { restoreKarts(hidden); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { race.dispose(); } catch (err) { console.warn('[attract] race dispose', err); }
      try { built?.dispose?.(); } catch (err) { console.warn('[attract] track dispose', err); }
      scene.clear();
    },
  };
  return show;
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'title-attract',
  order: 95,
  install(bus, app) {
    const store = app.prefs ?? sharedPrefs;
    const urlOff = attractDisabledByUrl();
    let show = null;
    let titleTime = 0;
    let visit = 0;
    let failed = false;
    const start = Math.floor(Math.random() * 1000);
    let caption = null;
    let captionFor = null;
    const size = new THREE.Vector2();
    const body = () => (typeof document !== 'undefined' ? document.body : null);

    const setOn = (on) => body()?.classList.toggle(ATTRACT_CLASS, !!on);
    const clearCaption = () => { caption?.remove(); caption = null; captionFor = null; };
    const teardown = () => {
      setOn(false);
      clearCaption();
      if (!show) return;
      try { show.dispose(); } catch { /* ignore */ }
      show = null;
    };
    const enabled = () => !urlOff && !failed && effectivePrefs(store.get()).attract;

    const build = () => {
      const isUnlocked = (id) => { try { return !!app.progress?.isUnlocked?.(id); } catch { return false; } };
      const tracks = (app.attractTracks ?? TRACKS).filter((t) => isAvailable(t, isUnlocked));
      const trackDef = pickAttractTrack(tracks, visit++, start);
      const racers = pickAttractRacers(app.attractCharacters ?? CHARACTERS, isUnlocked, 8, start + visit);
      if (!trackDef || racers.length < 2) return null;
      return buildAttractShow({ trackDef, racers, seed: start + visit, deps: app.attractDeps });
    };

    const updateCaption = (shot) => {
      const menusEl = app.menus?.el;
      if (!menusEl || typeof document === 'undefined') return;
      const kart = shot.kind === 'star-orbit' ? show.race.karts[shot.starIndex % show.race.karts.length] : null;
      const def = kart?.charDef ?? null;
      if (!def || shot.t < 0.4 || shot.t > shot.length - 0.3) { if (caption) { caption.classList.add('skx-out'); if (shot.t > shot.length - 0.05 || !def) clearCaption(); } return; }
      if (captionFor === def.id && caption?.isConnected) return;
      clearCaption();
      const c = starCaption(def);
      caption = document.createElement('div');
      caption.className = 'skx-attract-caption';
      const t1 = document.createElement('b');
      t1.textContent = c.title;
      const t2 = document.createElement('span');
      t2.textContent = c.sub;
      caption.append(t1, t2);
      menusEl.appendChild(caption);
      captionFor = def.id;
    };

    if (app.game) {
      app.game.attract = () => (show ? {
        trackId: show.trackDef.id, shot: show.director.shot.kind, racers: show.race.karts.length,
        time: show.race.time, drawing: !!body()?.classList.contains(ATTRACT_CLASS),
      } : null);
    }

    const offs = [
      bus.on('frame', (dt, game) => {
        const renderer = app.renderer;
        if (!renderer || game?.state !== 'menu' || !enabled()) { teardown(); titleTime = 0; return; }
        const onTitle = app.menus?.screenId === 'title';
        if (!onTitle) { setOn(false); clearCaption(); titleTime = 0; return; }
        titleTime += Math.min(dt || 0, 0.1);
        if (!show) {
          if (titleTime < ATTRACT_DELAY) return;
          try { show = build(); } catch (err) {
            console.warn('[attract] title show could not be built; switching it off', err);
            failed = true;
            show = null;
          }
          if (!show) return;
        }
        const shot = show.update(dt);
        const canvas = renderer.domElement;
        renderer.getSize(size);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.x, size.y);
        show.render(renderer, canvas?.clientWidth || size.x, canvas?.clientHeight || size.y);
        setOn(true);
        updateCaption(shot);
      }),
      bus.on('race-start', () => teardown()),
      store.subscribe(() => { if (!enabled()) teardown(); }),
    ];
    return () => { offs.forEach((off) => off()); teardown(); };
  },
};
