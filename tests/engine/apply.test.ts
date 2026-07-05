import { describe, it, expect } from 'vitest';
import { apply } from '../../src/engine/apply';
import { handPoints } from '../../src/engine/scoring';
import { C, fixedState, ok } from './fixtures';

describe('playCard basics', () => {
  it('plays a color match, updates discard and turn', () => {
    const card = C('red', '7');
    const s = fixedState([[card, C('blue', '2')], [C('green', '1')]], C('red', '5'));
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    expect(next.discard[next.discard.length - 1]!.id).toBe(card.id);
    expect(next.players[0]!.hand).toHaveLength(1);
    expect(next.turn).toBe(1);
    expect(s.players[0]!.hand).toHaveLength(2); // input not mutated
  });

  it('plays a value match and switches currentColor', () => {
    const card = C('blue', '5');
    const s = fixedState([[card], [C('green', '1'), C('green', '2')]], C('red', '5'));
    // hand would empty -> add a filler so the round does not end here
    s.players[0]!.hand.push(C('yellow', '9'));
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    expect(next.currentColor).toBe('blue');
  });

  it('rejects out-of-turn and unplayable cards', () => {
    const theirs = C('green', '1');
    const bad = C('blue', '9');
    const s = fixedState([[C('red', '1'), bad], [theirs]], C('red', '5'));
    expect(apply(s, 'p1', { type: 'playCard', cardId: theirs.id }).ok).toBe(false);
    expect(apply(s, 'p0', { type: 'playCard', cardId: bad.id }).ok).toBe(false);
    expect(apply(s, 'p0', { type: 'playCard', cardId: 424242 }).ok).toBe(false);
  });
});

describe('action cards', () => {
  it('skip jumps one player', () => {
    const card = C('red', 'skip');
    const s = fixedState(
      [[card, C('blue', '1')], [C('green', '1')], [C('green', '2')]],
      C('red', '5')
    );
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    expect(next.turn).toBe(2);
  });

  it('reverse flips direction with 3+ players', () => {
    const card = C('red', 'reverse');
    const s = fixedState(
      [[card, C('blue', '1')], [C('green', '1')], [C('green', '2')]],
      C('red', '5')
    );
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    expect(next.direction).toBe(-1);
    expect(next.turn).toBe(2); // 0 -> backwards -> 2
  });

  it('reverse acts as skip with 2 players', () => {
    const card = C('red', 'reverse');
    const s = fixedState([[card, C('blue', '1')], [C('green', '1')]], C('red', '5'));
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    expect(next.turn).toBe(0); // plays again
  });

  it('draw2 sets a pending penalty; victim draw resolves it and loses the turn', () => {
    const card = C('red', 'draw2');
    const s = fixedState(
      [[card, C('blue', '1')], [C('green', '1')], [C('green', '2')]],
      C('red', '5')
    );
    const afterPlay = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    expect(afterPlay.pendingDraw).toBe(2);
    expect(afterPlay.turn).toBe(1);
    // victim cannot play a normal card while a penalty is pending
    expect(apply(afterPlay, 'p1', { type: 'playCard', cardId: afterPlay.players[1]!.hand[0]!.id }).ok).toBe(false);
    const afterDraw = ok(apply(afterPlay, 'p1', { type: 'drawCard' }));
    expect(afterDraw.players[1]!.hand).toHaveLength(3);
    expect(afterDraw.pendingDraw).toBe(0);
    expect(afterDraw.turn).toBe(2);
  });

  it('wild without inline color pauses for chooseColor', () => {
    const card = C(null, 'wild');
    const s = fixedState([[card, C('blue', '1')], [C('green', '1')]], C('red', '5'));
    const mid = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id }));
    expect(mid.phase).toBe('chooseColor');
    expect(mid.turn).toBe(0);
    expect(apply(mid, 'p1', { type: 'chooseColor', color: 'green' }).ok).toBe(false); // not them
    const next = ok(apply(mid, 'p0', { type: 'chooseColor', color: 'green' }));
    expect(next.currentColor).toBe('green');
    expect(next.phase).toBe('play');
    expect(next.turn).toBe(1);
  });

  it('wild with inline color plays in one action', () => {
    const card = C(null, 'wild');
    const s = fixedState([[card, C('blue', '1')], [C('green', '1')]], C('red', '5'));
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id, chosenColor: 'blue' }));
    expect(next.currentColor).toBe('blue');
    expect(next.turn).toBe(1);
  });

  it('wild4 records the pre-play color and stacks 4 onto the victim', () => {
    const card = C(null, 'wild4');
    const s = fixedState([[card, C('blue', '1')], [C('green', '1')]], C('red', '5'));
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: card.id, chosenColor: 'blue' }));
    expect(next.pendingDraw).toBe(4);
    expect(next.pendingType).toBe('wild4');
    expect(next.wild4PrevColor).toBe('red');
    expect(next.wild4PlayedBy).toBe('p0');
    const resolved = ok(apply(next, 'p1', { type: 'drawCard' }));
    expect(resolved.players[1]!.hand).toHaveLength(5);
    expect(resolved.wild4PlayedBy).toBeNull();
  });
});

