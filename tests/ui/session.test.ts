import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PlayerView } from '../../src/engine/types';
import { C } from '../engine/fixtures';
import { session } from '../../src/ui/session.svelte';

function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    you: { id: 'p0', name: 'Ada', hand: [], saidUno: false, score: 0 },
    players: [
      { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 0 },
      { id: 'p1', name: 'Bob', cardCount: 5, saidUno: false, connected: true, score: 0 },
      { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
    ],
    discardTop: C('red', '5'),
    currentColor: 'red',
    deckCount: 80,
    turnPlayerId: 'p0',
    direction: 1,
    phase: 'play',
    config: { stacking: false, jumpIn: false, drawUntilPlayable: false, sevenZero: false },
    pendingDraw: 0,
    roundWinner: null,
    playableCardIds: [],
    canDraw: true,
    canPass: false,
    canChallenge: false,
    canCallUno: false,
    catchableIds: [],
    mustChooseColor: false,
    mustChooseSwapTarget: false,
    ...over
  };
}

const storage = new Map<string, string>();

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        return storage.has(key) ? storage.get(key)! : null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      }
    }
  });
});

describe('session notice handling', () => {
  afterEach(() => {
    session.leave();
    storage.clear();
  });

  it('refreshes lastPlayFromSelf from view diffs even when notices are transported', () => {
    (session as any).view = view({ discardTop: C('red', '5'), turnPlayerId: 'p0' });
    session.lastPlayFromSelf = false;

    (session as any).handleView(
      view({ discardTop: C('red', '7'), turnPlayerId: 'p1' }),
      [{ id: 1, kind: 'play', actorId: 'p0', card: { color: 'red', value: '7' } }]
    );

    expect(session.lastPlayFromSelf).toBe(true);
  });

  it('clears stale self-direction when an opponent play arrives with transported notices', () => {
    (session as any).view = view({ discardTop: C('red', '5'), turnPlayerId: 'p1' });
    session.lastPlayFromSelf = true;

    (session as any).handleView(
      view({ discardTop: C('red', '7'), turnPlayerId: 'p2' }),
      [{ id: 2, kind: 'play', actorId: 'p1', card: { color: 'red', value: '7' } }]
    );

    expect(session.lastPlayFromSelf).toBe(false);
  });

  it('queues a fresh transported notice as the current announcement', () => {
    (session as any).view = view({ discardTop: C('red', '5'), turnPlayerId: 'p0' });
    session.noticeHistory = [];
    session.noticeQueue = [];

    (session as any).handleView(
      view({ discardTop: C('red', '7'), turnPlayerId: 'p1' }),
      [{ id: 3, kind: 'play', actorId: 'p0', card: { color: 'red', value: '7' } }]
    );

    expect(session.noticeHistory.map((notice) => notice.id)).toEqual([3]);
    expect(session.noticeQueue.map((notice) => notice.id)).toEqual([3]);
    expect(session.currentNotice?.id).toBe(3);
  });

  it('ends recovery at seat unavailable when auto-rejoin finds a stale token', async () => {
    storage.set('wildcard:token:KP4XQ', 'stale-token');
    session.screen = 'game';
    session.recovery = 'reconnecting';
    (session as any).lastJoin = { code: 'KP4XQ', name: 'Ada' };
    (session as any).tryRejoinOnce = async () => 'seatUnavailable';

    await (session as any).recoverGuest();

    expect(session.recovery).toBe('seatUnavailable');
  });

  it('bumps selectionEpoch when recovery starts and when a recovered view arrives', () => {
    (session as any).view = view({ discardTop: C('red', '5') });
    session.screen = 'game';
    session.isHost = false;
    session.recovery = 'idle';
    session.selectionEpoch = 0;
    (session as any).lastJoin = { code: 'KP4XQ', name: 'Ada' };
    (session as any).destroyPeer = () => {};
    (session as any).recoverGuest = () => Promise.resolve();

    (session as any).handleGuestClosed();
    expect(session.recovery).toBe('reconnecting');
    expect(session.selectionEpoch).toBe(1);

    (session as any).handleView(view({ discardTop: C('blue', '7') }));
    expect(session.recovery).toBe('idle');
    expect(session.selectionEpoch).toBe(2);
  });

  it('recomputes install eligibility when a captured prompt becomes returning-player eligible', () => {
    const installEvent = {
      preventDefault() {},
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
    } as Event & {
      prompt(): Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    };

    (session as any).view = view({ phase: 'play' });
    session.captureInstallPrompt(installEvent);

    expect((session as any).returningPlayer).toBe(false);
    expect(session.canOfferInstall).toBe(false);

    (session as any).handleView(view({ phase: 'roundEnd', roundWinner: 'p0' }));

    expect(localStorage.getItem('wildcard:returning')).toBe('1');
    expect((session as any).returningPlayer).toBe(true);
    expect(session.canOfferInstall).toBe(true);
  });
});
