import { describe, it, expect, beforeEach } from 'vitest';
import { setAnchor, clearAnchor, getAnchorRect, prefersReducedMotion, dealDelay } from '../../src/ui/motion';

function fakeEl(rect: Partial<DOMRect>): HTMLElement {
  return { getBoundingClientRect: () => rect as DOMRect } as unknown as HTMLElement;
}

describe('anchor registry', () => {
  beforeEach(() => { clearAnchor('deck'); });

  it('returns null for an unregistered key', () => {
    expect(getAnchorRect('deck')).toBeNull();
  });

  it('returns the element rect once registered', () => {
    setAnchor('deck', fakeEl({ left: 10, top: 20, width: 30, height: 40 }));
    expect(getAnchorRect('deck')).toMatchObject({ left: 10, top: 20, width: 30, height: 40 });
  });

  it('returns null after the anchor is cleared', () => {
    setAnchor('deck', fakeEl({ left: 1 }));
    clearAnchor('deck');
    expect(getAnchorRect('deck')).toBeNull();
  });
});

describe('prefersReducedMotion', () => {
  it('is false when matchMedia is unavailable (node/test env)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('dealDelay', () => {
  it('is zero for every index when not staggering (stagger=false)', () => {
    expect(dealDelay(0, false, false)).toBe(0);
    expect(dealDelay(3, false, false)).toBe(0);
    expect(dealDelay(9, false, false)).toBe(0);
  });

  it('is zero for every index under reduced motion, even while staggering', () => {
    expect(dealDelay(0, true, true)).toBe(0);
    expect(dealDelay(5, true, true)).toBe(0);
  });

  it('is monotonically non-decreasing in index while staggering', () => {
    const delays = [0, 1, 2, 3, 4, 5].map((i) => dealDelay(i, true, false));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
    }
  });

  it('scales by the default step (55ms) below the cap', () => {
    expect(dealDelay(0, true, false)).toBe(0);
    expect(dealDelay(1, true, false)).toBe(55);
    expect(dealDelay(4, true, false)).toBe(220);
  });

  it('caps the delay at index 9 by default (495ms)', () => {
    expect(dealDelay(9, true, false)).toBe(495);
    expect(dealDelay(20, true, false)).toBe(495);
  });

  it('honors custom step and cap arguments', () => {
    expect(dealDelay(2, true, false, 10, 5)).toBe(20);
    expect(dealDelay(8, true, false, 10, 5)).toBe(50);
  });
});
