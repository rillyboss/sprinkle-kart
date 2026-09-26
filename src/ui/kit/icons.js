/**
 * Candy Arcade icon set — hand-drawn inline SVG "stickers" with thick grape
 * outlines that match the 3D toon outlines. No emoji as UI icons: use these.
 * OWNER: UI art direction. Pure strings (no DOM), safe to import in node.
 *
 *   icon('trophy')                         // '<svg class="ck-icon ck-icon-trophy" ...>'
 *   icon('lock', { cls: 'big', title: 'Locked' })
 *   ICON_NAMES                             // every name (docs page + tests)
 *   iconForEmoji('🏆')                      // 'trophy' | null (turn old emoji labels into icons)
 *   modeIcon('grand-prix') · itemIcon('gumdrop') · entryIcon(screenId, emoji)
 *
 * Every icon is drawn in a 32×32 box; size it with CSS (`.ck-icon { width: 1.2em }`).
 */

const G = '#2e1447'; // grape outline
const G2 = '#4b2470';
const G3 = '#7a5a96';
const R = '#ff3e8a';
const M = '#3fe0b5';
const L = '#ffd23f';
const S = '#4fb3ff';
const C = '#fff6e8';
const W = '#ffffff';

const TXT = `font-family="Lilita One, Fredoka, Arial Rounded MT Bold, sans-serif" text-anchor="middle" stroke="none" fill="${W}"`;

/** Closed star polygon path. */
export function starPath(cx, cy, outer, inner, points = 5, rot = -90) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = ((rot + (i * 180) / points) * Math.PI) / 180;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Closed gear path (square-ish teeth). */
export function gearPath(cx, cy, outer, inner, teeth = 8) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const w = step * 0.22;
    for (const [ang, r] of [[a - step / 2 + w, inner], [a - w * 1.05, outer], [a + w * 1.05, outer], [a + step / 2 - w, inner]]) {
      pts.push(`${(cx + Math.cos(ang) * r).toFixed(2)} ${(cy + Math.sin(ang) * r).toFixed(2)}`);
    }
  }
  return `M${pts.join('L')}Z`;
}

const btn = (letter, fill) => `<circle cx="16" cy="16" r="13" fill="${fill}"/>`
  + `<path d="M6.5 19.5a10.5 10.5 0 0 0 19 0" stroke="none" fill="rgba(46,20,71,.18)"/>`
  + `<text x="16" y="21.6" font-size="15.5" ${TXT}>${letter}</text>`;
const bumper = (label) => `<rect x="2.5" y="8" width="27" height="16" rx="6.5" fill="${G2}"/>`
  + `<text x="16" y="20.4" font-size="11" ${TXT}>${label}</text>`;
const candy = (fill = R) => `<path d="M3 10.5l6.5 3v5L3 21.5z" fill="${fill}"/><path d="M29 10.5l-6.5 3v5l6.5 3z" fill="${fill}"/>`
  + `<ellipse cx="16" cy="16" rx="8" ry="6.8" fill="${fill}"/><path d="M12.6 10.6l2.6 10.6M17.4 9.8l2.6 10.6" stroke="${W}" stroke-width="2"/>`;
const trophyBody = (fill = L) => `<path d="M9.5 7H5.5a4 4 0 0 0 4.5 6M22.5 7h4a4 4 0 0 1-4.5 6" fill="none"/>`
  + `<path d="M9 4.5h14V11a7 7 0 0 1-14 0z" fill="${fill}"/><path d="M13.8 17.4h4.4v4.8h-4.4z" fill="${fill}"/>`
  + `<rect x="8.5" y="22" width="15" height="5.5" rx="1.6" fill="${R}"/><path d="M12.5 7.5v3.4" stroke="${W}" stroke-width="2.2"/>`;

