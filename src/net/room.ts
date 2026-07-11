import { apply } from '../engine/apply';
import { createGame, removePlayer } from '../engine/game';
import { playerIndex } from '../engine/helpers';
import { redact } from '../engine/redact';
import type { Action, GameState, RuleConfig } from '../engine/types';
import { DEFAULT_RULES } from '../engine/types';
import { deriveActionNotices, deriveConnectionNotice, type PublicNotice } from '../ui/public-notices';
import { PROTOCOL_VERSION, type ClientMsg, type LobbyInfo, type ServerMsg } from './protocol';
import type { Connection } from './transport';

interface SeatRecord {
  id: string;
  name: string;
  token: string;
  conn: Connection | null; // null: a disconnected player
}

/** Everything a room needs to survive hibernation/eviction (no live conns). */
export interface RoomSnapshot {
  seats: Array<{ id: string; name: string; token: string }>;
  nextSeat: number;
  nextNoticeId: number;
  config: RuleConfig;
  state: GameState | null;
}

export const HOST_ID = 'p0';

/**
 * The authoritative game room. Runs inside the RoomDO on Cloudflare; every
 * player — the host included — is a `Connection`. The first `hello` with
 * `create` claims seat p0 and its host powers. Transport-agnostic on purpose:
 * unit tests drive it over in-memory loopback pairs.
 */
export class RoomSession {
  state: GameState | null = null;
  lastNotices: PublicNotice[] = [];
  /** True once the host has ended the room: sockets closed, storage should be purged. */
  closed = false;
  private seats: SeatRecord[] = [];
  private nextSeat = 1;
  private nextNoticeId = 1;
  private config: RuleConfig = DEFAULT_RULES;

  constructor(
    private newToken: () => string = () => crypto.randomUUID(),
    private newSeed: () => number = () => Date.now() >>> 0
  ) {}

  /** True once a create-hello has claimed the room (or a game exists). */
  get created(): boolean {
    return this.seats.length > 0 || this.state !== null;
  }

  snapshot(): RoomSnapshot {
    return {
      seats: this.seats.map(({ id, name, token }) => ({ id, name, token })),
      nextSeat: this.nextSeat,
      nextNoticeId: this.nextNoticeId,
      config: this.config,
      state: this.state
    };
  }

  static restore(
    snap: RoomSnapshot,
    newToken?: () => string,
    newSeed?: () => number
  ): RoomSession {
    const session = new RoomSession(newToken, newSeed);
    session.seats = snap.seats.map((s) => ({ ...s, conn: null }));
    session.nextSeat = snap.nextSeat;
    session.nextNoticeId = snap.nextNoticeId;
    session.config = snap.config;
    session.state = snap.state;
    return session;
  }

  /**
   * Rebind a hibernated socket to its seat after a restore — the socket never
   * actually dropped, so no welcome/reconnect notice is sent. Returns false
   * for an unknown token (the caller should treat the socket as fresh).
   */
  reattach(token: string, conn: Connection): boolean {
    const seat = this.seats.find((s) => s.token === token);
    if (!seat) return false;
    seat.conn = conn;
    this.wire(conn, seat);
    if (this.state) {
      const idx = playerIndex(this.state, seat.id);
      if (idx !== -1 && !this.state.players[idx]!.connected) {
        this.state = structuredClone(this.state);
        this.state.players[idx]!.connected = true;
      }
    }
    return true;
  }

  attach(conn: Connection): void {
    this.wire(conn, null);
  }

  private wire(conn: Connection, initialSeat: SeatRecord | null): void {
    let seat: SeatRecord | null = initialSeat;
    conn.onMessage((raw) => {
      const msg = raw as ClientMsg;
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      if (msg.v !== PROTOCOL_VERSION) {
        this.send(conn, { v: PROTOCOL_VERSION, type: 'rejected', reason: 'version' });
        conn.close();
        return;
      }
      if (msg.type === 'hello') {
        if (seat) return; // this conn already has a seat; ignore repeated hello
        seat = this.handleHello(conn, msg.name, msg.token, msg.create === true);
      } else if (!seat) {
        return; // everything below requires a seat
      } else if (msg.type === 'intent') {
        this.handleIntent(seat, msg.action);
      } else if (msg.type === 'leave') {
        if (seat.id === HOST_ID) this.closeRoom();
        else this.removeSeat(seat.id);
      } else if (msg.type === 'config') {
        if (this.requireHost(seat)) this.setConfig(msg.config);
      } else if (msg.type === 'start') {
        if (this.requireHost(seat)) this.startGame(seat);
      } else if (msg.type === 'skipTurn') {
        if (this.requireHost(seat)) this.skipTurn(msg.playerId);
      } else if (msg.type === 'removeSeat') {
        if (this.requireHost(seat) && msg.playerId !== HOST_ID) this.removeSeat(msg.playerId);
      }
    });
    conn.onClose(() => {
      if (!seat || seat.conn !== conn) return; // superseded by a rejoin
      seat.conn = null;
      if (!this.state && seat.id !== HOST_ID) {
        // Pre-game, a dropped guest seat is freed: their auto-rejoin simply
        // seats them fresh, and no "Away" ghost lingers if they never return.
        // The host seat is always reserved — p0 is the room's identity.
        const idx = this.seats.indexOf(seat);
        if (idx !== -1) this.seats.splice(idx, 1);
        this.broadcastLobby();
        return;
      }
      this.setConnected(seat.id, false);
    });
  }

