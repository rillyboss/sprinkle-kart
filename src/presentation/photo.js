/**
 * Photo Mode (from the pause menu): a free camera around your kart, cute
 * frames, a racer sticker, and "📸 Snap!" saves a PNG. Pure logic + the 2D
 * canvas drawing of the frames (headless-testable with a fake context).
 * OWNER: showcase presentation (src/systems/photoMode.js, src/ui/screens/photoMode.js).
 *
 *   let st = createPhotoState();
 *   const r = photoReduce(st, { action: 'left' });   // { state, fx, snap, go }
 *   const pose = photoCameraPose(kart.position, kart.heading, st);
 *   drawPhotoFrame(ctx2d, w, h, st.frame, { title, emoji, date });
 */

export const PHOTO_FRAMES = Object.freeze([
  { id: 'polaroid', label: 'Snapshot', emoji: '🖼️' },
  { id: 'hearts', label: 'Hearts', emoji: '💖' },
  { id: 'sprinkles', label: 'Sprinkles', emoji: '🍭' },
  { id: 'stars', label: 'Stars', emoji: '⭐' },
  { id: 'none', label: 'No frame', emoji: '⬜' },
]);

export const PHOTO_LIMITS = Object.freeze({ distMin: 2.6, distMax: 16, pitchMin: -0.05, pitchMax: 1.2, yawStep: Math.PI / 12, distStep: 1.1, pitchStep: 0.12 });

