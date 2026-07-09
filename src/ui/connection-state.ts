export type { ConnectionHealth } from '../net/transport';

export type RecoveryState =
  | 'idle'
  | 'unstable'
  | 'reconnecting'
  | 'seatUnavailable'
  | 'roomUnavailable'
  | 'networkUnavailable';

export type RecoveryEvent =
  | { type: 'transportUnstable' }
  | { type: 'retryStarted' }
  | { type: 'rejoined' }
  | { type: 'seatMissing' }
  | { type: 'roomMissing' }
  | { type: 'networkFailed' }
  | { type: 'cancelled' };

export function nextRecoveryState(
  state: RecoveryState, event: RecoveryEvent
): RecoveryState {
  switch (event.type) {
    case 'transportUnstable': return state === 'idle' ? 'unstable' : state;
    case 'retryStarted': return 'reconnecting';
    case 'rejoined':
    case 'cancelled': return 'idle';
    case 'seatMissing':
      return state === 'reconnecting' ? 'seatUnavailable' : state;
    case 'roomMissing':
      return state === 'reconnecting' ? 'roomUnavailable' : state;
    case 'networkFailed':
      return state === 'reconnecting' ? 'networkUnavailable' : state;
  }
}
