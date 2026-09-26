/**
 * Mobile & tablet platform layer — one object main.js creates at boot. OWNER: mobile platform.
 *
 *   import { createPlatform } from './platform/index.js';
 *   const platform = createPlatform();                         // detect device, GPU, pick the quality preset
 *   new THREE.WebGLRenderer({ antialias: platform.quality.antialias, ... });
 *   renderer.setPixelRatio(platform.pixelRatio(players, devicePixelRatio));   // in resize()
 *   frame(now): if (!platform.frameGate(now, { online })) return;           // frame cap + dynamic resolution
 *   platform.attach({ renderer, canvas, audio, onResize: resize });          // web fixes, overlays, PWA
 *   game.platform = platform;                                                 // systems + tests read it here
 *
 * Seams for other modules (all optional, all safe to ignore):
 *   platform.caps          detectCapabilities() result (deviceClass, touch, os, browser, standalone, …)
 *   platform.gpu           { vendor, renderer, software, benchMs, tierHint, benchHint }
 *   platform.quality       the active preset (src/platform/quality.js), `.id` = low | medium | high
 *   platform.choice        the saved Graphics choice ('auto' | 'low' | 'medium' | 'high')
 *   platform.setChoice(c)  save + apply a new choice (the Graphics screen calls it)
 *   platform.renderScale   the dynamic resolution scale (0.55..1)
 *   platform.on(ev, fn)    'change' (quality / scale), 'hidden', 'visible', 'contextlost', 'contextrestored',
 *                          'update-ready' → returns off()
 *   platform.pwa           { updateReady, applyUpdate(), canInstall, promptInstall(), showHint(), hideHint() }
 *   platform.rotate        the rotate overlay handle ({ node, visible, set(v) }) — restyle via .sk-rotate
 *   platform.info()        a plain snapshot for debugging / the e2e tests
 * Debug URL: ?quality=low|medium|high|auto overrides the saved choice for this page load (not saved).
 */
import { readEnvironment, detectCapabilities } from './capabilities.js';
import { probeGpu, classifyGpu, classifyBenchmark } from './gpu.js';
import { resolveQuality, pixelRatioFor, qualityFromSearch, isQualityChoice } from './quality.js';
import { createDynamicResolution, createFrameCap } from './dynamicResolution.js';
import { graphicsPrefs as sharedPrefs } from './qualityPrefs.js';
import {
  applyViewportVars, installViewportWatch, installGestureGuards, installAudioResume, installLifecycle,
  installContextLossGuard, requestLandscape,
} from './web.js';
import { rotateOverlayState, createRotateOverlay } from './rotateOverlay.js';
import {
  swSupport, registerServiceWorker, applyUpdate, installHintKind, createHintStore, createToast,
  UPDATE_TEXT, IOS_HINT_TEXT, ANDROID_HINT_TEXT,
} from './pwa.js';

/**
 * @param {{ win?: any, prefs?: ReturnType<typeof import('./qualityPrefs.js').createGraphicsPrefs>,
 *   env?: object, gpu?: object, prod?: boolean }} [opts]  (tests pass fakes; the browser uses the defaults)
 */
