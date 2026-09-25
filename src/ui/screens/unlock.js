/**
 * The big "NEW FRIEND UNLOCKED!" / "NEW TRACK UNLOCKED!" celebration overlay,
 * plus the small progression widgets other screens embed. Not a routed
 * screen. OWNER: progression/unlocks workstream.
 *
 *   unlockOverlay(ctx, unlock, onClick, { index, total })
 *        one reveal; the results screen shows one per unlock, in order.
 *        Characters get the portrait reveal in their own colours; tracks get a
 *        postcard of the track (colour, art, road outline) with its cup ribbon.
 *        With total > 1 a "Surprise 2 of 3" ribbon + dots show the sequence.
 *   nextUnlockTeaser(ctx)        results "Next sticker" card (closest locked item + progress bar)
 *   lockProgressHtml(def, ctx)   progress bar + "1/3 ⭐" for a locked tile / card ('' if nothing to show)
 */
import './progress.css';
import { el, escapeHtml, glyph, kbd, portraitHtml, confettiLayer } from '../dom.js';
import { cssColor, lighten, trackOutlinePoints } from '../hudLogic.js';
import { trackArt } from './_shared.js';
import { lineupCup, lineupTrack, lineupCharacter } from '../../content/lineup.js';
import { entriesFrom, nextUnlock } from '../../progress/engine.js';
import { progressInfo } from '../../progress/progressText.js';
import { describeUnlockShort } from '../../progress/describeUnlock.js';

const PRONOUNS = { she: ['She', 'her'], he: ['He', 'him'], they: ['They', 'them'] };

/** "She can race with you now!" line (CharacterDef.pronoun, default 'they'). */
export function unlockSubline(def) {
  const [a, b] = PRONOUNS[def?.pronoun] ?? PRONOUNS.they;
  return `${a} can race with you now! Pick ${b} on the racer screen 💖`;
}

/** Cup label for a track def ("🫧 Bubble Cup"), '' if unknown. */
export function cupLabel(trackDef) {
  const cup = lineupCup(trackDef?.cup ?? lineupTrack(trackDef?.id)?.cup);
  return cup ? `${cup.emoji} ${cup.name}` : '';
}

/** Text for the reveal (pure, tested): kicker, name, tag, sub, press, ribbon. */
export function unlockCopy(unlock, { index = 0, total = 1 } = {}) {
  const def = unlock?.def ?? null;
  const isTrack = unlock?.kind === 'track';
  const more = total > 1 && index < total - 1;
  const cup = isTrack ? cupLabel(def) : '';
  return {
    kicker: isTrack ? 'NEW TRACK UNLOCKED!' : 'NEW FRIEND UNLOCKED!',
    name: def?.name ?? (isTrack ? 'A secret track' : 'Cotton Candy Girl'),
    tag: (isTrack ? def?.subtitle : def?.tagline) ?? (isTrack ? 'A brand-new place to zoom!' : 'Fluffy, sparkly and super sweet!'),
    sub: isTrack
      ? `Find it${cup ? ` in the ${cup}` : ''} on the track screen 🗺️`
      : unlockSubline(def),
    cup,
    ribbon: total > 1 ? `Surprise ${index + 1} of ${total}!` : '',
    press: more ? 'for the next surprise! 🎁' : 'to continue',
  };
}

const dots = (index, total) => (total > 1
  ? `<div class="skp-seq">${Array.from({ length: total }, (_, i) => `<i class="${i < index ? 'done' : i === index ? 'now' : ''}"></i>`).join('')}</div>`
  : '');

/**
 * @param {object} ctx menu context (portraits, screen handle)
 * @param {{kind:'character'|'track', def:object}} unlock
 * @param {() => void} onClick called when the overlay is clicked
 * @param {{ index?: number, total?: number }} [seq] position in a multi-unlock sequence
 * @returns {HTMLElement}
 */
