import type { PublicNotice } from './public-notices';

export function mergeNoticeHistory(
  current: PublicNotice[],
  incoming: PublicNotice[],
  limit = 3
): PublicNotice[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const notice of incoming) byId.set(notice.id, notice);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-limit);
}

export function appendNoticeQueue(
  current: PublicNotice[],
  incoming: PublicNotice[],
  seenNotices: PublicNotice[] = current
): PublicNotice[] {
  const seen = new Set(seenNotices.map((n) => n.id));
  return [...current, ...incoming.filter((n) => !seen.has(n.id))];
}
