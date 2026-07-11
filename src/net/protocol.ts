import type { Action, PlayerView, RuleConfig } from '../engine/types';
import type { PublicNotice } from '../ui/public-notices';

export const PROTOCOL_VERSION = 2;

export interface LobbyPlayer {
  id: string;
  name: string;
  connected: boolean;
}

export interface LobbyInfo {
  players: LobbyPlayer[];
  hostId: string;
  config: RuleConfig;
  started: boolean;
  canStart: boolean;
}

export type RejectReason =
  | 'version'
  | 'full'
  | 'started'
  | 'badToken'
  | 'notFound'   // joined a room that was never created (or has expired)
  | 'codeTaken'; // tried to create a room whose code is already live

export type ClientMsg =
  | { v: number; type: 'hello'; name: string; token: string | null; create: boolean }
  | { v: number; type: 'intent'; action: Action }
  | { v: number; type: 'leave' }
  // Host-only commands (seat p0); the room rejects them from anyone else.
  | { v: number; type: 'config'; config: RuleConfig }
  | { v: number; type: 'start' }
  | { v: number; type: 'skipTurn'; playerId: string }
  | { v: number; type: 'removeSeat'; playerId: string };

export type ServerMsg =
  | { v: number; type: 'welcome'; playerId: string; token: string }
  | { v: number; type: 'rejected'; reason: RejectReason }
  | { v: number; type: 'lobby'; lobby: LobbyInfo }
  | { v: number; type: 'view'; view: PlayerView; notices?: PublicNotice[] }
  | { v: number; type: 'error'; message: string }
  // The room is gone for everyone (the host ended it).
  | { v: number; type: 'closed'; reason: 'hostLeft' };
