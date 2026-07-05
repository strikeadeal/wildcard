import { describe, it, expect } from 'vitest';
import { apply } from '../../src/engine/apply';
import { playableCardIds } from '../../src/engine/helpers';
import { DEFAULT_RULES } from '../../src/engine/types';
import { C, fixedState, ok } from './fixtures';

describe('stacking', () => {
  it('+2 stacks onto +2 and the total lands on the last victim', () => {
    const a = C('red', 'draw2');
    const b = C('blue', 'draw2');
    const s = fixedState(
      [[a, C('red', '1')], [b, C('green', '1')], [C('yellow', '1')]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, stacking: true } }
    );
    const one = ok(apply(s, 'p0', { type: 'playCard', cardId: a.id }));
    const two = ok(apply(one, 'p1', { type: 'playCard', cardId: b.id }));
    expect(two.pendingDraw).toBe(4);
    const resolved = ok(apply(two, 'p2', { type: 'drawCard' }));
    expect(resolved.players[2]!.hand).toHaveLength(5);
    expect(resolved.pendingDraw).toBe(0);
  });

  it('stacking off: the victim cannot answer a +2 with a +2', () => {
    const a = C('red', 'draw2');
    const b = C('blue', 'draw2');
    const s = fixedState([[a, C('red', '1')], [b, C('green', '1')], [C('yellow', '1')]], C('red', '5'));
    const one = ok(apply(s, 'p0', { type: 'playCard', cardId: a.id }));
    expect(apply(one, 'p1', { type: 'playCard', cardId: b.id }).ok).toBe(false);
  });

  it('wild4 stacks onto wild4', () => {
    const a = C(null, 'wild4');
    const b = C(null, 'wild4');
    const s = fixedState(
      [[a, C('red', '1')], [b, C('green', '1')], [C('yellow', '1')]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, stacking: true } }
    );
    const one = ok(apply(s, 'p0', { type: 'playCard', cardId: a.id, chosenColor: 'blue' }));
    const two = ok(apply(one, 'p1', { type: 'playCard', cardId: b.id, chosenColor: 'green' }));
    expect(two.pendingDraw).toBe(8);
    expect(apply(two, 'p2', { type: 'challengeWildFour' }).ok).toBe(false); // stacked: no challenge
  });
});

describe('jump-in', () => {
  const jumpState = () => {
    const dup = C('red', '5');
    const s = fixedState(
      [[C('blue', '1'), C('blue', '2')], [C('green', '1')], [dup, C('yellow', '3')]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, jumpIn: true } }
    );
    return { s, dup };
  };

  it('an identical card may be played out of turn and play continues from there', () => {
    const { s, dup } = jumpState();
    expect(playableCardIds(s, 'p2')).toEqual([dup.id]);
    const next = ok(apply(s, 'p2', { type: 'jumpIn', cardId: dup.id }));
    expect(next.discard[next.discard.length - 1]!.id).toBe(dup.id);
    expect(next.turn).toBe(0); // after p2, direction 1 wraps to p0
  });

  it('rejects jump-in with a non-identical card or when the rule is off', () => {
    const { s } = jumpState();
    const wrong = s.players[1]!.hand[0]!;
    expect(apply(s, 'p1', { type: 'jumpIn', cardId: wrong.id }).ok).toBe(false);
    // identical card, but the rule is off (DEFAULT_RULES)
    const off = fixedState([[C('blue', '1')], [C('red', '5', 555)]], C('red', '5'));
    expect(apply(off, 'p1', { type: 'jumpIn', cardId: 555 }).ok).toBe(false);
  });
});

describe('draw-until-playable', () => {
  it('draws through unplayable cards and offers the playable one', () => {
    const s = fixedState(
      [[C('blue', '9')], [C('green', '1')]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, drawUntilPlayable: true } }
    );
    // deck pops from the end: two duds after the playable one means duds come first
    s.deck = [C('red', '8', 800), C('blue', '2'), C('green', '2')];
    const next = ok(apply(s, 'p0', { type: 'drawCard' }));
    expect(next.players[0]!.hand).toHaveLength(4); // 1 + 3 drawn
    expect(next.drawnCardId).toBe(800);
    expect(next.turn).toBe(0); // may play it or pass
  });
});

describe('seven-zero', () => {
  it('a 7 swaps hands with the chosen player', () => {
    const seven = C('red', '7');
    const mine = C('blue', '9');
    const theirs = [C('green', '1'), C('green', '2'), C('green', '3')];
    const s = fixedState(
      [[seven, mine], [theirs[0]!, theirs[1]!, theirs[2]!], [C('yellow', '1')]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, sevenZero: true } }
    );
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: seven.id, swapTargetId: 'p1' }));
    expect(next.players[0]!.hand.map((c) => c.id)).toEqual(theirs.map((c) => c.id));
    expect(next.players[1]!.hand.map((c) => c.id)).toEqual([mine.id]);
    expect(next.turn).toBe(1);
  });

  it('a 7 without an inline target pauses for chooseSwapTarget', () => {
    const seven = C('red', '7');
    const s = fixedState(
      [[seven, C('blue', '9')], [C('green', '1')], [C('yellow', '1')]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, sevenZero: true } }
    );
    const mid = ok(apply(s, 'p0', { type: 'playCard', cardId: seven.id }));
    expect(mid.phase).toBe('chooseSwapTarget');
    expect(apply(mid, 'p0', { type: 'chooseSwapTarget', targetId: 'p0' }).ok).toBe(false);
    const next = ok(apply(mid, 'p0', { type: 'chooseSwapTarget', targetId: 'p2' }));
    expect(next.phase).toBe('play');
    expect(next.players[0]!.hand[0]!.color).toBe('yellow');
  });

  it('a 0 rotates all hands in direction of play', () => {
    const zero = C('red', '0');
    const s = fixedState(
      [[zero, C('blue', '9')], [C('green', '1')], [C('yellow', '1')]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, sevenZero: true } }
    );
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: zero.id }));
    // direction 1: each hand moves to the next player; p0's leftover blue 9 goes to p1
    expect(next.players[1]!.hand[0]!.color).toBe('blue');
    expect(next.players[2]!.hand[0]!.color).toBe('green');
    expect(next.players[0]!.hand[0]!.color).toBe('yellow');
    expect(next.turn).toBe(1);
  });

  it('winning with a 7 or 0 ends the round with no swap or rotate', () => {
    const seven = C('red', '7');
    const s = fixedState(
      [[seven], [C('green', '1'), C('green', '2')]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, sevenZero: true } }
    );
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: seven.id }));
    expect(next.phase).toBe('roundEnd');
    expect(next.roundWinner).toBe('p0');
    expect(next.players[1]!.hand).toHaveLength(2); // untouched
  });

  it('with seven-zero OFF, a 7 is just a number card', () => {
    const seven = C('red', '7');
    const s = fixedState([[seven, C('blue', '9')], [C('green', '1')]], C('red', '5'));
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: seven.id, swapTargetId: 'p1' }));
    expect(next.players[0]!.hand[0]!.color).toBe('blue'); // no swap
    expect(next.turn).toBe(1);
  });
});