export function createPlatform({
  win = typeof window !== 'undefined' ? window : null,
  prefs = sharedPrefs,
  env = null,
  gpu: gpuIn = null,
  prod = !!(typeof import.meta !== 'undefined' && import.meta.env?.PROD),
} = {}) {
  const caps = detectCapabilities(env ?? readEnvironment(win));
  const probed = gpuIn ?? probeGpu({ document: win?.document ?? null, benchmark: caps.mobile });
  const gpu = { ...probed, tierHint: classifyGpu(probed.renderer), benchHint: classifyBenchmark(probed.benchMs) };
  const override = qualityFromSearch(win?.location?.search ?? '');
  let choice = override ?? prefs.get().quality;
  let quality = resolveQuality(choice, { caps, gpu });
  let dyn = makeDyn(quality);
  const cap = createFrameCap(quality.targetFps);
  const subs = new Map();
  let lastRendered = null;
  let onResize = null;
  let renderer = null;

  function makeDyn(q) {
    return createDynamicResolution({ min: q.minRenderScale, max: q.maxRenderScale, targetFps: q.targetFps });
  }
  const emit = (ev, ...args) => {
    for (const fn of [...(subs.get(ev) ?? [])]) { try { fn(...args); } catch (err) { console.warn('[platform]', ev, err); } }
  };

  const pwa = {
    updateReady: false,
    canInstall: false,
    /** Show the install hint if this device / visit qualifies (no-op otherwise). */
    showHint() {},
    hideHint() {},
    _reg: null,
    _prompt: null,
    applyUpdate() {
      applyUpdate(pwa._reg, { nav: win?.navigator, reload: () => win?.location?.reload?.() });
    },
    async promptInstall() {
      const p = pwa._prompt;
      if (!p) return false;
      pwa._prompt = null;
      pwa.canInstall = false;
      try { await p.prompt(); const r = await p.userChoice; return r?.outcome === 'accepted'; } catch { return false; }
    },
  };

  const platform = {
    caps,
    gpu,
    pwa,
    rotate: null,
    get quality() { return quality; },
    get choice() { return choice; },
    get renderScale() { return dyn.scale; },
    get dynamic() { return dyn; },
    get frameCap() { return cap.fps; },
    get renderer() { return renderer; },

    on(ev, fn) {
      if (!subs.has(ev)) subs.set(ev, new Set());
      subs.get(ev).add(fn);
      return () => subs.get(ev)?.delete(fn);
    },

    /** Renderer pixel ratio for this many split-screen players. */
    pixelRatio(players = 1, devicePixelRatio = win?.devicePixelRatio ?? 1) {
      return pixelRatioFor(quality, players, devicePixelRatio, dyn.scale);
    },

    /**
     * Call first thing in the rAF callback. false = skip this frame (frame cap). Online races are never capped
     * (the host clock expects every display frame, NETWORKING.md §9.9); dynamic resolution still runs.
     * @param {number} now rAF timestamp (ms)
     * @param {{ online?: boolean }} [o]
     */
    frameGate(now, { online = false } = {}) {
      if (!online && !cap.shouldRender(now)) return false;
      if (lastRendered !== null && dyn.sample(now - lastRendered)) {
        try { onResize?.(); } catch { /* ignore */ }
        emit('change', { quality, renderScale: dyn.scale, reason: 'resolution' });
      }
      lastRendered = now;
      return true;
    },

    /** Save + apply a Graphics choice (antialias needs a reload; everything else applies at once / next race). */
    setChoice(next) {
      if (!isQualityChoice(next)) return quality;
      choice = next;
      try { prefs.set({ quality: next }); } catch { /* memory only */ }
      quality = resolveQuality(choice, { caps, gpu });
      dyn = makeDyn(quality);
      cap.set(quality.targetFps);
      lastRendered = null;
      try { onResize?.(); } catch { /* ignore */ }
      emit('change', { quality, renderScale: dyn.scale, reason: 'choice' });
      return quality;
    },

    /** Does the running WebGL context match the preset's antialias? (false → "applies after a reload") */
    antialiasMatches() {
      try { return !renderer || !!renderer.getContext().getContextAttributes()?.antialias === !!quality.antialias; } catch { return true; }
    },

    /** New race: start from full size again so a quiet scene is not stuck at a low resolution. */
    resetResolution() {
      if (dyn.scale !== dyn.max) { dyn.reset(); try { onResize?.(); } catch { /* ignore */ } }
      lastRendered = null;
    },

    info() {
      const r = renderer?.info;
      return {
        deviceClass: caps.deviceClass, os: caps.os, browser: caps.browser, touch: caps.touch, standalone: caps.standalone,
        gpu: gpu.renderer, software: !!gpu.software, benchMs: gpu.benchMs ?? null, tierHint: gpu.tierHint, benchHint: gpu.benchHint,
        choice, quality: quality.id, reasons: quality.reasons, renderScale: dyn.scale, frameCap: cap.fps,
        pixelRatio: renderer?.getPixelRatio?.() ?? null,
        calls: r?.render?.calls ?? null, triangles: r?.render?.triangles ?? null,
        geometries: r?.memory?.geometries ?? null, textures: r?.memory?.textures ?? null,
        updateReady: pwa.updateReady, rotateVisible: !!platform.rotate?.visible,
      };
    },

    /**
     * Install the web platform fixes. Call once after the renderer exists.
     * @param {{ renderer?: any, canvas?: any, audio?: any, onResize?: () => void }} o
     */
    attach({ renderer: r = null, canvas = null, audio = null, onResize: resize = null } = {}) {
      renderer = r;
      onResize = resize;
      const offs = [];
      if (!win?.document) return () => {};
      const doc = win.document;
      applyViewportVars(win, caps);
      let rotateDismissed = false;
      const updateRotate = () => {
        const st = rotateOverlayState({
          phone: caps.phone, width: win.innerWidth, height: win.innerHeight, dismissed: rotateDismissed,
          locked: String(win.screen?.orientation?.type ?? '').startsWith('landscape') && win.innerWidth >= win.innerHeight,
        });
        platform.rotate?.set(st.visible);
      };
      if (caps.phone) {
        platform.rotate = createRotateOverlay({ doc, onDismiss: () => { rotateDismissed = true; updateRotate(); } });
      }
      offs.push(installViewportWatch(win, caps, updateRotate));
      updateRotate();
      if (caps.touch) offs.push(installGestureGuards(win));
      if (audio) offs.push(installAudioResume(win, audio));
      offs.push(installLifecycle(win, {
        onHidden: (reason) => {
          // pagehide: iOS may freeze the page without another visibilitychange — make sure sound stops
          try { if (audio?.ctx?.state === 'running') audio.ctx.suspend().catch(() => {}); } catch { /* ignore */ }
          emit('hidden', reason);
        },
        onVisible: (reason) => { lastRendered = null; emit('visible', reason); },
      }));
      if (canvas) {
        offs.push(installContextLossGuard(canvas, {
          onLost: () => emit('contextlost'),
          onRestored: () => { try { onResize?.(); } catch { /* ignore */ } emit('contextrestored'); },
        }));
      }
      // Phones / tablets: the first tap goes full screen + landscape where the browser allows it.
      if (caps.mobile && !caps.standalone) {
        const first = () => {
          doc.removeEventListener('touchend', first, true);
          requestLandscape(win).then(() => updateRotate());
        };
        doc.addEventListener('touchend', first, true);
        offs.push(() => doc.removeEventListener('touchend', first, true));
      }
      offs.push(installPwa(win, { caps, pwa, emit, prod }));
      return () => offs.forEach((off) => { try { off(); } catch { /* ignore */ } });
    },
  };
  return platform;
}

