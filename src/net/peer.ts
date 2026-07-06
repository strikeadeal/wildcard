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
  if (!host) return {} as PeerOptions;
  return {
    host,
    port: Number(import.meta.env.VITE_PEER_PORT ?? 9000),
    path: '/',
    secure: false
  };
}

function wrap(dc: DataConnection): Connection {
  return {
    send: (msg) => dc.send(msg),
    onMessage: (cb) => dc.on('data', (data) => cb(data)),
    onClose: (cb) => {
      dc.on('close', cb);
      dc.on('error', () => cb());
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
    peer.on('open', () => {
      peer.on('connection', (dc) => {
        dc.on('open', () => onConnection(wrap(dc)));
      });
      resolve({ destroy: () => peer.destroy() });
    });
    peer.on('error', (err) => {
      const type = (err as { type?: string }).type;
      peer.destroy();
      reject(new Error(type === 'unavailable-id' ? 'code-taken' : 'network'));
    });
  });
}

export function joinRoom(code: string): Promise<{ conn: Connection; destroy(): void }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    peer.on('open', () => {
      const dc = peer.connect(codeToPeerId(code), { reliable: true, serialization: 'json' });
      dc.on('open', () => resolve({ conn: wrap(dc), destroy: () => peer.destroy() }));
    });
    peer.on('error', (err) => {
      const type = (err as { type?: string }).type;
      peer.destroy();
      reject(new Error(type === 'peer-unavailable' ? 'not-found' : 'network'));
    });
  });
}
