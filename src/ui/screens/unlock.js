/**
 * The big "NEW FRIEND UNLOCKED!" / "NEW TRACK UNLOCKED!" celebration overlay.
 * Not a routed screen: the results screen shows one overlay per unlock, in
 * order. OWNER: progression/unlocks workstream may restyle / extend it.
 */
import { el, escapeHtml, glyph, kbd, portraitHtml, confettiLayer } from '../dom.js';
import { cssColor, lighten } from '../hudLogic.js';
import { trackArt } from './_shared.js';

/**
 * @param {object} ctx menu context (portraits, screen handle)
 * @param {{kind:'character'|'track', def:object}} unlock
 * @param {() => void} onClick called when the overlay is clicked
 * @returns {HTMLElement}
 */
export function unlockOverlay(ctx, unlock, onClick) {
  const def = unlock?.def ?? null;
  const isTrack = unlock?.kind === 'track';
  const clouds = Array.from({ length: 9 }, (_, i) => `<i class="sk-cloud sk-cloud-${i % 3}" style="--i:${i}"></i>`).join('');
  const hearts = Array.from({ length: 16 }, (_, i) => `<i class="sk-uheart" style="--i:${i}">${['💗', '💙', '✨', '🍬'][i % 4]}</i>`).join('');
  let hero;
  if (isTrack) {
    const base = cssColor(def?.previewColor, '#ffa6d8');
    const art = trackArt(def);
    hero = `<div class="sk-unlock-track" style="--c1:${lighten(base, 0.55)};--c2:${base};--c3:${lighten(base, 0.2)}">`
      + `<span class="a1">${art[0]}</span><span class="a2">${art[1]}</span><span class="a3">${art[2]}</span></div>`;
  } else {
    hero = portraitHtml(def, ctx.portraits, { cls: 'sk-big-portrait' });
  }
  const ov = el('div.sk-unlock', {
    class: isTrack ? 'sk-unlock-is-track' : '',
    onclick: (e) => { e.stopPropagation(); onClick?.(); },
    html: `<div class="sk-rays"></div>${clouds}${hearts}`
      + '<div class="sk-unlock-inner">'
      + `<div class="sk-unlock-kicker">${isTrack ? 'NEW TRACK UNLOCKED!' : 'NEW FRIEND UNLOCKED!'}</div>`
      + `<div class="sk-unlock-portrait">${hero}<div class="sk-sparkle s1">✨</div><div class="sk-sparkle s2">✨</div><div class="sk-sparkle s3">⭐</div></div>`
      + `<div class="sk-unlock-name">${escapeHtml(def?.name ?? 'Cotton Candy Girl')}</div>`
      + `<div class="sk-unlock-tag">${escapeHtml((isTrack ? def?.subtitle : def?.tagline) ?? 'Fluffy, sparkly and super sweet!')}</div>`
      + `<div class="sk-unlock-sub">${isTrack ? 'Find it on the track screen 🗺️' : unlockSubline(def)}</div>`
      + `<div class="sk-press">Press ${glyph('A')} or ${kbd('Enter')} to continue</div>`
      + '</div>',
  });
  ov.appendChild(confettiLayer(70, 17));
  return ov;
}

const PRONOUNS = { she: ['She', 'her'], he: ['He', 'him'], they: ['They', 'them'] };

/** "She can race with you now!" line (CharacterDef.pronoun, default 'they'). */
function unlockSubline(def) {
  const [a, b] = PRONOUNS[def?.pronoun] ?? PRONOUNS.they;
  return `${a} can race with you now! Pick ${b} on the racer screen 💖`;
}
