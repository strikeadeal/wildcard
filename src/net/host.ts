import { apply } from '../engine/apply';
import { createGame, removePlayer } from '../engine/game';
import { playerIndex } from '../engine/helpers';
import { redact } from '../engine/redact';
import type { Action, GameState, PlayerView, RuleConfig } from '../engine/types';
import { PROTOCOL_VERSION, type ClientMsg, type LobbyInfo, type ServerMsg } from './protocol';
import type { Connection } from './transport';

export interface HostEvents {
  onLobby(lobby: LobbyInfo): void;
  onView(view: PlayerView): void;
  onError(message: string): void;
}

interface SeatRecord {
  id: string;
  name: string;
  token: string;
  conn: Connection | null; // null: the host seat, or a disconnected guest
}

export class HostSession {
  readonly hostPlayerId = 'p0' as const;
  state: GameState | null = null;
  private seats: SeatRecord[] = [];
  private nextSeat = 1;
  private config: RuleConfig;

  constructor(
    hostName: string,
    config: RuleConfig,
    private events: HostEvents,
    private newToken: () => string = () => crypto.randomUUID()
  ) {
    this.config = config;
    this.seats.push({ id: 'p0', name: hostName, token: this.newToken(), conn: null });
  }

  attach(conn: Connection): void {
    let seat: SeatRecord | null = null;
    conn.onMessage((raw) => {
      const msg = raw as ClientMsg;
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      if (msg.v !== PROTOCOL_VERSION) {
        this.send(conn, { v: PROTOCOL_VERSION, type: 'rejected', reason: 'version' });
        conn.close();
        return;
      }
      if (msg.type === 'hello') {
        seat = this.handleHello(conn, msg.name, msg.token);
      } else if (msg.type === 'intent' && seat) {
        this.handleIntent(seat, msg.action);
      }
    });
    conn.onClose(() => {
      if (!seat || seat.conn !== conn) return; // superseded by a rejoin
      seat.conn = null;
      this.setConnected(seat.id, false);
    });
  }

  private handleHello(conn: Connection, name: string, token: string | null): SeatRecord | null {
    if (token) {
      const seat = this.seats.find((s) => s.token === token);
      if (seat) {
        seat.conn?.close();
        seat.conn = conn;
        this.send(conn, { v: PROTOCOL_VERSION, type: 'welcome', playerId: seat.id, token });
        this.setConnected(seat.id, true);
        if (this.state) this.send(conn, { v: PROTOCOL_VERSION, type: 'view', view: redact(this.state, seat.id) });
        return seat;
      }
      if (this.state) {
        this.send(conn, { v: PROTOCOL_VERSION, type: 'rejected', reason: 'badToken' });
        conn.close();
        return null;
      }
    }
    if (this.state) {
      this.send(conn, { v: PROTOCOL_VERSION, type: 'rejected', reason: 'started' });
      conn.close();
      return null;
    }
    if (this.seats.length >= 6) {
      this.send(conn, { v: PROTOCOL_VERSION, type: 'rejected', reason: 'full' });
      conn.close();
      return null;
    }
    const cleanName = name.trim().slice(0, 20) || 'Player ' + (this.seats.length + 1);
    const seat: SeatRecord = {
      id: 'p' + this.nextSeat++,
      name: cleanName,
      token: this.newToken(),
      conn
    };
    this.seats.push(seat);
    this.send(conn, { v: PROTOCOL_VERSION, type: 'welcome', playerId: seat.id, token: seat.token });
    this.broadcastLobby();
    return seat;
  }

  private handleIntent(seat: SeatRecord, action: Action): void {
    if (!this.state) {
      this.errorTo(seat, 'The game has not started yet');
      return;
    }
    const result = apply(this.state, seat.id, action);
    if (!result.ok) {
      this.errorTo(seat, result.error);
      return;
    }
    this.state = result.state;
    this.broadcastViews();
  }

