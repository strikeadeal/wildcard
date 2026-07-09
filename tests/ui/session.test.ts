import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerView } from '../../src/engine/types';
import { C } from '../engine/fixtures';
import { session } from '../../src/ui/session.svelte';

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
    config: { stacking: false, jumpIn: false, drawUntilPlayable: false, sevenZero: false },
    pendingDraw: 0,
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

describe('session notice handling', () => {
  afterEach(() => {
    session.leave();
  });

  it('refreshes lastPlayFromSelf from view diffs even when notices are transported', () => {
    (session as any).view = view({ discardTop: C('red', '5'), turnPlayerId: 'p0' });
    session.lastPlayFromSelf = false;

    (session as any).handleView(
      view({ discardTop: C('red', '7'), turnPlayerId: 'p1' }),
      [{ id: 1, kind: 'play', actorId: 'p0', card: { color: 'red', value: '7' } }]
    );

    expect(session.lastPlayFromSelf).toBe(true);
  });

  it('clears stale self-direction when an opponent play arrives with transported notices', () => {
    (session as any).view = view({ discardTop: C('red', '5'), turnPlayerId: 'p1' });
    session.lastPlayFromSelf = true;

    (session as any).handleView(
      view({ discardTop: C('red', '7'), turnPlayerId: 'p2' }),
      [{ id: 2, kind: 'play', actorId: 'p1', card: { color: 'red', value: '7' } }]
    );

    expect(session.lastPlayFromSelf).toBe(false);
  });
});
