import { describe, expect, it } from 'vitest';
import { nextDiscardPile, discardTilt } from '../../src/ui/discard-pile';
import type { Card } from '../../src/engine/types';

function card(id: number): Card {
  return { id, color: 'red', value: '5' };
}

describe('nextDiscardPile', () => {
  it('resets to a single top card on a fresh deal', () => {
    const result = nextDiscardPile([card(1), card(2)], card(3), true);
    expect(result.map((c) => c.id)).toEqual([3]);
  });

  it('resets to empty on a fresh deal with no top yet', () => {
    expect(nextDiscardPile([card(1)], null, true)).toEqual([]);
  });

  it('leaves the pile unchanged when the top card id is unchanged (dedupe)', () => {
    const current = [card(1), card(2)];
    const result = nextDiscardPile(current, card(2), false);
    expect(result).toBe(current);
  });

  it('appends a new top card', () => {
    const result = nextDiscardPile([card(1), card(2)], card(3), false);
    expect(result.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('trims to the limit, keeping the most recent card last', () => {
    const result = nextDiscardPile([card(1), card(2), card(3)], card(4), false, 3);
    expect(result.map((c) => c.id)).toEqual([2, 3, 4]);
  });

  it('defaults the limit to 3', () => {
    const result = nextDiscardPile([card(1), card(2), card(3)], card(4), false);
    expect(result.map((c) => c.id)).toEqual([2, 3, 4]);
  });

  it('leaves the pile unchanged when there is no discard top', () => {
    const current = [card(1)];
    expect(nextDiscardPile(current, null, false)).toBe(current);
  });

  it('starts a pile from empty when the first card arrives', () => {
    const result = nextDiscardPile([], card(1), false);
    expect(result.map((c) => c.id)).toEqual([1]);
  });
});

describe('discardTilt', () => {
  it('is deterministic for the same id', () => {
    expect(discardTilt(42)).toBe(discardTilt(42));
    expect(discardTilt(7)).toBe(discardTilt(7));
  });

  it('stays within the -6..6 degree range', () => {
    for (let id = 0; id < 300; id++) {
      const tilt = discardTilt(id);
      expect(tilt).toBeGreaterThanOrEqual(-6);
      expect(tilt).toBeLessThanOrEqual(6);
    }
  });

  it('varies across different ids', () => {
    const values = new Set([0, 1, 2, 3, 4, 5].map((id) => discardTilt(id)));
    expect(values.size).toBeGreaterThan(1);
  });
});
