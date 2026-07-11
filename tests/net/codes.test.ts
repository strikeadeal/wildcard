import { describe, it, expect } from 'vitest';
import { newRoomCode, normalizeCode, validateCode, CODE_ALPHABET } from '../../src/net/codes';
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
    expect(normalizeCode('AB1OE')).toBeNull(); // 1 and O are not in the alphabet
    // full join-link paste also works
    expect(normalizeCode('https://x.github.io/uno/#/join/ABCDE')).toBe('ABCDE');
  });

  it('returns a field-friendly reason for malformed codes', () => {
    expect(validateCode('O0I1L')).toBe('Use 5 letters or numbers, excluding I, O, L, 0 and 1.');
    expect(validateCode('KP4XQ')).toBeNull();
  });
});
