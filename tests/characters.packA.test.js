/**
 * Character pack A: Bruno Bananas, Shelly Macaroon, Peekaberry, Twiggy Licorice,
 * Captain Crumbs and Baby Bonbon (src/characters/pack-a.js).
 *
 * The shared contract tests (characters, charactersModels, registries,
 * kartEffects) already run over these racers; this file adds pack-specific
 * checks: lineup agreement, balance vs the original cast, the draw-call /
 * triangle budget, every personality animation, NaN-safety and disposal.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import PACK_A from '../src/characters/pack-a.js';
import { CHARACTERS, CHARACTER_PACKS, getCharacter, getCharacterEntry, getSelectableCharacters } from '../src/characters/index.js';
import { buildKartModel } from '../src/characters/model.js';
import { FX } from '../src/characters/parts.js';
import { LINEUP_CHARACTERS, lineupCharacter } from '../src/content/lineup.js';
import { isValidUnlockRule, STAT_KEYS } from '../src/progress/schema.js';
import { describeUnlock, describeUnlockShort } from '../src/progress/describeUnlock.js';
import { isAvailable } from '../src/progress/access.js';
import { buildUtterance, VOICE_STYLES } from '../src/audio/voice.js';
import { pickCpuCharacters } from '../src/game/setup.js';

const IDS = ['bruno', 'shelly', 'peekaberry', 'twiggy', 'captain-crumbs', 'baby-bonbon'];
const DEFS = PACK_A.map((e) => e.def);
const ORIGINAL = CHARACTER_PACKS.find((p) => p.id === 'original').entries.map((e) => e.def);
const STAT_NAMES = ['speed', 'accel', 'handling', 'weight'];
const total = (d) => STAT_NAMES.reduce((n, k) => n + d.stats[k], 0);

/** Every combination of model state flags the Race can send, plus edge cases. */
const STATES = [
  {},
  { speed: 0, steer: 0 },
  { speed: 12, steer: 0.5 },
  { speed: 30, steer: 1, drifting: true, driftLevel: 1, driftDir: 1 },
  { speed: 28, steer: -1, drifting: true, driftLevel: 2, driftDir: -1 },
  { speed: 32, steer: -0.4, drifting: true, driftLevel: 3, boosting: true },
  { speed: 34, boosting: true },
  { speed: 10, spinning: true },
  { speed: 10, spinning: true, shielded: true },
  { speed: 20, shielded: true, star: true, boosting: true },
  { speed: 0, happy: true },
  { speed: -5, steer: 0.3, happy: true, spinning: true },
  { speed: 25, offRoad: true, hop: true },
  { speed: 1e6, steer: 50 },
  { speed: NaN, steer: NaN, driftLevel: NaN },
  { speed: Infinity, steer: -Infinity, time: Infinity },
];

function assertFinite(root, id) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    for (const v of o.matrixWorld.elements) expect(Number.isFinite(v), `${id}: ${o.name || o.type}`).toBe(true);
  });
}

function visibleBox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const b = new THREE.Box3();
  root.traverseVisible((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    o.geometry.computeBoundingBox();
    b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(b);
  });
  return box;
}

/** Meshes the character itself owns (not the shared effects from src/fx/). */
function ownMeshes(group) {
  const out = [];
  const walk = (o) => {
    if (o.userData?.kartFx) return;
    if (o.isMesh && o.geometry !== FX.shadow) out.push(o);
    for (const c of o.children) walk(c);
  };
  walk(group);
  return out;
}

const run = (m, frames, state, t0 = 0) => {
  for (let i = 0; i < frames; i++) m.update(1 / 60, { ...state, time: t0 + i / 60 });
};
const worldY = (o) => o.getWorldPosition(new THREE.Vector3()).y;
const part = (m, name) => {
  const o = m.group.getObjectByName(name);
  expect(o, name).toBeTruthy();
  return o;
};

