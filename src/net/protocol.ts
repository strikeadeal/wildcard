import type { Action, PlayerView, RuleConfig } from '../engine/types';

export const PROTOCOL_VERSION = 1;

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

export type ClientMsg =
  | { v: number; type: 'hello'; name: string; token: string | null }
  | { v: number; type: 'intent'; action: Action };

export type ServerMsg =
  | { v: number; type: 'welcome'; playerId: string; token: string }
  | { v: number; type: 'rejected'; reason: 'version' | 'full' | 'started' | 'badToken' }
  | { v: number; type: 'lobby'; lobby: LobbyInfo }
  | { v: number; type: 'view'; view: PlayerView }
  | { v: number; type: 'error'; message: string };
