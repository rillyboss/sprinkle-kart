import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race, aiDriveInput } from '../src/race/Race.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack } from '../src/render/trackBuilder.js';
import { rulesForMode } from '../src/modes/rules.js';
import { createBattleSession, BUBBLE_COLORS } from '../src/modes/battleSession.js';
import { ARENAS, getArena } from '../src/modes/arenas/index.js';
import { stubKartModel, kartProblems, defaultRacerIds } from './helpers/raceHarness.js';

const paths = new Map();
function arenaFixture(id) {
  const mod = getArena(id);
  if (!paths.has(id)) paths.set(id, new TrackPath(mod.def.controlPoints, mod.def.width));
  return { mod, def: mod.def, path: paths.get(id) };
}

/** A whole battle headlessly: CPUs (+ autodriven humans), real item boxes, the real controller. */
function runBattle(arenaId, { humans = 0, seed = 1, maxSeconds = 200, built = true, timeLimit, flashes = [], sfx = [], kidAssist = false } = {}) {
  const { mod, def, path } = arenaFixture(arenaId);
  const scene = new THREE.Scene();
  const builtTrack = built ? buildTrack(def, path, { module: mod }) : null;
  const participants = defaultRacerIds(8).map((characterId, i) => ({ characterId, playerIndex: i < humans ? i : null, easyDrive: i < humans && kidAssist }));
  const events = [];
  let ctrl = null;
  const race = new Race({
    scene, trackDef: def, path, builtTrack, participants, speedClass: 'zippy', buildKartModel: stubKartModel(), seed,
    rules: rulesForMode('battle'),
    onEvent: (e) => { events.push(e); ctrl?.onEvent(e); },
  });
  const hudEl = { classes: new Set(), classList: { add: (c) => hudEl.classes.add(c), remove: (c) => hudEl.classes.delete(c) } };
  const session = {
    isHuman: (k) => !!k && !k.isCPU,
    flash: (k, text) => flashes.push([k.playerIndex, text]),
    sfx: (name) => sfx.push(name),
    panFor: () => 0,
    rumble: () => {},
  };
  ctrl = createBattleSession({ race, scene, session, hud: { el: hudEl }, ...(timeLimit ? { timeLimit } : {}) });
  const problems = [];
  let wall = 0;
  const humanKarts = race.karts.filter((k) => !k.isCPU);
  while (race.state !== 'finished' && wall < maxSeconds) {
    const inputs = [];
    for (const k of humanKarts) inputs[k.playerIndex] = aiDriveInput(race, k, race.lastDt);
    race.update(1 / 30, inputs);
    ctrl.update(1 / 30);
    wall += 1 / 30;
    if (problems.length < 10) for (const k of race.karts) problems.push(...kartProblems(k, path));
  }
  return { race, ctrl, events, problems, scene, builtTrack, hudEl, def };
}

