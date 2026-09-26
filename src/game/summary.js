/**
 * Pure builders for the game-flow event payloads (see ARCHITECTURE.md → Event bus).
 *
 *   raceStartInfo({ setup, trackDef, humans, cpuIds, laps })      -> RaceStartInfo  ('race-start')
 *   buildRaceSummary({ setup, trackDef, humans, standings, stats, laps, raceTime }) -> RaceSummary ('race-end')
 */
import { cupOfTrack } from '../data/cups.js';

/** Game modes. 'free' = the original single race. */
export const MODES = Object.freeze(['free', 'grand-prix', 'time-trial']);

const modeOf = (setup) => (MODES.includes(setup?.mode) ? setup.mode : 'free');
const cupIdOf = (setup, trackDef) => setup?.cupId ?? trackDef?.cup ?? cupOfTrack(trackDef?.id)?.id ?? null;
const kidAssistOf = (p) => !!(p.kidAssist ?? p.easyDrive);

const humanInfo = (p) => ({
  playerIndex: p.playerIndex,
  deviceId: p.deviceId,
  characterId: p.characterId,
  kidAssist: kidAssistOf(p),
});

/**
 * @typedef {Object} RaceStartInfo
 * @property {'free'|'grand-prix'|'time-trial'} mode
 * @property {string} trackId
 * @property {string|null} cupId
 * @property {string} speedClass
 * @property {number} laps
 * @property {{playerIndex:number, deviceId:string, characterId:string, kidAssist:boolean}[]} humans
 * @property {string[]} cpuCharacterIds
 */
export function raceStartInfo({ setup, trackDef, humans, cpuIds = [], laps }) {
  return {
    mode: modeOf(setup),
    trackId: trackDef.id,
    cupId: cupIdOf(setup, trackDef),
    speedClass: setup.speedClass,
    laps,
    humans: humans.map(humanInfo),
    cpuCharacterIds: [...cpuIds],
  };
}

const isHuman = (k) => !!k && !k.isCPU && k.playerIndex !== null && k.playerIndex !== undefined;

/**
 * @typedef {Object} RaceSummary
 * @property {'free'|'grand-prix'|'time-trial'} mode
 * @property {string} trackId
 * @property {string|null} cupId
 * @property {string} speedClass
 * @property {number} laps
 * @property {number} humanCount
 * @property {number} raceTime            seconds since GO when the race completed
 * @property {Array<{playerIndex:number, deviceId:string, characterId:string, kidAssist:boolean,
 *   place:number, finished:boolean, estimated:boolean, finishTime:number|null, lapTimes:number[],
 *   stats: ReturnType<import('./raceStats.js').emptyPlayerStats>}>} humans
 * @property {Array<{characterId:string, playerIndex:number|null, isCPU:boolean, place:number,
 *   finished:boolean, estimated:boolean, finishTime:number|null}>} standings
 * @property {{playerIndex:number, characterId:string}|null} winner   a human 1st place (not estimated)
 * @property {{itemsUsed:number, bonksGiven:number, miniTurbos:number}} totals  across humans
 * @property {Array<{kind:'character'|'track', id:string}>} unlocks  COLLECTOR: 'race-end' subscribers push here
 * @property {object} [records]  set on 'race-end' by src/systems/timingRecords.js (order 20): the result of
 *   submitRaceRecords() in src/modes/timing.js — { trackId, raceTime, bestLap, raceBy, lapBy,
 *   newBestRace, newBestLap, previous: {bestRace, bestLap}, record: {bestRace, bestLap} }
 */
export function buildRaceSummary({ setup, trackDef, humans, standings, stats = null, laps, raceTime = 0 }) {
  const placeOf = (k, i) => k.finishPlace ?? k.place ?? i + 1;
  const rows = standings.map((k, i) => ({
    characterId: k.characterId,
    playerIndex: isHuman(k) ? k.playerIndex : null,
    isCPU: !isHuman(k),
    place: placeOf(k, i),
    finished: !!k.finished,
    estimated: !!k.finishEstimated,
    finishTime: Number.isFinite(k.finishTime) ? k.finishTime : null,
  }));
  const humanRows = humans.map((p) => {
    const i = standings.findIndex((k) => isHuman(k) && k.playerIndex === p.playerIndex);
    const k = i >= 0 ? standings[i] : null;
    return {
      ...humanInfo(p),
      place: k ? placeOf(k, i) : standings.length,
      finished: !!k?.finished,
      estimated: !!k?.finishEstimated,
      finishTime: k && Number.isFinite(k.finishTime) ? k.finishTime : null,
      lapTimes: k?.lapTimes ? [...k.lapTimes] : [],
      stats: stats ? stats.forPlayer(p.playerIndex) : null,
    };
  });
  const win = standings.find((k) => isHuman(k) && k.finishPlace === 1 && !k.finishEstimated) || null;
  const sum = (key) => humanRows.reduce((a, h) => a + (h.stats?.[key] ?? 0), 0);
  return {
    mode: modeOf(setup),
    trackId: trackDef.id,
    cupId: cupIdOf(setup, trackDef),
    speedClass: setup.speedClass,
    laps,
    humanCount: humans.length,
    raceTime,
    humans: humanRows,
    standings: rows,
    winner: win ? { playerIndex: win.playerIndex, characterId: win.characterId } : null,
    totals: { itemsUsed: sum('itemsUsed'), bonksGiven: sum('bonksGiven'), miniTurbos: sum('miniTurbos') },
    unlocks: [],
  };
}
