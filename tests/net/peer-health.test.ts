import { describe, expect, it, vi } from 'vitest';
import { bindIceHealth } from '../../src/net/peer';
import type { ConnectionHealth } from '../../src/net/transport';

type Listener = () => void;

function fakePc(initial: RTCIceConnectionState = 'new') {
  let state = initial;
  const listeners = new Map<string, Listener[]>();
  return {
    get iceConnectionState() {
      return state;
    },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
    },
    setState(next: RTCIceConnectionState) {
      state = next;
      for (const listener of listeners.get('iceconnectionstatechange') ?? []) listener();
    },
    listenerCount(type: string) {
      return (listeners.get(type) ?? []).length;
    }
  } as Pick<RTCPeerConnection, 'iceConnectionState' | 'addEventListener' | 'removeEventListener'> & {
    setState(next: RTCIceConnectionState): void;
    listenerCount(type: string): number;
  };
}

describe('bindIceHealth', () => {
  it('reports unstable immediately and closes after the disconnect grace expires', () => {
    vi.useFakeTimers();
    const pc = fakePc('connected');
    const statuses: ConnectionHealth[] = [];
    let closed = 0;

    bindIceHealth(pc, {
      onHealth: (status) => {
        statuses.push(status);
        if (status === 'closed') closed++;
      },
      disconnectGraceMs: 4000
    });

    pc.setState('disconnected');
    expect(statuses).toEqual(['connected', 'unstable']);
    expect(closed).toBe(0);

    vi.advanceTimersByTime(4000);
    expect(statuses).toEqual(['connected', 'unstable', 'closed']);
    expect(closed).toBe(1);
    vi.useRealTimers();
  });

  it('closes after the grace when starting disconnected and never recovering', () => {
    vi.useFakeTimers();
    const pc = fakePc('disconnected');
    const statuses: ConnectionHealth[] = [];
    let closed = 0;

    bindIceHealth(pc, {
      onHealth: (status) => {
        statuses.push(status);
        if (status === 'closed') closed++;
      },
      disconnectGraceMs: 4000
    });

    expect(statuses).toEqual(['unstable']);
    expect(closed).toBe(0);

    vi.advanceTimersByTime(4000);
    expect(statuses).toEqual(['unstable', 'closed']);
    expect(closed).toBe(1);
    vi.useRealTimers();
  });

  it('returns to connected without closing when starting disconnected and recovering inside the grace window', () => {
    vi.useFakeTimers();
    const pc = fakePc('disconnected');
    const statuses: ConnectionHealth[] = [];
    let closed = 0;

    bindIceHealth(pc, {
      onHealth: (status) => {
        statuses.push(status);
        if (status === 'closed') closed++;
      },
      disconnectGraceMs: 4000
    });

    expect(statuses).toEqual(['unstable']);
    vi.advanceTimersByTime(1000);
    pc.setState('connected');
    vi.advanceTimersByTime(4000);

    expect(statuses).toEqual(['unstable', 'connected']);
    expect(closed).toBe(0);
    vi.useRealTimers();
  });

  it('returns to connected without closing when ICE recovers inside the grace window', () => {
    vi.useFakeTimers();
    const pc = fakePc('connected');
    const statuses: ConnectionHealth[] = [];
    let closed = 0;

    bindIceHealth(pc, {
      onHealth: (status) => {
        statuses.push(status);
        if (status === 'closed') closed++;
      },
      disconnectGraceMs: 4000
    });

    pc.setState('disconnected');
    vi.advanceTimersByTime(1000);
    pc.setState('connected');
    vi.advanceTimersByTime(4000);

    expect(statuses).toEqual(['connected', 'unstable', 'connected']);
    expect(closed).toBe(0);
    vi.useRealTimers();
  });

  it('removes the ICE listener when the binding is cleaned up', () => {
    const pc = fakePc('connected');
    const dispose = bindIceHealth(pc, { onHealth: () => {} });

    expect(pc.listenerCount('iceconnectionstatechange')).toBe(1);

    dispose();

    expect(pc.listenerCount('iceconnectionstatechange')).toBe(0);
  });
});
