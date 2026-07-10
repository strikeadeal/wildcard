import type { Card, PlayerView } from '../engine/types';

/**
 * The client sees only before/after PlayerView snapshots — there is no event
 * stream — so both game announcements and animation triggers are derived by
 * diffing consecutive views. This pure function is that single diff pass, kept
 * out of Svelte so it can be unit-tested.
 */
export type GameEvent =
  | { kind: 'draw'; playerId: string; n: number; toSelf: boolean }
  | { kind: 'special'; card: Card }
  | { kind: 'uno'; playerId: string; isYou: boolean }
  | { kind: 'win'; winnerId: string; isYou: boolean };

export interface ViewChange {
  /** Whether the local player made the most recent play (drives fly direction). */
  fromSelf: boolean;
  /** The single most salient animation trigger for this transition, if any. */
  event: GameEvent | null;
}

const SPECIAL = new Set<string>(['skip', 'reverse', 'draw2', 'wild4']);

/** A fresh 7-card deal only follows round-end (or the very first view). */
function isDeal(prev: PlayerView | null): boolean {
  return prev === null || prev.phase === 'roundEnd';
}

/** Fly direction for the discard animation — logic preserved verbatim from deriveAnnouncement. */
function deriveFromSelf(prev: PlayerView | null, next: PlayerView): boolean {
  if (!prev || !prev.discardTop || !next.discardTop) return false;
  return prev.discardTop.id !== next.discardTop.id && prev.turnPlayerId === next.you.id;
}

/** At most one animation event per transition, most-salient first. */
function deriveEvent(prev: PlayerView | null, next: PlayerView): GameEvent | null {
  // Win outranks everything — even a special final card ends the round.
  if (next.phase === 'roundEnd' && !isDeal(prev) && next.roundWinner) {
    return { kind: 'win', winnerId: next.roundWinner, isYou: next.roundWinner === next.you.id };
  }

  if (!prev) return null;

  // Special card: the discard top just became a skip / reverse / +2 / +4.
  const discardChanged = !!next.discardTop && next.discardTop.id !== prev.discardTop?.id;
  if (discardChanged && next.discardTop && SPECIAL.has(next.discardTop.value)) {
    return { kind: 'special', card: next.discardTop };
  }

  // Draw: a player's hand grew, and it is not a fresh deal.
  if (!isDeal(prev)) {
    for (const p of next.players) {
      const before = prev.players.find((q) => q.id === p.id);
      if (before && p.cardCount > before.cardCount) {
        return { kind: 'draw', playerId: p.id, n: p.cardCount - before.cardCount, toSelf: p.id === next.you.id };
      }
    }
  }

  // UNO: a player just called "last card" while holding one.
  for (const p of next.players) {
    const before = prev.players.find((q) => q.id === p.id);
    if (before && !before.saidUno && p.saidUno && p.cardCount === 1) {
      return { kind: 'uno', playerId: p.id, isYou: p.id === next.you.id };
    }
  }

  return null;
}

export function deriveViewChange(prev: PlayerView | null, next: PlayerView): ViewChange {
  return { fromSelf: deriveFromSelf(prev, next), event: deriveEvent(prev, next) };
}
