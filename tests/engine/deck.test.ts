import { describe, it, expect } from 'vitest';
import { buildDeck, rng, shuffle, COLORS } from '../../src/engine/deck';

describe('buildDeck', () => {
  const deck = buildDeck();

  it('has 108 cards with unique ids', () => {
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });

  it('has correct composition', () => {
    const count = (pred: (c: (typeof deck)[number]) => boolean) => deck.filter(pred).length;
    for (const color of COLORS) {
      expect(count((c) => c.color === color && c.value === '0')).toBe(1);
      expect(count((c) => c.color === color && c.value === '5')).toBe(2);
      expect(count((c) => c.color === color && c.value === 'skip')).toBe(2);
      expect(count((c) => c.color === color && c.value === 'reverse')).toBe(2);
      expect(count((c) => c.color === color && c.value === 'draw2')).toBe(2);
    }
    expect(count((c) => c.value === 'wild')).toBe(4);
    expect(count((c) => c.value === 'wild4')).toBe(4);
    expect(count((c) => c.color === null)).toBe(8);
  });
});

describe('shuffle', () => {
  it('is deterministic for a given seed and does not mutate input', () => {
    const deck = buildDeck();
    const a = shuffle(deck, rng(42));
    const b = shuffle(deck, rng(42));
    const c = shuffle(deck, rng(43));
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a.map((x) => x.id)).not.toEqual(c.map((x) => x.id));
    expect(deck.map((x) => x.id)).toEqual(buildDeck().map((x) => x.id)); // untouched
    expect([...a].sort((x, y) => x.id - y.id)).toEqual(deck); // same cards
  });
});