/** name -> inner SVG markup (drawn with a grape outline by default). */
const ICONS = {
  /* ---- controller buttons & keys ---- */
  'btn-a': btn('A', '#2fc47a'),
  'btn-b': btn('B', R),
  'btn-x': btn('X', S),
  'btn-y': btn('Y', '#f5b800'),
  'btn-lb': bumper('LB'),
  'btn-rb': bumper('RB'),
  'btn-start': `<rect x="4.5" y="9" width="23" height="14" rx="7" fill="${G2}"/><path d="M11 13.2h10M11 16h10M11 18.8h10" stroke="${W}" stroke-width="1.8"/>`,
  dpad: `<path d="M12 3.5h8V12h8.5v8H20v8.5h-8V20H3.5v-8H12z" fill="${G2}"/><path d="M16 6.5l2.2 3h-4.4zM16 25.5l2.2-3h-4.4zM6.5 16l3-2.2v4.4zM25.5 16l-3-2.2v4.4z" fill="${W}" stroke="none"/>`,
  stick: `<circle cx="16" cy="16" r="13" fill="${G2}"/><circle cx="16" cy="16" r="7.5" fill="${G3}"/><circle cx="14" cy="14" r="2.2" fill="${W}" stroke="none" opacity=".6"/>`,
  key: `<rect x="3.5" y="5" width="25" height="22" rx="5" fill="${C}"/><path d="M7 22.5h18" stroke="${G3}" stroke-width="2"/>`,
  mouse: `<rect x="8" y="3.5" width="16" height="25" rx="8" fill="${C}"/><path d="M16 4v9M8.5 13h15" fill="none"/><path d="M8.7 12.5V11.5a7.5 7.5 0 0 1 7.3-7.5v8.5z" fill="${R}"/>`,

  /* ---- navigation ---- */
  back: `<circle cx="16" cy="16" r="13" fill="${R}"/><path d="M17.5 9l-7 7 7 7M11 16h11" stroke="${W}" stroke-width="3.6" fill="none"/>`,
  'arrow-left': `<path d="M18.5 4.5L6.5 16l12 11.5V21H26v-10h-7.5z" fill="${C}"/>`,
  'arrow-right': `<path d="M13.5 4.5L25.5 16l-12 11.5V21H6v-10h7.5z" fill="${C}"/>`,
  'arrow-up': `<path d="M4.5 18.5L16 6.5l11.5 12H21V26H11v-7.5z" fill="${C}"/>`,
  'arrow-down': `<path d="M4.5 13.5L16 25.5l11.5-12H21V6H11v7.5z" fill="${C}"/>`,
  play: `<path d="M10 5.5l17 10.5-17 10.5z" fill="${M}"/>`,
  restart: `<path d="M24.8 17.5A9 9 0 1 1 21.6 9" fill="none" stroke="${G}" stroke-width="6.4"/><path d="M24.8 17.5A9 9 0 1 1 21.6 9" fill="none" stroke="${S}" stroke-width="3"/><path d="M17.5 5.2l7.5 1.2-1.4 7.4z" fill="${S}"/>`,
  home: `<path d="M16 4.5L28.5 15H25v12.5H7V15H3.5z" fill="${R}"/><rect x="13" y="18.5" width="6" height="9" rx="1.2" fill="${C}"/>`,
  close: `<path d="M8 8l16 16M24 8L8 24" stroke="${G}" stroke-width="8"/><path d="M8 8l16 16M24 8L8 24" stroke="${R}" stroke-width="4"/>`,
  check: `<path d="M6 16.5l6.5 6.5L26 9.5" fill="none" stroke="${G}" stroke-width="8"/><path d="M6 16.5l6.5 6.5L26 9.5" fill="none" stroke="${M}" stroke-width="4"/>`,
  plus: `<path d="M16 6v20M6 16h20" stroke="${G}" stroke-width="8"/><path d="M16 6v20M6 16h20" stroke="${M}" stroke-width="4"/>`,
  minus: `<path d="M6 16h20" stroke="${G}" stroke-width="8"/><path d="M6 16h20" stroke="${R}" stroke-width="4"/>`,

  /* ---- status & rewards ---- */
  lock: `<path d="M10 15v-4a6 6 0 0 1 12 0v4" fill="none" stroke-width="3.4"/><rect x="6" y="14" width="20" height="14" rx="3.6" fill="${L}"/><path d="M16 19v4" stroke-width="3.2"/>`,
  unlock: `<path d="M10 15v-4a6 6 0 0 1 11.5-2.4" fill="none" stroke-width="3.4"/><rect x="6" y="14" width="20" height="14" rx="3.6" fill="${M}"/><path d="M16 19v4" stroke-width="3.2"/>`,
  trophy: trophyBody(),
  star: `<path d="${starPath(16, 16.8, 13, 6)}" fill="${L}"/><path d="M11 12.5l2-1" stroke="${W}" stroke-width="2"/>`,
  heart: `<path d="M16 27C6.5 20.5 3.5 15.5 3.5 11.3a6.2 6.2 0 0 1 12.5-2.6 6.2 6.2 0 0 1 12.5 2.6c0 4.2-3 9.2-12.5 15.7z" fill="${R}"/><path d="M8 10.5a2.6 2.6 0 0 1 2.6-2.2" stroke="${W}" stroke-width="2" fill="none"/>`,
  sparkle: `<path d="M16 2.5c1 9.5 4 12.5 13.5 13.5-9.5 1-12.5 4-13.5 13.5-1-9.5-4-12.5-13.5-13.5C12 15 15 12 16 2.5z" fill="${L}"/>`,
  medal: `<path d="M10 3.5h5l3 8h-5zM22 3.5h-5l-3 8h5z" fill="${R}"/><circle cx="16" cy="20" r="8.5" fill="${L}"/><path d="${starPath(16, 20.4, 4.6, 2.2)}" fill="${W}" stroke="none"/>`,
  flag: `<path d="M8 29V4.5" stroke-width="3.2"/><path d="M8 5.5h18.5v12H8z" fill="${W}"/><path d="M8 5.5h6.2v6H8zM20.3 5.5h6.2v6h-6.2zM14.2 11.5h6.1v6h-6.1z" fill="${G}" stroke="none"/>`,
  sticker: `<path d="M5 5h22v14l-8 8H5z" fill="${L}"/><path d="M27 19h-6.5a1.5 1.5 0 0 0-1.5 1.5V27z" fill="${C}"/><path d="${starPath(14.5, 14.5, 6, 2.8)}" fill="${R}"/>`,

  /* ---- menus ---- */
  settings: `<path d="${gearPath(16, 16, 13, 9.6, 8)}" fill="${S}"/><circle cx="16" cy="16" r="4.4" fill="${C}"/>`,
  online: `<circle cx="16" cy="16" r="12.5" fill="${S}"/><path d="M3.8 16h24.4M16 3.5c-5.5 6.4-5.5 18.6 0 25M16 3.5c5.5 6.4 5.5 18.6 0 25M6 9.5h20M6 22.5h20" fill="none" stroke-width="2"/>`,
  people: `<circle cx="22" cy="11.5" r="4.3" fill="${S}"/><path d="M14.6 27a7.4 7.8 0 0 1 14.8 0z" fill="${S}"/><circle cx="11" cy="10.5" r="5" fill="${R}"/><path d="M2.6 27.5a8.4 8.8 0 0 1 16.8 0z" fill="${R}"/>`,
  book: `<path d="M16 8.5c-4-3-9-3.2-12.5-2.2v19.5c3.5-1 8.5-.8 12.5 2.2 4-3 9-3.2 12.5-2.2V6.3C25 5.3 20 5.5 16 8.5z" fill="${C}"/><path d="M16 8.5V28" fill="none"/><path d="M6.5 11c2.5-.5 5 0 7 1M18.5 12c2-1 4.5-1.5 7-1" stroke="${G3}" stroke-width="1.8" fill="none"/>`,
  gift: `<rect x="4.5" y="12" width="23" height="15.5" rx="2" fill="${L}"/><rect x="3" y="8.5" width="26" height="5.5" rx="1.6" fill="${R}"/><path d="M16 8.5v19" stroke-width="3.2"/><path d="M16 8.5c-2-5-8-5-7-1.5.6 1.8 4.5 1.8 7 1.5zm0 0c2-5 8-5 7-1.5-.6 1.8-4.5 1.8-7 1.5z" fill="${R}"/>`,
  paint: `<path d="M16 4C8.5 4 3.5 9.5 3.5 15.5c0 7 5.5 11.5 11 11.5 2.2 0 3.2-1.2 3.2-2.7 0-2.2-2.6-2.4-2.6-4.5 0-1.7 1.4-2.8 3.4-2.8h3.2c3.6 0 5.8-2.3 5.8-5.6C27.5 7.8 22.4 4 16 4z" fill="${C}"/><circle cx="10" cy="12" r="2.4" fill="${R}"/><circle cx="16" cy="9" r="2.4" fill="${L}"/><circle cx="22" cy="11" r="2.4" fill="${S}"/><circle cx="9.5" cy="19" r="2.4" fill="${M}"/>`,
  wand: `<path d="M5 27.5l13-13" stroke="${G}" stroke-width="6.5"/><path d="M5 27.5l13-13" stroke="${C}" stroke-width="2.8"/><path d="${starPath(21.5, 10.5, 8.5, 3.8)}" fill="${L}"/>`,
  map: `<path d="M3.5 8l7.5-3 10 3 7.5-3v19.5l-7.5 3-10-3-7.5 3z" fill="${M}"/><path d="M11 5v19.5M21 8v19.5" fill="none"/><path d="M6.5 20.5c3-6 7 2 10-4s5-5 8.5-7.5" stroke="${R}" stroke-dasharray="2.2 2.4" fill="none" stroke-width="2.2"/>`,
  camera: `<path d="M11 10.5l2-4h6l2 4" fill="${S}"/><rect x="3.5" y="10" width="25" height="16.5" rx="3.4" fill="${S}"/><circle cx="16" cy="18.2" r="5.4" fill="${C}"/><circle cx="16" cy="18.2" r="2" fill="${G}" stroke="none"/>`,
  music: `<path d="M12 23V7l14-3v16" fill="none" stroke-width="3"/><ellipse cx="9" cy="23.5" rx="4.2" ry="3.4" fill="${R}"/><ellipse cx="23" cy="20.5" rx="4.2" ry="3.4" fill="${R}"/>`,
  sound: `<path d="M4 12h6l7-6v20l-7-6H4z" fill="${L}"/><path d="M21 11a6 6 0 0 1 0 10M24.5 7.5a11 11 0 0 1 0 17" fill="none" stroke-width="2.8"/>`,
  eye: `<path d="M2.5 16C7 8.5 25 8.5 29.5 16 25 23.5 7 23.5 2.5 16z" fill="${C}"/><circle cx="16" cy="16" r="5" fill="${S}"/><circle cx="16" cy="16" r="2" fill="${G}" stroke="none"/>`,

  /* ---- race & track facts ---- */
  kart: `<path d="M3.5 21l2.8-6.5h9.5l3.4-4.5h5.5l3.8 6.5v4.5z" fill="${R}"/><circle cx="10.5" cy="12" r="3.4" fill="${L}"/><circle cx="9" cy="22.5" r="4.3" fill="${G2}"/><circle cx="23.5" cy="22.5" r="4.3" fill="${G2}"/><circle cx="9" cy="22.5" r="1.4" fill="${C}" stroke="none"/><circle cx="23.5" cy="22.5" r="1.4" fill="${C}" stroke="none"/>`,
  clock: `<path d="M13 3.8h6M16 4v4.2M24 8.6l2-2" fill="none" stroke-width="2.8"/><circle cx="16" cy="18" r="10.5" fill="${C}"/><path d="M16 18l4.5-4.5" stroke="${R}" stroke-width="3"/><circle cx="16" cy="18" r="1.6" fill="${G}" stroke="none"/>`,
  jump: `<path d="M3 27.5h19V16.5z" fill="${L}"/><path d="M7.5 15C10.5 5.5 22.5 4 27 13" fill="none" stroke="${G}" stroke-width="6"/><path d="M7.5 15C10.5 5.5 22.5 4 27 13" fill="none" stroke="${R}" stroke-width="2.6"/><path d="M22.8 12.8l5.2 2.2 1-5.6z" fill="${R}"/>`,
  length: `<rect x="2.5" y="10.5" width="27" height="11" rx="2.2" fill="${L}"/><path d="M7.5 10.5v4.5M12.5 10.5v6.5M17.5 10.5v4.5M22.5 10.5v6.5" fill="none" stroke-width="2"/>`,
  speed: `<path d="M18.5 2.5L6.5 18.5h8.2l-2.2 11 13-16.8h-8.4z" fill="${L}"/>`,
  accel: `<path d="M4 6.5h6.5l9 9.5-9 9.5H4l9-9.5z" fill="${M}"/><path d="M14.5 6.5H21l9 9.5-9 9.5h-6.5l9-9.5z" fill="${M}"/>`,
  handling: `<circle cx="16" cy="16" r="12.5" fill="${S}"/><circle cx="16" cy="16" r="7.8" fill="${C}"/><path d="M8.4 14.5h15.2M16 16.5v8" stroke-width="3.2"/><circle cx="16" cy="15.5" r="2.6" fill="${S}"/>`,
  weight: `<path d="M11 12.5a5 5 0 0 1 10 0" fill="none" stroke-width="3.2"/><path d="M6.5 21.5a9.5 9.5 0 0 1 19 0v1.8a4.2 4.2 0 0 1-4.2 4.2H10.7a4.2 4.2 0 0 1-4.2-4.2z" fill="${G3}"/><path d="M10 19.5a6 6 0 0 1 3-3.4" stroke="${W}" stroke-width="2" fill="none"/>`,
  flame: `<path d="M16 3c2.2 5 9.5 8 9.5 15.2a9.5 9.5 0 0 1-19 0c0-4 2-6.4 4.2-8.2 0 3 1.2 5.2 3.2 5.2-1-5 0-9.2 2.1-12.2z" fill="${R}"/><path d="M16 17.5c1.5 2.5 4.5 3.5 4.5 6.5a4.5 4.5 0 0 1-9 0c0-2 1.2-3.2 2.4-4 .3 1.2.9 1.8 1.6 1.8-.4-1.8-.2-3.2.5-4.3z" fill="${L}" stroke="none"/>`,
  lollipop: `<path d="M16 17v12.5" stroke="${G}" stroke-width="5.5"/><path d="M16 17v12.5" stroke="${C}" stroke-width="2.2"/><circle cx="16" cy="11.5" r="9" fill="${R}"/><path d="M16 11.5a2.6 2.6 0 1 1 2.6 2.6 5 5 0 1 1-5-5 7.2 7.2 0 1 1 6.2 10.5" fill="none" stroke="${W}" stroke-width="2"/>`,
  target: `<circle cx="16" cy="16" r="12.5" fill="${R}"/><circle cx="16" cy="16" r="8" fill="${C}"/><circle cx="16" cy="16" r="3.6" fill="${R}"/>`,
  smile: `<circle cx="16" cy="16" r="12.5" fill="${L}"/><circle cx="11.5" cy="13.5" r="1.8" fill="${G}" stroke="none"/><circle cx="20.5" cy="13.5" r="1.8" fill="${G}" stroke="none"/><path d="M10.5 18.5c2.8 4 8.2 4 11 0" fill="none" stroke-width="2.6"/>`,
  wow: `<circle cx="16" cy="16" r="12.5" fill="${L}"/><circle cx="11.5" cy="13" r="1.8" fill="${G}" stroke="none"/><circle cx="20.5" cy="13" r="1.8" fill="${G}" stroke="none"/><ellipse cx="16" cy="20.5" rx="3" ry="3.6" fill="${G}" stroke="none"/>`,
  uturn: `<path d="M9 28V14a7 7 0 0 1 14 0v4" fill="none" stroke="${G}" stroke-width="7"/><path d="M9 28V14a7 7 0 0 1 14 0v4" fill="none" stroke="${L}" stroke-width="3.2"/><path d="M16.5 16.5h13L23 25z" fill="${L}"/>`,
  mystery: `<rect x="4" y="4" width="24" height="24" rx="5.5" fill="${R}"/><path d="M4 11.5h24" stroke="none"/><text x="16" y="23.4" font-size="18" ${TXT}>?</text>`,
  rocket: `<path d="M16 3c5 3.5 7 9 6.5 15.5h-13C9 12 11 6.5 16 3z" fill="${C}"/><circle cx="16" cy="11.5" r="2.8" fill="${S}"/><path d="M9.5 15l-4 5.5 4.5 1M22.5 15l4 5.5-4.5 1" fill="${R}"/><path d="M12.5 21.5c0 3.5 1.5 6 3.5 7.5 2-1.5 3.5-4 3.5-7.5z" fill="${L}"/>`,

  /* ---- items (src/race/itemCatalog.js ids) ---- */
  'sprinkle-boost': candy(R),
  'triple-sprinkle': `<g transform="translate(1 12) scale(.55)" stroke-width="4.4">${candy(L)}</g><g transform="translate(14.5 12) scale(.55)" stroke-width="4.4">${candy(M)}</g><g transform="translate(7.8 1) scale(.55)" stroke-width="4.4">${candy(R)}</g>`,
  gumdrop: `<path d="M4.5 26.5c0-12 5-19.5 11.5-19.5s11.5 7.5 11.5 19.5z" fill="${M}"/><circle cx="12" cy="15" r="1.4" fill="${W}" stroke="none"/><circle cx="19" cy="13" r="1.4" fill="${W}" stroke="none"/><circle cx="17" cy="20" r="1.4" fill="${W}" stroke="none"/><circle cx="10" cy="21.5" r="1.4" fill="${W}" stroke="none"/>`,
  'bubble-shield': `<circle cx="15" cy="16.5" r="12" fill="${S}" fill-opacity=".45"/><path d="M8.5 12.5a7.5 7.5 0 0 1 5-5" stroke="${W}" stroke-width="2.6" fill="none"/><circle cx="26" cy="6" r="3.2" fill="${S}" fill-opacity=".45"/>`,
  'cupcake-rocket': `<path d="M8.5 17h15l-2.5 10.5h-10z" fill="${S}"/><path d="M12 17.5l1 9.5M16 17.5v9.5M20 17.5l-1 9.5" stroke="${W}" stroke-width="1.6"/><path d="M5.5 17.5c0-4.2 3-5.2 5-5.2 0-4.2 3-6.3 5.5-6.3s5.5 2.1 5.5 6.3c2 0 5 1 5 5.2z" fill="${R}"/><circle cx="16" cy="5" r="2.6" fill="${L}"/>`,
  'rainbow-star': `<path d="M2.5 26a13.5 13.5 0 0 1 27 0" fill="none" stroke="${R}" stroke-width="3"/><path d="M6.5 26a9.5 9.5 0 0 1 19 0" fill="none" stroke="${M}" stroke-width="3"/><path d="${starPath(16, 19, 9.5, 4.4)}" fill="${L}"/>`,

  /* ---- modes ---- */
  'grand-prix': trophyBody(L),
  'time-trial': '',
  team: '',
  battle: `<circle cx="11.5" cy="18" r="9" fill="${S}" fill-opacity=".55"/><circle cx="22" cy="11" r="7" fill="${R}" fill-opacity=".6"/><path d="M7 14.5a5 5 0 0 1 3.5-3M19 7.8a3.5 3.5 0 0 1 2.4-1.6" stroke="${W}" stroke-width="2.2" fill="none"/>`,
  daily: `<circle cx="16" cy="16" r="7.5" fill="${L}"/><path d="M16 2.5v4M16 25.5v4M2.5 16h4M25.5 16h4M6.4 6.4l2.8 2.8M22.8 22.8l2.8 2.8M6.4 25.6l2.8-2.8M22.8 9.2l2.8-2.8" stroke-width="3"/>`,
  'my-cup': `${trophyBody(S)}<path d="M16 13.2c-2.8-1.8-3.6-3.2-3.6-4.2a1.8 1.8 0 0 1 3.6-.7 1.8 1.8 0 0 1 3.6.7c0 1-.8 2.4-3.6 4.2z" fill="${R}" stroke="none"/>`,
};
// aliases (same drawing, different meaning)
ICONS['time-trial'] = ICONS.clock;
ICONS.team = ICONS.people;
ICONS.free = ICONS.flag;
ICONS.records = ICONS.medal;
ICONS.tutorial = ICONS.book;

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** True if `name` is in the set. */
export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Inline SVG markup for an icon (unknown names draw the "?" mystery box).
 * @param {string} name
 * @param {{ cls?: string, title?: string }} [opts]
 */
