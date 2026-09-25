import { describe, it, expect } from 'vitest';
import { blocksView, hideOccluders, restoreKarts } from '../src/render/occlusion.js';
import { cameraTweak } from '../src/render/CameraRig.js';
import { isWrongWay } from '../src/race/Kart.js';

const v = (x, y, z) => ({ x, y, z });

describe('chase-camera occlusion', () => {
  const cam = v(0, 2.7, -5.9);
  const own = v(0, 0, 0);

  it('hides karts hugging the lens or sitting on the sight line', () => {
    expect(blocksView(cam, own, v(1, 0, -4))).toBe(true); // right next to the camera
    expect(blocksView(cam, own, v(0.5, 0, -2.2))).toBe(true); // between camera and own kart
  });

  it('keeps karts beside, ahead of or far from the player visible', () => {
    expect(blocksView(cam, own, v(3.4, 0, 0))).toBe(false); // alongside
    expect(blocksView(cam, own, v(0, 0, 6))).toBe(false); // ahead
    expect(blocksView(cam, own, v(0, 0, -30))).toBe(false); // well behind the camera
    expect(blocksView(cam, own, v(4, 0, -2.5))).toBe(false); // off to the side of the sight line
  });

  it('hides for one view and restores afterwards', () => {
    const mk = (p) => ({ position: p, model: { group: { visible: true } } });
    const me = mk(own);
    const blocker = mk(v(0.3, 0, -2.5));
    const friend = mk(v(3.4, 0, 1));
    const hidden = hideOccluders([me, blocker, friend], me, { position: cam });
    expect(blocker.model.group.visible).toBe(false);
    expect(friend.model.group.visible).toBe(true);
    expect(me.model.group.visible).toBe(true);
    restoreKarts(hidden);
    expect(blocker.model.group.visible).toBe(true);
    expect(hidden.length).toBe(0);
  });
});

describe('camera tweak per character', () => {
  it('reads CharacterDef.camera offsets, defaulting to zero', () => {
    expect(cameraTweak({ charDef: { camera: { height: 0.4, lookHeight: -0.2 } } })).toEqual({ height: 0.4, lookHeight: -0.2 });
    expect(cameraTweak({ charDef: null })).toEqual({ height: 0, lookHeight: 0 });
    expect(cameraTweak(null)).toEqual({ height: 0, lookHeight: 0 });
  });
});

describe('wrong-way hint', () => {
  it('shows after 1 s backwards while moving, or 1.5 s even when stalled', () => {
    expect(isWrongWay(0.5, 10)).toBe(false);
    expect(isWrongWay(1.1, 10)).toBe(true);
    expect(isWrongWay(1.1, 0.2)).toBe(false);
    expect(isWrongWay(1.6, 0.2)).toBe(true);
    expect(isWrongWay(1.6, 0)).toBe(true);
  });
});

describe('swept pickup checks', () => {
  it('catches a gumdrop or box the kart skipped over during a slow frame', async () => {
    const { sweptDistSq } = await import('../src/race/Kart.js');
    const kart = { position: { x: 0, z: 4.3 }, phys: { frameStartX: 0, frameStartZ: 0 } };
    expect(sweptDistSq(kart, 0.4, 2.1)).toBeCloseTo(0.16, 5); // passed right through it
    expect(sweptDistSq(kart, 0, 6)).toBeCloseTo(1.7 * 1.7, 5); // ahead of the end point
    expect(sweptDistSq({ position: { x: 1, z: 1 }, phys: {} }, 1, 3)).toBeCloseTo(4, 5); // no history: point test
  });
});