  /** The seat token bound to this conn, if any — lets the DO tag the socket. */
  tokenFor(conn: Connection): string | null {
    return this.seats.find((s) => s.conn === conn)?.token ?? null;
  }

  private requireHost(seat: SeatRecord): boolean {
    if (seat.id === HOST_ID) return true;
    this.errorTo(seat, 'Only the host can do that');
    return false;
  }

  private handleHello(
    conn: Connection, rawName: unknown, rawToken: unknown, create: boolean
  ): SeatRecord | null {
    // Clients are untrusted and `raw as ClientMsg` is an unchecked cast: coerce
    // anything that isn't the expected shape rather than throwing on it.
    const name = typeof rawName === 'string' ? rawName : '';
    const token = typeof rawToken === 'string' ? rawToken : null;
    if (token) {
      const seat = this.seats.find((s) => s.token === token);
      if (seat) {
        // Rebind before closing the stale conn: close callbacks can fire
        // synchronously, and the onClose guard must already see the new conn.
        const superseded = seat.conn;
        seat.conn = conn;
        superseded?.close();
        this.send(conn, { v: PROTOCOL_VERSION, type: 'welcome', playerId: seat.id, token });
        this.setConnected(seat.id, true);
        if (this.state) this.send(conn, { v: PROTOCOL_VERSION, type: 'view', view: redact(this.state, seat.id) });
        return seat;
      }
      if (this.state) {
        this.reject(conn, 'badToken');
        return null;
      }
    }
    if (create) {
      if (this.created) {
        // The code is already claimed (and the token above didn't match a
        // seat): the creator must pick another code.
        this.reject(conn, 'codeTaken');
        return null;
      }
      return this.seatNewPlayer(conn, name, HOST_ID);
    }
    if (!this.created) {
      // Joining a room nobody created (or one that has expired).
      this.reject(conn, 'notFound');
      return null;
    }
    if (this.state) {
      this.reject(conn, 'started');
      return null;
    }
    if (this.seats.length >= 6) {
      this.reject(conn, 'full');
      return null;
    }
    return this.seatNewPlayer(conn, name, 'p' + this.nextSeat++);
  }

  private seatNewPlayer(conn: Connection, name: string, id: string): SeatRecord {
    const cleanName = name.trim().slice(0, 20) || 'Player ' + (this.seats.length + 1);
    const seat: SeatRecord = { id, name: cleanName, token: this.newToken(), conn };
    this.seats.push(seat);
    this.send(conn, { v: PROTOCOL_VERSION, type: 'welcome', playerId: seat.id, token: seat.token });
    this.broadcastLobby();
    return seat;
  }

  private reject(conn: Connection, reason: import('./protocol').RejectReason): void {
    this.send(conn, { v: PROTOCOL_VERSION, type: 'rejected', reason });
    conn.close();
  }

  private handleIntent(seat: SeatRecord, action: Action): void {
    if (!this.state) {
      this.errorTo(seat, 'The game has not started yet');
      return;
    }
    const before = this.state;
    const result = apply(before, seat.id, action);
    if (!result.ok) {
      this.errorTo(seat, result.error);
      return;
    }
    this.state = result.state;
    const notices = this.makeNotices(before, seat.id, action);
    this.lastNotices = notices;
    this.broadcastViews(notices);
  }

  setConfig(config: RuleConfig): void {
    if (this.state) return;
    this.config = config;
    this.broadcastLobby();
  }

  /** Seats currently at the table: everyone with a live connection. */
  private presentSeats(): SeatRecord[] {
    return this.seats.filter((s) => s.conn !== null);
  }

  private startGame(hostSeat: SeatRecord): void {
    if (this.state) return;
    const present = this.presentSeats();
    if (present.length < 2) {
      this.errorTo(hostSeat, 'You need at least one other player');
      return;
    }
    this.seats = present;
    this.state = createGame(
      this.seats.map((s) => ({ id: s.id, name: s.name })),
      this.config,
      this.newSeed()
    );
    this.broadcastViews();
  }

