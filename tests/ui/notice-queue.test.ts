import { describe, expect, it } from 'vitest';
import { appendNoticeQueue, mergeNoticeHistory } from '../../src/ui/notice-queue';
import type { PublicNotice } from '../../src/ui/public-notices';

describe('notice queue helpers', () => {
  it('deduplicates by id and keeps the latest three notices', () => {
    const result = mergeNoticeHistory(
      [{ id: 1, kind: 'pass' }],
      [{ id: 1, kind: 'pass' }, { id: 2, kind: 'draw' }, { id: 3, kind: 'uno' }, { id: 4, kind: 'play' }],
      3
    );
    expect(result.map((n) => n.id)).toEqual([2, 3, 4]);
  });

  it('does not re-queue a replayed notice after dismissal', () => {
    const history: PublicNotice[] = [{ id: 1, kind: 'draw', actorId: 'p1', count: 1 }];
    const result = appendNoticeQueue([], history, history);
    expect(result).toEqual([]);
  });
});
