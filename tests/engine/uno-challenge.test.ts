import { describe, it, expect } from 'vitest';
import { apply } from '../../src/engine/apply';
import { C, fixedState, ok } from './fixtures';

describe('last-card call and catch', () => {
  it('calling before playing to one card protects from catch', () => {
    const card = C('red', '1');
    const s = fixedState([[card, C('blue', '4')], [C('green', '1')]], C('red', '5'));
    const called = ok(apply(s, 'p0', { type: 'callUno' }));
    expect(called.players[0]!.saidUno).toBe(true);
    const played = ok(apply(called, 'p0', { type: 'playCard', cardId: card.id }));
    expect(played.players[0]!.saidUno).toBe(true);
    expect(apply(played, 'p1', { type: 'catchUno', targetId: 'p0' }).ok).toBe(false);
  });

  it('a missed call can be caught for a 2-card penalty', () => {
    const card = C('red', '1');
    const s = fixedState([[card, C('blue', '4')], [C('green', '1')]], C('red', '5'));
    const played = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    expect(played.players[0]!.saidUno).toBe(false);
    const caught = ok(apply(played, 'p1', { type: 'catchUno', targetId: 'p0' }));
    expect(caught.players[0]!.hand).toHaveLength(3);
    // no longer at one card -> cannot catch twice
    expect(apply(caught, 'p1', { type: 'catchUno', targetId: 'p0' }).ok).toBe(false);
  });

  it('a late call at one card ends the vulnerability', () => {
    const card = C('red', '1');
    const s = fixedState([[card, C('blue', '4')], [C('green', '1')]], C('red', '5'));
    const played = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    const saved = ok(apply(played, 'p0', { type: 'callUno' }));
    expect(apply(saved, 'p1', { type: 'catchUno', targetId: 'p0' }).ok).toBe(false);
  });

  it('rejects calling with 3+ cards and catching yourself', () => {
    const s = fixedState(
      [[C('red', '1'), C('blue', '4'), C('green', '9')], [C('green', '1')]],
      C('red', '5')
    );
    expect(apply(s, 'p0', { type: 'callUno' }).ok).toBe(false);
    expect(apply(s, 'p0', { type: 'catchUno', targetId: 'p0' }).ok).toBe(false);
  });
});

describe('wild-four challenge', () => {
  const setup = (guiltyHand: ReturnType<typeof C>[]) => {
    const w4 = C(null, 'wild4');
    const s = fixedState(
      [[w4, ...guiltyHand], [C('green', '1'), C('green', '2')]],
      C('red', '5')
    );
    return ok(apply(s, 'p0', { type: 'playCard', cardId: w4.id, chosenColor: 'blue' }));
  };

  it('guilty: player held the active color — they draw 4, challenger keeps the turn', () => {
    const mid = setup([C('red', '9')]); // red was active: illegal wild4
    const next = ok(apply(mid, 'p1', { type: 'challengeWildFour' }));
    expect(next.players[0]!.hand).toHaveLength(5); // 1 kept + 4 penalty
    expect(next.players[1]!.hand).toHaveLength(2); // unchanged
    expect(next.pendingDraw).toBe(0);
    expect(next.turn).toBe(1); // challenger plays now, on blue
    expect(next.currentColor).toBe('blue');
  });

  it('innocent: challenger draws 6 and loses the turn', () => {
    const mid = setup([C('blue', '9')]); // no red in hand: legal wild4
    const next = ok(apply(mid, 'p1', { type: 'challengeWildFour' }));
    expect(next.players[1]!.hand).toHaveLength(8); // 2 + 6
    expect(next.players[0]!.hand).toHaveLength(1);
    expect(next.pendingDraw).toBe(0);
    expect(next.turn).toBe(0);
  });

  it('only the victim may challenge, and only while a wild4 is pending', () => {
    const mid = setup([C('red', '9')]);
    expect(apply(mid, 'p0', { type: 'challengeWildFour' }).ok).toBe(false);
    const resolved = ok(apply(mid, 'p1', { type: 'drawCard' }));
    expect(apply(resolved, 'p1', { type: 'challengeWildFour' }).ok).toBe(false);
  });
});