// Budget taken from the original cast (so the pack costs the same to draw).
const ORIGINAL_BUDGET = (() => {
  let tris = 0;
  let meshes = 0;
  for (const d of ORIGINAL) {
    const m = buildKartModel(d);
    tris = Math.max(tris, m.triangles);
    meshes = Math.max(meshes, ownMeshes(m.group).length);
    m.dispose();
  }
  return { tris, meshes };
})();

describe('pack A registry', () => {
  it('lists exactly the six pack A racers in lineup order', () => {
    expect(DEFS.map((d) => d.id)).toEqual(IDS);
    expect(LINEUP_CHARACTERS.filter((c) => c.pack === 'a').map((c) => c.id)).toEqual(IDS);
  });

  it('is registered after the original cast, with builders', () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(ids.slice(9, 15)).toEqual(IDS);
    for (const id of IDS) {
      const entry = getCharacterEntry(id);
      expect(entry, id).toBeTruthy();
      expect(typeof entry.build, id).toBe('function');
      expect(getCharacter(id).pack).toBe('a');
      expect(entry.def).toBe(getCharacter(id));
    }
  });

  it('every module default-exports { def, build } and names its own file id', async () => {
    for (const id of IDS) {
      const mod = await import(`../src/characters/${id}.js`);
      expect(mod.default.def).toBe(mod.def);
      expect(mod.default.build).toBe(mod.build);
      expect(mod.def.id).toBe(id);
    }
  });
});

describe('pack A matches the binding lineup', () => {
  it.each(IDS)('%s: name, pack and unlock rule are exactly the lineup ones', (id) => {
    const plan = lineupCharacter(id);
    const d = getCharacter(id);
    expect(d.name).toBe(plan.name);
    expect(d.pack).toBe(plan.pack);
    expect(d.unlock).toEqual(plan.unlock);
    expect(d.locked).toBe(true);
    expect(isValidUnlockRule(d.unlock)).toBe(true);
    if (d.unlock.type === 'stat') expect(STAT_KEYS).toContain(d.unlock.stat);
    expect(describeUnlock(d.unlock)).toMatch(/to unlock!$/);
    expect(describeUnlock(d.unlock)).not.toBe('Keep racing to unlock!');
    expect(describeUnlockShort(d.unlock).length).toBeGreaterThan(2);
  });

  it('spells out the concept of each racer in their personality', () => {
    const concept = {
      bruno: [/gorilla/i, /banana/i, /lavender/i, /sprinkle scarf/i, /waffle-cone/i],
      shelly: [/turtle/i, /macaron/i],
      'peekaberry': [/blueberry/i, /ghost/i, /see-through/i, /shy/i],
      twiggy: [/licorice/i, /tall/i, /top hat/i, /pose/i],
      'captain-crumbs': [/cookie/i, /pirate/i, /chocolate-chip beard/i, /Arr-some/],
      'baby-bonbon': [/baby/i, /bonbon/i, /stroller/i, /giggl/i],
    };
    for (const id of IDS) {
      const d = getCharacter(id);
      const text = `${d.name} ${d.tagline} ${d.personality}`;
      for (const re of concept[id]) expect(text, `${id} ${re}`).toMatch(re);
    }
    expect(Object.values(getCharacter('captain-crumbs').quotes).join(' ') + getCharacter('captain-crumbs').tagline).toMatch(/Arr-some!/);
  });

  it('stays locked until earned, and then races (menus + CPU fill)', () => {
    const none = getSelectableCharacters(() => false).map((c) => c.id);
    for (const id of IDS) expect(none).not.toContain(id);
    const all = getSelectableCharacters(() => true);
    for (const id of IDS) {
      expect(all.map((c) => c.id)).toContain(id);
      expect(isAvailable(getCharacter(id), () => false)).toBe(false);
      expect(isAvailable(getCharacter(id), (x) => x === id)).toBe(true);
    }
    // CPUs are drawn from the selectable list, so earned pack A racers show up on the grid
    const cpus = pickCpuCharacters(['rocco'], all, 7, () => 0.99);
    expect(cpus).toHaveLength(7);
    for (const id of cpus) expect(getCharacter(id)).toBeTruthy();
  });
});

