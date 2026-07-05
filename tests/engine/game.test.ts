import { describe, it, expect } from 'vitest';
import { createGame, startNextRound } from '../../src/engine/game';
import { drawFromDeck, advanceTurn, isPlayable } from '../../src/engine/helpers';
import { DEFAULT_RULES, type GameState } from '../../src/engine/types';

const seats = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Cyd' }
];

const game = (seed = 1): GameState => createGame(seats, DEFAULT_RULES, seed);

describe('createGame', () => {
  it('deals 7 cards to each player and flips a number card', () => {
    const s = game();
    for (const p of s.players) expect(p.hand).toHaveLength(7);
    const top = s.discard[s.discard.length - 1]!;
    expect(top.color).not.toBeNull();
    expect(['skip', 'reverse', 'draw2', 'wild', 'wild4']).not.toContain(top.value);
    expect(s.currentColor).toBe(top.color);
    expect(s.deck.length + s.discard.length + 21).toBe(108);
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(0);
  });

  it('is deterministic per seed', () => {
    expect(game(7)).toEqual(game(7));
    expect(game(7)).not.toEqual(game(8));
  });
});

describe('advanceTurn', () => {
  it('wraps and respects direction', () => {
    const s = game();
    advanceTurn(s);
    expect(s.turn).toBe(1);
    s.direction = -1;
    advanceTurn(s, 2);
    expect(s.turn).toBe(2); // 1 -> 0 -> 2
  });
});

describe('drawFromDeck', () => {
  it('moves cards from deck to hand', () => {
    const s = game();
    const before = s.deck.length;
    const drawn = drawFromDeck(s, 'a', 2);
    expect(drawn).toHaveLength(2);
    expect(s.deck).toHaveLength(before - 2);
    expect(s.players[0]!.hand).toHaveLength(9);
  });

  it('reshuffles discard (minus top) when the deck runs out', () => {
    const s = game();
    // Move all but 1 deck card onto the discard pile to force a reshuffle.
    s.discard.unshift(...s.deck.splice(0, s.deck.length - 1));
    const top = s.discard[s.discard.length - 1]!;
    const drawn = drawFromDeck(s, 'a', 3);
    expect(drawn).toHaveLength(3);
    expect(s.discard).toEqual([top]); // only the top card remains
    expect(s.deck.length).toBeGreaterThan(0);
  });

  it('draws as many as available if all cards are in hands', () => {
    const s = game();
    s.players[1]!.hand.push(...s.deck.splice(0, s.deck.length)); // deck empty
    s.players[1]!.hand.push(...s.discard.splice(0, s.discard.length - 1)); // only top left
    const drawn = drawFromDeck(s, 'a', 2);
    expect(drawn).toHaveLength(0); // nothing available — not an error
  });
});

describe('isPlayable', () => {
  it('matches color, value, or wild', () => {
    const s = game();
    s.discard = [{ id: 900, color: 'red', value: '5' }];
    s.currentColor = 'red';
    expect(isPlayable({ id: 1, color: 'red', value: '9' }, s)).toBe(true);
    expect(isPlayable({ id: 2, color: 'blue', value: '5' }, s)).toBe(true);
    expect(isPlayable({ id: 3, color: null, value: 'wild' }, s)).toBe(true);
    expect(isPlayable({ id: 4, color: 'blue', value: '9' }, s)).toBe(false);
  });

  it('after a wild, matches the chosen color not the card', () => {
    const s = game();
    s.discard = [{ id: 901, color: null, value: 'wild' }];
    s.currentColor = 'green';
    expect(isPlayable({ id: 5, color: 'green', value: '2' }, s)).toBe(true);
    expect(isPlayable({ id: 6, color: 'red', value: '2' }, s)).toBe(false);
  });

  it('while a +2 stack is pending, only a draw2 is playable (stacking on)', () => {
    const s = createGame(seats, { ...DEFAULT_RULES, stacking: true }, 1);
    s.pendingDraw = 2;
    s.pendingType = 'draw2';
    expect(isPlayable({ id: 7, color: 'red', value: 'draw2' }, s)).toBe(true);
    expect(isPlayable({ id: 8, color: s.currentColor, value: '3' }, s)).toBe(false);
  });

  it('while a penalty is pending with stacking off, nothing is playable', () => {
    const s = game();
    s.pendingDraw = 2;
    s.pendingType = 'draw2';
    expect(isPlayable({ id: 9, color: 'red', value: 'draw2' }, s)).toBe(false);
  });
});

describe('startNextRound', () => {
  it('re-deals, keeps scores, winner leads', () => {
    const s = game();
    s.players[2]!.score = 120;
    s.roundWinner = 'c';
    s.phase = 'roundEnd';
    const next = startNextRound(s);
    expect(next.players[2]!.score).toBe(120);
    expect(next.turn).toBe(2);
    expect(next.phase).toBe('play');
    for (const p of next.players) expect(p.hand).toHaveLength(7);
  });
});
