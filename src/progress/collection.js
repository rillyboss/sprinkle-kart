/**
 * Sticker Book model — everything the Collection screen shows, from the
 * binding lineup (all 21 racers + 20 tracks, built or not) plus the saved
 * progress. Pure (no DOM / storage), unit tested.
 *
 *   bookModel(p, { characters, tracks }) -> { racers, tracks, cups, stickers, total, stats }
 */
import { LINEUP_CHARACTERS, LINEUP_TRACKS, LINEUP_CUPS } from '../content/lineup.js';
import { progressInfo } from './progressText.js';
import { emptyRacerStats, emptyTrackStats } from './schema.js';

const byId = (list) => new Map((list || []).filter((d) => d && !d.placeholder).map((d) => [d.id, d]));

/**
 * @param {object} p progress (mergeProgress shape)
 * @param {{ characters?: object[], tracks?: object[] }} [content] registered defs (for portraits, colours, art)
 */
export function bookModel(p, { characters = [], tracks = [] } = {}) {
  const all = p?.unlockAll === true;
  const earned = new Set(p?.unlocked || []);
  const chars = byId(characters);
  const trks = byId(tracks);
  const available = (rule, id) => !rule || all || earned.has(id);

  const racers = LINEUP_CHARACTERS.map((c) => {
    const def = chars.get(c.id) ?? null;
    const rule = def ? (def.unlock !== undefined ? def.unlock : c.unlock) : c.unlock;
    const open = available(rule, c.id);
    return {
      kind: 'character',
      id: c.id,
      name: c.name,
      def,
      built: !!def,
      free: !rule,
      open,
      rule,
      info: open ? null : progressInfo(rule, p),
      tally: { ...emptyRacerStats(), ...(p?.racers?.[c.id] || {}) },
    };
  });

  const trackRows = LINEUP_TRACKS.map((t) => {
    const def = trks.get(t.id) ?? null;
    const rule = def ? (def.unlock !== undefined ? def.unlock : t.unlock) : t.unlock;
    const open = available(rule, t.id);
    const rec = p?.records?.[t.id] || {};
    return {
      kind: 'track',
      id: t.id,
      name: t.name,
      cup: t.cup,
      def,
      built: !!def,
      free: !rule,
      open,
      rule,
      info: open ? null : progressInfo(rule, p),
      tally: { ...emptyTrackStats(), ...(p?.tracks?.[t.id] || {}) },
      trophies: Number.isFinite(p?.trophies?.[t.id]) ? p.trophies[t.id] : 0,
      record: {
        bestRace: Number.isFinite(rec.bestRace) && rec.bestRace > 0 ? rec.bestRace : null,
        bestLap: Number.isFinite(rec.bestLap) && rec.bestLap > 0 ? rec.bestLap : null,
      },
    };
  });

  // Tracks grouped by cup (cup order, then track order inside the cup) = the grid order.
  const cups = LINEUP_CUPS.map((cup) => {
    const c = p?.cups?.[cup.id] || {};
    return {
      id: cup.id,
      name: cup.name,
      emoji: cup.emoji,
      trackIds: [...cup.trackIds],
      bestPlace: Number.isInteger(c.bestPlace) ? c.bestPlace : null,
      wins: Number.isFinite(c.wins) ? c.wins : 0,
      finished: Number.isFinite(c.finished) ? c.finished : 0,
    };
  });
  const order = cups.flatMap((c) => c.trackIds);
  const sortedTracks = [...trackRows].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const stickers = racers.filter((r) => r.open).length + sortedTracks.filter((t) => t.open).length;
  return {
    racers,
    tracks: sortedTracks,
    cups,
    stickers,
    total: racers.length + sortedTracks.length,
    stats: { ...(p?.stats || {}) },
    unlockAll: all,
  };
}

/** Trophy / medal emoji for a best place (null = not raced yet). */
export function medalEmoji(place) {
  if (place === 1) return '🥇';
  if (place === 2) return '🥈';
  if (place === 3) return '🥉';
  return place ? '🎀' : '';
}
