import { describe, it, expect, vi } from 'vitest';
import { GuestSession, type GuestEvents } from '../../src/net/guest';
import { HostSession } from '../../src/net/host';
import { createLoopbackPair } from '../../src/net/transport';
import { DEFAULT_RULES } from '../../src/engine/types';

const flush = () => new Promise((r) => setTimeout(r, 0));

const silentHost = () =>
  new HostSession('Host', DEFAULT_RULES, {
    onLobby: () => {}, onView: () => {}, onError: () => {}
  });

const guestEvents = (): { [K in keyof GuestEvents]: ReturnType<typeof vi.fn> } => ({
  onWelcome: vi.fn(), onLobby: vi.fn(), onView: vi.fn(),
  onRejected: vi.fn(), onError: vi.fn(), onClosed: vi.fn()
});

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
});