describe('pack A stats are balanced against the originals', () => {
  it('uses whole numbers 1..5 with the same total as the free original racers', () => {
    const freeTotals = ORIGINAL.filter((d) => !d.locked).map(total);
    const lo = Math.min(...freeTotals);
    const hi = Math.max(...freeTotals);
    for (const d of DEFS) {
      for (const k of STAT_NAMES) {
        expect(Number.isInteger(d.stats[k]), `${d.id}.${k}`).toBe(true);
        expect(d.stats[k]).toBeGreaterThanOrEqual(1);
        expect(d.stats[k]).toBeLessThanOrEqual(5);
      }
      expect(total(d), d.id).toBeGreaterThanOrEqual(lo);
      expect(total(d), d.id).toBeLessThanOrEqual(hi);
    }
  });

  it('keeps each stat on average within half a point of the original cast (no power creep)', () => {
    for (const k of STAT_NAMES) {
      const avg = (list) => list.reduce((n, d) => n + d.stats[k], 0) / list.length;
      expect(Math.abs(avg(DEFS) - avg(ORIGINAL)), k).toBeLessThanOrEqual(0.5);
    }
  });

  it('gives every pack A racer a different driving style, with trade-offs', () => {
    const lines = DEFS.map((d) => STAT_NAMES.map((k) => d.stats[k]).join(','));
    expect(new Set(lines).size).toBe(lines.length);
    for (const d of DEFS) {
      // nobody is best at everything: at least one stat at 2 or lower
      expect(Math.min(...STAT_NAMES.map((k) => d.stats[k])), d.id).toBeLessThanOrEqual(2);
    }
  });

  it('matches the personalities (speedy turtle, heavy gorilla + pirate, zippy baby)', () => {
    const s = (id) => getCharacter(id).stats;
    expect(s('shelly').speed).toBe(5);
    expect(s('bruno').weight).toBeGreaterThanOrEqual(4);
    expect(s('captain-crumbs').weight).toBeGreaterThanOrEqual(4);
    expect(s('baby-bonbon').accel).toBe(5);
    expect(s('peekaberry').weight).toBe(1);
  });
});

