/**
 * `?democontent=1` — pad the MENU lists with locked placeholders for every
 * lineup racer / track that is not built yet, so the menus can be checked at
 * full v2 size (21 racers, 20 tracks in 5 cups) before the content exists.
 * Placeholders are always locked, so they can never be raced.
 */
import { LINEUP_CHARACTERS, LINEUP_TRACKS } from '../content/lineup.js';

const PLACEHOLDER_COLORS = [0xff9ecf, 0x9fd8ff, 0xb8f2d6, 0xffe28a, 0xc7b8ff, 0xffb3a0];

/** @returns {{characters: object[], tracks: object[]}} */
export function demoContent(characters, tracks) {
  const haveC = new Set(characters.map((c) => c.id));
  const haveT = new Set(tracks.map((t) => t.id));
  const extraC = LINEUP_CHARACTERS.filter((c) => !haveC.has(c.id)).map((c, i) => ({
    id: c.id,
    name: c.name,
    tagline: c.concept ?? '',
    personality: c.concept ?? '',
    colors: { primary: PLACEHOLDER_COLORS[i % 6], secondary: 0xffffff, accent: 0xffe45c, kart: PLACEHOLDER_COLORS[i % 6] },
    stats: { speed: 3, accel: 3, handling: 3, weight: 3 },
    voice: { pitch: 1, style: 'yay' },
    locked: true,
    unlock: c.unlock ?? { type: 'stat', stat: 'wins', count: 99 },
    pack: c.pack,
    emoji: '❓',
    quotes: { select: 'Coming soon!', win: 'Yay!', oops: 'Oops!' },
    placeholder: true,
  }));
  const template = tracks[0];
  const extraT = LINEUP_TRACKS.filter((t) => !haveT.has(t.id)).map((t, i) => ({
    ...template,
    id: t.id,
    name: t.name,
    subtitle: t.theme,
    cup: t.cup,
    unlock: t.unlock ?? { type: 'stat', stat: 'wins', count: 99 },
    previewColor: PLACEHOLDER_COLORS[i % 6],
    art: ['🚧', '🍬', '✨'],
    placeholder: true,
  }));
  return { characters: [...characters, ...extraC], tracks: [...tracks, ...extraT] };
}