/** Service worker + update toast + install hints (production builds only). */
function installPwa(win, { caps, pwa, emit, prod }) {
  const doc = win.document;
  const nav = win.navigator;
  const offs = [];
  const support = swSupport({ nav, loc: win.location, prod });
  if (support.ok) {
    let toast = null;
    registerServiceWorker({
      nav, win,
      onUpdateReady: (reg) => {
        pwa._reg = reg;
        pwa.updateReady = true;
        emit('update-ready', reg);
        toast ??= createToast({ doc, text: UPDATE_TEXT, cls: 'sk-pwa-update', onTap: () => pwa.applyUpdate() });
      },
    }).then((reg) => { if (reg) pwa._reg ??= reg; });
  }
  // Install hints: Android hands us a prompt event; iOS needs the Share → Add to Home Screen tip.
  const store = createHintStore();
  const { visits, dismissedAt } = store.visit();
  let hint = null;
  const maybeHint = () => {
    if (hint) return;
    const kind = installHintKind({ caps, standalone: caps.standalone, canPrompt: pwa.canInstall, visits, dismissedAt });
    if (!kind) return;
    hint = createToast({
      doc,
      cls: `sk-pwa-hint sk-pwa-hint-${kind}`,
      text: kind === 'ios' ? IOS_HINT_TEXT : ANDROID_HINT_TEXT,
      onTap: () => { if (kind === 'android') pwa.promptInstall().finally(() => hint?.close()); },
      onClose: () => store.dismiss(),
    });
  };
  const onPrompt = (e) => { e.preventDefault?.(); pwa._prompt = e; pwa.canInstall = true; };
  win.addEventListener?.('beforeinstallprompt', onPrompt);
  offs.push(() => win.removeEventListener?.('beforeinstallprompt', onPrompt));
  // Non-intrusive: src/systems/platformQuality.js asks for it only while the title screen has been up a while,
  // and hides it when a race starts.
  pwa.showHint = maybeHint;
  pwa.hideHint = () => { hint?.close(); };
  offs.push(() => hint?.close());
  return () => offs.forEach((off) => off());
}
