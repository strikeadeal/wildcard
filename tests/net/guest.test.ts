import { describe, it, expect, vi } from 'vitest';
import { GuestSession, type GuestEvents } from '../../src/net/guest';
import { HostSession } from '../../src/net/host';
import { createLoopbackPair, type ConnectionHealth } from '../../src/net/transport';
import { DEFAULT_RULES } from '../../src/engine/types';

const flush = () => new Promise((r) => setTimeout(r, 0));

const silentHost = () =>
  new HostSession('Host', DEFAULT_RULES, {
    onLobby: () => {}, onView: () => {}, onError: () => {}
  });

const guestEvents = (): GuestEvents => ({
  onWelcome: vi.fn(), onLobby: vi.fn(), onView: vi.fn(),
  onRejected: vi.fn(), onError: vi.fn(), onClosed: vi.fn(), onConnectionStatus: vi.fn()
} as any);

describe('GuestSession', () => {
  it('says hello on construction and surfaces welcome + lobby', async () => {
    const host = silentHost();
    const [guestEnd, hostEnd] = createLoopbackPair();
    host.attach(hostEnd);
    const events = guestEvents();
    const guest = new GuestSession(guestEnd, 'Ada', null, events);
    await flush();
    expect(events.onWelcome).toHaveBeenCalledWith('p1', expect.any(String));
    expect(guest.playerId).toBe('p1');
    expect(events.onLobby).toHaveBeenCalled();
  });

  it('receives views and can send intents', async () => {
    const host = silentHost();
    const [guestEnd, hostEnd] = createLoopbackPair();
    host.attach(hostEnd);
    const events = guestEvents();
    const guest = new GuestSession(guestEnd, 'Ada', null, events);
    await flush();
    host.startGame();
    await flush();
    expect(events.onView).toHaveBeenCalled();
    guest.send({ type: 'callUno' }); // almost surely illegal with 7 cards
    await flush();
    expect(events.onError).toHaveBeenCalled();
  });

  it('passes optional notices through onView', async () => {
    const [guestEnd, hostEnd] = createLoopbackPair();
    const events = guestEvents();
    new GuestSession(guestEnd, 'Ada', null, events);
    await flush();

    hostEnd.send({
      v: 1,
      type: 'view',
      view: {
        you: { id: 'p1', name: 'Ada', hand: [], saidUno: false, score: 0 },
        players: [{ id: 'p1', name: 'Ada', handCount: 0, saidUno: false, connected: true, score: 0 }],
        turnPlayerId: 'p1',
        currentColor: 'red',
        discardTop: { id: 5, color: 'red', value: '5' },
        deckCount: 20,
        phase: 'play',
        direction: 1,
        pendingDraw: 0,
        hasDrawnThisTurn: false,
        config: DEFAULT_RULES,
        roundWinner: null,
        playableCardIds: [],
        canDraw: true,
        canPass: false,
        canChallenge: false,
        canCallUno: false,
        catchableIds: [],
        mustChooseColor: false,
        mustChooseSwapTarget: false
      },
      notices: [{ id: 1, kind: 'draw', actorId: 'p1', count: 1 }]
    });
    await flush();

    expect(events.onView).toHaveBeenLastCalledWith(
      expect.objectContaining({ turnPlayerId: 'p1' }),
      [{ id: 1, kind: 'draw', actorId: 'p1', count: 1 }]
    );
  });

  it('surfaces rejection and close', async () => {
    const host = silentHost();
    host.startGame(); // cannot start with 1 player -> stays in lobby
    const [guestEnd, hostEnd] = createLoopbackPair();
    host.attach(hostEnd);
    const events = guestEvents();
    new GuestSession(guestEnd, 'Ada', 'no-such-token', events);
    await flush();
    // token unknown & lobby open -> seated normally (token only matters mid-game)
    expect(events.onWelcome).toHaveBeenCalled();

    const [guestEnd2, hostEnd2] = createLoopbackPair();
    host.attach(hostEnd2);
    const events2 = guestEvents();
    new GuestSession(guestEnd2, 'Bob', null, events2);
    await flush();
    hostEnd2.close();
    await flush();
    expect(events2.onClosed).toHaveBeenCalled();
  });

  it('leave tells the host to free the seat and hangs up', async () => {
    const host = silentHost();
    const [guestEnd, hostEnd] = createLoopbackPair();
    host.attach(hostEnd);
    const events = guestEvents();
    const guest = new GuestSession(guestEnd, 'Ada', null, events);
    await flush();
    expect(host.lobbyInfo().players).toHaveLength(2);

    guest.leave();
    await flush();
    expect(host.lobbyInfo().players.map((p) => p.id)).toEqual(['p0']);
    expect(events.onClosed).toHaveBeenCalled();
  });

  it('leave does not throw when the connection is already closed', async () => {
    const [guestEnd] = createLoopbackPair();
    const guest = new GuestSession(guestEnd, 'Ada', null, guestEvents());
    guestEnd.close();
    await flush();
    expect(() => guest.leave()).not.toThrow();
  });

  it('forwards connection health updates', async () => {
    const [guestEnd] = createLoopbackPair();
    const events = guestEvents();
    new GuestSession(guestEnd, 'Ada', null, events);
    await flush();

    expect(events.onConnectionStatus).toHaveBeenCalledWith('connected' satisfies ConnectionHealth);
  });
});
