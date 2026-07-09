import type { Action, CardValue, Color, GameState, PlayerState } from '../engine/types';

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

function playerName(players: Pick<PlayerState, 'id' | 'name'>[], playerId: string | undefined, youId: string): string {
  if (!playerId) return 'Someone';
  if (playerId === youId) return 'you';
  return players.find((player) => player.id === playerId)?.name ?? 'Someone';
}

function actorLabel(players: Pick<PlayerState, 'id' | 'name'>[], actorId: string | undefined, youId: string): string {
  if (!actorId) return 'Someone';
  return actorId === youId ? 'You' : playerName(players, actorId, youId);
}

function cardLabel(card: PublicNotice['card']): string {
  if (!card) return 'a card';
  const value = card.value === 'wild4' ? 'Wild +4' : card.value === 'draw2' ? '+2' : card.value;
  if (card.color === null) return value;
  return `${card.color} ${value}`;
}

export function formatNotice(
  notice: PublicNotice,
  players: Pick<PlayerState, 'id' | 'name'>[],
  youId: string
): string {
  const actor = actorLabel(players, notice.actorId, youId);
  const target = playerName(players, notice.targetId, youId);

  switch (notice.kind) {
    case 'play':
      return `${actor} played ${cardLabel(notice.card)}`;
    case 'draw':
      return `${actor} drew ${notice.count ?? 0}`;
    case 'pass':
      return `${actor} passed`;
    case 'penalty':
      return `Penalty is now +${notice.pendingDraw ?? notice.count ?? 0} for ${target}`;
    case 'color':
      return `${actor} chose ${notice.color?.toUpperCase() ?? 'a colour'}`;
    case 'skip':
      return `${actor} skipped ${target}`;
    case 'reverse':
      return `${actor} reversed play`;
    case 'uno':
      return `${actor} called UNO`;
    case 'catch':
      return `${actor} caught ${target}`;
    case 'jumpIn':
      return `${actor} jumped in with ${cardLabel(notice.card)}`;
    case 'swap':
      return `${actor} swapped with ${target}`;
    case 'challenge':
      return notice.challengeSucceeded ? `${actor} won the challenge` : `${actor} lost the challenge`;
    case 'nextRound':
      return `${actor} started the next round`;
    case 'disconnect':
      return `${actor} disconnected`;
    case 'reconnect':
      return `${actor} reconnected`;
    case 'roundWin':
      return notice.actorId === youId ? 'You won the round' : `${actor} won the round`;
  }
}
