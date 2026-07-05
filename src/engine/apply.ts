import { startNextRound } from './game';
import { advanceTurn, drawFromDeck, isPlayable, playerIndex, topCard } from './helpers';
import { handPoints } from './scoring';
import type { Action, ApplyResult, Color, GameState } from './types';

const err = (error: string): ApplyResult => ({ ok: false, error });
const done = (state: GameState): ApplyResult => ({ ok: true, state });

export function apply(state: GameState, playerId: string, action: Action): ApplyResult {
  const s = structuredClone(state);
  const idx = playerIndex(s, playerId);
  if (idx === -1) return err('Unknown player');

  switch (action.type) {
    case 'playCard':
      return playCard(s, idx, action.cardId, action.chosenColor, action.swapTargetId);
    case 'drawCard':
      return drawCard(s, idx);
    case 'passTurn':
      return passTurn(s, idx);
    case 'chooseColor':
      return chooseColor(s, idx, action.color);
    case 'nextRound':
      return s.phase === 'roundEnd' ? done(startNextRound(s)) : err('Round is not over');
    case 'callUno':
    case 'catchUno':
    case 'challengeWildFour':
    case 'jumpIn':
    case 'chooseSwapTarget':
      return err('Not implemented yet'); // Tasks 5-6 replace these lines with handlers
  }
}

function playCard(
  s: GameState, idx: number, cardId: number,
  chosenColor?: Color, swapTargetId?: string
): ApplyResult {
  if (s.phase !== 'play') return err('Cannot play a card right now');
  if (s.turn !== idx) return err('Not your turn');
  const player = s.players[idx]!;
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return err('Card not in hand');
  if (s.hasDrawnThisTurn && cardId !== s.drawnCardId) {
    return err('After drawing you may only play the drawn card');
  }
  if (!isPlayable(card, s)) return err('Card does not match');

  return commitPlay(s, idx, cardId, chosenColor, swapTargetId);
}

/**
 * Shared by playCard and (Task 6) jumpIn: the card is already validated and
 * `s.turn === idx`. Removes the card, applies its effect, handles round end.
 */
function commitPlay(
  s: GameState, idx: number, cardId: number,
  chosenColor?: Color, swapTargetId?: string
): ApplyResult {
  const player = s.players[idx]!;
  const card = player.hand.find((c) => c.id === cardId)!;
  player.hand = player.hand.filter((c) => c.id !== cardId);
  s.discard.push(card);
  if (player.hand.length !== 1) player.saidUno = false;

  if (card.color !== null) s.currentColor = card.color;

  switch (card.value) {
    case 'skip':
      if (winsIfEmpty(s, idx)) return done(s);
      advanceTurn(s, 2);
      return done(s);
    case 'reverse':
      s.direction = s.direction === 1 ? -1 : 1;
      if (winsIfEmpty(s, idx)) return done(s);
      advanceTurn(s, s.players.length === 2 ? 2 : 1);
      return done(s);
    case 'draw2':
      s.pendingDraw += 2;
      s.pendingType = 'draw2';
      if (winsIfEmpty(s, idx)) return done(s);
      advanceTurn(s);
      return done(s);
    case 'wild':
      return afterWild(s, idx, chosenColor);
    case 'wild4':
      s.wild4PrevColor = s.currentColor;
      s.wild4PlayedBy = player.id;
      s.pendingDraw += 4;
      s.pendingType = 'wild4';
      return afterWild(s, idx, chosenColor);
    default: // number card — seven-zero handling added in Task 6
      if (winsIfEmpty(s, idx)) return done(s);
      advanceTurn(s);
      return done(s);
  }
}

function afterWild(s: GameState, idx: number, chosenColor?: Color): ApplyResult {
  if (winsIfEmpty(s, idx)) return done(s);
  if (chosenColor) {
    s.currentColor = chosenColor;
    advanceTurn(s);
    return done(s);
  }
  s.phase = 'chooseColor';
  s.hasDrawnThisTurn = false;
  s.drawnCardId = null;
  return done(s);
}

function chooseColor(s: GameState, idx: number, color: Color): ApplyResult {
  if (s.phase !== 'chooseColor') return err('No color to choose');
  if (s.turn !== idx) return err('Not your choice');
  s.currentColor = color;
  s.phase = 'play';
  advanceTurn(s);
  return done(s);
}

function drawCard(s: GameState, idx: number): ApplyResult {
  if (s.phase !== 'play') return err('Cannot draw right now');
  if (s.turn !== idx) return err('Not your turn');
  const player = s.players[idx]!;

  if (s.pendingDraw > 0) {
    drawFromDeck(s, player.id, s.pendingDraw);
    clearPending(s);
    advanceTurn(s);
    return done(s);
  }

  if (s.hasDrawnThisTurn) return err('Already drew this turn');
  const drawn = drawFromDeck(s, player.id, 1); // draw-until-playable added in Task 6
  const card = drawn[drawn.length - 1];
  if (!card || !isPlayable(card, s)) {
    advanceTurn(s); // nothing playable — turn ends automatically
    return done(s);
  }
  s.hasDrawnThisTurn = true;
  s.drawnCardId = card.id;
  return done(s);
}

function passTurn(s: GameState, idx: number): ApplyResult {
  if (s.phase !== 'play' || s.turn !== idx) return err('Not your turn');
  if (!s.hasDrawnThisTurn) return err('Draw a card first');
  advanceTurn(s);
  return done(s);
}

function clearPending(s: GameState): void {
  s.pendingDraw = 0;
  s.pendingType = null;
  s.wild4PrevColor = null;
  s.wild4PlayedBy = null;
}

/** If idx just emptied their hand: resolve leftover penalty, score, end round. */
function winsIfEmpty(s: GameState, idx: number): boolean {
  const winner = s.players[idx]!;
  if (winner.hand.length > 0) return false;
  if (s.pendingDraw > 0) {
    advanceTurn(s);
    drawFromDeck(s, s.players[s.turn]!.id, s.pendingDraw);
    clearPending(s);
  }
  s.phase = 'roundEnd';
  s.roundWinner = winner.id;
  winner.score += s.players.reduce(
    (sum, p) => (p.id === winner.id ? sum : sum + handPoints(p.hand)), 0
  );
  return true;
}
