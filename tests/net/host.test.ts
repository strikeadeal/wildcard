import { describe, it, expect, beforeEach } from 'vitest';
import { HostSession, type HostEvents } from '../../src/net/host';
import { createLoopbackPair, type Connection } from '../../src/net/transport';
import { PROTOCOL_VERSION, type ServerMsg } from '../../src/net/protocol';
import { DEFAULT_RULES, type GameState, type PlayerView } from '../../src/engine/types';
import type { LobbyInfo } from '../../src/net/protocol';
import { C, fixedState } from '../engine/fixtures';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Test guest: a raw wire end that records everything the host sends it. */
class Wire {
  received: ServerMsg[] = [];
  closed = false;
  conn: Connection;
  constructor(host: HostSession) {
    const [guestEnd, hostEnd] = createLoopbackPair();
    this.conn = guestEnd;
    this.conn.onMessage((m) => this.received.push(m as ServerMsg));
    this.conn.onClose(() => (this.closed = true));
    host.attach(hostEnd);
  }
  hello(name: string, token: string | null = null, v = PROTOCOL_VERSION) {
    this.conn.send({ v, type: 'hello', name, token });
  }
  intent(action: unknown) {
    this.conn.send({ v: PROTOCOL_VERSION, type: 'intent', action });
  }
  last<T extends ServerMsg['type']>(type: T) {
    return [...this.received].reverse().find((m) => m.type === type) as
      | Extract<ServerMsg, { type: T }>
      | undefined;
  }
}

