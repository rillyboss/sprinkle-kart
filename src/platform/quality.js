/**
 * Graphics quality presets + automatic tier choice (mobile platform). OWNER: mobile platform.
 *
 *   const tier = pickAutoTier(caps, gpu);            // 'low' | 'medium' | 'high'
 *   const q = resolveQuality('auto', { caps, gpu }); // a full preset object (frozen), q.id = the tier used
 *   renderer.setPixelRatio(pixelRatioFor(q, players, devicePixelRatio, renderScale));
 *
 * `high` is EXACTLY the game as it was before mobile support (same pixel-ratio caps as
 * src/render/SplitScreen.js pixelRatioFor, antialias on, full scenery, full particles, no frame cap,
 * no dynamic resolution), and desktops on 'auto' always get it — so desktop play, the smoke test and
 * CI screenshots are unchanged. Phones and tablets on 'auto' get a tier from the GPU family, a short
 * benchmark and the memory / CPU hints, then the dynamic resolution controller fine-tunes at run time.
 *
 * Preset fields (all read by src/platform/sceneTuning.js, src/systems/platformQuality.js and main.js):
 *   pixelRatioCaps [1p, 2p, 3–4p]   devicePixelRatio caps per split-screen player count
 *   antialias                        MSAA on the WebGL context (only at start-up: a reload applies it)
 *   sceneryOutlines                  cartoon outlines on the track's scenery (karts keep theirs, see below)
 *   kartOutlineDistance              karts farther than this (m) from every camera drop their outline (LOD)
 *   sceneryRadius                    instanced scenery farther than this (m) from the road is not drawn
 *   fogScale                         fog near/far multiplier: hides the scenery cut-off softly
 *   particleScale                    weather / confetti density multiplier (on top of Effects & comfort)
 *   targetFps                        60, or 30 = a steady frame cap on weak devices (offline play only)
 *   minRenderScale / maxRenderScale  dynamic resolution bounds (1 / 1 = off)
 */

export const QUALITY_IDS = Object.freeze(['low', 'medium', 'high']);
export const QUALITY_CHOICES = Object.freeze(['auto', 'low', 'medium', 'high']);

const RANK = { low: 0, medium: 1, high: 2 };

export const PRESETS = Object.freeze({
  low: Object.freeze({
    id: 'low',
    pixelRatioCaps: Object.freeze([1, 0.85, 0.75]),
    antialias: false,
    sceneryOutlines: false,
    kartOutlineDistance: 18,
    sceneryRadius: 70,
    fogScale: 0.7,
    particleScale: 0.35,
    targetFps: 30,
    minRenderScale: 0.55,
    maxRenderScale: 1,
  }),
  medium: Object.freeze({
    id: 'medium',
    pixelRatioCaps: Object.freeze([1.25, 1, 0.85]),
    antialias: false,
    sceneryOutlines: true,
    kartOutlineDistance: 40,
    sceneryRadius: 130,
    fogScale: 0.85,
    particleScale: 0.65,
    targetFps: 60,
    minRenderScale: 0.65,
    maxRenderScale: 1,
  }),
  high: Object.freeze({
    id: 'high',
    pixelRatioCaps: Object.freeze([1.5, 1.25, 1]),
    antialias: true,
    sceneryOutlines: true,
    kartOutlineDistance: Infinity,
    sceneryRadius: Infinity,
    fogScale: 1,
    particleScale: 1,
    targetFps: 60,
    minRenderScale: 1,
    maxRenderScale: 1,
  }),
});

export const lowerTier = (a, b) => (RANK[a] <= RANK[b] ? a : b);
export const isQualityId = (id) => Object.prototype.hasOwnProperty.call(RANK, id);
export const isQualityChoice = (c) => QUALITY_CHOICES.includes(c);

/**
 * The tier 'auto' picks.
 * @param {ReturnType<import('./capabilities.js').detectCapabilities>} caps
 * @param {{ tierHint?: string|null, benchHint?: string|null, software?: boolean }} [gpu]
 *        tierHint = classifyGpu(renderer), benchHint = classifyBenchmark(ms)
 * @returns {{ tier: 'low'|'medium'|'high', reasons: string[] }}
 */
export function pickAutoTier(caps = {}, gpu = {}) {
  const reasons = [];
  if (!caps.mobile) return { tier: 'high', reasons: ['desktop'] };
  if (gpu.software) return { tier: 'low', reasons: ['software renderer'] };
  const hints = [gpu.tierHint, gpu.benchHint].filter(isQualityId);
  let tier = hints.length ? hints.reduce(lowerTier) : 'medium';
  reasons.push(hints.length ? `gpu ${gpu.tierHint ?? '?'} / bench ${gpu.benchHint ?? '?'}` : 'unknown gpu');
  if (caps.memoryGB !== null && caps.memoryGB !== undefined) {
    if (caps.memoryGB <= 2) { tier = 'low'; reasons.push(`${caps.memoryGB} GB memory`); } else if (caps.memoryGB <= 4) { tier = lowerTier(tier, 'medium'); reasons.push(`${caps.memoryGB} GB memory`); }
  }
  if (caps.cores && caps.cores <= 2) { tier = 'low'; reasons.push(`${caps.cores} cores`); } else if (caps.cores && caps.cores <= 4) { tier = lowerTier(tier, 'medium'); reasons.push(`${caps.cores} cores`); }
  if (caps.phone) { tier = lowerTier(tier, 'medium'); reasons.push('phone'); }
  return { tier, reasons };
}

/**
 * The preset for a saved choice.
 * @param {string} choice 'auto' | 'low' | 'medium' | 'high' (anything else → 'auto')
 * @param {{ caps?: object, gpu?: object }} [ctx]
 * @returns {typeof PRESETS.high & { choice: string, reasons: string[] }}
 */
export function resolveQuality(choice = 'auto', { caps = {}, gpu = {} } = {}) {
  if (isQualityId(choice)) return Object.freeze({ ...PRESETS[choice], choice, reasons: ['chosen'] });
  const { tier, reasons } = pickAutoTier(caps, gpu);
  return Object.freeze({ ...PRESETS[tier], choice: 'auto', reasons });
}

/**
 * Pixel ratio for the renderer: the preset's cap for this many players, the device's own ratio, and the
 * dynamic resolution scale. Never below 0.5.
 * @param {{ pixelRatioCaps: number[] }} preset
 * @param {number} players 1..4
 * @param {number} devicePixelRatio
 * @param {number} [renderScale] 0..1 from the dynamic resolution controller
 */
export function pixelRatioFor(preset, players, devicePixelRatio = 1, renderScale = 1) {
  const caps = preset?.pixelRatioCaps ?? PRESETS.high.pixelRatioCaps;
  const cap = players >= 3 ? caps[2] : players === 2 ? caps[1] : caps[0];
  const base = Math.min(cap, devicePixelRatio || 1);
  const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
  return Math.max(0.5, Math.round(base * scale * 1000) / 1000);
}

/** Debug URL override: ?quality=low|medium|high|auto (null when absent / junk). */
export function qualityFromSearch(search = '') {
  try {
    const q = new URLSearchParams(String(search)).get('quality');
    return isQualityChoice(q) ? q : null;
  } catch { return null; }
}
