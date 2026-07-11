import type { Connection, ConnectionHealth } from './transport';

interface SocketEnvironment {
  VITE_WS_URL?: string;
}

/**
 * Production points at the deployed Cloudflare Worker via VITE_WS_URL
 * (e.g. wss://wildcard-api.example.workers.dev); dev/e2e default to a
 * local `wrangler dev` instance.
 */
export function wsBase(env: SocketEnvironment = import.meta.env): string {
  return (env.VITE_WS_URL || 'ws://127.0.0.1:8787').replace(/\/$/, '');
}

// The RoomDO answers a literal `"ping"` frame with `"pong"` without waking
// (WebSocket auto-response), so this doubles as a liveness probe that works
// even against a hibernated room. A stalled link degrades to 'unstable'
// (recovery overlay) and is cut shortly after so the rejoin flow takes over —
// the WebSocket 'close' event alone can take minutes to fire on a dead radio.
export const PING_INTERVAL_MS = 10_000;
const UNSTABLE_AFTER_MS = 25_000;
const DEAD_AFTER_MS = 40_000;

export function wrapSocket(
  ws: WebSocket,
  now: () => number = () => Date.now()
): Connection {
  let onMsg: (msg: unknown) => void = () => {};
  let onCls: () => void = () => {};
  let onStat: (status: ConnectionHealth) => void = () => {};
  let notified = false;
  let status: ConnectionHealth = 'connected';
  let lastHeard = now();
  const setStatus = (next: ConnectionHealth) => {
    status = next;
    onStat(next);
  };
  const notifyClose = () => {
    if (notified) return;
    notified = true;
    clearInterval(pingTimer);
    setStatus('closed');
    onCls();
  };
  const pingTimer = setInterval(() => {
    const silence = now() - lastHeard;
    if (silence >= DEAD_AFTER_MS) {
      try { ws.close(); } catch { /* already closing */ }
      notifyClose();
      return;
    }
    if (silence >= UNSTABLE_AFTER_MS && status === 'connected') setStatus('unstable');
    try { ws.send('"ping"'); } catch { /* buffered send on a dying socket */ }
  }, PING_INTERVAL_MS);
  ws.onmessage = (ev) => {
    lastHeard = now();
    if (status === 'unstable') setStatus('connected');
    if (typeof ev.data !== 'string') return;
    let msg: unknown;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg === 'pong') return; // keepalive only
    onMsg(msg);
  };
  ws.onclose = notifyClose;
  ws.onerror = notifyClose;
  return {
    send: (msg) => {
      try { ws.send(JSON.stringify(msg)); } catch { /* socket already dead */ }
    },
    onMessage: (cb) => { onMsg = cb; },
    onClose: (cb) => { onCls = cb; },
    onStatus: (cb) => {
      onStat = cb;
      cb(status);
    },
    close: () => {
      try { ws.close(1000); } catch { /* already closed */ }
      notifyClose();
    }
  };
}

/**
 * Open a WebSocket to the room. Resolves once the socket is up; whether the
 * room exists / the code is free is answered at the protocol level
 * ('rejected' with notFound/codeTaken), not the transport level.
 */
export function connectRoom(code: string): Promise<{ conn: Connection; destroy(): void }> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsBase() + '/room/' + code);
    } catch {
      reject(new Error('network'));
      return;
    }
    let settled = false;
    ws.onopen = () => {
      settled = true;
      const conn = wrapSocket(ws);
      resolve({ conn, destroy: () => conn.close() });
    };
    const failEarly = () => {
      if (settled) return;
      settled = true;
      reject(new Error('network'));
    };
    ws.onclose = failEarly;
    ws.onerror = failEarly;
  });
}