describe('HostSession', () => {
  let events: { lobbies: LobbyInfo[]; views: PlayerView[]; errors: string[] };
  let host: HostSession;

  beforeEach(() => {
    events = { lobbies: [], views: [], errors: [] };
    const handlers: HostEvents = {
      onLobby: (l) => events.lobbies.push(l),
      onView: (v) => events.views.push(v),
      onError: (e) => events.errors.push(e)
    };
    let n = 0;
    host = new HostSession('Host', DEFAULT_RULES, handlers, () => 'token-' + n++);
  });

  it('rejects protocol version mismatches', async () => {
    const w = new Wire(host);
    w.hello('Old', null, 99);
    await flush();
    expect(w.last('rejected')?.reason).toBe('version');
    expect(w.closed).toBe(true); // rejection also closes the connection
  });

  it('seats guests and broadcasts the lobby', async () => {
    const w = new Wire(host);
    w.hello('Ada');
    await flush();
    expect(w.last('welcome')?.playerId).toBe('p1');
    expect(w.last('lobby')?.lobby.players.map((p) => p.name)).toEqual(['Host', 'Ada']);
    expect(events.lobbies.length).toBeGreaterThan(0);
  });

  it('advertises canStart only once a second player is connected', async () => {
    expect(host.lobbyInfo().canStart).toBe(false); // host alone
    const a = new Wire(host);
    a.hello('Ada');
    await flush();
    expect(host.lobbyInfo().canStart).toBe(true);
    expect(a.last('lobby')?.lobby.canStart).toBe(true);

    a.conn.close(); // disconnected guests do not count, same as startGame's guard
    await flush();
    expect(host.lobbyInfo().canStart).toBe(false);
    expect(events.lobbies[events.lobbies.length - 1]!.canStart).toBe(false);
  });

  it('rejects a 7th player and late joiners without a token', async () => {
    const wires = Array.from({ length: 5 }, () => new Wire(host));
    for (const [i, w] of wires.entries()) w.hello('G' + i);
    await flush();
    const seventh = new Wire(host);
    seventh.hello('TooMany');
    await flush();
    expect(seventh.last('rejected')?.reason).toBe('full');
    expect(seventh.closed).toBe(true);

    host.startGame();
    await flush();
    const late = new Wire(host);
    late.hello('Late');
    await flush();
    expect(late.last('rejected')?.reason).toBe('started');
    expect(late.closed).toBe(true);
  });

  it('startGame deals views: each guest sees only their own hand', async () => {
    const a = new Wire(host);
    a.hello('Ada');
    await flush();
    host.startGame();
    await flush();
    const view = a.last('view')!.view;
    expect(view.you.hand).toHaveLength(7);
    expect(view.players).toHaveLength(2);
    expect(JSON.stringify(view.players)).not.toContain('"hand"');
    expect(events.views.length).toBeGreaterThan(0); // host got their own view
  });

  it('routes intents: valid ones update everyone, invalid ones error the sender', async () => {
    const a = new Wire(host);
    a.hello('Ada');
    await flush();
    host.startGame();
    await flush();
    const before = a.last('view')!.view;
    a.intent({ type: 'drawCard' }); // out of turn unless it is p1's turn
    await flush();
    if (before.turnPlayerId === 'p1') {
      expect(a.last('view')!.view).not.toEqual(before);
    } else {
      expect(a.last('error')).toBeDefined();
      expect(a.last('view')!.view).toEqual(before);
    }
  });

  it('stores derived public notices after a successful action', async () => {
    const a = new Wire(host);
    a.hello('Ada');
    await flush();
    host.startGame();
    await flush();
    host.state = fixedTwoPlayerState();

    a.intent({ type: 'playCard', cardId: 9001 });
    await flush();

    expect(host.lastNotices).toEqual([
      { id: 1, kind: 'play', actorId: 'p1', card: { color: 'red', value: 'draw2' } },
      { id: 2, kind: 'penalty', actorId: 'p1', targetId: 'p0', count: 2, pendingDraw: 2, stacked: false }
    ]);
  });

  it('marks disconnects and restores a seat on token rejoin', async () => {
    const a = new Wire(host);
    a.hello('Ada');
    await flush();
    const token = a.last('welcome')!.token;
    host.startGame();
    await flush();
    a.conn.close();
    await flush();
    expect(events.views[events.views.length - 1]!.players[1]!.connected).toBe(false);

    const back = new Wire(host);
    back.hello('Ada', token);
    await flush();
    expect(back.last('welcome')?.playerId).toBe('p1');
    expect(back.last('view')?.view.you.hand).toHaveLength(7);
    expect(events.views[events.views.length - 1]!.players[1]!.connected).toBe(true);
  });

  it('token rejoin supersedes a still-open connection without dropping the seat', async () => {
    const a = new Wire(host);
    a.hello('Ada');
    await flush();
    const token = a.last('welcome')!.token;
    host.startGame();
    await flush();

    // Do NOT close a's wire — hello with the same token from a fresh connection.
    const takeover = new Wire(host);
    takeover.hello('Ada', token);
    await flush();

    expect(takeover.last('welcome')?.playerId).toBe('p1');
    expect(takeover.last('view')?.view.you.hand).toHaveLength(7);
    expect(a.closed).toBe(true); // host closed the superseded connection
    // The old connection's onClose must not mark the seat disconnected.
    expect(events.views[events.views.length - 1]!.players[1]!.connected).toBe(true);
  });

  it('does not throw on a malformed hello (non-string name/token) and still seats the guest', async () => {
    const w = new Wire(host);
    expect(() => w.conn.send({ v: PROTOCOL_VERSION, type: 'hello', name: 42 as any, token: 7 as any }))
      .not.toThrow();
    await flush();
    expect(w.last('welcome')?.playerId).toBe('p1');
    const name = w.last('lobby')?.lobby.players.find((p) => p.id === 'p1')?.name;
    expect(typeof name).toBe('string');
    expect(name!.length).toBeGreaterThan(0);
  });

  it('a single connection sending hello twice (no token) only occupies one seat', async () => {
    const w = new Wire(host);
    w.hello('Ada');
    await flush();
    w.hello('Ada again');
    await flush();
    const lobby = w.last('lobby')!.lobby;
    expect(lobby.players).toHaveLength(2); // host + one guest, not two guests
  });

  it('removeSeat before start drops the guest from the lobby and closes their wire', async () => {
    const a = new Wire(host);
    a.hello('Ada');
    await flush();

    host.removeSeat('p1');
    await flush();

    const lobby = events.lobbies[events.lobbies.length - 1]!;
    expect(lobby.players.map((p) => p.id)).toEqual(['p0']);
    expect(a.closed).toBe(true);
    expect(host.state).toBeNull(); // still in the lobby, no game created
  });

  it('skipTurn force-ends an absent player turn; removeSeat deals them out', async () => {
    const a = new Wire(host);
    a.hello('Ada');
    await flush();
    host.startGame();
    await flush();
    while (host.state!.players[host.state!.turn]!.id !== 'p1') {
      host.skipTurn(host.state!.players[host.state!.turn]!.id);
    }
    host.skipTurn('p1');
    expect(host.state!.players[host.state!.turn]!.id).toBe('p0');

    host.removeSeat('p1');
    await flush();
    expect(host.state!.players.map((p) => p.id)).toEqual(['p0']);
    expect(host.state!.phase).toBe('roundEnd');
  });

  it('uses the injected seed when starting a game', async () => {
    const handlers: HostEvents = {
      onLobby: () => {}, onView: () => {}, onError: () => {}
    };
    const seeded = new HostSession(
      'Host', DEFAULT_RULES, handlers, () => 'token', () => 1234
    );
    const w = new Wire(seeded);
    w.hello('Ada');
    await flush();
    seeded.startGame();
    expect(seeded.state?.seed).toBe(1235); // deal() advances the supplied seed once
  });
});

function fixedTwoPlayerState(): GameState {
  return fixedState(
    [[C('blue', '3', 9000)], [C('red', 'draw2', 9001), C('yellow', '9', 9004)]],
    C('red', '5', 9003),
    { turn: 1 }
  );
}
