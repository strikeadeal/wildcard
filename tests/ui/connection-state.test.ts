import { describe, expect, it } from 'vitest';
import { nextRecoveryState } from '../../src/ui/connection-state';

describe('nextRecoveryState', () => {
  it('keeps the table in recovery before declaring failure', () => {
    expect(nextRecoveryState('idle', { type: 'transportUnstable' })).toBe('unstable');
    expect(nextRecoveryState('unstable', { type: 'retryStarted' })).toBe('reconnecting');
    expect(nextRecoveryState('reconnecting', { type: 'rejoined' })).toBe('idle');
  });

  it('distinguishes unavailable room from unavailable network', () => {
    expect(nextRecoveryState('reconnecting', { type: 'roomMissing' }))
      .toBe('roomUnavailable');
    expect(nextRecoveryState('reconnecting', { type: 'networkFailed' }))
      .toBe('networkUnavailable');
  });
});
