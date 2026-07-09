import type { PlayerView } from '../engine/types';

export type ActionPrompt = {
  text: string;
  tone: 'active' | 'waiting' | 'urgent';
};

export function deriveActionPrompt(view: PlayerView): ActionPrompt {
  const mine = view.turnPlayerId === view.you.id;
  const turnName = view.players.find((p) => p.id === view.turnPlayerId)?.name ?? 'another player';
  if (view.phase === 'roundEnd') return { text: 'Round over.', tone: 'waiting' };
  if (view.mustChooseColor) return { text: 'Choose the new colour.', tone: 'urgent' };
  if (view.mustChooseSwapTarget) return { text: 'Choose someone to swap hands with.', tone: 'urgent' };
  if (!mine && view.playableCardIds.length > 0) {
    return { text: 'Jump in now — you have an identical card.', tone: 'urgent' };
  }
  if (!mine) return { text: `Waiting for ${turnName}.`, tone: 'waiting' };
  if (view.pendingDraw > 0 && view.playableCardIds.length > 0) {
    return { text: `Stack the penalty or draw ${view.pendingDraw}.`, tone: 'urgent' };
  }
  if (view.pendingDraw > 0) return { text: `Draw ${view.pendingDraw} cards.`, tone: 'urgent' };
  if (view.canPass) return { text: 'Play the card you drew or keep it.', tone: 'active' };
  return { text: 'Your turn — play a raised card or draw.', tone: 'active' };
}
