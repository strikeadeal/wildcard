import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for the duplicate-listener bugs: PeerJS re-emits 'open'
 * after every broker reconnect, so anything registered inside an 'open'
 * handler stacks up once per reconnect. A duplicated 'connection' listener
 * on the host attached every guest twice (duplicate lobby seats, and token
 * rejoins whose fresh connection was immediately closed by the second
 * handler); a duplicated dial on the guest opened ghost connections.
 */

class FakeEmitter {
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  on(event: string, cb: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of [...(this.listeners.get(event) ?? [])]) cb(...args);
  }
}

class FakeDataConnection extends FakeEmitter {
  peerConnection = null;
  sent: unknown[] = [];
  send(msg: unknown): void {
    this.sent.push(msg);
  }
  close(): void {
    this.emit('close');
  }
}

class FakePeer extends FakeEmitter {
  static instances: FakePeer[] = [];
  destroyed = false;
  disconnectCalls = 0;
  reconnectCalls = 0;
  connectCalls: string[] = [];
  lastDialed: FakeDataConnection | null = null;
  constructor(..._args: unknown[]) {
    super();
    FakePeer.instances.push(this);
  }
  connect(peerId: string): FakeDataConnection {
    this.connectCalls.push(peerId);
    this.lastDialed = new FakeDataConnection();
    return this.lastDialed;
  }
  disconnect(): void {
    this.disconnectCalls++;
    this.emit('disconnected');
  }
  reconnect(): void {
    this.reconnectCalls++;
  }
  destroy(): void {
    // Mirror PeerJS's real order: destroy() runs disconnect() first, which
    // emits 'disconnected' while .destroyed is still false.
    this.emit('disconnected');
    this.destroyed = true;
  }
}

vi.mock('peerjs', () => ({ default: FakePeer }));

const { hostRoom, joinRoom } = await import('../../src/net/peer');

beforeEach(() => {
  FakePeer.instances.length = 0;
});

describe('hostRoom across broker reconnects', () => {
  it('attaches a guest exactly once even after a reconnect re-emits open', async () => {
    const attached: unknown[] = [];
    const promise = hostRoom('AB2CD', (conn) => attached.push(conn));
    const peer = FakePeer.instances[0]!;
    peer.emit('open');
    await promise;

    // Broker drop → our handler reconnects → PeerJS re-emits 'open'.
    peer.emit('disconnected');
    expect(peer.reconnectCalls).toBe(1);
    peer.emit('open');

    const dc = new FakeDataConnection();
    peer.emit('connection', dc);
    dc.emit('open');
    expect(attached).toHaveLength(1);
  });

  it('accepts a guest that connected before the first open settled the promise', async () => {
    const attached: unknown[] = [];
    const promise = hostRoom('AB2CD', (conn) => attached.push(conn));
    const peer = FakePeer.instances[0]!;
    peer.emit('open');
    await promise;

    const dc = new FakeDataConnection();
    peer.emit('connection', dc);
    dc.emit('open');
    expect(attached).toHaveLength(1);
  });

  it('exposes dropSignaling, which disconnects the broker socket only', async () => {
    const promise = hostRoom('AB2CD', () => {});
    const peer = FakePeer.instances[0]!;
    peer.emit('open');
    const room = await promise;
    room.dropSignaling();
    expect(peer.disconnectCalls).toBe(1);
    expect(peer.destroyed).toBe(false);
    expect(peer.reconnectCalls).toBe(1); // the disconnected handler recovers
  });
});

describe('destroy vs the keep-alive reconnect', () => {
  it('hostRoom destroy does not zombie-reconnect off its own disconnected event', async () => {
    const promise = hostRoom('AB2CD', () => {});
    const peer = FakePeer.instances[0]!;
    peer.emit('open');
    const room = await promise;

    room.destroy();
    expect(peer.destroyed).toBe(true);
    expect(peer.reconnectCalls).toBe(0); // a destroyed host must stay gone
  });

  it('joinRoom destroy does not zombie-reconnect off its own disconnected event', async () => {
    const promise = joinRoom('AB2CD');
    const peer = FakePeer.instances[0]!;
    peer.emit('open');
    peer.lastDialed!.emit('open');
    const { destroy } = await promise;

    destroy();
    expect(peer.destroyed).toBe(true);
    expect(peer.reconnectCalls).toBe(0);
  });
});

describe('joinRoom across broker reconnects', () => {
  it('dials the host exactly once even after a reconnect re-emits open', async () => {
    const promise = joinRoom('AB2CD');
    const peer = FakePeer.instances[0]!;
    peer.emit('open');

    peer.emit('disconnected'); // pre-settle drop: no reconnect, but also…
    peer.emit('open');         // …a late re-open must not dial again
    expect(peer.connectCalls).toHaveLength(1);

    peer.lastDialed!.emit('open');
    const { conn } = await promise;
    expect(conn).toBeDefined();

    peer.emit('disconnected'); // post-settle drop → reconnect → re-open
    expect(peer.reconnectCalls).toBe(1);
    peer.emit('open');
    expect(peer.connectCalls).toHaveLength(1);
  });
});
