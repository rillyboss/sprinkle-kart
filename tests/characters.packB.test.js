/**
 * Character pack B: Luna Lollicorn, Bleep Bloop, Puff the Sprinkle Dragon,
 * Prince Ribbit, Marina Seashell and Lulu Lamb.
 *
 * Registry + lineup agreement, data quality (stats, voices, words), model
 * budgets and shape, NaN-free animation for every state, disposal, and each
 * racer's signature wiggle (toast pops, sneezes, slipping crown, bubbles, Zzz).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CHARACTER_PACKS, CHARACTER_REGISTRY_PROBLEMS, CHARACTERS, getCharacter, getCharacterEntry, getSelectableCharacters,
} from '../src/characters/index.js';
import PACK_B from '../src/characters/pack-b.js';
import { buildKartModel } from '../src/characters/model.js';
import { lineupCharacter, LINEUP_CHARACTERS } from '../src/content/lineup.js';
import { isValidUnlockRule } from '../src/progress/schema.js';
import { describeUnlock, describeUnlockShort } from '../src/progress/describeUnlock.js';
import { isAvailable } from '../src/progress/access.js';
import { buildUtterance, VOICE_STYLES, VOICE_KINDS } from '../src/audio/voice.js';
import { renderPortraits } from '../src/render/portraits.js';
import { DOZE_AFTER } from '../src/characters/lulu.js';

const IDS = ['luna', 'bleep', 'puff', 'prince-ribbit', 'marina', 'lulu'];
const DEFS = IDS.map((id) => getCharacter(id));

// The binding lineup, spelled out once more so a typo in lineup.js OR a racer is caught.
const EXPECTED = {
  luna: { name: 'Luna Lollicorn', unlock: { type: 'track', trackId: 'cotton-candy-castle', result: 'win' } },
  bleep: { name: 'Bleep Bloop', unlock: { type: 'stat', stat: 'timeTrialsFinished', count: 1 } },
  puff: { name: 'Puff the Sprinkle Dragon', unlock: { type: 'stat', stat: 'miniTurbos', count: 25 } },
  'prince-ribbit': { name: 'Prince Ribbit', unlock: { type: 'track', trackId: 'mermaid-lagoon', result: 'win' } },
  marina: { name: 'Marina Seashell', unlock: { type: 'distinct-tracks', result: 'finish', count: 8 } },
  lulu: { name: 'Lulu Lamb', unlock: { type: 'track', trackId: 'pillow-fort', result: 'finish' } },
};

const STATES = [
  {},
  { speed: 0, steer: 0, time: 0 },
  { speed: 30, steer: 1, drifting: true, driftLevel: 1, driftDir: 1, time: 1 },
  { speed: 28, steer: -1, drifting: true, driftLevel: 2, driftDir: -1, time: 2 },
  { speed: 32, steer: -0.4, drifting: true, driftLevel: 3, boosting: true, time: 3 },
  { speed: 10, steer: 0, spinning: true, shielded: true, time: 4 },
  { speed: -5, steer: 0.3, happy: true, time: 5 },
  { speed: 25, steer: 0.2, star: true, hop: 0.3, offRoad: true, time: 6 },
  { speed: 0, steer: 0, boosting: true, time: 7 },
];

const BANNED = /\b(hit|hits|kill|killed|killing|destroy|destroyed|die|dies|dead|attack|hate|stupid|weapon|crash|crashed|smash|punch|fight|shoot|explode)\b/i;
const BORROWED = /\b(mario|luigi|peach|bowser|yoshi|toad|rosalina|nintendo|daisy|wario|waluigi|koopa|kirby|pikachu|pokemon|sonic|ariel|disney|my little pony|twilight sparkle|rainbow dash|kermit)\b/i;

function run(m, secs, state, dt = 1 / 60) {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) m.update(dt, state);
}

function visibleBox(root, filter = () => true) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const b = new THREE.Box3();
  root.traverseVisible((o) => {
    if (!o.isMesh || o.isInstancedMesh || !filter(o)) return;
    o.geometry.computeBoundingBox();
    b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(b);
  });
  return box;
}

function assertFinite(root) {
  root.traverse((o) => {
    const vals = [...o.position.toArray(), o.rotation.x, o.rotation.y, o.rotation.z, ...o.scale.toArray()];
    for (const v of vals) expect(Number.isFinite(v), `${o.name || o.type} has a non-finite transform`).toBe(true);
  });
}

const node = (m, name) => {
  const o = m.group.getObjectByName(name);
  expect(o, `node ${name}`).toBeTruthy();
  return o;
};
const worldY = (o) => o.getWorldPosition(new THREE.Vector3()).y;

describe('pack B registry', () => {
  it('registers exactly the six pack B racers, in menu order, with no problems', () => {
    expect(CHARACTER_REGISTRY_PROBLEMS).toEqual([]);
    expect(PACK_B.map((e) => e.def.id)).toEqual(IDS);
    const pack = CHARACTER_PACKS.find((p) => p.id === 'b');
    expect(pack.entries.map((e) => e.def.id)).toEqual(IDS);
    for (const id of IDS) {
      expect(getCharacter(id), id).toBeTruthy();
      expect(getCharacterEntry(id).build, id).toBeTypeOf('function');
    }
    // pack B comes after the originals and pack A in the menu
    const idx = CHARACTERS.map((c) => c.id);
    expect(idx.indexOf('luna')).toBeGreaterThanOrEqual(9);
    expect(IDS.map((id) => idx.indexOf(id))).toEqual([...IDS.map((id) => idx.indexOf(id))].sort((a, b) => a - b));
  });

  it.each(IDS)('%s matches the binding lineup (name, pack, unlock rule)', (id) => {
    const def = getCharacter(id);
    const plan = lineupCharacter(id);
    expect(plan).toBeTruthy();
    expect(def.name).toBe(plan.name);
    expect(def.name).toBe(EXPECTED[id].name);
    expect(def.pack).toBe('b');
    expect(plan.pack).toBe('b');
    expect(def.unlock).toEqual(plan.unlock);
    expect(def.unlock).toEqual(EXPECTED[id].unlock);
    expect(isValidUnlockRule(def.unlock)).toBe(true);
    expect(def.locked).toBe(true);
  });

  it('covers every pack B racer in the lineup', () => {
    expect(LINEUP_CHARACTERS.filter((c) => c.pack === 'b').map((c) => c.id).sort()).toEqual([...IDS].sort());
  });

  it('stays hidden until earned, then becomes selectable', () => {
    const none = getSelectableCharacters(() => false).map((c) => c.id);
    for (const id of IDS) expect(none).not.toContain(id);
    const some = getSelectableCharacters((id) => id === 'puff').map((c) => c.id);
    expect(some).toContain('puff');
    expect(some).not.toContain('luna');
    for (const def of DEFS) {
      expect(isAvailable(def, () => false)).toBe(false);
      expect(isAvailable(def, (id) => id === def.id)).toBe(true);
    }
  });

  it('has friendly unlock hints for every rule', () => {
    for (const def of DEFS) {
      const hint = describeUnlock(def.unlock);
      expect(hint, def.id).toMatch(/to unlock!$/);
      expect(hint).not.toMatch(/Keep racing/); // a real, specific hint
      expect(describeUnlockShort(def.unlock).length).toBeGreaterThan(2);
      expect(hint).not.toMatch(BANNED);
    }
  });
});

describe('pack B data', () => {
  it.each(IDS)('%s has balanced whole-number stats (1..5, total 11..14)', (id) => {
    const { stats } = getCharacter(id);
    for (const k of ['speed', 'accel', 'handling', 'weight']) {
      expect(Number.isInteger(stats[k]), k).toBe(true);
      expect(stats[k]).toBeGreaterThanOrEqual(1);
      expect(stats[k]).toBeLessThanOrEqual(5);
    }
    const total = stats.speed + stats.accel + stats.handling + stats.weight;
    expect(total).toBeGreaterThanOrEqual(11);
    expect(total).toBeLessThanOrEqual(14);
  });

  it('keeps the pack fair: no racer is best at everything, totals stay close', () => {
    const totals = DEFS.map((d) => d.stats.speed + d.stats.accel + d.stats.handling + d.stats.weight);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
    for (const d of DEFS) expect(Object.values(d.stats).filter((v) => v === 5).length, d.id).toBeLessThanOrEqual(1);
    // everyone has a stat they shine in
    for (const d of DEFS) expect(Math.max(...Object.values(d.stats)), d.id).toBeGreaterThanOrEqual(4);
  });

  it('has valid voices that turn into real utterances, and no two racers sound the same', () => {
    const seen = new Set();
    for (const d of DEFS) {
      expect(VOICE_STYLES).toContain(d.voice.style);
      expect(d.voice.pitch).toBeGreaterThanOrEqual(0.5);
      expect(d.voice.pitch).toBeLessThanOrEqual(2);
      const key = `${d.voice.style}@${d.voice.pitch}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      for (const kind of VOICE_KINDS) {
        const utt = buildUtterance(d.voice, kind, 7);
        expect(utt, `${d.id} ${kind}`).toBeTruthy();
      }
    }
  });

  it('has names, taglines, personality, emoji, pronoun and all three quotes', () => {
    for (const d of DEFS) {
      expect(d.tagline.length, d.id).toBeGreaterThan(5);
      expect(d.personality.length, d.id).toBeGreaterThan(20);
      expect(d.emoji.length).toBeGreaterThan(0);
      expect(['she', 'he', 'they']).toContain(d.pronoun);
      for (const k of ['select', 'win', 'oops']) expect(d.quotes[k].length, `${d.id}.${k}`).toBeGreaterThan(3);
    }
    const lines = DEFS.flatMap((d) => [d.tagline, ...Object.values(d.quotes)]);
    expect(new Set(lines).size).toBe(lines.length); // nobody shares a line
  });

  it('uses friendly, kid-safe, original words only', () => {
    for (const d of DEFS) {
      const text = [d.name, d.tagline, d.personality, ...Object.values(d.quotes)].join(' ');
      expect(text, d.id).not.toMatch(BANNED);
      expect(text, d.id).not.toMatch(BORROWED);
    }
  });

  it('has valid, distinct colour schemes', () => {
    const combos = new Set();
    for (const d of DEFS) {
      for (const k of ['primary', 'secondary', 'accent', 'kart']) {
        expect(Number.isInteger(d.colors[k]), `${d.id}.${k}`).toBe(true);
        expect(d.colors[k]).toBeGreaterThanOrEqual(0);
        expect(d.colors[k]).toBeLessThanOrEqual(0xffffff);
      }
      combos.add(`${d.colors.primary}/${d.colors.kart}`);
    }
    expect(combos.size).toBe(DEFS.length);
    // kart colours differ from every other racer's kart in the pack
    expect(new Set(DEFS.map((d) => d.colors.kart)).size).toBe(DEFS.length);
  });

  it('keeps chase-camera nudges small and numeric', () => {
    for (const d of DEFS) {
      if (!d.camera) continue;
      for (const v of Object.values(d.camera)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThanOrEqual(0.6);
      }
    }
  });
});

describe('pack B models', () => {
  it.each(IDS)('%s builds a kart-sized, on-budget model like the originals', (id) => {
    const m = buildKartModel(getCharacter(id));
    expect(m.characterId).toBe(id);
    expect(m.head).toBeInstanceOf(THREE.Object3D);
    const box = visibleBox(m.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(1.9);
    expect(size.z).toBeLessThan(3.0);
    expect(size.x).toBeGreaterThan(1.3);
    expect(size.x).toBeLessThan(2.4);
    expect(size.y).toBeLessThan(3.2);
    expect(box.min.y).toBeGreaterThan(-0.05);
    expect(box.min.y).toBeLessThan(0.1);
    expect(m.head.getWorldPosition(new THREE.Vector3()).z).toBeLessThan(0.2);
    // chibi: the head sits up top (head centre in the upper half of the racer)
    expect(worldY(m.head)).toBeGreaterThan(size.y * 0.45);
    // budgets in line with the original nine (11.8k..18.4k tris, 36..49 meshes)
    expect(m.triangles).toBeGreaterThan(8000);
    expect(m.triangles).toBeLessThan(20000);
    let meshes = 0;
    m.group.traverse((o) => { if (o.isMesh) meshes++; });
    expect(meshes).toBeLessThanOrEqual(56);
    m.dispose();
  });

  it.each(IDS)('%s uses only toon / glow (+ outline) materials', (id) => {
    const m = buildKartModel(getCharacter(id));
    m.group.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) expect(mat.isMeshToonMaterial || mat.isMeshBasicMaterial, `${id}: ${mat.type}`).toBe(true);
    });
    m.dispose();
  });

  it.each(IDS)('%s animates every race state without NaNs (and survives bad input)', (id) => {
    const m = buildKartModel(getCharacter(id));
    for (let i = 0; i < 600; i++) m.update(1 / 60, STATES[Math.floor(i / 20) % STATES.length]);
    for (const s of STATES) {
      run(m, 1, s);
      assertFinite(m.group);
    }
    m.update(0, {});
    m.update(1 / 60, undefined);
    m.update(NaN, { speed: NaN, steer: NaN, time: NaN });
    m.update(-1, { speed: Infinity, steer: -Infinity });
    m.update(5, { speed: 20, boosting: true }); // huge dt is clamped
    for (let i = 0; i < 30; i++) m.update(1 / 30, { speed: 20, time: 1e6 + i }); // far-future race clock
    assertFinite(m.group);
    // it still fits the kart box after all that
    const size = visibleBox(m.group).getSize(new THREE.Vector3());
    expect(size.x).toBeLessThan(2.6);
    expect(size.z).toBeLessThan(3.4);
    m.dispose();
  });

  it.each(IDS)('%s disposes every geometry it owns, exactly once, and leaves the scene', (id) => {
    const scene = new THREE.Scene();
    const m = buildKartModel(getCharacter(id));
    scene.add(m.group);
    const geos = new Set();
    m.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) geos.add(o.geometry); });
    let disposed = 0;
    for (const g of geos) g.addEventListener('dispose', () => disposed++);
    m.update(1 / 60, { speed: 10, boosting: true });
    m.dispose();
    m.dispose(); // idempotent
    expect(m.group.parent).toBe(null);
    // everything but the shared effect geometries (shadow etc., never disposed) is freed once
    expect(disposed).toBeGreaterThan(20);
    expect(disposed).toBeLessThanOrEqual(geos.size);
  });

  it('two karts of the same racer are independent', () => {
    const a = buildKartModel(getCharacter('bleep'));
    const b = buildKartModel(getCharacter('bleep'));
    run(a, 0.3, { speed: 30, boosting: true });
    run(b, 0.3, { speed: 0 });
    expect(worldY(node(a, 'bleep-toast-0'))).toBeGreaterThan(worldY(node(b, 'bleep-toast-0')) + 0.2);
    a.dispose();
    b.dispose();
  });

  it('portraits skip gracefully without a DOM', async () => {
    const map = await renderPortraits(DEFS, 64, { framing: 'full' });
    expect(map.size).toBe(0);
  });
});

describe('pack B personality wiggles', () => {
  it('Luna: the mane ripples, a glint sweeps along it, the horn twinkles brighter on boosts', () => {
    const m = buildKartModel(getCharacter('luna'));
    const glint = node(m, 'luna-glint');
    const mane = node(m, 'luna-mane-0');
    const seenY = [];
    const seenRot = [];
    for (let i = 0; i < 180; i++) {
      m.update(1 / 60, { speed: 0, time: i / 60 });
      if (glint.scale.x > 0.1) seenY.push(glint.position.y);
      seenRot.push(mane.rotation.x);
    }
    expect(seenY.length).toBeGreaterThan(10);
    expect(Math.max(...seenY) - Math.min(...seenY)).toBeGreaterThan(0.3); // it travels down the mane
    expect(Math.max(...seenRot) - Math.min(...seenRot)).toBeGreaterThan(0.05);
    const star = node(m, 'luna-horn-star');
    run(m, 0.2, { speed: 0, time: 1 });
    const calm = star.scale.x;
    run(m, 0.2, { speed: 20, boosting: true, time: 1 });
    expect(star.scale.x).toBeGreaterThan(calm + 0.3);
    m.dispose();
  });

  it('Bleep: toast pops up (and flips) on a boost, then settles back in the slots', () => {
    const m = buildKartModel(getCharacter('bleep'));
    const t0 = node(m, 'bleep-toast-0');
    const t1 = node(m, 'bleep-toast-1');
    const lever = node(m, 'bleep-lever');
    run(m, 1, { speed: 10 });
    const rest = [t0.position.y, t1.position.y];
    const leverDown = lever.position.y;
    let peak = 0;
    let flipped = false;
    let leverUp = false;
    for (let i = 0; i < 30; i++) {
      m.update(1 / 60, { speed: 30, boosting: true });
      peak = Math.max(peak, t0.position.y - rest[0], t1.position.y - rest[1]);
      if (Math.abs(t0.children[0].rotation.x) > 0.5) flipped = true;
      if (lever.position.y > leverDown) leverUp = true;
    }
    expect(peak).toBeGreaterThan(0.3);
    expect(flipped).toBe(true);
    expect(leverUp).toBe(true);
    run(m, 2, { speed: 10 }); // boost over: back in the toaster
    expect(t0.position.y).toBeLessThan(rest[0] + 0.03);
    expect(t1.position.y).toBeLessThan(rest[1] + 0.03);
    expect(lever.position.y).toBeCloseTo(leverDown, 5);
    m.dispose();
  });

  it('Bleep: no toast pops while cruising without a boost', () => {
    const m = buildKartModel(getCharacter('bleep'));
    const t0 = node(m, 'bleep-toast-0');
    run(m, 0.5, { speed: 20 });
    const rest = t0.position.y;
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      m.update(1 / 60, { speed: 25, steer: Math.sin(i / 20), drifting: i > 100 });
      peak = Math.max(peak, t0.position.y - rest);
    }
    expect(peak).toBeLessThan(0.05);
    m.dispose();
  });

  it('Puff: sneezes sprinkles every few seconds, and instantly when she boosts', () => {
    const m = buildKartModel(getCharacter('puff'));
    const burst = node(m, 'puff-sneeze');
    expect(burst.scale.x).toBeLessThan(0.01); // not sneezing at the start
    let sneezes = 0;
    let wasOut = false;
    for (let i = 0; i < 60 * 12; i++) {
      m.update(1 / 60, { speed: 5 });
      const out = burst.scale.x > 0.2;
      if (out && !wasOut) sneezes++;
      wasOut = out;
    }
    expect(sneezes).toBeGreaterThanOrEqual(2);
    expect(sneezes).toBeLessThanOrEqual(3);
    // boost -> sneeze within half a second
    run(m, 1.5, { speed: 5 });
    let boosted = false;
    for (let i = 0; i < 30 && !boosted; i++) {
      m.update(1 / 60, { speed: 30, boosting: true });
      boosted = burst.scale.x > 0.2;
    }
    expect(boosted).toBe(true);
    // the sprinkles fly forward (out of her nose, ahead of the kart)
    run(m, 0.3, { speed: 30, boosting: true });
    expect(burst.position.z).toBeGreaterThan(0.8);
    m.dispose();
  });

  it('Prince Ribbit: the crown wobbles, slips over his eyes now and then, and always when he spins', () => {
    const m = buildKartModel(getCharacter('prince-ribbit'));
    const crown = node(m, 'ribbit-crown');
    const slip = node(m, 'ribbit-crown-slip');
    const wob = [];
    let slipped = 0;
    for (let i = 0; i < 60 * 8; i++) {
      m.update(1 / 60, { speed: 12 });
      wob.push(crown.rotation.z);
      slipped = Math.min(slipped, slip.position.y);
    }
    expect(Math.max(...wob) - Math.min(...wob)).toBeGreaterThan(0.1);
    expect(slipped).toBeLessThan(-0.15);
    // settles back up on his head
    let up = false;
    for (let i = 0; i < 60 * 7 && !up; i++) {
      m.update(1 / 60, { speed: 12 });
      up = slip.position.y > -0.01;
    }
    expect(up).toBe(true);
    run(m, 0.5, { speed: 10, spinning: true });
    expect(slip.position.y).toBeLessThan(-0.15);
    m.dispose();
  });

  it('Marina: the clam hovers (no wheels), blows bubbles and opens its lid on boosts', () => {
    const m = buildKartModel(getCharacter('marina'));
    const hull = node(m, 'marina-hull');
    // the shell itself floats clear of the ground (only the soft shadow touches it)
    const shell = visibleBox(hull);
    expect(shell.min.y).toBeGreaterThan(0.1);
    const streams = [];
    m.group.traverse((o) => { if (o.name === 'marina-bubbles') streams.push(o); });
    expect(streams.length).toBeGreaterThanOrEqual(4);
    const zs = [];
    for (let i = 0; i < 90; i++) {
      m.update(1 / 60, { speed: 20 });
      zs.push(streams[0].position.z);
    }
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.2); // bubbles stream backwards
    const lid = node(m, 'marina-lid');
    run(m, 1, { speed: 20 });
    const calm = lid.rotation.x;
    run(m, 1, { speed: 30, boosting: true });
    expect(lid.rotation.x).toBeLessThan(calm - 0.1);
    // the chassis bobs up and down on its bubbles
    const ys = [];
    for (let i = 0; i < 120; i++) {
      m.update(1 / 60, { speed: 0 });
      ys.push(hull.getWorldPosition(new THREE.Vector3()).y);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.03);
    m.dispose();
  });

  it('Lulu: dozes off with a Zzz and a nose bubble when idle, wakes up to drive, eyes wide on boosts', () => {
    const m = buildKartModel(getCharacter('lulu'));
    const zzz = node(m, 'lulu-zzz');
    const bubble = node(m, 'lulu-nose-bubble');
    const sleepy = node(m, 'lulu-sleepy-eyes');
    const lids = node(m, 'lulu-lids');
    run(m, 0.5, { speed: 20 });
    expect(zzz.visible).toBe(false);
    expect(lids.visible).toBe(true); // droopy eyelids while driving
    run(m, DOZE_AFTER * 0.5, { speed: 0 });
    expect(zzz.visible).toBe(false); // not asleep straight away
    run(m, DOZE_AFTER + 0.5, { speed: 0 });
    expect(zzz.visible).toBe(true);
    expect(bubble.visible).toBe(true);
    expect(sleepy.visible).toBe(true);
    expect(lids.visible).toBe(false); // eyes closed: no half-open lids either
    // the Zzz floats upward over time
    const y0 = zzz.position.y;
    run(m, 0.5, { speed: 0 });
    expect(zzz.position.y).not.toBeCloseTo(y0, 3);
    // a celebration wakes her up
    run(m, 0.2, { speed: 0, happy: true });
    expect(zzz.visible).toBe(false);
    // driving wakes her; boosting pops her eyes wide open (no droopy lids)
    run(m, 0.3, { speed: 20 });
    expect(zzz.visible).toBe(false);
    expect(sleepy.visible).toBe(false);
    run(m, 0.2, { speed: 30, boosting: true });
    expect(lids.visible).toBe(false);
    m.dispose();
  });
});