export function createPhotoState() {
  return { yaw: Math.PI * 0.8, pitch: 0.28, dist: 6.5, frame: 0, snaps: 0 };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Photo mode input.
 *   left/right  orbit       up/down  closer / further (hold: keeps going)
 *   toggle (Y)  next frame  start    tilt up (loops back down)
 *   confirm (A) snap a photo          back (B)  back to the pause menu
 * @returns {{ state, fx: string[], snap: boolean, go: null|'back' }}
 */
export function photoReduce(state, ev = {}) {
  const L = PHOTO_LIMITS;
  const res = { state, fx: [], snap: false, go: null };
  const set = (patch, fx = 'move') => { res.state = { ...state, ...patch }; if (fx) res.fx.push(fx); };
  switch (ev.action) {
    case 'left': set({ yaw: state.yaw - L.yawStep }); break;
    case 'right': set({ yaw: state.yaw + L.yawStep }); break;
    case 'up': set({ dist: clamp(state.dist - L.distStep, L.distMin, L.distMax) }); break;
    case 'down': set({ dist: clamp(state.dist + L.distStep, L.distMin, L.distMax) }); break;
    case 'start': {
      const next = state.pitch + L.pitchStep * 2;
      set({ pitch: next > L.pitchMax + 1e-9 ? L.pitchMin : next });
      break;
    }
    case 'toggle': set({ frame: (state.frame + 1) % PHOTO_FRAMES.length }, 'confirm'); break;
    case 'confirm':
    case 'select':
      res.snap = true;
      res.state = { ...state, snaps: state.snaps + 1 };
      break;
    case 'back': res.go = 'back'; res.fx.push('back'); break;
    default: break;
  }
  return res;
}

/**
 * Where the photo camera is: orbiting the kart (yaw relative to its heading,
 * 0 = behind), `pitch` up, `dist` away, looking at the driver.
 * @returns {{ pos: {x,y,z}, look: {x,y,z} }}
 */
export function photoCameraPose(kartPos, heading, state) {
  const yaw = (Number(heading) || 0) + Math.PI + (Number(state?.yaw) || 0);
  const pitch = clamp(Number(state?.pitch) || 0, PHOTO_LIMITS.pitchMin, PHOTO_LIMITS.pitchMax);
  const dist = clamp(Number(state?.dist) || 6, PHOTO_LIMITS.distMin, PHOTO_LIMITS.distMax);
  const flat = Math.cos(pitch) * dist;
  const p = kartPos ?? { x: 0, y: 0, z: 0 };
  return {
    pos: { x: p.x + Math.sin(yaw) * flat, y: p.y + 1.0 + Math.sin(pitch) * dist, z: p.z + Math.cos(yaw) * flat },
    look: { x: p.x, y: p.y + 1.0, z: p.z },
  };
}

/** "sprinkle-kart-gumdrop-meadow-2026-09-25-14-05-09.png" */
export function photoFileName(trackId, date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
  const safe = String(trackId || 'race').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'race';
  return `sprinkle-kart-${safe}-${stamp}.png`;
}

/** Friendly date for the snapshot caption: "25 Sep 2026". */
export function captionDate(date = new Date()) {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
}

const CANDY = ['#ff5fb4', '#6cc4ff', '#ffd95e', '#6fe3bf', '#b48cff', '#ff9f80'];

/**
 * Draw a frame (and the sticker / caption) over a photo on a 2D canvas context.
 * Only uses the basic CanvasRenderingContext2D API.
 * @param {CanvasRenderingContext2D} g
 * @param {number} w
 * @param {number} h
 * @param {number|string} frame index into PHOTO_FRAMES or its id
 * @param {{ title?: string, emoji?: string, date?: string }} [info]
 * @returns {string} the frame id that was drawn
 */
export function drawPhotoFrame(g, w, h, frame, { title = 'Sprinkle Kart', emoji = '🏎️', date = '' } = {}) {
  const def = typeof frame === 'string' ? PHOTO_FRAMES.find((f) => f.id === frame) : PHOTO_FRAMES[frame];
  const id = def?.id ?? 'none';
  const u = Math.max(1, Math.min(w, h) / 100); // 1% of the short side
  const font = (px, weight = 700) => `${weight} ${Math.round(px)}px Fredoka, 'Baloo 2', Nunito, sans-serif`;
  g.save();
  if (id === 'polaroid') {
    const side = 3 * u;
    const bottom = 13 * u;
    g.fillStyle = '#fffaf2';
    g.fillRect(0, 0, w, side);
    g.fillRect(0, 0, side, h);
    g.fillRect(w - side, 0, side, h);
    g.fillRect(0, h - bottom, w, bottom);
    g.fillStyle = '#6b3a7a';
    g.font = font(5.4 * u);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${emoji} ${title}`, side + 2 * u, h - bottom / 2);
    if (date) {
      g.font = font(3.6 * u, 600);
      g.textAlign = 'right';
      g.fillStyle = '#9a6aa8';
      g.fillText(date, w - side - 2 * u, h - bottom / 2);
    }
  } else if (id === 'hearts' || id === 'stars') {
    const glyph = id === 'hearts' ? '♥' : '★';
    const size = 7 * u;
    g.font = font(size);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let i = 0;
    const put = (x, y) => { g.fillStyle = CANDY[i++ % CANDY.length]; g.fillText(glyph, x, y); };
    const stepX = size * 1.25;
    for (let x = size / 2; x < w; x += stepX) { put(x, size / 2); put(x, h - size / 2); }
    for (let y = size * 1.75; y < h - size; y += stepX) { put(size / 2, y); put(w - size / 2, y); }
  } else if (id === 'sprinkles') {
    const band = 5 * u;
    g.fillStyle = '#fff0f8';
    g.fillRect(0, 0, w, band);
    g.fillRect(0, h - band, w, band);
    g.fillRect(0, 0, band, h);
    g.fillRect(w - band, 0, band, h);
    let i = 0;
    const dash = (x, y, a) => {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.fillStyle = CANDY[i % CANDY.length];
      g.fillRect(-1.6 * u, -0.5 * u, 3.2 * u, 1 * u);
      g.restore();
      i++;
    };
    for (let x = band / 2; x < w; x += 3.4 * u) { dash(x, band / 2, (i * 1.7) % Math.PI); dash(x, h - band / 2, (i * 2.3) % Math.PI); }
    for (let y = band * 1.5; y < h - band; y += 3.4 * u) { dash(band / 2, y, (i * 1.3) % Math.PI); dash(w - band / 2, y, (i * 2.9) % Math.PI); }
  }
  if (id !== 'polaroid') {
    // a little logo sticker in the corner
    const pad = (id === 'none' ? 2.5 : 8) * u;
    g.font = font(4.2 * u);
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.lineWidth = 1.2 * u;
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ff5fb4';
    const text = `${emoji} ${title}`;
    g.strokeText(text, w - pad, h - pad);
    g.fillText(text, w - pad, h - pad);
  }
  g.restore();
  return id;
}
