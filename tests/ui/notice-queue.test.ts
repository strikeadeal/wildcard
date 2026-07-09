import { describe, expect, it } from 'vitest';
import { mergeNoticeHistory } from '../../src/ui/notice-queue';

describe('notice queue helpers', () => {
  it('deduplicates by id and keeps the latest three notices', () => {
    const result = mergeNoticeHistory(
      [{ id: 1, kind: 'pass' }],
      [{ id: 1, kind: 'pass' }, { id: 2, kind: 'draw' }, { id: 3, kind: 'uno' }, { id: 4, kind: 'play' }],
      3
    );
    expect(result.map((n) => n.id)).toEqual([2, 3, 4]);
  });
});
