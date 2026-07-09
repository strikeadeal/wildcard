import { describe, expect, it } from 'vitest';
import type { PlayerView } from '../../src/engine/types';
import { deriveActionPrompt } from '../../src/ui/action-prompt';
import { C } from '../engine/fixtures';

function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    you: { id: 'p0', name: 'Ada', hand: [], saidUno: false, score: 0 },
    players: [
      { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 12 },
      { id: 'p1', name: 'Bob', cardCount: 5, saidUno: false, connected: true, score: 7 }
    ],
    discardTop: C('red', '5'),
    currentColor: 'red',
    deckCount: 80,
    turnPlayerId: 'p0',
    direction: 1,
    phase: 'play',
    pendingDraw: 0,
    config: { stacking: false, jumpIn: false, drawUntilPlayable: false, sevenZero: false },
    roundWinner: null,
    playableCardIds: [],
    canDraw: true,
    canPass: false,
    canChallenge: false,
    canCallUno: false,
    catchableIds: [],
    mustChooseColor: false,
    mustChooseSwapTarget: false,
    ...over
  };
}

describe('deriveActionPrompt', () => {
  it('explains a normal local turn', () => {
    expect(deriveActionPrompt(view({ canDraw: true, playableCardIds: [1] }))).toEqual({
      text: 'Your turn — play a raised card or draw.',
      tone: 'active'
    });
  });

  it('explains a stackable penalty', () => {
    expect(deriveActionPrompt(view({ pendingDraw: 4, playableCardIds: [9] }))).toEqual({
      text: 'Stack the penalty or draw 4.',
      tone: 'urgent'
    });
  });

  it('tells you to draw when a penalty cannot be stacked', () => {
    expect(deriveActionPrompt(view({ pendingDraw: 4, playableCardIds: [] }))).toEqual({
      text: 'Draw 4 cards.',
      tone: 'urgent'
    });
  });

  it('calls out an out-of-turn jump-in', () => {
    expect(deriveActionPrompt(view({ turnPlayerId: 'p1', playableCardIds: [7] }))).toEqual({
      text: 'Jump in now — you have an identical card.',
      tone: 'urgent'
    });
  });

  it('names the player being waited on', () => {
    expect(deriveActionPrompt(view({ turnPlayerId: 'p1' }))).toEqual({
      text: 'Waiting for Bob.',
      tone: 'waiting'
    });
  });

  it('covers the post-draw pass state', () => {
    expect(deriveActionPrompt(view({ canPass: true }))).toEqual({
      text: 'Play the card you drew or keep it.',
      tone: 'active'
    });
  });

  it('prioritizes colour selection', () => {
    expect(deriveActionPrompt(view({ mustChooseColor: true, turnPlayerId: 'p1' }))).toEqual({
      text: 'Choose the new colour.',
      tone: 'urgent'
    });
  });

  it('prioritizes swap-target selection', () => {
    expect(deriveActionPrompt(view({ mustChooseSwapTarget: true, turnPlayerId: 'p1' }))).toEqual({
      text: 'Choose someone to swap hands with.',
      tone: 'urgent'
    });
  });

  it('reports the round-end state', () => {
    expect(deriveActionPrompt(view({ phase: 'roundEnd' }))).toEqual({
      text: 'Round over.',
      tone: 'waiting'
    });
  });
});