describe('pack A voices, words and colours', () => {
  it('has valid, distinct voices that make real utterances for every kind', () => {
    const seen = new Set();
    for (const d of DEFS) {
      expect(VOICE_STYLES).toContain(d.voice.style);
      expect(d.voice.pitch).toBeGreaterThanOrEqual(0.5);
      expect(d.voice.pitch).toBeLessThanOrEqual(2);
      seen.add(`${d.voice.style}@${d.voice.pitch}`);
      for (const kind of ['select', 'yay', 'oops', 'win']) {
        const u = buildUtterance(d.voice, kind, 7);
        expect(u.style).toBe(d.voice.style);
        expect(u.syllables.length).toBeGreaterThan(0);
        expect(Number.isFinite(u.duration)).toBe(true);
      }
    }
    expect(seen.size).toBe(DEFS.length);
    // big fellas talk low, the baby and the ghost talk high
    expect(getCharacter('bruno').voice.pitch).toBeLessThan(0.8);
    expect(getCharacter('baby-bonbon').voice.pitch).toBeGreaterThan(1.7);
    expect(getCharacter('peekaberry').voice.style).toBe('giggle');
  });

  it('has taglines, personality, emoji, pronoun and all three quotes', () => {
    for (const d of DEFS) {
      expect(d.tagline.length, d.id).toBeGreaterThan(10);
      expect(d.personality.length, d.id).toBeGreaterThan(60);
      expect(d.emoji.length).toBeGreaterThan(0);
      expect(['she', 'he', 'they']).toContain(d.pronoun);
      for (const k of ['select', 'win', 'oops']) {
        expect(typeof d.quotes[k]).toBe('string');
        expect(d.quotes[k].length, `${d.id}.${k}`).toBeGreaterThan(5);
        expect(d.quotes[k].length, `${d.id}.${k}`).toBeLessThan(60); // fits a speech bubble
      }
    }
    const quotes = DEFS.flatMap((d) => Object.values(d.quotes));
    expect(new Set(quotes).size).toBe(quotes.length);
  });

  it('uses friendly, kid-safe, original words only', () => {
    const banned = /\b(hit|hits|kill|killed|destroy|destroyed|die|dies|dead|attack|hate|stupid|weapon|crash|crashed|scary|skull|blood|fight|punch|sword|cannon|gun|shoot)\b/i;
    const borrowed = /\b(mario|luigi|peach|bowser|yoshi|toad|koopa|donkey kong|diddy|boo|shy guy|wario|waluigi|nintendo|rosalina|daisy|boo berry|count chocula|franken berry)\b/i;
    for (const d of DEFS) {
      const text = [d.name, d.tagline, d.personality, ...Object.values(d.quotes)].join(' ');
      expect(text, d.id).not.toMatch(banned);
      // peek-a-boo is an everyday nursery word; nothing else may borrow a trademark
      expect(text.replace(/Peek-a-boo/gi, ''), d.id).not.toMatch(borrowed);
      expect(d.emoji).not.toMatch(/☠|💀/u);
    }
  });

  it('is recognisable by colour: primary + kart colours differ from everyone else', () => {
    const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
    for (const d of DEFS) {
      for (const o of CHARACTERS) {
        if (o.id === d.id) continue;
        const combined = dist(d.colors.primary, o.colors.primary) + dist(d.colors.kart, o.colors.kart);
        expect(combined, `${d.id} vs ${o.id}`).toBeGreaterThan(90);
      }
      for (const k of ['primary', 'secondary', 'accent', 'kart']) {
        expect(Number.isInteger(d.colors[k])).toBe(true);
        expect(d.colors[k]).toBeGreaterThanOrEqual(0);
        expect(d.colors[k]).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('only tall racers nudge the chase camera, and gently', () => {
    for (const d of DEFS) {
      if (!d.camera) continue;
      expect(d.camera.height).toBeGreaterThanOrEqual(0);
      expect(d.camera.height).toBeLessThanOrEqual(0.8);
      expect(Math.abs(d.camera.lookHeight ?? 0)).toBeLessThanOrEqual(0.3);
    }
    expect(getCharacter('twiggy').camera.height).toBeGreaterThanOrEqual(0.5); // dramatically tall
  });
});

describe('pack A models', () => {
  it.each(IDS)('%s builds kart-sized, on the ground, within the original budget', (id) => {
    const m = buildKartModel(getCharacter(id));
    expect(m.characterId).toBe(id);
    expect(m.head).toBeInstanceOf(THREE.Object3D);
    const box = visibleBox(m.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(1.9);
    expect(size.z).toBeLessThan(3.0);
    expect(size.x).toBeGreaterThan(1.3);
    expect(size.x).toBeLessThan(2.4);
    expect(box.min.y).toBeGreaterThan(-0.05);
    expect(box.min.y).toBeLessThan(0.1);
    expect(box.max.y).toBeLessThan(3.2);
    expect(m.head.getWorldPosition(new THREE.Vector3()).z).toBeLessThan(0.2);
    // chibi: a big head, up top
    expect(worldY(m.head)).toBeGreaterThan(1.3);
    // same cost to draw as the originals (8 karts x up to 4 viewports)
    expect(m.triangles).toBeGreaterThan(5000);
    expect(m.triangles).toBeLessThanOrEqual(ORIGINAL_BUDGET.tris * 1.02);
    expect(ownMeshes(m.group).length).toBeLessThanOrEqual(ORIGINAL_BUDGET.meshes);
    m.dispose();
  });

  it.each(IDS)('%s uses only toon / basic materials, all shared (no per-kart leaks)', (id) => {
    const a = buildKartModel(getCharacter(id));
    const b = buildKartModel(getCharacter(id));
    const ma = ownMeshes(a.group).map((o) => o.material);
    const mb = ownMeshes(b.group).map((o) => o.material);
    expect(ma.length).toBe(mb.length);
    ma.forEach((mat, i) => {
      expect(mat.isMeshToonMaterial || mat.isMeshBasicMaterial, `${id} material ${mat.type}`).toBe(true);
      expect(mat, `${id} mesh ${i}`).toBe(mb[i]);
    });
    a.dispose();
    b.dispose();
  });

  it.each(IDS)('%s has the classic face: blinking big eyes, happy eyes and a head', (id) => {
    const m = buildKartModel(getCharacter(id));
    // the eyes group blinks (scale.y dips) at some point within a few seconds
    let blinked = false;
    let happy = false;
    for (let i = 0; i < 60 * 8; i++) {
      m.update(1 / 60, { speed: 5, time: i / 60 });
      m.head.traverse((o) => { if (o.isGroup && Math.abs(o.scale.y - 0.12) < 1e-6) blinked = true; });
    }
    expect(blinked, `${id} blinks`).toBe(true);
    // happy ^ ^ eyes replace the open eyes while celebrating
    m.update(1 / 60, { speed: 0, happy: true, time: 20 });
    m.head.traverse((o) => { if (o.isGroup && o.visible && o !== m.head && o.children.length && o.userData.kartFx === undefined) happy = true; });
    expect(happy).toBe(true);
    // shiny eye highlights: white unlit spheres on the head
    let shines = 0;
    m.head.traverse((o) => { if (o.isMesh && o.material.isMeshBasicMaterial) shines++; });
    expect(shines).toBeGreaterThan(0);
    m.dispose();
  });

  it.each(IDS)('%s animates every state for a long time without NaNs', (id) => {
    const m = buildKartModel(getCharacter(id));
    let t = 0;
    for (let round = 0; round < 3; round++) {
      for (const s of STATES) {
        for (let i = 0; i < 45; i++) {
          m.update(1 / 60, { ...s, time: s.time ?? t });
          t += 1 / 60;
        }
      }
    }
    for (const dt of [0, -1, NaN, Infinity, 5, 1e-9]) m.update(dt, { speed: 20, steer: 0.5, boosting: true, time: t });
    m.update(1 / 60, undefined);
    m.update(1 / 60, null);
    assertFinite(m.group, id);
    // settles back facing forward after a happy twirl
    run(m, 30, { speed: 5, spinning: true });
    run(m, 180, { speed: 5 });
    const root = m.group.children.find((c) => c.isGroup);
    expect(root.rotation.y).toBeCloseTo(0, 5);
    m.dispose();
  });

  it.each(IDS)('%s disposes every geometry it built, once, and detaches', (id) => {
    const parent = new THREE.Group();
    const m = buildKartModel(getCharacter(id));
    parent.add(m.group);
    run(m, 30, { speed: 20, boosting: true, drifting: true, driftLevel: 2 });
    const geos = new Set(ownMeshes(m.group).map((o) => o.geometry));
    let disposed = 0;
    for (const g of geos) g.addEventListener('dispose', () => disposed++);
    m.dispose();
    expect(disposed).toBe(geos.size);
    expect(m.group.parent).toBe(null);
    m.dispose(); // idempotent
    expect(disposed).toBe(geos.size);
  });
});

describe('pack A personality animations', () => {
  it("Bruno's sprinkle scarf flutters with speed and flips up to boop his nose on boosts", () => {
    const m = buildKartModel(getCharacter('bruno'));
    const tie = part(m, 'bruno:scarf');
    const brow = part(m, 'bruno:brow');
    part(m, 'bruno:hat');
    run(m, 60, { speed: 0 });
    const rest = tie.rotation.x;
    const browRest = brow.position.y;
    expect(rest).toBeLessThan(0);
    expect(rest).toBeGreaterThan(-0.8); // lies on his tummy
    run(m, 60, { speed: 30 });
    const fast = tie.rotation.x;
    expect(fast).toBeLessThan(rest); // lifts off in the wind
    const samples = [];
    for (let i = 0; i < 30; i++) { m.update(1 / 60, { speed: 30, time: 10 + i / 60 }); samples.push(tie.rotation.z); }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.02); // flutters
    run(m, 60, { speed: 32, boosting: true });
    expect(tie.rotation.x).toBeLessThan(-1.8); // up in his face!
    expect(brow.position.y).toBeGreaterThan(browRest + 0.03); // surprised brows
    run(m, 90, { speed: 0 });
    expect(Math.abs(tie.rotation.x - rest)).toBeLessThan(0.15); // back on his tummy
    m.dispose();
  });

  it('Bruno is an original look: soft lavender fur (not brown), no necktie, a sprinkle scarf and a waffle-cone hat', () => {
    const d = getCharacter('bruno');
    const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    const [r, g, b] = rgb(d.colors.primary);
    expect(b).toBeGreaterThan(r); // cool lavender, not a warm brown
    expect(r + g + b).toBeGreaterThan(450); // light and soft
    const text = `${d.tagline} ${d.personality} ${Object.values(d.quotes).join(' ')}`;
    expect(text).not.toMatch(/neck ?tie|tie|brown/i);
    expect(lineupCharacter('bruno').concept).not.toMatch(/neck ?tie/i);
    const m = buildKartModel(d);
    const names = [];
    m.group.traverse((o) => { if (o.name) names.push(o.name); });
    expect(names).toContain('bruno:scarf');
    expect(names).toContain('bruno:hat');
    expect(names.some((n) => /tie/.test(n))).toBe(false);
    m.dispose();
  });

  it('Shelly tucks her head in on boosts and hides in her macaron shell when bonked', () => {
    const m = buildKartModel(getCharacter('shelly'));
    const neck = part(m, 'shelly:neck');
    part(m, 'shelly:shell');
    run(m, 60, { speed: 20 });
    const out = worldY(m.head);
    run(m, 60, { speed: 30, boosting: true });
    const tucked = worldY(m.head);
    expect(tucked).toBeLessThan(out - 0.1);
    run(m, 60, { speed: 5, spinning: true });
    const hidden = worldY(m.head);
    expect(hidden).toBeLessThan(tucked);
    expect(m.head.scale.x).toBeLessThan(0.95);
    run(m, 120, { speed: 20 });
    expect(worldY(m.head)).toBeCloseTo(out, 1);
    expect(neck.position.z).toBeCloseTo(0.02, 1);
    m.dispose();
  });

  it('Peekaberry blushes see-through when bonked and when she wins, then turns solid again', () => {
    const m = buildKartModel(getCharacter('peekaberry'));
    const solid = part(m, 'peekaberry:solid');
    const ghost = part(m, 'peekaberry:see-through');
    const blush = part(m, 'peekaberry:blush');
    const seeThroughMeshes = () => {
      const list = [];
      ghost.traverse((o) => { if (o.isMesh && o.material.transparent && o.material.opacity < 0.6) list.push(o); });
      return list;
    };
    expect(seeThroughMeshes().length).toBeGreaterThan(0);
    run(m, 30, { speed: 15 });
    expect(solid.visible).toBe(true);
    expect(ghost.visible).toBe(false);
    expect(blush.scale.x).toBeLessThan(0.1);
    run(m, 40, { speed: 10, spinning: true });
    expect(solid.visible).toBe(false);
    expect(ghost.visible).toBe(true);
    expect(blush.scale.x).toBeGreaterThan(0.8);
    // the see-through body really is drawn when visible
    let drawn = 0;
    m.group.traverseVisible((o) => { if (o.isMesh && o.material.transparent && o.material.opacity < 0.6) drawn++; });
    expect(drawn).toBeGreaterThan(0);
    run(m, 90, { speed: 15 });
    expect(solid.visible).toBe(true);
    expect(ghost.visible).toBe(false);
    run(m, 40, { speed: 0, happy: true });
    expect(ghost.visible).toBe(true);
    // she floats: the head bobs over the seat when idle
    const ys = [];
    for (let i = 0; i < 120; i++) { m.update(1 / 60, { speed: 0, time: i / 60 }); ys.push(worldY(m.head)); }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.05);
    m.dispose();
  });

  it('Twiggy strikes a pose on boosts: cane arm up, top hat tipped', () => {
    const m = buildKartModel(getCharacter('twiggy'));
    const arm = part(m, 'twiggy:show-arm');
    const hat = part(m, 'twiggy:hat');
    run(m, 60, { speed: 20 });
    const armRest = arm.rotation.x;
    const hatRest = hat.position.y;
    run(m, 60, { speed: 32, boosting: true });
    expect(arm.rotation.x).toBeLessThan(armRest - 1.5);
    expect(hat.position.y).toBeGreaterThan(hatRest + 0.15);
    // the hand really ends up above his head
    const hand = arm.localToWorld(new THREE.Vector3(-0.06, -0.37, 0.6));
    expect(hand.y).toBeGreaterThan(worldY(m.head));
    run(m, 90, { speed: 20 });
    expect(arm.rotation.x).toBeCloseTo(armRest, 0);
    m.dispose();
  });

  it('Captain Crumbs peeks through his spyglass now and then, and all the way on boosts', () => {
    const m = buildKartModel(getCharacter('captain-crumbs'));
    const spy = part(m, 'captain-crumbs:spyglass');
    const sail = part(m, 'captain-crumbs:sail');
    part(m, 'captain-crumbs:spyglass-arm');
    const atEye = () => {
      const head = m.head.getWorldPosition(new THREE.Vector3());
      const p = spy.getWorldPosition(new THREE.Vector3());
      return Math.abs(p.y - head.y) < 0.2 && p.z > head.z + 0.35;
    };
    const forward = () => new THREE.Vector3(0, 0, 1).transformDirection(spy.matrixWorld);
    // idle peeks come round every few seconds
    let peeked = false;
    let rested = false;
    for (let i = 0; i < 60 * 7; i++) {
      m.update(1 / 60, { speed: 10, time: i / 60 });
      m.group.updateMatrixWorld(true);
      if (atEye()) peeked = true;
      else rested = true;
    }
    expect(peeked).toBe(true);
    expect(rested).toBe(true);
    run(m, 60, { speed: 30, boosting: true }, 0.5);
    m.group.updateMatrixWorld(true);
    expect(atEye()).toBe(true);
    expect(forward().z).toBeGreaterThan(0.95); // looking straight down the road
    expect(spy.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(1.04, 1); // the spyglass never balloons
    // the sail billows more at speed
    run(m, 60, { speed: 0 }, 0.5);
    const calm = sail.scale.z;
    run(m, 60, { speed: 30 }, 0.5);
    expect(sail.scale.z).toBeGreaterThan(calm + 0.2);
    m.dispose();
  });

  it('Baby Bonbon giggle-bounces, sucks her pacifier and throws her arms up on boosts', () => {
    const m = buildKartModel(getCharacter('baby-bonbon'));
    const arms = [];
    m.group.traverse((o) => { if (o.name === 'baby-bonbon:arm') arms.push(o); });
    expect(arms).toHaveLength(2);
    const paci = part(m, 'baby-bonbon:pacifier');
    const scales = [];
    const heads = [];
    for (let i = 0; i < 90; i++) {
      m.update(1 / 60, { speed: 0, happy: true, time: i / 60 });
      scales.push(paci.scale.x);
      heads.push(m.head.position.y);
    }
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.1); // suck-suck
    expect(Math.max(...heads) - Math.min(...heads)).toBeGreaterThan(0.03); // giggle bounce
    run(m, 60, { speed: 20 });
    const rest = arms.map((a) => a.rotation.x);
    run(m, 60, { speed: 32, boosting: true });
    arms.forEach((a, i) => expect(a.rotation.x).toBeLessThan(rest[i] - 1.1)); // "Wheee!"
    // hands up high and out to the sides, clear of her big head
    const hy = worldY(m.head);
    for (const a of arms) {
      const hand = a.localToWorld(new THREE.Vector3(0, 0, 0.56));
      expect(hand.y).toBeGreaterThan(hy - 0.15);
      expect(hand.distanceTo(m.head.getWorldPosition(new THREE.Vector3()))).toBeGreaterThan(0.4);
    }
    run(m, 90, { speed: 20 });
    arms.forEach((a, i) => expect(a.rotation.x).toBeCloseTo(rest[i], 1));
    m.dispose();
  });
});
