import { describe, it, expect, beforeEach } from 'vitest';
import { setAnchor, clearAnchor, getAnchorRect, prefersReducedMotion } from '../../src/ui/motion';

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