export function unlockOverlay(ctx, unlock, onClick, { index = 0, total = 1 } = {}) {
  const def = unlock?.def ?? null;
  const isTrack = unlock?.kind === 'track';
  const copy = unlockCopy(unlock, { index, total });
  const clouds = Array.from({ length: 9 }, (_, i) => `<i class="sk-cloud sk-cloud-${i % 3}" style="--i:${i}"></i>`).join('');
  const floaty = isTrack ? ['🎈', '✨', '🏁', '🎈', '⭐', '🍬'] : ['💗', '💙', '✨', '🍬'];
  const hearts = Array.from({ length: 16 }, (_, i) => `<i class="sk-uheart" style="--i:${i}">${floaty[i % floaty.length]}</i>`).join('');
  let hero;
  let tint;
  if (isTrack) {
    const base = cssColor(def?.previewColor, '#ffa6d8');
    tint = base;
    const art = trackArt(def);
    const outline = def?.controlPoints ? trackOutlinePoints(def.controlPoints, 100, 60, 0.1) : '';
    hero = `<div class="sk-unlock-track skp-postcard" style="--c1:${lighten(base, 0.55)};--c2:${base};--c3:${lighten(base, 0.2)}">`
      + (outline ? `<svg viewBox="0 0 100 60" class="skp-road"><polygon points="${outline}"/></svg>` : '')
      + `<span class="a1">${art[0]}</span><span class="a2">${art[1]}</span><span class="a3">${art[2]}</span>`
      + '<span class="skp-stamp">NEW!</span></div>'
      + (copy.cup ? `<div class="skp-cup-ribbon">${escapeHtml(copy.cup)}</div>` : '');
  } else {
    tint = cssColor(def?.colors?.primary, '#ff9fd2');
    hero = portraitHtml(def, ctx.portraits, { cls: 'sk-big-portrait skp-hero-portrait' });
  }
  const ov = el('div.sk-unlock', {
    class: `${isTrack ? 'sk-unlock-is-track skp-unlock-track' : 'skp-unlock-char'}`,
    '--uc': tint,
    '--uc-soft': lighten(tint, 0.7),
    onclick: (e) => { e.stopPropagation(); onClick?.(); },
    html: `<div class="sk-rays"></div>${clouds}${hearts}`
      + (copy.ribbon ? `<div class="skp-ribbon">${escapeHtml(copy.ribbon)}</div>` : '')
      + '<div class="sk-unlock-inner">'
      + `<div class="sk-unlock-kicker">${copy.kicker}</div>`
      + `<div class="sk-unlock-portrait">${hero}<div class="sk-sparkle s1">✨</div><div class="sk-sparkle s2">✨</div><div class="sk-sparkle s3">⭐</div></div>`
      + `<div class="sk-unlock-name">${escapeHtml(copy.name)}</div>`
      + `<div class="sk-unlock-tag">${escapeHtml(copy.tag)}</div>`
      + `<div class="sk-unlock-sub">${escapeHtml(copy.sub)}</div>`
      + '<div class="skp-book-note">📒 A new sticker for your Sticker Book!</div>'
      + dots(index, total)
      + `<div class="sk-press">Press ${glyph('A')} or ${kbd('Enter')} ${escapeHtml(copy.press)}</div>`
      + '</div>',
  });
  ov.appendChild(confettiLayer(70, 17 + index * 13));
  return ov;
}

/* ------------------------------------------------------------------ */
/* Progress widgets                                                    */
/* ------------------------------------------------------------------ */

function savedProgress(ctx) {
  try { return ctx?.progress?.loadProgress?.() ?? null; } catch { return null; }
}

/** A cute candy progress bar. `ratio` 0..1. */
export function barHtml(ratio, text = '', cls = '') {
  const pct = Math.round(Math.max(0, Math.min(1, ratio || 0)) * 100);
  return `<div class="skp-bar ${cls}"><div class="skp-bar-track"><i style="width:${pct}%"></i></div>`
    + (text ? `<span class="skp-bar-t">${escapeHtml(text)}</span>` : '') + '</div>';
}

/**
 * Progress towards a locked def's rule ('' when not locked, no rule, or
 * nothing to show — yes/no rules without a best place yet).
 * @param {object} def CharacterDef / TrackDef
 * @param {object} ctx menu ctx (progress)
 * @param {{ cls?: string, progress?: object }} [opts]
 */
export function lockProgressHtml(def, ctx, { cls = '', progress = null, compact = false } = {}) {
  if (!def?.unlock) return '';
  const p = progress ?? savedProgress(ctx);
  if (!p || p.unlockAll || (p.unlocked || []).includes(def.id)) return '';
  const info = progressInfo(def.unlock, p);
  const text = compact ? info.short : info.text;
  if (!text) return '';
  return barHtml(info.target > 1 ? info.ratio : 0.08, text, cls);
}

/** The data behind the results teaser (pure given a progress object; tested). */
export function teaserData(p, { characters = [], tracks = [] } = {}) {
  if (!p || p.unlockAll) return null;
  const n = nextUnlock(p, entriesFrom(characters, tracks));
  if (!n) return null;
  const def = n.kind === 'track' ? tracks.find((t) => t.id === n.id) : characters.find((c) => c.id === n.id);
  const name = def?.name ?? (n.kind === 'track' ? lineupTrack(n.id)?.name : lineupCharacter(n.id)?.name) ?? 'A surprise';
  const info = progressInfo(n.unlock, p);
  return {
    kind: n.kind,
    id: n.id,
    def: def ?? null,
    name,
    hint: describeUnlockShort(n.unlock),
    ratio: info.ratio,
    text: info.text,
  };
}

/**
 * "Next sticker" teaser for the results screen, or null when nothing is left
 * to unlock (or a grown-up unlocked everything).
 */
export function nextUnlockTeaser(ctx) {
  const t = teaserData(savedProgress(ctx), { characters: ctx?.characters ?? [], tracks: ctx?.tracks ?? [] });
  if (!t) return null;
  let pic;
  if (t.kind === 'track') {
    const base = cssColor(t.def?.previewColor, '#c9b8ff');
    pic = `<div class="skp-teaser-card" style="--c1:${lighten(base, 0.5)};--c2:${base}"><span>🔒</span></div>`;
  } else {
    pic = `<div class="skp-silhouette">${portraitHtml(t.def, ctx.portraits, { locked: !t.def, cls: 'skp-teaser-portrait' })}</div>`;
  }
  return el('div.skp-teaser', {
    html: `${pic}<div class="skp-teaser-body">`
      + `<div class="skp-teaser-k">Next sticker ${t.kind === 'track' ? '🗺️' : '💞'}</div>`
      + `<div class="skp-teaser-n">${escapeHtml(t.name)}</div>`
      + `<div class="skp-teaser-h">${escapeHtml(t.hint)}</div>`
      + `${barHtml(t.ratio, t.text || 'You can do it!')}</div>`,
  });
}
