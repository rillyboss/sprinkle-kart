/**
 * GPU identification + a tiny benchmark (mobile platform). OWNER: mobile platform.
 *
 *   const info = readGpuInfo(gl);            // { vendor, renderer, software }
 *   const hint = classifyGpu(info.renderer); // 'low' | 'medium' | 'high' | null (unknown)
 *   const ms = gpuBenchmark(gl);             // ms for a fixed fill workload (smaller = faster), or null
 *
 * `classifyGpu` is pure and table-driven: well-known mobile GPU families by generation. It is a *hint*;
 * the dynamic resolution controller corrects a wrong guess at run time. iOS reports only "Apple GPU"
 * (WebKit hides the model), so Apple GPUs return null here and the device class / benchmark decide.
 */

/** @param {any} gl a WebGL(2)RenderingContext or null */
export function readGpuInfo(gl) {
  const out = { vendor: '', renderer: '', software: false };
  if (!gl) return out;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out.vendor = String((ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || '');
    out.renderer = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  } catch { /* some browsers throw on the debug extension */ }
  out.software = isSoftwareRenderer(out.renderer);
  return out;
}

/** SwiftShader / llvmpipe / Microsoft Basic Render: the CPU is drawing. */
export function isSoftwareRenderer(renderer = '') {
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(String(renderer));
}

/**
 * Tier hint from the renderer string.
 * @param {string} renderer
 * @returns {'low'|'medium'|'high'|null}
 */
export function classifyGpu(renderer = '') {
  const r = String(renderer);
  if (!r) return null;
  if (isSoftwareRenderer(r)) return 'low';
  let m = r.match(/Adreno\D*(\d{3})/i);
  if (m) {
    const n = Number(m[1]);
    if (n < 530) return 'low';        // Adreno 3xx/4xx/505..512
    if (n < 640) return 'medium';     // 530..630
    return 'high';                    // 640+ (Snapdragon 855 and newer)
  }
  m = r.match(/Mali-?\s*([GT])?(\d+)/i);
  if (m) {
    const fam = (m[1] || '').toUpperCase();
    const n = Number(m[2]);
    if (fam !== 'G') return 'low';    // Mali-4xx / T6xx / T7xx / T8xx
    if (n >= 710 || (n >= 76 && n < 100)) return 'high'; // G76/G77/G78, G710+
    if (n >= 52 && n < 100) return 'medium'; // G52..G72
    return 'low';                     // G31/G51 and friends
  }
  if (/PowerVR/i.test(r)) return 'low';
  if (/Xclipse/i.test(r)) return 'high';
  if (/Apple GPU|Apple M\d/i.test(r)) return /Apple M\d/i.test(r) ? 'high' : null;
  if (/Intel.*(HD|UHD) Graphics/i.test(r)) return 'medium';
  if (/GeForce|Radeon|RTX|Quadro|Arc/i.test(r)) return 'high';
  return null;
}

/** Benchmark ms at or below which the GPU counts as fast / above which slow. */
export const BENCH_FAST_MS = 12;
export const BENCH_SLOW_MS = 40;

/**
 * Tier hint from a benchmark time (null when there was no benchmark).
 * @param {number|null} ms
 */
export function classifyBenchmark(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms <= BENCH_FAST_MS) return 'high';
  if (ms >= BENCH_SLOW_MS) return 'low';
  return 'medium';
}

const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
// A deliberately fragment-heavy loop, roughly like a few toon-lit overdraw layers.
const FS = `precision mediump float;uniform float t;void main(){vec2 u=gl_FragCoord.xy*0.01;float a=t;
for(int i=0;i<24;i++){a+=sin(u.x*float(i)+a)*cos(u.y-float(i)*a);}gl_FragColor=vec4(fract(a),0.5,0.5,1.);}`;

/**
 * Draw a fixed fill workload into a small framebuffer and time it (blocking readPixels = the GPU finished).
 * Returns ms per pass (median of 3), or null when anything is missing. Takes ~5–60 ms; call once at boot.
 * @param {any} gl
 * @param {{ size?: number, passes?: number, now?: () => number }} [opts]
 */
export function gpuBenchmark(gl, { size = 256, passes = 6, now = () => performance.now() } = {}) {
  if (!gl || typeof gl.createShader !== 'function') return null;
  const made = [];
  try {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader');
      made.push(() => gl.deleteShader(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    made.push(() => gl.deleteProgram(prog));
    const buf = gl.createBuffer();
    made.push(() => gl.deleteBuffer(buf));
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const tex = gl.createTexture();
    made.push(() => gl.deleteTexture(tex));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    made.push(() => gl.deleteFramebuffer(fb));
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, size, size);
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tLoc = gl.getUniformLocation(prog, 't');
    const px = new Uint8Array(4);
    const run = (k) => {
      const t0 = now();
      for (let i = 0; i < passes; i++) { gl.uniform1f(tLoc, k + i * 0.1); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return now() - t0;
    };
    run(0); // warm-up (shader compile, allocation)
    const times = [run(1), run(2), run(3)].sort((a, b) => a - b);
    gl.disableVertexAttribArray(loc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return times[1];
  } catch {
    return null;
  } finally {
    for (const del of made.reverse()) { try { del(); } catch { /* ignore */ } }
  }
}

/**
 * Probe a throwaway WebGL context: GPU strings + benchmark. Never throws; null fields when unavailable.
 * @param {{ document?: any, benchmark?: boolean }} [opts]
 */
export function probeGpu({ document: doc = typeof document !== 'undefined' ? document : null, benchmark = true } = {}) {
  const out = { vendor: '', renderer: '', software: false, benchMs: null, webgl2: false, maxTextureSize: 0 };
  if (!doc?.createElement) return out;
  let gl = null;
  try {
    const c = doc.createElement('canvas');
    c.width = 1; c.height = 1;
    gl = c.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
    out.webgl2 = !!gl;
    gl = gl || c.getContext('webgl', { antialias: false });
    if (!gl) return out;
    Object.assign(out, readGpuInfo(gl));
    out.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
    if (benchmark) out.benchMs = gpuBenchmark(gl);
  } catch { /* no WebGL */ } finally {
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
  }
  return out;
}
