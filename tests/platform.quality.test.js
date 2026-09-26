// Mobile platform: GPU tier hints, quality presets, auto tier choice and the saved Graphics choice.
import { describe, it, expect, vi } from 'vitest';
import { classifyGpu, classifyBenchmark, isSoftwareRenderer, readGpuInfo, gpuBenchmark, probeGpu, BENCH_FAST_MS, BENCH_SLOW_MS } from '../src/platform/gpu.js';
import { PRESETS, QUALITY_IDS, pickAutoTier, resolveQuality, pixelRatioFor, qualityFromSearch, lowerTier, isQualityChoice } from '../src/platform/quality.js';
import { pixelRatioFor as splitPixelRatioFor } from '../src/render/SplitScreen.js';
import { createGraphicsPrefs, normalizeGraphics, GRAPHICS_KEY } from '../src/platform/qualityPrefs.js';

const phone = { mobile: true, phone: true, deviceClass: 'phone', memoryGB: null, cores: null };
const tablet = { mobile: true, tablet: true, deviceClass: 'tablet', memoryGB: null, cores: null };

describe('classifyGpu', () => {
  it.each([
    ['Adreno (TM) 506', 'low'], ['Adreno (TM) 530', 'medium'], ['Adreno (TM) 618', 'medium'], ['Adreno (TM) 740', 'high'],
    ['Mali-T880', 'low'], ['Mali-G52 MC2', 'medium'], ['Mali-G72', 'medium'], ['Mali-G78', 'high'], ['Mali-G710', 'high'], ['Mali-G31', 'low'],
    ['Mali-400 MP', 'low'], ['PowerVR Rogue GE8320', 'low'], ['Samsung Xclipse 920', 'high'],
    ['Google SwiftShader', 'low'], ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'low'], ['llvmpipe (LLVM 15)', 'low'],
    ['Apple GPU', null], ['Apple M2', 'high'], ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', 'medium'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3070)', 'high'], ['Mystery GPU 9000', null], ['', null],
  ])('%s → %s', (r, tier) => { expect(classifyGpu(r)).toBe(tier); });
  it('software renderers', () => {
    expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
    expect(isSoftwareRenderer('Adreno 740')).toBe(false);
  });
  it('benchmark thresholds', () => {
    expect(classifyBenchmark(null)).toBe(null);
    expect(classifyBenchmark(0)).toBe(null);
    expect(classifyBenchmark(BENCH_FAST_MS)).toBe('high');
    expect(classifyBenchmark((BENCH_FAST_MS + BENCH_SLOW_MS) / 2)).toBe('medium');
    expect(classifyBenchmark(BENCH_SLOW_MS)).toBe('low');
  });
});