describe('drawing on your turn', () => {
  it('drawing an unplayable card ends the turn automatically', () => {
    const s = fixedState([[C('blue', '9')], [C('green', '1')]], C('red', '5'));
    s.deck = [C('green', '3')]; // top of deck (last element pops first)
    const next = ok(apply(s, 'p0', { type: 'drawCard' }));
    expect(next.players[0]!.hand).toHaveLength(2);
    expect(next.turn).toBe(1);
  });

  it('drawing a playable card allows playing ONLY that card, or passing', () => {
    const keeper = C('blue', '9');
    const s = fixedState([[keeper]], C('red', '5'), { turn: 0 });
    s.players.push({ id: 'p1', name: 'Bob', hand: [C('green', '1')], saidUno: false, connected: true, score: 0 });
    const drawn = C('red', '8', 777);
    s.deck = [drawn];
    const mid = ok(apply(s, 'p0', { type: 'drawCard' }));
    expect(mid.turn).toBe(0);
    expect(mid.drawnCardId).toBe(777);
    expect(apply(mid, 'p0', { type: 'drawCard' }).ok).toBe(false); // no double draw
    expect(apply(mid, 'p0', { type: 'playCard', cardId: keeper.id }).ok).toBe(false); // only drawn card
    const played = ok(apply(mid, 'p0', { type: 'playCard', cardId: 777 }));
    expect(played.turn).toBe(1);
    const passed = ok(apply(mid, 'p0', { type: 'passTurn' }));
    expect(passed.turn).toBe(1);
    expect(passed.players[0]!.hand).toHaveLength(2);
  });

  it('passTurn without drawing first is rejected', () => {
    const s = fixedState([[C('blue', '9')], [C('green', '1')]], C('red', '5'));
    expect(apply(s, 'p0', { type: 'passTurn' }).ok).toBe(false);
  });
});

describe('round end and scoring', () => {
  it('handPoints values numbers, actions, wilds correctly', () => {
    expect(handPoints([C('red', '0'), C('red', '9'), C('red', 'skip'),
      C('red', 'reverse'), C('red', 'draw2'), C(null, 'wild'), C(null, 'wild4')]))
      .toBe(0 + 9 + 20 + 20 + 20 + 50 + 50);
  });

  it('emptying your hand ends the round and scores opponents hands', () => {
    const last = C('red', '3');
    const s = fixedState(
      [[last], [C('green', 'skip'), C(null, 'wild')], [C('yellow', '7')]],
      C('red', '5')
    );
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: last.id }));
    expect(next.phase).toBe('roundEnd');
    expect(next.roundWinner).toBe('p0');
    expect(next.players[0]!.score).toBe(20 + 50 + 7);
  });

  it('winning with a draw2 makes the next player draw before scoring', () => {
    const last = C('red', 'draw2');
    const s = fixedState([[last], [C('green', '1')]], C('red', '5'));
    s.deck = [C('blue', '2'), C('blue', '3')];
    const next = ok(apply(s, 'p0', { type: 'playCard', cardId: last.id }));
    expect(next.phase).toBe('roundEnd');
    expect(next.players[1]!.hand).toHaveLength(3);
    expect(next.players[0]!.score).toBe(1 + 2 + 3);
  });

  it('nextRound re-deals and only works at roundEnd', () => {
    const last = C('red', '3');
    const s = fixedState([[last], [C('green', '1')]], C('red', '5'));
    expect(apply(s, 'p0', { type: 'nextRound' }).ok).toBe(false);
    const ended = ok(apply(s, 'p0', { type: 'playCard', cardId: last.id }));
    const fresh = ok(apply(ended, 'p0', { type: 'nextRound' }));
    expect(fresh.phase).toBe('play');
    expect(fresh.players[0]!.hand).toHaveLength(7);
    expect(fresh.players[0]!.score).toBeGreaterThan(0); // score kept
  });
});
