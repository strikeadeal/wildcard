import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReconnectGate, reconnectDelay } from '../../src/ui/reconnect-policy';

afterEach(() => vi.useRealTimers());

describe('reconnect policy', () => {
  it('backs off at 0, 1, 2, 4, then caps at 8 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(reconnectDelay))
      .toEqual([0, 1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('waits for the delay while online', async () => {
    vi.useFakeTimers();
    const gate = new ReconnectGate();
    const waiting = gate.wait(2000, true);
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void waiting.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toBe('ready');
  });

  it('waits without a timer while offline and wakes immediately on online', async () => {
    vi.useFakeTimers();
    const gate = new ReconnectGate();
    const waiting = gate.wait(8000, false);
    await vi.advanceTimersByTimeAsync(60_000);
    gate.wake();
    await expect(waiting).resolves.toBe('ready');
  });

  it('cancels a pending wait and does not leak its timer', async () => {
    vi.useFakeTimers();
    const gate = new ReconnectGate();
    const waiting = gate.wait(8000, true);
    gate.cancel();
    await expect(waiting).resolves.toBe('cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });
});