describe('Bubble Pop Battle session (headless, real arenas)', () => {
  for (const arena of ARENAS) {
    it(`${arena.def.id}: CPUs pop bubbles and the battle ends with a ranking`, () => {
      const flashes = [];
      const sfx = [];
      const r = runBattle(arena.def.id, { humans: 1, seed: 3, flashes, sfx });
      expect(r.race.state).toBe('finished');
      expect(r.problems).toEqual([]);
      const st = r.ctrl.state;
      expect(st.over).toBeTruthy();
      expect(['last', 'time', 'humans-out']).toContain(st.over.reason);
      // bubbles were popped by items (bonks), and every pop is logged
      const pops = r.ctrl.log.length;
      expect(pops).toBeGreaterThan(3);
      expect(r.events.filter((e) => e.type === 'bonked').length).toBeGreaterThanOrEqual(pops);
      const lost = st.racers.reduce((a, x) => a + x.popped, 0);
      expect(lost).toBe(pops);
      // no laps / finish events in a battle
      expect(r.events.some((e) => e.type === 'lap' || e.type === 'finish' || e.type === 'final-lap')).toBe(false);
      expect(r.events.filter((e) => e.type === 'race-complete').length).toBe(1);
      // the race finishing order is the battle ranking
      const order = r.race.getStandings().map((k) => k.id);
      const ranking = r.ctrl.state.racers.length;
      expect(order.length).toBe(ranking);
      const summary = r.ctrl.decorateSummary({ unlocks: [] });
      expect(summary.battle.ranking.map((x) => x.characterId)).toEqual(r.race.getStandings().map((k) => k.characterId));
      expect(summary.battle.ranking[0].place).toBe(1);
      expect(sfx).toContain('battle-pop');
      // out karts are flagged and hold nothing
      for (const k of r.race.karts) {
        const row = st.racers.find((x) => x.id === k.id);
        expect(!!k.battleOut).toBe(row.bubbles <= 0);
        if (k.battleOut) expect(k.item).toBe(null);
      }
      r.ctrl.dispose();
      r.race.dispose();
      r.builtTrack.dispose();
    });
  }

  it('the HUD model is published on race.modeInfo.battle and the HUD gets the battle class', () => {
    const r = runBattle('bubble-bath-bowl', { built: false, maxSeconds: 5 });
    const v = r.race.modeInfo.battle;
    expect(v.racers).toHaveLength(8);
    expect(v.clock).toMatch(/^\d:\d\d$/);
    expect(r.hudEl.classes.has('skb-battle')).toBe(true);
    r.ctrl.dispose();
    expect(r.hudEl.classes.has('skb-battle')).toBe(false);
    r.race.dispose();
  });

  it('a short timer ends the battle on time and keeps the most bubbles in front', () => {
    const r = runBattle('gumball-garden', { built: false, timeLimit: 12, maxSeconds: 40 });
    expect(r.race.state).toBe('finished');
    const summary = r.ctrl.decorateSummary({});
    const rows = summary.battle.ranking;
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].out && !rows[i - 1].out) expect(rows[i - 1].bubbles).toBeGreaterThanOrEqual(rows[i].bubbles);
    }
    r.ctrl.dispose();
    r.race.dispose();
  });

  it('without kart models the bubbles follow the karts by hand', () => {
    const { def, path } = arenaFixture('gumball-garden');
    const scene = new THREE.Scene();
    const race = new Race({ scene, trackDef: def, path, participants: defaultRacerIds(2).map((c) => ({ characterId: c, playerIndex: null })), seed: 5, rules: rulesForMode('battle') });
    const ctrl = createBattleSession({ race, scene });
    for (let i = 0; i < 90; i++) { race.update(1 / 30, []); ctrl.update(1 / 30); }
    const k = race.karts[1];
    const g = ctrl.root.getObjectByName(`battle-bubbles-${k.id}`);
    expect(g.position.x).toBeCloseTo(k.position.x, 5);
    expect(g.position.y).toBeGreaterThan(k.position.y + 1.5);
    ctrl.dispose();
    race.dispose();
  });

  it('Kid-Assist players float an extra bubble', () => {
    const r = runBattle('bubble-bath-bowl', { built: false, humans: 2, kidAssist: true, maxSeconds: 0.5 });
    const rows = r.ctrl.state.racers;
    expect(rows.filter((x) => !x.isCPU).every((x) => x.max === 4)).toBe(true);
    expect(rows.filter((x) => x.isCPU).every((x) => x.max === 3)).toBe(true);
    const group = r.scene.getObjectByName(`battle-bubbles-${rows[0].id}`);
    expect(group.children).toHaveLength(4);
    r.ctrl.dispose();
    r.race.dispose();
  });

  it('bubbles float over each kart, pop one at a time and all resources are freed', () => {
    const { def, path } = arenaFixture('bubble-bath-bowl');
    const scene = new THREE.Scene();
    const race = new Race({ scene, trackDef: def, path, participants: defaultRacerIds(4).map((c, i) => ({ characterId: c, playerIndex: i === 0 ? 0 : null })), buildKartModel: stubKartModel(), seed: 2, rules: rulesForMode('battle') });
    const flashes = [];
    const ctrl = createBattleSession({ race, scene, session: { isHuman: (k) => !k.isCPU, flash: (k, t) => flashes.push(t), sfx() {}, panFor: () => 0 } });
    expect(scene.getObjectByName('battle-bubbles')).toBeTruthy();
    for (let i = 0; i < 120; i++) { race.update(1 / 30, []); ctrl.update(1 / 30); }
    const me = race.karts[0];
    const cpu = race.karts[1];
    const group = scene.getObjectByName(`battle-bubbles-${me.id}`);
    expect(group.parent).toBe(me.model.group); // rides on the kart (hidden with it by the chase camera)
    scene.updateMatrixWorld(true);
    const wp = group.getWorldPosition(new THREE.Vector3());
    expect(wp.y).toBeGreaterThan(me.position.y + 1.5);
    expect(Math.hypot(wp.x - me.position.x, wp.z - me.position.z)).toBeLessThan(0.01);
    expect(group.children.filter((m) => m.visible)).toHaveLength(3);
    ctrl.onEvent({ type: 'bonked', kart: me, by: cpu, cause: 'gumdrop' });
    expect(ctrl.state.racers[0].bubbles).toBe(2);
    expect(ctrl.state.racers[1].pops).toBe(1);
    expect(flashes.at(-1)).toMatch(/2 bubbles left/);
    for (let i = 0; i < 12; i++) ctrl.update(1 / 30);
    expect(group.children.filter((m) => m.visible)).toHaveLength(2);
    // shields / dodges are not pops
    ctrl.onEvent({ type: 'shield-pop', kart: me, by: cpu });
    expect(ctrl.state.racers[0].bubbles).toBe(2);
    ctrl.onEvent({ type: 'bonked', kart: me, by: me, cause: 'gumdrop' }); // own gumdrop: pops, no credit
    expect(ctrl.state.racers[0].bubbles).toBe(1);
    expect(ctrl.state.racers[0].pops).toBe(0);
    ctrl.onEvent({ type: 'bonked', kart: me, by: cpu, cause: 'cupcake-rocket' });
    expect(me.battleOut).toBe(true);
    expect(flashes.at(-1)).toMatch(/Cheer them on/);
    ctrl.onEvent({ type: 'bonked', kart: me, by: cpu, cause: 'cupcake-rocket' }); // already out: ignored
    expect(ctrl.log).toHaveLength(3);
    // the only human is out: the battle wraps up after a short grace
    for (let i = 0; i < 120 && race.state !== 'finished'; i++) { race.update(1 / 30, []); ctrl.update(1 / 30); }
    expect(race.state).toBe('finished');
    expect(ctrl.state.over.reason).toBe('humans-out');
    expect(race.getStandings().at(-1)).toBe(me);
    const mats = new Set();
    const geos = new Set();
    scene.traverse((o) => { if (o.name.startsWith('battle-bubbles')) o.traverse((m) => { if (m.material) mats.add(m.material); if (m.geometry) geos.add(m.geometry); }); });
    expect(mats.size).toBeGreaterThan(1);
    let disposed = 0;
    for (const x of [...mats, ...geos]) x.addEventListener('dispose', () => { disposed++; });
    ctrl.dispose();
    expect(disposed).toBe(mats.size + geos.size);
    expect(scene.getObjectByName('battle-bubbles')).toBeFalsy();
    expect(scene.getObjectByName(`battle-bubbles-${me.id}`)).toBeFalsy();
    expect(race.itemRoller).toBe(null);
    race.dispose();
    expect(BUBBLE_COLORS.length).toBeGreaterThanOrEqual(4);
  });

  it('out karts get no item boxes and never bump anyone', () => {
    const { def, path } = arenaFixture('bubble-bath-bowl');
    const scene = new THREE.Scene();
    const race = new Race({ scene, trackDef: def, path, participants: defaultRacerIds(2).map((c) => ({ characterId: c, playerIndex: null })), buildKartModel: stubKartModel(), seed: 2, rules: rulesForMode('battle') });
    const ctrl = createBattleSession({ race, scene });
    const [a, b] = race.karts;
    for (let i = 0; i < 3; i++) ctrl.onEvent({ type: 'bonked', kart: a, by: b });
    expect(a.battleOut).toBe(true);
    // park them on top of each other: no push apart for a ghost
    b.position.copy(a.position);
    const before = a.position.clone();
    race._collideKarts();
    expect(a.position.distanceTo(before)).toBe(0);
    // box pickups skip out karts
    let broke = 0;
    const orig = race._onBoxBreak.bind(race);
    race._onBoxBreak = (k) => { if (k === a) broke++; orig(k); };
    for (let i = 0; i < 300; i++) race.update(1 / 30, []);
    expect(broke).toBe(0);
    ctrl.dispose();
    race.dispose();
  });
});
