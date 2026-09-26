import * as THREE from 'three';
import { toon, glow, addOutline } from '../render/toon.js';
import { TUNING as T } from './tuning.js';
import { bonkKart, giveBoost, sweptDistSq } from './Kart.js';
import { ITEM_CATALOG, ITEM_ORDER, itemForCause } from './itemCatalog.js';
import { BurstField } from './itemBursts.js';
import { carry } from './ItemBoxes.js';

export const ITEM_IDS = [...ITEM_ORDER];

/** Friendly names + emoji the HUD can use (see ./itemCatalog.js for the full catalog). */
export const ITEM_INFO = Object.fromEntries(ITEM_IDS.map((id) => {
  const c = ITEM_CATALOG[id];
  return [id, { name: c.name, emoji: c.emoji, color: c.color }];
}));

/**
 * The item effects this module draws in 3D (see cueFor() in ./itemCatalog.js;
 * tests/items.cues.test.js checks every cue has an implementation).
 */
export const FX_PROVIDES = Object.freeze([
  'gumdrop-plop', 'gumdrop-glow-ring', 'gumdrop-poof', 'star-burst', 'bubble-pop', 'dodge-sparkle',
  'rocket-launch', 'rocket-trail', 'rocket-fizzle', 'rocket-reticle', 'star-fade',
]);

/** How close (units) a kart must pass a gumdrop without touching it to count as a dodge. */
export const DODGE_NEAR = 3.8;
const DODGE_CLEAR = 6;
/** A rocket that fizzles within this many track units of its target counts as dodged. */
export const ROCKET_DODGE_RANGE = 45;

/**
 * Item odds by race position. `r` = 0 for the leader, 1 for last place.
 * The back of the pack gets the exciting catch-up items.
 */
export function itemWeights(place, count) {
  const r = count > 1 ? (place - 1) / (count - 1) : 0;
  return {
    'sprinkle-boost': 3 + r * 3,
    'triple-sprinkle': r * 4.5,
    gumdrop: Math.max(0, 5 - r * 5),
    'bubble-shield': 4 - r * 2.5,
    'cupcake-rocket': place <= 1 ? 0 : 1 + r * 3,
    'rainbow-star': r > 0.45 ? (r - 0.45) * 6 : 0,
  };
}

/** Pick an item for a kart in `place` of `count`. `rng` returns [0,1). */
export function rollItem(place, count, rng = Math.random) {
  const w = itemWeights(place, count);
  let total = 0;
  for (const id of ITEM_IDS) total += w[id];
  let x = rng() * total;
  for (const id of ITEM_IDS) {
    x -= w[id];
    if (x < 0) return id;
  }
  return 'sprinkle-boost';
}

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------

const GUMDROP_COLORS = [0xff6fb5, 0x7ee07e, 0xffd35c, 0x8fb8ff, 0xc38bff];

/** Scale of dropped gumdrops (bigger = easier to spot on the road). */
export const GUMDROP_SCALE = 1.5;
/** Scale of the flying cupcake. */
export const ROCKET_SCALE = 1.35;