describe('readGpuInfo / gpuBenchmark / probeGpu (fake GL)', () => {
  const fakeGl = (opts = {}) => {
    const gl = {
      VENDOR: 1, RENDERER: 2, MAX_TEXTURE_SIZE: 3, COMPILE_STATUS: 4, LINK_STATUS: 5,
      getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 10, UNMASKED_RENDERER_WEBGL: 11 } : n === 'WEBGL_lose_context' ? { loseContext: vi.fn() } : null),
      getParameter: (p) => ({ 1: 'WebKit', 2: 'WebKit WebGL', 3: 4096, 10: 'Qualcomm', 11: opts.renderer ?? 'Adreno (TM) 640' }[p]),
      createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => opts.compiles !== false, deleteShader() {},
      createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, deleteProgram() {},
      createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, deleteBuffer() {},
      createTexture: () => ({}), bindTexture() {}, texImage2D() {}, deleteTexture() {},
      createFramebuffer: () => ({}), bindFramebuffer() {}, framebufferTexture2D() {}, deleteFramebuffer() {},
      viewport() {}, useProgram() {}, getAttribLocation: () => 0, enableVertexAttribArray() {}, disableVertexAttribArray() {},
      vertexAttribPointer() {}, getUniformLocation: () => ({}), uniform1f() {}, drawArrays() {}, readPixels() {},
    };
    return gl;
  };
  it('reads unmasked strings', () => {
    expect(readGpuInfo(fakeGl())).toEqual({ vendor: 'Qualcomm', renderer: 'Adreno (TM) 640', software: false });
    expect(readGpuInfo(null)).toEqual({ vendor: '', renderer: '', software: false });
    expect(readGpuInfo(fakeGl({ renderer: 'SwiftShader' })).software).toBe(true);
  });
  it('benchmark returns the median pass time from the clock', () => {
    let t = 0;
    const now = () => (t += 5);
    expect(gpuBenchmark(fakeGl(), { now })).toBe(5);
    expect(gpuBenchmark(null)).toBe(null);
    expect(gpuBenchmark(fakeGl({ compiles: false }))).toBe(null);
  });
  it('probeGpu is safe without a document and uses a throwaway context', () => {
    expect(probeGpu({ document: null })).toMatchObject({ renderer: '', benchMs: null });
    const doc = { createElement: () => ({ getContext: (kind) => (kind === 'webgl2' ? fakeGl() : null) }) };
    const r = probeGpu({ document: doc, benchmark: false });
    expect(r).toMatchObject({ renderer: 'Adreno (TM) 640', webgl2: true, maxTextureSize: 4096, benchMs: null });
    const noGl = { createElement: () => ({ getContext: () => null }) };
    expect(probeGpu({ document: noGl }).renderer).toBe('');
  });
});

describe('presets', () => {
  it('high is exactly the pre-mobile game (SplitScreen pixel ratio caps, AA, everything on, no cap)', () => {
    const h = PRESETS.high;
    for (const players of [1, 2, 3, 4]) for (const dpr of [1, 1.25, 2, 3]) expect(pixelRatioFor(h, players, dpr)).toBe(splitPixelRatioFor(players, dpr));
    expect(h).toMatchObject({ antialias: true, sceneryOutlines: true, kartOutlineDistance: Infinity, sceneryRadius: Infinity, fogScale: 1, particleScale: 1, targetFps: 60, minRenderScale: 1, maxRenderScale: 1 });
  });
  it('each lower tier is cheaper on every axis', () => {
    const [low, med, high] = QUALITY_IDS.map((id) => PRESETS[id]);
    for (const [a, b] of [[low, med], [med, high]]) {
      a.pixelRatioCaps.forEach((c, i) => expect(c).toBeLessThanOrEqual(b.pixelRatioCaps[i]));
      expect(a.sceneryRadius).toBeLessThan(b.sceneryRadius);
      expect(a.kartOutlineDistance).toBeLessThan(b.kartOutlineDistance);
      expect(a.particleScale).toBeLessThan(b.particleScale);
      expect(a.minRenderScale).toBeLessThan(b.minRenderScale);
    }
    expect(low.targetFps).toBe(30);
    expect(low.sceneryOutlines).toBe(false);
  });
  it('pixelRatioFor applies the dynamic scale and never goes below 0.5', () => {
    expect(pixelRatioFor(PRESETS.medium, 1, 3, 0.8)).toBe(1);
    expect(pixelRatioFor(PRESETS.low, 4, 3, 0.55)).toBe(0.5);
    expect(pixelRatioFor(PRESETS.low, 2, 1, 1)).toBe(0.85);
    expect(pixelRatioFor(PRESETS.medium, 1, 3, NaN)).toBe(1.25);
    expect(pixelRatioFor(null, 1, 3)).toBe(1.5);
  });
});