export function icon(name, { cls = '', title = '' } = {}) {
  const key = hasIcon(name) ? name : 'mystery';
  const label = title ? `<title>${escAttr(title)}</title>` : '';
  const aria = title ? `role="img" aria-label="${escAttr(title)}"` : 'aria-hidden="true"';
  return `<svg class="ck-icon ck-icon-${key}${cls ? ` ${escAttr(cls)}` : ''}" viewBox="0 0 32 32" ${aria} focusable="false"`
    + ` fill="none" stroke="${G}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${label}${ICONS[key]}</svg>`;
}

/** Old emoji labels -> icon names (so flavour text can keep its emoji while UI chips get icons). */
const EMOJI_ICONS = {
  '🏆': 'trophy', '🥇': 'medal', '🏅': 'medal', '⭐': 'star', '🌟': 'rainbow-star', '✨': 'sparkle', '💫': 'sparkle',
  '🔒': 'lock', '🔓': 'unlock', '⚙️': 'settings', '⚙': 'settings', '🌐': 'online', '📡': 'online', '🏠': 'home',
  '▶️': 'play', '▶': 'play', '🔁': 'restart', '🔄': 'uturn', '📸': 'camera', '📷': 'camera', '🎨': 'paint',
  '📒': 'sticker', '📔': 'sticker', '🎓': 'book', '📖': 'book', '🎁': 'gift', '🪄': 'wand', '🏁': 'flag',
  '⏱️': 'clock', '⏱': 'clock', '🧁': 'cupcake-rocket', '🍬': 'sprinkle-boost', '🍭': 'lollipop', '🟢': 'gumdrop',
  '🫧': 'bubble-shield', '🚀': 'rocket', '🔥': 'flame', '💪': 'heart', '💖': 'heart', '❤️': 'heart', '💞': 'heart',
  '🎯': 'target', '😅': 'smile', '😄': 'smile', '😮': 'wow', '🎉': 'sparkle', '🌈': 'rainbow-star', '🤝': 'team',
  '👥': 'people', '☀️': 'daily', '🌞': 'daily', '🗺️': 'map', '🎮': 'btn-a', '🍪': 'heart', '🎵': 'music', '🔊': 'sound',
};

