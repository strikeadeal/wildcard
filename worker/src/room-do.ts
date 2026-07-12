import { RoomSession, type RoomEvent, type RoomSnapshot } from '../../src/net/room';
import type { Connection } from '../../src/net/transport';
import type { Env } from './index';

const SNAPSHOT_KEY = 'room:v2';
/** A room with no live sockets is purged this long after its last activity. */
const EXPIRE_AFTER_MS = 12 * 60 * 60 * 1000;

interface Attachment {
  token: string;
}

/** Adapter between a hibernatable WebSocket and the RoomSession's Connection. */
interface SocketAdapter {
  conn: Connection;
  deliver(msg: unknown): void;
  notifyClose(): void;
}

/**
 * One Durable Object per room code — the authoritative game server. Uses the
 * WebSocket Hibernation API so idle rooms cost nothing: the session state is
 * snapshotted into storage after every event and rebuilt on wake, and live
 * sockets are re-bound to their seats via their serialized seat token.
 */
export class RoomDO {
  private session!: RoomSession;
  private adapters = new Map<WebSocket, SocketAdapter>();

  constructor(private ctx: DurableObjectState, env: Env) {
    const seed = env.GAME_SEED ? Number(env.GAME_SEED) : NaN;
    const newSeed = Number.isFinite(seed) ? () => seed : undefined;
    this.ctx.blockConcurrencyWhile(async () => {
      const snap = await this.ctx.storage.get<RoomSnapshot>(SNAPSHOT_KEY);
      this.session = snap
        ? RoomSession.restore(snap, undefined, newSeed, (event) => this.logEvent(event))
        : new RoomSession(undefined, newSeed, (event) => this.logEvent(event));
      for (const ws of this.ctx.getWebSockets()) {
        const adapter = this.makeAdapter(ws);
        const token = (ws.deserializeAttachment() as Attachment | null)?.token;
        if (token && this.session.reattach(token, adapter.conn)) continue;
        if (token) {
          // The seat vanished while hibernated (room expired): cut the socket
          // so the client's recovery flow takes over.
          adapter.conn.close();
        } else {
          this.session.attach(adapter.conn); // connected but never said hello
        }
      }
      // Answer keepalive pings from hibernation, without waking this object.
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('"ping"', '"pong"'));
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    this.session.attach(this.makeAdapter(server).conn);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    const adapter = this.adapters.get(ws);
    if (!adapter || typeof raw !== 'string') return;
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    adapter.deliver(msg);
    // If this message seated the socket (hello), tag it so the seat binding
    // survives hibernation.
    const token = this.session.tokenFor(adapter.conn);
    const attached = (ws.deserializeAttachment() as Attachment | null)?.token;
    if (token && token !== attached) ws.serializeAttachment({ token } satisfies Attachment);
    await this.persist();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.adapters.get(ws)?.notifyClose();
    this.adapters.delete(ws);
    await this.persist();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    console.warn(JSON.stringify({ component: 'room', kind: 'socketError' }));
    return this.webSocketClose(ws);
  }

  /** Expiry sweep: a room nobody is connected to gets purged. */
  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      console.info(JSON.stringify({ component: 'room', kind: 'roomExpired' }));
      await this.ctx.storage.deleteAll();
    } else {
      await this.ctx.storage.setAlarm(Date.now() + EXPIRE_AFTER_MS);
    }
  }

  private async persist(): Promise<void> {
    if (this.session.closed) {
      this.adapters.clear();
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    if (!this.session.created) {
      // Nothing worth keeping (e.g. a rejected join on a dead room).
      await this.ctx.storage.delete(SNAPSHOT_KEY);
      return;
    }
    await this.ctx.storage.put(SNAPSHOT_KEY, this.session.snapshot());
    await this.ctx.storage.setAlarm(Date.now() + EXPIRE_AFTER_MS);
  }

  private makeAdapter(ws: WebSocket): SocketAdapter {
    let onMsg: (msg: unknown) => void = () => {};
    let onCls: () => void = () => {};
    let notified = false;
    const adapter: SocketAdapter = {
      conn: {
        send: (msg) => {
          try {
            ws.send(JSON.stringify(msg));
          } catch {
            // Socket already closing — the close event will tidy the seat.
          }
        },
        onMessage: (cb) => { onMsg = cb; },
        onClose: (cb) => { onCls = cb; },
        onStatus: (cb) => cb('connected'),
        close: () => {
          try {
            ws.close(1000, 'room closed the connection');
          } catch {
            // Already closed.
          }
          // Hibernatable sockets we close ourselves don't always echo a
          // close event back into webSocketClose — settle the seat now.
          adapter.notifyClose();
        }
      },
      deliver: (msg) => onMsg(msg),
      notifyClose: () => {
        if (notified) return;
        notified = true;
        onCls();
      }
    };
    this.adapters.set(ws, adapter);
    return adapter;
  }

  private logEvent(event: RoomEvent): void {
    const line = JSON.stringify({ component: 'room', ...event });
    if (event.kind === 'protocolRejected') console.warn(line);
    else console.info(line);
  }
}
