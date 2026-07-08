export type FatalReason =
  | 'version' | 'full' | 'started' | 'badToken'
  | 'roomUnavailable' | 'networkUnavailable';
export type FatalAction = 'retry' | 'create' | 'refresh' | 'home';
export interface FatalContent {
  title: string;
  detail: string;
  actions: FatalAction[];
}

export function fatalContent(reason: FatalReason, code: string | null): FatalContent {
  switch (reason) {
    case 'version': return {
      title: 'Update needed', detail: 'Refresh both devices, then try again.',
      actions: ['refresh', 'home']
    };
    case 'full': return {
      title: 'Room full', detail: 'This room already has 6 players.',
      actions: ['create', 'home']
    };
    case 'started': return {
      title: 'Game already started',
      detail: 'Late joining is not available for this game.', actions: ['home']
    };
    case 'badToken': return {
      title: 'Seat no longer available',
      detail: 'Your saved seat is no longer part of this game.', actions: ['home']
    };
    case 'roomUnavailable': return {
      title: 'Room unavailable',
      detail: `No room answers to ${code ?? 'that code'}. Check the code; the host may have left.`,
      actions: ['retry', 'create', 'home']
    };
    case 'networkUnavailable': return {
      title: 'Network unavailable',
      detail: 'WILDCARD could not reach the connection service. Try another network.',
      actions: ['retry', 'home']
    };
  }
}
