import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { codeToPeerId } from './codes';
import { buildIceConfig, type TurnEnvironment } from './ice';
import type { Connection, ConnectionHealth } from './transport';

/**
 * E2E and local dev can point at a local PeerServer via Vite env:
 *   VITE_PEER_HOST=localhost VITE_PEER_PORT=9000
 * Default ({}) is the free public PeerJS cloud broker.
 */
interface PeerEnvironment extends TurnEnvironment {
  VITE_PEER_HOST?: string;
  VITE_PEER_PORT?: string;
}

export function peerOptions(env: PeerEnvironment = import.meta.env): PeerOptions {
  const host = env.VITE_PEER_HOST;
  const config = buildIceConfig(env);
  return {
    ...(host ? {
      host,
      port: Number(env.VITE_PEER_PORT ?? 9000),
      path: '/',
      secure: false
    } : {}),
    ...(config ? { config } : {})
  };
}

// PeerJS emits 'close' promptly on a graceful disconnect, but on an abrupt
// tab death (no time to signal) there is no 'close'/'error' event at all —
// the underlying RTCPeerConnection just drifts through ICE states. Watch
// ICE state directly so an abrupt loss is still detected within seconds
// instead of relying on events that may never come.
const ICE_DISCONNECT_GRACE_MS = 4_000;

export function bindIceHealth(
  pc: Pick<RTCPeerConnection, 'iceConnectionState' | 'addEventListener'>,
  {
    onHealth,
    disconnectGraceMs = ICE_DISCONNECT_GRACE_MS
  }: {
    onHealth: (status: Exclude<ConnectionHealth, 'connecting'>) => void;
    disconnectGraceMs?: number;
  }
): () => void {
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const clearDisconnectTimer = () => {
    if (disconnectTimer !== undefined) {
      clearTimeout(disconnectTimer);
      disconnectTimer = undefined;
    }
  };
  const emitClosed = () => {
    if (closed) return;
    closed = true;
    clearDisconnectTimer();
    onHealth('closed');
  };
  pc.addEventListener('iceconnectionstatechange', () => {
    const state = pc.iceConnectionState;
    if (state === 'failed' || state === 'closed') {
      emitClosed();
    } else if (state === 'disconnected') {
      onHealth('unstable');
      if (disconnectTimer === undefined) {
        disconnectTimer = setTimeout(() => {
          disconnectTimer = undefined;
          const settled = pc.iceConnectionState;
          if (settled !== 'connected' && settled !== 'completed') emitClosed();
        }, disconnectGraceMs);
      }
    } else if (state === 'connected' || state === 'completed') {
      clearDisconnectTimer();
      onHealth('connected');
    }
  });
  const initial = pc.iceConnectionState;
  if (initial === 'connected' || initial === 'completed') onHealth('connected');
  else if (initial === 'disconnected') onHealth('unstable');
  else if (initial === 'failed' || initial === 'closed') emitClosed();
  return clearDisconnectTimer;
}

function wrap(dc: DataConnection): Connection {
  let onMsg: (msg: unknown) => void = () => {};
  let onCls: () => void = () => {};
  let onStat: (status: ConnectionHealth) => void = () => {};
  let notified = false;
  let status: ConnectionHealth = 'connecting';
  let unbindIceHealth: (() => void) | undefined;
  const setStatus = (next: ConnectionHealth) => {
    status = next;
    onStat(next);
  };
  // PeerJS may emit 'error' and 'close' for the same failure; the Connection
  // contract is onClose at most once.
  const notifyClose = () => {
    if (notified) return;
    notified = true;
    unbindIceHealth?.();
    unbindIceHealth = undefined;
    setStatus('closed');
    onCls();
  };
  let iceWatchAttached = false;
  const attachIceWatch = () => {
    if (iceWatchAttached) return;
    const pc = dc.peerConnection;
    if (!pc) return;
    iceWatchAttached = true;
    unbindIceHealth = bindIceHealth(pc, {
      onHealth: (health) => {
        if (health === 'closed') notifyClose();
        else setStatus(health);
      }
    });
  };
  dc.on('data', (data) => onMsg(data));
  dc.on('close', notifyClose);
  dc.on('error', notifyClose);
  // Both call sites construct wrap(dc) from inside dc's own 'open' handler,
  // so peerConnection is typically already present; the 'open' listener is
  // a defensive fallback for any future caller that wraps earlier.
  dc.on('open', attachIceWatch);
  attachIceWatch();
  return {
    send: (msg) => dc.send(msg),
    onMessage: (cb) => { onMsg = cb; },
    onClose: (cb) => { onCls = cb; },
    onStatus: (cb) => {
      onStat = cb;
      cb(status);
    },
    close: () => dc.close()
  };
}

export function hostRoom(
  code: string,
  onConnection: (conn: Connection) => void
): Promise<{ destroy(): void }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(codeToPeerId(code), peerOptions());
    let settled = false;
    peer.on('open', () => {
      peer.on('connection', (dc) => {
        dc.on('open', () => onConnection(wrap(dc)));
      });
      settled = true;
      resolve({ destroy: () => peer.destroy() });
    });
    // A broker drop after setup must not kill live games: established data
    // channels survive signaling loss. Reconnect so future joins still work.
    peer.on('disconnected', () => {
      if (settled && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => {
      if (settled) return;
      const type = (err as { type?: string }).type;
      peer.destroy();
      reject(new Error(type === 'unavailable-id' ? 'code-taken' : 'network'));
    });
  });
}

export function joinRoom(code: string): Promise<{ conn: Connection; destroy(): void }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let settled = false;
    peer.on('open', () => {
      const dc = peer.connect(codeToPeerId(code), { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        settled = true;
        resolve({ conn: wrap(dc), destroy: () => peer.destroy() });
      });
    });
    peer.on('disconnected', () => {
      if (settled && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => {
      if (settled) return;
      const type = (err as { type?: string }).type;
      peer.destroy();
      reject(new Error(type === 'peer-unavailable' ? 'not-found' : 'network'));
    });
  });
}
