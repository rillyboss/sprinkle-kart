import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import drivingFx, {
  SkidMarks, SKID, SKID_COLORS, trackSkids, PuffPool, PUFF, offRoadPuffRate, createDrivingFx, PUFF_COLORS,
} from '../src/systems/drivingFx.js';
import driftSparks, { sparkSize, SPARKS_PER_LEVEL, MAX_SPARKS, POP_TIME, rainbowHue } from '../src/fx/driftSparks.js';
import speedLines, { speedLinesTarget, easeSpeedLines, SPEED_LINES_MAX_OPACITY } from '../src/ui/widgets/driveSpeedLines.js';
import { createEventBus } from '../src/game/events.js';

const finiteArr = (a) => Array.prototype.every.call(a, Number.isFinite);

function kart(o = {}) {
  return {
    position: new THREE.Vector3(0, 0, 0), heading: 0, speed: 25, drifting: false, driftLevel: 0, offRoad: false,
    starPower: 0, boosting: false, spinning: false, finished: false, stats: { maxSpeed: 33 },
    phys: { hopY: 0, groundY: 0 }, ...o,
  };
}

describe('skid mark pool', () => {
  it('is a ring buffer: never grows past capacity, overwrites the oldest', () => {
    const m = new SkidMarks({ capacity: 8, life: 2 });
    for (let i = 0; i < 20; i++) expect(m.add(i, 0, i + 1, 0, 0, SKID_COLORS[1])).toBe(i % 8);
    expect(m.total).toBe(20);
    expect(m.alive).toBe(8);
    expect(m.mesh.count).toBe(8);
    expect(finiteArr(m.mesh.instanceMatrix.array)).toBe(true);
    m.dispose();
  });

  it('marks fade out smoothly over their life and are then gone', () => {
    const m = new SkidMarks({ capacity: 4, life: 2 });
    const i = m.add(0, 0, 0, 1, 0, SKID_COLORS[2]);
    let prev = m.alphaOf(i);
    expect(prev).toBe(1);
    for (let k = 0; k < 30; k++) {
      m.update(0.1);
      const a = m.alphaOf(i);
      expect(a).toBeLessThanOrEqual(prev);
      expect(prev - a).toBeLessThan(0.06);
      prev = a;
    }
    expect(m.alphaOf(i)).toBe(0);
    expect(m.alive).toBe(0);
    expect(m.material.uniforms.uTime.value).toBeCloseTo(3, 6);
  });

  it('ignores zero-length or broken segments', () => {
    const m = new SkidMarks({ capacity: 4 });
    expect(m.add(1, 1, 1, 1, 0, 0xffffff)).toBe(-1);
    expect(m.add(0, 0, 1, 1, NaN, 0xffffff)).toBe(-1);
    expect(m.total).toBe(0);
  });

  it('lays two wheel tracks every spacing metres while drifting on the road', () => {
    const m = new SkidMarks({ capacity: 256 });
    const st = {};
    const k = kart({ drifting: true, driftLevel: 1 });
    let added = 0;
    for (let z = 0; z <= 10; z += 0.25) {
      k.position.z = z;
      added += trackSkids(st, k, m, 0);
    }
    const expected = 2 * Math.floor(10 / SKID.spacing);
    expect(added).toBeGreaterThanOrEqual(expected - 2);
    expect(added).toBeLessThanOrEqual(expected + 2);
    // colour = the level's pastel
    const c = new THREE.Color(SKID_COLORS[1]);
    expect(m._color.getX(0)).toBeCloseTo(c.r, 5);
  });

  it('no marks when not drifting, in the air, off-road or crawling; a teleport restarts the track', () => {
    const m = new SkidMarks({ capacity: 64 });
    const cases = [
      kart({ drifting: false }), kart({ drifting: true, phys: { hopY: 0.2, groundY: 0 } }),
      kart({ drifting: true, offRoad: true }), kart({ drifting: true, speed: 1 }),
    ];
    for (const k of cases) {
      const st = {};
      for (let z = 0; z < 5; z += 0.25) { k.position.z = z; trackSkids(st, k, m); }
    }
    expect(m.total).toBe(0);
    const st = {};
    const k = kart({ drifting: true });
    trackSkids(st, k, m);
    k.position.z = 50; // wrapped / teleported
    expect(trackSkids(st, k, m)).toBe(0);
  });

  it('rainbow level marks get a rainbow tint', () => {
    const m = new SkidMarks({ capacity: 16 });
    const st = {};
    const k = kart({ drifting: true, driftLevel: 3 });
    for (let z = 0; z < 3; z += 0.25) { k.position.z = z; trackSkids(st, k, m, 1.3); }
    expect(m.total).toBeGreaterThan(0);
    const r = m._color.getX(0), g = m._color.getY(0), b = m._color.getZ(0);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(0.05); // not plain white
  });
});

