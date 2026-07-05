import { describe, it, expect } from 'vitest';
import { apply } from '../../src/engine/apply';
import { redact } from '../../src/engine/redact';
import { C, fixedState, ok } from './fixtures';

describe('redact', () => {
  const state = () =>
    fixedState(
      [[C('red', '1'), C('blue', '4')], [C('green', '1')], [C('yellow', '2'), C('yellow', '3')]],
      C('red', '5')
    );

  it('exposes your hand and only counts for everyone else', () => {
    const v = redact(state(), 'p1');
    expect(v.you.id).toBe('p1');
    expect(v.you.hand).toHaveLength(1);
    expect(v.players.map((p) => p.cardCount)).toEqual([2, 1, 2]);
    expect(JSON.stringify(v)).not.toContain('"value":"4"'); // p0's blue 4 leaked?
    expect(v.deckCount).toBeGreaterThan(0);
    expect(v.discardTop!.value).toBe('5');
  });

  it('computes turn-holder affordances', () => {
    const v = redact(state(), 'p0');
    expect(v.turnPlayerId).toBe('p0');
    expect(v.playableCardIds).toEqual([v.you.hand[0]!.id]); // only the red 1
    expect(v.canDraw).toBe(true);
    expect(v.canPass).toBe(false);
    expect(v.canChallenge).toBe(false);
    expect(v.mustChooseColor).toBe(false);
  });

  it('computes non-turn affordances', () => {
    const v = redact(state(), 'p1');
    expect(v.playableCardIds).toEqual([]);
    expect(v.canDraw).toBe(false);
  });

  it('flags challenge and color choices', () => {
    const w4 = C(null, 'wild4');
    const s = fixedState([[w4, C('red', '1')], [C('green', '1')]], C('red', '5'));
    const mid = ok(apply(s, 'p0', { type: 'playCard', cardId: w4.id }));
    expect(redact(mid, 'p0').mustChooseColor).toBe(true);
    const chosen = ok(apply(mid, 'p0', { type: 'chooseColor', color: 'blue' }));
    const victim = redact(chosen, 'p1');
    expect(victim.canChallenge).toBe(true);
    expect(victim.pendingDraw).toBe(4);
  });

  it('flags call and catch opportunities', () => {
    const card = C('red', '1');
    const s = fixedState([[card, C('blue', '4')], [C('green', '1')]], C('red', '5'));
    expect(redact(s, 'p0').canCallUno).toBe(true); // 2 cards
    expect(redact(s, 'p1').canCallUno).toBe(true); // 1 card, has not called
    const played = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    expect(redact(played, 'p1').catchableIds).toEqual(['p0']);
    expect(redact(played, 'p0').catchableIds).toEqual([]); // not yourself
  });
});
