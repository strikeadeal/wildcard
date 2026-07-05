import { DEFAULT_RULES, type Card, type CardValue, type Color, type GameState } from '../../src/engine/types';
import { buildDeck } from '../../src/engine/deck';

let nextId = 1000;

/** Card factory. `C('red','5')` or `C(null,'wild')`. Ids unique unless given. */
export function C(color: Color | null, value: CardValue, id?: number): Card {
  return { id: id ?? nextId++, color, value };
}

const NAMES = ['Ada', 'Bob', 'Cyd', 'Dee', 'Eli', 'Fay'];

/**
 * Deterministic state for rule tests: player i gets hands[i], `top` is the
 * discard top (currentColor follows it unless overridden), rest of a fresh
 * deck (ids 0-107, never colliding with C() ids >= 1000) forms the draw pile.
 */
export function fixedState(
  hands: Card[][],
  top: Card,
  overrides: Partial<GameState> = {}
): GameState {
  return {
    config: DEFAULT_RULES,
    players: hands.map((hand, i) => ({
      id: 'p' + i, name: NAMES[i]!, hand: [...hand], saidUno: false, connected: true, score: 0
    })),
    deck: buildDeck(),
    discard: [top],
    currentColor: top.color ?? 'red',
    turn: 0,
    direction: 1,
    phase: 'play',
    pendingDraw: 0,
    pendingType: null,
    wild4PrevColor: null,
    wild4PlayedBy: null,
    hasDrawnThisTurn: false,
    drawnCardId: null,
    roundWinner: null,
    seed: 1,
    ...overrides
  };
}

/** Unwraps ApplyResult or fails the test with the rule error. */
export function ok(r: { ok: true; state: GameState } | { ok: false; error: string }): GameState {
  if (!r.ok) throw new Error('expected ok, got error: ' + r.error);
  return r.state;
}
