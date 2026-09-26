/**
 * Where and how a kart model is drawn from its KartState: slope pitch / roll, happy-twirl spin, the
 * jump TRICK (a flip, spin or twirl of kart + driver around the kart's middle) and the landing squash.
 * One helper for the Race, the online replica (src/net/guest/replicaRace.js) and the online present
 * step (src/online/netRace.js), so every screen draws a trick the same way. OWNER: driving feel.
 */
import * as THREE from 'three';
import { TUNING as T } from './tuning.js';

const TAU = Math.PI * 2;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** 0..1 progress of the current trick (eased in and out), or 0. */
export function trickProgress(phys) {
  if (!phys || !(phys.trick > 0) || !(phys.trickLen > 0)) return 0;
  const t = Math.min(1, Math.max(0, phys.trickTime / phys.trickLen));
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

/**
 * Extra rotation (radians) a trick adds: kind 1 = front flip (pitch), 2 = spin (yaw), 3 = twirl (roll).
 * @returns {{ pitch: number, yaw: number, roll: number }}
 */
export function trickAngles(phys, out = { pitch: 0, yaw: 0, roll: 0 }) {
  out.pitch = 0; out.yaw = 0; out.roll = 0;
  const e = trickProgress(phys);
  if (e <= 0) return out;
  const a = e * TAU;
  if (phys.trick === 1) out.pitch = a;
  else if (phys.trick === 2) out.yaw = a;
  else out.roll = a;
  return out;
}

/** Landing squash as model scale: { xz, y } (1 = none). */
export function squashScale(phys) {
  const q = Math.max(0, Math.min(1, phys?.landSquash || 0));
  const w = Math.sin(q * Math.PI * 0.5); // strongest right at touch-down, springs back smoothly
  return { xz: 1 + 0.16 * w, y: 1 - 0.3 * w };
}

const _tr = { pitch: 0, yaw: 0, roll: 0 };

/**
 * Pose a kart model group.
 * @param {THREE.Object3D} group  kart.model.group (rotation order YXZ)
 * @param {object} kart            KartState (reads phys.pitch/roll/spinAngle/trick/trickTime/trickLen/landSquash)
 * @param {number} x @param {number} y @param {number} z   where to draw it (render position)
 * @param {number} [heading]       heading to draw (defaults to kart.heading)
 */
export function applyKartPose(group, kart, x, y, z, heading = kart.heading) {
  const p = kart.phys || {};
  const pitch = p.pitch || 0;
  const roll = p.roll || 0;
  const yaw = heading + (p.spinAngle || 0);
  const tr = trickAngles(p, _tr);
  group.rotation.set(pitch + tr.pitch, yaw + tr.yaw, roll + tr.roll);
  group.position.set(x, y, z);
  if (tr.pitch || tr.yaw || tr.roll) {
    // rotate around the kart's middle, not its wheels: shift by (R0 - R1) * centre
    _e.set(pitch, yaw, roll);
    _a.set(0, T.kartCenterY, 0).applyEuler(_e);
    _b.set(0, T.kartCenterY, 0).applyEuler(group.rotation);
    group.position.add(_a.sub(_b));
  }
  const sq = squashScale(p);
  group.scale.set(sq.xz, sq.y, sq.xz);
}
