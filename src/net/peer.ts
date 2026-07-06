import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { codeToPeerId } from './codes';
import type { Connection } from './transport';

/**
 * E2E and local dev can point at a local PeerServer via Vite env:
 *   VITE_PEER_HOST=localhost VITE_PEER_PORT=9000
 * Default ({}) is the free public PeerJS cloud broker.
 */
function peerOptions(): PeerOptions {
  const host = import.meta.env.VITE_PEER_HOST as string | undefined;
  if (!host) return {};
  return {
    host,
    port: Number(import.meta.env.VITE_PEER_PORT ?? 9000),
    path: '/',
    secure: false
  };
}

function wrap(dc: DataConnection): Connection {
  let onMsg: (msg: unknown) => void = () => {};
  let onCls: () => void = () => {};
  let notified = false;
  // PeerJS may emit 'error' and 'close' for the same failure; the Connection
  // contract is onClose at most once.
  const notifyClose = () => {
    if (notified) return;
    notified = true;
    onCls();
  };
  dc.on('data', (data) => onMsg(data));
  dc.on('close', notifyClose);
  dc.on('error', notifyClose);
  return {
    send: (msg) => dc.send(msg),
    onMessage: (cb) => { onMsg = cb; },
    onClose: (cb) => { onCls = cb; },
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
