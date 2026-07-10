import { describe, it, expect } from 'vitest';
import { deriveViewChange } from '../../src/ui/events';
import type { Card, PlayerView } from '../../src/engine/types';
import { C } from '../engine/fixtures';

/** Minimal PlayerView builder; `you` is 'p0', opponents 'p1'/'p2'. */
function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    you: { id: 'p0', name: 'Ada', hand: [], saidUno: false, score: 0 },
    players: [
      { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 0 },
      { id: 'p1', name: 'Bob', cardCount: 5, saidUno: false, connected: true, score: 0 },
      { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
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

describe('deriveViewChange — fromSelf (drives fly direction)', () => {
  it('is false on the first view (no prior state)', () => {
    expect(deriveViewChange(null, view()).fromSelf).toBe(false);
  });

  it('reports fromSelf when the local player played', () => {
    const prev = view({ discardTop: C('red', '5'), turnPlayerId: 'p0' });
    const next = view({ discardTop: C('red', '7'), turnPlayerId: 'p1' });
    expect(deriveViewChange(prev, next).fromSelf).toBe(true);
  });

  it('does not flag fromSelf when the discard did not change', () => {
    const top: Card = C('red', '5');
    const prev = view({ discardTop: top, turnPlayerId: 'p0' });
    const next = view({ discardTop: top, turnPlayerId: 'p0', deckCount: 79 });
    expect(deriveViewChange(prev, next).fromSelf).toBe(false);
  });

  it('reports not fromSelf when an opponent played', () => {
    const prev = view({ discardTop: C('red', '5'), turnPlayerId: 'p1' });
    const next = view({ discardTop: C('red', '7'), turnPlayerId: 'p2' });
    expect(deriveViewChange(prev, next).fromSelf).toBe(false);
  });
});

describe('deriveViewChange — animation events', () => {
  it('emits a draw event when an opponent gains cards mid-game', () => {
    const prev = view({ turnPlayerId: 'p1' });
    const next = view({
      turnPlayerId: 'p2',
      players: [
        { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 7, saidUno: false, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
      ]
    });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'draw', playerId: 'p1', n: 2, toSelf: false });
  });

  it('flags toSelf when YOU draw', () => {
    const prev = view();
    const next = view({
      players: [
        { id: 'p0', name: 'Ada', cardCount: 6, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 5, saidUno: false, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
      ]
    });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'draw', playerId: 'p0', n: 1, toSelf: true });
  });

  it('suppresses the draw event on a fresh deal (prev round just ended)', () => {
    const prev = view({ phase: 'roundEnd' });
    const next = view({
      players: [
        { id: 'p0', name: 'Ada', cardCount: 7, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 7, saidUno: false, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 7, saidUno: false, connected: true, score: 0 }
      ]
    });
    expect(deriveViewChange(prev, next).event).toBeNull();
  });

  it('emits a special event when the discard becomes a skip', () => {
    const prev = view({ discardTop: C('red', '5') });
    const skip = C('red', 'skip');
    const next = view({ discardTop: skip, turnPlayerId: 'p1' });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'special', card: skip });
  });

  it('emits a uno event when a player calls last-card at one card', () => {
    const prev = view({
      players: [
        { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 1, saidUno: false, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
      ]
    });
    const next = view({
      players: [
        { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 1, saidUno: true, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
      ]
    });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'uno', playerId: 'p1', isYou: false });
  });

  it('emits a win event when the round ends, outranking a special final card', () => {
    const prev = view({ phase: 'play', discardTop: C('red', '5') });
    const next = view({ phase: 'roundEnd', roundWinner: 'p0', discardTop: C('red', 'skip') });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'win', winnerId: 'p0', isYou: true });
  });

  it('emits no event for an ordinary coloured play', () => {
    const prev = view({ discardTop: C('red', '5'), turnPlayerId: 'p0' });
    const next = view({ discardTop: C('red', '7'), turnPlayerId: 'p1' });
    expect(deriveViewChange(prev, next).event).toBeNull();
  });

  it('does not replay a win when the first observed view is already round-end (reconnect)', () => {
    const next = view({ phase: 'roundEnd', roundWinner: 'p1' });
    expect(deriveViewChange(null, next).event).toBeNull();
  });
});

describe('deriveViewChange — freshDeal (drives opening deal stagger)', () => {
  it('is true on the very first view when the hand already has multiple cards (reconnect mid-round)', () => {
    const next = view({ you: { id: 'p0', name: 'Ada', hand: [C('red', '5'), C('blue', '7')], saidUno: false, score: 0 } });
    expect(deriveViewChange(null, next).freshDeal).toBe(true);
  });

  it('is true on a roundEnd -> playing transition with a freshly dealt hand', () => {
    const prev = view({ phase: 'roundEnd' });
    const next = view({
      phase: 'play',
      you: { id: 'p0', name: 'Ada', hand: [C('red', '5'), C('blue', '7'), C('green', '2')], saidUno: false, score: 0 }
    });
    expect(deriveViewChange(prev, next).freshDeal).toBe(true);
  });

  it('is false for a mid-round draw (not following round end)', () => {
    const prev = view({ you: { id: 'p0', name: 'Ada', hand: [C('red', '5')], saidUno: false, score: 0 } });
    const next = view({ you: { id: 'p0', name: 'Ada', hand: [C('red', '5'), C('blue', '7')], saidUno: false, score: 0 } });
    expect(deriveViewChange(prev, next).freshDeal).toBe(false);
  });

  it('is false when the hand has one or fewer cards, even on a fresh deal', () => {
    const prev = view({ phase: 'roundEnd' });
    const next = view({
      phase: 'play',
      you: { id: 'p0', name: 'Ada', hand: [C('red', '5')], saidUno: false, score: 0 }
    });
    expect(deriveViewChange(prev, next).freshDeal).toBe(false);
  });

  it('is false on the very first view when the hand is empty', () => {
    const next = view({ you: { id: 'p0', name: 'Ada', hand: [], saidUno: false, score: 0 } });
    expect(deriveViewChange(null, next).freshDeal).toBe(false);
  });
});
