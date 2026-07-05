import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs TypeScript tests', () => {
    const n: number = 2 + 2;
    expect(n).toBe(4);
  });
});