describe('pickAutoTier', () => {
  it('desktops always get high (the smoke / CI look is unchanged)', () => {
    expect(pickAutoTier({ mobile: false }, { software: true }).tier).toBe('high');
  });
  it('software GL on a phone or tablet → low', () => {
    expect(pickAutoTier(tablet, { software: true, tierHint: 'low' }).tier).toBe('low');
  });
  it('takes the lower of GPU family and benchmark', () => {
    expect(pickAutoTier(tablet, { tierHint: 'high', benchHint: 'medium' }).tier).toBe('medium');
    expect(pickAutoTier(tablet, { tierHint: null, benchHint: 'high' }).tier).toBe('high');
    expect(pickAutoTier(tablet, {}).tier).toBe('medium');
  });
  it('phones are capped at medium', () => {
    expect(pickAutoTier(phone, { tierHint: 'high', benchHint: 'high' })).toMatchObject({ tier: 'medium' });
  });
  it('memory and cores pull it down', () => {
    expect(pickAutoTier({ ...tablet, memoryGB: 2 }, { tierHint: 'high' }).tier).toBe('low');
    expect(pickAutoTier({ ...tablet, memoryGB: 4 }, { tierHint: 'high' }).tier).toBe('medium');
    expect(pickAutoTier({ ...tablet, memoryGB: 8 }, { tierHint: 'high' }).tier).toBe('high');
    expect(pickAutoTier({ ...tablet, cores: 2 }, { tierHint: 'high' }).tier).toBe('low');
    expect(pickAutoTier({ ...tablet, cores: 4 }, { tierHint: 'high' }).tier).toBe('medium');
    const r = pickAutoTier({ ...phone, memoryGB: 3, cores: 4 }, { tierHint: 'medium' });
    expect(r.reasons.join(' ')).toMatch(/memory.*cores.*phone/);
  });
  it('resolveQuality: explicit choices win; junk means auto', () => {
    expect(resolveQuality('low', { caps: { mobile: false } })).toMatchObject({ id: 'low', choice: 'low' });
    expect(resolveQuality('auto', { caps: phone, gpu: { software: true } })).toMatchObject({ id: 'low', choice: 'auto' });
    expect(resolveQuality('ultra', { caps: { mobile: false } })).toMatchObject({ id: 'high', choice: 'auto' });
    expect(Object.isFrozen(resolveQuality('high'))).toBe(true);
  });
  it('helpers', () => {
    expect(lowerTier('high', 'low')).toBe('low');
    expect(lowerTier('medium', 'high')).toBe('medium');
    expect(isQualityChoice('auto')).toBe(true);
    expect(qualityFromSearch('?quick=x&quality=low')).toBe('low');
    expect(qualityFromSearch('?quality=ultra')).toBe(null);
    expect(qualityFromSearch('')).toBe(null);
  });
});

describe('saved Graphics choice', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), map: m }; };
  it('defaults to auto, saves and notifies', () => {
    const storage = mem();
    const p = createGraphicsPrefs({ storage });
    expect(p.get()).toEqual({ quality: 'auto' });
    const seen = [];
    const off = p.subscribe((v) => seen.push(v.quality));
    p.set({ quality: 'low' });
    expect(JSON.parse(storage.map.get(GRAPHICS_KEY))).toEqual({ quality: 'low' });
    expect(createGraphicsPrefs({ storage }).get().quality).toBe('low');
    off();
    p.set({ quality: 'high' });
    expect(seen).toEqual(['low']);
  });
  it('junk and broken storage are harmless', () => {
    expect(normalizeGraphics({ quality: 'ultra' })).toEqual({ quality: 'auto' });
    expect(normalizeGraphics([1])).toEqual({ quality: 'auto' });
    const bad = { getItem: () => '{nope', setItem: () => { throw new Error('full'); } };
    const p = createGraphicsPrefs({ storage: bad });
    expect(p.get().quality).toBe('auto');
    p.subscribe(() => { throw new Error('bad subscriber'); });
    expect(p.set({ quality: 'medium' }).quality).toBe('medium');
    expect(createGraphicsPrefs({ storage: null }).set({ quality: 'low' }).quality).toBe('low');
  });
});
