import { describe, it, expect } from 'vitest';
import {
  ordinal, medalFor, cheerMessage, formatTime, cssColor, lighten, ITEM_ICONS, ITEM_IDS, rouletteFrame,
  countdownLabel, lapInfo, normalizeRects, hudSides, minimapRect, fitMinimap, prettyDeviceName, deviceIcon,
  trackOutlinePoints, keyHintsFor,
} from '../src/ui/hudLogic.js';

describe('formatting', () => {
  it('ordinals', () => {
    expect([1, 2, 3, 4, 8, 11, 12, 13, 21, 22, 23, 101].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '8th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
  });

  it('medals', () => {
    expect([1, 2, 3, 4, 8].map(medalFor)).toEqual(['gold', 'silver', 'bronze', 'candy', 'candy']);
  });

  it('everybody gets a cheerful message; last place is Great Driving', () => {
    for (let p = 1; p <= 8; p++) {
      const m = cheerMessage(p, 8);
      expect(m).toMatch(/!$/);
      expect(m.toLowerCase()).not.toMatch(/lose|last|bad|worst/);
    }
    expect(cheerMessage(8, 8)).toBe('Great Driving!');
    expect(cheerMessage(1, 8)).toBe('Super Champion!');
    expect(cheerMessage(4, 8)).toBe('Super Speedy!');
    expect(cheerMessage(1, 1)).toBe('Super Champion!');
  });

  it('formats race times', () => {
    expect(formatTime(83.456)).toBe('1:23.45');
    expect(formatTime(5)).toBe('0:05.00');
    expect(formatTime(0.07)).toBe('0:00.07');
    expect(formatTime(null)).toBe('--:--.--');
    expect(formatTime(NaN)).toBe('--:--.--');
  });

  it('colours', () => {
    expect(cssColor(0xff88cc)).toBe('#ff88cc');
    expect(cssColor(0x00ff)).toBe('#0000ff');
    expect(cssColor('#abc')).toBe('#abc');
    expect(cssColor(undefined, '#111111')).toBe('#111111');
    expect(lighten('#000000', 1)).toBe('#ffffff');
    expect(lighten('#ff0000', 0)).toBe('#ff0000');
    expect(lighten(0x000000, 0.5)).toBe('#808080');
  });
});

describe('items', () => {
  it('has an icon for every ItemId in the contract', () => {
    for (const id of ['sprinkle-boost', 'triple-sprinkle', 'gumdrop', 'bubble-shield', 'cupcake-rocket', 'rainbow-star']) {
      expect(ITEM_ICONS[id]).toBeTruthy();
    }
  });

  it('roulette cycles through items', () => {
    const seen = new Set();
    for (let t = 0; t < 1; t += 0.02) seen.add(rouletteFrame(t));
    expect(seen.size).toBe(ITEM_IDS.length);
    expect(rouletteFrame(-1)).toBe(ITEM_IDS[0]);
  });
});

describe('race readouts', () => {
  it('countdown labels', () => {
    expect(countdownLabel({ state: 'countdown', countdown: 2.7 })).toBe('3');
    expect(countdownLabel({ state: 'countdown', countdown: 1.2 })).toBe('2');
    expect(countdownLabel({ state: 'countdown', countdown: 0.4 })).toBe('1');
    expect(countdownLabel({ state: 'countdown', countdown: 0 })).toBe('GO!');
    expect(countdownLabel({ state: 'countdown', countdown: 9 })).toBe('3');
    expect(countdownLabel({ state: 'racing', time: 0.3 })).toBe('GO!');
    expect(countdownLabel({ state: 'racing', time: 2 })).toBe(null);
    expect(countdownLabel({ state: 'finished', time: 0.1 })).toBe(null);
    expect(countdownLabel(null)).toBe(null);
  });

  it('lap info clamps and flags the final lap', () => {
    expect(lapInfo({ lap: 1, lapsTotal: 3 })).toEqual({ lap: 1, total: 3, final: false });
    expect(lapInfo({ lap: 3, lapsTotal: 3 })).toEqual({ lap: 3, total: 3, final: true });
    expect(lapInfo({ lap: 4, lapsTotal: 3 }).lap).toBe(3);
    expect(lapInfo({ lap: 1, lapsTotal: 1 }).final).toBe(false);
  });
});

describe('layout geometry', () => {
  const W = 1280, H = 720;
  const quads = [
    { playerIndex: 0, x: 0, y: 0, w: 640, h: 360 },
    { playerIndex: 1, x: 640, y: 0, w: 640, h: 360 },
    { playerIndex: 2, x: 0, y: 360, w: 640, h: 360 },
    { playerIndex: 3, x: 640, y: 360, w: 640, h: 360 },
  ];

  it('fractions are converted to px', () => {
    expect(normalizeRects([{ playerIndex: 0, x: 0, y: 0.5, w: 1, h: 0.5 }], W, H))
      .toEqual([{ playerIndex: 0, x: 0, y: 360, w: 1280, h: 360 }]);
    expect(normalizeRects([{ playerIndex: 0, x: 0, y: 0, w: 1280, h: 720 }], W, H)[0].w).toBe(1280);
    expect(normalizeRects([], W, H)).toEqual([]);
  });

  it('hud clusters hug the outer edges', () => {
    expect(hudSides({ x: 0, y: 0, w: 1280, h: 720 }, W)).toEqual({ item: 'left', place: 'right' });
    expect(hudSides(quads[0], W)).toEqual({ item: 'left', place: 'left' });
    expect(hudSides(quads[3], W)).toEqual({ item: 'right', place: 'right' });
  });

  it('minimap placement', () => {
    const one = minimapRect([{ x: 0, y: 0, w: W, h: H }], W, H);
    expect(one.x + one.size).toBeLessThanOrEqual(W);
    expect(one.y).toBeLessThan(H / 4);
    expect(one.x).toBeGreaterThan(W / 2);

    const two = minimapRect([{ x: 0, y: 0, w: W, h: 360 }, { x: 0, y: 360, w: W, h: 360 }], W, H);
    // straddles the divider on the right edge so both halves share it
    expect(two.y).toBeLessThan(360);
    expect(two.y + two.size).toBeGreaterThan(360);
    expect(two.y + two.size / 2).toBeCloseTo(360);
    expect(two.x + two.size).toBeLessThanOrEqual(W);
    expect(two.x).toBeGreaterThan(W / 2);

    // tucked into the spectator quadrant's corner, leaving the TV view visible
    const three = minimapRect(quads.slice(0, 3), W, H);
    expect(three.x).toBeGreaterThanOrEqual(640);
    expect(three.y).toBeGreaterThanOrEqual(360);
    expect(three.x + three.size).toBeLessThanOrEqual(W);
    expect(three.y + three.size).toBeLessThanOrEqual(H);
    expect(three.size).toBeLessThanOrEqual(360 * 0.46);

    const four = minimapRect(quads, W, H);
    expect(four.x + four.size / 2).toBeCloseTo(640);
    expect(four.y + four.size / 2).toBeCloseTo(360);
  });

  it('fitMinimap keeps points inside the square and preserves aspect', () => {
    const pts = [[-100, -20], [100, -20], [100, 20], [-100, 20]];
    const f = fitMinimap(pts, 200, 0.1);
    for (const [x, z] of pts) {
      const [px, py] = f.map(x, z);
      expect(px).toBeGreaterThanOrEqual(0); expect(px).toBeLessThanOrEqual(200);
      expect(py).toBeGreaterThanOrEqual(0); expect(py).toBeLessThanOrEqual(200);
    }
    expect(f.map(-100, 0)[0]).toBeCloseTo(20);
    expect(f.map(100, 0)[0]).toBeCloseTo(180);
    expect(f.map(0, 0)[1]).toBeCloseTo(100); // vertically centred
  });

  it('track outline polygon points', () => {
    const s = trackOutlinePoints([[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]], 100, 60);
    expect(s.split(' ')).toHaveLength(4);
    expect(trackOutlinePoints([], 100, 60)).toBe('');
  });
});

describe('devices', () => {
  it('pretty names', () => {
    expect(prettyDeviceName({ id: 'gp0', type: 'gamepad', name: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)' })).toBe('Xbox 360 Controller');
    expect(prettyDeviceName({ id: 'kb1', type: 'keyboard', name: 'Keyboard 1' })).toBe('Keyboard (WASD)');
    expect(prettyDeviceName({ id: 'kb2', type: 'keyboard' })).toBe('Keyboard (Arrows)');
    expect(prettyDeviceName({ id: 'gp1', type: 'gamepad', name: '(weird)' })).toBe('Controller');
    expect(prettyDeviceName({ id: 'gp1', type: 'gamepad', name: 'A really very long controller name here' }).length).toBeLessThanOrEqual(26);
    expect(prettyDeviceName(null)).toBe('Controller');
  });

  it('key hints per keyboard', () => {
    expect(keyHintsFor('kb1').toggle).toBe('Tab');
    expect(keyHintsFor('kb2').confirm).toBe('/');
    expect(keyHintsFor('gp0')).toBe(null);
  });

  it('icons', () => {
    expect(deviceIcon('kb1')).toBe('⌨️');
    expect(deviceIcon('gp2')).toBe('🎮');
    expect(deviceIcon('x', [{ id: 'x', type: 'keyboard' }])).toBe('⌨️');
  });
});
