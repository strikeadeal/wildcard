import { describe, it, expect } from 'vitest';
import { createLoopbackPair } from '../../src/net/transport';

/** Macrotask boundary: runs after all queued microtasks have drained. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('loopback transport', () => {
  it('delivers a structured clone, not a shared reference', async () => {
    const [a, b] = createLoopbackPair();
    const received: unknown[] = [];
    b.onMessage((m) => received.push(m));
    const msg = { type: 'hello', nested: { n: 1 } };
    a.send(msg);
    msg.nested.n = 99; // mutation after send must not affect what arrives
    await flush();
    expect(received).toEqual([{ type: 'hello', nested: { n: 1 } }]);
    expect((received[0] as { nested: object }).nested).not.toBe(msg.nested);
  });

  it('close notifies the peer onClose', async () => {
    const [a, b] = createLoopbackPair();
    let closed = 0;
    b.onClose(() => closed++);
    a.close();
    await flush();
    expect(closed).toBe(1);
  });

  it('self-close fires own onClose', async () => {
    const [a] = createLoopbackPair();
    let closed = 0;
    a.onClose(() => closed++);
    a.close();
    await flush();
    expect(closed).toBe(1);
  });

  it('mutual close fires each side onClose exactly once', async () => {
    const [a, b] = createLoopbackPair();
    let aClosed = 0;
    let bClosed = 0;
    a.onClose(() => aClosed++);
    b.onClose(() => bClosed++);
    a.close();
    b.close();
    await flush();
    expect(aClosed).toBe(1);
    expect(bClosed).toBe(1);
  });

  it('drops sends after close', async () => {
    const [a, b] = createLoopbackPair();
    const received: unknown[] = [];
    b.onMessage((m) => received.push(m));
    a.close();
    a.send({ type: 'late' });
    await flush();
    expect(received).toEqual([]);
  });
});
