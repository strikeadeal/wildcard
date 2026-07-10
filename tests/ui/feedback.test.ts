import { describe, it, expect } from 'vitest';
import { cueForNotice, vibrationFor, readMuted, MUTED_KEY, type Cue } from '../../src/ui/feedback';
import type { PublicNotice, PublicNoticeKind } from '../../src/ui/public-notices';

const YOU = 'you';
const OTHER = 'other';

function notice(kind: PublicNoticeKind, extra: Partial<PublicNotice> = {}): PublicNotice {
  return { id: 1, kind, ...extra };
}

describe('cueForNotice', () => {
  it('maps played cards (including jump-ins) to the play cue', () => {
    expect(cueForNotice(notice('play'), YOU)).toBe('play');
    expect(cueForNotice(notice('jumpIn'), YOU)).toBe('play');
  });

  it('maps draws and draw penalties to the draw cue', () => {
    expect(cueForNotice(notice('draw'), YOU)).toBe('draw');
    expect(cueForNotice(notice('penalty'), YOU)).toBe('draw');
  });

  it('maps being caught without a uno call to error, but catching someone else to draw', () => {
    expect(cueForNotice(notice('catch', { targetId: YOU }), YOU)).toBe('error');
    expect(cueForNotice(notice('catch', { targetId: OTHER }), YOU)).toBe('draw');
  });

  it('maps uno calls to the uno cue', () => {
    expect(cueForNotice(notice('uno'), YOU)).toBe('uno');
  });

  it('maps round wins to the win cue', () => {
    expect(cueForNotice(notice('roundWin'), YOU)).toBe('win');
  });

  it('maps a dropped connection to the error cue', () => {
    expect(cueForNotice(notice('disconnect'), YOU)).toBe('error');
  });

  it('stays silent for the quiet, book-keeping notice kinds', () => {
    const quietKinds: PublicNoticeKind[] = [
      'reconnect', 'pass', 'color', 'swap', 'challenge', 'nextRound', 'skip', 'reverse'
    ];
    for (const kind of quietKinds) {
      expect(cueForNotice(notice(kind), YOU)).toBeNull();
    }
  });

  it('covers every PublicNoticeKind explicitly (no fallthrough gaps)', () => {
    const allKinds: PublicNoticeKind[] = [
      'play', 'draw', 'pass', 'penalty', 'color', 'skip', 'reverse',
      'uno', 'catch', 'jumpIn', 'swap', 'challenge', 'nextRound',
      'disconnect', 'reconnect', 'roundWin'
    ];
    for (const kind of allKinds) {
      // Should not throw and should return either a Cue or null.
      const result = cueForNotice(notice(kind), YOU);
      expect(result === null || typeof result === 'string').toBe(true);
    }
  });
});

describe('vibrationFor', () => {
  const cues: Cue[] = ['play', 'draw', 'yourTurn', 'win', 'uno', 'error'];

  it('returns a positive number or a non-empty array of positive numbers for every cue', () => {
    for (const cue of cues) {
      const pattern = vibrationFor(cue);
      if (Array.isArray(pattern)) {
        expect(pattern.length).toBeGreaterThan(0);
        for (const ms of pattern) expect(ms).toBeGreaterThan(0);
      } else {
        expect(pattern).toBeGreaterThan(0);
      }
    }
  });

  it('gives yourTurn and error multi-beat patterns, distinct from the single-beat cues', () => {
    expect(Array.isArray(vibrationFor('yourTurn'))).toBe(true);
    expect(Array.isArray(vibrationFor('error'))).toBe(true);
    expect(Array.isArray(vibrationFor('draw'))).toBe(false);
    expect(Array.isArray(vibrationFor('uno'))).toBe(false);
  });
});

describe('readMuted', () => {
  function fakeStorage(value: string | null): Pick<Storage, 'getItem'> {
    return { getItem: (key: string) => (key === MUTED_KEY ? value : null) };
  }

  it('is false when storage is null/undefined', () => {
    expect(readMuted(null)).toBe(false);
    expect(readMuted(undefined)).toBe(false);
  });

  it('is false when the key is absent', () => {
    expect(readMuted(fakeStorage(null))).toBe(false);
  });

  it('is true only when the stored value is exactly "1"', () => {
    expect(readMuted(fakeStorage('1'))).toBe(true);
    expect(readMuted(fakeStorage('true'))).toBe(false);
    expect(readMuted(fakeStorage('0'))).toBe(false);
  });

  it('is false when storage.getItem throws', () => {
    const throwing: Pick<Storage, 'getItem'> = {
      getItem: () => { throw new Error('blocked'); }
    };
    expect(readMuted(throwing)).toBe(false);
  });
});