describe('puffs', () => {
  it('spawn, rise, fade and recycle', () => {
    const p = new PuffPool({ capacity: 4 });
    for (let i = 0; i < 6; i++) p.spawn({ x: 0, y: 0, z: 0, vy: 1 });
    expect(p.alive).toBe(4);
    p.update(0.1);
    expect(p.items[0].y).toBeGreaterThan(0);
    expect(p._alpha.array[0]).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) p.update(0.1);
    expect(p.alive).toBe(0);
    expect(Array.from(p._alpha.array).every((a) => a === 0)).toBe(true);
    expect(finiteArr(p.mesh.instanceMatrix.array)).toBe(true);
    expect(p.spawn({ x: NaN, y: 0, z: 0 })).toBe(-1);
    p.dispose();
  });

  it('off-road puff rate: only off the road, on the ground and moving; faster = more', () => {
    expect(offRoadPuffRate(kart())).toBe(0);
    expect(offRoadPuffRate(kart({ offRoad: true, speed: 2 }))).toBe(0);
    expect(offRoadPuffRate(kart({ offRoad: true, phys: { hopY: 0.3 } }))).toBe(0);
    expect(offRoadPuffRate(kart({ offRoad: true, starPower: 3 }))).toBe(0); // star = no grass slow-down
    expect(offRoadPuffRate(kart({ offRoad: true, speed: 30 }))).toBeGreaterThan(offRoadPuffRate(kart({ offRoad: true, speed: 10 })));
    expect(offRoadPuffRate(kart({ offRoad: true, speed: 30 }))).toBeLessThanOrEqual(PUFF.rate * 1.2);
    expect(offRoadPuffRate(null)).toBe(0);
  });

  it('every surface has two puff tints', () => {
    for (const tints of Object.values(PUFF_COLORS)) expect(tints).toHaveLength(2);
  });
});

describe('driving FX set', () => {
  it('adds one group to the scene, animates 8 karts cheaply and cleans up', () => {
    const scene = new THREE.Scene();
    const fx = createDrivingFx(scene, { surface: 'snow' });
    expect(scene.children).toContain(fx.group);
    expect(fx.group.children).toHaveLength(3); // 3 draw calls per view for everything
    const karts = Array.from({ length: 8 }, (_, i) => kart({ drifting: i % 2 === 0, offRoad: i % 2 === 1, driftLevel: i % 4, position: new THREE.Vector3(i * 5, 0, 0) }));
    const t0 = performance.now();
    for (let f = 0; f < 600; f++) {
      for (const k of karts) { k.position.z += 0.5; k.heading = Math.sin(f * 0.02) * 0.3; }
      fx.update(1 / 60, karts);
      if (f % 50 === 0) fx.landPuff(karts[0], 0.6);
    }
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500); // generous for CI; typically a few ms per 100 frames
    expect(fx.skids.total).toBeGreaterThan(100);
    expect(fx.dust.alive).toBeGreaterThan(0);
    expect(finiteArr(fx.dust.mesh.instanceMatrix.array)).toBe(true);
    fx.dispose();
    expect(scene.children).not.toContain(fx.group);
  });

  it('the system builds FX at race-start, freezes on pause, and removes them on race-exit', () => {
    const bus = createEventBus({ onError: (err) => { throw err; } });
    const widgets = [];
    const off = drivingFx.install(bus, { hud: { addWidget: (w) => { widgets.push(w); return () => widgets.splice(widgets.indexOf(w), 1); } } });
    expect(widgets.map((w) => w.id)).toEqual(['drive-speed-lines']);
    const scene = new THREE.Scene();
    const k = kart({ drifting: true, driftLevel: 2 });
    const session = { scene, trackDef: { id: 'gumdrop-meadow' }, race: { karts: [k] }, paused: false };
    bus.emit('race-start', { trackId: 'gumdrop-meadow' }, session);
    const group = scene.getObjectByName('driving-fx');
    expect(group).toBeTruthy();
    for (let i = 0; i < 30; i++) { k.position.z += 0.5; bus.emit('race-frame', 1 / 60, session); }
    const skids = group.getObjectByName('skid-marks');
    const t = skids.material.uniforms.uTime.value;
    expect(t).toBeGreaterThan(0);
    session.paused = true;
    for (let i = 0; i < 30; i++) bus.emit('race-frame', 1 / 60, session);
    expect(skids.material.uniforms.uTime.value).toBe(t);
    bus.emit('race:land', { type: 'land', kart: k, strength: 0.5 }, session);
    bus.emit('race-exit', { outcome: 'menu' }, session);
    expect(scene.getObjectByName('driving-fx')).toBeUndefined();
    off();
    expect(widgets).toHaveLength(0);
  });

  it('is safe with no hud / no scene', () => {
    const bus = createEventBus({ onError: (err) => { throw err; } });
    const off = drivingFx.install(bus, {});
    expect(() => {
      bus.emit('race-start', {}, {});
      bus.emit('race-frame', 1 / 60, {});
      bus.emit('race:land', { kart: null }, {});
      bus.emit('race-exit', {}, {});
    }).not.toThrow();
    off();
  });
});

