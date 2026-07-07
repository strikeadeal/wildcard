import { describe, it, expect } from 'vitest';
import { deriveAnnouncement } from '../../src/ui/announce';
import type { Card, Color, PlayerView } from '../../src/engine/types';
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

describe('deriveAnnouncement', () => {
  it('says nothing on the first view (no prior state)', () => {
    expect(deriveAnnouncement(null, view())).toEqual({ banner: null, fromSelf: false });
  });

  it('says nothing for a normal coloured play', () => {
    const prev = view({ discardTop: C('red', '5'), currentColor: 'red' });
    const next = view({ discardTop: C('green', '3'), currentColor: 'green', turnPlayerId: 'p1' });
    expect(deriveAnnouncement(prev, next).banner).toBeNull();
  });

  it('announces the colour once a wild colour has settled', () => {
    const prev = view({ discardTop: C('blue', '2'), currentColor: 'blue', turnPlayerId: 'p0' });
    const next = view({
      discardTop: C(null, 'wild'),
      currentColor: 'green',
      phase: 'play',
      turnPlayerId: 'p1'
    });
    expect(deriveAnnouncement(prev, next).banner).toBe('Colour is now GREEN');
  });

  it('stays silent while the wild is still in the choose-colour phase', () => {
    const prev = view({ discardTop: C('blue', '2'), currentColor: 'blue' });
    const next = view({
      discardTop: C(null, 'wild'),
      currentColor: 'blue',
      phase: 'chooseColor'
    });
    expect(deriveAnnouncement(prev, next).banner).toBeNull();
  });

  it('names the victim when a +2 is played', () => {
    const prev = view({ pendingDraw: 0, discardTop: C('red', '5'), turnPlayerId: 'p0' });
    const next = view({
      pendingDraw: 2,
      discardTop: C('red', 'draw2'),
      turnPlayerId: 'p1' // Bob is now on turn and must draw
    });
    expect(deriveAnnouncement(prev, next).banner).toBe('Bob draws +2');
  });

  it('names the victim when a +4 is played', () => {
    const prev = view({ pendingDraw: 0, discardTop: C('red', '5'), turnPlayerId: 'p0' });
    const next = view({
      pendingDraw: 4,
      discardTop: C(null, 'wild4'),
      currentColor: 'yellow',
      turnPlayerId: 'p2'
    });
    expect(deriveAnnouncement(prev, next).banner).toBe('Cyd draws +4');
  });

  it('uses second person when the penalty falls on you', () => {
    const prev = view({ pendingDraw: 0, turnPlayerId: 'p1' });
    const next = view({ pendingDraw: 4, discardTop: C(null, 'wild4'), turnPlayerId: 'p0' });
    expect(deriveAnnouncement(prev, next).banner).toBe('You draw +4');
  });

  it('re-announces each increment when penalties stack', () => {
    const prev = view({ pendingDraw: 2, turnPlayerId: 'p1' });
    const next = view({
      pendingDraw: 4,
      discardTop: C('blue', 'draw2'),
      turnPlayerId: 'p2'
    });
    expect(deriveAnnouncement(prev, next).banner).toBe('Cyd draws +2');
  });

  it('prefers the penalty message over the colour message for a Wild+4', () => {
    const prev = view({ pendingDraw: 0, currentColor: 'red', turnPlayerId: 'p0' });
    const next = view({
      pendingDraw: 4,
      discardTop: C(null, 'wild4'),
      currentColor: 'blue',
      turnPlayerId: 'p1'
    });
    expect(deriveAnnouncement(prev, next).banner).toBe('Bob draws +4');
  });

  it('reports fromSelf when the local player played', () => {
    const prev = view({ discardTop: C('red', '5'), turnPlayerId: 'p0' });
    const next = view({ discardTop: C('red', '7'), turnPlayerId: 'p1' });
    expect(deriveAnnouncement(prev, next).fromSelf).toBe(true);
  });

  it('reports not fromSelf when an opponent played', () => {
    const prev = view({ discardTop: C('red', '5'), turnPlayerId: 'p1' });
    const next = view({ discardTop: C('red', '7'), turnPlayerId: 'p2' });
    expect(deriveAnnouncement(prev, next).fromSelf).toBe(false);
  });

  it('does not flag fromSelf when the discard did not change', () => {
    const top: Card = C('red', '5');
    const prev = view({ discardTop: top, turnPlayerId: 'p0' });
    const next = view({ discardTop: top, turnPlayerId: 'p0', deckCount: 79 });
    const r = deriveAnnouncement(prev, next);
    expect(r.fromSelf).toBe(false);
    expect(r.banner).toBeNull();
  });
});