/** Icon name for an emoji (or null). */
export function iconForEmoji(emoji) {
  if (!emoji) return null;
  const e = String(emoji).trim();
  return EMOJI_ICONS[e] ?? EMOJI_ICONS[e.replace(/️/g, '')] ?? null;
}

/** Icon for a game mode id (src/modes/menus.js MODE cards). */
export function modeIcon(modeId) {
  return hasIcon(modeId) ? modeId : 'flag';
}

/** Icon for an item id (src/race/itemCatalog.js). */
export function itemIcon(itemId) {
  return hasIcon(itemId) ? itemId : 'mystery';
}

/** Icons for the menu-entry screens by id (title / mode-select chips). */
const ENTRY_ICONS = {
  'how-to-play': 'book', 'item-guide': 'gift', 'paint-shop': 'paint', collection: 'sticker', settings: 'settings',
  effects: 'wand', online: 'online', records: 'medal', daily: 'daily', 'photo-mode': 'camera', 'my-cup': 'my-cup',
};

/** Icon name for a menu entry: its own `icon`, a known screen id, its emoji, else 'sparkle'. */
export function entryIcon(entry) {
  if (entry?.icon && hasIcon(entry.icon)) return entry.icon;
  return ENTRY_ICONS[entry?.id] ?? iconForEmoji(entry?.emoji) ?? 'sparkle';
}
