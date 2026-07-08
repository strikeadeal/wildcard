import { describe, expect, it } from 'vitest';
import { peerOptions } from '../../src/net/peer';

describe('PeerJS options', () => {
  it('preserves local broker overrides and adds production ICE configuration', () => {
    expect(peerOptions({
      VITE_PEER_HOST: 'localhost',
      VITE_PEER_PORT: '9099',
      VITE_TURN_URLS: 'turn:168.144.160.100:3478?transport=udp',
      VITE_TURN_USERNAME: 'wildcard',
      VITE_TURN_CREDENTIAL: 'relay-password'
    })).toEqual({
      host: 'localhost',
      port: 9099,
      path: '/',
      secure: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: ['turn:168.144.160.100:3478?transport=udp'],
            username: 'wildcard',
            credential: 'relay-password'
          }
        ]
      }
    });
  });
});
