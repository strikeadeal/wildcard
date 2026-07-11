import { playableCardIds, playerIndex, topCard } from './helpers';
import type { GameState, PlayerView } from './types';

export function redact(state: GameState, playerId: string): PlayerView {
  const idx = playerIndex(state, playerId);
  if (idx === -1) throw new Error('unknown player: ' + playerId);
  const me = state.players[idx]!;
  const myTurn = state.turn === idx;

  return {
    you: {
      id: me.id, name: me.name, hand: structuredClone(me.hand),
      saidUno: me.saidUno, score: me.score
    },
    players: state.players.map((p) => ({
      id: p.id, name: p.name, cardCount: p.hand.length,
      saidUno: p.saidUno, connected: p.connected, score: p.score
    })),
    discardTop: structuredClone(topCard(state)),
    currentColor: state.currentColor,
    deckCount: state.deck.length,
    turnPlayerId: state.players[state.turn]!.id,
    direction: state.direction,
    phase: state.phase,
    pendingDraw: state.pendingDraw,
    config: { ...state.config },
    roundWinner: state.roundWinner,
    playableCardIds: playableCardIds(state, playerId),
    canDraw: state.phase === 'play' && myTurn && !state.hasDrawnThisTurn,
    canPass: state.phase === 'play' && myTurn && state.hasDrawnThisTurn,
    canChallenge:
      state.phase === 'play' && myTurn &&
      state.pendingType === 'wild4' && state.pendingDraw === 4 &&
      state.wild4PlayedBy !== playerId,
    canCallUno: state.phase !== 'roundEnd' && !me.saidUno,
    catchableIds: state.players
      .filter((p) => p.id !== playerId && p.hand.length === 1 && !p.saidUno)
      .map((p) => p.id),
    mustChooseColor: state.phase === 'chooseColor' && myTurn,
    mustChooseSwapTarget: state.phase === 'chooseSwapTarget' && myTurn
  };
}