describe('drift sparks', () => {
  const rig = () => ({ root: new THREE.Group(), chassis: new THREE.Group(), driver: new THREE.Group(), head: new THREE.Group() });

  it('size grows per level and swells on a level-up pop', () => {
    for (let l = 1; l <= 3; l++) expect(sparkSize(l)).toBeGreaterThan(sparkSize(l - 1));
    expect(sparkSize(1, 1)).toBeGreaterThan(sparkSize(1, 0) * 1.5);
    expect(sparkSize(9)).toBe(sparkSize(3));
    for (let l = 1; l <= 3; l++) expect(SPARKS_PER_LEVEL[l]).toBeGreaterThanOrEqual(SPARKS_PER_LEVEL[l - 1]);
    expect(SPARKS_PER_LEVEL[3]).toBe(MAX_SPARKS);
    const h = rainbowHue(-3, 2);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  });

  it('shows dust at level 0, coloured wheel glows from level 1, pops on each level-up', () => {
    const r = rig();
    const owned = { geometries: [], materials: [] };
    const fx = driftSparks.build(r, owned);
    const upd = (lvl, frames = 3) => { for (let i = 0; i < frames; i++) fx.update(i / 60, 1 / 60, { speed: 20, drifting: true, driftLevel: lvl }, {}); };
    upd(0);
    expect(fx.root.visible).toBe(true);
    expect(fx.glows.every((g) => !g.visible)).toBe(true);
    // unused pooled sparks are hidden (scale 0)
    const m = new THREE.Matrix4();
    fx.sparks.getMatrixAt(MAX_SPARKS - 1, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).length()).toBe(0);
    upd(1, 1);
    expect(fx.pop).toBeGreaterThan(0.8);
    expect(fx.glows.every((g) => g.visible)).toBe(true);
    upd(1, Math.ceil(POP_TIME * 60) + 2);
    expect(fx.pop).toBe(0);
    upd(2, 1);
    expect(fx.pop).toBeGreaterThan(0.8);
    upd(3, 5);
    expect(fx.level).toBe(3);
    fx.update(1, 1 / 60, { speed: 20, drifting: false }, {});
    expect(fx.root.visible).toBe(false);
    expect(finiteArr(fx.sparks.instanceMatrix.array)).toBe(true);
    fx.dispose();
    for (const x of owned.materials) x.dispose();
  });
});

describe('speed lines', () => {
  it('only a hint at top speed, clear when boosting, none when twirling or finished', () => {
    expect(speedLinesTarget(kart({ speed: 20 }))).toBe(0);
    expect(speedLinesTarget(kart({ speed: 33 }))).toBeGreaterThan(0.3);
    expect(speedLinesTarget(kart({ speed: 33 }))).toBeLessThan(0.5);
    expect(speedLinesTarget(kart({ speed: 40, boosting: true }))).toBeGreaterThan(0.6);
    expect(speedLinesTarget(kart({ speed: 10, starPower: 2 }))).toBeGreaterThanOrEqual(0.75);
    expect(speedLinesTarget(kart({ speed: 40, boosting: true, spinning: true }))).toBe(0);
    expect(speedLinesTarget(kart({ speed: 40, boosting: true, finished: true }))).toBe(0);
    expect(speedLinesTarget(null)).toBe(0);
    expect(speedLinesTarget(kart({ speed: NaN }))).toBe(0);
    expect(SPEED_LINES_MAX_OPACITY).toBeLessThanOrEqual(0.6);
  });

  it('eases in quickly and out gently', () => {
    let v = 0;
    for (let i = 0; i < 12; i++) v = easeSpeedLines(v, 1, 1 / 60);
    expect(v).toBeGreaterThan(0.8);
    let w = 1;
    for (let i = 0; i < 12; i++) w = easeSpeedLines(w, 0, 1 / 60);
    expect(w).toBeGreaterThan(0.4);
    expect(easeSpeedLines(0.5, 1, NaN)).toBe(0.5);
  });

  it('the widget is a no-op without a DOM (node)', () => {
    const inst = speedLines.create(null, 0, null);
    expect(() => { inst.update(kart(), { state: 'racing' }, 1); inst.reset(); inst.destroy(); }).not.toThrow();
  });
});
