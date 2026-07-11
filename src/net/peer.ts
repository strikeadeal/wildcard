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
  pc: Pick<RTCPeerConnection, 'iceConnectionState' | 'addEventListener' | 'removeEventListener'>,
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
  const emitDisconnected = () => {
    if (closed) return;
    onHealth('unstable');
    if (disconnectTimer !== undefined) return;
    disconnectTimer = setTimeout(() => {
      disconnectTimer = undefined;
      const settled = pc.iceConnectionState;
      if (settled !== 'connected' && settled !== 'completed') emitClosed();
    }, disconnectGraceMs);
  };
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
  const onIceConnectionStateChange = () => {
    const state = pc.iceConnectionState;
    if (state === 'failed' || state === 'closed') {
      emitClosed();
    } else if (state === 'disconnected') {
      emitDisconnected();
    } else if (state === 'connected' || state === 'completed') {
      clearDisconnectTimer();
      onHealth('connected');
    }
  };
  pc.addEventListener('iceconnectionstatechange', onIceConnectionStateChange);
  const initial = pc.iceConnectionState;
  if (initial === 'connected' || initial === 'completed') onHealth('connected');
  else if (initial === 'disconnected') emitDisconnected();
  else if (initial === 'failed' || initial === 'closed') emitClosed();
  return () => {
    clearDisconnectTimer();
    pc.removeEventListener('iceconnectionstatechange', onIceConnectionStateChange);
  };
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
    // flush: parting messages (a guest's 'leave', the host's 'rejected')
    // must reach the wire before the channel tears down.
    close: () => dc.close({ flush: true })
  };
}

export interface HostRoomHandle {
  destroy(): void;
  /** Test-only: drop the broker socket the way a flaky network does; the
   * 'disconnected' handler below then reconnects, re-emitting 'open'. */
  dropSignaling(): void;
}

export function hostRoom(
  code: string,
  onConnection: (conn: Connection) => void
): Promise<HostRoomHandle> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(codeToPeerId(code), peerOptions());
    let settled = false;
    // peer.destroy() emits 'disconnected' BEFORE peer.destroyed flips true,
    // so the keep-alive below would reconnect a peer that is being torn
    // down — leaving a zombie registration that swallows future joins.
    // Track destruction ourselves.
    let destroyed = false;
    const destroy = () => {
      destroyed = true;
      peer.destroy();
    };
    // Registered once, outside 'open': PeerJS re-emits 'open' after every
    // broker reconnect, and a listener added per 'open' would attach each
    // future guest connection N times (duplicate seats, superseded rejoins).
    peer.on('connection', (dc) => {
      dc.on('open', () => onConnection(wrap(dc)));
    });
    peer.on('open', () => {
      if (settled) return; // reconnect re-emits 'open'
      settled = true;
      resolve({
        destroy,
        dropSignaling: () => peer.disconnect()
      });
    });
    // A broker drop after setup must not kill live games: established data
    // channels survive signaling loss. Reconnect so future joins still work.
    peer.on('disconnected', () => {
      if (settled && !destroyed && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => {
      if (settled) return;
      const type = (err as { type?: string }).type;
      destroy();
      reject(new Error(type === 'unavailable-id' ? 'code-taken' : 'network'));
    });
  });
}

export function joinRoom(code: string): Promise<{ conn: Connection; destroy(): void }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let settled = false;
    let dialed = false;
    // Same zombie-reconnect hazard as hostRoom: 'disconnected' fires during
    // peer.destroy() while peer.destroyed is still false.
    let destroyed = false;
    const destroy = () => {
      destroyed = true;
      peer.destroy();
    };
    peer.on('open', () => {
      if (dialed) return; // a broker reconnect re-emits 'open'; dial only once
      dialed = true;
      const dc = peer.connect(codeToPeerId(code), { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        settled = true;
        resolve({ conn: wrap(dc), destroy });
      });
    });
    peer.on('disconnected', () => {
      if (settled && !destroyed && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => {
      if (settled) return;
      const type = (err as { type?: string }).type;
      destroy();
      reject(new Error(type === 'peer-unavailable' ? 'not-found' : 'network'));
    });
  });
}
