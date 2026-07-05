/** Minimal duplex message channel. PeerJS DataConnection adapts to this (Task 10). */
export interface Connection {
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

interface LoopEnd extends Connection {
  _deliver(msg: unknown): void;
  _closed(): void;
  _peer?: LoopEnd;
}

/** In-memory pair for unit tests: what one end sends, the other receives. */
export function createLoopbackPair(): [Connection, Connection] {
  const make = (): LoopEnd => {
    let onMsg: (msg: unknown) => void = () => {};
    let onCls: () => void = () => {};
    let open = true;
    const self: LoopEnd = {
      send(msg: unknown) {
        if (!open) return;
        const copy = structuredClone(msg); // wire behavior: no shared references
        queueMicrotask(() => self._peer!._deliver(copy));
      },
      onMessage(cb: (msg: unknown) => void) { onMsg = cb; },
      onClose(cb: () => void) { onCls = cb; },
      close() {
        if (!open) return;
        open = false;
        queueMicrotask(() => self._peer!._closed());
      },
      _deliver(msg: unknown) { if (open) onMsg(msg); },
      _closed() { if (open) { open = false; onCls(); } }
    };
    return self;
  };
  const a = make();
  const b = make();
  a._peer = b;
  b._peer = a;
  return [a, b];
}
