/**
 * Bubble Pop Battle — the per-session controller main.js plugs into a race
 * session (`opts.controller`). It owns the battle state (src/modes/battle.js),
 * turns item bonks into popped bubbles, floats the bubbles over every kart,
 * keeps `race.modeInfo.battle` fresh for the HUD widget and ends the race with
 * the battle ranking (race.completeWith). Works headless (three.js only, no DOM).
 *
 *   const ctrl = createBattleSession({ race, scene, session, hud });
 *   ctrl.onEvent(e)          every Race event (main.js forwards them)
 *   ctrl.update(dt)          every frame (after race.update)
 *   ctrl.decorateSummary(s)  adds `summary.battle` before 'race-end'
 *   ctrl.dispose()
 *
 * OWNER: showcase features & modes.
 */
import * as THREE from 'three';
import {
  createBattle, battlePop, battleTick, battleRanking, battleView, battleItem, loopTargetAhead,
  BATTLE_TIME, timeLeft,
} from './battle.js';

/** Bubble colours (pastel rainbow, one per bubble slot). */
export const BUBBLE_COLORS = Object.freeze([0xff9ad5, 0x8fd8ff, 0xffe36b, 0x9ff0c0, 0xc9a8ff]);
/** Where the bubble ring floats above a kart. */
export const BUBBLE_HEIGHT = 2.25;
export const BUBBLE_RING = 0.95;
const BUBBLE_R = 0.3;
const POP_TIME = 0.22;

const nameOf = (k) => k?.charDef?.name || k?.name || 'Someone';

/**
 * How high above the kart's origin the top of its racer is (tall hats, ears
 * and hair included), so floating things clear the head. Falls back to `min`.
 */
export function kartTopHeight(kart, { min = BUBBLE_HEIGHT, max = 3.8, pad = 0.35 } = {}) {
  const g = kart?.model?.group;
  if (!g) return min;
  try {
    g.updateMatrixWorld(true);
    const all = new THREE.Box3();
    const box = new THREE.Box3();
    const skip = new Set();
    // visible racer + kart meshes only (kart effects such as the shield bubble are skipped)
    g.traverseVisible((o) => {
      if (o.userData?.kartFx || skip.has(o.parent)) { skip.add(o); return; }
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      all.union(box);
    });
    if (all.isEmpty() || !Number.isFinite(all.max.y)) return min;
    return Math.max(min, Math.min(max, all.max.y - g.position.y + pad));
  } catch {
    return min;
  }
}

/**
 * @param {object} o
 * @param {import('../race/Race.js').Race} o.race  a Race built with rulesForMode('battle')
 * @param {THREE.Object3D} [o.scene]               where the bubbles go (default race.scene)
 * @param {object} [o.session]                     race session helpers ({ flash, sfx, isHuman, panFor, rumble })
 * @param {object} [o.hud]                         Hud (gets the `skb-battle` class so laps / places hide)
 * @param {number} [o.timeLimit]
 * @param {number} [o.bubbles]
 */
