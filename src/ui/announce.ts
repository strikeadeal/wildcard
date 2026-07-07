import type { PlayerView } from '../engine/types';

/**
 * The client sees only before/after PlayerView snapshots — there is no event
 * stream — so game announcements are derived by diffing consecutive views.
 * This pure function holds that logic so it can be tested without Svelte state.
 */
export interface Announcement {
  /** Message to surface in the banner, or null when nothing notable happened. */
  banner: string | null;
  /** Whether the local player was the one who just played (drives fly direction). */
  fromSelf: boolean;
}

const NONE: Announcement = { banner: null, fromSelf: false };

export function deriveAnnouncement(
  prev: PlayerView | null,
  next: PlayerView
): Announcement {
  // First view of a round/session: nothing to diff against.
  if (!prev || !prev.discardTop || !next.discardTop) return NONE;

  const discardChanged = next.discardTop.id !== prev.discardTop.id;
  // The actor was on turn when they played; jump-ins fall back to "opponent".
  const fromSelf = discardChanged && prev.turnPlayerId === next.you.id;

  // A +2/+4 was just played — name whoever must now draw. Preferred over the
  // colour banner when both land on the same view (a Wild+4 implies the colour).
  if (next.pendingDraw > prev.pendingDraw) {
    const delta = next.pendingDraw - prev.pendingDraw;
    const isYou = next.turnPlayerId === next.you.id;
    const name = isYou
      ? 'You'
      : next.players.find((p) => p.id === next.turnPlayerId)?.name ?? 'Next player';
    const verb = isYou ? 'draw' : 'draws';
    return { banner: `${name} ${verb} +${delta}`, fromSelf };
  }

  // A wild's colour has settled: the new top card is a wild and the choose-colour
  // phase is over. Keying on the changed discard id fires this exactly once.
  if (
    discardChanged &&
    next.discardTop.color === null &&
    next.phase !== 'chooseColor'
  ) {
    return { banner: `Colour is now ${next.currentColor.toUpperCase()}`, fromSelf };
  }

  return { banner: null, fromSelf };
}
