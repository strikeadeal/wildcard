import { buildDeck, rng, shuffle } from './deck';
import type { GameState, RuleConfig, Seat } from './types';
import { playerIndex } from './helpers';

const ACTION_VALUES = new Set(['skip', 'reverse', 'draw2', 'wild', 'wild4']);

function deal(state: GameState): void {
  state.seed = (state.seed + 1) >>> 0;
  let deck = shuffle(buildDeck(), rng(state.seed));
  for (const p of state.players) {
    p.hand = deck.splice(0, 7);
    p.saidUno = false;
  }
  // Flip until a number card shows (simplest uncontroversial opening).
  let top = deck.pop()!;
  while (ACTION_VALUES.has(top.value)) {
    deck.splice(Math.floor(deck.length / 2), 0, top); // bury it
    top = deck.pop()!;
  }
  state.deck = deck;
  state.discard = [top];
  state.currentColor = top.color!;
  state.direction = 1;
  state.phase = 'play';
  state.pendingDraw = 0;
  state.pendingType = null;
  state.wild4PrevColor = null;
  state.wild4PlayedBy = null;
  state.hasDrawnThisTurn = false;
  state.drawnCardId = null;
  state.roundWinner = null;
}

export function createGame(seats: Seat[], config: RuleConfig, seed: number): GameState {
  if (seats.length < 2 || seats.length > 6) throw new Error('2-6 players required');
  const state: GameState = {
    config,
    players: seats.map((s) => ({
      id: s.id, name: s.name, hand: [], saidUno: false, connected: true, score: 0
    })),
    deck: [],
    discard: [],
    currentColor: 'red',
    turn: 0,
    direction: 1,
    phase: 'play',
    pendingDraw: 0,
    pendingType: null,
    wild4PrevColor: null,
    wild4PlayedBy: null,
    hasDrawnThisTurn: false,
    drawnCardId: null,
    roundWinner: null,
    seed: seed >>> 0
  };
  deal(state);
  return state;
}

/** New round in the same session: scores kept, round winner leads. */
export function startNextRound(state: GameState): GameState {
  const next = structuredClone(state);
  next.turn = next.roundWinner ? Math.max(0, playerIndex(next, next.roundWinner)) : 0;
  deal(next);
  return next;
}

/** Deal a departed player out: cards to the deck bottom, seat removed. Pure. */
export function removePlayer(state: GameState, playerId: string): GameState {
  const s = structuredClone(state);
  const idx = playerIndex(s, playerId);
  if (idx === -1) return s;
  const wasTheirTurn = s.turn === idx;
  const [gone] = s.players.splice(idx, 1);
  s.deck.unshift(...gone!.hand);
  if (s.wild4PlayedBy === playerId) {
    s.wild4PlayedBy = null; // pending penalty stands, but there is no one to challenge
  }
  if (s.players.length === 1) {
    s.phase = 'roundEnd';
    s.roundWinner = s.players[0]!.id;
    return s;
  }
  if (idx < s.turn) s.turn -= 1;
  else if (wasTheirTurn) {
    s.turn = s.turn % s.players.length;
    if (s.direction === -1) s.turn = (s.turn - 1 + s.players.length) % s.players.length;
    if (s.phase === 'chooseColor' || s.phase === 'chooseSwapTarget') s.phase = 'play';
    s.hasDrawnThisTurn = false;
    s.drawnCardId = null;
  } else if (s.turn >= s.players.length) s.turn = 0;
  return s;
}
