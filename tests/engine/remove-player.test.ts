import { describe, it, expect } from 'vitest';
import { removePlayer } from '../../src/engine/game';
import { apply } from '../../src/engine/apply';
import { C, fixedState, ok } from './fixtures';

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

  it('keeps the turn pointer when a later seat is removed', () => {
    const next = removePlayer(state(), 'p2'); // turn was 1 (p1)
    expect(next.players[next.turn]!.id).toBe('p1');
  });

  it('repairs the successor when the turn holder is removed in reverse direction', () => {
    const s = fixedState(
      [[C('red', '1')], [C('green', '1')], [C('yellow', '2')], [C('blue', '3')]],
      C('red', '5'),
      { turn: 2, direction: -1 }
    );
    const next = removePlayer(s, 'p2');
    expect(next.players[next.turn]!.id).toBe('p1'); // next seat in direction of play
  });

  it('clears a chooseSwapTarget phase owned by the removed player', () => {
    const s = state();
    s.phase = 'chooseSwapTarget';
    const next = removePlayer(s, 'p1');
    expect(next.phase).toBe('play');
  });

  it('a pending wild4 from a removed player stays but cannot be challenged', () => {
    const w4 = C(null, 'wild4');
    const s = fixedState(
      [[w4, C('red', '1')], [C('green', '1'), C('green', '2')], [C('yellow', '1')]],
      C('red', '5')
    );
    const played = ok(apply(s, 'p0', { type: 'playCard', cardId: w4.id, chosenColor: 'blue' }));
    const gone = removePlayer(played, 'p0');
    expect(gone.pendingDraw).toBe(4); // penalty stands
    expect(apply(gone, 'p1', { type: 'challengeWildFour' }).ok).toBe(false); // no one to challenge
    const resolved = ok(apply(gone, 'p1', { type: 'drawCard' }));
    expect(resolved.players.find((p) => p.id === 'p1')!.hand).toHaveLength(6); // 2 + 4
  });
});
