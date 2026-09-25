/**
 * SplitScreen — viewport layout + rendering for 1–4 local players.
 *
 *   1 player : full screen
 *   2 players: top / bottom
 *   3 players: quadrants; the 4th (bottom-right) quadrant is a spectator view
 *   4 players: quadrants
 *
 * All rects are in CSS pixels with a TOP-LEFT origin (y grows down), which is
 * what the HUD wants. Rendering converts them to WebGL's bottom-left origin.
 */

import { Color } from 'three';

/** Gap (CSS px) between viewports; the renderer's clear colour shows through. */
export const VIEWPORT_GAP = 4;

/**
 * Compute viewport rects.
 * @param {number} players 1..4
 * @param {number} width CSS px
 * @param {number} height CSS px
 * @param {number} [gap]
 * @returns {{ views: Array<{playerSlot:number,x:number,y:number,w:number,h:number}>,
 *             spectator: null | {x:number,y:number,w:number,h:number} }}
 */
export function computeViewports(players, width, height, gap = VIEWPORT_GAP) {
  const n = Math.max(1, Math.min(4, Math.floor(players) || 1));
  const W = Math.max(1, Math.floor(width));
  const H = Math.max(1, Math.floor(height));
  const g = n === 1 ? 0 : gap;
  const halfW = Math.floor((W - g) / 2);
  const halfH = Math.floor((H - g) / 2);
  const rightX = halfW + g;
  const bottomY = halfH + g;
  const rightW = W - rightX;
  const bottomH = H - bottomY;

  if (n === 1) return { views: [{ playerSlot: 0, x: 0, y: 0, w: W, h: H }], spectator: null };
  if (n === 2) {
    return {
      views: [
        { playerSlot: 0, x: 0, y: 0, w: W, h: halfH },
        { playerSlot: 1, x: 0, y: bottomY, w: W, h: bottomH },
      ],
      spectator: null,
    };
  }
  const quads = [
    { x: 0, y: 0, w: halfW, h: halfH },
    { x: rightX, y: 0, w: rightW, h: halfH },
    { x: 0, y: bottomY, w: halfW, h: bottomH },
    { x: rightX, y: bottomY, w: rightW, h: bottomH },
  ];
  const views = quads.slice(0, n).map((q, i) => ({ playerSlot: i, ...q }));
  return { views, spectator: n === 3 ? { ...quads[3] } : null };
}

/** Pixel-ratio cap: sharper with fewer viewports, cheaper with more. */
export function pixelRatioFor(players, devicePixelRatio = 1) {
  const cap = players >= 3 ? 1 : players === 2 ? 1.25 : 1.5;
  return Math.max(0.5, Math.min(cap, devicePixelRatio || 1));
}

export class SplitScreen {
  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {{ dividerColor?: number }} [opts]
   */
  constructor(renderer, { dividerColor = 0xfff4fb } = {}) {
    this.renderer = renderer;
    this.dividerColor = dividerColor;
    this.players = 1;
    this.width = 1;
    this.height = 1;
    this.views = [];
    this.spectator = null;
    this._layout();
  }

  setPlayerCount(n) {
    this.players = Math.max(1, Math.min(4, n | 0));
    this._layout();
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this._layout();
  }

  _layout() {
    const { views, spectator } = computeViewports(this.players, this.width, this.height);
    this.views = views;
    this.spectator = spectator;
  }

  /** Rects for Hud.layout(): [{ playerIndex, x, y, w, h }] (playerIndices in slot order). */
  hudRects(playerIndices) {
    return this.views.map((v, i) => ({ playerIndex: playerIndices[i] ?? i, x: v.x, y: v.y, w: v.w, h: v.h }));
  }

  /** Aspect ratio of a slot (or the spectator view with slot = 'spectator'). */
  aspect(slot) {
    const r = slot === 'spectator' ? this.spectator : this.views[slot];
    return r ? r.w / Math.max(1, r.h) : 1;
  }

  /**
   * Render one camera per viewport.
   * @param {import('three').Scene} scene
   * @param {import('three').Camera[]} cameras in slot order
   * @param {import('three').Camera|null} [spectatorCamera]
   * @param {{ beforeView?: (slot:number|'spectator', cam) => void,
   *           afterView?: (slot:number|'spectator', cam) => void }} [hooks]
   *        optional per-viewport callbacks (e.g. hide karts blocking that camera)
   */
  render(scene, cameras, spectatorCamera = null, hooks = null) {
    const r = this.renderer;
    const H = this.height;
    const prevAutoClear = r.autoClear;
    r.setScissorTest(false);
    if (this.views.length > 1) {
      const prev = r.getClearColor(_c).getHex();
      const prevA = r.getClearAlpha();
      r.setClearColor(this.dividerColor, 1);
      r.clear(true, true, true);
      r.setClearColor(prev, prevA);
    }
    r.autoClear = true;
    const draw = (rect, cam, slot) => {
      if (!rect || !cam) return;
      const glY = H - rect.y - rect.h;
      r.setViewport(rect.x, glY, rect.w, rect.h);
      r.setScissor(rect.x, glY, rect.w, rect.h);
      r.setScissorTest(true);
      hooks?.beforeView?.(slot, cam);
      try {
        r.render(scene, cam);
      } finally {
        hooks?.afterView?.(slot, cam);
      }
    };
    this.views.forEach((v, i) => draw(v, cameras[i], i));
    if (this.spectator && spectatorCamera) {
      // The spectator floats high above the track: push the fog back so the
      // whole course stays bright (uniform change only, no shader rebuild).
      const fog = scene.fog;
      const near = fog?.near;
      const far = fog?.far;
      if (fog && far !== undefined) { fog.near = near * 3; fog.far = far * 3; }
      draw(this.spectator, spectatorCamera, 'spectator');
      if (fog && far !== undefined) { fog.near = near; fog.far = far; }
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.autoClear = prevAutoClear;
  }
}

const _c = new Color();
