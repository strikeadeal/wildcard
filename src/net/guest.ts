import type { Action } from '../engine/types';
import type { PublicNotice } from '../ui/public-notices';
import { PROTOCOL_VERSION, type ServerMsg } from './protocol';
import type { Connection, ConnectionHealth } from './transport';

export interface GuestEvents {
  onWelcome(playerId: string, token: string): void;
  onLobby(lobby: import('./protocol').LobbyInfo): void;
  onView(view: import('../engine/types').PlayerView, notices?: PublicNotice[]): void;
  onRejected(reason: 'version' | 'full' | 'started' | 'badToken'): void;
  onError(message: string): void;
  onClosed(): void;
  onConnectionStatus(status: ConnectionHealth): void;
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
          events.onView(msg.view, msg.notices);
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
    conn.onStatus((status) => events.onConnectionStatus(status));
    conn.send({ v: PROTOCOL_VERSION, type: 'hello', name, token });
  }

  send(action: Action): void {
    this.conn.send({ v: PROTOCOL_VERSION, type: 'intent', action });
  }

  /** Deliberate exit: tell the host to free the seat now, then hang up. */
  leave(): void {
    try {
      this.conn.send({ v: PROTOCOL_VERSION, type: 'leave' });
    } catch {
      // The channel may already be dead — leaving must never throw.
    }
    this.conn.close();
  }

  close(): void {
    this.conn.close();
  }
}
