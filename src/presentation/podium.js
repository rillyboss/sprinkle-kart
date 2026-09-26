/**
 * The 3D victory podium: the top three racers, as real 3D models, doing a
 * happy dance on the results screen right where their portraits were.
 * OWNER: showcase presentation (driven by src/systems/victoryPodium.js).
 *
 *   danceFor(charDef)                   -> 'twirl' | 'wobble' | 'jump' | 'boing' | 'sway'
 *   danceAt('twirl', t, { place })      -> { y, yaw, roll, pitch, squash, steer, boost }  (pure)
 *   screenToWorld(rect, view)           -> { x, y, scale }  map a DOM rect onto the stage (pure)
 *   const stage = buildPodiumStage({ charDefs, buildKartModel });  stage.update(dt, layout); stage.dispose();
 *
 * Dances follow each racer's personality (their voice style): gigglers twirl,
 * ho-ho-ers wobble, yay-ers jump for joy, boing-ers bounce like springs and
 * hummers sway. The winner dances biggest. Gentle motion = a calm sway.
 */
import * as THREE from 'three';
import { createConfetti } from './confetti.js';

export const DANCE_BY_STYLE = Object.freeze({ giggle: 'twirl', hoho: 'wobble', yay: 'jump', boing: 'boing', hum: 'sway' });
export const DANCES = Object.freeze(['twirl', 'wobble', 'jump', 'boing', 'sway']);

/** The dance a racer does (by voice style; unknown -> 'jump'). */
export function danceFor(charDef) {
  return DANCE_BY_STYLE[charDef?.voice?.style] ?? 'jump';
}

const TAU = Math.PI * 2;
const hop = (t, rate) => Math.abs(Math.sin(t * rate * Math.PI)); // 0..1 bounces, `rate` per second

/**
 * Pose offsets for a dance at time t (seconds).
 * y in model units (a kart is ~2.4 tall), angles in radians, squash ~1.
 * @param {string} dance
 * @param {number} t
 * @param {{ place?: number, gentle?: boolean }} [opts]
 */
export function danceAt(dance, t, { place = 1, gentle = false } = {}) {
  t = Number.isFinite(t) ? Math.max(0, t) : 0;
  const big = place === 1 ? 1 : place === 2 ? 0.8 : 0.65;
  const out = { y: 0, yaw: 0, roll: 0, pitch: 0, squash: 1, steer: 0, boost: false };
  if (gentle) {
    out.yaw = Math.sin(t * 1.2) * 0.12;
    out.roll = Math.sin(t * 1.2 + 1) * 0.04;
    out.steer = Math.sin(t * 1.2) * 0.4;
    return out;
  }
  switch (dance) {
    case 'twirl': {
      // two little hops, then a full happy twirl
      const cycle = 2.4;
      const c = t % cycle;
      out.y = hop(t, 2.5) * 0.35 * big;
      if (c > 1.4) {
        const k = (c - 1.4) / 1.0;
        out.yaw = (k < 1 ? (1 - Math.cos(Math.PI * k)) / 2 : 1) * TAU;
        out.y = Math.sin(Math.PI * Math.min(1, k)) * 0.8 * big;
      }
      out.steer = Math.sin(t * 5) * 0.6;
      break;
    }
    case 'wobble': {
      out.roll = Math.sin(t * 4.2) * 0.22 * big;
      out.yaw = Math.sin(t * 2.1) * 0.35;
      out.y = hop(t, 2.1) * 0.3 * big;
      out.steer = Math.sin(t * 4.2) * 1;
      break;
    }
    case 'jump': {
      const h = hop(t, 1.3);
      out.y = h * h * 1.1 * big;
      out.pitch = -h * 0.15;
      out.squash = 1 - (1 - h) * 0.12; // a little squish when landing
      out.boost = h > 0.6;
      out.steer = Math.sin(t * 7) * 0.3;
      break;
    }
    case 'boing': {
      const h = hop(t, 1.7);
      out.y = h * 0.9 * big;
      out.squash = 0.78 + h * 0.34; // springy squash and stretch
      out.roll = Math.sin(t * 1.7 * Math.PI) * 0.1;
      out.steer = Math.sin(t * 3.4) * 0.5;
      break;
    }
    case 'sway':
    default: {
      out.yaw = Math.sin(t * 1.6) * 0.3;
      out.roll = Math.sin(t * 1.6 + 0.8) * 0.12 * big;
      out.y = hop(t, 0.8) * 0.18 * big;
      out.steer = Math.sin(t * 1.6) * 0.8;
      break;
    }
  }
  return out;
}

