import { describe, it, expect, beforeEach } from 'vitest';
import { HostSession, type HostEvents } from '../../src/net/host';
import { createLoopbackPair, type Connection } from '../../src/net/transport';
import { PROTOCOL_VERSION, type ServerMsg } from '../../src/net/protocol';
import { DEFAULT_RULES, type PlayerView } from '../../src/engine/types';
import type { LobbyInfo } from '../../src/net/protocol';

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
});
