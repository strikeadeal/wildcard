import { describe, it, expect, vi, afterEach } from 'vitest';
import { wrapSocket, wsBase, PING_INTERVAL_MS } from '../../src/net/socket';
import type { ConnectionHealth } from '../../src/net/transport';

class FakeWebSocket {
  sent: string[] = [];
  closed: Array<number | undefined> = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closed.push(code);
  }
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}

afterEach(() => vi.useRealTimers());

describe('wsBase', () => {
  it('prefers VITE_WS_URL and strips a trailing slash', () => {
    expect(wsBase({ VITE_WS_URL: 'wss://api.example.com/' })).toBe('wss://api.example.com');
    expect(wsBase({})).toBe('ws://127.0.0.1:8787');
  });
});

describe('wrapSocket', () => {
  it('frames JSON both ways and filters keepalive pongs', () => {
    const ws = new FakeWebSocket();
    const conn = wrapSocket(ws as unknown as WebSocket);
    const got: unknown[] = [];
    conn.onMessage((m) => got.push(m));

    conn.send({ v: 2, type: 'leave' });
    expect(ws.sent).toEqual(['{"v":2,"type":"leave"}']);

    ws.receive('"pong"');
    ws.receive('{"v":2,"type":"lobby"}');
    ws.receive('not json'); // ignored, never throws
    expect(got).toEqual([{ v: 2, type: 'lobby' }]);
  });

  it('reports closed exactly once across close/error/explicit close', () => {
    const ws = new FakeWebSocket();
    const conn = wrapSocket(ws as unknown as WebSocket);
    let closes = 0;
    conn.onClose(() => closes++);
    conn.close();
    ws.onclose?.();
    ws.onerror?.();
    expect(closes).toBe(1);
    expect(ws.closed).toEqual([1000]);
  });

  it('pings on an interval; silence degrades to unstable, then cuts the socket', () => {
    vi.useFakeTimers();
    let clock = 0;
    vi.setSystemTime(0);
    const now = () => clock;
    const ws = new FakeWebSocket();
    const conn = wrapSocket(ws as unknown as WebSocket, now);
    const statuses: ConnectionHealth[] = [];
    conn.onStatus((s) => statuses.push(s));
    expect(statuses).toEqual(['connected']);

    // Healthy traffic: pings flow, status stays connected.
    clock += PING_INTERVAL_MS;
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.sent).toContain('"ping"');
    ws.receive('"pong"');
    expect(statuses).toEqual(['connected']);

    // Radio silence: 30s in it's unstable, 50s in the socket is cut.
    for (let i = 0; i < 3; i++) {
      clock += PING_INTERVAL_MS;
      vi.advanceTimersByTime(PING_INTERVAL_MS);
    }
    expect(statuses).toEqual(['connected', 'unstable']);
    for (let i = 0; i < 2; i++) {
      clock += PING_INTERVAL_MS;
      vi.advanceTimersByTime(PING_INTERVAL_MS);
    }
    expect(statuses).toEqual(['connected', 'unstable', 'closed']);
    expect(ws.closed.length).toBeGreaterThan(0);
  });

  it('recovers from unstable when traffic resumes', () => {
    vi.useFakeTimers();
    let clock = 0;
    const ws = new FakeWebSocket();
    const conn = wrapSocket(ws as unknown as WebSocket, () => clock);
    const statuses: ConnectionHealth[] = [];
    conn.onStatus((s) => statuses.push(s));

    for (let i = 0; i < 3; i++) {
      clock += PING_INTERVAL_MS;
      vi.advanceTimersByTime(PING_INTERVAL_MS);
    }
    expect(statuses).toEqual(['connected', 'unstable']);

    ws.receive('"pong"');
    expect(statuses).toEqual(['connected', 'unstable', 'connected']);
  });
});
