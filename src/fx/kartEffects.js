/**
 * Kart-model effects host. buildKartModel() (src/characters/model.js) calls
 * buildKartEffects(rig, owned) once and effects.update(t, dt, s, st) every
 * frame, after the rig is posed and before the character's own wiggles.
 *
 * Effect modules (one owner each, edit only yours):
 *   ./driftSparks.js      drift sparks                          driving-feel
 *   ./powerupEffects.js   boost puff, shield bubble, dizzy stars  power-up clarity
 * A brand-new effect module goes in EFFECT_MODULES below (architect; ask in your PR).
 *
 * Module contract:
 *   export default {
 *     id: 'my-effect',
 *     build(rig, owned) {           // add nodes under rig.root / rig.chassis / rig.driver / rig.head
 *       owned.materials.push(mat);  // anything pushed here is disposed with the model
 *       return { update(t, dt, s, st) {}, dispose() {} };
 *     },
 *   };
 *
 * Every node an effect module adds directly under a rig node is tagged
 * `userData.kartFx = <module id>`; the visual golden fingerprints skip those
 * subtrees, so effect restyles never break tests/visual.golden.test.js.
 * Effects must never throw or produce NaNs for any model state
 * (tests/kartEffects.test.js runs them over every racer).
 */
import driftSparks from './driftSparks.js';
import powerupEffects from './powerupEffects.js';

export const EFFECT_MODULES = Object.freeze([driftSparks, powerupEffects]);

const rigParents = (rig) => [rig.root, rig.chassis, rig.driver, rig.head].filter(Boolean);

/**
 * @param {object} rig the character rig (root, chassis, driver, head, exhausts, ...)
 * @param {{geometries: object[], materials: object[]}} owned disposal lists of the model
 * @param {Array<{id:string, build:Function}>} [modules]
 * @returns {{ update(t:number, dt:number, s:object, st:object): void, dispose(): void, parts: Record<string, object> }}
 */
export function buildKartEffects(rig, owned, modules = EFFECT_MODULES) {
  const parts = {};
  const list = [];
  for (const mod of modules) {
    const parents = rigParents(rig);
    const before = parents.map((p) => new Set(p.children));
    const inst = mod.build(rig, owned) || {};
    parents.forEach((p, i) => {
      for (const c of p.children) if (!before[i].has(c)) c.userData.kartFx = mod.id;
    });
    parts[mod.id] = inst;
    list.push(inst);
  }
  return {
    parts,
    update(t, dt, s, st) {
      for (let i = 0; i < list.length; i++) list[i].update?.(t, dt, s, st);
    },
    dispose() {
      for (const inst of list) inst.dispose?.();
    },
  };
}
