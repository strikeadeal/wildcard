import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlayerView } from '../../src/engine/types';
import { PROTOCOL_VERSION } from '../../src/net/protocol';
import { createLoopbackPair, type Connection } from '../../src/net/transport';
import { C } from '../engine/fixtures';
import { session } from '../../src/ui/session.svelte';

const socketMocks = vi.hoisted(() => ({ connectRoom: vi.fn() }));

vi.mock('../../src/net/socket', () => ({ connectRoom: socketMocks.connectRoom }));

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
    vi.useRealTimers();
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

  it('suppresses duplicate actions while one is pending', async () => {
    const [guestEnd, serverEnd] = createLoopbackPair();
    const pendingDuringSend: Array<typeof session.pendingAction> = [];
    const inspectingGuestEnd: Connection = {
      ...guestEnd,
      send(message: unknown) {
        if ((message as { type?: string }).type === 'intent') {
          pendingDuringSend.push(session.pendingAction);
        }
        guestEnd.send(message);
      }
    };
    socketMocks.connectRoom.mockResolvedValueOnce({ conn: inspectingGuestEnd, destroy: () => {} });
    await session.joinRoom('KP4XQ', 'Ada');
    const action = { type: 'nextRound' } as const;

    expect(session.sendAction(action)).toBe(true);
    expect(session.sendAction(action)).toBe(false);

    expect(pendingDuringSend).toHaveLength(1);
    expect(pendingDuringSend[0]?.type).toBe('nextRound');
    expect(pendingDuringSend[0]?.startedAt).toEqual(expect.any(Number));

    const intentId = session.pendingAction!.intentId;
    serverEnd.send({ v: PROTOCOL_VERSION, type: 'view', view: view(), intentId });
    await Promise.resolve();
    expect(session.pendingAction).toBeNull();

    session.sendAction(action);
    serverEnd.send({ v: PROTOCOL_VERSION, type: 'error', message: 'Action rejected', intentId: session.pendingAction!.intentId });
    await Promise.resolve();
    expect(session.pendingAction).toBeNull();
  });

  it('keeps an action pending through unrelated views until its matching acknowledgement', async () => {
    const [guestEnd, serverEnd] = createLoopbackPair();
    socketMocks.connectRoom.mockResolvedValueOnce({ conn: guestEnd, destroy: () => {} });
    await session.joinRoom('KP4XQ', 'Ada');

    session.sendAction({ type: 'drawCard' });
    const intentId = session.pendingAction!.intentId;

    serverEnd.send({ v: PROTOCOL_VERSION, type: 'view', view: view({ turnPlayerId: 'p1' }) });
    await Promise.resolve();
    expect(session.pendingAction?.intentId).toBe(intentId);

    serverEnd.send({ v: PROTOCOL_VERSION, type: 'view', view: view(), intentId });
    await Promise.resolve();
    expect(session.pendingAction).toBeNull();
  });

  it('does not create pending state when no guest is connected', () => {
    expect(session.sendAction({ type: 'nextRound' })).toBe(false);
    expect(session.pendingAction).toBeNull();
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
    session.setOnline(true);
    (session as any).lastJoin = { code: 'KP4XQ', name: 'Ada' };
    (session as any).tryRejoinOnce = async () => 'seatUnavailable';

    await (session as any).recoverGuest();

    expect(session.recovery).toBe('seatUnavailable');
  });

  it('keeps retrying recoverable failures until a later attempt joins', async () => {
    vi.useFakeTimers();
    const attempt = vi.fn()
      .mockResolvedValueOnce('networkFailed')
      .mockResolvedValueOnce('networkFailed')
      .mockResolvedValueOnce('networkFailed')
      .mockResolvedValueOnce('joined');
    (session as any).tryRejoinOnce = attempt;
    session.screen = 'game';
    session.recovery = 'reconnecting';
    session.setOnline(true);
    (session as any).lastJoin = { code: 'KP4XQ', name: 'Ada' };

    const recovery = (session as any).recoverGuest();
    await vi.advanceTimersByTimeAsync(7000);
    await recovery;

    expect(attempt).toHaveBeenCalledTimes(4);
    delete (session as any).tryRejoinOnce;
  });

  it('does not reconnect while offline and wakes immediately when online', async () => {
    vi.useFakeTimers();
    const attempt = vi.fn().mockResolvedValue('joined');
    (session as any).tryRejoinOnce = attempt;
    session.screen = 'game';
    session.recovery = 'reconnecting';
    session.setOnline(false);
    (session as any).lastJoin = { code: 'KP4XQ', name: 'Ada' };

    const recovery = (session as any).recoverGuest();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).not.toHaveBeenCalled();

    session.setOnline(true);
    await recovery;
    expect(attempt).toHaveBeenCalledTimes(1);
    delete (session as any).tryRejoinOnce;
  });

  it('bumps selectionEpoch when recovery starts and when a recovered view arrives', () => {
    (session as any).view = view({ discardTop: C('red', '5') });
    session.screen = 'game';
    session.playerId = 'p1';
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

  it('replays the same pending action and intent id after a recovered view', async () => {
    delete (session as any).tryRejoinOnce;
    const [guestEnd, serverEnd] = createLoopbackPair();
    const intents: any[] = [];
    serverEnd.onMessage((message) => {
      const msg = message as any;
      if (msg.type === 'hello') {
        serverEnd.send({ v: PROTOCOL_VERSION, type: 'welcome', playerId: 'p0', token: 'seat-token' });
        serverEnd.send({ v: PROTOCOL_VERSION, type: 'view', view: view() });
      } else if (msg.type === 'intent') intents.push(msg);
    });
    socketMocks.connectRoom.mockResolvedValueOnce({ conn: guestEnd, destroy: () => {} });
    storage.set('wildcard:token:KP4XQ', 'seat-token');
    session.screen = 'game';
    session.recovery = 'reconnecting';
    (session as any).lastJoin = { code: 'KP4XQ', name: 'Ada' };
    (session as any).pendingAction = {
      type: 'drawCard', action: { type: 'drawCard' }, startedAt: Date.now(), intentId: 'stable-client-id'
    };

    expect(await (session as any).tryRejoinOnce()).toBe('joined');
    await Promise.resolve();

    expect(intents).toEqual([{ v: PROTOCOL_VERSION, type: 'intent', action: { type: 'drawCard' }, intentId: 'stable-client-id' }]);
  });

  it('a deliberate leave notifies the host and forgets the dead seat token', () => {
    storage.set('wildcard:token:KP4XQ', 'seat-token');
    session.roomCode = 'KP4XQ';
    session.playerId = 'p1';
    let leaves = 0;
    (session as any).guest = { leave: () => leaves++, close: () => {}, send: () => {} };

    session.leave();

    expect(leaves).toBe(1); // the host is told to free the seat right away
    expect(storage.has('wildcard:token:KP4XQ')).toBe(false);
    expect(session.screen).toBe('home');
  });

  it('leave keeps the seat token when the connection is already gone', () => {
    storage.set('wildcard:token:KP4XQ', 'seat-token');
    session.roomCode = 'KP4XQ';
    (session as any).guest = null; // e.g. Home pressed mid-reconnect

    session.leave();

    expect(storage.get('wildcard:token:KP4XQ')).toBe('seat-token');
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

  it('markInstalled clears the stashed prompt and persists dismissal so the card never reappears', () => {
    const installEvent = {
      preventDefault() {},
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
    } as Event & {
      prompt(): Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    };
    session.captureInstallPrompt(installEvent);
    session.returningPlayer = true;
    expect(session.canOfferInstall).toBe(true);

    session.markInstalled();

    expect(session.installEvent).toBeNull();
    expect(session.canOfferInstall).toBe(false);
    expect(localStorage.getItem('wildcard:install-dismissed')).toBe('1');
  });
});
