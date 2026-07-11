import type { Action, RuleConfig } from '../engine/types';
import type { PublicNotice } from '../ui/public-notices';
import { PROTOCOL_VERSION, type ClientMsg, type RejectReason, type ServerMsg } from './protocol';
import type { Connection, ConnectionHealth } from './transport';

export interface GuestEvents {
  onWelcome(playerId: string, token: string): void;
  onLobby(lobby: import('./protocol').LobbyInfo): void;
  onView(view: import('../engine/types').PlayerView, notices?: PublicNotice[], intentId?: number): void;
  onRejected(reason: RejectReason): void;
  onError(message: string, intentId?: number): void;
  onClosed(): void;
  onRoomClosed(): void;
  onConnectionStatus(status: ConnectionHealth): void;
}

/** The client end for every player — the host is just the client seated at p0. */
export class GuestSession {
  playerId: string | null = null;

  constructor(
    private conn: Connection,
    name: string,
    token: string | null,
    create: boolean,
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
          events.onView(msg.view, msg.notices, msg.intentId);
          break;
        case 'rejected':
          events.onRejected(msg.reason);
          break;
        case 'error':
          events.onError(msg.message, msg.intentId);
          break;
        case 'closed':
          events.onRoomClosed();
          break;
      }
    });
    conn.onClose(() => events.onClosed());
    conn.onStatus((status) => events.onConnectionStatus(status));
    conn.send({ v: PROTOCOL_VERSION, type: 'hello', name, token, create });
  }

  send(action: Action, intentId?: number): void {
    this.sendMsg({ v: PROTOCOL_VERSION, type: 'intent', action, intentId });
  }

  // Host commands — the room enforces that only seat p0 may issue these.
  startGame(): void {
    this.sendMsg({ v: PROTOCOL_VERSION, type: 'start' });
  }

  setConfig(config: RuleConfig): void {
    this.sendMsg({ v: PROTOCOL_VERSION, type: 'config', config });
  }

  skipTurn(playerId: string): void {
    this.sendMsg({ v: PROTOCOL_VERSION, type: 'skipTurn', playerId });
  }

  removeSeat(playerId: string): void {
    this.sendMsg({ v: PROTOCOL_VERSION, type: 'removeSeat', playerId });
  }

  /** Deliberate exit: tell the room to free the seat now, then hang up. */
  leave(): void {
    this.sendMsg({ v: PROTOCOL_VERSION, type: 'leave' });
    this.conn.close();
  }

  close(): void {
    this.conn.close();
  }

  private sendMsg(msg: ClientMsg): void {
    try {
      this.conn.send(msg);
    } catch {
      // The channel may already be dead — outbound messages must never throw.
    }
  }
}
