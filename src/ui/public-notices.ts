import type { Action, CardValue, Color, GameState, PlayerState } from '../engine/types';
import type { GameEvent } from './events';

export type PublicNoticeKind =
  | 'play' | 'draw' | 'pass' | 'penalty' | 'color' | 'skip' | 'reverse'
  | 'uno' | 'catch' | 'jumpIn' | 'swap' | 'challenge' | 'nextRound'
  | 'disconnect' | 'reconnect' | 'roundWin';

export interface PublicNotice {
  id: number;
  kind: PublicNoticeKind;
  actorId?: string;
  targetId?: string;
  card?: { color: Color | null; value: CardValue };
  count?: number;
  color?: Color;
  pendingDraw?: number;
  challengeSucceeded?: boolean;
  stacked?: boolean;
}

function cardCount(state: GameState, id: string): number {
  return state.players.find((p) => p.id === id)?.hand.length ?? 0;
}

function penaltyDelta(card: { value: CardValue }): number {
  return card.value === 'wild4' ? 4 : 2;
}

export function deriveActionNotices(
  before: GameState,
  after: GameState,
  actorId: string,
  action: Action,
  nextId: number
): PublicNotice[] {
  const notices: PublicNotice[] = [];
  const add = (notice: Omit<PublicNotice, 'id'>) => {
    notices.push({ id: nextId + notices.length, ...notice });
  };

  switch (action.type) {
    case 'playCard':
    case 'jumpIn': {
      const top = after.discard[after.discard.length - 1]!;
      add({
        kind: action.type === 'jumpIn' ? 'jumpIn' : 'play',
        actorId,
        card: { color: top.color, value: top.value }
      });
      const targetId = after.players[after.turn]?.id;
      if (top.value === 'draw2' || top.value === 'wild4') {
        const count = penaltyDelta(top);
        add({
          kind: 'penalty',
          actorId,
          targetId,
          count,
          pendingDraw: before.pendingDraw + count,
          stacked: before.pendingDraw > 0
        });
      } else if (top.value === 'skip') {
        const actorIndex = before.players.findIndex((p) => p.id === actorId);
        const skipped = before.players[
          (((actorIndex + before.direction) % before.players.length) + before.players.length)
          % before.players.length
        ];
        add({ kind: 'skip', actorId, targetId: skipped?.id });
      } else if (top.value === 'reverse') {
        add({ kind: 'reverse', actorId });
      }
      if (action.chosenColor) add({ kind: 'color', actorId, color: action.chosenColor });
      if (action.swapTargetId) add({ kind: 'swap', actorId, targetId: action.swapTargetId });
      break;
    }
    case 'drawCard': {
      const count = cardCount(after, actorId) - cardCount(before, actorId);
      if (count > 0) add({ kind: 'draw', actorId, count });
      break;
    }
    case 'passTurn':
      add({ kind: 'pass', actorId });
      break;
    case 'chooseColor':
      add({ kind: 'color', actorId, color: action.color });
      break;
    case 'chooseSwapTarget':
      add({ kind: 'swap', actorId, targetId: action.targetId });
      break;
    case 'callUno':
      add({ kind: 'uno', actorId });
      break;
    case 'catchUno':
      add({
        kind: 'catch',
        actorId,
        targetId: action.targetId,
        count: cardCount(after, action.targetId) - cardCount(before, action.targetId)
      });
      break;
    case 'challengeWildFour': {
      const drawn = after.players.find((p) => p.hand.length > cardCount(before, p.id));
      const count = drawn ? drawn.hand.length - cardCount(before, drawn.id) : 0;
      add({
        kind: 'challenge',
        actorId,
        targetId: drawn?.id,
        count,
        challengeSucceeded: !!drawn && drawn.id !== actorId
      });
      if (drawn && count > 0) add({ kind: 'draw', actorId: drawn.id, count });
      break;
    }
    case 'nextRound':
      add({ kind: 'nextRound', actorId });
      break;
  }

  if (before.phase !== 'roundEnd' && after.phase === 'roundEnd' && after.roundWinner) {
    add({ kind: 'roundWin', actorId: after.roundWinner });
  }
  return notices;
}

export function deriveConnectionNotice(
  playerId: string,
  connected: boolean,
  id: number
): PublicNotice {
  return { id, kind: connected ? 'reconnect' : 'disconnect', actorId: playerId };
}

export function formatNotice(
  notice: PublicNotice,
  players: Pick<PlayerState, 'id' | 'name'>[],
  youId: string
): string {
  const name = (id?: string) => id === youId
    ? 'You'
    : players.find((player) => player.id === id)?.name ?? 'A player';
  const actor = name(notice.actorId);
  const targetName = name(notice.targetId);
  const target = targetName === 'You' ? 'you' : targetName;
  const faces = targetName === 'You'
    ? `You now face ${notice.pendingDraw}`
    : `${targetName} now faces ${notice.pendingDraw}`;
  const n = notice.count ?? 0;
  const card = notice.card
    ? `${notice.card.color ? notice.card.color + ' ' : ''}${notice.card.value}`
    : 'a card';

  switch (notice.kind) {
    case 'play':
      return `${actor} played ${card}`;
    case 'draw':
      return `${actor} drew ${n} ${n === 1 ? 'card' : 'cards'}`;
    case 'pass':
      return `${actor} kept the drawn card`;
    case 'penalty':
      return notice.stacked
        ? `${actor} stacked the penalty · ${faces}`
        : `${actor} played a draw card · ${faces}`;
    case 'color':
      return `${actor} chose ${notice.color?.toUpperCase()}`;
    case 'skip':
      return `${actor} skipped ${target}`;
    case 'reverse':
      return `${actor} reversed play`;
    case 'uno':
      return `${actor} called UNO`;
    case 'catch':
      return `${actor} caught ${target} · draw ${n}`;
    case 'jumpIn':
      return `${actor} jumped in with ${card}`;
    case 'swap':
      return `${actor} swapped hands with ${target}`;
    case 'challenge':
      return notice.challengeSucceeded
        ? `${actor} won the +4 challenge`
        : `${actor} lost the +4 challenge`;
    case 'nextRound':
      return `${actor} dealt the next round`;
    case 'disconnect':
      return `${actor} lost connection`;
    case 'reconnect':
      return `${actor} rejoined`;
    case 'roundWin':
      return `${actor} won the round`;
  }
}

const SPECIAL_CARD_VALUES = new Set<CardValue>(['skip', 'reverse', 'draw2', 'wild4']);

export function noticeToGameEvent(notice: PublicNotice, youId: string): GameEvent | null {
  switch (notice.kind) {
    case 'draw':
      return notice.actorId
        ? {
            kind: 'draw',
            playerId: notice.actorId,
            n: notice.count ?? 0,
            toSelf: notice.actorId === youId
          }
        : null;
    case 'play':
    case 'jumpIn':
      return notice.card && SPECIAL_CARD_VALUES.has(notice.card.value)
        ? { kind: 'special', card: { id: -notice.id, ...notice.card } }
        : null;
    case 'uno':
      return notice.actorId
        ? { kind: 'uno', playerId: notice.actorId, isYou: notice.actorId === youId }
        : null;
    case 'roundWin':
      return notice.actorId
        ? { kind: 'win', winnerId: notice.actorId, isYou: notice.actorId === youId }
        : null;
    default:
      return null;
  }
}