export function buildGumdropMesh(color) {
  const g = new THREE.Group();
  const jelly = new THREE.Group();
  jelly.name = 'jelly';
  jelly.scale.setScalar(GUMDROP_SCALE);
  g.add(jelly);
  const bodyGeo = new THREE.SphereGeometry(0.75, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const body = new THREE.Mesh(bodyGeo, toon(color, { emissive: color, emissiveIntensity: 0.18 }));
  body.scale.set(1, 1.15, 1);
  body.position.y = 0.05;
  addOutline(body, 0.07);
  jelly.add(body);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.66, 0.12, 16), toon(color));
  base.position.y = 0.06;
  jelly.add(base);
  // sugar sparkles
  const sugar = glow(0xffffff);
  const dotGeo = new THREE.SphereGeometry(0.06, 5, 4);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4;
    const el = 0.35 + (i % 3) * 0.25;
    const d = new THREE.Mesh(dotGeo, sugar);
    d.position.set(Math.cos(a) * 0.7 * Math.cos(el), 0.1 + Math.sin(el) * 0.8, Math.sin(a) * 0.7 * Math.cos(el));
    jelly.add(d);
  }
  // cute face
  const eyeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const shineGeo = new THREE.SphereGeometry(0.04, 6, 5);
  const eyeMat = toon(0x2a1633);
  const shine = glow(0xffffff);
  const cheekGeo = new THREE.CircleGeometry(0.09, 12);
  const cheekMat = toon(0xff9ec8, { transparent: true, opacity: 0.85 });
  for (const x of [-0.22, 0.22]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(x, 0.52, 0.6);
    e.scale.set(1, 1.2, 0.6);
    jelly.add(e);
    const sh = new THREE.Mesh(shineGeo, shine);
    sh.position.set(x + 0.035, 0.57, 0.67);
    jelly.add(sh);
    const ch = new THREE.Mesh(cheekGeo, cheekMat);
    ch.position.set(x * 1.75, 0.38, 0.58);
    ch.rotation.y = x > 0 ? 0.55 : -0.55;
    jelly.add(ch);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI), eyeMat);
  smile.rotation.z = Math.PI;
  smile.position.set(0, 0.4, 0.66);
  jelly.add(smile);
  return g;
}

/**
 * The glowing "watch out, gumdrop here!" ring painted on the road under a
 * gumdrop, so it reads from far away and at a glance.
 */
export function buildGumdropRing(color, mats) {
  const ring = new THREE.Group();
  ring.name = 'glow-ring';
  const outer = new THREE.Mesh(new THREE.RingGeometry(T.gumdropRadius + 0.15, T.gumdropRadius + 0.55, 36).rotateX(-Math.PI / 2), mats.ringOuter);
  outer.renderOrder = 3;
  const inner = new THREE.Mesh(new THREE.CircleGeometry(T.gumdropRadius + 0.15, 36).rotateX(-Math.PI / 2), mats.ringFill);
  inner.renderOrder = 2;
  const tint = new THREE.Mesh(new THREE.RingGeometry(T.gumdropRadius - 0.2, T.gumdropRadius + 0.15, 36).rotateX(-Math.PI / 2),
    glow(color, { transparent: true, opacity: 0.55 }));
  tint.renderOrder = 3;
  ring.add(inner, tint, outer);
  ring.position.y = 0.08;
  return ring;
}

export function buildRocketMesh() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  body.scale.setScalar(ROCKET_SCALE);
  g.add(body);
  const inner = new THREE.Group();
  inner.rotation.x = Math.PI / 2; // cupcake points forward (+Z)
  body.add(inner);
  const wrapper = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.55, 12), toon(0x8fd3ff));
  wrapper.position.y = -0.2;
  addOutline(wrapper, 0.07);
  inner.add(wrapper);
  const frosting = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), toon(0xff9ecf, { emissive: 0xff9ecf, emissiveIntensity: 0.2 }));
  frosting.scale.set(1, 0.9, 1);
  frosting.position.y = 0.2;
  addOutline(frosting, 0.06);
  inner.add(frosting);
  const swirl = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.45, 12), toon(0xffc4e4));
  swirl.position.y = 0.62;
  inner.add(swirl);
  const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), toon(0xff3b5c, { emissive: 0xff3b5c, emissiveIntensity: 0.3 }));
  cherry.position.y = 0.9;
  inner.add(cherry);
  const sprinkleGeo = new THREE.CapsuleGeometry(0.03, 0.1, 2, 4);
  const sprColors = [0xffe066, 0x7ee07e, 0x8fb8ff, 0xffffff];
  for (let i = 0; i < 10; i++) {
    const a = i * 1.9;
    const m = new THREE.Mesh(sprinkleGeo, toon(sprColors[i % 4]));
    m.position.set(Math.cos(a) * 0.38, 0.28 + (i % 3) * 0.08, Math.sin(a) * 0.38);
    m.rotation.set(a, a * 0.5, 0.8);
    inner.add(m);
  }
  // little fluttery wings so it reads as a flying cupcake
  const wingGeo = new THREE.SphereGeometry(0.34, 10, 8);
  const wingMat = toon(0xffffff, { emissive: 0xfff0fa, emissiveIntensity: 0.3 });
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.scale.set(1, 0.18, 0.62);
    w.position.set(side * 0.62, 0.22, -0.1);
    w.rotation.z = side * 0.45;
    w.name = side < 0 ? 'wingL' : 'wingR';
    addOutline(w, 0.08);
    body.add(w);
  }
  // sparkly exhaust puff
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), glow(0xfff3a8, { transparent: true, opacity: 0.85 }));
  puff.position.z = -0.75;
  puff.name = 'puff';
  body.add(puff);
  // soft pink halo so the silhouette pops against any sky
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 10), glow(0xff9ecf, { transparent: true, opacity: 0.22 }));
  halo.name = 'halo';
  halo.renderOrder = 4;
  body.add(halo);
  return g;
}

