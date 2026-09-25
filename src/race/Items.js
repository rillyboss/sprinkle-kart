import * as THREE from 'three';
import { toon, glow, addOutline } from '../render/toon.js';
import { TUNING as T } from './tuning.js';
import { bonkKart, giveBoost, sweptDistSq } from './Kart.js';

export const ITEM_IDS = [
  'sprinkle-boost', 'triple-sprinkle', 'gumdrop', 'bubble-shield', 'cupcake-rocket', 'rainbow-star',
];

/** Friendly names + emoji the HUD can use. */
export const ITEM_INFO = {
  'sprinkle-boost': { name: 'Sprinkle Boost', emoji: '🍬', color: '#ff7ac8' },
  'triple-sprinkle': { name: 'Triple Sprinkle', emoji: '🍭', color: '#ffb347' },
  gumdrop: { name: 'Gumdrop', emoji: '🟢', color: '#6fdc6f' },
  'bubble-shield': { name: 'Bubble Shield', emoji: '🫧', color: '#7fd8ff' },
  'cupcake-rocket': { name: 'Cupcake Rocket', emoji: '🧁', color: '#ff9ecf' },
  'rainbow-star': { name: 'Rainbow Star', emoji: '🌟', color: '#ffe066' },
};

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

export function buildGumdropMesh(color) {
  const g = new THREE.Group();
  const bodyGeo = new THREE.SphereGeometry(0.75, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const body = new THREE.Mesh(bodyGeo, toon(color));
  body.scale.set(1, 1.15, 1);
  body.position.y = 0.05;
  addOutline(body, 0.06);
  g.add(body);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.66, 0.12, 16), toon(color));
  base.position.y = 0.06;
  g.add(base);
  // sugar sparkles
  const sugar = glow(0xffffff);
  const dotGeo = new THREE.SphereGeometry(0.06, 5, 4);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4;
    const el = 0.35 + (i % 3) * 0.25;
    const d = new THREE.Mesh(dotGeo, sugar);
    d.position.set(Math.cos(a) * 0.7 * Math.cos(el), 0.1 + Math.sin(el) * 0.8, Math.sin(a) * 0.7 * Math.cos(el));
    g.add(d);
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
    g.add(e);
    const sh = new THREE.Mesh(shineGeo, shine);
    sh.position.set(x + 0.035, 0.57, 0.67);
    g.add(sh);
    const ch = new THREE.Mesh(cheekGeo, cheekMat);
    ch.position.set(x * 1.75, 0.38, 0.58);
    ch.rotation.y = x > 0 ? 0.55 : -0.55;
    g.add(ch);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI), eyeMat);
  smile.rotation.z = Math.PI;
  smile.position.set(0, 0.4, 0.66);
  g.add(smile);
  return g;
}

