import { describe, expect, it } from 'vitest';
import deployWorkflow from '../../.github/workflows/deploy.yml?raw';
import verifier from '../../scripts/verify-turn.mjs?raw';

describe('external TURN verifier', () => {
  it('proves a relay-only two-peer data connection and selected relay candidate pair', () => {
    expect(verifier.match(/new RTCPeerConnection/g)).toHaveLength(2);
    expect(verifier.match(/iceTransportPolicy:\s*['"]relay['"]/g)?.length).toBeGreaterThanOrEqual(2);
    expect(verifier).toContain('addIceCandidate');
    expect(verifier).toContain('setRemoteDescription');
    expect(verifier).toContain('getStats');
    expect(verifier).toContain('relayProtocol');
    expect(verifier).toMatch(/candidateType\s*!==\s*['"]relay['"]/);
    expect(verifier).toContain('wildcard-turn-relay-proof');
  });
});

describe('GitHub Pages deployment', () => {
  it('validates every TURN setting before the production build', () => {
    const validation = deployWorkflow.indexOf('Validate production TURN settings');
    const build = deployWorkflow.indexOf('npm run build');

    expect(validation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(build);
    for (const name of ['VITE_TURN_URLS', 'VITE_TURN_USERNAME', 'VITE_TURN_CREDENTIAL']) {
      expect(deployWorkflow).toContain(`[ -n \"\${${name}}\" ]`);
    }
  });
});
