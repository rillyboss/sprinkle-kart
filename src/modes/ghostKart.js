/**
 * The Time Trial ghost in 3D: a translucent, dreamy-lavender copy of the
 * racer's kart (buildKartModel) with a little trail of twinkly sparkles. It
 * replays a decoded ghost (./ghost.js) against the race clock and fades out
 * when it is right next to the player's kart so it never blocks the view.
 *
 * OWNER: modes + timing workstream.
 */
import * as THREE from 'three';
import { ghostPoseAt } from './ghost.js';

const GHOST_TINT = new THREE.Color(0xd8c8ff);
export const GHOST_OPACITY = 0.52;
const SPARKLES = 10;

/** Opacity of the ghost for a distance (m) to the player's kart: fades out up close. */
export function ghostFade(dist, base = GHOST_OPACITY) {
  if (!Number.isFinite(dist)) return base;
  const k = Math.max(0, Math.min(1, (dist - 1.5) / 3.5));
  return base * (0.3 + 0.7 * k * k * (3 - 2 * k));
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.decoded decodeGhost() result
 * @param {object} o.charDef the ghost's racer
 * @param {(def)=>object} o.buildKartModel
 */
export function createGhostKart({ scene, decoded, charDef, buildKartModel }) {
  const model = buildKartModel(charDef || { id: decoded?.meta?.characterId ?? 'ghost', colors: {}, stats: {} });
  const group = model.group;
  group.rotation.order = 'YXZ';
  group.name = 'time-trial-ghost';
  const clones = [];
  const ghostMat = (m) => {
    const c = m.clone();
    if (c.color) c.color.lerp(GHOST_TINT, 0.55);
    if (c.emissive) { c.emissive.copy(GHOST_TINT); c.emissiveIntensity = 0.4; }
    c.transparent = true;
    c.opacity = GHOST_OPACITY;
    c.depthWrite = true; // hides the inner parts: a clean see-through silhouette
    clones.push(c);
    return c;
  };
  group.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    // Outlines (dark back faces) and the blob shadow look heavy on a ghost: soften them.
    o.material = Array.isArray(o.material) ? o.material.map(ghostMat) : ghostMat(o.material);
    o.renderOrder = 5;
    o.castShadow = false;
  });

  // Twinkly trail: small glowing stars drifting behind the ghost.
  const sparkGeo = new THREE.OctahedronGeometry(0.22, 0);
  const colors = [0xffffff, 0xffd1f0, 0xd6c8ff];
  const sparkMats = [];
  const sparkles = [];
  for (let i = 0; i < SPARKLES; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0.9, depthWrite: false });
    sparkMats.push(mat);
    const m = new THREE.Mesh(sparkGeo, mat);
    m.renderOrder = 6;
    m.userData.phase = i / SPARKLES;
    m.userData.side = (i % 2 ? 1 : -1) * (0.3 + (i % 3) * 0.25);
    scene.add(m);
    sparkles.push(m);
  }
  scene.add(group);
  group.visible = false;

  const pose = {};
  let opacity = 0;
  let spin = 0;

  return {
    group,
    pose,
    /**
     * @param {number} t race time (s since GO)
     * @param {number} dt frame seconds
     * @param {{x,y,z}|null} playerPos the player's kart, for the up-close fade
     * @param {number} clock race.clock (animation time)
     */
    update(t, dt, playerPos = null, clock = 0) {
      if (!decoded) return;
      ghostPoseAt(decoded, t, pose);
      group.position.set(pose.x, pose.y, pose.z);
      group.rotation.set(0, pose.heading, 0);
      const dist = playerPos ? Math.hypot(playerPos.x - pose.x, playerPos.z - pose.z) : Infinity;
      // Appear with a little fade after GO; drift away softly once the run is over.
      const want = t < 0.25 ? 0 : pose.done ? Math.max(0, GHOST_OPACITY * (1 - (t - decoded.duration) / 2)) : ghostFade(dist);
      opacity += (want - opacity) * Math.min(1, dt * 8);
      group.visible = opacity > 0.02;
      for (const c of clones) c.opacity = opacity;
      model.update(dt, { speed: pose.done ? 0 : pose.speed, steer: 0, drifting: false, driftLevel: 0, spinning: false, boosting: false, shielded: false, time: clock, star: false });
      spin += dt;
      const fx = Math.sin(pose.heading);
      const fz = Math.cos(pose.heading);
      sparkles.forEach((s, i) => {
        const ph = (s.userData.phase + spin * 0.9) % 1;
        const back = 0.8 + ph * 3.2;
        const side = s.userData.side;
        s.position.set(pose.x - fx * back + fz * side, pose.y + 0.5 + Math.sin((ph + i) * 6.28) * 0.35 + ph * 0.6, pose.z - fz * back - fx * side);
        s.rotation.y = spin * 3 + i;
        s.scale.setScalar((1 - ph) * 1.1 + 0.2);
        s.visible = group.visible;
        s.material.opacity = Math.min(0.9, opacity * 1.8) * (1 - ph);
      });
    },
    dispose() {
      scene.remove(group);
      for (const s of sparkles) scene.remove(s);
      sparkGeo.dispose();
      sparkMats.forEach((m) => m.dispose());
      clones.forEach((m) => m.dispose());
      model.dispose?.();
    },
  };
}