export function createBattleSession({ race, scene = race?.scene, session = null, hud = null, timeLimit = BATTLE_TIME, bubbles } = {}) {
  const karts = race.karts;
  const byId = new Map(karts.map((k) => [k.id, k]));
  let state = createBattle(karts.map((k) => ({
    id: k.id, characterId: k.characterId, playerIndex: k.playerIndex, isCPU: k.isCPU, kidAssist: !!k.easyDrive,
  })), { timeLimit, ...(bubbles ? { bubbles } : {}) });
  let completed = false;
  let lastHurry = null;
  const log = []; // [{ t, kind, victim, by }] for tests / the results screen

  const isHuman = (k) => (session?.isHuman ? session.isHuman(k) : !!k && !k.isCPU);
  const flash = (k, text) => { if (isHuman(k)) { try { session?.flash?.(k, text); } catch { /* ignore */ } } };
  const sfx = (name, k) => { try { session?.sfx?.(name, { pan: k && session?.panFor ? session.panFor(k) : 0 }); } catch { /* ignore */ } };
  const rumble = (k, s, ms) => { try { session?.rumble?.(k, s, ms); } catch { /* ignore */ } };

  // --- race hooks: battle item odds + rockets that wrap round the loop -----
  race.itemRoller = (k, rng) => {
    const row = state.racers.find((r) => r.id === k.id);
    return battleItem(row?.bubbles ?? 3, row?.max ?? 3, rng);
  };
  race.rocketTarget = (k) => loopTargetAhead(k, race.karts, race.path.length);

  // --- bubbles over every kart ---------------------------------------------
  const root = new THREE.Group();
  root.name = 'battle-bubbles';
  const geo = new THREE.SphereGeometry(BUBBLE_R, 16, 12);
  const shineGeo = new THREE.SphereGeometry(BUBBLE_R * 0.28, 8, 6);
  const mats = BUBBLE_COLORS.map((c) => new THREE.MeshPhongMaterial({
    color: c, emissive: c, emissiveIntensity: 0.35, specular: 0xffffff, shininess: 80, transparent: true, opacity: 0.72, depthWrite: false,
  }));
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  const rigs = new Map(); // kart id -> { group, bubbles: [{ mesh, popT }] }
  for (const row of state.racers) {
    const group = new THREE.Group();
    group.name = `battle-bubbles-${row.id}`;
    const list = [];
    for (let i = 0; i < row.max; i++) {
      const mesh = new THREE.Mesh(geo, mats[i % mats.length]);
      const shine = new THREE.Mesh(shineGeo, shineMat);
      shine.position.set(-BUBBLE_R * 0.35, BUBBLE_R * 0.4, BUBBLE_R * 0.55);
      mesh.add(shine);
      mesh.renderOrder = 3;
      group.add(mesh);
      list.push({ mesh, popT: -1, growT: 1 });
    }
    // Ride on the kart model when there is one (so a chase camera's "hide the kart
    // right in front of me" also hides its bubbles); otherwise follow it by hand.
    const kart = byId.get(row.id);
    const host = kart?.model?.group ?? null;
    const height = kartTopHeight(kart);
    (host ?? root).add(group);
    rigs.set(row.id, { group, bubbles: list, host, height });
  }
  scene?.add?.(root);
  hud?.el?.classList?.add?.('skb-battle');

  const publish = () => { race.modeInfo.battle = battleView(state); };
  publish();

  function popVisual(kartId, leftAfter) {
    const rig = rigs.get(kartId);
    if (!rig) return;
    const b = rig.bubbles[leftAfter]; // bubbles pop from the last one down
    if (b && b.popT < 0) b.popT = 0;
    const k = byId.get(kartId);
    if (k && b) {
      const p = new THREE.Vector3();
      b.mesh.getWorldPosition(p);
      try { race.items?.bursts?.emit?.('bubble-pop', { x: p.x, y: p.y, z: p.z }, { scale: 1.3 }); } catch { /* fx only */ }
    }
  }

  function onEvent(e) {
    if (!e || e.type !== 'bonked' || completed || state.over) return;
    const victim = e.kart;
    if (!victim || victim.battleOut) return;
    const by = e.by && e.by !== victim ? e.by : null;
    const res = battlePop(state, victim.id, by ? by.id : null, race.time);
    if (res.result.kind === 'none') return;
    state = res.state;
    log.push({ t: race.time, kind: res.result.kind, victim: victim.id, by: by ? by.id : null });
    popVisual(victim.id, res.result.left);
    sfx('battle-pop', victim);
    rumble(victim, 0.6, 180);
    if (res.result.kind === 'out') {
      victim.battleOut = true;
      victim.item = null;
      victim.itemCharges = 0;
      victim.shielded = false;
      if (victim.phys) { victim.phys.rouletteTime = 0; victim.phys.pendingItem = null; }
      victim.itemRoulette = 0;
      sfx('battle-out', victim);
      flash(victim, 'Out of bubbles! Cheer them on 📣');
      if (by) flash(by, `You popped ${nameOf(victim)}'s last bubble! 🫧`);
    } else {
      const left = res.result.left;
      flash(victim, `Pop! ${left} bubble${left === 1 ? '' : 's'} left 🫧`);
    }
    if (res.result.bonus && by) {
      const rig = rigs.get(by.id);
      const b = rig?.bubbles[res.result.by.bubbles - 1];
      if (b) { b.popT = -1; b.growT = 0; }
      flash(by, 'Bubble bonus! +1 🫧');
      sfx('bubble', by);
    }
    publish();
  }

  function finish() {
    if (completed) return;
    completed = true;
    const ranking = battleRanking(state);
    const order = ranking.map((r) => byId.get(r.id)).filter(Boolean);
    const winners = ranking.filter((r) => r.place === 1);
    for (const w of winners) {
      const k = byId.get(w.id);
      flash(k, state.over?.reason === 'time' ? 'Time! Most bubbles wins! 🏆' : 'Last one bobbing! 🏆');
    }
    if (winners.some((w) => !w.isCPU)) sfx('battle-win', null);
    race.completeWith(order);
  }

  function update(dt = 0) {
    if (race.state === 'racing' && !completed) {
      const before = state;
      state = battleTick(state, race.time);
      if (state !== before) publish();
      const left = Math.ceil(timeLeft(state));
      if (left <= 10 && left > 0 && left !== lastHurry) { lastHurry = left; sfx('battle-hurry', null); }
      if (state.over) { publish(); finish(); }
    }
    // float + bob the bubbles
    const t = race.clock;
    for (const k of karts) {
      const rig = rigs.get(k.id);
      if (!rig) continue;
      const row = state.racers.find((r) => r.id === k.id);
      if (rig.host) {
        rig.group.position.set(0, rig.height, 0);
        rig.group.rotation.y = t * 0.9 + k.id;
      } else {
        const p = k.position;
        rig.group.position.set(p.x, p.y + rig.height, p.z);
        rig.group.rotation.y = (k.heading || 0) + t * 0.9 + k.id;
      }
      rig.group.visible = !k.battleOut || rig.bubbles.some((b) => b.popT >= 0 && b.popT < POP_TIME);
      const n = rig.bubbles.length;
      rig.bubbles.forEach((b, i) => {
        const a = (i / n) * Math.PI * 2;
        b.mesh.position.set(Math.cos(a) * BUBBLE_RING, Math.sin(t * 2.6 + i * 1.7 + k.id) * 0.16, Math.sin(a) * BUBBLE_RING);
        if (b.popT >= 0) {
          b.popT += dt;
          const f = Math.min(1, b.popT / POP_TIME);
          b.mesh.scale.setScalar(1 + f * 0.9);
          b.mesh.visible = f < 1;
        } else {
          const alive = row ? i < row.bubbles : true;
          b.mesh.visible = alive;
          b.growT = Math.min(1, b.growT + dt / 0.35);
          const grow = 0.2 + 0.8 * b.growT;
          const wob = 1 + Math.sin(t * 3.1 + i * 2.3) * 0.06;
          b.mesh.scale.set(wob * grow, grow / wob, wob * grow);
        }
      });
    }
  }

  /** summary.battle for 'race-end' (and the results screen). */
  function decorateSummary(summary) {
    if (!summary || typeof summary !== 'object') return summary;
    const ranking = battleRanking(state);
    const rows = ranking.map((r) => ({
      characterId: r.characterId, playerIndex: r.playerIndex, isCPU: r.isCPU, place: r.place,
      bubbles: r.bubbles, max: r.max, pops: r.pops, popped: r.popped, out: r.out,
    }));
    const humanWinners = rows.filter((r) => r.place === 1 && !r.isCPU);
    summary.battle = {
      reason: state.over?.reason ?? 'time',
      time: state.time,
      ranking: rows,
      winners: rows.filter((r) => r.place === 1).map((r) => ({ characterId: r.characterId, playerIndex: r.playerIndex, isCPU: r.isCPU })),
      humanWinner: humanWinners.length ? { playerIndex: humanWinners[0].playerIndex, characterId: humanWinners[0].characterId } : null,
      humanPops: rows.filter((r) => !r.isCPU).reduce((a, r) => a + r.pops, 0),
    };
    return summary;
  }

  function showResults({ menus, summary, trackDef, unlocks }) {
    if (!menus?.open) return null;
    return menus.open('battle-results', { summary, battle: summary?.battle ?? null, trackDef, unlocks });
  }

  function dispose() {
    race.itemRoller = null;
    race.rocketTarget = null;
    for (const rig of rigs.values()) rig.group.parent?.remove(rig.group);
    root.parent?.remove(root);
    geo.dispose();
    shineGeo.dispose();
    mats.forEach((m) => m.dispose());
    shineMat.dispose();
    hud?.el?.classList?.remove?.('skb-battle');
  }

  return {
    kind: 'battle',
    onEvent,
    update,
    decorateSummary,
    showResults,
    dispose,
    get state() { return state; },
    get log() { return log; },
    get completed() { return completed; },
    root,
  };
}