/** The pulsing "a cupcake is coming for you" target ring around a kart. */
export function buildReticleMesh(mats) {
  const g = new THREE.Group();
  g.name = 'rocket-reticle';
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.09, 6, 40).rotateX(Math.PI / 2), mats.reticle);
  ring.renderOrder = 7;
  g.add(ring);
  const dash = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.06, 4, 40, Math.PI * 0.35).rotateX(Math.PI / 2), mats.reticleSoft);
  const dash2 = dash.clone();
  dash2.rotation.y = Math.PI;
  const spin = new THREE.Group();
  spin.name = 'spin';
  spin.add(dash, dash2);
  const chevGeo = new THREE.ConeGeometry(0.32, 0.55, 3).rotateZ(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const c = new THREE.Mesh(chevGeo, mats.reticle);
    c.position.set(Math.cos(a) * 2.9, 0, Math.sin(a) * 2.9);
    c.rotation.y = -a;
    c.renderOrder = 7;
    spin.add(c);
  }
  g.add(spin);
  return g;
}

// ---------------------------------------------------------------------------
// Item system: active gumdrops, rockets and little poof effects.
// ---------------------------------------------------------------------------

export class ItemSystem {
  /**
   * @param {{scene: THREE.Object3D, path, emit: Function, rng?: Function, getStandings: Function}} opts
   */
  constructor({ scene, path, emit, rng = Math.random, getStandings }) {
    this.scene = scene;
    this.path = path;
    this.emit = emit || (() => {});
    this.rng = rng;
    this.getStandings = getStandings || (() => []);
    /**
     * Optional mode hooks (set by the Race for Team Race / Bubble Pop Battle, see src/modes/):
     *   isFriendly(a, b) -> true = team-mates: their gumdrops, rockets and stars never bonk each other
     *   pickTarget(kart) -> { target, distance } | null: who a cupcake rocket chases and the
     *                       rocket's start distance in the target's frame (null = the default:
     *                       the racer just ahead in the standings)
     */
    this.isFriendly = null;
    this.pickTarget = null;
    this.root = new THREE.Group();
    this.root.name = 'race-items';
    scene.add(this.root);
    this.gumdrops = [];
    this.rockets = [];
    this.bursts = new BurstField(this.root);
    this._time = 0;
    this._starOn = new Set();
    this._itemBoost = new Map(); // kart -> item id while an item boost burns
    this.mats = {
      ringOuter: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      ringFill: new THREE.MeshBasicMaterial({ color: 0xfff6c9, transparent: true, opacity: 0.28, depthWrite: false }),
      reticle: new THREE.MeshBasicMaterial({ color: 0xff4f9a, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }),
      reticleSoft: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false }),
    };
  }

  /** Compatibility alias: the old per-burst poof list is now the pooled burst field. */
  get poofs() { return this.bursts.parts.blob.concat(this.bursts.parts.star); }

  /** Called when a kart presses "use item". Returns true if something was used. */
  use(kart) {
    const item = kart.item;
    if (!item || kart.itemRoulette > 0) return false;
    switch (item) {
      case 'sprinkle-boost':
      case 'triple-sprinkle':
        giveBoost(kart, T.itemBoost);
        this._itemBoost.set(kart, item);
        this.emit({ type: 'boost', kart, source: 'item' });
        break;
      case 'gumdrop':
        this.dropGumdrop(kart);
        break;
      case 'bubble-shield':
        kart.shielded = true;
        kart.phys.shieldTime = T.shieldDuration;
        break;
      case 'cupcake-rocket':
        this.launchRocket(kart);
        break;
      case 'rainbow-star':
        kart.starPower = T.starDuration;
        this._starOn.add(kart);
        giveBoost(kart, 0.6);
        break;
      default:
        return false;
    }
    const chargesLeft = item === 'triple-sprinkle' && kart.itemCharges > 1 ? kart.itemCharges - 1 : 0;
    this.emit({ type: 'item-use', kart, item, chargesLeft });
    if (chargesLeft > 0) {
      kart.itemCharges = chargesLeft;
    } else {
      kart.item = null;
      kart.itemCharges = 0;
    }
    return true;
  }

  dropGumdrop(kart) {
    const fx = Math.sin(kart.heading), fz = Math.cos(kart.heading);
    const pos = new THREE.Vector3(kart.position.x - fx * 2.6, 0, kart.position.z - fz * 2.6);
    const pr = this.path.project(pos, kart.s);
    // Keep it on the road so it is never lost in the scenery.
    const maxLat = this.path.halfWidth + 1;
    if (Math.abs(pr.lateral) > maxLat) {
      this.path.positionAt(pr.s, Math.sign(pr.lateral) * maxLat, pos);
    }
    pos.y = pr.height;
    const color = GUMDROP_COLORS[Math.floor(this.rng() * GUMDROP_COLORS.length)];
    const mesh = buildGumdropMesh(color);
    mesh.position.copy(pos);
    mesh.rotation.y = kart.heading;
    const ring = buildGumdropRing(color, this.mats);
    mesh.add(ring);
    this.root.add(mesh);
    const gd = {
      position: pos, s: pr.s, lateral: Math.max(-maxLat, Math.min(maxLat, pr.lateral)), owner: kart, grace: T.gumdropGrace,
      age: 0, mesh, ring, jelly: mesh.getObjectByName('jelly'), phase: this.rng() * 6, color, near: new Set(), dodged: new Set(),
    };
    this.gumdrops.push(gd);
    this.bursts.emit('gumdrop-plop', { x: pos.x, y: pos.y + 0.5, z: pos.z });
    while (this.gumdrops.length > T.maxGumdrops) this._removeGumdrop(this.gumdrops[0], false);
    return gd;
  }

  launchRocket(kart) {
    const picked = this.pickTarget ? this.pickTarget(kart) : null;
    let target = picked?.target ?? null;
    if (!picked) {
      const standings = this.getStandings();
      const idx = standings.indexOf(kart);
      for (let i = idx - 1; i >= 0; i--) {
        if (!standings[i].finished && !this._friends(standings[i], kart)) { target = standings[i]; break; }
      }
    }
    const mesh = buildRocketMesh();
    this.root.add(mesh);
    const reticle = buildReticleMesh(this.mats);
    reticle.visible = false;
    this.root.add(reticle);
    const rocket = {
      owner: kart,
      target,
      chased: target, // who it was sent after (kept even if it loses them: "dodged!")
      distance: Number.isFinite(picked?.distance) ? picked.distance : kart.distance + 2.5,
      s: this.path.wrap(kart.s + 2.5),
      lateral: kart.lateral,
      y: kart.position.y + 0.8,
      travelled: 0,
      life: T.rocketLife,
      mesh,
      reticle,
      trailT: 0,
      age: 0,
    };
    this.rockets.push(rocket);
    this._placeRocket(rocket, 0);
    this.bursts.emit('rocket-launch', rocket.mesh.position);
    this.emit({ type: 'rocket-launch', kart, target });
    return rocket;
  }

  /** Track distance from a rocket to its target (positive = target ahead), or null. */
  rocketGap(r) {
    if (!r?.target) return null;
    return r.target.distance - r.distance;
  }

  _placeRocket(r, dt) {
    const pos = this.path.positionAt(r.s, r.lateral, r.mesh.position);
    const ground = pos.y;
    r.y += (ground + 1.05 - r.y) * Math.min(1, dt * 8);
    pos.y = r.y + Math.sin(this._time * 12 + r.life) * 0.12;
    r.mesh.rotation.y = this.path.headingAt(r.s) + Math.sin(this._time * 5 + r.life) * 0.12;
    r.mesh.rotation.z = Math.sin(this._time * 7) * 0.3;
    const flap = Math.sin(this._time * 28) * 0.5;
    const wl = r.mesh.getObjectByName('wingL');
    const wr = r.mesh.getObjectByName('wingR');
    if (wl) wl.rotation.z = -0.45 - flap;
    if (wr) wr.rotation.z = 0.45 + flap;
    const puff = r.mesh.getObjectByName('puff');
    if (puff) puff.scale.setScalar(0.8 + Math.sin(this._time * 30) * 0.25);
    const halo = r.mesh.getObjectByName('halo');
    if (halo) halo.scale.setScalar(1 + Math.sin(this._time * 9) * 0.12);
  }

  _placeReticle(r) {
    const gap = this.rocketGap(r);
    const show = r.target && gap !== null && gap < 160 && gap > -6;
    r.reticle.visible = !!show;
    if (!show) return;
    const k = r.target;
    const close = Math.max(0, Math.min(1, 1 - gap / 160));
    r.reticle.position.set(k.position.x, k.position.y + 0.25, k.position.z);
    const pulse = 1 + Math.sin(this._time * (6 + close * 14)) * 0.08;
    r.reticle.scale.setScalar((1.25 - close * 0.35) * pulse);
    r.reticle.getObjectByName('spin').rotation.y = this._time * (1.5 + close * 4);
  }

  /** True when a mode says these two different karts are team-mates. */
  _friends(a, b) {
    return !!(this.isFriendly && a && b && a !== b && this.isFriendly(a, b));
  }

  /** Bonk a kart via an item, emitting the friendly events and the burst FX. */
  bonk(kart, cause, by) {
    if (this._friends(kart, by)) return 'friendly';
    const wasStar = kart.starPower > 0;
    const res = bonkKart(kart);
    const at = { x: kart.position.x, y: kart.position.y + 1.2, z: kart.position.z };
    if (res === 'bonked') {
      this.bursts.emit('star-burst', at, { dir: carry(kart, 0.6) });
      this.emit({ type: 'bonked', kart, cause, by });
    } else if (res === 'blocked') {
      this.bursts.emit('bubble-pop', at, { scale: 1.2, dir: carry(kart) });
      this.emit({ type: 'shield-pop', kart, cause, by });
    } else if (res === 'immune' && wasStar && cause !== 'star') {
      // Star power shrugs it off: show it, so nobody wonders what happened.
      this.bursts.emit('dodge-sparkle', at, { scale: 1.3, dir: carry(kart) });
      this.emit({ type: 'item-dodged', kart, item: itemForCause(cause), by, star: true });
    }
    return res;
  }

  update(dt, karts) {
    this._time += dt;
    this._updateGumdrops(dt, karts);
    this._updateRockets(dt, karts);
    this._updateTimedEffects(karts);
    this.bursts.update(dt);
  }

  /** Emits 'item-end' when a Rainbow Star or an item boost runs out. */
  _updateTimedEffects(karts) {
    for (const k of karts) {
      if (k.starPower > 0) this._starOn.add(k);
      else if (this._starOn.has(k)) {
        this._starOn.delete(k);
        this.bursts.emit('star-fade', { x: k.position.x, y: k.position.y + 1, z: k.position.z }, { dir: carry(k) });
        this.emit({ type: 'item-end', kart: k, item: 'rainbow-star' });
      }
      const boostItem = this._itemBoost.get(k);
      if (boostItem && !k.boosting) {
        this._itemBoost.delete(k);
        this.emit({ type: 'item-end', kart: k, item: boostItem });
      }
    }
  }

  _updateGumdrops(dt, karts) {
    for (let i = this.gumdrops.length - 1; i >= 0; i--) {
      const g = this.gumdrops[i];
      g.age += dt;
      if (g.grace > 0) g.grace -= dt;
      // jiggly idle wobble (+ a bigger springy land when first dropped)
      const w = Math.sin(this._time * 6 + g.phase);
      const land = g.age < 0.6 ? Math.exp(-g.age * 6) * Math.cos(g.age * 28) * 0.45 : 0;
      const target = g.jelly ?? g.mesh;
      target.scale.set(GUMDROP_SCALE * (1 + w * 0.08 + land * 0.6), GUMDROP_SCALE * (1 - w * 0.1 - land), GUMDROP_SCALE * (1 + w * 0.08 + land * 0.6));
      if (g.age < 0.2) target.scale.multiplyScalar(Math.max(0.05, g.age / 0.2));
      if (g.ring) {
        const pulse = 1 + Math.sin(this._time * 4 + g.phase) * 0.07;
        g.ring.scale.set(pulse, 1, pulse);
        g.ring.rotation.y = -g.mesh.rotation.y;
      }
      if (g.age > T.gumdropLife) { this._removeGumdrop(g, true, 'expired'); continue; }
      let hit = false;
      for (const k of karts) {
        if (k === g.owner && g.grace > 0) continue;
        if (this._friends(k, g.owner)) continue; // team-mates roll right over each other's gumdrops
        const d2 = sweptDistSq(k, g.position.x, g.position.z);
        const sameLevel = Math.abs(k.position.y - g.position.y) < 2.5;
        if (d2 < T.gumdropRadius * T.gumdropRadius && sameLevel) {
          this.bonk(k, 'gumdrop', g.owner);
          this._removeGumdrop(g, true);
          hit = true;
          break;
        }
        // Near-miss bookkeeping: close pass, then clear of it = "Phew! Dodged!"
        if (k === g.owner || g.dodged.has(k) || !sameLevel) continue;
        const dx = k.position.x - g.position.x, dz = k.position.z - g.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < DODGE_NEAR) g.near.add(k);
        else if (d > DODGE_CLEAR && g.near.has(k)) {
          g.near.delete(k);
          g.dodged.add(k);
          this.bursts.emit('dodge-sparkle', { x: g.position.x, y: g.position.y + 1, z: g.position.z });
          this.emit({ type: 'item-dodged', kart: k, item: 'gumdrop', by: g.owner });
        }
      }
      if (hit) continue;
    }
  }

  _updateRockets(dt, karts) {
    const path = this.path;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      r.age += dt;
      if (r.target && r.target.finished) r.target = null;
      let speed = T.rocketSpeed;
      if (r.target) {
        const gap = r.target.distance - r.distance;
        speed = Math.max(T.rocketSpeed, Math.abs(r.target.speed) + 14);
        if (gap < 60) {
          const d = r.target.lateral - r.lateral;
          const step = T.rocketHomingRate * (gap < 15 ? 2.2 : 1) * dt;
          r.lateral += Math.max(-step, Math.min(step, d));
        }
        if (gap < -6) r.target = null; // overshot somehow
      } else {
        // drift gently back toward the centre line
        r.lateral *= Math.exp(-0.8 * dt);
      }
      const move = speed * dt;
      r.distance += move;
      r.travelled += move;
      r.s = path.wrap(r.s + move);
      this._placeRocket(r, dt);
      this._placeReticle(r);
      // sprinkle trail
      r.trailT += dt;
      while (r.trailT > 0.03) {
        r.trailT -= 0.03;
        const h = r.mesh.rotation.y;
        const back = { x: r.mesh.position.x - Math.sin(h) * 1.1, y: r.mesh.position.y, z: r.mesh.position.z - Math.cos(h) * 1.1 };
        this.bursts.emit('rocket-trail', back);
      }

      let hit = null;
      for (const k of karts) {
        if (k === r.owner || this._friends(k, r.owner)) continue;
        const dist = Math.abs(path.delta(r.s, k.s));
        if (dist < T.rocketHitRadius + 0.6 && Math.abs(k.lateral - r.lateral) < T.rocketHitRadius) { hit = k; break; }
      }
      if (!hit) {
        // rockets and gumdrops pop each other in a burst of sprinkles
        for (const g of this.gumdrops) {
          const dx = g.position.x - r.mesh.position.x, dz = g.position.z - r.mesh.position.z;
          if (dx * dx + dz * dz < 2.2) { this._removeGumdrop(g, true); this._removeRocket(r, true, 'gumdrop'); break; }
        }
        if (!this.rockets.includes(r)) continue;
      }
      if (hit) {
        const res = this.bonk(hit, 'cupcake-rocket', r.owner);
        this._removeRocket(r, res === 'immune', 'hit');
      } else if (r.life <= 0 || (!r.target && r.travelled > T.rocketRange)) {
        this._removeRocket(r, true, 'fizzle');
      }
    }
  }

  _removeGumdrop(g, poof, why = 'popped') {
    const i = this.gumdrops.indexOf(g);
    if (i >= 0) this.gumdrops.splice(i, 1);
    if (poof) this.bursts.emit('gumdrop-poof', { x: g.position.x, y: g.position.y + 0.6, z: g.position.z });
    if (why === 'expired') this.emit({ type: 'item-end', kart: g.owner, item: 'gumdrop' });
    this.root.remove(g.mesh);
    disposeTree(g.mesh);
  }

  _removeRocket(r, poof, why = 'gone') {
    const i = this.rockets.indexOf(r);
    if (i >= 0) this.rockets.splice(i, 1);
    if (poof) this.bursts.emit('rocket-fizzle', r.mesh.position);
    if (why === 'fizzle' || why === 'gumdrop') {
      this.emit({ type: 'item-end', kart: r.owner, item: 'cupcake-rocket', why });
      const who = r.chased;
      if (who && !who.finished && Math.abs(who.distance - r.distance) < ROCKET_DODGE_RANGE) {
        this.emit({ type: 'item-dodged', kart: who, item: 'cupcake-rocket', by: r.owner });
      }
    }
    this.root.remove(r.mesh);
    this.root.remove(r.reticle);
    disposeTree(r.mesh);
    disposeTree(r.reticle);
  }

  /** A little burst of sparkly candy dots (kept for callers of the v1 API). */
  poof(position, color = 0xffffff) {
    void color;
    this.bursts.emit('gumdrop-poof', position);
  }

  dispose() {
    for (const g of [...this.gumdrops]) this._removeGumdrop(g, false, 'dispose');
    for (const r of [...this.rockets]) this._removeRocket(r, false, 'dispose');
    this.bursts.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.scene.remove(this.root);
  }
}

/** Dispose geometries under an object (materials are shared toon() caches). */
export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}
