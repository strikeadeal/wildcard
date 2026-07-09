import { describe, expect, it } from 'vitest';
import { apply } from '../../src/engine/apply';
import { DEFAULT_RULES, type GameState, type PlayerState } from '../../src/engine/types';
import {
  deriveActionNotices,
  deriveConnectionNotice,
  formatNotice
} from '../../src/ui/public-notices';
import { C, fixedState, ok } from '../engine/fixtures';

function names(state: GameState): PlayerState[] {
  return state.players.map((player) => ({
    ...player,
    hand: [],
    connected: true,
    saidUno: false,
    score: player.score
  }));
}

describe('public notices', () => {
  it('emits play and penalty notices for a +2 without private card ids', () => {
    const card = C('red', 'draw2', 101);
    const before = fixedState([[card, C('red', '1', 102)], [C('blue', '3')]], C('red', '5'));
    const result = apply(before, 'p0', { type: 'playCard', cardId: card.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const notices = deriveActionNotices(
      before, result.state, 'p0', { type: 'playCard', cardId: card.id }, 10
    );
    expect(notices.map((n) => n.kind)).toEqual(['play', 'penalty']);
    expect(notices[1]).toMatchObject({ id: 11, actorId: 'p0', pendingDraw: 2 });
    expect(JSON.stringify(notices)).not.toContain('"cardId"');
    expect(JSON.stringify(notices)).not.toContain('"hand"');
  });

  it('keeps final-card +2 notice totals even after round-end resolution clears pendingDraw', () => {
    const card = C('red', 'draw2', 103);
    const before = fixedState([[card], [C('blue', '3')]], C('red', '5'));
    const after = ok(apply(before, 'p0', { type: 'playCard', cardId: card.id }));
    expect(after.phase).toBe('roundEnd');
    expect(after.pendingDraw).toBe(0);
    expect(deriveActionNotices(before, after, 'p0', { type: 'playCard', cardId: card.id }, 12)).toEqual([
      { id: 12, kind: 'play', actorId: 'p0', card: { color: 'red', value: 'draw2' } },
      { id: 13, kind: 'penalty', actorId: 'p0', targetId: 'p1', count: 2, pendingDraw: 2, stacked: false },
      { id: 14, kind: 'roundWin', actorId: 'p0' }
    ]);
  });

  it('keeps final-card wild4 notice totals even after round-end resolution clears pendingDraw', () => {
    const card = C(null, 'wild4', 104);
    const before = fixedState([[card], [C('blue', '3')]], C('red', '5'));
    const after = ok(apply(before, 'p0', { type: 'playCard', cardId: card.id, chosenColor: 'green' }));
    expect(after.phase).toBe('roundEnd');
    expect(after.pendingDraw).toBe(0);
    expect(deriveActionNotices(
      before,
      after,
      'p0',
      { type: 'playCard', cardId: card.id, chosenColor: 'green' },
      15
    )).toEqual([
      { id: 15, kind: 'play', actorId: 'p0', card: { color: null, value: 'wild4' } },
      { id: 16, kind: 'penalty', actorId: 'p0', targetId: 'p1', count: 4, pendingDraw: 4, stacked: false },
      { id: 17, kind: 'color', actorId: 'p0', color: 'green' },
      { id: 18, kind: 'roundWin', actorId: 'p0' }
    ]);
  });

  it('keeps stacked final penalty totals without going negative', () => {
    const first = C('red', 'draw2', 105);
    const final = C('blue', 'draw2', 106);
    const start = fixedState(
      [[first, C('red', '1', 107)], [final], [C('yellow', '3', 108)]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, stacking: true } }
    );
    const before = ok(apply(start, 'p0', { type: 'playCard', cardId: first.id }));
    const after = ok(apply(before, 'p1', { type: 'playCard', cardId: final.id }));
    expect(after.phase).toBe('roundEnd');
    expect(after.pendingDraw).toBe(0);
    expect(deriveActionNotices(before, after, 'p1', { type: 'playCard', cardId: final.id }, 19)).toEqual([
      { id: 19, kind: 'play', actorId: 'p1', card: { color: 'blue', value: 'draw2' } },
      { id: 20, kind: 'penalty', actorId: 'p1', targetId: 'p2', count: 2, pendingDraw: 4, stacked: true },
      { id: 21, kind: 'roundWin', actorId: 'p1' }
    ]);
  });

  it('reports draw count but never drawn identities', () => {
    const before = fixedState(
      [[C('red', '5')], [C('blue', '3')]], C(null, 'wild4'),
      { pendingDraw: 4, pendingType: 'wild4' }
    );
    const after = ok(apply(before, 'p0', { type: 'drawCard' }));
    const notices = deriveActionNotices(before, after, 'p0', { type: 'drawCard' }, 1);
    expect(notices).toEqual([{ id: 1, kind: 'draw', actorId: 'p0', count: 4 }]);
    expect(JSON.stringify(notices)).not.toContain('"card":');
  });

  it('emits a plain play notice for a normal card', () => {
    const card = C('red', '7', 201);
    const before = fixedState([[card, C('blue', '1')], [C('green', '3')]], C('red', '5'));
    const after = ok(apply(before, 'p0', { type: 'playCard', cardId: card.id }));
    expect(deriveActionNotices(before, after, 'p0', { type: 'playCard', cardId: card.id }, 20)).toEqual([
      { id: 20, kind: 'play', actorId: 'p0', card: { color: 'red', value: '7' } }
    ]);
  });

  it('emits jump-in with the public card only', () => {
    const dup = C('red', '5', 301);
    const before = fixedState(
      [[C('blue', '1')], [C('green', '1')], [dup, C('yellow', '2')]],
      C('red', '5'),
      { config: { ...DEFAULT_RULES, jumpIn: true } }
    );
    const after = ok(apply(before, 'p2', { type: 'jumpIn', cardId: dup.id }));
    expect(deriveActionNotices(before, after, 'p2', { type: 'jumpIn', cardId: dup.id }, 30)).toEqual([
      { id: 30, kind: 'jumpIn', actorId: 'p2', card: { color: 'red', value: '5' } }
    ]);
  });

  it('emits colour and swap notices from public action payloads', () => {
    const wild = C(null, 'wild', 401);
    const seven = C('red', '7', 402);
    const beforeWild = fixedState([[wild, C('blue', '2')], [C('green', '1')]], C('red', '5'));
    const afterWild = ok(apply(beforeWild, 'p0', { type: 'playCard', cardId: wild.id, chosenColor: 'blue' }));
    expect(deriveActionNotices(
      beforeWild, afterWild, 'p0', { type: 'playCard', cardId: wild.id, chosenColor: 'blue' }, 40
    )).toEqual([
      { id: 40, kind: 'play', actorId: 'p0', card: { color: null, value: 'wild' } },
      { id: 41, kind: 'color', actorId: 'p0', color: 'blue' }
    ]);

    const beforeSwap = fixedState(
      [[seven, C('blue', '9')], [C('green', '1')], [C('yellow', '1')]],
      C('red', '5'),
      { config: { ...beforeWild.config, sevenZero: true } }
    );
    const afterSwap = ok(apply(beforeSwap, 'p0', {
      type: 'playCard',
      cardId: seven.id,
      swapTargetId: 'p2'
    }));
    expect(deriveActionNotices(
      beforeSwap,
      afterSwap,
      'p0',
      { type: 'playCard', cardId: seven.id, swapTargetId: 'p2' },
      50
    )).toEqual([
      { id: 50, kind: 'play', actorId: 'p0', card: { color: 'red', value: '7' } },
      { id: 51, kind: 'swap', actorId: 'p0', targetId: 'p2' }
    ]);
  });

  it('emits skip and reverse notices', () => {
    const skip = C('red', 'skip', 501);
    const reverse = C('red', 'reverse', 502);
    const beforeSkip = fixedState(
      [[skip, C('blue', '1')], [C('green', '1')], [C('yellow', '1')]],
      C('red', '5')
    );
    const afterSkip = ok(apply(beforeSkip, 'p0', { type: 'playCard', cardId: skip.id }));
    expect(deriveActionNotices(beforeSkip, afterSkip, 'p0', { type: 'playCard', cardId: skip.id }, 60)).toEqual([
      { id: 60, kind: 'play', actorId: 'p0', card: { color: 'red', value: 'skip' } },
      { id: 61, kind: 'skip', actorId: 'p0', targetId: 'p1' }
    ]);

    const beforeReverse = fixedState(
      [[reverse, C('blue', '1')], [C('green', '1')], [C('yellow', '1')]],
      C('red', '5')
    );
    const afterReverse = ok(apply(beforeReverse, 'p0', { type: 'playCard', cardId: reverse.id }));
    expect(deriveActionNotices(
      beforeReverse, afterReverse, 'p0', { type: 'playCard', cardId: reverse.id }, 70
    )).toEqual([
      { id: 70, kind: 'play', actorId: 'p0', card: { color: 'red', value: 'reverse' } },
      { id: 71, kind: 'reverse', actorId: 'p0' }
    ]);
  });

  it('emits uno and catch notices from their actions', () => {
    const beforeUno = fixedState([[C('red', '1'), C('blue', '4')], [C('green', '1')]], C('red', '5'));
    const afterUno = ok(apply(beforeUno, 'p0', { type: 'callUno' }));
    expect(deriveActionNotices(beforeUno, afterUno, 'p0', { type: 'callUno' }, 80)).toEqual([
      { id: 80, kind: 'uno', actorId: 'p0' }
    ]);

    const played = ok(apply(beforeUno, 'p0', { type: 'playCard', cardId: beforeUno.players[0]!.hand[0]!.id }));
    const afterCatch = ok(apply(played, 'p1', { type: 'catchUno', targetId: 'p0' }));
    expect(deriveActionNotices(played, afterCatch, 'p1', { type: 'catchUno', targetId: 'p0' }, 90)).toEqual([
      { id: 90, kind: 'catch', actorId: 'p1', targetId: 'p0', count: 2 }
    ]);
  });

  it('emits challenge results and any resulting draw notice', () => {
    const wild4 = C(null, 'wild4', 601);
    const before = fixedState(
      [[wild4, C('red', '9')], [C('green', '1'), C('green', '2')]],
      C('red', '5')
    );
    const pending = ok(apply(before, 'p0', { type: 'playCard', cardId: wild4.id, chosenColor: 'blue' }));
    const guilty = ok(apply(pending, 'p1', { type: 'challengeWildFour' }));
    expect(deriveActionNotices(pending, guilty, 'p1', { type: 'challengeWildFour' }, 100)).toEqual([
      { id: 100, kind: 'challenge', actorId: 'p1', targetId: 'p0', count: 4, challengeSucceeded: true },
      { id: 101, kind: 'draw', actorId: 'p0', count: 4 }
    ]);
  });

  it('emits next-round and round-win notices when appropriate', () => {
    const winner = C('red', '5', 701);
    const beforePlay = fixedState([[winner], [C('green', '1'), C('green', '2')]], C('red', '3'));
    const afterPlay = ok(apply(beforePlay, 'p0', { type: 'playCard', cardId: winner.id }));
    expect(deriveActionNotices(beforePlay, afterPlay, 'p0', { type: 'playCard', cardId: winner.id }, 110)).toEqual([
      { id: 110, kind: 'play', actorId: 'p0', card: { color: 'red', value: '5' } },
      { id: 111, kind: 'roundWin', actorId: 'p0' }
    ]);

    const afterNextRound = ok(apply(afterPlay, 'p0', { type: 'nextRound' }));
    expect(deriveActionNotices(afterPlay, afterNextRound, 'p0', { type: 'nextRound' }, 120)).toEqual([
      { id: 120, kind: 'nextRound', actorId: 'p0' }
    ]);
  });

  it('derives connect notices and formats notices without leaking private ids', () => {
    const state = fixedState([[C('red', '1')], [C('blue', '2')]], C('yellow', '4'));
    const reconnect = deriveConnectionNotice('p1', true, 130);
    expect(reconnect).toEqual({ id: 130, kind: 'reconnect', actorId: 'p1' });
    expect(formatNotice(
      { id: 131, kind: 'penalty', actorId: 'p0', targetId: 'p1', pendingDraw: 4 },
      names(state),
      'p0'
    )).toBe('Penalty is now +4 for Bob');
    expect(formatNotice(
      { id: 132, kind: 'roundWin', actorId: 'p0' },
      names(state),
      'p0'
    )).toBe('You won the round');
  });
});
