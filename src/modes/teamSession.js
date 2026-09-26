/**
 * Team Race — the per-session controller main.js plugs into a race session
 * (`opts.controller`). It puts every kart on a team (src/modes/team.js),
 * makes team-mates friendly (their items and stars never bonk each other),
 * floats a little team badge over every kart (a pink heart for Team Sprinkle,
 * a blue star for Team Sparkle), keeps `race.modeInfo.team` fresh for the HUD,
 * scores the race into `summary.team` and shows the Team results screen.
 *
 * OWNER: showcase features & modes.
 */
import * as THREE from 'three';
import { heartShape, starShape, extruded } from '../tracks/geometry.js';
import { kartTopHeight } from './battleSession.js';
import { assignTeams, liveTeamScore, scoreTeamRace, teamSeriesAdd, createTeamSeries, teamInfo, HOME_TEAM } from './team.js';

export { createTeamSeries, teamSeriesAdd };

export const BADGE_HEIGHT = 3.0;

/**
 * @param {object} o
 * @param {import('../race/Race.js').Race} o.race
 * @param {THREE.Object3D} [o.scene]
 * @param {object} [o.session]     race session helpers (flash, sfx, isHuman)
 * @param {object} [o.series]      the running series (createTeamSeries())
 * @param {(series) => void} [o.onScored] called with the updated series once the race is scored
 */
export function createTeamSession({ race, scene = race?.scene, session = null, series = null, onScored = null } = {}) {
  const teams = assignTeams(race.karts.map((k) => ({ playerIndex: k.playerIndex, isCPU: k.isCPU })));
  race.karts.forEach((k, i) => { k.team = teams[i]; });
  race.friendly = (a, b) => !!a?.team && a.team === b?.team;
  let seriesNow = series || createTeamSeries();
  let scored = null;
  let lastLeader;

  // --- team badges -------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'team-badges';
  const heartGeo = extruded(heartShape(), 0.18, 0.05, 8);
  const starGeo = extruded(starShape(5, 0.55, 0.25), 0.18, 0.05, 4);
  const mats = {
    sprinkle: new THREE.MeshBasicMaterial({ color: teamInfo('sprinkle').hex }),
    sparkle: new THREE.MeshBasicMaterial({ color: teamInfo('sparkle').hex }),
    rim: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }),
  };
  const badges = race.karts.map((k) => {
    const g = new THREE.Group();
    g.name = `team-badge-${k.id}`;
    const geo = k.team === HOME_TEAM ? heartGeo : starGeo;
    const m = new THREE.Mesh(geo, mats[k.team]);
    const rim = new THREE.Mesh(geo, mats.rim);
    rim.scale.setScalar(1.18);
    g.add(m, rim);
    g.scale.setScalar(0.45);
    g.userData.team = k.team;
    // Ride on the kart model (hidden with it when it is right in front of a chase camera).
    const host = k.model?.group ?? null;
    const height = kartTopHeight(k, { min: BADGE_HEIGHT, max: 4.2, pad: 0.6 });
    (host ?? root).add(g);
    return { kart: k, group: g, host, height };
  });
  scene?.add?.(root);

  const publish = () => {
    const live = liveTeamScore(race.karts);
    race.modeInfo.team = { totals: live.totals, leader: live.winner, series: seriesNow };
    return live;
  };
  publish();

  // A cheerful "we're winning!" when the lead changes (humans only see their own flashes).
  const announce = (leader) => {
    if (leader === lastLeader) return;
    const first = lastLeader === undefined;
    lastLeader = leader;
    if (first || !leader || race.state !== 'racing') return;
    for (const k of race.karts) {
      if (k.isCPU || k.finished) continue;
      const text = leader === k.team ? `${teamInfo(leader).name} takes the lead! ${teamInfo(leader).emoji}` : `${teamInfo(leader).name} is ahead — catch up! 💨`;
      try { session?.flash?.(k, text); } catch { /* ignore */ }
    }
  };

  let acc = 0;
  function update(dt = 0) {
    const t = race.clock;
    for (const b of badges) {
      const bob = Math.sin(t * 2.4 + b.kart.id) * 0.12;
      if (b.host) b.group.position.set(0, b.height + bob, 0);
      else {
        const p = b.kart.position;
        b.group.position.set(p.x, p.y + b.height + bob, p.z);
      }
      b.group.rotation.y = t * 1.6 + b.kart.id;
    }
    acc += dt;
    if (acc >= 0.25) {
      acc = 0;
      const live = publish();
      if (race.state === 'racing' && race.time > 6) announce(live.winner);
    }
  }

  function onEvent(e) {
    if (e?.type === 'race-complete') publish();
  }

  /** summary.team (a TeamResult + the updated series) before 'race-end'. */
  function decorateSummary(summary) {
    if (!summary || typeof summary !== 'object') return summary;
    const standings = race.getStandings();
    const rows = (summary.standings || []).map((row, i) => ({ ...row, team: standings[i]?.team ?? null }));
    scored = scoreTeamRace(rows);
    seriesNow = teamSeriesAdd(series || createTeamSeries(), scored);
    summary.team = { ...scored, homeTeam: HOME_TEAM, series: seriesNow };
    try { onScored?.(seriesNow); } catch { /* ignore */ }
    if (scored.winner === HOME_TEAM) { try { session?.sfx?.('team-cheer'); } catch { /* ignore */ } }
    return summary;
  }

  function showResults({ menus, summary, trackDef, unlocks }) {
    if (!menus?.open) return null;
    return menus.open('team-results', { summary, team: summary?.team ?? null, trackDef, unlocks });
  }

  function dispose() {
    race.friendly = null;
    for (const b of badges) b.group.parent?.remove(b.group);
    root.parent?.remove(root);
    heartGeo.dispose();
    starGeo.dispose();
    Object.values(mats).forEach((m) => m.dispose());
  }

  return {
    kind: 'team',
    onEvent,
    update,
    decorateSummary,
    showResults,
    dispose,
    root,
    get teams() { return teams; },
    get result() { return scored; },
    get series() { return seriesNow; },
  };
}