export function buildRocketMesh() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.x = Math.PI / 2; // cupcake points forward (+Z)
  g.add(inner);
  const wrapper = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.55, 12), toon(0x8fd3ff));
  wrapper.position.y = -0.2;
  addOutline(wrapper, 0.06);
  inner.add(wrapper);
  const frosting = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), toon(0xff9ecf));
  frosting.scale.set(1, 0.9, 1);
  frosting.position.y = 0.2;
  addOutline(frosting, 0.05);
  inner.add(frosting);
  const swirl = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.45, 12), toon(0xffc4e4));
  swirl.position.y = 0.62;
  inner.add(swirl);
  const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), toon(0xff3b5c));
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
    g.add(w);
  }
  // sparkly exhaust puff
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), glow(0xfff3a8, { transparent: true, opacity: 0.8 }));
  puff.position.z = -0.75;
  puff.name = 'puff';
  g.add(puff);
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
    this.root = new THREE.Group();
    this.root.name = 'race-items';
    scene.add(this.root);
    this.gumdrops = [];
    this.rockets = [];
    this.poofs = [];
    this._time = 0;
  }

  /** Called when a kart presses "use item". Returns true if something was used. */
  use(kart) {
    const item = kart.item;
    if (!item || kart.itemRoulette > 0) return false;
    switch (item) {
      case 'sprinkle-boost':
        giveBoost(kart, T.itemBoost);
        this.emit({ type: 'boost', kart, source: 'item' });
        break;
      case 'triple-sprinkle':
        giveBoost(kart, T.itemBoost);
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
        giveBoost(kart, 0.6);
        break;
      default:
        return false;
    }
    this.emit({ type: 'item-use', kart, item });
    if (item === 'triple-sprinkle' && kart.itemCharges > 1) {
      kart.itemCharges -= 1;
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
    this.root.add(mesh);
    const gd = { position: pos, s: pr.s, lateral: Math.max(-maxLat, Math.min(maxLat, pr.lateral)), owner: kart, grace: T.gumdropGrace, age: 0, mesh, phase: this.rng() * 6 };
    this.gumdrops.push(gd);
    while (this.gumdrops.length > T.maxGumdrops) this._removeGumdrop(this.gumdrops[0], false);
    return gd;
  }

  launchRocket(kart) {
    const standings = this.getStandings();
    const idx = standings.indexOf(kart);
    let target = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (!standings[i].finished) { target = standings[i]; break; }
    }
    const mesh = buildRocketMesh();
    this.root.add(mesh);
    const rocket = {
      owner: kart,
      target,
      distance: kart.distance + 2.5,
      s: this.path.wrap(kart.s + 2.5),
      lateral: kart.lateral,
      y: kart.position.y + 0.8,
      travelled: 0,
      life: T.rocketLife,
      mesh,
    };
    this.rockets.push(rocket);
    this._placeRocket(rocket, 0);
    this.emit({ type: 'rocket-launch', kart, target });
    return rocket;
  }

  _placeRocket(r, dt) {
    const pos = this.path.positionAt(r.s, r.lateral, r.mesh.position);
    const ground = pos.y;
    r.y += (ground + 0.9 - r.y) * Math.min(1, dt * 8);
    pos.y = r.y + Math.sin(this._time * 12 + r.life) * 0.08;
    r.mesh.rotation.y = this.path.headingAt(r.s);
    r.mesh.rotation.z = Math.sin(this._time * 7) * 0.2;
    const flap = Math.sin(this._time * 28) * 0.5;
    const wl = r.mesh.getObjectByName('wingL');
    const wr = r.mesh.getObjectByName('wingR');
    if (wl) wl.rotation.z = -0.45 - flap;
    if (wr) wr.rotation.z = 0.45 + flap;
    const puff = r.mesh.getObjectByName('puff');
    if (puff) puff.scale.setScalar(0.8 + Math.sin(this._time * 30) * 0.25);
  }

  /** Bonk a kart via an item, emitting the friendly events. */
  bonk(kart, cause, by) {
    const res = bonkKart(kart);
    if (res === 'bonked') this.emit({ type: 'bonked', kart, cause, by });
    else if (res === 'blocked') this.emit({ type: 'shield-pop', kart, cause, by });
    return res;
  }

  update(dt, karts) {
    this._time += dt;
    this._updateGumdrops(dt, karts);
    this._updateRockets(dt, karts);
    this._updatePoofs(dt);
  }

  _updateGumdrops(dt, karts) {
    for (let i = this.gumdrops.length - 1; i >= 0; i--) {
      const g = this.gumdrops[i];
      g.age += dt;
      if (g.grace > 0) g.grace -= dt;
      // cute idle wobble
      const w = Math.sin(this._time * 4 + g.phase);
      g.mesh.scale.set(1 + w * 0.05, 1 - w * 0.06, 1 + w * 0.05);
      if (g.age < 0.25) g.mesh.scale.multiplyScalar(g.age / 0.25);
      if (g.age > T.gumdropLife) { this._removeGumdrop(g, true); continue; }
      for (const k of karts) {
        if (k === g.owner && g.grace > 0) continue;
        if (sweptDistSq(k, g.position.x, g.position.z) < T.gumdropRadius * T.gumdropRadius && Math.abs(k.position.y - g.position.y) < 2.5) {
          this.bonk(k, 'gumdrop', g.owner);
          this._removeGumdrop(g, true);
          break;
        }
      }
    }
  }

  _updateRockets(dt, karts) {
    const path = this.path;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
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

      let hit = null;
      for (const k of karts) {
        if (k === r.owner) continue;
        const dist = Math.abs(path.delta(r.s, k.s));
        if (dist < T.rocketHitRadius + 0.6 && Math.abs(k.lateral - r.lateral) < T.rocketHitRadius) { hit = k; break; }
      }
      if (!hit) {
        // rockets and gumdrops pop each other in a burst of sprinkles
        for (const g of this.gumdrops) {
          const dx = g.position.x - r.mesh.position.x, dz = g.position.z - r.mesh.position.z;
          if (dx * dx + dz * dz < 2.2) { this._removeGumdrop(g, true); this._removeRocket(r, true); break; }
        }
        if (!this.rockets.includes(r)) continue;
      }
      if (hit) {
        this.bonk(hit, 'cupcake-rocket', r.owner);
        this._removeRocket(r, true);
      } else if (r.life <= 0 || (!r.target && r.travelled > T.rocketRange)) {
        this._removeRocket(r, true);
      }
    }
  }

  _removeGumdrop(g, poof) {
    const i = this.gumdrops.indexOf(g);
    if (i >= 0) this.gumdrops.splice(i, 1);
    if (poof) this.poof(g.mesh.position, 0x9bf29b);
    this.root.remove(g.mesh);
    disposeTree(g.mesh);
  }

  _removeRocket(r, poof) {
    const i = this.rockets.indexOf(r);
    if (i >= 0) this.rockets.splice(i, 1);
    if (poof) this.poof(r.mesh.position, 0xff9ecf);
    this.root.remove(r.mesh);
    disposeTree(r.mesh);
  }

  /** A little burst of sparkly candy dots. */
  poof(position, color = 0xffffff) {
    const g = new THREE.Group();
    g.position.copy(position);
    const colors = [color, 0xffffff, 0xffe066, 0x8fd3ff];
    const geo = new THREE.SphereGeometry(0.22, 6, 5);
    const parts = [];
    for (let i = 0; i < 10; i++) {
      const mat = glow(colors[i % colors.length], { unique: true, transparent: true, opacity: 1 });
      const m = new THREE.Mesh(geo, mat);
      const a = (i / 10) * Math.PI * 2;
      parts.push({ m, vx: Math.cos(a) * 5, vy: 3 + (i % 3) * 1.5, vz: Math.sin(a) * 5 });
      g.add(m);
    }
    this.root.add(g);
    this.poofs.push({ group: g, parts, geo, t: 0, dur: 0.6 });
  }

  _updatePoofs(dt) {
    for (let i = this.poofs.length - 1; i >= 0; i--) {
      const p = this.poofs[i];
      p.t += dt;
      const k = p.t / p.dur;
      for (const q of p.parts) {
        q.m.position.x += q.vx * dt;
        q.m.position.y += q.vy * dt;
        q.m.position.z += q.vz * dt;
        q.vy -= 9 * dt;
        q.m.material.opacity = Math.max(0, 1 - k);
        q.m.scale.setScalar(1 - k * 0.6);
      }
      if (p.t >= p.dur) {
        this.root.remove(p.group);
        for (const q of p.parts) q.m.material.dispose();
        p.geo.dispose();
        this.poofs.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const g of [...this.gumdrops]) this._removeGumdrop(g, false);
    for (const r of [...this.rockets]) this._removeRocket(r, false);
    for (const p of this.poofs) {
      for (const q of p.parts) q.m.material.dispose();
      p.geo.dispose();
    }
    this.poofs = [];
    this.scene.remove(this.root);
  }
}

/** Dispose geometries under an object (materials are shared toon() caches). */
export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}