/**
 * Map a DOM rect (CSS px) onto the z = 0 plane of a perspective camera at
 * (0, 0, dist) looking down -Z.
 * @param {{ left:number, top:number, width:number, height:number }} rect
 * @param {{ width:number, height:number, fov:number, dist:number, left?:number, top?:number }} view canvas size + camera
 * @param {number} [modelHeight] model units to fit in the rect height
 * @returns {{ x:number, y:number, scale:number, bottom:number }} centre-x, bottom-y and scale in world units
 */
export function screenToWorld(rect, view, modelHeight = 2.4) {
  const H = Math.max(1, view.height);
  const W = Math.max(1, view.width);
  const worldH = 2 * view.dist * Math.tan((view.fov * Math.PI) / 360);
  const s = worldH / H; // world units per CSS px
  const cx = rect.left - (view.left ?? 0) + rect.width / 2;
  const bottom = rect.top - (view.top ?? 0) + rect.height;
  return {
    x: (cx - W / 2) * s,
    y: -(cy(rect, view) - H / 2) * s,
    bottom: -(bottom - H / 2) * s,
    scale: (rect.height * s) / modelHeight,
  };
}
const cy = (rect, view) => rect.top - (view.top ?? 0) + rect.height / 2;

const BG_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const BG_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uCenter;
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec3 pink = vec3(1.0, 0.84, 0.925);
  vec3 lav = vec3(0.91, 0.84, 1.0);
  vec3 sky = vec3(0.82, 0.94, 1.0);
  float g = clamp(vUv.x * 0.25 + (1.0 - vUv.y) * 0.9, 0.0, 1.0);
  vec3 col = g < 0.55 ? mix(pink, lav, g / 0.55) : mix(lav, sky, (g - 0.55) / 0.45);
  vec2 d = vec2((vUv.x - uCenter.x) * uAspect, vUv.y - uCenter.y);
  float r = length(d);
  float a = atan(d.y, d.x);
  float rays = 0.5 + 0.5 * sin(a * 12.0 + uTime * 0.35);
  float glow = smoothstep(0.9, 0.0, r);
  col = mix(col, vec3(1.0, 0.97, 0.82), glow * (0.25 + 0.35 * rays) * 0.8);
  col = mix(col, vec3(1.0, 0.99, 0.9), smoothstep(0.35, 0.0, r) * 0.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Build the podium stage (a THREE.Scene with its own camera and lights).
 * @param {{ charDefs: object[], buildKartModel: (def:object)=>object, gentle?: boolean }} opts
 *   charDefs = [1st, 2nd, 3rd] (missing entries are skipped)
 */
export function buildPodiumStage({ charDefs = [], buildKartModel, gentle = false, fov = 30, dist = 40 } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 1, 200);
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(3, 8, 10);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffd6f0, 0.6);
  rim.position.set(-6, 3, -4);
  scene.add(rim);

  const bgMat = new THREE.ShaderMaterial({
    vertexShader: BG_VERT,
    fragmentShader: BG_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector2(0.25, 0.6) }, uAspect: { value: 16 / 9 } },
  });
  const bgGeo = new THREE.PlaneGeometry(2, 2);
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);

  const glowGeo = new THREE.CircleGeometry(1, 32);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false });

  const racers = [];
  charDefs.slice(0, 3).forEach((def, i) => {
    if (!def || typeof buildKartModel !== 'function') return;
    let model;
    try { model = buildKartModel(def); } catch (err) { console.warn('[podium] model', def?.id, err); return; }
    const holder = new THREE.Group(); // placed on the DOM rect
    const dancer = new THREE.Group(); // dance transforms
    holder.add(dancer);
    dancer.add(model.group);
    const disc = new THREE.Mesh(glowGeo, glowMat);
    disc.rotation.x = -Math.PI / 2 + 0.45; // tilted towards the camera so it reads as a soft spotlight
    disc.scale.set(1.15, 1.15, 1);
    disc.position.y = 0.02;
    holder.add(disc);
    holder.visible = false;
    scene.add(holder);
    racers.push({ place: i + 1, def, model, holder, dancer, dance: danceFor(def), phase: i * 0.37, baseYaw: i === 0 ? 0.25 : i === 1 ? 0.55 : -0.55 });
  });

  const confetti = createConfetti({ max: 360, seed: 'podium', size: 0.5, gravity: 3, life: 5 });
  scene.add(confetti.object);

  let time = 0;
  let disposed = false;
  let rainAt = 0;
  return {
    scene,
    camera,
    racers,
    confetti,
    get time() { return time; },
    /**
     * @param {number} dt
     * @param {{ width:number, height:number, left?:number, top?:number, rects: Array<null|{left,top,width,height}>, winnerRect?: object }} layout
     *   rects[i] = the DOM portrait rect of place i+1 (null = hide that racer)
     */
    update(dt, layout) {
      if (disposed) return;
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      time += dt;
      const W = Math.max(1, layout?.width || 1);
      const H = Math.max(1, layout?.height || 1);
      if (camera.aspect !== W / H) { camera.aspect = W / H; camera.updateProjectionMatrix(); }
      bgMat.uniforms.uTime.value = time;
      bgMat.uniforms.uAspect.value = W / H;
      const view = { width: W, height: H, left: layout?.left ?? 0, top: layout?.top ?? 0, fov: camera.fov, dist: camera.position.z };
      for (const r of racers) {
        const rect = layout?.rects?.[r.place - 1];
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) { r.holder.visible = false; continue; }
        const w = screenToWorld(rect, view);
        const scale = w.scale * (r.place === 1 ? 1.12 : 1.06);
        r.holder.visible = true;
        r.holder.position.set(w.x, w.bottom + 0.06 * scale, 0);
        r.holder.scale.setScalar(scale);
        const d = danceAt(r.dance, time + r.phase, { place: r.place, gentle });
        r.dancer.position.y = d.y;
        r.dancer.rotation.set(0.12 + d.pitch, r.baseYaw + d.yaw, d.roll);
        r.dancer.scale.set(1 / Math.sqrt(d.squash), d.squash, 1 / Math.sqrt(d.squash));
        r.model.update(dt, { happy: true, speed: 0, steer: d.steer, boosting: d.boost, time: time + r.phase });
      }
      if (layout?.winnerRect) {
        const wr = layout.winnerRect;
        bgMat.uniforms.uCenter.value.set((wr.left - view.left + wr.width / 2) / W, 1 - (wr.top - view.top + wr.height / 2) / H);
      }
      // gentle confetti rain over the winner now and then
      if (!gentle && racers[0]?.holder.visible && time >= rainAt) {
        rainAt = time + 1.6;
        const top = racers[0].holder.position;
        const s = racers[0].holder.scale.x;
        // pieces spread across the podium, drifting down one by one (never a clump)
        for (let i = 0; i < 26; i++) {
          const x = top.x + (Math.sin(time * 7.3 + i * 2.4) * 0.5 + (i / 25 - 0.5)) * 7 * s;
          const y = top.y + (3.4 + ((i * 0.618) % 1) * 1.8) * s;
          confetti.burst({ x, y, z: 1 + (i % 3) * 0.5 }, { count: 1, power: 0.12, spread: 1, up: 0.1 });
        }
      }
      confetti.update(dt);
    },
    render(renderer) {
      if (disposed || !renderer) return;
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const r of racers) { try { r.model.dispose(); } catch { /* ignore */ } }
      confetti.dispose();
      bgGeo.dispose();
      bgMat.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      scene.clear();
    },
  };
}