  /** Host power: end an absent player's turn (resolves penalties by drawing). */
  private skipTurn(playerId: string): void {
    if (!this.state) return;
    if (this.state.players[this.state.turn]?.id !== playerId) return;
    const notices: PublicNotice[] = [];
    if (this.state.phase === 'chooseColor') {
      notices.push(...this.tryApply(playerId, { type: 'chooseColor', color: this.state.currentColor }));
    } else if (this.state.phase === 'chooseSwapTarget') {
      // Deliberate host power: pick an arbitrary swap target for the absent player so the game can proceed.
      const other = this.state.players.find((p) => p.id !== playerId);
      if (other) notices.push(...this.tryApply(playerId, { type: 'chooseSwapTarget', targetId: other.id }));
    } else {
      notices.push(...this.tryApply(playerId, { type: 'drawCard' }));
      if (this.state.players[this.state.turn]?.id === playerId && this.state.hasDrawnThisTurn) {
        notices.push(...this.tryApply(playerId, { type: 'passTurn' }));
      }
    }
    this.lastNotices = notices;
    this.broadcastViews(notices);
  }

  /** Deal a player out for good — host removal or the player's own leave. */
  private removeSeat(playerId: string): void {
    if (playerId === HOST_ID) return;
    const idx = this.seats.findIndex((s) => s.id === playerId);
    if (idx === -1) return;
    const conn = this.seats[idx]!.conn;
    this.seats[idx]!.conn = null;
    conn?.close();
    this.seats.splice(idx, 1);
    if (this.state && playerIndex(this.state, playerId) !== -1) {
      const before = this.state;
      this.state = removePlayer(this.state, playerId);
      this.lastNotices = this.makeStateNotices(before, this.state);
      this.broadcastViews(this.lastNotices);
    } else {
      this.broadcastLobby();
    }
  }

  /** The host ended the room: tell everyone, hang up, and mark for purge. */
  private closeRoom(): void {
    this.closed = true;
    // Detach every conn before closing so per-conn onClose guards (which
    // may fire synchronously) see a mismatch and leave the roster alone.
    const conns = this.seats.map((s) => s.conn);
    for (const seat of this.seats) seat.conn = null;
    this.seats = [];
    this.state = null;
    for (const conn of conns) {
      if (!conn) continue;
      this.send(conn, { v: PROTOCOL_VERSION, type: 'closed', reason: 'hostLeft' });
      conn.close();
    }
  }

  lobbyInfo(): LobbyInfo {
    return {
      players: this.seats.map((s) => ({
        id: s.id,
        name: s.name,
        connected: s.conn !== null
      })),
      hostId: HOST_ID,
      config: this.config,
      started: this.state !== null,
      canStart: this.presentSeats().length >= 2
    };
  }

  private tryApply(playerId: string, action: Action): PublicNotice[] {
    if (!this.state) return [];
    const before = this.state;
    const result = apply(before, playerId, action);
    if (!result.ok) return [];
    this.state = result.state;
    return this.makeNotices(before, playerId, action);
  }

  private makeNotices(before: GameState, actorId: string, action: Action): PublicNotice[] {
    if (!this.state) return [];
    const notices = deriveActionNotices(before, this.state, actorId, action, this.nextNoticeId);
    this.nextNoticeId += notices.length;
    return notices;
  }

  private makeStateNotices(before: GameState, after: GameState): PublicNotice[] {
    const notices: PublicNotice[] = [];
    if (before.phase !== 'roundEnd' && after.phase === 'roundEnd' && after.roundWinner) {
      notices.push({ id: this.nextNoticeId++, kind: 'roundWin', actorId: after.roundWinner });
    }
    return notices;
  }

  private setConnected(playerId: string, connected: boolean): void {
    if (this.state) {
      const idx = playerIndex(this.state, playerId);
      if (idx !== -1) {
        const wasConnected = this.state.players[idx]!.connected;
        this.state = structuredClone(this.state);
        this.state.players[idx]!.connected = connected;
        if (wasConnected !== connected) {
          const notice = deriveConnectionNotice(playerId, connected, this.nextNoticeId++);
          this.lastNotices = [notice];
          this.broadcastViews([notice]);
          return;
        }
        this.lastNotices = [];
      } else {
        this.lastNotices = [];
      }
      this.broadcastViews();
    } else {
      this.broadcastLobby();
    }
  }

  private errorTo(seat: SeatRecord, message: string): void {
    if (seat.conn) this.send(seat.conn, { v: PROTOCOL_VERSION, type: 'error', message });
  }

  private broadcastLobby(): void {
    const lobby = this.lobbyInfo();
    for (const seat of this.seats) {
      if (seat.conn) this.send(seat.conn, { v: PROTOCOL_VERSION, type: 'lobby', lobby });
    }
  }

  private broadcastViews(notices: PublicNotice[] = []): void {
    if (!this.state) return;
    for (const seat of this.seats) {
      if (seat.conn && playerIndex(this.state, seat.id) !== -1) {
        this.send(seat.conn, { v: PROTOCOL_VERSION, type: 'view', view: redact(this.state, seat.id), notices });
      }
    }
  }

  private send(conn: Connection, msg: ServerMsg): void {
    conn.send(msg);
  }
}