  applyLocal(action: Action): void {
    this.handleIntent(this.seats[0]!, action);
  }

  setConfig(config: RuleConfig): void {
    if (this.state) return;
    this.config = config;
    this.broadcastLobby();
  }

  startGame(): void {
    if (this.state) return;
    const present = this.seats.filter((s) => s.id === 'p0' || s.conn !== null);
    if (present.length < 2) {
      this.events.onError('You need at least one other player');
      return;
    }
    this.seats = present;
    this.state = createGame(
      this.seats.map((s) => ({ id: s.id, name: s.name })),
      this.config,
      Date.now() >>> 0
    );
    this.broadcastViews();
  }

  /** Host power: end an absent player's turn (resolves penalties by drawing). */
  skipTurn(playerId: string): void {
    if (!this.state) return;
    if (this.state.players[this.state.turn]?.id !== playerId) return;
    if (this.state.phase === 'chooseColor') {
      this.tryApply(playerId, { type: 'chooseColor', color: this.state.currentColor });
    } else if (this.state.phase === 'chooseSwapTarget') {
      // Deliberate host power: pick an arbitrary swap target for the absent player so the game can proceed.
      const other = this.state.players.find((p) => p.id !== playerId);
      if (other) this.tryApply(playerId, { type: 'chooseSwapTarget', targetId: other.id });
    } else {
      this.tryApply(playerId, { type: 'drawCard' });
      if (this.state.players[this.state.turn]?.id === playerId && this.state.hasDrawnThisTurn) {
        this.tryApply(playerId, { type: 'passTurn' });
      }
    }
    this.broadcastViews();
  }

  /** Host power: permanently deal a guest out. */
  removeSeat(playerId: string): void {
    if (playerId === 'p0') return;
    const idx = this.seats.findIndex((s) => s.id === playerId);
    if (idx === -1) return;
    this.seats[idx]!.conn?.close();
    this.seats.splice(idx, 1);
    if (this.state && playerIndex(this.state, playerId) !== -1) {
      this.state = removePlayer(this.state, playerId);
      this.broadcastViews();
    } else {
      this.broadcastLobby();
    }
  }

  lobbyInfo(): LobbyInfo {
    return {
      players: this.seats.map((s) => ({
        id: s.id,
        name: s.name,
        connected: s.id === 'p0' || s.conn !== null
      })),
      hostId: 'p0',
      config: this.config,
      started: this.state !== null
    };
  }

  private tryApply(playerId: string, action: Action): void {
    if (!this.state) return;
    const result = apply(this.state, playerId, action);
    if (result.ok) this.state = result.state;
  }

  private setConnected(playerId: string, connected: boolean): void {
    if (this.state) {
      const idx = playerIndex(this.state, playerId);
      if (idx !== -1) {
        this.state = structuredClone(this.state);
        this.state.players[idx]!.connected = connected;
      }
      this.broadcastViews();
    } else {
      this.broadcastLobby();
    }
  }

  private errorTo(seat: SeatRecord, message: string): void {
    if (seat.id === 'p0') this.events.onError(message);
    else if (seat.conn) this.send(seat.conn, { v: PROTOCOL_VERSION, type: 'error', message });
  }

  private broadcastLobby(): void {
    const lobby = this.lobbyInfo();
    for (const seat of this.seats) {
      if (seat.conn) this.send(seat.conn, { v: PROTOCOL_VERSION, type: 'lobby', lobby });
    }
    this.events.onLobby(lobby);
  }

  private broadcastViews(): void {
    if (!this.state) return;
    for (const seat of this.seats) {
      if (seat.conn && playerIndex(this.state, seat.id) !== -1) {
        this.send(seat.conn, { v: PROTOCOL_VERSION, type: 'view', view: redact(this.state, seat.id) });
      }
    }
    this.events.onView(redact(this.state, 'p0'));
  }

  private send(conn: Connection, msg: ServerMsg): void {
    conn.send(msg);
  }
}
