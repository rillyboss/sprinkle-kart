/**
 * The Item Guide screen: every item with icon + one friendly sentence, reached
 * from the title screen's menu row, navigable with pads / keys.
 */
import { describe, it, expect } from 'vitest';
import itemGuide, { guideRows, guideReduce } from '../src/ui/screens/itemGuide.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { menuEntries } from '../src/ui/screenFlow.js';
import { ITEM_ORDER } from '../src/race/itemCatalog.js';

const BANNED = /\b(hit|hits|kill|crash|destroy|attack|shoot|explode|dead|die|hurt|weapon|bomb|blast)\b/i;

describe('item guide', () => {
  it('has one row per item, in order, with icon, name and a friendly sentence', () => {
    const rows = guideRows();
    expect(rows.map((r) => r.id)).toEqual([...ITEM_ORDER]);
    for (const r of rows) {
      expect(r.emoji).toMatch(/\p{Extended_Pictographic}/u);
      expect(r.name.length).toBeGreaterThan(3);
      expect(r.text).toMatch(/[.!]$/);
      expect(r.text).not.toMatch(BANNED);
      expect(r.tip).not.toMatch(BANNED);
    }
  });

  it('is registered as a screen with a title-screen menu entry', () => {
    expect(SCREENS.get('item-guide')).toBe(itemGuide);
    expect(itemGuide.flow).toBeUndefined(); // not part of the pre-race flow
    const entries = menuEntries(SCREENS, 'title');
    expect(entries.find((e) => e.id === 'item-guide')).toMatchObject({ label: 'Item Guide', emoji: '🎁' });
  });

  it('arrows walk the 2-column grid (wrapping); A / B / Start go back', () => {
    expect(guideReduce(0, 'right')).toMatchObject({ index: 1, moved: true, leave: false });
    expect(guideReduce(0, 'left').index).toBe(5);
    expect(guideReduce(0, 'down').index).toBe(2);
    expect(guideReduce(1, 'up').index).toBe(5);
    expect(guideReduce(4, 'down').index).toBe(0);
    for (const a of ['confirm', 'back', 'start']) expect(guideReduce(3, a)).toMatchObject({ index: 3, leave: true });
    expect(guideReduce(3, 'toggle')).toMatchObject({ index: 3, leave: false, moved: false });
    expect(guideReduce(99, 'right').index).toBe(0); // clamps a bad index first
  });
});
