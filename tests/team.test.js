import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  TEAMS, HOME_TEAM, AWAY_TEAM, teamInfo, assignTeams, placePoints, scoreTeamRace, liveTeamScore,
  createTeamSeries, teamSeriesAdd, teamResultText,
} from '../src/modes/team.js';
import { createTeamSession } from '../src/modes/teamSession.js';
import { Race, aiDriveInput } from '../src/race/Race.js';
import { rulesForMode } from '../src/modes/rules.js';
import { buildRaceSummary } from '../src/game/summary.js';
import { trackFixture, stubKartModel, defaultRacerIds, kartProblems } from './helpers/raceHarness.js';

const BAD_WORDS = /\b(hit|kill|crash|destroy|lose|loser)\b/i;
const P = (humans, cpus) => [
  ...Array.from({ length: humans }, (_, i) => ({ playerIndex: i, isCPU: false })),
  ...Array.from({ length: cpus }, () => ({ playerIndex: null, isCPU: true })),
];

describe('assignTeams', () => {
  it('humans all on Team Sprinkle, CPU buddies fill it to half the grid', () => {
    expect(assignTeams(P(1, 7))).toEqual(['sprinkle', 'sprinkle', 'sprinkle', 'sprinkle', 'sparkle', 'sparkle', 'sparkle', 'sparkle']);
    expect(assignTeams(P(2, 6)).filter((t) => t === HOME_TEAM)).toHaveLength(4);
    expect(assignTeams(P(4, 4))).toEqual([...Array(4).fill('sprinkle'), ...Array(4).fill('sparkle')]);
  });

  it('works for odd and tiny grids, and CPU-first orders', () => {
    expect(assignTeams(P(1, 4))).toEqual(['sprinkle', 'sprinkle', 'sprinkle', 'sparkle', 'sparkle']);
    expect(assignTeams(P(1, 0))).toEqual(['sprinkle']);
    expect(assignTeams([])).toEqual([]);
    expect(assignTeams()).toEqual([]);
    const cpuFirst = [{ playerIndex: null, isCPU: true }, { playerIndex: null, isCPU: true }, { playerIndex: 0 }, { playerIndex: null, isCPU: true }];
    expect(assignTeams(cpuFirst)).toEqual(['sprinkle', 'sparkle', 'sprinkle', 'sparkle']);
  });

  it('team info is friendly and complete', () => {
    expect(TEAMS.map((t) => t.id)).toEqual([HOME_TEAM, AWAY_TEAM]);
    expect(teamInfo('sparkle').name).toBe('Team Sparkle');
    expect(teamInfo('bogus')).toBe(TEAMS[0]);
    for (const t of TEAMS) expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('scoreTeamRace', () => {
  const rows = (teams) => teams.map((team, i) => ({ place: i + 1, team, characterId: `c${i}` }));

  it('adds Grand Prix points by place per team', () => {
    const r = scoreTeamRace(rows(['sprinkle', 'sparkle', 'sprinkle', 'sparkle', 'sprinkle', 'sparkle', 'sprinkle', 'sparkle']));
    expect(r.totals).toEqual({ sprinkle: 15 + 10 + 6 + 2, sparkle: 12 + 8 + 4 + 1 });
    expect(r.winner).toBe('sprinkle');
    expect(r.margin).toBe(33 - 25);
    expect(r.mvp.sprinkle.place).toBe(1);
    expect(r.mvp.sparkle.place).toBe(2);
    expect(r.rows.map((x) => x.points)).toEqual([15, 12, 10, 8, 6, 4, 2, 1]);
  });

  it('a tie has no winner; missing places fall back to the row order', () => {
    // 15+4+2+8 = 29 vs 12+10+6+1 = 29
    const r = scoreTeamRace(rows(['sprinkle', 'sparkle', 'sparkle', 'sprinkle', 'sparkle', 'sprinkle', 'sprinkle', 'sparkle']));
    expect(r.totals.sprinkle).toBe(r.totals.sparkle);
    expect(r.winner).toBe(null);
    const fallback = scoreTeamRace([{ team: 'sparkle' }, { team: 'sprinkle', place: 0 }]);
    expect(fallback.rows.map((x) => x.place)).toEqual([1, 2]);
    expect(fallback.winner).toBe('sparkle');
  });

  it('rows without a team score nothing; points stop after 8th', () => {
    const r = scoreTeamRace([{ place: 1, team: null }, { place: 9, team: 'sprinkle' }, { place: 2, team: 'sparkle' }]);
    expect(r.totals).toEqual({ sprinkle: 0, sparkle: 12 });
    expect(placePoints(9)).toBe(0);
    expect(placePoints(1)).toBe(15);
    expect(scoreTeamRace().winner).toBe(null);
  });

  it('liveTeamScore reads karts (finished karts use their finish place)', () => {
    const karts = [
      { id: 0, team: 'sprinkle', place: 2 },
      { id: 1, team: 'sparkle', place: 1, finished: true, finishPlace: 1 },
      { id: 2, team: 'sprinkle', place: 3 },
      { id: 3, place: 4 }, // no team: ignored
    ];
    const r = liveTeamScore(karts);
    expect(r.totals).toEqual({ sprinkle: 12 + 10, sparkle: 15 });
    expect(r.winner).toBe('sprinkle');
    expect(liveTeamScore().totals).toEqual({ sprinkle: 0, sparkle: 0 });
  });
});

describe('team series + text', () => {
  it('counts wins, ties and points across races', () => {
    let s = createTeamSeries();
    s = teamSeriesAdd(s, { winner: 'sprinkle', totals: { sprinkle: 33, sparkle: 25 } });
    s = teamSeriesAdd(s, { winner: null, totals: { sprinkle: 29, sparkle: 29 } });
    s = teamSeriesAdd(s, { winner: 'sparkle', totals: { sprinkle: 20, sparkle: 38 } });
    expect(s).toEqual({ races: 3, wins: { sprinkle: 1, sparkle: 1 }, ties: 1, points: { sprinkle: 82, sparkle: 92 } });
    expect(teamSeriesAdd(null, null).races).toBe(1);
  });

  it('friendly headlines for every outcome', () => {
    const texts = [
      teamResultText({ winner: 'sprinkle', margin: 20 }),
      teamResultText({ winner: 'sprinkle', margin: 2 }),
      teamResultText({ winner: 'sparkle', margin: 2 }),
      teamResultText({ winner: 'sparkle', margin: 12 }),
      teamResultText({ winner: null, margin: 0 }),
      teamResultText(null),
    ];
    expect(texts[0].title).toMatch(/BIG/);
    expect(texts[2].title).toMatch(/close/i);
    expect(texts[4].title).toMatch(/tie/i);
    for (const t of texts) expect(`${t.title} ${t.sub}`).not.toMatch(BAD_WORDS);
    const series = { races: 2, wins: { sprinkle: 1, sparkle: 0 }, ties: 1 };
    expect(teamResultText({ winner: 'sprinkle', margin: 3 }, series).sub).toBe('Series: 🍭 1 – 0 ⭐ (1 tie)');
  });
});

/** A whole team race headlessly with the real controller. */
function runTeamRace({ humans = 2, seed = 2, laps = 1, series = null } = {}) {
  const { def, path } = trackFixture('gumdrop-meadow');
  const scene = new THREE.Scene();
  const participants = defaultRacerIds(8).map((characterId, i) => ({ characterId, playerIndex: i < humans ? i : null }));
  let ctrl = null;
  const events = [];
  const race = new Race({ scene, trackDef: def, path, participants, buildKartModel: stubKartModel(), laps, seed, rules: rulesForMode('team'), onEvent: (e) => { events.push(e); ctrl?.onEvent(e); } });
  const flashes = [];
  const sfx = [];
  let scoredSeries = null;
  ctrl = createTeamSession({ race, scene, series, onScored: (s) => { scoredSeries = s; }, session: { flash: (k, t) => flashes.push([k.playerIndex, t]), sfx: (n) => sfx.push(n) } });
  const problems = [];
  while (race.state !== 'finished' && race.clock < 400) {
    const inputs = [];
    for (const k of race.karts) if (!k.isCPU) inputs[k.playerIndex] = aiDriveInput(race, k, race.lastDt);
    race.update(1 / 30, inputs);
    ctrl.update(1 / 30);
    if (problems.length < 5) for (const k of race.karts) problems.push(...kartProblems(k, path));
  }
  return { race, ctrl, events, flashes, sfx, scene, def, get scoredSeries() { return scoredSeries; }, problems };
}

describe('Team Race session (headless, real track)', () => {
  it('puts everyone on a team, scores the race into summary.team and updates the series', () => {
    const r = runTeamRace({ humans: 2, series: teamSeriesAdd(createTeamSeries(), { winner: 'sparkle', totals: { sprinkle: 20, sparkle: 38 } }) });
    expect(r.race.state).toBe('finished');
    expect(r.problems).toEqual([]);
    expect(r.race.karts.filter((k) => k.team === HOME_TEAM)).toHaveLength(4);
    expect(r.race.karts.filter((k) => !k.isCPU).every((k) => k.team === HOME_TEAM)).toBe(true);
    const humans = r.race.karts.filter((k) => !k.isCPU).map((k) => ({ playerIndex: k.playerIndex, deviceId: `d${k.playerIndex}`, characterId: k.characterId }));
    const summary = buildRaceSummary({ setup: { mode: 'team', speedClass: 'zippy' }, trackDef: r.def, humans, standings: r.race.getStandings(), laps: 1, raceTime: r.race.time });
    expect(summary.mode).toBe('team');
    r.ctrl.decorateSummary(summary);
    const t = summary.team;
    expect(t.totals.sprinkle + t.totals.sparkle).toBe(58);
    expect(t.rows.map((x) => x.team)).toEqual(r.race.getStandings().map((k) => k.team));
    expect(t.series.races).toBe(2);
    expect(r.scoredSeries).toBe(t.series);
    expect(r.ctrl.result).toBe(r.ctrl.result);
    if (t.winner === HOME_TEAM) expect(r.sfx).toContain('team-cheer');
    // the HUD model
    expect(r.race.modeInfo.team.totals.sprinkle + r.race.modeInfo.team.totals.sparkle).toBe(58);
  });

  it('team badges ride on every kart (a heart for Sprinkle, a star for Sparkle) and are freed', () => {
    const r = runTeamRace({ humans: 1, laps: 1 });
    const badges = [];
    r.scene.traverse((o) => { if (o.name.startsWith('team-badge-')) badges.push(o); });
    expect(badges).toHaveLength(8);
    for (const b of badges) expect(b.parent.parent).toBe(r.scene); // on the kart model group
    expect(new Set(badges.map((b) => b.userData.team))).toEqual(new Set([HOME_TEAM, AWAY_TEAM]));
    const home = badges.find((b) => b.userData.team === HOME_TEAM);
    const away = badges.find((b) => b.userData.team === AWAY_TEAM);
    expect(home.children[0].geometry).not.toBe(away.children[0].geometry);
    let disposed = 0;
    const res = new Set();
    for (const b of badges) b.traverse((o) => { if (o.geometry) res.add(o.geometry); if (o.material) res.add(o.material); });
    for (const x of res) x.addEventListener('dispose', () => disposed++);
    r.ctrl.dispose();
    expect(disposed).toBe(res.size);
    expect(r.race.friendly).toBe(null);
    const left = [];
    r.scene.traverse((o) => { if (o.name.startsWith('team-badge-')) left.push(o); });
    expect(left).toEqual([]);
    r.race.dispose();
  });

  it('showResults opens the team results screen with the scored team', () => {
    const r = runTeamRace({ humans: 1 });
    const summary = { standings: r.race.getStandings().map((k, i) => ({ characterId: k.characterId, playerIndex: k.isCPU ? null : k.playerIndex, isCPU: k.isCPU, place: i + 1 })) };
    r.ctrl.decorateSummary(summary);
    const opened = [];
    const menus = { open: (id, params) => { opened.push([id, params]); return Promise.resolve('menu'); } };
    const p = r.ctrl.showResults({ menus, summary, trackDef: r.def, unlocks: [] });
    expect(p).toBeInstanceOf(Promise);
    expect(opened[0][0]).toBe('team-results');
    expect(opened[0][1].team).toBe(summary.team);
    expect(r.ctrl.showResults({ menus: null, summary })).toBe(null);
    r.ctrl.dispose();
    r.race.dispose();
  });
});

describe('team-mates never bonk each other (Race.friendly + ItemSystem)', () => {
  function pair() {
    const { def, path } = trackFixture('gumdrop-meadow');
    const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants: defaultRacerIds(3).map((c, i) => ({ characterId: c, playerIndex: i === 0 ? 0 : null })), seed: 1, rules: rulesForMode('team') });
    const [a, b, c] = race.karts;
    a.team = 'sprinkle'; b.team = 'sprinkle'; c.team = 'sparkle';
    race.friendly = (x, y) => x.team === y.team;
    return { race, a, b, c };
  }

  it('an item from a team-mate is shrugged off; a rival still twirls you', () => {
    const { race, a, b, c } = pair();
    expect(race.items.bonk(b, 'gumdrop', a)).toBe('friendly');
    expect(b.spinning).toBe(false);
    expect(race.items.bonk(b, 'gumdrop', c)).toBe('bonked');
    expect(race.items.bonk(a, 'gumdrop', a)).toBe('bonked'); // your own gumdrop still gets you
    race.dispose();
  });

  it('star power only twirls rivals', () => {
    const { race, a, b, c } = pair();
    a.starPower = 5;
    b.position.copy(a.position).add(new THREE.Vector3(0.5, 0, 0));
    race._collideKarts();
    expect(b.spinning).toBe(false);
    c.position.copy(a.position).add(new THREE.Vector3(-0.5, 0, 0));
    race._collideKarts();
    expect(c.spinning).toBe(true);
    race.dispose();
  });

  it('gumdrops let team-mates roll over them and rockets fly past friends', () => {
    const { race, a, b, c } = pair();
    const gd = race.items.dropGumdrop(a);
    gd.grace = 0;
    b.position.copy(gd.position);
    race.items.update(1 / 60, race.karts);
    expect(race.items.gumdrops).toContain(gd);
    expect(b.spinning).toBe(false);
    c.position.copy(gd.position);
    race.items.update(1 / 60, race.karts);
    expect(race.items.gumdrops).not.toContain(gd);
    expect(c.spinning).toBe(true);
    race.dispose();
  });

  it('a rocket skips a team-mate ahead and chases the rival', () => {
    const { race, a, b, c } = pair();
    race._standings = [c, b, a];
    const r = race.items.launchRocket(a);
    expect(r.target).toBe(c);
    race.dispose();
  });
});
