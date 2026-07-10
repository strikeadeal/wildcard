import type { Card } from '../engine/types';

/**
 * The client only ever sees `discardTop` on the wire (see PlayerView) — there
 * is no discard-history event — so a shallow trailing pile is reconstructed
 * client-side by diffing consecutive tops. Pure so it can be unit-tested
 * without touching Svelte or the DOM.
 *
 * The returned array is ordered oldest-first; the last element is always the
 * current `top` (when one exists), mirroring `discardTop`.
 */
export function nextDiscardPile(
  current: Card[],
  top: Card | null,
  freshDeal: boolean,
  limit = 3
): Card[] {
  if (freshDeal) return top ? [top] : [];
  if (!top) return current;
  if (current.length > 0 && current[current.length - 1]!.id === top.id) return current;
  // slice(-0) would return the whole array, so a non-positive limit is an
  // explicit empty pile rather than an accidental unbounded one.
  if (limit <= 0) return [];
  return [...current, top].slice(-limit);
}

/**
 * Deterministic pseudo-random rotation (degrees, -6..6) for a card id — used
 * to give the discard pile a loose, hand-tossed look. Pure function of the id
 * so a card keeps the same tilt whether it's the top card or has been
 * demoted to an under-card; nothing visually jumps on demotion.
 */
export function discardTilt(cardId: number): number {
  const x = Math.sin(cardId * 12.9898 + 78.233) * 43758.5453;
  const frac = x - Math.floor(x); // 0..1
  return frac * 12 - 6;
}
