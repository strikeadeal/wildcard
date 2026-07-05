import { describe, it, expect } from 'vitest';
import { removePlayer } from '../../src/engine/game';
import { C, fixedState } from './fixtures';

describe('removePlayer', () => {
  const state = () =>
    fixedState(
      [[C('red', '1')], [C('green', '1'), C('green', '2')], [C('yellow', '2')]],
      C('red', '5'),
      { turn: 1 }
    );

  it('returns cards to the deck bottom and removes the seat', () => {
    const s = state();
    const deckBefore = s.deck.length;
    const next = removePlayer(s, 'p1');
    expect(next.players.map((p) => p.id)).toEqual(['p0', 'p2']);
    expect(next.deck.length).toBe(deckBefore + 2);
    expect(next.deck.slice(0, 2).map((c) => c.color)).toEqual(['green', 'green']);
  });

  it('repairs the turn pointer when the current player is removed', () => {
    const next = removePlayer(state(), 'p1'); // it was p1's turn
    expect(next.players[next.turn]!.id).toBe('p2'); // play continues clockwise
    expect(next.phase).toBe('play');
  });

  it('repairs the turn pointer when an earlier seat is removed', () => {
    const next = removePlayer(state(), 'p0');
    expect(next.players[next.turn]!.id).toBe('p1'); // still p1's turn
  });

  it('ends the round when only one player remains', () => {
    const one = removePlayer(state(), 'p1');
    const alone = removePlayer(one, 'p0');
    expect(alone.phase).toBe('roundEnd');
    expect(alone.roundWinner).toBe('p2');
  });

  it('clears a pending choice phase owned by the removed player', () => {
    const s = state();
    s.phase = 'chooseColor';
    const next = removePlayer(s, 'p1');
    expect(next.phase).toBe('play');
  });
});
