import { describe, expect, it } from 'vitest';
import { buildIceConfig } from '../../src/net/ice';

describe('TURN ICE configuration', () => {
  it('leaves PeerJS defaults unchanged when TURN is not configured', () => {
    expect(buildIceConfig({})).toBeUndefined();
  });

  it('rejects incomplete TURN configuration', () => {
    expect(buildIceConfig({ VITE_TURN_URLS: 'turn:192.0.2.1:3478' })).toBeUndefined();
    expect(buildIceConfig({
      VITE_TURN_URLS: 'turn:192.0.2.1:3478',
      VITE_TURN_USERNAME: 'wildcard'
    })).toBeUndefined();
  });

  it('builds STUN followed by trimmed UDP and TCP TURN URLs', () => {
    expect(buildIceConfig({
      VITE_TURN_URLS: ' turn:168.144.160.100:3478?transport=udp, turn:168.144.160.100:3478?transport=tcp ',
      VITE_TURN_USERNAME: ' wildcard ',
      VITE_TURN_CREDENTIAL: ' relay-password '
    })).toEqual({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: [
            'turn:168.144.160.100:3478?transport=udp',
            'turn:168.144.160.100:3478?transport=tcp'
          ],
          username: 'wildcard',
          credential: 'relay-password'
        }
      ]
    });
  });
});
