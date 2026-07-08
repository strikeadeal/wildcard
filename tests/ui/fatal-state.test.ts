import { describe, expect, it } from 'vitest';
import { fatalContent } from '../../src/ui/fatal-state';

describe('fatalContent', () => {
  it('does not claim certainty when a room is unreachable', () => {
    const c = fatalContent('roomUnavailable', 'KP4XQ');
    expect(c.title).toBe('Room unavailable');
    expect(c.detail).toContain('host may have left');
    expect(c.actions).toEqual(['retry', 'create', 'home']);
  });

  it('offers refresh for version mismatch', () => {
    expect(fatalContent('version', null).actions).toEqual(['refresh', 'home']);
  });
});
