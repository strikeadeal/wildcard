import { describe, it, expect } from 'vitest';
import { codeToPeerId, newRoomCode, normalizeCode, CODE_ALPHABET } from '../../src/net/codes';
import { rng } from '../../src/engine/deck';

describe('room codes', () => {
  it('generates 5-char codes from the unambiguous alphabet', () => {
    for (let seed = 0; seed < 50; seed++) {
      const code = newRoomCode(rng(seed));
      expect(code).toHaveLength(5);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('never contains ambiguous characters', () => {
    for (const bad of ['I', 'O', '0', '1', 'L']) expect(CODE_ALPHABET).not.toContain(bad);
  });

  it('normalizes user input', () => {
    expect(normalizeCode('  ab-cde ')).toBe('ABCDE');
    expect(normalizeCode('abcde')).toBe('ABCDE');
    expect(normalizeCode('ab')).toBeNull();
    expect(normalizeCode('ABC!E')).toBeNull();
    // full join-link paste also works
    expect(normalizeCode('https://x.github.io/uno/#/join/ABCDE')).toBe('ABCDE');
  });

  it('maps codes to namespaced peer ids', () => {
    expect(codeToPeerId('ABCDE')).toBe('wildcard-ABCDE');
  });
});
