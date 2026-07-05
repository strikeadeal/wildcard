import { rng, shuffle } from './deck';
import type { Card, GameState } from './types';

export function playerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((p) => p.id === playerId);
}

export function topCard(state: GameState): Card | null {
  return state.discard[state.discard.length - 1] ?? null;
}

/** Mutates state. Steps defaults to 1; respects direction; wraps. */
export function advanceTurn(state: GameState, steps = 1): void {
  const n = state.players.length;
  state.turn = (((state.turn + state.direction * steps) % n) + n) % n;
  state.hasDrawnThisTurn = false;
  state.drawnCardId = null;
}

/**
 * Mutates state: moves `count` cards from deck to the player's hand.
 * Reshuffles discard-minus-top into the deck when it runs dry (advances seed).
 * Returns the cards actually drawn (may be fewer if the table runs out).
 */
export function drawFromDeck(state: GameState, playerId: string, count: number): Card[] {
  const player = state.players[playerIndex(state, playerId)]!;
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (state.deck.length === 0) {
      if (state.discard.length <= 1) break; // nothing left anywhere
      const top = state.discard.pop()!;
      state.seed = (state.seed + 1) >>> 0;
      state.deck = shuffle(state.discard, rng(state.seed));
      state.discard = [top];
    }
    const card = state.deck.pop()!;
    drawn.push(card);
    player.hand.push(card);
    player.saidUno = false; // gaining cards always clears the call
  }
  return drawn;
}

export function isPlayable(card: Card, state: GameState): boolean {
  if (state.pendingDraw > 0) {
    if (!state.config.stacking) return false;
    return card.value === state.pendingType; // only like-on-like stacks
  }
  if (card.color === null) return true; // wild / wild4 (legality of wild4 checked at play time)
  const top = topCard(state);
  return card.color === state.currentColor || (top !== null && card.value === top.value);
}

/** Cards `playerId` may legally play RIGHT NOW (their turn, or a jump-in). */
export function playableCardIds(state: GameState, playerId: string): number[] {
  if (state.phase !== 'play') return [];
  const idx = playerIndex(state, playerId);
  if (idx === -1) return [];
  const player = state.players[idx]!;
  if (state.turn === idx) {
    if (state.hasDrawnThisTurn) {
      const drawn = player.hand.find((c) => c.id === state.drawnCardId);
      return drawn && isPlayable(drawn, state) ? [drawn.id] : [];
    }
    return player.hand.filter((c) => isPlayable(c, state)).map((c) => c.id);
  }
  if (state.config.jumpIn && state.pendingDraw === 0) {
    const top = topCard(state);
    if (!top || top.color === null) return []; // no jump-in on wilds
    return player.hand
      .filter((c) => c.color === top.color && c.value === top.value)
      .map((c) => c.id);
  }
  return [];
}
