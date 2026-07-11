import { describe, it, expect, vi } from 'vitest';
import { GuestSession, type GuestEvents } from '../../src/net/guest';
import { RoomSession } from '../../src/net/room';
import { createLoopbackPair, type Connection, type ConnectionHealth } from '../../src/net/transport';
import { DEFAULT_RULES } from '../../src/engine/types';
import { PROTOCOL_VERSION } from '../../src/net/protocol';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A room whose host seat p0 is already claimed by a raw wire. */
async function createdRoom(): Promise<RoomSession> {
  const room = new RoomSession();
  const [hostEnd, roomEnd] = createLoopbackPair();
  room.attach(roomEnd);
  hostEnd.send({ v: PROTOCOL_VERSION, type: 'hello', name: 'Host', token: null, create: true });
  await flush();
  return room;
}

function joinRoom(room: RoomSession): Connection {
  const [guestEnd, roomEnd] = createLoopbackPair();
  room.attach(roomEnd);
  return guestEnd;
}

const guestEvents = (): GuestEvents => ({
  onWelcome: vi.fn(), onLobby: vi.fn(), onView: vi.fn(),
  onRejected: vi.fn(), onError: vi.fn(), onClosed: vi.fn(), onRoomClosed: vi.fn(),
  onConnectionStatus: vi.fn()
} as any);

describe('GuestSession', () => {
  it('says hello on construction and surfaces welcome + lobby', async () => {
    const room = await createdRoom();
    const events = guestEvents();
    const guest = new GuestSession(joinRoom(room), 'Ada', null, false, events);
    await flush();
    expect(events.onWelcome).toHaveBeenCalledWith('p1', expect.any(String));
    expect(guest.playerId).toBe('p1');
    expect(events.onLobby).toHaveBeenCalled();
  });

  it('a create hello claims the host seat', async () => {
    const room = new RoomSession();
    const events = guestEvents();
    const host = new GuestSession(joinRoom(room), 'Hana', null, true, events);
    await flush();
    expect(events.onWelcome).toHaveBeenCalledWith('p0', expect.any(String));
    expect(host.playerId).toBe('p0');
  });

  it('host commands go over the wire and take effect', async () => {
    const room = new RoomSession();
    const events = guestEvents();
    const host = new GuestSession(joinRoom(room), 'Hana', null, true, events);
    new GuestSession(joinRoom(room), 'Ada', null, false, guestEvents());
    await flush();
    host.setConfig({ ...DEFAULT_RULES, stacking: true });
    await flush();
    expect(room.lobbyInfo().config.stacking).toBe(true);
    host.startGame();
    await flush();
    expect(room.state).not.toBeNull();
    expect(events.onView).toHaveBeenCalled();
  });

  it('receives views and can send intents', async () => {
    const room = new RoomSession();
    const host = new GuestSession(joinRoom(room), 'Hana', null, true, guestEvents());
    const events = guestEvents();
    const guest = new GuestSession(joinRoom(room), 'Ada', null, false, events);
    await flush();
    host.startGame();
    await flush();
    expect(events.onView).toHaveBeenCalled();
    guest.send({ type: 'callUno' }); // almost surely illegal with 7 cards
    await flush();
    expect(events.onError).toHaveBeenCalled();
  });

  it('passes optional notices through onView', async () => {
    const [guestEnd, roomEnd] = createLoopbackPair();
    const events = guestEvents();
    new GuestSession(guestEnd, 'Ada', null, false, events);
    await flush();

    roomEnd.send({
      v: PROTOCOL_VERSION,
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
    const room = new RoomSession();
    const events = guestEvents();
    new GuestSession(joinRoom(room), 'Ada', null, false, events);
    await flush();
    expect(events.onRejected).toHaveBeenCalledWith('notFound'); // nobody created it

    const room2 = await createdRoom();
    const events2 = guestEvents();
    const [guestEnd2, roomEnd2] = createLoopbackPair();
    room2.attach(roomEnd2);
    new GuestSession(guestEnd2, 'Bob', null, false, events2);
    await flush();
    roomEnd2.close();
    await flush();
    expect(events2.onClosed).toHaveBeenCalled();
  });

  it('surfaces the room being closed by the host', async () => {
    const [guestEnd, roomEnd] = createLoopbackPair();
    const events = guestEvents();
    new GuestSession(guestEnd, 'Ada', null, false, events);
    await flush();
    roomEnd.send({ v: PROTOCOL_VERSION, type: 'closed', reason: 'hostLeft' });
    await flush();
    expect(events.onRoomClosed).toHaveBeenCalled();
  });

  it('leave tells the room to free the seat and hangs up', async () => {
    const room = await createdRoom();
    const events = guestEvents();
    const guest = new GuestSession(joinRoom(room), 'Ada', null, false, events);
    await flush();
    expect(room.lobbyInfo().players).toHaveLength(2);

    guest.leave();
    await flush();
    expect(room.lobbyInfo().players.map((p) => p.id)).toEqual(['p0']);
    expect(events.onClosed).toHaveBeenCalled();
  });

  it('leave does not throw when the connection is already closed', async () => {
    const [guestEnd] = createLoopbackPair();
    const guest = new GuestSession(guestEnd, 'Ada', null, false, guestEvents());
    guestEnd.close();
    await flush();
    expect(() => guest.leave()).not.toThrow();
  });

  it('forwards connection health updates', async () => {
    const [guestEnd] = createLoopbackPair();
    const events = guestEvents();
    new GuestSession(guestEnd, 'Ada', null, false, events);
    await flush();

    expect(events.onConnectionStatus).toHaveBeenCalledWith('connected' satisfies ConnectionHealth);
  });
});
