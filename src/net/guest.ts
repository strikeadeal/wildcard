import type { Action } from '../engine/types';
import { PROTOCOL_VERSION, type ServerMsg } from './protocol';
import type { Connection } from './transport';

export interface GuestEvents {
  onWelcome(playerId: string, token: string): void;
  onLobby(lobby: import('./protocol').LobbyInfo): void;
  onView(view: import('../engine/types').PlayerView): void;
  onRejected(reason: 'version' | 'full' | 'started' | 'badToken'): void;
  onError(message: string): void;
  onClosed(): void;
}

export class GuestSession {
  playerId: string | null = null;

  constructor(
    private conn: Connection,
    name: string,
    token: string | null,
    events: GuestEvents
  ) {
    conn.onMessage((raw) => {
      const msg = raw as ServerMsg;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'welcome':
          this.playerId = msg.playerId;
          events.onWelcome(msg.playerId, msg.token);
          break;
        case 'lobby':
          events.onLobby(msg.lobby);
          break;
        case 'view':
          events.onView(msg.view);
          break;
        case 'rejected':
          events.onRejected(msg.reason);
          break;
        case 'error':
          events.onError(msg.message);
          break;
      }
    });
    conn.onClose(() => events.onClosed());
    conn.send({ v: PROTOCOL_VERSION, type: 'hello', name, token });
  }

  send(action: Action): void {
    this.conn.send({ v: PROTOCOL_VERSION, type: 'intent', action });
  }

  close(): void {
    this.conn.close();
  }
}
