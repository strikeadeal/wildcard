export type Color = 'red' | 'yellow' | 'green' | 'blue';

export type CardValue =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  id: number;          // unique within the deck, stable for the whole game
  color: Color | null; // null for wild / wild4
  value: CardValue;
}

export interface RuleConfig {
  stacking: boolean;
  jumpIn: boolean;
  drawUntilPlayable: boolean;
  sevenZero: boolean;
}

export const DEFAULT_RULES: RuleConfig = {
  stacking: false,
  jumpIn: false,
  drawUntilPlayable: false,
  sevenZero: false
};

export interface Seat {
  id: string;   // stable player id (session token owner)
  name: string;
}

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  saidUno: boolean;   // called "last card" while at 1 card
  connected: boolean;
  score: number;      // session running total
}

export type Phase =
  | 'play'             // current player must play or draw
  | 'chooseColor'      // current player played a wild, must pick a color
  | 'chooseSwapTarget' // seven-zero: played a 7, must pick a player to swap with
  | 'roundEnd';

export interface GameState {
  config: RuleConfig;
  players: PlayerState[];
  deck: Card[];        // draw pile, last element drawn first
  discard: Card[];     // last element is the top card
  currentColor: Color; // active color (differs from top card after wilds)
  turn: number;        // index into players
  direction: 1 | -1;
  phase: Phase;
  pendingDraw: number;                  // accumulated +2/+4 penalty not yet drawn
  pendingType: 'draw2' | 'wild4' | null;
  wild4PrevColor: Color | null; // color active before the pending wild4 (challenge check)
  wild4PlayedBy: string | null;
  hasDrawnThisTurn: boolean;
  drawnCardId: number | null;   // only this card may be played after drawing
  roundWinner: string | null;
  seed: number;                 // advanced on every shuffle for determinism
}

export type Action =
  | { type: 'playCard'; cardId: number; chosenColor?: Color; swapTargetId?: string }
  | { type: 'drawCard' }
  | { type: 'passTurn' }
  | { type: 'chooseColor'; color: Color }
  | { type: 'chooseSwapTarget'; targetId: string }
  | { type: 'callUno' }
  | { type: 'catchUno'; targetId: string }
  | { type: 'challengeWildFour' }
  | { type: 'jumpIn'; cardId: number; chosenColor?: Color; swapTargetId?: string }
  | { type: 'nextRound' };

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

export interface OpponentView {
  id: string;
  name: string;
  cardCount: number;
  saidUno: boolean;
  connected: boolean;
  score: number;
}

export interface PlayerView {
  you: { id: string; name: string; hand: Card[]; saidUno: boolean; score: number };
  players: OpponentView[]; // ALL seats in table order, including you (cardCount only)
  discardTop: Card | null;
  currentColor: Color;
  deckCount: number;
  turnPlayerId: string;
  direction: 1 | -1;
  phase: Phase;
  pendingDraw: number;
  config: RuleConfig;
  roundWinner: string | null;
  // Pre-computed affordances so the UI needs no rules knowledge:
  playableCardIds: number[]; // cards YOU may legally play right now (incl. jump-ins)
  canDraw: boolean;
  canPass: boolean;
  canChallenge: boolean;
  canCallUno: boolean;
  catchableIds: string[];    // players you could catch for a missed call
  mustChooseColor: boolean;
  mustChooseSwapTarget: boolean;
}
